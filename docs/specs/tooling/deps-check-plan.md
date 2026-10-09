# План реализации: проверка допустимости зависимостей

> **Для исполнителя:** реализовывать по задачам, каждая задача — отдельный коммит. Шаги отмечены
> чекбоксами. Работать в отдельной ветке `feat/deps-check`, ветвясь от `main`: текущая рабочая ветка
> занята другой темой.

**Цель:** команда `npm run deps:check` спрашивает у корпоративной системы repository.rt.ru, разрешён
ли каждый пакет из `package-lock.json`, и выдаёт отчёт с ненулевым кодом возврата при находке.

**Архитектура:** шесть модулей в `scripts/deps/` с явными границами. Разбор lock-файла,
классификация ответа, темп запросов, кэш и отчёт — чистые функции, проверяемые обычным `npm test`.
Сеть и браузер вынесены в два тонких модуля без решений внутри.

**Стек:** Node 24 (глобальные `fetch` и `WebSocket`), ESM-модули `.mjs` без сборки, vitest для
тестов, Chrome DevTools Protocol для входа. Новых зависимостей нет и не появится.

**Спецификация:** `docs/specs/tooling/deps-check.md`. Все решения — оттуда; расхождения между планом
и спекой считать ошибкой плана.

> **Работа завершена.** Приведённые ниже фрагменты кода — ЧЕРНОВИКИ, с которых начиналась каждая
> задача. В ходе работы ревью нашло в них дефекты, и готовый код в репозитории от них отличается.
> Правильным считать то, что лежит в `scripts/deps/`, а не текст этого плана. Перечень отличий — в
> разделе «Итог работы» в конце документа; у задачи 1 есть свой такой раздел, потому что она была
> переписана целиком.

---

## Структура файлов

| Файл | Ответственность |
| --- | --- |
| `scripts/deps/lockfile.mjs` | `package-lock.json` -> плоский список пакетов с обратным графом |
| `scripts/deps/classify.mjs` | ответ API -> исход по пакету |
| `scripts/deps/pace.mjs` | выдержки: пауза между запросами, повторы, передышки |
| `scripts/deps/cache.mjs` | кэш ответов на диске со сроком жизни |
| `scripts/deps/repo-client.mjs` | запросы `findArtifacts`: заголовки, пагинация, повторы |
| `scripts/deps/repo-auth.mjs` | токен: кэш, обновление, вход через браузер |
| `scripts/deps/check-allowed.mjs` | CLI: аргументы, оркестрация, код возврата |
| `scripts/deps/report.mjs` | консоль, Markdown, JSON |

Тесты — в подкаталоге `tests/deps/`, как уже сделано для инструментов в `tests/editor-conformance/`:
`tests/deps/lockfile.test.ts` и далее. Шесть файлов россыпью в корне `tests/`, где и так лежит три с
лишним сотни, ничего бы не прояснили.

Тесты — обычные `.ts`, как весь остальной набор. Редактор будет показывать на импорте `.mjs` ошибку
«не найден модуль»: `tsconfig.json` не покрывает ни `scripts/`, ни `tests/`, так что `tsc` этих
файлов не видит и `npm run check` остаётся зелёным. Проект уже живёт с этим в
`tests/editor-conformance/diff.test.ts` и `tests/scorm-debug-player-assets.test.ts`; заводить ради
инструмента второе соглашение по расширениям не нужно.

---

## Задача 1: разбор lock-файла

**Файлы:**

- Создать: `scripts/deps/lockfile.mjs`
- Тест: `tests/deps/lockfile.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { parseLockfile, resolveDependencyKey, splitScope } from "../scripts/deps/lockfile.mjs";

describe("splitScope", () => {
  it("отделяет область от имени", () => {
    expect(splitScope("@electric-sql/pglite")).toEqual({ scope: "@electric-sql", name: "pglite" });
  });

  it("оставляет область пустой у обычного пакета", () => {
    expect(splitScope("express")).toEqual({ scope: "", name: "express" });
  });
});

describe("resolveDependencyKey", () => {
  const packages = {
    "": {},
    "node_modules/a": { version: "1.0.0" },
    "node_modules/a/node_modules/b": { version: "2.0.0" },
    "node_modules/b": { version: "3.0.0" },
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
});

describe("parseLockfile", () => {
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": { name: "root", dependencies: { express: "^5.0.0" }, devDependencies: { vitest: "^4.0.0" } },
      "node_modules/express": { version: "5.2.1", resolved: "https://x/express-5.2.1.tgz", dependencies: { "@scope/dep": "^1.0.0" } },
      "node_modules/@scope/dep": { version: "1.1.0", resolved: "https://x/dep-1.1.0.tgz" },
      "node_modules/vitest": { version: "4.0.1", resolved: "https://x/vitest-4.0.1.tgz", dev: true },
      "node_modules/linked": { link: true, resolved: "vendor/linked" },
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
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npm test -- tests/deps/lockfile.test.ts`

Ожидается: FAIL, `Failed to load ../scripts/deps/lockfile.mjs`.

- [ ] **Шаг 3: написать модуль**

```js
/**
 * @module scripts/deps/lockfile
 * @description Turns an npm lockfile (lockfileVersion 3) into the flat list of distinct
 * packages the allowance check asks about, each carrying the chain that pulls it in.
 *
 * Two things here are not decoration. Scope is split off the name because the corporate API
 * takes it as a SEPARATE field — `@electric-sql/pglite` searched as one string finds nothing,
 * which reads exactly like "forbidden". And the reverse graph exists because a forbidden
 * transitive dependency cannot simply be removed: the report has to name who pulls it.
 */

const NM = "node_modules/";

/** Package name as written in the manifest, taken off a lockfile key. */
export function packageNameFromKey(key) {
  const at = key.lastIndexOf(NM);
  return at === -1 ? key : key.slice(at + NM.length);
}

/**
 * Splits `@scope/name` into its parts.
 * @param {string} fullName Name as npm writes it.
 * @returns {{scope: string, name: string}} Scope keeps its `@`; it is empty for plain packages.
 */
export function splitScope(fullName) {
  if (!fullName.startsWith("@")) return { scope: "", name: fullName };
  const slash = fullName.indexOf("/");
  if (slash === -1) return { scope: "", name: fullName };
  return { scope: fullName.slice(0, slash), name: fullName.slice(slash + 1) };
}

/**
 * Finds which lockfile entry a dependency of `parentKey` resolves to, following npm's own
 * rule: the nested copy wins, otherwise walk up towards the root.
 *
 * @param {Record<string, object>} packages The lockfile `packages` map.
 * @param {string} parentKey Key of the dependent entry (`""` for the project root).
 * @param {string} depName Dependency name, scope included.
 * @returns {string|null} Key of the resolved entry, or null when the lockfile has no such copy.
 */
export function resolveDependencyKey(packages, parentKey, depName) {
  let prefix = parentKey;
  for (;;) {
    const candidate = prefix ? `${prefix}/${NM}${depName}` : `${NM}${depName}`;
    if (Object.hasOwn(packages, candidate)) return candidate;
    if (!prefix) return null;
    const cut = prefix.lastIndexOf(NM);
    prefix = cut <= 0 ? "" : prefix.slice(0, cut - 1);
  }
}

/** Stable identifier of a lockfile entry: `@scope/name@version`. */
function idOf(key, entry) {
  return `${packageNameFromKey(key)}@${entry.version}`;
}

/** Every dependency name an entry declares, across all four kinds. */
function declaredDependencies(entry) {
  return [
    ...Object.keys(entry.dependencies ?? {}),
    ...Object.keys(entry.devDependencies ?? {}),
    ...Object.keys(entry.optionalDependencies ?? {}),
    ...Object.keys(entry.peerDependencies ?? {}),
  ];
}

/**
 * Reads the lockfile into distinct packages.
 *
 * A package installed both as a dependency and a devDependency counts as production: the
 * stricter reading is the safe one, because that copy does ship.
 *
 * @param {object} lock Parsed `package-lock.json`.
 * @param {{rootName?: string}} [options] What to call the project itself in `requiredBy`.
 * @returns {Array<{id: string, key: string, name: string, scope: string, version: string,
 *   dev: boolean, requiredBy: string[]}>}
 */
export function parseLockfile(lock, { rootName = "проект" } = {}) {
  const packages = lock.packages ?? {};
  const byId = new Map();

  for (const [key, entry] of Object.entries(packages)) {
    if (key === "" || entry.link || !entry.version) continue;
    const { scope, name } = splitScope(packageNameFromKey(key));
    const id = idOf(key, entry);
    const seen = byId.get(id);
    if (seen) {
      if (entry.dev !== true) seen.dev = false;
      continue;
    }
    byId.set(id, { id, key, name, scope, version: entry.version, dev: entry.dev === true, requiredBy: [] });
  }

  for (const [key, entry] of Object.entries(packages)) {
    if (entry.link) continue;
    const parentId = key === "" ? rootName : idOf(key, entry);
    for (const depName of declaredDependencies(entry)) {
      const depKey = resolveDependencyKey(packages, key, depName);
      if (!depKey) continue;
      const dep = byId.get(idOf(depKey, packages[depKey]));
      if (dep && dep.id !== parentId && !dep.requiredBy.includes(parentId)) dep.requiredBy.push(parentId);
    }
  }

  return [...byId.values()];
}
```

