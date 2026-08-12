# PRD-49. Настраиваемые заголовки блоков итогов — план реализации

> **Для агентов-исполнителей:** ОБЯЗАТЕЛЬНЫЙ ПОДНАВЫК — `superpowers:subagent-driven-development`
> (рекомендуется) или `superpowers:executing-plans`. Шаги помечены чек-боксами (`- [ ]`).

**Цель:** автор теста переформулирует и выключает заголовки блоков экрана итогов, отчёта и итогов
раздела, переставляет подблоки местами и управляет показом слотов карточки показателя.

**Архитектура:** надписи объявляет манифест шаблона (`labels[]`), значения хранит тест
(`design_settings_json.labels`, переопределения отчёта — `report_settings_json.labels`), разрешает
одна чистая функция в `shared/template/labels.ts`. Порядок и видимость подблоков ядро сводит в
массив `result.blocks`, по которому макет проходит одним `{{#each}}` — так порядок выражен данными
и одинаково честен на экране и в печатном отчёте.

**Стек:** TypeScript, Vitest, Drizzle ORM, React 19, дизайн-система `@universityrt/ui-kit`,
собственный DSL шаблонов (`shared/template/dsl.ts`), рантайм SCORM на ES5 (`server/scorm/template/app`).

**Спека:** `docs/specs/prd-49/results-headings.md`.

**Правила прогона тестов в этом репозитории:**

- Только `npm test -- <путь>`; `npx vitest run` в этом проекте падает.
- Полный прогон (`npm test` без пути) и `npm run test:cov` — ТОЛЬКО по явному разрешению владельца:
  в одной рабочей копии параллельно работают несколько сессий.
- В коммитах не должно быть трейлера `Co-Authored-By`.
- Перед `git commit` сверять `git diff --cached --name-only`: индекс общий на всю рабочую копию.

---

## Структура файлов

**Создаются:**

- `shared/template/labels.ts` — объявление, разрешение и раскладка надписей в дерево контекста.
- `shared/template/__tests__/labels.test.ts` — тесты разрешения.
- `shared/template/results-order.ts` — порядок подблоков итогов.
- `shared/template/__tests__/results-order.test.ts` — тесты порядка.
- `client/src/features/tests/editor/sections/results-labels-pane.tsx` — панель «Итоги» вкладки
  «Оформление»: список надписей и порядок подблоков.
- `client/src/features/tests/editor/sections/__tests__/results-labels-pane.test.tsx` — тесты панели.

**Изменяются:**

- `server/scorm/templates/default/manifest.json` — раздел `labels[]`, умолчание порядка.
- `templates/certification/manifest.json` — то же (паритет шаблонов).
- `server/services/template-validation.ts` — статические проверки раздела `labels[]`.
- `shared/schema.ts` — `designSettingsSchema` принимает `labels` и `resultsBlockOrder`.
- `shared/template/context.ts` — `CtxResult.blocks`, `ResultRenderContext.labels`.
- `shared/template/result-context.ts` — сборка `blocks` и `labels` в обоих билдерах.
- `shared/template/measure-view.ts` — слоты `showName` / `showLevel`.
- `server/scorm/templates/default/layouts/results.html`, `results.adaptive.html`,
  `section-results.html`, `report.html`, `report.adaptive.html` — новая структура заголовков.
- `templates/certification/layouts/*` — те же макеты.
- `server/services/result-context.ts` — прокидывает надписи и порядок в билдер.
- `server/routes/attempts.ts` — читает `design_settings_json` выданной версии.
- `server/scorm/builders/test-json.ts` — кладёт разрешённые надписи в пакет.
- `server/scorm/template/app/render/viewResults.js` — читает их из `TEST_DATA`.
- `shared/report/report-context.ts` — слой переопределений отчёта.
- `client/src/features/tests/editor/sections/design-section.tsx` — новая панель.
- `client/src/features/tests/editor/sections/scales-section.tsx`,
  `result-variables-section.tsx` — тумблеры слотов карточки.
- `docs/specs/spec-template-platform.md` — формат шаблона 1.4.0.

---

## Задача 1. Резолвер надписей

**Файлы:**

- Создать: `shared/template/labels.ts`
- Тест: `shared/template/__tests__/labels.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { resolveLabels, labelsTree, type LabelDeclaration } from "../labels";

const DECLS: LabelDeclaration[] = [
  { key: "results.heading", group: "Первый уровень", label: "Зонтик", default: "Ваш результат" },
  { key: "results.scales", group: "Второй уровень", label: "Шкалы", default: "По шкалам" },
  {
    key: "recommendations.courses",
    group: "Группы рекомендаций",
    label: "Курсы",
    default: "Пройти обучение",
    defaults: { report: "Рекомендации по курсам" },
  },
];

describe("resolveLabels", () => {
  it("returns template defaults when the test stored nothing", () => {
    expect(resolveLabels(DECLS, {}, {}, "results")).toEqual({
      "results.heading": "Ваш результат",
      "results.scales": "По шкалам",
      "recommendations.courses": "Пройти обучение",
    });
  });

  it("uses the screen default where the declaration has one", () => {
    const map = resolveLabels(DECLS, {}, {}, "report");
    expect(map["recommendations.courses"]).toBe("Рекомендации по курсам");
    expect(map["results.scales"]).toBe("По шкалам");
  });

  it("applies the author's own wording", () => {
    const map = resolveLabels(DECLS, { "results.scales": { on: true, text: "Профиль" } }, {}, "results");
    expect(map["results.scales"]).toBe("Профиль");
  });

  it("keeps the template text when the author cleared the field but left it on", () => {
    const map = resolveLabels(DECLS, { "results.scales": { on: true, text: "" } }, {}, "results");
    expect(map["results.scales"]).toBe("По шкалам");
  });

  it("returns an empty string for a switched-off label", () => {
    const map = resolveLabels(DECLS, { "results.scales": { on: false } }, {}, "results");
    expect(map["results.scales"]).toBe("");
  });

  it("ignores a stored key the template does not declare", () => {
    const map = resolveLabels(DECLS, { "results.gone": { on: false } }, {}, "results");
    expect(map["results.gone"]).toBeUndefined();
  });

  it("lets the report override the shared wording", () => {
    const values = { "results.scales": { on: true, text: "Профиль" } };
    const overrides = { "results.scales": { on: true, text: "Профиль по шкалам" } };
    expect(resolveLabels(DECLS, values, overrides, "report")["results.scales"]).toBe("Профиль по шкалам");
    expect(resolveLabels(DECLS, values, overrides, "results")["results.scales"]).toBe("Профиль");
  });

  it("lets the report switch a label off on its own", () => {
    const map = resolveLabels(DECLS, {}, { "results.heading": { on: false } }, "report");
    expect(map["results.heading"]).toBe("");
  });
});

describe("labelsTree", () => {
  it("splits dotted keys into nested objects for the DSL", () => {
    expect(labelsTree({ "results.scales": "По шкалам", "facts.points": "баллов" })).toEqual({
      results: { scales: "По шкалам" },
      facts: { points: "баллов" },
    });
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Команда: `npm test -- shared/template/__tests__/labels.test.ts`
Ожидание: FAIL, «Failed to resolve import "../labels"».

- [ ] **Шаг 3. Написать модуль**

```ts
/**
 * @module shared/template/labels
 *
 * Resolves the interface labels of the results screens (PRD-49).
 *
 * A label is a named string the TEMPLATE declares with a default text and the TEST may
 * reword or switch off. Three states have to stay distinguishable — untouched, reworded,
 * switched off — so a stored value is a record with a switch, never a bare string: an
 * empty string would be indistinguishable from «I never opened this field».
 *
 * Pure — no DOM, no Node.
 */

/** Screens a label can carry a distinct default for. */
export type LabelScreen = "results" | "results.adaptive" | "section-results" | "report";

/** A label as the template manifest declares it (`manifest.labels[]`). */
export interface LabelDeclaration {
  key: string;
  /** Grouping in the editor: fifteen fields in one flat list are unreadable. */
  group: string;
  /** Field caption shown to the author. */
  label: string;
  /** Text used when the test stored nothing. Required by the manifest check. */
  default: string;
  /** Per-screen defaults, for the screens whose wording differs from the shared one. */
  defaults?: Partial<Record<LabelScreen, string>>;
}

/** What the test stores for a label. Absent key = the template default stands. */
export interface LabelValue {
  on?: boolean;
  text?: string;
}

export type LabelValues = Record<string, LabelValue>;

/** Effective texts by key. An empty string means «do not print this label». */
export type ResolvedLabels = Record<string, string>;

