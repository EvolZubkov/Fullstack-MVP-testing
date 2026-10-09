import { describe, expect, it } from "vitest";
import { parseLockfile, resolveDependencyKey, splitScope } from "../../scripts/deps/lockfile.mjs";

describe("splitScope", () => {
  it("отделяет область от имени", () => {
    expect(splitScope("@electric-sql/pglite")).toEqual({ scope: "@electric-sql", name: "pglite" });
  });

  it("оставляет область пустой у обычного пакета", () => {
    expect(splitScope("express")).toEqual({ scope: "", name: "express" });
  });

  it("без слэша область остаётся пустой, а имя — дословным", () => {
    expect(splitScope("@scope")).toEqual({ scope: "", name: "@scope" });
  });
});

describe("resolveDependencyKey", () => {
  const packages = {
    "": {},
    "node_modules/a": { version: "1.0.0" },
    "node_modules/a/node_modules/b": { version: "2.0.0" },
    "node_modules/b": { version: "3.0.0" },
    "node_modules/a/node_modules/@scope/c": { version: "1.0.0" },
  };

  it("предпочитает вложенную копию", () => {
    expect(resolveDependencyKey(packages, "node_modules/a", "b")).toBe("node_modules/a/node_modules/b");
  });

  it("поднимается к верхнему уровню, когда вложенной копии нет", () => {
    expect(resolveDependencyKey(packages, "node_modules/a/node_modules/b", "a")).toBe("node_modules/a");
  });

  it("возвращает null для неизвестного имени", () => {
    expect(resolveDependencyKey(packages, "node_modules/a", "zzz")).toBeNull();
  });

  it("находит вложенную scoped-копию", () => {
    expect(resolveDependencyKey(packages, "node_modules/a", "@scope/c")).toBe(
      "node_modules/a/node_modules/@scope/c",
    );
  });
});

describe("parseLockfile: базовый разбор", () => {
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": { name: "root", dependencies: { express: "^5.0.0" }, devDependencies: { vitest: "^4.0.0" } },
      "node_modules/express": {
        version: "5.2.1",
        resolved: "https://x/express-5.2.1.tgz",
        dependencies: { "@scope/dep": "^1.0.0" },
      },
      "node_modules/@scope/dep": { version: "1.1.0", resolved: "https://x/dep-1.1.0.tgz" },
      "node_modules/vitest": { version: "4.0.1", resolved: "https://x/vitest-4.0.1.tgz", dev: true },
      // Carries a version on purpose: a link is excluded because it IS a link, not because it
      // happens to lack a version — this pins the `link` branch on its own.
      "node_modules/linked": { link: true, version: "9.9.9", resolved: "vendor/linked" },
    },
  };

  it("возвращает по записи на пакет, минуя корень и ссылки", () => {
    const pkgs = parseLockfile(lock);
    expect(pkgs.map((p) => p.id).sort()).toEqual(["@scope/dep@1.1.0", "express@5.2.1", "vitest@4.0.1"]);
  });

  it("помечает dev-пакеты", () => {
    const pkgs = parseLockfile(lock);
    expect(pkgs.find((p) => p.name === "vitest")?.dev).toBe(true);
    expect(pkgs.find((p) => p.name === "express")?.dev).toBe(false);
  });

  it("разбирает область отдельно от имени", () => {
    const dep = parseLockfile(lock).find((p) => p.name === "dep");
    expect(dep).toMatchObject({ scope: "@scope", name: "dep", version: "1.1.0" });
  });

  it("запоминает, кто тянет пакет", () => {
    const pkgs = parseLockfile(lock, { rootName: "проект" });
    expect(pkgs.find((p) => p.name === "express")?.requiredBy).toEqual(["проект"]);
    expect(pkgs.find((p) => p.name === "dep")?.requiredBy).toEqual(["express@5.2.1"]);
  });

  it("не несёт служебное поле key наружу", () => {
    for (const pkg of parseLockfile(lock)) expect(pkg).not.toHaveProperty("key");
  });
});

describe("parseLockfile: alias-установки", () => {
  it("берёт имя пакета из entry.name, а не из ключа-алиаса", () => {
    // npm writes an aliased install (`npm:real-name@range`) under the ALIAS as the tree key,
    // with the real name in entry.name. Reading the name off the key would ask the corporate
    // API about a package that does not exist under that name and get zero records back —
    // read as "forbidden" for a package that was never even asked about correctly.
    const lock = {
      lockfileVersion: 3,
      packages: {
        "": { name: "root", dependencies: { "string-width-cjs": "npm:string-width@^4.2.3" } },
        "node_modules/string-width-cjs": {
          name: "string-width",
          version: "4.2.3",
          resolved: "https://x/string-width-4.2.3.tgz",
        },
      },
    };
    const pkgs = parseLockfile(lock, { rootName: "проект" });
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0]).toMatchObject({
      id: "string-width@4.2.3",
      name: "string-width",
      scope: "",
      requiredBy: ["проект"],
    });
  });
});

