import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPackages, parseCliArgs, run, usageText, validateDelay } from "../../scripts/deps/check-allowed.mjs";
import { CACHE } from "../../scripts/deps/cache.mjs";
import { PACE } from "../../scripts/deps/pace.mjs";

/**
 * These tests cover what can be checked without a real SSO login: argument parsing, lockfile
 * loading, the zero-package path through `run()`, and — via `run()`'s `deps` override — the
 * package loop itself with a FAKE client, so the loop's own behaviour (stopping immediately on a
 * login failure, printing each failed package as it happens, not losing an answer to a cache
 * write failure) is pinned by a real test instead of only by reading the code. What stays out of
 * scope is the real network/browser/token exchange behind `defaultCreateClient` and
 * `defaultCreateTokenSource` — that needs a human SSO login and a live run (spec section 10, and
 * the CLI's own module doc).
 */

const tempDirs: string[] = [];

/** Writes `content` to package-lock.json inside a fresh directory under the OS temp dir. */
function tempLock(content: string) {
  const dir = mkdtempSync(join(tmpdir(), "deps-check-test-"));
  tempDirs.push(dir);
  const file = join(dir, "package-lock.json");
  writeFileSync(file, content, "utf8");
  return { dir, file };
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("validateDelay", () => {
  it("принимает значение по умолчанию", () => {
    expect(validateDelay(String(PACE.baseDelayMs))).toEqual({ ok: true, value: PACE.baseDelayMs });
  });

  it("разрешает замедлить темп выше минимума", () => {
    expect(validateDelay(String(PACE.baseDelayMs + 1000))).toEqual({ ok: true, value: PACE.baseDelayMs + 1000 });
  });

  it("отказывает на нечисловом значении вместо тихого NaN", () => {
    const result = validateDelay("abc");
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/--delay/);
  });

  it("отказывает ниже минимального темпа, а не молча ускоряет прогон", () => {
    const result = validateDelay("10");
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain(String(PACE.baseDelayMs));
  });
});

describe("parseCliArgs", () => {
  it("подставляет значения по умолчанию", () => {
    const values = parseCliArgs([]);
    expect(values.lock).toBe("package-lock.json");
    expect(values.prod).toBe(false);
    expect(values["strict-dev"]).toBe(false);
    expect(values.delay).toBe(String(PACE.baseDelayMs));
  });

  it("каталог кэша по умолчанию — это CACHE.dir из cache.mjs, а не второй литерал рядом", () => {
    // The point of this assertion: `cache.test.ts` already pins CACHE against the spec, but
    // that guards a constant nothing reads unless the CLI's own default is wired to IT, not to
    // a hand-written "tmp/deps-cache" string that happens to match today.
    expect(parseCliArgs([]).cache).toBe(CACHE.dir);
  });

  it("читает --prod и --strict-dev", () => {
    const values = parseCliArgs(["--prod", "--strict-dev"]);
    expect(values.prod).toBe(true);
    expect(values["strict-dev"]).toBe(true);
  });
});

describe("loadPackages", () => {
  it("даёт понятную ошибку на отсутствующем файле вместо сырого стека", () => {
    const result = loadPackages(join(tmpdir(), "deps-check-does-not-exist.json"));
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/Не удалось прочитать/);
  });

  it("даёт понятную ошибку на битом JSON", () => {
    const { file } = tempLock("{ не json");
    const result = loadPackages(file);
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/Не удалось прочитать/);
  });

  it("lockfileVersion не 3 читается как понятный текст, не как стек", () => {
    const { file } = tempLock(JSON.stringify({ lockfileVersion: 2, packages: { "": {} } }));
    const result = loadPackages(file);
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/версии 3/);
    expect((result as { message: string }).message).not.toMatch(/\s+at\s+\S+:\d+:\d+/);
  });

  it("разбирает валидный lock-файл", () => {
    const { file } = tempLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: { "": {}, "node_modules/left-pad": { version: "1.3.0" } },
      }),
    );
    const result = loadPackages(file);
    expect(result.ok).toBe(true);
    expect((result as { packages: Array<{ name: string }> }).packages.map((p) => p.name)).toEqual(["left-pad"]);
  });
});