function pick(decl: LabelDeclaration, screen: LabelScreen): string {
  return decl.defaults?.[screen] ?? decl.default;
}

/**
 * One layer of author values over the template default. Returns `null` when the layer
 * says nothing about this label, so the caller can fall through to the layer below.
 */
function applyLayer(value: LabelValue | undefined, fallback: string): string | null {
  if (!value) return null;
  if (value.on === false) return "";
  // A cleared field is NOT «no label»: switching off is what the toggle is for. Falling
  // back to the template text also keeps a test following the template's later edits.
  const text = (value.text ?? "").trim();
  return text ? text : fallback;
}

/**
 * Effective label texts for one screen: template default, the test's shared values on top,
 * the screen's own overrides on top of those. Keys the template does not declare are
 * dropped — the test may have been moved to another template.
 */
export function resolveLabels(
  declarations: readonly LabelDeclaration[],
  values: LabelValues,
  overrides: LabelValues,
  screen: LabelScreen,
): ResolvedLabels {
  const out: ResolvedLabels = {};
  for (const decl of declarations) {
    const fallback = pick(decl, screen);
    const shared = applyLayer(values[decl.key], fallback);
    const own = applyLayer(overrides[decl.key], shared ?? fallback);
    out[decl.key] = own ?? shared ?? fallback;
  }
  return out;
}

/**
 * Turns the flat map into the nested object the DSL addresses: `resolvePath` splits a
 * template path on dots, so `labels["results.scales"]` would never be reachable from
 * `{{ labels.results.scales }}`.
 */
export function labelsTree(labels: ResolvedLabels): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, text] of Object.entries(labels)) {
    const parts = key.split(".");
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = text;
  }
  return root;
}
```

- [ ] **Шаг 4. Убедиться, что тест проходит**

Команда: `npm test -- shared/template/__tests__/labels.test.ts`
Ожидание: PASS, 9 тестов.

- [ ] **Шаг 5. Коммит**

```bash
git add shared/template/labels.ts shared/template/__tests__/labels.test.ts
git commit -m "feat(prd-49): резолвер надписей экрана итогов"
```

---

## Задача 2. Порядок подблоков

**Файлы:**

- Создать: `shared/template/results-order.ts`
- Тест: `shared/template/__tests__/results-order.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { resolveBlockOrder, DEFAULT_BLOCK_ORDER, type ResultsBlockKey } from "../results-order";