describe("parseLockfile: записи без version не участвуют как родитель", () => {
  it("не порождает requiredBy вида ...@undefined", () => {
    // An optional dependency npm skipped on this platform stays in the lockfile without a
    // `version` and without `link` either — a phantom entry the first pass already drops.
    // The second pass has to drop it too, or its OWN dependencies get attributed to a
    // "parent" that does not really exist.
    const lock = {
      lockfileVersion: 3,
      packages: {
        "": { name: "root", dependencies: { ghost: "^1.0.0" } },
        "node_modules/ghost": { optional: true, dependencies: { real: "^1.0.0" } },
        "node_modules/real": { version: "1.0.0", resolved: "https://x/real.tgz" },
      },
    };
    const pkgs = parseLockfile(lock);
    expect(pkgs.map((p) => p.id)).toEqual(["real@1.0.0"]);
    expect(pkgs.find((p) => p.name === "real")?.requiredBy).toEqual([]);
  });
});

describe("parseLockfile: дубль prod+dev по разным путям в дереве", () => {
  function lockWith(order: "dev-first" | "prod-first") {
    const devEntry = { version: "1.0.0", resolved: "https://x/d.tgz", dev: true };
    const prodEntry = { version: "1.0.0", resolved: "https://x/p.tgz" };
    const packages: Record<string, unknown> = { "": { name: "root" } };
    if (order === "dev-first") {
      packages["node_modules/a/node_modules/dup"] = devEntry;
      packages["node_modules/dup"] = prodEntry;
    } else {
      packages["node_modules/dup"] = prodEntry;
      packages["node_modules/a/node_modules/dup"] = devEntry;
    }
    return { lockfileVersion: 3, packages };
  }

  it("dev-копия раньше в объекте — итог всё равно прод", () => {
    expect(parseLockfile(lockWith("dev-first")).find((p) => p.name === "dup")?.dev).toBe(false);
  });

  it("прод-копия раньше в объекте — итог прод", () => {
    expect(parseLockfile(lockWith("prod-first")).find((p) => p.name === "dup")?.dev).toBe(false);
  });
});

describe("parseLockfile: пакет не тянет сам себя", () => {
  it("самоссылка не попадает в requiredBy", () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        "": { name: "root" },
        "node_modules/x": { version: "1.0.0", resolved: "https://x/x.tgz", dependencies: { x: "^1.0.0" } },
      },
    };
    expect(parseLockfile(lock).find((p) => p.name === "x")?.requiredBy).toEqual([]);
  });
});

describe("parseLockfile: одна связь не дублируется", () => {
  it("зависимость, объявленная в двух видах сразу, засчитывается один раз", () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        "": { name: "root" },
        "node_modules/parent": {
          version: "1.0.0",
          resolved: "https://x/parent.tgz",
          dependencies: { child: "^1.0.0" },
          optionalDependencies: { child: "^1.0.0" },
        },
        "node_modules/child": { version: "1.0.0", resolved: "https://x/child.tgz" },
      },
    };
    expect(parseLockfile(lock).find((p) => p.name === "child")?.requiredBy).toEqual(["parent@1.0.0"]);
  });
});

describe("parseLockfile: зависимость отсутствует в lock-файле", () => {
  it("не падает и не добавляет фантомную запись", () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        "": { name: "root", dependencies: { "nowhere-to-be-found": "^1.0.0" } },
        "node_modules/real": { version: "1.0.0", resolved: "https://x/real.tgz" },
      },
    };
    expect(() => parseLockfile(lock)).not.toThrow();
    expect(parseLockfile(lock).map((p) => p.id)).toEqual(["real@1.0.0"]);
  });
});

describe("parseLockfile: peerDependencies не образуют рёбра", () => {
  it("peer-пакет не попадает в requiredBy того, кто его только ожидает", () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        "": { name: "root" },
        "node_modules/host": {
          version: "1.0.0",
          resolved: "https://x/host.tgz",
          peerDependencies: { react: "^19.0.0" },
        },
        "node_modules/react": { version: "19.0.0", resolved: "https://x/react.tgz" },
      },
    };
    expect(parseLockfile(lock).find((p) => p.name === "react")?.requiredBy).toEqual([]);
  });
});

describe("parseLockfile: optionalDependencies остаются реальным ребром", () => {
  it("опциональная зависимость попадает в requiredBy", () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        "": { name: "root" },
        "node_modules/host": {
          version: "1.0.0",
          resolved: "https://x/host.tgz",
          optionalDependencies: { fsevents: "^2.0.0" },
        },
        "node_modules/fsevents": { version: "2.0.0", resolved: "https://x/fsevents.tgz" },
      },
    };
    expect(parseLockfile(lock).find((p) => p.name === "fsevents")?.requiredBy).toEqual(["host@1.0.0"]);
  });
});

describe("parseLockfile: проверка входа", () => {
  it("падает на lockfileVersion, отличном от 3", () => {
    const lock = { lockfileVersion: 1, dependencies: { express: { version: "5.0.0" } } };
    expect(() => parseLockfile(lock)).toThrow(/версии 3/);
  });

  it("падает, когда раздела packages нет вовсе", () => {
    expect(() => parseLockfile({ lockfileVersion: 3 })).toThrow(/packages/);
  });

  it("падает, когда packages пуст", () => {
    expect(() => parseLockfile({ lockfileVersion: 3, packages: {} })).toThrow(/packages/);
  });
});