describe("run — пути без обращения к сети", () => {
  it("--delay ниже минимума останавливает прогон раньше чтения lock-файла", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await run(["--delay", "1", "--lock", join(tmpdir(), "deps-check-unused.json")]);
      expect(code).toBe(2);
      expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(/--delay/);
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
  });

  it("отсутствующий lock-файл даёт код 2 и понятное сообщение", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await run(["--lock", join(tmpdir(), "deps-check-still-missing.json")]);
      expect(code).toBe(2);
      expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(/Не удалось прочитать/);
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
  });

  it("неизвестный флаг даёт понятную русскую ошибку и код 2, а не голый TypeError", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await run(["--bogus-flag"]);
      expect(code).toBe(2);
      expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(/Неверные аргументы/);
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
  });

  it("--prod, обнуливший граф целиком до dev-only, — явный отказ (код 2), а не «всё разрешено»", async () => {
    // The exact defect closed once already in parseLockfile (an empty package list reading as
    // "0 checked, all permitted") reappears one step later when `--prod` is the one that empties
    // the set: the lockfile was never empty, only the production slice of it is.
    const { file, dir } = tempLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: { "": {}, "node_modules/only-dev": { version: "1.0.0", dev: true } },
      }),
    );
    const out = join(dir, "report");
    const cache = join(dir, "cache");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await run(["--lock", file, "--prod", "--out", out, "--cache", cache]);
      expect(code).toBe(2);
      expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(/--prod оставил 0 пакетов/);
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
    // A refusal, not a partial success: nothing gets written that could later be mistaken for a
    // completed, all-clear report.
    expect(existsSync(join(out, "report.md"))).toBe(false);
  });

  it("lock-файл без единого пакета: отказ (код 2), а не «всё разрешено» — граф мог быть пуст, а не проверен", async () => {
    // Coordinator's own counter-example to my earlier "legitimate empty graph" call: an empty
    // package list reads to a human as "0 checked, all permitted" whether the cause is a
    // genuinely empty graph OR a monorepo lock-file where every entry is a workspace `link`
    // (covered by the next test) — the report cannot tell them apart, so neither gets a green
    // "всё разрешено".
    const { file, dir } = tempLock(JSON.stringify({ lockfileVersion: 3, packages: { "": {} } }));
    const out = join(dir, "report");
    const cache = join(dir, "cache");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await run(["--lock", file, "--out", out, "--cache", cache]);
      expect(code).toBe(2);
      expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(/не нашлось ни одного пакета/);
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
    expect(existsSync(join(out, "report.md"))).toBe(false);
  });

  it("lock-файл, где все записи — ссылки на workspace-пакеты (монорепо): тоже отказ, не «всё разрешено»", async () => {
    // `isRealPackage` (lockfile.mjs) excludes `link: true` entries — a workspace package resolves
    // to its own directory, not to something npm installed. A lock-file built entirely from such
    // entries produces the exact same `packages.length === 0` as a genuinely empty one, so without
    // this branch it would have sailed straight past the refusal above and printed "всё разрешено"
    // having asked the corporate system about nothing at all.
    const { file, dir } = tempLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": {},
          "node_modules/pkg-a": { resolved: "../packages/pkg-a", link: true },
          "node_modules/pkg-b": { resolved: "../packages/pkg-b", link: true },
        },
      }),
    );
    const out = join(dir, "report");
    const cache = join(dir, "cache");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await run(["--lock", file, "--out", out, "--cache", cache]);
      expect(code).toBe(2);
      expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(/не нашлось ни одного пакета/);
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
    expect(existsSync(join(out, "report.md"))).toBe(false);
  });

  it("создаёт --out и --cache сами, даже когда ни один каталог ещё не существует", async () => {
    const { file, dir } = tempLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: { "": {}, "node_modules/left-pad": { version: "1.3.0" } },
      }),
    );
    const out = join(dir, "nested", "does", "not", "exist", "yet");
    const cache = join(dir, "another", "missing", "path");
    const fakeClient = {
      findArtifacts: async (pkg: { name: string; scope: string; version: string }) => [
        { npm: { name: pkg.name, scope: pkg.scope, version: pkg.version }, state: { status: "PERMITTED" } },
      ],
      sent: () => 0,
    };
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      // Real readCached/writeCached (not overridden): this is what proves --cache gets created
      // too, not only --out. Only the network/token layer is faked.
      const code = await run(["--lock", file, "--out", out, "--cache", cache], {
        deps: { createClient: () => fakeClient, createTokenSource: () => async () => "unused" },
      });
      expect(code).toBe(0);
    } finally {
      stdout.mockRestore();
    }
    expect(existsSync(out)).toBe(true);
    expect(existsSync(cache)).toBe(true);
    expect(readFileSync(join(out, "report.md"), "utf8")).toContain("Разрешено: 1");
  });

  it("--help печатает справку и возвращает 0, не читая lock-файл и не трогая сеть", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await run(["--help", "--lock", join(tmpdir(), "deps-check-does-not-exist.json")]);
      expect(code).toBe(0);
      const text = stdout.mock.calls.map((c) => String(c[0])).join("");
      expect(text).toContain("--prod");
      expect(text).toContain("--delay");
    } finally {
      stdout.mockRestore();
    }
  });

  it("-h — короткая форма --help", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(await run(["-h"])).toBe(0);
    } finally {
      stdout.mockRestore();
    }
  });
});

describe("usageText", () => {
  it("документирует все семь флагов", () => {
    const text = usageText();
    for (const flag of ["--lock", "--out", "--cache", "--prod", "--strict-dev", "--no-cache", "--delay"]) {
      expect(text).toContain(flag);
    }
  });
});