- [ ] **Шаг 4: убедиться, что тест проходит**

Выполнить: `npm test -- tests/deps/lockfile.test.ts`

Ожидается: PASS, 9 тестов.

- [ ] **Шаг 5: коммит**

```bash
git add scripts/deps/lockfile.mjs tests/deps/lockfile.test.ts
git commit -m "feat(deps): разбор package-lock.json для проверки допустимости"
```

### Итог: чем готовый модуль отличается от текста выше

Ревью нашло в приведённом коде шесть дефектов; итоговый `scripts/deps/lockfile.mjs` отличается от
черновика выше, и правильным считать следует код в репозитории. Что изменилось и почему:

- **Имя пакета берётся из `entry.name`, а не из ключа.** Alias-установку (`"string-width-cjs":
  "npm:string-width@^4"`) npm ключует по alias, настоящее имя кладёт в `entry.name`. В этом
  проекте таких записей три, все продакшен. Черновик спросил бы систему про `string-width-cjs`,
  получил пустой ответ и объявил три ложных запрета — ровно ловушка из §2.2 спеки. Поиск внутри
  `resolveDependencyKey` при этом остаётся ПО КЛЮЧУ: там ищется место в дереве, а не имя.
- **Единый предикат `isRealPackage` в обоих проходах.** Черновик фильтровал записи без `version`
  только в первом цикле, и такая запись становилась «родителем» с идентификатором `name@undefined`.
- **Проверка входа.** `lockfileVersion !== 3` или пустой `packages` теперь дают внятную ошибку.
  Раньше выходил пустой список, то есть «проверено 0 пакетов, всё разрешено, код возврата 0» —
  худший исход для инструмента, вся ценность которого в вердикте: падение заметят, зелёный ноль нет.
- **`peerDependencies` исключены** из графа «кто тянет»: они заявляют требование совместимости, а не
  то, что запись тянет за собой. На этом lock-файле они давали 61 несуществующее ребро.
- **Поле `key` убрано** из выходной формы: после дедупликации по `id` оно хранило ключ лишь первой
  встреченной копии.
- **Тестов стало 24 вместо 9.** Прежние девять описывали поведение, но не удерживали его: пять
  мутаций из пяти (убрать фильтр `link`, убрать слияние dev/прод, убрать обе защиты `requiredBy`,
  свернуть виды зависимостей, изменить подъём по дереву) оставляли набор зелёным.

---

## Задача 2: классификация ответа

**Файлы:**

- Создать: `scripts/deps/classify.mjs`
- Тест: `tests/deps/classify.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { OUTCOME, classify, matchArtifact } from "../scripts/deps/classify.mjs";

const pkg = { id: "zod@4.4.3", name: "zod", scope: "", version: "4.4.3", dev: false, requiredBy: ["проект"] };

function artifact(version: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    npm: { name: "zod", scope: "", version },
    state: { status, zone: "MAIN", comment: "", ...extra },
    alerts: [],
  };
}

describe("matchArtifact", () => {
  it("не принимает 4.4.30 за 4.4.3", () => {
    expect(matchArtifact([artifact("4.4.30", "PERMITTED")], pkg)).toBeNull();
  });

  it("находит запись со строго той же версией", () => {
    const found = matchArtifact([artifact("4.4.30", "RESTRICTED"), artifact("4.4.3", "PERMITTED")], pkg);
    expect(found?.state.status).toBe("PERMITTED");
  });

  it("различает область", () => {
    const scoped = { ...pkg, scope: "@other" };
    expect(matchArtifact([artifact("4.4.3", "PERMITTED")], scoped)).toBeNull();
  });
});

describe("classify", () => {
  it("разрешённый пакет — норма", () => {
    expect(classify(pkg, [artifact("4.4.3", "PERMITTED")])).toMatchObject({ outcome: OUTCOME.OK, status: "PERMITTED" });
  });

  it("запрещённый пакет — провал", () => {
    expect(classify(pkg, [artifact("4.4.3", "RESTRICTED")])).toMatchObject({ outcome: OUTCOME.BLOCK });
  });

  it("пустой ответ — отсутствие в базе, а не запрет", () => {
    expect(classify(pkg, [])).toMatchObject({ outcome: OUTCOME.BLOCK, status: "ABSENT" });
  });

  it("частичное разрешение — предупреждение с комментарием системы", () => {
    const result = classify(pkg, [artifact("4.4.3", "PARTIALLY_PERMITTED", { comment: "только в изоляции" })]);
    expect(result).toMatchObject({ outcome: OUTCOME.WARN, comment: "только в изоляции" });
  });

  it.each(["REQUESTED", "VERIFICATION", "NOTFOUND", "UNCHECKABLE", "UNDEFINED"])(
    "статус %s — предупреждение",
    (status) => {
      expect(classify(pkg, [artifact("4.4.3", status)]).outcome).toBe(OUTCOME.WARN);
    },
  );

  it("неизвестный статус предупреждает и сохраняет его дословно", () => {
    const result = classify(pkg, [artifact("4.4.3", "SOMETHING_NEW")]);
    expect(result).toMatchObject({ outcome: OUTCOME.WARN, status: "SOMETHING_NEW", known: false });
  });

  it("переносит зону и уязвимости в исход", () => {
    const withAlert = artifact("4.4.3", "PERMITTED", { zone: "ISOLATED" });
    withAlert.alerts = [{ severity: "HIGH", vulnerabilityId: "CVE-2026-1" }];
    expect(classify(pkg, [withAlert])).toMatchObject({ zone: "ISOLATED", alerts: [{ severity: "HIGH" }] });
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npm test -- tests/deps/classify.test.ts`

Ожидается: FAIL, модуль не найден.

- [ ] **Шаг 3: написать модуль**

