import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { CACHE, cacheFileName, readCached, writeCached } from "../../scripts/deps/cache.mjs";

const pkg = { name: "pglite", scope: "@electric-sql", version: "0.4.1" };
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deps-cache-test-"));
});

describe("CACHE", () => {
  it("срок жизни и каталог соответствуют разделу 5 спецификации (docs/specs/tooling/deps-check.md)", () => {
    expect(CACHE).toEqual({ dir: "tmp/deps-cache", ttlMs: 7 * 24 * 60 * 60 * 1000 });
  });
});

describe("cacheFileName", () => {
  it("не оставляет в имени файла разделителей пути", () => {
    expect(cacheFileName(pkg)).toBe("@electric-sql!pglite@0.4.1.json");
  });

  it("обходится без области", () => {
    expect(cacheFileName({ name: "zod", scope: "", version: "4.4.3" })).toBe("zod@4.4.3.json");
  });
});

describe("readCached", () => {
  it("возвращает null, когда записи нет", () => {
    expect(readCached(dir, pkg, { now: 1000, ttlMs: 100 })).toBeNull();
  });

  it("возвращает сохранённое, пока не вышел срок", () => {
    writeCached(dir, pkg, [{ npm: { version: "0.4.1" } }], { now: 1000 });
    expect(readCached(dir, pkg, { now: 1500, ttlMs: 1000 })).toEqual([{ npm: { version: "0.4.1" } }]);
  });

  it("возвращает null, когда срок вышел", () => {
    writeCached(dir, pkg, [], { now: 1000 });
    expect(readCached(dir, pkg, { now: 5000, ttlMs: 1000 })).toBeNull();
  });

  it("переживает испорченный файл", () => {
    writeCached(dir, pkg, [], { now: 1000 });
    writeFileSync(join(dir, cacheFileName(pkg)), "{ это не json", "utf8");
    expect(readCached(dir, pkg, { now: 1000, ttlMs: 1000 })).toBeNull();
  });

  it("хранит вместе с ответом время записи", () => {
    writeCached(dir, pkg, [], { now: 1234 });
    expect(JSON.parse(readFileSync(join(dir, cacheFileName(pkg)), "utf8")).savedAt).toBe(1234);
  });

  it("не путает пустой массив с промахом", () => {
    writeCached(dir, pkg, [], { now: 1000 });
    expect(readCached(dir, pkg, { now: 1000, ttlMs: 1000 })).toEqual([]);
  });

  it("на границе срока (now - savedAt === ttlMs) запись ещё не протухла", () => {
    writeCached(dir, pkg, [{ npm: { version: "0.4.1" } }], { now: 1000 });
    expect(readCached(dir, pkg, { now: 2000, ttlMs: 1000 })).toEqual([{ npm: { version: "0.4.1" } }]);
  });

  it("сразу за границей срока (now - savedAt === ttlMs + 1) запись уже протухла", () => {
    writeCached(dir, pkg, [{ npm: { version: "0.4.1" } }], { now: 1000 });
    expect(readCached(dir, pkg, { now: 2001, ttlMs: 1000 })).toBeNull();
  });

  it("возвращает null, когда в файле нет savedAt (валидный JSON, чужая форма)", () => {
    writeFileSync(join(dir, cacheFileName(pkg)), JSON.stringify({ artifacts: [] }), "utf8");
    expect(readCached(dir, pkg, { now: 1000, ttlMs: 1000 })).toBeNull();
  });

  it("возвращает null, когда savedAt есть, а artifacts нет", () => {
    writeFileSync(join(dir, cacheFileName(pkg)), JSON.stringify({ savedAt: 1000 }), "utf8");
    expect(readCached(dir, pkg, { now: 1000, ttlMs: 1000 })).toBeNull();
  });

  it("без ttlMs использует срок из CACHE.ttlMs", () => {
    writeCached(dir, pkg, [{ npm: { version: "0.4.1" } }], { now: 1000 });
    expect(readCached(dir, pkg, { now: 1000 + CACHE.ttlMs })).toEqual([{ npm: { version: "0.4.1" } }]);
    expect(readCached(dir, pkg, { now: 1000 + CACHE.ttlMs + 1 })).toBeNull();
  });

  it("подметает протухшую запись с диска, а не только скрывает её", () => {
    writeCached(dir, pkg, [], { now: 1000 });
    const file = join(dir, cacheFileName(pkg));
    expect(existsSync(file)).toBe(true);
    readCached(dir, pkg, { now: 5000, ttlMs: 1000 });
    expect(existsSync(file)).toBe(false);
  });

  it("не подметает свежую запись", () => {
    writeCached(dir, pkg, [], { now: 1000 });
    const file = join(dir, cacheFileName(pkg));
    readCached(dir, pkg, { now: 1500, ttlMs: 1000 });
    expect(existsSync(file)).toBe(true);
  });
});

describe("writeCached — атомарность", () => {
  it("не оставляет временный файл после успешной записи", () => {
    writeCached(dir, pkg, [], { now: 1000 });
    const leftovers = readdirSync(dir).filter((name) => name.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("итоговый файл называется как cacheFileName, а не как временный", () => {
    writeCached(dir, pkg, [], { now: 1000 });
    expect(readdirSync(dir)).toEqual([cacheFileName(pkg)]);
  });

  // `vi.mock("node:fs", ...)` cannot see calls made from scripts/deps/*.mjs in this project's
  // Vitest setup (verified directly: a plain sibling .mjs module never observes the mocked
  // export, while a .ts module does — Vite does not route these non-transformed ESM scripts
  // through the same module graph vi.mock intercepts). So the write path is pinned by real
  // filesystem behaviour instead: occupying the exact `<file>.tmp` path with a directory
  // forces `writeCached` to fail if, and only if, it actually writes through that path first.
  it("пишет во временный файл `<file>.tmp`, а не прямо в целевой файл", () => {
    const file = join(dir, cacheFileName(pkg));
    const tmp = `${file}.tmp`;
    mkdirSync(tmp);
    expect(() => writeCached(dir, pkg, [], { now: 1000 })).toThrow();
    expect(existsSync(file)).toBe(false);
  });
});

describe("cacheFileName — коллизия исключена", () => {
  it("scope+name и name с прежним разделителем внутри дают РАЗНЫЕ имена", () => {
    const scoped = { name: "b", scope: "@a", version: "1.0.0" };
    const flattened = { name: "a__b", scope: "", version: "1.0.0" };
    expect(cacheFileName(scoped)).not.toBe(cacheFileName(flattened));
  });

  it("два РАЗНЫХ scoped-пакета с `!` внутри имени тоже не совпадают", () => {
    const a = { scope: "@a", name: "b!c", version: "1.0.0" };
    const b = { scope: "@a!b", name: "c", version: "1.0.0" };
    expect(cacheFileName(a)).not.toBe(cacheFileName(b));
  });
});