describe("run — цикл проверки пакетов, с подставным клиентом (deps)", () => {
  /** Minimal fake `findArtifacts` response that `classify()` reads as PERMITTED. */
  function permitted(pkg: { name: string; scope: string; version: string }) {
    return [{ npm: { name: pkg.name, scope: pkg.scope, version: pkg.version }, state: { status: "PERMITTED" } }];
  }

  it("сбой входа (stopRun) останавливает прогон немедленно, а не после каждого пакета по очереди", async () => {
    const { file, dir } = tempLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": {},
          "node_modules/a": { version: "1.0.0" },
          "node_modules/b": { version: "1.0.0" },
          "node_modules/c": { version: "1.0.0" },
        },
      }),
    );
    const attempted: string[] = [];
    const fakeClient = {
      findArtifacts: async (pkg: { name: string }) => {
        attempted.push(pkg.name);
        throw Object.assign(new Error("Вход не завершён за три минуты — прогон остановлен."), { stopRun: true });
      },
    };
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await run(
        ["--lock", file, "--out", join(dir, "report"), "--cache", join(dir, "cache")],
        {
          deps: {
            createClient: () => fakeClient,
            createTokenSource: () => async () => "unused",
            readCached: () => null,
            writeCached: () => {},
          },
        },
      );
      // Only errors were recorded, nothing forbidden -> exit 2 ("run is incomplete"), not 1.
      expect(code).toBe(2);
      const text = stdout.mock.calls.map((c) => String(c[0])).join("");
      expect(text).toContain("Остановка");
      expect(text).toContain("Вход не завершён за три минуты");
    } finally {
      stdout.mockRestore();
    }
    // Stopped after the FIRST package — "b" and "c" were never even attempted.
    expect(attempted).toEqual(["a"]);
  });

  it("печатает короткую строку по каждому неудавшемуся пакету сразу, не дожидаясь конца прогона", async () => {
    const { file, dir } = tempLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: { "": {}, "node_modules/left-pad": { version: "1.3.0" } },
      }),
    );
    const fakeClient = {
      findArtifacts: async () => {
        throw new Error("сеть моргнула");
      },
    };
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await run(
        ["--lock", file, "--out", join(dir, "report"), "--cache", join(dir, "cache")],
        {
          deps: {
            createClient: () => fakeClient,
            createTokenSource: () => async () => "unused",
            readCached: () => null,
            writeCached: () => {},
          },
        },
      );
      expect(code).toBe(2);
      // A bare `.toContain("left-pad")` on the whole joined output would also pass once the
      // per-package line is gone: the failure still shows up in the final "Не удалось спросить"
      // summary block, which mentions the same name and message. The "!  " prefix is the one
      // marker unique to the LIVE line (`consoleLine` in report.mjs never writes it) — checking
      // for it is what actually tells "printed as it happened" apart from "only in the summary
      // written after the whole loop finished".
      const text = stdout.mock.calls.map((c) => String(c[0])).join("");
      expect(text).toMatch(/! left-pad@1\.3\.0 — сеть моргнула/);
    } finally {
      stdout.mockRestore();
    }
  });

  it("сбой записи кэша не превращает уже полученный ответ в «не удалось спросить»", async () => {
    const { file, dir } = tempLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: { "": {}, "node_modules/left-pad": { version: "1.3.0" } },
      }),
    );
    const out = join(dir, "report");
    const fakeClient = { findArtifacts: async (pkg: { name: string; scope: string; version: string }) => permitted(pkg), sent: () => 0 };
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await run(["--lock", file, "--out", out, "--cache", join(dir, "cache")], {
        deps: {
          createClient: () => fakeClient,
          createTokenSource: () => async () => "unused",
          readCached: () => null,
          writeCached: () => {
            throw new Error("диск занят");
          },
        },
      });
      expect(code).toBe(0);
      const text = stdout.mock.calls.map((c) => String(c[0])).join("");
      expect(text).toContain("диск занят");
    } finally {
      stdout.mockRestore();
    }
    const json = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    expect(json.summary).toMatchObject({ ok: 1, error: 0 });
    expect(json.results[0].outcome).toBe("ok");
  });

  it("отчёт и консоль несут флаги прогона и число ответов из кэша — не только дату", async () => {
    const { file, dir } = tempLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": {},
          "node_modules/a": { version: "1.0.0" },
          "node_modules/b": { version: "1.0.0" },
        },
      }),
    );
    const out = join(dir, "report");
    const fakeClient = { findArtifacts: async (pkg: { name: string; scope: string; version: string }) => permitted(pkg), sent: () => 0 };
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await run(
        ["--lock", file, "--out", out, "--cache", join(dir, "cache"), "--strict-dev"],
        {
          deps: {
            createClient: () => fakeClient,
            createTokenSource: () => async () => "unused",
            // "a" comes pre-cached, "b" is asked live — a mixed run, so `fromCache` must read 1.
            readCached: (_dir: string, pkg: { name: string; scope: string; version: string }) =>
              pkg.name === "a" ? permitted(pkg) : null,
            writeCached: () => {},
          },
        },
      );
      expect(code).toBe(0);
      const text = stdout.mock.calls.map((c) => String(c[0])).join("");
      expect(text).toContain("--strict-dev");
      expect(text).toMatch(/Из кэша: 1 из 2/);
    } finally {
      stdout.mockRestore();
    }
    const json = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    expect(json.flags).toMatchObject({ strictDev: true, prod: false, noCache: false });
    expect(json.fromCache).toBe(1);
    expect(json.cacheTtlDays).toBe(7);
  });
});