```js
/**
 * @module scripts/deps/classify
 * @description Turns one findArtifacts response into a verdict about one package.
 *
 * The API matches a version as a PREFIX: asking for `4.4.3` also returns `4.4.30`. Taking the
 * first record of the answer would therefore let a neighbouring version decide the fate of
 * ours, so the verdict is only ever read off a record whose version matches exactly.
 *
 * An empty answer means the package is absent from the corporate base and has to be requested.
 * That is not the same as a ban, and the report says so in different words — but it blocks a
 * build just as surely, so both count as a failure.
 */

/** @enum {string} */
export const OUTCOME = { OK: "ok", WARN: "warn", BLOCK: "block", ERROR: "error" };

/**
 * How each known status maps onto an outcome. A status missing from this table is NOT treated
 * as permission: the vocabulary was recovered from the client bundle, not from documentation,
 * so an unfamiliar value means we learned something, and the report must show it.
 */
const STATUS_OUTCOME = {
  PERMITTED: OUTCOME.OK,
  RESTRICTED: OUTCOME.BLOCK,
  PARTIALLY_PERMITTED: OUTCOME.WARN,
  REQUESTED: OUTCOME.WARN,
  VERIFICATION: OUTCOME.WARN,
  NOTFOUND: OUTCOME.WARN,
  UNCHECKABLE: OUTCOME.WARN,
  UNDEFINED: OUTCOME.WARN,
};

/**
 * Finds the record that is exactly this package, or null.
 *
 * @param {Array<object>} artifacts Records from `findArtifacts`.
 * @param {{name: string, scope: string, version: string}} pkg
 * @returns {object|null}
 */
export function matchArtifact(artifacts, pkg) {
  const wanted = pkg.scope ?? "";
  return (
    (artifacts ?? []).find(
      (a) => a?.npm?.name === pkg.name && (a?.npm?.scope ?? "") === wanted && a?.npm?.version === pkg.version,
    ) ?? null
  );
}

/**
 * @param {object} pkg Package as produced by `parseLockfile`.
 * @param {Array<object>} artifacts Records from `findArtifacts`.
 * @returns {{id: string, name: string, scope: string, version: string, dev: boolean,
 *   requiredBy: string[], outcome: string, status: string, known: boolean, zone: string|null,
 *   comment: string, alerts: object[]}}
 */
export function classify(pkg, artifacts) {
  const base = {
    id: pkg.id,
    name: pkg.name,
    scope: pkg.scope,
    version: pkg.version,
    dev: pkg.dev,
    requiredBy: pkg.requiredBy ?? [],
  };
  const matched = matchArtifact(artifacts, pkg);
  if (!matched) {
    return { ...base, outcome: OUTCOME.BLOCK, status: "ABSENT", known: true, zone: null, comment: "", alerts: [] };
  }
  const status = matched.state?.status ?? "UNDEFINED";
  return {
    ...base,
    outcome: STATUS_OUTCOME[status] ?? OUTCOME.WARN,
    status,
    known: Object.hasOwn(STATUS_OUTCOME, status),
    zone: matched.state?.zone ?? null,
    comment: matched.state?.comment ?? "",
    alerts: matched.alerts ?? [],
  };
}

/**
 * Outcome for a package we failed to ask about at all.
 * @param {object} pkg
 * @param {Error} error
 */
export function failed(pkg, error) {
  return {
    id: pkg.id,
    name: pkg.name,
    scope: pkg.scope,
    version: pkg.version,
    dev: pkg.dev,
    requiredBy: pkg.requiredBy ?? [],
    outcome: OUTCOME.ERROR,
    status: "ERROR",
    known: true,
    zone: null,
    comment: error.message,
    alerts: [],
  };
}
```

- [ ] **Шаг 4: убедиться, что тест проходит**

Выполнить: `npm test -- tests/deps/classify.test.ts`

Ожидается: PASS, 14 тестов.

- [ ] **Шаг 5: коммит**

```bash
git add scripts/deps/classify.mjs tests/deps/classify.test.ts
git commit -m "feat(deps): классификация ответа системы контроля"
```

---

## Задача 3: темп запросов

**Файлы:**

- Создать: `scripts/deps/pace.mjs`
- Тест: `tests/deps/pace.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { jitteredDelay, longPauseMs, retryDelayMs } from "../scripts/deps/pace.mjs";

describe("jitteredDelay", () => {
  it("добавляет к базовой паузе случайную часть разброса", () => {
    expect(jitteredDelay(500, 200, () => 0)).toBe(500);
    expect(jitteredDelay(500, 200, () => 0.5)).toBe(600);
  });
});

describe("retryDelayMs", () => {
  it("уважает Retry-After в секундах", () => {
    expect(retryDelayMs(0, "3")).toBe(3000);
  });

  it("удваивает выдержку без Retry-After", () => {
    expect(retryDelayMs(0, null)).toBe(2000);
    expect(retryDelayMs(1, null)).toBe(4000);
    expect(retryDelayMs(2, null)).toBe(8000);
  });

  it("не превышает минуту", () => {
    expect(retryDelayMs(10, null)).toBe(60000);
    expect(retryDelayMs(0, "3600")).toBe(60000);
  });

  it("игнорирует нечисловой Retry-After", () => {
    expect(retryDelayMs(0, "Wed, 21 Oct 2026 07:28:00 GMT")).toBe(2000);
  });
});

describe("longPauseMs", () => {
  it("даёт передышку каждые пятьдесят запросов", () => {
    expect(longPauseMs(0)).toBe(0);
    expect(longPauseMs(49)).toBe(0);
    expect(longPauseMs(50)).toBe(5000);
    expect(longPauseMs(100)).toBe(5000);
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npm test -- tests/deps/pace.test.ts`

Ожидается: FAIL, модуль не найден.

- [ ] **Шаг 3: написать модуль**

```js
/**
 * @module scripts/deps/pace
 * @description How long to wait before the next request to the corporate system.
 *
 * This tool talks to somebody else's production system under a live person's account. Several
 * hundred requests arriving as fast as the network allows look exactly like an attack, and an
 * account is far easier to get blocked than unblocked. So the pace is deliberately timid, the
 * numbers live here rather than scattered through the client, and persistence after a refusal
 * is capped: three failures in a row stop the run, because pushing on is precisely the
 * behaviour that defences are built to punish.
 */

const BASE_DELAY_MS = 500;
const JITTER_MS = 200;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60000;
const LONG_PAUSE_EVERY = 50;
const LONG_PAUSE_MS = 5000;

/**
 * Pause before an ordinary request: a fixed part plus a random one, so the requests do not
 * arrive on a perfectly even machine grid.
 *
 * @param {number} [baseMs]
 * @param {number} [spreadMs]
 * @param {() => number} [random] Injected for tests.
 * @returns {number} Milliseconds to sleep.
 */
export function jitteredDelay(baseMs = BASE_DELAY_MS, spreadMs = JITTER_MS, random = Math.random) {
  return baseMs + Math.floor(random() * spreadMs);
}

/**
 * Pause after a refusal (429 or 503).
 *
 * @param {number} attempt Zero-based retry number.
 * @param {string|null} retryAfter Value of the `Retry-After` header, if the server sent one.
 * @returns {number} Milliseconds to sleep, never more than a minute.
 */
export function retryDelayMs(attempt, retryAfter) {
  const seconds = Number.parseInt(retryAfter ?? "", 10);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, RETRY_MAX_MS);
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
}

/**
 * Extra breather every fiftieth request.
 *
 * @param {number} index Zero-based index of the request about to be sent.
 * @returns {number} Milliseconds to sleep, usually zero.
 */
export function longPauseMs(index, { every = LONG_PAUSE_EVERY, pauseMs = LONG_PAUSE_MS } = {}) {
  return index > 0 && index % every === 0 ? pauseMs : 0;
}

/** Promise that resolves after `ms`. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Шаг 4: убедиться, что тест проходит**

Выполнить: `npm test -- tests/deps/pace.test.ts`

Ожидается: PASS, 6 тестов.

- [ ] **Шаг 5: коммит**

```bash
git add scripts/deps/pace.mjs tests/deps/pace.test.ts
git commit -m "feat(deps): щадящий темп обращений к системе контроля"
```

---

## Задача 4: кэш ответов

**Файлы:**

- Создать: `scripts/deps/cache.mjs`
- Тест: `tests/deps/cache.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { cacheFileName, readCached, writeCached } from "../scripts/deps/cache.mjs";