describe("resolveBlockOrder", () => {
  it("falls back to the template order when the test stored nothing", () => {
    expect(resolveBlockOrder(undefined, DEFAULT_BLOCK_ORDER)).toEqual([
      "summary",
      "scales",
      "indicators",
      "topics",
    ]);
  });

  it("keeps the author's order", () => {
    const saved: ResultsBlockKey[] = ["topics", "scales", "indicators", "summary"];
    expect(resolveBlockOrder(saved, DEFAULT_BLOCK_ORDER)).toEqual(saved);
  });

  it("appends a key the saved order does not mention, in template order", () => {
    expect(resolveBlockOrder(["topics", "scales"], DEFAULT_BLOCK_ORDER)).toEqual([
      "topics",
      "scales",
      "summary",
      "indicators",
    ]);
  });

  it("drops an unknown key", () => {
    expect(resolveBlockOrder(["topics", "legacy" as ResultsBlockKey], DEFAULT_BLOCK_ORDER)).toEqual([
      "topics",
      "summary",
      "scales",
      "indicators",
    ]);
  });

  it("drops a duplicate", () => {
    expect(resolveBlockOrder(["topics", "topics"], DEFAULT_BLOCK_ORDER)).toEqual([
      "topics",
      "summary",
      "scales",
      "indicators",
    ]);
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Команда: `npm test -- shared/template/__tests__/results-order.test.ts`
Ожидание: FAIL, «Failed to resolve import "../results-order"».

- [ ] **Шаг 3. Написать модуль**

```ts
/**
 * @module shared/template/results-order
 *
 * Order of the four sub-blocks under the results umbrella (PRD-49 §3).
 *
 * The saved order is a HINT, not a contract: a template may add a sub-block later, and a
 * test saved before that must not lose it. So the resolver keeps what the author arranged
 * and appends whatever the template knows and the author never saw.
 *
 * Pure — no DOM, no Node.
 */

export type ResultsBlockKey = "summary" | "scales" | "indicators" | "topics";

/** Shipped order: the one the screen printed before this PRD, so nothing moves by itself. */
export const DEFAULT_BLOCK_ORDER: readonly ResultsBlockKey[] = ["summary", "scales", "indicators", "topics"];

/** The author's order, cleaned against what the template declares. */
export function resolveBlockOrder(
  saved: readonly ResultsBlockKey[] | undefined | null,
  templateOrder: readonly ResultsBlockKey[],
): ResultsBlockKey[] {
  const known = new Set(templateOrder);
  const out: ResultsBlockKey[] = [];
  for (const key of saved ?? []) {
    if (known.has(key) && !out.includes(key)) out.push(key);
  }
  for (const key of templateOrder) {
    if (!out.includes(key)) out.push(key);
  }
  return out;
}
```

- [ ] **Шаг 4. Убедиться, что тест проходит**

Команда: `npm test -- shared/template/__tests__/results-order.test.ts`
Ожидание: PASS, 5 тестов.

- [ ] **Шаг 5. Коммит**

```bash
git add shared/template/results-order.ts shared/template/__tests__/results-order.test.ts
git commit -m "feat(prd-49): порядок подблоков итогов"
```

---

## Задача 3. Объявление надписей в манифесте и проверка манифеста

**Файлы:**

- Изменить: `server/scorm/templates/default/manifest.json`
- Изменить: `server/services/template-validation.ts`
- Тест: `server/__tests__/template-validation.test.ts` (если файла нет — создать)

- [ ] **Шаг 1. Написать падающий тест проверки манифеста**

```ts
import { describe, it, expect } from "vitest";
import { validateLabelDeclarations } from "../services/template-validation";

describe("validateLabelDeclarations", () => {
  it("accepts a well-formed declaration list", () => {
    expect(
      validateLabelDeclarations([
        { key: "results.heading", group: "Первый уровень", label: "Зонтик", default: "Ваш результат" },
      ]),
    ).toEqual([]);
  });

  it("rejects a declaration without a default", () => {
    expect(
      validateLabelDeclarations([{ key: "results.heading", group: "G", label: "L" }]),
    ).toEqual(['labels[0] (results.heading): отсутствует "default"']);
  });

  it("rejects a duplicate key", () => {
    const decls = [
      { key: "results.heading", group: "G", label: "L", default: "A" },
      { key: "results.heading", group: "G", label: "L", default: "B" },
    ];
    expect(validateLabelDeclarations(decls)).toEqual(["labels[1]: ключ results.heading объявлен дважды"]);
  });

  it("accepts a template that declares no labels at all", () => {
    expect(validateLabelDeclarations(undefined)).toEqual([]);
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Команда: `npm test -- server/__tests__/template-validation.test.ts`
Ожидание: FAIL, «validateLabelDeclarations is not a function».

- [ ] **Шаг 3. Добавить проверку в `server/services/template-validation.ts`**

```ts
/**
 * PRD-49: static check of `manifest.labels[]`. A template that declares no labels is
 * valid — it keeps printing the hard-coded strings of its own layouts.
 */
export function validateLabelDeclarations(labels: unknown): string[] {
  if (labels === undefined || labels === null) return [];
  if (!Array.isArray(labels)) return ['labels: ожидается массив'];
  const errors: string[] = [];
  const seen = new Set<string>();
  labels.forEach((raw, i) => {
    const decl = (raw ?? {}) as Record<string, unknown>;
    const key = typeof decl.key === "string" ? decl.key : "";
    if (!key) {
      errors.push(`labels[${i}]: отсутствует "key"`);
      return;
    }
    if (seen.has(key)) {
      errors.push(`labels[${i}]: ключ ${key} объявлен дважды`);
      return;
    }
    seen.add(key);
    if (typeof decl.default !== "string") errors.push(`labels[${i}] (${key}): отсутствует "default"`);
  });
  return errors;
}
```

Затем подключить её к общей проверке манифеста: найти функцию, которая собирает ошибки манифеста
(рядом с проверкой `contentTemplates`, около строки 327 — «manifest schema»), и добавить в её
результат `...validateLabelDeclarations((manifest as Record<string, unknown>).labels)`.

- [ ] **Шаг 4. Убедиться, что тест проходит**

Команда: `npm test -- server/__tests__/template-validation.test.ts`
Ожидание: PASS, 4 теста.

- [ ] **Шаг 5. Объявить надписи в манифесте стандартного шаблона**

В `server/scorm/templates/default/manifest.json` поднять `"version"` до `1.6.0` и добавить раздел
верхнего уровня `labels` (рядом с `params`):

```json
"labels": [
  { "key": "results.heading", "group": "Первый уровень", "label": "Заголовок итогов", "default": "Ваш результат" },
  { "key": "results.recommendations", "group": "Первый уровень", "label": "Заголовок рекомендаций", "default": "Рекомендации" },
  { "key": "results.summary", "group": "Второй уровень", "label": "Подзаголовок сводки баллов", "default": "Общий балл" },
  { "key": "results.scales", "group": "Второй уровень", "label": "Подзаголовок шкал", "default": "По шкалам" },
  { "key": "results.indicators", "group": "Второй уровень", "label": "Подзаголовок показателей", "default": "По показателям" },
  { "key": "results.topics", "group": "Второй уровень", "label": "Подзаголовок тем", "default": "По темам" },
  { "key": "recommendations.courses", "group": "Группы рекомендаций", "label": "Подпись группы курсов", "default": "Пройти обучение", "defaults": { "report": "Рекомендации по курсам" } },
  { "key": "recommendations.events", "group": "Группы рекомендаций", "label": "Подпись группы мероприятий", "default": "Мероприятия", "defaults": { "report": "Рекомендуемые мероприятия" } },
  { "key": "recommendations.assets", "group": "Группы рекомендаций", "label": "Подпись группы материалов", "default": "Материалы" },
  { "key": "facts.questions", "group": "Числа сводки", "label": "Подпись числа вопросов", "default": "вопросов" },
  { "key": "facts.correct", "group": "Числа сводки", "label": "Подпись числа верных", "default": "верно" },
  { "key": "facts.points", "group": "Числа сводки", "label": "Подпись числа баллов", "default": "баллов" },
  { "key": "topic.correct", "group": "Карточка темы", "label": "Строка «Правильно»", "default": "Правильно" },
  { "key": "topic.points", "group": "Карточка темы", "label": "Строка «Баллов»", "default": "Баллов" },
  { "key": "section.eyebrow", "group": "Итоги раздела", "label": "Надпись над итогами раздела", "default": "Итоги раздела" }
],
"resultsBlockOrder": ["summary", "scales", "indicators", "topics"],
```

- [ ] **Шаг 6. Проверить, что манифест читается**

Команда: `node -e "const m=require('./server/scorm/templates/default/manifest.json'); console.log(m.labels.length, m.resultsBlockOrder.join(','))"`
Ожидание: `15 summary,scales,indicators,topics`.

ГОЧА: приложение читает манифест из БАЗЫ, а не с диска. Правка `manifest.json` не видна без
перезапуска сервера — при приёмке сверять по ответу `GET /api/templates`.

- [ ] **Шаг 7. Коммит**

```bash
git add server/services/template-validation.ts server/__tests__/template-validation.test.ts server/scorm/templates/default/manifest.json
git commit -m "feat(prd-49): объявление надписей в манифесте и его проверка"
```

---

## Задача 4. Схема настроек дизайна

**Файлы:**

- Изменить: `shared/schema.ts:1930-1941` (`designSettingsSchema`)
- Тест: `tests/design-settings-schema.test.ts` (создать)

- [ ] **Шаг 1. Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { designSettingsSchema } from "@shared/schema";

const BASE = { templateId: "default", templateVersion: "1.6.0", templateApiVersion: "1.0", params: {} };

describe("designSettingsSchema (PRD-49)", () => {
  it("keeps the stored labels", () => {
    const parsed = designSettingsSchema.parse({
      ...BASE,
      labels: { "results.scales": { on: true, text: "Профиль" }, "results.topics": { on: false } },
    });
    expect(parsed.labels?.["results.scales"]).toEqual({ on: true, text: "Профиль" });
    expect(parsed.labels?.["results.topics"]).toEqual({ on: false });
  });

  it("keeps the stored sub-block order", () => {
    const parsed = designSettingsSchema.parse({ ...BASE, resultsBlockOrder: ["topics", "scales"] });
    expect(parsed.resultsBlockOrder).toEqual(["topics", "scales"]);
  });

  it("stays valid without either field", () => {
    const parsed = designSettingsSchema.parse(BASE);
    expect(parsed.labels).toBeUndefined();
    expect(parsed.resultsBlockOrder).toBeUndefined();
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Команда: `npm test -- tests/design-settings-schema.test.ts`
Ожидание: FAIL — `labels` вырезается схемой (`z.object` отбрасывает незаявленные ключи), поле
приходит `undefined`.

- [ ] **Шаг 3. Расширить схему**

В `shared/schema.ts`, внутри `designSettingsSchema`, после `paramsByTheme`:

```ts
  /**
   * PRD-49: the test's own wording of the results-screen labels. Absent = the template's
   * own texts. A value is a record, not a bare string: «switched off» and «never touched»
   * must stay distinguishable (see `shared/template/labels`).
   */
  labels: z.record(z.string(), z.object({ on: z.boolean().optional(), text: z.string().optional() })).optional(),
  /** PRD-49: the author's order of the four sub-blocks under the results umbrella. */
  resultsBlockOrder: z.array(z.enum(["summary", "scales", "indicators", "topics"])).optional(),
```

- [ ] **Шаг 4. Убедиться, что тест проходит**

Команда: `npm test -- tests/design-settings-schema.test.ts`
Ожидание: PASS, 3 теста.

- [ ] **Шаг 5. Проверить типы**

Команда: `npm run check`
Ожидание: без ошибок.

- [ ] **Шаг 6. Коммит**

```bash
git add shared/schema.ts tests/design-settings-schema.test.ts
git commit -m "feat(prd-49): настройки дизайна принимают надписи и порядок подблоков"
```

---

## Задача 5. Контекст итогов: `result.blocks` и `labels`

**Файлы:**

- Изменить: `shared/template/context.ts`
- Изменить: `shared/template/result-context.ts:600-760` (`buildResultContext`)
- Тест: `shared/template/__tests__/result-context.blocks.test.ts` (создать)

- [ ] **Шаг 1. Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { buildResultContext } from "../result-context";

const INPUT = {
  passed: true,
  percent: 80,
  totalQuestions: 10,
  correct: 8,
  earnedPoints: 8,
  possiblePoints: 10,
  topicResults: [],
};

const LABELS = {
  "results.heading": "Ваш результат",
  "results.summary": "Общий балл",
  "results.scales": "По шкалам",
  "results.indicators": "По показателям",
  "results.topics": "По темам",
};

describe("buildResultContext — sub-blocks (PRD-49)", () => {
  it("carries the resolved labels as a nested tree", () => {
    const ctx = buildResultContext(INPUT, "Тест", { labels: LABELS, hasPassThreshold: true });
    expect((ctx.labels as Record<string, Record<string, string>>).results.scales).toBe("По шкалам");
  });

  it("lists only the visible sub-blocks, in the resolved order", () => {
    const ctx = buildResultContext(INPUT, "Тест", {
      labels: LABELS,
      hasPassThreshold: true,
      blockOrder: ["topics", "summary"],
    });
    expect(ctx.result.blocks?.map((b) => b.key)).toEqual(["summary"]);
    expect(ctx.result.blocks?.[0]).toMatchObject({ key: "summary", isSummary: true, heading: "Общий балл" });
  });

  it("gives a switched-off label an empty heading without dropping the block", () => {
    const ctx = buildResultContext(INPUT, "Тест", {
      labels: { ...LABELS, "results.summary": "" },
      hasPassThreshold: true,
    });
    expect(ctx.result.blocks?.[0]).toMatchObject({ key: "summary", heading: "" });
  });

  it("prints no umbrella heading when no sub-block is visible", () => {
    const ctx = buildResultContext({ ...INPUT, possiblePoints: 0 }, "Тест", { labels: LABELS });
    expect(ctx.result.blocks ?? []).toEqual([]);
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Команда: `npm test -- shared/template/__tests__/result-context.blocks.test.ts`
Ожидание: FAIL, `ctx.labels` undefined.

- [ ] **Шаг 3. Расширить контракт контекста**

В `shared/template/context.ts`, в интерфейс `CtxResult`, рядом с `hideScoreSummary`:

```ts
  /**
   * PRD-49. The visible sub-blocks of the results umbrella, already ordered and already
   * carrying their heading. The layout walks this ONE array instead of printing four
   * fixed sections, so the author's order is expressed in DATA — the print pipeline of
   * the PDF report reads the real DOM order and a CSS-only reorder would lie to it.
   */
  blocks?: CtxResultBlock[];
```

и рядом с ним:

```ts
/** One sub-block of the results umbrella (PRD-49). */
export interface CtxResultBlock {
  key: "summary" | "scales" | "indicators" | "topics";
  /** Effective heading; an empty string means the author switched the heading off. */
  heading: string;
  isSummary?: boolean;
  isScales?: boolean;
  isIndicators?: boolean;
  isTopics?: boolean;
}
```

В интерфейс `ResultRenderContext` добавить:

```ts
  /** PRD-49: resolved interface labels as a nested tree (`labels.results.scales`). */
  labels?: Record<string, unknown>;
```

- [ ] **Шаг 4. Собрать блоки в билдере**

В `shared/template/result-context.ts`: расширить `ResultContextOptions`:

```ts
  /** PRD-49: resolved labels of THIS screen, flat map from `shared/template/labels`. */
  labels?: Record<string, string>;
  /** PRD-49: the author's order of the sub-blocks; absent = the shipped order. */
  blockOrder?: ResultsBlockKey[];
```

и в конце `buildResultContext`, перед `return`:

```ts
  // PRD-49. The umbrella's sub-blocks: same visibility rules as before, only gathered into
  // one ordered array. `topics` has no `auto/show/hide` setting of its own — it is visible
  // exactly when there is a topic card to show, which is what the layout gated on before.
  const visible: Record<ResultsBlockKey, boolean> = {
    summary: !result.hideScoreSummary,
    scales: !!result.scales?.length,
    indicators: !!result.indicators?.length,
    topics: !!result.topicResults?.length,
  };
  const labels = opts.labels ?? {};
  const order = resolveBlockOrder(opts.blockOrder, DEFAULT_BLOCK_ORDER);
  const blocks = order
    .filter((key) => visible[key])
    .map((key) => ({
      key,
      heading: labels[`results.${key}`] ?? "",
      [BLOCK_FLAG[key]]: true,
    })) as CtxResultBlock[];
  if (blocks.length) result.blocks = blocks;
  return { course: { title }, result, ...(opts.labels ? { labels: labelsTree(labels) } : {}) };
```

с константой рядом с импортами:

```ts
/** Layout-facing flag per sub-block: the DSL has no equality test, only truthiness. */
const BLOCK_FLAG: Record<ResultsBlockKey, string> = {
  summary: "isSummary",
  scales: "isScales",
  indicators: "isIndicators",
  topics: "isTopics",
};
```

и импортами:

```ts
import { resolveBlockOrder, DEFAULT_BLOCK_ORDER, type ResultsBlockKey } from "./results-order";
import { labelsTree } from "./labels";
```

- [ ] **Шаг 5. Убедиться, что тест проходит**

Команда: `npm test -- shared/template/__tests__/result-context.blocks.test.ts`
Ожидание: PASS, 4 теста.

- [ ] **Шаг 6. Проверить, что прежние тесты контекста целы**

Команда: `npm test -- shared/template/__tests__/result-context.test.ts shared/template/__tests__/results-blocks.test.ts`
Ожидание: PASS.

- [ ] **Шаг 7. Коммит**

```bash
git add shared/template/context.ts shared/template/result-context.ts shared/template/__tests__/result-context.blocks.test.ts
git commit -m "feat(prd-49): контекст итогов несёт подблоки и надписи"
```

---

## Задача 6. Адаптивные итоги и итоги раздела

**Файлы:**

- Изменить: `shared/template/result-context.ts` (адаптивный билдер и `buildSectionResultContext`)
- Тест: `shared/template/__tests__/result-context.blocks.test.ts` (дописать)

- [ ] **Шаг 1. Дописать падающие тесты**

```ts
import { buildAdaptiveResultContext, buildSectionResultContext } from "../result-context";

describe("adaptive results and section results (PRD-49)", () => {
  it("adaptive results carry the same blocks and labels", () => {
    const ctx = buildAdaptiveResultContext(
      { ...INPUT, levels: [] } as never,
      "Тест",
      { labels: LABELS, hasPassThreshold: true } as never,
    );
    expect((ctx.labels as Record<string, Record<string, string>>).results.heading).toBe("Ваш результат");
    expect(ctx.result.blocks?.some((b) => b.isSummary)).toBe(true);
  });

  it("section results carry the labels tree", () => {
    const ctx = buildSectionResultContext(
      { topicName: "Раздел", totalQuestions: 5, correct: 3 } as never,
      "Тест",
      { labels: { "section.eyebrow": "Итоги раздела" } } as never,
    );
    expect((ctx.labels as Record<string, Record<string, string>>).section.eyebrow).toBe("Итоги раздела");
  });
});
```

Точные имена билдеров сверить по экспортам: `grep -n "^export function build" shared/template/result-context.ts`.

- [ ] **Шаг 2. Убедиться, что тесты падают**

Команда: `npm test -- shared/template/__tests__/result-context.blocks.test.ts`
Ожидание: FAIL на двух новых тестах.

- [ ] **Шаг 3. Провести надписи через оба билдера**

В адаптивном билдере повторить блок сборки из задачи 5 (он уже вызывает `fillMeasureBlocks` и
`resolveMeasures`, поэтому `result.scales` / `result.indicators` / `result.topicResults` там те же
поля). В `buildSectionResultContext` добавить только дерево надписей — подблоков у экрана раздела
нет:

```ts
  return { course: { title }, sectionResult, ...(opts.labels ? { labels: labelsTree(opts.labels) } : {}) };
```

- [ ] **Шаг 4. Убедиться, что тесты проходят**

Команда: `npm test -- shared/template/__tests__/result-context.blocks.test.ts shared/template/__tests__/section-result-context.test.ts`
Ожидание: PASS.

- [ ] **Шаг 5. Коммит**

```bash
git add shared/template/result-context.ts shared/template/__tests__/result-context.blocks.test.ts
git commit -m "feat(prd-49): надписи на адаптивных итогах и итогах раздела"
```

---

## Задача 7. Макет итогов стандартного шаблона

**Файлы:**

- Изменить: `server/scorm/templates/default/layouts/results.html:23-226`
- Тест: `shared/template/__tests__/results-layout.test.ts` (создать)

- [ ] **Шаг 1. Написать падающий тест рендера макета**

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { compile } from "../dsl";

const LAYOUT = fs.readFileSync(
  path.join(process.cwd(), "server/scorm/templates/default/layouts/results.html"),
  "utf-8",
);

const CTX = {
  course: { title: "Тест" },
  labels: { results: { heading: "Ваш результат", recommendations: "Рекомендации" } },
  result: {
    passClass: "is-pass",
    statusLabel: "Пройден",
    scorePercent: 80,
    blocks: [
      { key: "topics", heading: "По темам", isTopics: true },
      { key: "summary", heading: "Общий балл", isSummary: true },
    ],
    topicResults: [{ topicName: "Тема", passClass: "is-pass", statusLabel: "Пройден", percent: 80, total: 5, correct: 4 }],
  },
};

describe("results layout (PRD-49)", () => {
  it("prints the umbrella heading and the sub-block headings in the context order", () => {
    const html = compile(LAYOUT)(CTX);
    const umbrella = html.indexOf("Ваш результат");
    const topics = html.indexOf("По темам");
    const summary = html.indexOf("Общий балл");
    expect(umbrella).toBeGreaterThan(-1);
    expect(umbrella).toBeLessThan(topics);
    expect(topics).toBeLessThan(summary);
  });

  it("prints no umbrella heading when the author switched it off", () => {
    const html = compile(LAYOUT)({ ...CTX, labels: { results: { heading: "" } } });
    expect(html).not.toContain("tb-scene__hero--results");
  });

  it("prints a sub-block whose heading is switched off", () => {
    const blocks = [{ key: "summary", heading: "", isSummary: true }];
    const html = compile(LAYOUT)({ ...CTX, result: { ...CTX.result, blocks } });
    expect(html).toContain("tb-score-strip");
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Команда: `npm test -- shared/template/__tests__/results-layout.test.ts`
Ожидание: FAIL — макет печатает жёсткие заголовки и не читает `result.blocks`.

- [ ] **Шаг 3. Переписать середину макета**

Заменить участок от сводки баллов (строка 23) до конца блока тем (строка 190) на зонтик с циклом.
Внутренности каждого подблока переносятся БЕЗ изменений, кроме внешних путей: внутри `{{#each}}`
контекст — элемент массива, поэтому данные адресуются через `@root.`.

```html
      {{#if result.blocks}}
      {{#if labels.results.heading}}
      <h2 class="tb-scene__hero tb-scene__hero--s tb-scene__hero--results">{{ labels.results.heading }}</h2>
      {{/if}}
      {{#each result.blocks}}
      {{#unless @first}}<hr class="ou-separator ou-separator--horizontal">{{/unless}}
      {{#if heading}}<div class="tb-scene__q"><h3 class="tb-scene__subhead">{{ heading }}</h3></div>{{/if}}

      {{#if isSummary}}
      ВСТАВИТЬ строки 24-40 файла БЕЗ ИЗМЕНЕНИЙ (блок `tb-score-strip`): узлы `data-path`
      заполняет рендерер по атрибуту, а не по пути DSL, поэтому переписывать их не нужно.
      Подписи чисел заменить на {{ @root.labels.facts.questions }}, {{ @root.labels.facts.correct }},
      {{ @root.labels.facts.points }}.
      {{/if}}

      {{#if isScales}}
      ВСТАВИТЬ строки 50-134 файла, заменив ТОЛЬКО внешние пути: `{{result.scalesBlockClass}}` на
      `{{@root.result.scalesBlockClass}}`, `{{#if result.scalesChart}}` на `{{#if @root.result.scalesChart}}`,
      `{{#each result.scalesChart.*}}` на `{{#each @root.result.scalesChart.*}}`, `{{#each result.scales}}`
      на `{{#each @root.result.scales}}`. Внутренности этих циклов НЕ ТРОГАТЬ: там уже контекст элемента.
      {{/if}}

      {{#if isIndicators}}
      ВСТАВИТЬ строки 144-163 файла, заменив `{{#each result.indicators}}` на
      `{{#each @root.result.indicators}}`.
      {{/if}}

      {{#if isTopics}}
      ВСТАВИТЬ строки 169-189 файла, заменив `{{#each result.topicResults}}` на
      `{{#each @root.result.topicResults}}`, а строки «Правильно» и «Баллов» — на
      {{ @root.labels.topic.correct }} и {{ @root.labels.topic.points }}.
      {{/if}}
      {{/each}}
      {{/if}}
```

Номера строк — по исходному файлу ДО правки; сверять по `git show HEAD:server/scorm/templates/default/layouts/results.html`.

Блок рекомендаций остаётся ЗА циклом (он первого уровня) и получает надпись из контекста:

```html
      {{#if result.recommendations.hasAny}}
      <hr class="ou-separator ou-separator--horizontal">
      {{#if labels.results.recommendations}}
      <div class="tb-scene__q"><h3 class="tb-scene__subhead">{{ labels.results.recommendations }}</h3></div>
      {{/if}}
      ...
          <span class="tb-eyebrow">{{ labels.recommendations.courses }}</span>
      ...
          <span class="tb-eyebrow">{{ labels.recommendations.events }}</span>
      ...
          <span class="tb-eyebrow">{{ labels.recommendations.assets }}</span>
```

Подписи чисел сводки и строк карточки темы — так же: `{{ labels.facts.questions }}`,
`{{ labels.facts.correct }}`, `{{ labels.facts.points }}`, `{{ labels.topic.correct }}`,
`{{ labels.topic.points }}`.

ВАЖНО: узлы `data-path` внутри цикла остаются в единственном экземпляре (ветка `{{#if isSummary}}`
исполняется один раз), поэтому `renderScreenInto` заполняет их как прежде. Узел
`data-slot="protection-mark"` НЕ переносить внутрь цикла — он должен остаться выше зонтика.

- [ ] **Шаг 4. Убедиться, что тест проходит**

Команда: `npm test -- shared/template/__tests__/results-layout.test.ts`
Ожидание: PASS, 3 теста.

- [ ] **Шаг 5. Прогнать смежные тесты рендера**

Команда: `npm test -- shared/template/__tests__/render-screen.test.ts shared/template/__tests__/dsl.test.ts`
Ожидание: PASS. (Если файла `render-screen.test.ts` нет — пропустить, `dsl.test.ts` лежит рядом с модулем.)

- [ ] **Шаг 6. Коммит**

```bash
git add server/scorm/templates/default/layouts/results.html shared/template/__tests__/results-layout.test.ts
git commit -m "feat(prd-49): макет итогов печатает зонтик и подблоки из контекста"
```

---

## Задача 8. Макеты адаптивных итогов и итогов раздела

**Файлы:**

- Изменить: `server/scorm/templates/default/layouts/results.adaptive.html:25-172`
- Изменить: `server/scorm/templates/default/layouts/section-results.html:26`
- Тест: `shared/template/__tests__/results-layout.test.ts` (дописать)

- [ ] **Шаг 1. Дописать падающие тесты**

```ts
const ADAPTIVE = fs.readFileSync(
  path.join(process.cwd(), "server/scorm/templates/default/layouts/results.adaptive.html"),
  "utf-8",
);
const SECTION = fs.readFileSync(
  path.join(process.cwd(), "server/scorm/templates/default/layouts/section-results.html"),
  "utf-8",
);

describe("adaptive and section layouts (PRD-49)", () => {
  it("adaptive results walk the same blocks array", () => {
    const html = compile(ADAPTIVE)(CTX);
    expect(html).toContain("По темам");
    expect(html).not.toContain(">Результаты по темам<");
  });

  it("section results print the eyebrow from labels", () => {
    const html = compile(SECTION)({
      course: { title: "Тест" },
      labels: { section: { eyebrow: "Итоги части" } },
      sectionResult: { topicName: "Раздел", totalQuestions: 5, correct: 4 },
    });
    expect(html).toContain("Итоги части");
  });
});
```

- [ ] **Шаг 2. Убедиться, что тесты падают**

Команда: `npm test -- shared/template/__tests__/results-layout.test.ts`
Ожидание: FAIL на двух новых тестах.

- [ ] **Шаг 3. Переписать макеты**

В `results.adaptive.html` применить ту же схему «зонтик + `{{#each result.blocks}}`», что и в
задаче 7, с теми же ветками и теми же путями `@root.`. Надписи групп рекомендаций и чисел сводки —
из `labels.*`.

В `section-results.html` заменить строку 26:

```html
      {{#if labels.section.eyebrow}}<span class="tb-eyebrow">{{ labels.section.eyebrow }}</span>{{/if}}
```

и подписи чисел (строки 45 и 49) на `{{ labels.facts.questions }}` / `{{ labels.facts.correct }}`.

- [ ] **Шаг 4. Убедиться, что тесты проходят**

Команда: `npm test -- shared/template/__tests__/results-layout.test.ts`
Ожидание: PASS, 5 тестов.

- [ ] **Шаг 5. Коммит**

```bash
git add server/scorm/templates/default/layouts/results.adaptive.html server/scorm/templates/default/layouts/section-results.html shared/template/__tests__/results-layout.test.ts
git commit -m "feat(prd-49): адаптивные итоги и итоги раздела читают надписи"
```

---

## Задача 9. Веб-проводка

**Файлы:**

- Изменить: `server/services/result-context.ts:60-150` (`MeasuresSource`, `buildMeasuresInput`)
- Изменить: `server/routes/attempts.ts:210-270`
- Тест: `tests/routes.attempts.labels.test.ts` (создать)

- [ ] **Шаг 1. Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { resolveScreenLabels } from "../server/services/result-context";

const MANIFEST_LABELS = [
  { key: "results.scales", group: "G", label: "L", default: "По шкалам" },
  { key: "results.heading", group: "G", label: "L", default: "Ваш результат" },
];

describe("resolveScreenLabels", () => {
  it("resolves the template defaults for the results screen", () => {
    const map = resolveScreenLabels(MANIFEST_LABELS, { templateId: "default" } as never, "results");
    expect(map["results.scales"]).toBe("По шкалам");
  });

  it("applies the test's own wording", () => {
    const design = { templateId: "default", labels: { "results.scales": { on: true, text: "Профиль" } } };
    const map = resolveScreenLabels(MANIFEST_LABELS, design as never, "results");
    expect(map["results.scales"]).toBe("Профиль");
  });

  it("returns an empty map when the template declares no labels", () => {
    expect(resolveScreenLabels(undefined, { templateId: "default" } as never, "results")).toEqual({});
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Команда: `npm test -- tests/routes.attempts.labels.test.ts`
Ожидание: FAIL, «resolveScreenLabels is not a function».

- [ ] **Шаг 3. Добавить адаптер в `server/services/result-context.ts`**

```ts
/**
 * PRD-49. Effective labels of ONE screen for a delivered test: the manifest declarations
 * of the ACTIVE template, the test's own values on top. The report layer is applied by the
 * report builder, which knows its own overrides.
 */
export function resolveScreenLabels(
  declarations: readonly LabelDeclaration[] | undefined | null,
  design: DesignSettings | null | undefined,
  screen: LabelScreen,
  overrides: LabelValues = {},
): ResolvedLabels {
  if (!declarations?.length) return {};
  return resolveLabels(declarations, design?.labels ?? {}, overrides, screen);
}
```

- [ ] **Шаг 4. Прокинуть надписи в маршруте**

В `server/routes/attempts.ts`, в `resultsMaterialForAttempt`, рядом с чтением `blockSettings`:

```ts
    // PRD-49: надписи и порядок подблоков живут на ТЕСТЕ (design_settings_json), а не на
    // странице итогов: одна формулировка обслуживает экран, адаптивный экран, итоги раздела
    // и отчёт. Читаются из ВЫДАННОЙ версии — попытка показывает то, на чём её проходили.
    const design = (deliveredTest?.designSettingsJson ?? null) as DesignSettings | null;
    const templateLabels = await labelDeclarationsForTemplate(design?.templateId);
```

и вернуть в объекте источника:

```ts
      labels: resolveScreenLabels(templateLabels, design, "results"),
      blockOrder: design?.resultsBlockOrder,
```

`labelDeclarationsForTemplate` — тонкий чтец активного шаблона из БД (`storage.getTemplate(id)`,
поле `manifest.labels`); положить его рядом с прочими чтениями шаблона в том же маршруте.

В `server/services/result-context.ts` добавить оба поля в `MeasuresSource` и передать их в
`ResultContextOptions` там, где сегодня передаются `blockSettings` и `chartSettings`.

- [ ] **Шаг 5. Убедиться, что тест проходит**

Команда: `npm test -- tests/routes.attempts.labels.test.ts`
Ожидание: PASS, 3 теста.

- [ ] **Шаг 6. Прогнать тесты маршрута попыток**

Команда: `npm test -- tests/routes.attempts.coverage.test.ts`
Ожидание: PASS.

- [ ] **Шаг 7. Коммит**

```bash
git add server/services/result-context.ts server/routes/attempts.ts tests/routes.attempts.labels.test.ts
git commit -m "feat(prd-49): веб-хост разрешает надписи выданной версии теста"
```

---

## Задача 10. Проводка в пакет SCORM

**Файлы:**

- Изменить: `server/scorm/builders/test-json.ts:455-485`
- Изменить: `server/scorm/build-export-data.ts:70-90`
- Изменить: `server/scorm/template/app/render/viewResults.js:275-310`
- Тест: `tests/scorm-test-json.labels.test.ts` (создать)

- [ ] **Шаг 1. Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { buildTestJson } from "../server/scorm/builders/test-json";

describe("test.json labels (PRD-49)", () => {
  it("bakes the resolved labels and the sub-block order", () => {
    const data = {
      test: { id: "t1", title: "Тест" },
      designSettings: {
        templateId: "default",
        templateVersion: "1.6.0",
        templateApiVersion: "1.0",
        params: {},
        labels: { results: { scales: "Профиль" } },
        resultsBlockOrder: ["topics", "summary", "scales", "indicators"],
      },
    };
    const json = buildTestJson(data as never);
    expect(json.designSettings?.labels).toEqual({ results: { scales: "Профиль" } });
    expect(json.designSettings?.resultsBlockOrder).toEqual(["topics", "summary", "scales", "indicators"]);
  });
});
```

Точную сигнатуру сборщика сверить: `grep -n "^export function" server/scorm/builders/test-json.ts`.

- [ ] **Шаг 2. Убедиться, что тест падает**

Команда: `npm test -- tests/scorm-test-json.labels.test.ts`
Ожидание: FAIL — поля отсутствуют в собранном `designSettings`.

- [ ] **Шаг 3. Класть надписи в пакет**

В `server/scorm/builders/test-json.ts`, в ветке `if (data.designSettings)` (около строки 463),
дописать по образцу соседних необязательных полей:

```ts
      // PRD-49: в пакет едут УЖЕ РАЗРЕШЁННЫЕ надписи — манифеста в LMS нет, и второго
      // источника умолчаний у рантайма быть не может (так же устроен признак отчёта).
      ...(data.designSettings.labels ? { labels: data.designSettings.labels } : {}),
      ...(data.designSettings.resultsBlockOrder
        ? { resultsBlockOrder: data.designSettings.resultsBlockOrder }
        : {}),
```

В `server/scorm/build-export-data.ts` при сборке `designSettings` положить ПЛОСКУЮ карту
разрешённых надписей экрана (`resolveScreenLabels(...)`, без `labelsTree`) и порядок из
`design_settings_json`. Отчётный слой — отдельным полем `reportLabels` такой же плоской картой, он
нужен генератору PDF внутри пакета.

ФОРМА ОДНА НА ВЕСЬ ПУТЬ: плоская карта `ключ → текст` едет в пакет, приходит в `opts.labels` и
разворачивается в дерево ТОЛЬКО ядром, внутри `buildResultContext`. Второго места, где строится
дерево, быть не должно.

- [ ] **Шаг 4. Читать надписи в рантайме**

В `server/scorm/template/app/render/viewResults.js`, в функции, собирающей вход билдера (около
строки 286), добавить:

```js
  var ds = (typeof TEST_DATA !== 'undefined' && TEST_DATA.designSettings) || {};
  // PRD-49: надписи приезжают разрешёнными; рантайм только передаёт их ядру.
  var labels = ds.labels || null;
  var blockOrder = ds.resultsBlockOrder || null;
```

и передать `labels: labels, blockOrder: blockOrder` в опции `TBTemplate.buildResultContext`.
Рантайм ничего не разворачивает: он получил плоскую карту и отдаёт её ядру как есть.

- [ ] **Шаг 5. Убедиться, что тест проходит**

Команда: `npm test -- tests/scorm-test-json.labels.test.ts`
Ожидание: PASS.

- [ ] **Шаг 6. Собрать образец пакета и проверить глазами**

Команда: `npm run scorm:template`
Ожидание: пакет собран в `out/`; в `test.json` присутствуют `designSettings.labels` и
`designSettings.resultsBlockOrder`.

- [ ] **Шаг 7. Коммит**

```bash
git add server/scorm/builders/test-json.ts server/scorm/build-export-data.ts server/scorm/template/app/render/viewResults.js tests/scorm-test-json.labels.test.ts
git commit -m "feat(prd-49): надписи и порядок подблоков едут в пакет SCORM"
```

---

## Задача 11. Отчёт

**Файлы:**

- Изменить: `shared/report/report-context.ts`
- Изменить: `server/scorm/templates/default/layouts/report.html:60-240`
- Изменить: `server/scorm/templates/default/layouts/report.adaptive.html`
- Тест: `shared/report/__tests__/report-context.labels.test.ts` (создать)

- [ ] **Шаг 1. Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { buildReportContext } from "../report-context";

describe("report labels (PRD-49)", () => {
  it("prefers the report's own wording over the shared one", () => {
    const ctx = buildReportContext(
      { passed: true, percent: 80, totalQuestions: 5, correct: 4, earnedPoints: 4, possiblePoints: 5, topicResults: [] } as never,
      "Тест",
      {
        labels: { "results.scales": "По шкалам" },
        reportLabels: { "results.scales": "Профиль по шкалам" },
      } as never,
    );
    expect((ctx.labels as Record<string, Record<string, string>>).results.scales).toBe("Профиль по шкалам");
  });
});
```

Точное имя строителя контекста отчёта сверить: `grep -n "^export function" shared/report/report-context.ts`.

- [ ] **Шаг 2. Убедиться, что тест падает**

Команда: `npm test -- shared/report/__tests__/report-context.labels.test.ts`
Ожидание: FAIL.

- [ ] **Шаг 3. Применить отчётный слой**

В строителе контекста отчёта разрешать надписи для экрана `report`: значения теста, поверх них
`report_settings_json.labels`. Разрешение выполняет `resolveLabels` — второй реализации быть не
должно.

- [ ] **Шаг 4. Перевести макеты отчёта на надписи**

В `report.html` заменить жёсткие строки на `{{ labels.results.topics }}`, `{{ labels.results.scales }}`,
`{{ labels.results.indicators }}` (строка 167 — внутри `{{#if @first}}`), `{{ labels.results.recommendations }}`,
`{{ labels.recommendations.courses }}`, `{{ labels.recommendations.events }}`, каждую в гейте
`{{#if …}}`. То же в `report.adaptive.html`.

ВНИМАНИЕ: порядок разделов отчёта разрезает пагинатор (`shared/report/paginate-dom.ts`) по РЕАЛЬНОМУ
порядку DOM. Если отчёт печатает подблоки по `result.blocks`, разрез останется верным; CSS-порядок
применять нельзя.

- [ ] **Шаг 5. Убедиться, что тесты проходят**

Команда: `npm test -- shared/report/__tests__/report-context.labels.test.ts shared/report/__tests__`
Ожидание: PASS.

- [ ] **Шаг 6. Коммит**

```bash
git add shared/report/report-context.ts server/scorm/templates/default/layouts/report.html server/scorm/templates/default/layouts/report.adaptive.html shared/report/__tests__/report-context.labels.test.ts
git commit -m "feat(prd-49): отчёт печатает надписи со своим слоем переопределений"
```

---

## Задача 12. Слоты карточки показателя и шкалы

**Файлы:**

- Изменить: `shared/template/measure-view.ts:265-330`
- Изменить: `server/scorm/templates/default/layouts/results.html` (карточки шкал и показателей)
- Тест: `shared/template/__tests__/measure-view.test.ts` (дописать)

- [ ] **Шаг 1. Дописать падающие тесты**

```ts
describe("card slots (PRD-49)", () => {
  it("hides the card name when the author switched it off", () => {
    const view = buildMeasureView({
      key: "k", name: "Ознакомьтесь с описанием", value: "other", visibility: "level",
      interpretation: { outcomes: [{ code: "other", label: "Три стиля", text: "Описание" }] },
      showName: false,
    } as never, RAMP as never);
    expect(view.showName).toBe(false);
    expect(view.name).toBe("Ознакомьтесь с описанием");
  });

  it("hides the level slot but keeps the explanation", () => {
    const view = buildMeasureView({
      key: "k", name: "Другие стили", value: "other", visibility: "level",
      interpretation: { outcomes: [{ code: "other", label: "Три стиля", text: "Описание" }] },
      showLevel: false,
    } as never, RAMP as never);
    expect(view.showLevel).toBe(false);
    expect(view.levelLabel).toBe("Три стиля");
    expect(view.text).toBe("Описание");
  });

  it("shows both slots by default", () => {
    const view = buildMeasureView({
      key: "k", name: "Другие стили", value: "other", visibility: "level",
      interpretation: { outcomes: [{ code: "other", label: "Три стиля", text: "Описание" }] },
    } as never, RAMP as never);
    expect(view.showName).toBe(true);
    expect(view.showLevel).toBe(true);
  });
});
```

Имя строителя и форму `RAMP` взять из существующих тестов того же файла.

- [ ] **Шаг 2. Убедиться, что тесты падают**

Команда: `npm test -- shared/template/__tests__/measure-view.test.ts`
Ожидание: FAIL на трёх новых тестах.

- [ ] **Шаг 3. Добавить флаги слотов**

В `MeasureInput` (там же, где `visibility`):

```ts
  /**
   * PRD-49. Show the card's name / level slots. Absent = show, so every measure built
   * before this PRD keeps its card. The label itself is NOT cleared: it is needed by the
   * report, the analytics and the export — only the SCREEN slot is switched off.
   */
  showName?: boolean;
  showLevel?: boolean;
```

В `base` (около строки 273):

```ts
    showName: input.showName !== false,
    showLevel: input.showLevel !== false,
```

и те же два поля в `CtxMeasureView`.

- [ ] **Шаг 4. Разъединить слоты в макете**

В `results.html` карточка показателя (строки 146-161) становится:

```html
          <div class="ou-formsection__intro">
            {{#if showName}}<h4 class="ou-formsection__title">{{name}}</h4>{{/if}}
          </div>
          <div class="ou-formsection__body">
            {{#if showValue}}<span class="ou-slider__val"><strong>{{valueLabel}}</strong></span>{{/if}}
            {{#if hasBanner}}
            <div class="ou-banner ou-banner--subtle ou-banner--{{bannerVariant}}">
              <div class="ou-banner__body">
                {{#if showLevel}}{{#if levelLabel}}<div class="ou-banner__title">{{levelLabel}}</div>{{/if}}{{/if}}
                {{#if text}}<div class="ou-banner__desc">{{& textHtml }}</div>{{/if}}
              </div>
            </div>
            {{/if}}
          </div>
```

`hasBanner` вычисляет ядро — DSL не умеет логических выражений:

```ts
  // PRD-49: банер печатается, если есть ЧТО печатать — метка уровня или пояснение.
  // До этого `{{#if levelLabel}}` оборачивал и пояснение, поэтому «текст без заголовка»
  // был невыразим, а очистка метки молча уносила текст.
  view.hasBanner = (view.showLevel && !!view.levelLabel) || !!view.text;
```

В карточке шкалы (строки 90-97) закрыть название тем же гейтом `{{#if showName}}`, а метку уровня —
`{{#if showLevel}}{{#if levelLabel}}…{{/if}}{{/if}}`.

- [ ] **Шаг 5. Убедиться, что тесты проходят**

Команда: `npm test -- shared/template/__tests__/measure-view.test.ts shared/template/__tests__/results-layout.test.ts`
Ожидание: PASS.

- [ ] **Шаг 6. Коммит**

```bash
git add shared/template/measure-view.ts server/scorm/templates/default/layouts/results.html shared/template/__tests__/measure-view.test.ts
git commit -m "feat(prd-49): слоты карточки показателя выключаются независимо"
```

---

## Задача 13. Тумблеры слотов в редакторах шкал и показателей

**Файлы:**

- Изменить: `client/src/features/tests/editor/sections/result-variables-section.tsx`
- Изменить: `client/src/features/tests/editor/sections/scales-section.tsx`
- Изменить: `server/services/result-context.ts` (чтение `config_json.showLabel` / `showLevel`)
- Тест: `client/src/features/tests/editor/sections/__tests__/result-variables-section.slots.test.tsx` (создать)

- [ ] **Шаг 1. Написать падающий тест**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResultVariablesSection } from "../result-variables-section";

describe("card slot toggles (PRD-49)", () => {
  it("stores showLabel: false when the author switches the name off", () => {
    const onChange = vi.fn();
    render(
      <ResultVariablesSection
        variables={[{ id: "v1", name: "style", label: "Ваш стиль", type: "string", configJson: {}, learnerVisibility: "level" }]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Показывать название"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: "v1", configJson: expect.objectContaining({ showName: false }) }),
    );
  });
});
```

Пропсы и обработчики сверить по существующим тестам секции в
`client/src/features/tests/editor/sections/__tests__/`.

- [ ] **Шаг 2. Убедиться, что тест падает**

Команда: `npm test -- client/src/features/tests/editor/sections/__tests__/result-variables-section.slots.test.tsx`
Ожидание: FAIL, элемент «Показывать название» не найден.

- [ ] **Шаг 3. Добавить тумблеры**

В карточку переменной результата, рядом с полем «Видимость для обучающегося», добавить два
переключателя дизайн-системы (компонент `Switch` из `@universityrt/ui-kit`; сырые `.ou-*` классы не
писать):

```tsx
<Switch
  label="Показывать название"
  checked={variable.configJson?.showName !== false}
  onChange={(on) => onChange({ ...variable, configJson: { ...variable.configJson, showName: on } })}
/>
<Switch
  label="Показывать уровень"
  checked={variable.configJson?.showLevel !== false}
  onChange={(on) => onChange({ ...variable, configJson: { ...variable.configJson, showLevel: on } })}
/>
```

То же в карточке шкалы. В `server/services/result-context.ts`, в `buildMeasuresInput`, прокинуть
флаги в `MeasureInput`:

```ts
      showName: (s.configJson as Record<string, unknown>)?.showName !== false,
      showLevel: (s.configJson as Record<string, unknown>)?.showLevel !== false,
```

и то же для показателей. В рантайме пакета (`viewResults.js`) — так же, из `configJson` строк,
которые уже едут в `test.json`.

- [ ] **Шаг 4. Убедиться, что тест проходит**

Команда: `npm test -- client/src/features/tests/editor/sections/__tests__/result-variables-section.slots.test.tsx`
Ожидание: PASS.

- [ ] **Шаг 5. Коммит**

```bash
git add client/src/features/tests/editor/sections/result-variables-section.tsx client/src/features/tests/editor/sections/scales-section.tsx server/services/result-context.ts client/src/features/tests/editor/sections/__tests__/result-variables-section.slots.test.tsx
git commit -m "feat(prd-49): тумблеры слотов карточки в редакторах шкал и показателей"
```

---

## Задача 14. Панель «Итоги» во вкладке «Оформление»

**Файлы:**

- Создать: `client/src/features/tests/editor/sections/results-labels-pane.tsx`
- Изменить: `client/src/features/tests/editor/sections/design-section.tsx:100-300`
- Тест: `client/src/features/tests/editor/sections/__tests__/results-labels-pane.test.tsx`

- [ ] **Шаг 1. Написать падающий тест**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResultsLabelsPane } from "../results-labels-pane";

const DECLS = [
  { key: "results.heading", group: "Первый уровень", label: "Заголовок итогов", default: "Ваш результат" },
  { key: "results.scales", group: "Второй уровень", label: "Подзаголовок шкал", default: "По шкалам" },
];

describe("ResultsLabelsPane", () => {
  it("shows the template default as the field placeholder", () => {
    render(<ResultsLabelsPane declarations={DECLS} labels={{}} order={undefined} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Подзаголовок шкал")).toHaveAttribute("placeholder", "По шкалам");
  });

  it("stores the author's wording", () => {
    const onChange = vi.fn();
    render(<ResultsLabelsPane declarations={DECLS} labels={{}} order={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Подзаголовок шкал"), { target: { value: "Профиль" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ labels: { "results.scales": { on: true, text: "Профиль" } } }),
    );
  });

  it("switches a label off", () => {
    const onChange = vi.fn();
    render(<ResultsLabelsPane declarations={DECLS} labels={{}} order={undefined} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole("switch")[1]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ labels: { "results.scales": { on: false } } }),
    );
  });

  it("moves a sub-block up", () => {
    const onChange = vi.fn();
    render(<ResultsLabelsPane declarations={DECLS} labels={{}} order={undefined} onChange={vi.fn()} onOrderChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Переместить «По шкалам» выше" }));
    expect(onChange).toHaveBeenCalledWith(["scales", "summary", "indicators", "topics"]);
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Команда: `npm test -- client/src/features/tests/editor/sections/__tests__/results-labels-pane.test.tsx`
Ожидание: FAIL, модуль не найден.

- [ ] **Шаг 3. Написать панель**

Компонент рисуется ТОЛЬКО примитивами дизайн-системы (`Switch`, `Input`, `Button`, `FormSection`);
сырые `ou-*` классы и Tailwind запрещены. Требования:

- надписи сгруппированы по `declaration.group`, порядок групп — порядок первого появления;
- у каждой строки переключатель (значение `values[key]?.on !== false`) и поле ввода
  (`values[key]?.text ?? ""`, `placeholder` = `declaration.default`);
- поле выключенной надписи заблокировано;
- список подблоков со стрелками «выше»/«ниже», подписи берутся из надписей второго уровня;
- `onChange` отдаёт целиком новый объект `labels`, `onOrderChange` — новый массив ключей.

- [ ] **Шаг 4. Убедиться, что тесты проходят**

Команда: `npm test -- client/src/features/tests/editor/sections/__tests__/results-labels-pane.test.tsx`
Ожидание: PASS, 4 теста.

- [ ] **Шаг 5. Подключить панель к вкладке «Оформление»**

В `design-section.tsx` добавить пункт `{ key: "results", label: "Итоги" }` в список панелей (рядом
с `{ key: "report", label: "Отчёт о результатах" }`) и отрисовать `ResultsLabelsPane`, связав его с
черновиком настроек дизайна (`use-design-settings`): изменения кладутся в `draft.labels` и
`draft.resultsBlockOrder`, сохраняются общей кнопкой сохранения вкладки.

В панели «Отчёт о результатах» добавить тот же список в режиме переопределения: строка начинается
в состоянии «как на экране итогов» и переводится в свою формулировку; значения кладутся в
`report_settings_json.labels`.

- [ ] **Шаг 6. Прогнать тесты вкладки**

Команда: `npm test -- client/src/features/tests/editor/sections/__tests__`
Ожидание: PASS.

- [ ] **Шаг 7. Коммит**

```bash
git add client/src/features/tests/editor/sections/results-labels-pane.tsx client/src/features/tests/editor/sections/design-section.tsx client/src/features/tests/editor/sections/__tests__/results-labels-pane.test.tsx
git commit -m "feat(prd-49): панель заголовков и порядка подблоков в «Оформлении»"
```

---

## Задача 15. Паритет шаблона «Сертификация»

**Файлы:**

- Изменить: `templates/certification/manifest.json`
- Изменить: `templates/certification/layouts/results.html`, `results.adaptive.html`,
  `section-results.html`, `report.html`, `report.adaptive.html`
- Тест: `shared/template/__tests__/results-layout.test.ts` (дописать)

- [ ] **Шаг 1. Дописать падающий тест паритета**

```ts
const CERT = fs.readFileSync(
  path.join(process.cwd(), "templates/certification/layouts/results.html"),
  "utf-8",
);

describe("certification parity (PRD-49)", () => {
  it("walks result.blocks like the default template", () => {
    const html = compile(CERT)(CTX);
    expect(html).toContain("По темам");
    expect(html).toContain("Общий балл");
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Команда: `npm test -- shared/template/__tests__/results-layout.test.ts`
Ожидание: FAIL на новом тесте.

- [ ] **Шаг 3. Перенести изменения**

Повторить задачи 3, 7, 8, 11 и 12 для шаблона «Сертификация»: раздел `labels[]` с теми же ключами в
манифесте, зонтик с `{{#each result.blocks}}` в макетах итогов, надписи в отчёте, разъединённые
слоты карточки. Паритет между шаблонами не проверяется автоматически — сверять глазами по списку
ключей из задачи 3.

- [ ] **Шаг 4. Убедиться, что тест проходит**

Команда: `npm test -- shared/template/__tests__/results-layout.test.ts`
Ожидание: PASS.

- [ ] **Шаг 5. Коммит**

```bash
git add templates/certification shared/template/__tests__/results-layout.test.ts
git commit -m "feat(prd-49): паритет шаблона «Сертификация» по надписям итогов"
```

---

## Задача 16. Документация

**Файлы:**

- Изменить: `docs/specs/spec-template-platform.md`
- Изменить: руководство автора по тестам (файл найти: `ls docs/guides`)

- [ ] **Шаг 1. Поднять формат шаблона до 1.4.0**

В таблицу версий добавить строку:

```markdown
| 1.4.0 | 2026-08-12 | Надписи интерфейса итогов объявляются шаблоном — раздел `labels[]`
(ключ, группа, подпись поля, `default`, необязательные `defaults.<экран>`); контекст `labels.*`
(§10.2); порядок подблоков итогов `resultsBlockOrder`; подблоки экрана итогов приходят массивом
`result.blocks`. Расширение обратно-совместимое: шаблон без `labels[]` печатает собственные строки. |
```

Дописать раздел с описанием `labels[]`, статических проверок и контекста, по образцу §8.4.1.

- [ ] **Шаг 2. Дополнить руководство автора**

Раздел про экран итогов: как переформулировать и выключить заголовок, как переставить подблоки, как
выключить название или уровень карточки. Обязательное правило: одна надпись — один смысловой слот;
лишний слот выключается, а не заполняется пересказом соседнего.

- [ ] **Шаг 3. Проверить разметку**

Команда: `npx markdownlint-cli2 "docs/specs/spec-template-platform.md" "docs/guides/**/*.md"`
Ожидание: `0 issues`.

- [ ] **Шаг 4. Коммит**

```bash
git add docs/specs/spec-template-platform.md docs/guides
git commit -m "docs(prd-49): формат шаблона 1.4.0 и руководство автора"
```

---

## Приёмка

Выполняется ПОСЛЕ всех задач, по правилам приёмки этого проекта.

- [ ] **Веб-хост.** Учётка приёмки в dev, тест со шкалами и показателями: заголовки по умолчанию
  совпадают с новой структурой; переформулированный заголовок виден; выключенный исчезает, блок
  остаётся; порядок подблоков соответствует настройке. Проверять в браузере, содержимое сцены
  читать через Shadow DOM.
- [ ] **Пакет SCORM.** «Тестовый прогон» (отладочный плеер) на том же тесте: надписи и порядок
  совпадают с веб-экраном. Затем сборка пакета и прогон на стенде WebTutor.
- [ ] **Отчёт PDF.** Скачать отчёт: общие формулировки применились; переопределённая формулировка
  видна только в отчёте; разрез страниц не съехал.
- [ ] **Карточка показателя.** Случай со снимка PRD-49: выключить «Показывать название» —
  остаётся один баннер с подводкой и текстом; метка уровня в базе не изменилась.
- [ ] **Полный прогон тестов** — только после явного разрешения владельца:
  `npm test`, при необходимости `npm run test:cov` (запускать в одиночку).