const pkg = { name: "pglite", scope: "@electric-sql", version: "0.4.1" };
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deps-cache-test-"));
});

describe("cacheFileName", () => {
  it("не оставляет в имени файла разделителей пути", () => {
    expect(cacheFileName(pkg)).toBe("electric-sql__pglite@0.4.1.json");
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
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npm test -- tests/deps/cache.test.ts`

Ожидается: FAIL, модуль не найден.

- [ ] **Шаг 3: написать модуль**

```js
/**
 * @module scripts/deps/cache
 * @description On-disk cache of findArtifacts answers, one file per package version.
 *
 * The cache is what makes the timid pace affordable: a full run costs minutes, a repeat run
 * costs only the packages whose version changed. A corrupt file is treated as a miss rather
 * than an error — a cache that can break the tool is worse than no cache.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Cache file name; the scope's `@` and `/` would otherwise become path separators. */
export function cacheFileName(pkg) {
  const scope = pkg.scope ? `${pkg.scope.replace("@", "")}__` : "";
  return `${scope}${pkg.name}@${pkg.version}.json`;
}

/**
 * @param {string} dir Cache directory.
 * @param {{name: string, scope: string, version: string}} pkg
 * @param {{now: number, ttlMs: number}} options
 * @returns {Array<object>|null} Cached artifacts, or null on a miss, a stale or a broken entry.
 */
export function readCached(dir, pkg, { now, ttlMs }) {
  const file = join(dir, cacheFileName(pkg));
  if (!existsSync(file)) return null;
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    if (typeof saved.savedAt !== "number" || now - saved.savedAt > ttlMs) return null;
    return saved.artifacts ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {string} dir Cache directory; created when missing.
 * @param {{name: string, scope: string, version: string}} pkg
 * @param {Array<object>} artifacts
 * @param {{now: number}} options
 */
export function writeCached(dir, pkg, artifacts, { now }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, cacheFileName(pkg)), JSON.stringify({ savedAt: now, artifacts }), "utf8");
}
```

- [ ] **Шаг 4: убедиться, что тест проходит**

Выполнить: `npm test -- tests/deps/cache.test.ts`

Ожидается: PASS, 7 тестов.

- [ ] **Шаг 5: коммит**

```bash
git add scripts/deps/cache.mjs tests/deps/cache.test.ts
git commit -m "feat(deps): кэш ответов системы контроля на диске"
```

---

## Задача 5: клиент API

**Файлы:**

- Создать: `scripts/deps/repo-client.mjs`
- Тест: `tests/deps/client.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
import { describe, expect, it, vi } from "vitest";
import { createClient } from "../scripts/deps/repo-client.mjs";

const pkg = { name: "pglite", scope: "@electric-sql", version: "0.4.1" };

function ok(artifacts: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ artifacts }), headers: new Headers() };
}

function fail(status: number, headers: Record<string, string> = {}) {
  return { ok: false, status, json: async () => ({}), headers: new Headers(headers), text: async () => "" };
}

function client(fetchImpl: unknown, overrides = {}) {
  return createClient({
    fetchImpl,
    getToken: vi.fn(async () => "T0"),
    sleep: vi.fn(async () => {}),
    random: () => 0,
    ...overrides,
  });
}

describe("createClient.findArtifacts", () => {
  it("шлёт имя и область раздельно и подставляет токен", async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    await client(fetchImpl).findArtifacts(pkg);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://repository.rt.ru/gateway/artifacts/findArtifacts");
    expect(init.headers.Authorization).toBe("Bearer T0");
    expect(JSON.parse(init.body)).toEqual({
      npm: { name: "pglite", scope: "@electric-sql", version: "0.4.1", state: {} },
      offset: 0,
      limit: 50,
      strict: false,
    });
  });

  it("забирает следующую страницу, когда ответ полон", async () => {
    const full = Array.from({ length: 50 }, (_, i) => ({ npm: { version: `0.4.${i}` } }));
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok(full)).mockResolvedValueOnce(ok([{ npm: { version: "0.4.99" } }]));
    const artifacts = await client(fetchImpl).findArtifacts(pkg);

    expect(artifacts).toHaveLength(51);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).offset).toBe(50);
  });

  it("выдерживает паузу перед каждым запросом", async () => {
    const sleep = vi.fn(async () => {});
    await client(vi.fn(async () => ok([])), { sleep }).findArtifacts(pkg);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("обновляет токен на 401 и повторяет запрос один раз", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(fail(401)).mockResolvedValueOnce(ok([]));
    const getToken = vi.fn().mockResolvedValueOnce("T0").mockResolvedValueOnce("T1");
    await client(fetchImpl, { getToken }).findArtifacts(pkg);

    expect(getToken).toHaveBeenLastCalledWith({ force: true });
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe("Bearer T1");
  });

  it("сдаётся на втором 401 подряд", async () => {
    const fetchImpl = vi.fn(async () => fail(401));
    await expect(client(fetchImpl).findArtifacts(pkg)).rejects.toThrow(/401/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("на 429 ждёт столько, сколько просит сервер", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn().mockResolvedValueOnce(fail(429, { "Retry-After": "3" })).mockResolvedValueOnce(ok([]));
    await client(fetchImpl, { sleep }).findArtifacts(pkg);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("останавливается после трёх отказов подряд", async () => {
    const fetchImpl = vi.fn(async () => fail(503));
    await expect(client(fetchImpl).findArtifacts(pkg)).rejects.toThrow(/503/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npm test -- tests/deps/client.test.ts`

Ожидается: FAIL, модуль не найден.

- [ ] **Шаг 3: написать модуль**

```js
/**
 * @module scripts/deps/repo-client
 * @description Asks the corporate system whether a package version is allowed.
 *
 * The client carries no verdicts: it delivers records and nothing else. Everything it knows
 * about the API was recovered from a saved session and the client bundle — there is no
 * documentation — so the request shape here is the one the real web client sends, field for
 * field, including `state: {}` and `strict: false`.
 */

import { jitteredDelay, longPauseMs, retryDelayMs, sleep as realSleep } from "./pace.mjs";

const ENDPOINT = "/gateway/artifacts/findArtifacts";
const PAGE = 50;
const MAX_RECORDS = 200;
const MAX_REFUSALS = 3;

/**
 * @param {object} options
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(opts?: {force?: boolean}) => Promise<string>} options.getToken
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {() => number} [options.random]
 * @param {string} [options.baseUrl]
 * @param {number} [options.delayMs] Pause before each request; the CLI may widen it.
 * @returns {{findArtifacts: (pkg: object) => Promise<Array<object>>, sent: () => number}}
 */
export function createClient({
  fetchImpl = fetch,
  getToken,
  sleep = realSleep,
  random = Math.random,
  baseUrl = "https://repository.rt.ru",
  delayMs = 500,
} = {}) {
  let sent = 0;

  /** One request, with the pace, the 401 retry and the refusal backoff applied. */
  async function request(pkg, offset) {
    let refusals = 0;
    let retriedAuth = false;
    for (;;) {
      const breather = longPauseMs(sent);
      if (breather) await sleep(breather);
      await sleep(jitteredDelay(delayMs, 200, random));
      sent += 1;

      const token = await getToken(retriedAuth ? { force: true } : undefined);
      const response = await fetchImpl(`${baseUrl}${ENDPOINT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json;charset=utf-8", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          npm: { name: pkg.name, scope: pkg.scope ?? "", version: pkg.version, state: {} },
          offset,
          limit: PAGE,
          strict: false,
        }),
      });

      if (response.ok) return (await response.json()).artifacts ?? [];

      if (response.status === 401) {
        if (retriedAuth) throw new Error(`401 от системы после обновления токена: вход больше не действует`);
        retriedAuth = true;
        continue;
      }

      refusals += 1;
      if (refusals >= MAX_REFUSALS) {
        throw new Error(`${response.status} от системы трижды подряд: прогон остановлен`);
      }
      await sleep(retryDelayMs(refusals - 1, response.headers?.get?.("Retry-After") ?? null));
    }
  }

  return {
    sent: () => sent,

    /**
     * All records the system has for this name, narrowed by the version prefix.
     * The caller decides which record is actually ours — see `classify.mjs`.
     */
    async findArtifacts(pkg) {
      const collected = [];
      for (let offset = 0; offset < MAX_RECORDS; offset += PAGE) {
        const page = await request(pkg, offset);
        collected.push(...page);
        if (page.length < PAGE) break;
      }
      return collected;
    },
  };
}
```

Примечание для исполнителя: в тесте на 401 ожидание `getToken` вызывается сначала без аргументов, затем
с `{ force: true }` — именно поэтому первый вызов в коде идёт как `getToken(undefined)`.

- [ ] **Шаг 4: убедиться, что тест проходит**

Выполнить: `npm test -- tests/deps/client.test.ts`

Ожидается: PASS, 7 тестов.

- [ ] **Шаг 5: коммит**

```bash
git add scripts/deps/repo-client.mjs tests/deps/client.test.ts
git commit -m "feat(deps): клиент findArtifacts с повторами и пагинацией"
```

---

## Задача 6: отчёт

**Файлы:**

- Создать: `scripts/deps/report.mjs`
- Тест: `tests/deps/report.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { OUTCOME } from "../scripts/deps/classify.mjs";
import { exitCodeFor, renderConsole, renderMarkdown, summarize } from "../scripts/deps/report.mjs";

function result(over: Record<string, unknown> = {}) {
  return {
    id: "express@5.2.1",
    name: "express",
    scope: "",
    version: "5.2.1",
    dev: false,
    requiredBy: ["проект"],
    outcome: OUTCOME.OK,
    status: "PERMITTED",
    known: true,
    zone: "MAIN",
    comment: "",
    alerts: [],
    ...over,
  };
}

describe("summarize", () => {
  it("считает исходы", () => {
    const summary = summarize([result(), result({ outcome: OUTCOME.BLOCK, status: "RESTRICTED" })]);
    expect(summary.counts).toMatchObject({ ok: 1, block: 1, warn: 0, error: 0 });
  });

  it("разделяет находки продакшена и dev", () => {
    const summary = summarize([
      result({ id: "a@1", outcome: OUTCOME.BLOCK, status: "RESTRICTED" }),
      result({ id: "b@1", outcome: OUTCOME.BLOCK, status: "ABSENT", dev: true }),
    ]);
    expect(summary.blockedProd.map((r) => r.id)).toEqual(["a@1"]);
    expect(summary.blockedDev.map((r) => r.id)).toEqual(["b@1"]);
  });
});

describe("exitCodeFor", () => {
  it("ноль, когда всё разрешено", () => {
    expect(exitCodeFor(summarize([result()]), {})).toBe(0);
  });

  it("единица при запрете в продакшен-графе", () => {
    expect(exitCodeFor(summarize([result({ outcome: OUTCOME.BLOCK })]), {})).toBe(1);
  });

  it("ноль при запрете только в dev", () => {
    expect(exitCodeFor(summarize([result({ outcome: OUTCOME.BLOCK, dev: true })]), {})).toBe(0);
  });

  it("единица при запрете в dev, когда попрошено строго", () => {
    expect(exitCodeFor(summarize([result({ outcome: OUTCOME.BLOCK, dev: true })]), { strictDev: true })).toBe(1);
  });

  it("двойка, когда часть пакетов не удалось спросить", () => {
    expect(exitCodeFor(summarize([result({ outcome: OUTCOME.ERROR })]), {})).toBe(2);
  });

  it("находка важнее неполноты", () => {
    const summary = summarize([result({ outcome: OUTCOME.BLOCK }), result({ id: "x@1", outcome: OUTCOME.ERROR })]);
    expect(exitCodeFor(summary, {})).toBe(1);
  });
});

describe("renderMarkdown", () => {
  it("называет запрещённый пакет и того, кто его тянет", () => {
    const md = renderMarkdown(
      [result({ outcome: OUTCOME.BLOCK, status: "RESTRICTED", requiredBy: ["проект", "vite@8.0.0"] })],
      { checkedAt: "2026-09-18T10:00:00.000Z", total: 1 },
    );
    expect(md).toContain("express");
    expect(md).toContain("vite@8.0.0");
    expect(md).toContain("RESTRICTED");
  });

  it("не остаётся без заголовка первого уровня", () => {
    expect(renderMarkdown([result()], { checkedAt: "2026-09-18T10:00:00.000Z", total: 1 }).startsWith("# ")).toBe(true);
  });
});

describe("renderConsole", () => {
  it("показывает сводку и не перечисляет разрешённые", () => {
    const text = renderConsole(summarize([result(), result({ id: "b@1", name: "b", outcome: OUTCOME.BLOCK })]));
    expect(text).toContain("Разрешено: 1");
    expect(text).not.toContain("express");
    expect(text).toContain("b");
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npm test -- tests/deps/report.test.ts`

Ожидается: FAIL, модуль не найден.

- [ ] **Шаг 3: написать модуль**

```js
/**
 * @module scripts/deps/report
 * @description Renders verdicts: a console summary, a Markdown report and raw JSON.
 *
 * Only findings are printed. A list of six hundred permitted packages buries the four that
 * matter, and the whole point of the tool is to make those four impossible to miss.
 */

import { OUTCOME } from "./classify.mjs";

/** Groups results and counts outcomes. */
export function summarize(results) {
  const counts = { ok: 0, warn: 0, block: 0, error: 0 };
  for (const r of results) counts[r.outcome] += 1;
  const blocked = results.filter((r) => r.outcome === OUTCOME.BLOCK);
  return {
    results,
    counts,
    blockedProd: blocked.filter((r) => !r.dev),
    blockedDev: blocked.filter((r) => r.dev),
    warnings: results.filter((r) => r.outcome === OUTCOME.WARN),
    errors: results.filter((r) => r.outcome === OUTCOME.ERROR),
  };
}

/**
 * 0 — всё разрешено; 1 — есть находка; 2 — прогон неполон.
 *
 * A finding outranks incompleteness: if something is already forbidden, the fact that three
 * other packages timed out does not make the answer any less final.
 */
export function exitCodeFor(summary, { strictDev = false } = {}) {
  const blocking = strictDev ? [...summary.blockedProd, ...summary.blockedDev] : summary.blockedProd;
  if (blocking.length) return 1;
  if (summary.errors.length) return 2;
  return 0;
}

/** One line about a package: what it is and who pulls it. */
function line(r) {
  const where = r.requiredBy.length ? ` <- ${r.requiredBy.slice(0, 3).join(", ")}` : "";
  const scope = r.scope ? `${r.scope}/` : "";
  const zone = r.zone && r.zone !== "MAIN" ? ` [${r.zone}]` : "";
  const dev = r.dev ? " (dev)" : "";
  return `  ${scope}${r.name}@${r.version} — ${r.status}${zone}${dev}${where}`;
}

/** Console text: the summary, then everything that is not permitted. */
export function renderConsole(summary) {
  const { counts } = summary;
  const parts = [
    `Разрешено: ${counts.ok}   Предупреждений: ${counts.warn}   Запрещено: ${counts.block}   Ошибок: ${counts.error}`,
  ];
  const section = (title, rows) => {
    if (!rows.length) return;
    parts.push("", `${title} (${rows.length}):`, ...rows.map(line));
  };
  section("Запрещено или нет в базе — продакшен", summary.blockedProd);
  section("Запрещено или нет в базе — только dev", summary.blockedDev);
  section("Требует внимания", summary.warnings);
  section("Не удалось спросить", summary.errors);
  return parts.join("\n");
}

/** Markdown rows for one section; the full chain, unlike the console. */
function mdRows(rows) {
  return rows.map((r) => {
    const scope = r.scope ? `${r.scope}/` : "";
    const chain = r.requiredBy.length ? r.requiredBy.join(", ") : "—";
    const note = r.comment ? r.comment.replace(/\|/g, "\\|") : "—";
    return `| ${scope}${r.name} | ${r.version} | ${r.status} | ${r.zone ?? "—"} | ${r.dev ? "dev" : "прод"} | ${chain} | ${note} |`;
  });
}

/** Full report for a human to read or forward. */
export function renderMarkdown(results, { checkedAt, total }) {
  const summary = summarize(results);
  const head = "| Пакет | Версия | Статус | Зона | Граф | Кто тянет | Комментарий системы |";
  const sep = "| --- | --- | --- | --- | --- | --- | --- |";
  const out = [
    "# Отчёт о допустимости зависимостей",
    "",
    `Проверено пакетов: ${total}. Дата проверки: ${checkedAt}.`,
    "",
    `Разрешено: ${summary.counts.ok}. Предупреждений: ${summary.counts.warn}. ` +
      `Запрещено: ${summary.counts.block}. Ошибок: ${summary.counts.error}.`,
  ];
  const section = (title, rows) => {
    if (!rows.length) return;
    out.push("", `## ${title}`, "", head, sep, ...mdRows(rows));
  };
  section("Запрещено или нет в базе — продакшен", summary.blockedProd);
  section("Запрещено или нет в базе — только dev", summary.blockedDev);
  section("Требует внимания", summary.warnings);
  section("Не удалось спросить", summary.errors);
  if (!summary.counts.block && !summary.counts.warn && !summary.counts.error) {
    out.push("", "Все проверенные пакеты разрешены.");
  }
  out.push("");
  return out.join("\n");
}

/** Everything as data, for a later comparison of two runs. */
export function toJson(results, { checkedAt, total }) {
  return { checkedAt, total, summary: summarize(results).counts, results };
}
```

- [ ] **Шаг 4: убедиться, что тест проходит**

Выполнить: `npm test -- tests/deps/report.test.ts`

Ожидается: PASS, 11 тестов.

- [ ] **Шаг 5: коммит**

```bash
git add scripts/deps/report.mjs tests/deps/report.test.ts
git commit -m "feat(deps): отчёт о допустимости в консоль, Markdown и JSON"
```

---

## Задача 7: вход через браузер

**Файлы:**

- Создать: `scripts/deps/repo-auth.mjs`
- Тест: `tests/deps/auth.test.ts`

Проверяется только чистая часть — разбор срока жизни токена и решение «брать из кэша, обновлять или
поднимать браузер». Сам вход проверяется живым прогоном в задаче 9: подделка Keycloak повторяла бы
наши же догадки и ничего не доказывала.

Свой минимальный CDP-клиент здесь пишется намеренно, а не берётся из
`scripts/check/editor-conformance/cdp.mjs`: тому нужен headless-бинарь и разовый профиль, нам —
видимое окно, постоянный профиль и подписка на события протокола. Связывать инструмент проверки
зависимостей с гейтом вёрстки одним модулем значит ломать их парой.

- [ ] **Шаг 1: написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { decodeExpiry, tokenIsUsable } from "../scripts/deps/repo-auth.mjs";

/** Minimal unsigned JWT with the given `exp`. */
function jwt(exp: number) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `header.${payload}.signature`;
}

describe("decodeExpiry", () => {
  it("читает exp из полезной нагрузки", () => {
    expect(decodeExpiry(jwt(1789731223))).toBe(1789731223000);
  });

  it("возвращает null на непохожей строке", () => {
    expect(decodeExpiry("не токен")).toBeNull();
  });

  it("возвращает null, когда exp отсутствует", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "x" })).toString("base64url");
    expect(decodeExpiry(`h.${payload}.s`)).toBeNull();
  });
});

describe("tokenIsUsable", () => {
  it("годен, пока до конца больше запаса", () => {
    expect(tokenIsUsable(jwt(2000), 1000 * 1000, 30000)).toBe(true);
  });

  it("негоден, когда до конца меньше запаса", () => {
    expect(tokenIsUsable(jwt(2000), 1980 * 1000, 30000)).toBe(false);
  });

  it("негоден, когда срок не прочитан", () => {
    expect(tokenIsUsable("мусор", 0, 30000)).toBe(false);
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `npm test -- tests/deps/auth.test.ts`

Ожидается: FAIL, модуль не найден.

- [ ] **Шаг 3: написать модуль**

```js
/**
 * @module scripts/deps/repo-auth
 * @description Gets a Bearer token for the corporate system.
 *
 * The system has no machine credentials we can use: project tokens are not available to us, so
 * a human logging in through the browser is the ONLY way in. That shapes everything here — the
 * browser window is visible (corporate SSO may ask for a password and a second factor), the
 * profile directory persists (so the next run is silent), and no password is ever asked for or
 * stored by us.
 *
 * The access token lives about five minutes and the refresh token about thirty, so the order is:
 * cached access token, then refresh, then the browser.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome } from "../docs/chrome.mjs";

const BASE = "https://repository.rt.ru";
const TOKEN_URL = `${BASE}/accounting/auth/user/token`;
/** Secrets have no business next to the sources, even under .gitignore. */
const TOKEN_FILE = join(tmpdir(), "rt-repo-tokens.json");
const PROFILE_DIR = join(tmpdir(), "rt-repo-chrome-profile");
const SKEW_MS = 30000;
const LOGIN_TIMEOUT_MS = 180000;
const DEBUG_PORT = 9333;

/**
 * Expiry of a JWT, in milliseconds since the epoch.
 * @param {string} token
 * @returns {number|null} Null when the string is not a JWT or carries no `exp`.
 */
export function decodeExpiry(token) {
  const payload = String(token ?? "").split(".")[1];
  if (!payload) return null;
  try {
    const exp = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} token
 * @param {number} now Milliseconds since the epoch.
 * @param {number} [skewMs] How much life a token must have left to be worth using.
 */
export function tokenIsUsable(token, now, skewMs = SKEW_MS) {
  const expiry = decodeExpiry(token);
  return expiry !== null && expiry - now > skewMs;
}

/** Reads the token pair saved by an earlier run. */
function readTokens() {
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeTokens(tokens) {
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens), "utf8");
}

/** Exchanges a refresh token for a fresh pair; returns null when it is no longer accepted. */
async function refresh(refreshToken) {
  if (!refreshToken) return null;
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!response.ok) return null;
  const tokens = await response.json();
  return tokens.access_token ? tokens : null;
}

/** Opens a CDP session against a freshly launched browser. */
async function connect(port) {
  let targets = null;
  for (let attempt = 0; attempt < 50 && !targets?.length; attempt += 1) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    } catch {
      targets = null;
    }
  }
  const page = targets?.find((t) => t.type === "page");
  if (!page) {
    throw new Error(
      `Не удалось подключиться к браузеру на порту ${port}. Обычная причина — Chrome уже запущен ` +
        `с этим же профилем: закройте его окно и повторите.`,
    );
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return ws;
}

/**
 * Launches a visible browser, lets the person log in and picks the token pair out of the
 * response the application itself receives.
 *
 * Reading the tokens off the wire rather than out of page storage keeps us independent of how
 * the Flutter client chooses to keep them.
 *
 * @returns {Promise<{access_token: string, refresh_token: string}>}
 */
async function loginThroughBrowser() {
  const chrome = findChrome();
  if (!chrome) throw new Error("Chrome не найден. Укажите путь в переменной CHROME_BIN.");
  mkdirSync(PROFILE_DIR, { recursive: true });

  const proc = spawn(chrome, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    `${BASE}/`,
  ]);

  const ws = await connect(DEBUG_PORT);
  let nextId = 0;
  const pending = new Map();
  const bodies = new Map();

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = (nextId += 1);
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const tokens = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Вход не завершён за три минуты — прогон остановлен.")),
      LOGIN_TIMEOUT_MS,
    );

    ws.addEventListener("message", async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: ok, reject: no } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) no(new Error(msg.error.message));
        else ok(msg.result);
        return;
      }
      if (msg.method === "Network.responseReceived" && msg.params.response.url.startsWith(TOKEN_URL)) {
        bodies.set(msg.params.requestId, true);
      }
      if (msg.method === "Network.loadingFinished" && bodies.has(msg.params.requestId)) {
        bodies.delete(msg.params.requestId);
        try {
          const { body } = await send("Network.getResponseBody", { requestId: msg.params.requestId });
          const parsed = JSON.parse(body);
          if (parsed.access_token) {
            clearTimeout(timer);
            resolve(parsed);
          }
        } catch {
          /* the body may be gone already; the application asks again on its own */
        }
      }
    });

    send("Network.enable").catch(reject);
  }).finally(() => {
    try {
      ws.close();
    } finally {
      proc.kill();
    }
  });

  return tokens;
}

/**
 * Returns a token getter for the client.
 *
 * @returns {(options?: {force?: boolean}) => Promise<string>} `force` skips the cached access
 *   token — the client passes it after a 401.
 */
export function createTokenSource() {
  let cached = readTokens();

  return async function getToken({ force = false } = {}) {
    if (!force && cached.access_token && tokenIsUsable(cached.access_token, Date.now())) {
      return cached.access_token;
    }
    const refreshed = await refresh(cached.refresh_token);
    if (refreshed) {
      cached = refreshed;
      writeTokens(cached);
      return cached.access_token;
    }
    process.stdout.write("Открываю браузер: нужно войти в repository.rt.ru через корпоративный вход.\n");
    cached = await loginThroughBrowser();
    writeTokens(cached);
    return cached.access_token;
  };
}

/** Path of the persistent profile, for the CLI to name in its messages. */
export const profileDir = PROFILE_DIR;
```

- [ ] **Шаг 4: убедиться, что тест проходит**

Выполнить: `npm test -- tests/deps/auth.test.ts`

Ожидается: PASS, 6 тестов.

- [ ] **Шаг 5: коммит**

```bash
git add scripts/deps/repo-auth.mjs tests/deps/auth.test.ts
git commit -m "feat(deps): вход в систему контроля через браузер с постоянным профилем"
```

---

## Задача 8: команда

**Файлы:**

- Создать: `scripts/deps/check-allowed.mjs`
- Изменить: `package.json` (раздел `scripts`)

- [ ] **Шаг 1: написать команду**

```js
/**
 * @module scripts/deps/check-allowed
 * @description `npm run deps:check` — asks the corporate system whether every package in
 * package-lock.json is allowed, and reports what it found.
 *
 * Design: docs/specs/tooling/deps-check.md. The run is deliberately slow (about eight minutes
 * for a full lockfile) because the pace is chosen not to look like an attack on somebody
 * else's production system; the cache makes every later run cost only what changed.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { classify, failed } from "./classify.mjs";
import { readCached, writeCached } from "./cache.mjs";
import { createTokenSource } from "./repo-auth.mjs";
import { createClient } from "./repo-client.mjs";
import { exitCodeFor, renderConsole, renderMarkdown, summarize, toJson } from "./report.mjs";
import { parseLockfile } from "./lockfile.mjs";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const { values } = parseArgs({
  options: {
    lock: { type: "string", default: "package-lock.json" },
    out: { type: "string", default: join("tmp", "deps-report") },
    cache: { type: "string", default: join("tmp", "deps-cache") },
    prod: { type: "boolean", default: false },
    "strict-dev": { type: "boolean", default: false },
    "no-cache": { type: "boolean", default: false },
    delay: { type: "string", default: "500" },
  },
});

const lock = JSON.parse(readFileSync(resolve(values.lock), "utf8"));
const all = parseLockfile(lock);
const packages = values.prod ? all.filter((p) => !p.dev) : all;

/** Rough runtime: pause plus a typical answer per package, plus a breather every fiftieth. */
const minutes = Math.ceil(
  (packages.length * (Number(values.delay) + 400) + Math.floor(packages.length / 50) * 5000) / 60000,
);
process.stdout.write(`Проверяю ${packages.length} пакетов. Темп щадящий, ожидаемое время — около ${minutes} минут.\n`);

const client = createClient({ getToken: createTokenSource(), delayMs: Number(values.delay) });
const results = [];
let fromCache = 0;

for (const [index, pkg] of packages.entries()) {
  const now = Date.now();
  let artifacts = values["no-cache"] ? null : readCached(values.cache, pkg, { now, ttlMs: CACHE_TTL_MS });
  if (artifacts) {
    fromCache += 1;
  } else {
    try {
      artifacts = await client.findArtifacts(pkg);
      writeCached(values.cache, pkg, artifacts, { now });
    } catch (error) {
      results.push(failed(pkg, error));
      if (/трижды подряд|вход больше не действует/.test(error.message)) {
        process.stdout.write(`\nОстановка: ${error.message}\n`);
        break;
      }
      continue;
    }
  }
  results.push(classify(pkg, artifacts));
  if ((index + 1) % 25 === 0) {
    process.stdout.write(`  ${index + 1} из ${packages.length}\n`);
  }
}

const meta = { checkedAt: new Date().toISOString(), total: results.length };
mkdirSync(values.out, { recursive: true });
writeFileSync(join(values.out, "report.md"), renderMarkdown(results, meta), "utf8");
writeFileSync(join(values.out, "report.json"), JSON.stringify(toJson(results, meta), null, 2), "utf8");

const summary = summarize(results);
process.stdout.write(`\n${renderConsole(summary)}\n\n`);
process.stdout.write(`Из кэша: ${fromCache}. Отчёт: ${join(values.out, "report.md")}\n`);
process.exit(exitCodeFor(summary, { strictDev: values["strict-dev"] }));
```

- [ ] **Шаг 2: добавить команду в package.json**

В раздел `scripts`, рядом с прочими проверками:

```json
"deps:check": "node scripts/deps/check-allowed.mjs"
```

- [ ] **Шаг 3: проверить разбор без обращения к сети**

Выполнить:

```bash
node -e "import('./scripts/deps/lockfile.mjs').then(async (m) => {
  const lock = JSON.parse(require('fs').readFileSync('package-lock.json', 'utf8'));
  const all = m.parseLockfile(lock);
  console.log('всего', all.length, 'прод', all.filter((p) => !p.dev).length);
})"
```

Ожидается порядка 690 пакетов всего и 412 в продакшен-графе — точные числа зависят от ветки, в
которой считают: на `main` `@electric-sql/pglite` версии 0.5.4, а на ветке `feat/prd57-e0-wireframes`
он откачен до 0.4.1, отчего состав графа немного расходится. Эти же числа команда печатает в первой
строке прогона — с флагом `--prod` и без него. Числа не подгонять: расхождение больше чем на десяток
означает ошибку разбора, а не дрейф ветки.

- [ ] **Шаг 4: убедиться, что прежние тесты целы**

Выполнить:

```bash
npm test -- tests/deps/lockfile.test.ts tests/deps/classify.test.ts tests/deps/pace.test.ts \
  tests/deps/cache.test.ts tests/deps/client.test.ts tests/deps/report.test.ts tests/deps/auth.test.ts
```

Ожидается: PASS, все семь файлов. Полный `npm test` не запускать: он идёт около восьми минут и
занимает машину, а разрешения на него не было.

- [ ] **Шаг 5: коммит**

```bash
git add scripts/deps/check-allowed.mjs package.json
git commit -m "feat(deps): команда npm run deps:check"
```

---

## Задача 9: живой прогон и уточнение спеки

Первый прогон против живой системы — единственный способ проверить то, что восстановлено из сессии.
Здесь не пишется код: здесь проверяются догадки, и каждая подтверждённая или опровергнутая
записывается в спеку.

- [ ] **Шаг 1: прогон на небольшом списке**

Собрать временный lock-файл из десятка пакетов, которые встречались в исходной сессии (`express`,
`zod`, `jszip`, `nodemailer`, `wouter`, `@electric-sql/pglite`, `memorystore`), и выполнить:

`node scripts/deps/check-allowed.mjs --lock <временный файл> --out tmp/deps-smoke`

Ожидается: открывается окно браузера, после входа прогон идёт сам. `wouter@3.10.0` должен попасть в
раздел «нет в базе», `express@3.21.2` — в предупреждения с `PARTIALLY_PERMITTED`.

- [ ] **Шаг 2: полный прогон**

Выполнить: `npm run deps:check`

Ожидается: около двенадцати минут, отчёт в `tmp/deps-report/report.md`, код возврата соответствует
находкам. Сверить время и отсутствие отказов по частоте.

- [ ] **Шаг 3: повторный прогон**

Выполнить: `npm run deps:check` ещё раз.

Ожидается: секунды вместо минут, в консоли «Из кэша: N» с N, равным числу проверенных пакетов.

- [ ] **Шаг 4: проверить флаг strict**

Выполнить один запрос вручную с `"strict": true` в теле (например, через временный вызов
`client.findArtifacts` с правкой) для `zod` с версией `4.4` и сравнить число записей с прогоном при
`false`.

Ожидается: либо строгое совпадение версии (записей 0 или 1), либо тот же префиксный поиск. Результат
записать в спеку, раздел 11.

- [ ] **Шаг 5: обновить спеку**

Внести в `docs/specs/tooling/deps-check.md` фактические наблюдения: поведение `strict`, реальное
время прогона, встреченные статусы, были ли отказы по частоте. Открытые вопросы, на которые получен
ответ, перенести из раздела 11 в раздел 2.

- [ ] **Шаг 6: коммит**

```bash
git add docs/specs/tooling/deps-check.md
git commit -m "docs(deps): наблюдения первого живого прогона"
```

---

## Что сознательно не делается

Пакетный путь системы (`loadBatch`, `calcMappingsForBatch`, `getBatchInfo`) не используется: его
схему пришлось бы угадывать. Заявки на недостающие пакеты не подаются — инструмент только читает.
Форматы кроме npm не поддерживаются. Параллельность не вводится: один запрос за раз — осознанное
требование спеки, а не временное упрощение.

---

## Итог работы

Восемь модулей, 153 теста. Каждая задача после реализации проходила ревью, и почти каждое ревью
находило дефект, который тесты не ловили. Ниже — чем готовый код отличается от черновиков выше и,
что важнее, какие из находок были не про код, а про наше понимание чужого API.

### Три раза понимание API оказывалось неверным

- **Поиск версии не префиксный, а подстрочный.** Первая редакция спеки утверждала обратное: вывод
  был сделан по трём запросам, где префикс и подстрока давали одинаковый ответ. Полный список
  возвращённых версий показал `0.4.42` в ответе на `4.4` и `10.0.9` в ответе на `9`.
- **Имя ищется так же — подстрокой.** Запрос `express` возвращает `platform-express`,
  `express-session`, `helper-optimise-call-expression`. Из восемнадцати записанных запросов
  двенадцать вернули записи с чужими именами. Это превратило безобидный на вид потолок в 200
  записей в источник ложных «пакета нет в базе» для пакетов с короткими именами.
- **`Retry-After` нельзя урезать своим потолком.** План применял потолок в минуту к обеим ветвям
  выдержки, из-за чего инструмент вернулся бы через минуту на просьбу подождать час — ослушался бы
  единственного явного указания системы ровно там, где обещает не выглядеть атакой.

### Что изменилось в модулях против черновиков

- `lockfile.mjs` — имя берётся из `entry.name`, а не из ключа (alias-установки вида
  `string-width-cjs` дали бы три ложных запрета); единый предикат «настоящий пакет» в обоих
  проходах; проверка входа вместо молчаливого «проверено 0 пакетов, всё разрешено»;
  `peerDependencies` убраны из графа «кто тянет» как несуществующие рёбра; поле `key` убрано.
- `classify.mjs` — запись без `state` больше не выдаётся за явный ответ `UNDEFINED`; при отсутствии
  нашей версии в непустом ответе в комментарий попадают соседние версии с их статусами, чтобы
  человек мог взять разрешённую рядом вместо заведения заявки.
- `pace.mjs` — числа собраны в замороженный `PACE` и сверяются с разделом 5 отдельным тестом;
  разброс и параметры передышки больше не перебиваются аргументами; `retryDelayMs` заменён на
  `retryPlan`, который умеет сказать «остановись».
- `cache.mjs` — разделитель ключа сменён дважды: сначала из-за коллизии `@a/b` с `a__b`, затем
  из-за остаточной коллизии внутри областей; части ключа кодируются, причём `encodeURIComponent`
  оставляет `!` нетронутым, и это пришлось обходить явно. Запись атомарна, протухшее подметается.
- `repo-client.mjs` — защёлка остановки переживает границу вызова (иначе «остановка прогона»
  останавливала один пакет из 690); признак фатальности вместо разбора текста ошибки; таймаут
  запроса; повторяются только те коды, которые имеет смысл повторять; тело ошибочного ответа
  попадает в текст исключения — при первом живом прогоне это может оказаться единственной подсказкой.
- `repo-auth.mjs` — браузер стартует на пустой странице, слежение за сетью включается и
  подтверждается, и только потом идёт переход: иначе при живой сессии SSO обмен кода на токен
  происходил раньше, чем мы успевали подписаться. Профиль вынесен из временного каталога, чтобы
  переживать не один прогон, а дни жизни сессии.
- `report.mjs` — незнакомый исход роняет прогон вместо тихого нуля; экранируются все ячейки
  таблицы, а не только свободный текст.
- `check-allowed.mjs` — флаг `--delay` умеет только замедлять: ускорение требует правки `pace.mjs`
  и его теста, а не аргумента командной строки. Оборванный прогон помечается в отчёте как неполный.

### Приём, который стоит повторять

Каждый набор тестов проверялся мутациями: по очереди ломалось каждое содержательное решение модуля,
и проверялось, заметит ли это хоть один тест. Приём окупился сразу — на первом модуле выжили пять
мутаций из пяти. Позже он же поймал десятикратное «ускорение» темпа, исчезновение раздела «Не
удалось спросить» из отчёта и потерю «нет записи» в продакшен-графе.
