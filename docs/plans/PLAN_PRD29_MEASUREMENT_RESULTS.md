# PRD-29 Measurement Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показать ученику шкалы (PRD-5) и показатели (PRD-2) на экране итогов — со значением,
уровнем, толкованием и рекомендациями — одинаково в вебе и в SCORM-пакете.

**Architecture:** Вся новая логика — чистые модули в `shared/`, которые оба хоста уже
делят через `TBTemplate`. Ядро готовит к отрисовке ВСЁ: цвет зоны, её геометрию, позицию
маркера, метку уровня, вид рендера после отката. Разметка и DSL не считают ничего. Хранение —
в существующем `scales.config_json` и в новой колонке `result_variables.config_json`; из
скалярных колонок меняется только `show_to_learner` (булев becomes перечень). Экран итогов
остаётся ОДНИМ макетом `results`, блоки которого включаются настройками варианта.

**Tech Stack:** TypeScript (Node/Express, Drizzle, Zod), React 19 + `@universityrt/ui-kit`,
Vitest (`npm test`), plain-JS SCORM runtime (`server/scorm/**`), ExcelJS.
Спецификация: [docs/specs/prd-29/measurement-results.md](../specs/prd-29/measurement-results.md).

---

## Roadmap (разделы спецификации → задачи плана)

| Этап | Разделы PRD | Задачи |
| --- | --- | --- |
| Э0 — эскиз | 8.2, 8.3, 6.5 | Task 1 |
| Э1 — контракт и чистое ядро | 3, 4.1, 4.2, 6.2, 6.3, 6.4 | Task 2, 3, 4, 5 |
| Э2 — хранение | 5.3, 6.1, 10 | Task 6 |
| Э3 — сбор рекомендаций | 7 | Task 7 |
| Э4 — веб-контекст и блоки | 8.1, 9 | Task 8 |
| Э5 — разметка и стили | 8.1, 8.2, 8.3 | Task 9, 10 |
| Э6 — параметры варианта дизайна | 6.2, 6.4, 8.1 | Task 11 |
| Э7 — SCORM | 9 | Task 12 |
| Э8 — редакторы | 4, 5, 6.1 | Task 13, 14, 15 |
| Э9 — приёмка | 11 | Task 16 |

Порядок обязателен: Task 1 → Task 2 → Task 3 → Task 4 → Task 5. Дальше Task 6, 7 независимы.
Task 8 после Task 4, 5, 7. Task 9, 10 после Task 8. Task 11 после Task 9. Task 12 после Task 8.
Task 13, 14, 15 после Task 6. Task 16 последняя.

## Naming contract

Единые имена во всех задачах. Отклонение = дефект.

```ts
/** Методологическая оценка уровня; оформление задаёт шаблон, не данные. */
export type LevelTone = "favorable" | "neutral" | "attention" | "critical";

/** Благоприятное направление шкалы. НЕ путать с `direction: positive | inverse`. */
export type Valence = "higher_is_better" | "lower_is_better" | "none";

/** Что видит ученик. Заменяет булев `show_to_learner`. */
export type LearnerVisibility = "hidden" | "level" | "level_and_value";

/** Вид слота значения в карточке. */
export type RenderKind = "label" | "value" | "value_of_max" | "ring" | "band_ruler" | "gradient_bar";

/** Одна рекомендация: курс, мероприятие или материал. */
export interface RecommendationLink { title: string; url?: string }

/** Унифицированный блок обратной связи (форма `tests.feedback_json`). */
export interface FeedbackBlock {
  text?: string;
  links?: RecommendationLink[];
  events?: RecommendationLink[];
  assets?: RecommendationLink[];
}

/** Интервал числового толкования. Расширяет существующий ScaleBand. */
export interface InterpretationBand {
  min: number;
  max: number;
  level: string;
  label?: string;
  text?: string;
  tone?: LevelTone;
  feedback?: FeedbackBlock;
}

/** Исход строкового/булева толкования. */
export interface InterpretationOutcome {
  code: string;
  label: string;
  text?: string;
  tone?: LevelTone;
  feedback?: FeedbackBlock;
}

/** Тройка HSL как она хранится в параметрах дизайна: "142 76% 36%". */
export type HslTriple = string;

/** Опорные цвета рампы: благоприятный край, необязательная середина, неблагоприятный край. */
export interface LevelRamp { favorable: HslTriple; mid: HslTriple | null; unfavorable: HslTriple }

/** Одна зона линейки, полностью подготовленная ядром. */
export interface CtxMeasureZone {
  label: string;
  leftPercent: number;
  widthPercent: number;
  color: HslTriple;
  current: boolean;
}

/** Карточка шкалы или показателя на экране итогов. */
export interface CtxMeasureView {
  key: string;
  name: string;
  renderKind: RenderKind;
  showValue: boolean;
  valueLabel: string;
  levelLabel: string;
  tone: LevelTone;
  text?: string;
  zones: CtxMeasureZone[];
  markerPercent?: number;
  percent?: number;
  ringDashoffset?: number;
}

/** Сводный блок рекомендаций внизу экрана. */
export interface CtxRecommendations {
  texts: string[];
  links: RecommendationLink[];
  events: RecommendationLink[];
  assets: RecommendationLink[];
  hasAny: boolean;
}
```

## File Structure

| Файл | Ответственность |
| --- | --- |
| `shared/scales/interpretation.ts` (создать) | типы толкования, поиск интервала по числу и исхода по коду, разбор `config_json` |
| `shared/scales/domain.ts` (создать) | расчёт домена шкалы по вкладам вопросов |
| `shared/template/level-ramp.ts` (создать) | арифметика HSL, интерполяция рампы, цвет зоны по позиции |
| `shared/template/measure-view.ts` (создать) | сборка `CtxMeasureView`: откат вида, зоны, маркер, кольцо |
| `shared/template/recommendations.ts` (создать) | сбор рекомендаций из трёх источников и дедупликация |
| `shared/template/results-blocks.ts` (создать) | разрешение настроек `auto`/`show`/`hide` в три флага блоков |
| `shared/template/context.ts` (править) | добавить `result.scales`, `result.indicators`, `result.recommendations` |
| `shared/template/result-context.ts` (править) | принять новые входы и положить их в контекст |
| `shared/schema.ts` (править) | `config_json` у `result_variables`, `learner_visibility` у обеих таблиц |
| `migrations/036_prd29_measurement_results.sql` (создать) | колонки и перенос данных |
| `server/services/scoring-config.ts` (править) | прокинуть домен, valence и толкования в спеки |
| `server/services/result-context.ts` (править) | собрать входы для новых блоков |
| `server/scorm/builders/test-json.ts` (править) | запечь новые поля в `TEST_DATA` |
| `server/scorm/template/app/render/resultsPage.js` (править) | собрать те же входы в пакете |
| `server/scorm/templates/default/layouts/results.html` (править) | блоки показателей, шкал и рекомендаций |
| `server/scorm/templates/default/styles/theme.css` (править) | токены тона, линейка, маркер |
| `server/scorm/templates/default/manifest.json` (править) | параметры схемы и видов, настройки блоков |
| `client/src/features/tests/editor/sections/scales-section.tsx` (править) | домен, направление, толкования, видимость |
| `client/src/features/tests/editor/sections/result-variables-section.tsx` (править) | перечень исходов, видимость |
| `docs/wireframes/prd29-measurement-results.html` (создать) | эскиз экрана |

---

## Task 1: Эскиз экрана итогов

Правило проекта: UI не реализуется без согласованного эскиза. Кода в этой задаче нет.

**Files:**

- Create: `docs/wireframes/prd29-measurement-results.html`

- [ ] **Step 1: Прочитать образец каркаса эскиза**

Открыть `docs/wireframes/tpl-standard-scene-ds.html` и `docs/wireframes/prd19-results.html`.
Взять оттуда навбар с тумблерами Dark/Compact/Аннотации, блоки `wf-notes` и `wf-mapping`.

- [ ] **Step 2: Свериться с каталогом классов дизайн-системы**

Перед вёрсткой открыть `client/src/styles/vendor/university-rt.css` и убедиться в
существовании каждого используемого `ou-*` класса. Контролёр эскизов НЕ ловит несуществующий
класс. Известные ловушки: `ou-skeleton` не существует; у `ou-textarea` и `ou-banner` нет
модификатора `--m`.

- [ ] **Step 3: Сверстать четыре состояния холста**

В холсте — только реальный UI (`ou-*` и `tb-components.css`), никаких локальных render-классов.
Состояния переключаются кнопками навбара:

1. `s-measurement` — измерительная методика: блок показателей, блок шкал, рекомендации;
2. `s-control` — контрольный тест: экран как сегодня, новых блоков нет;
3. `s-mixed` — смешанный: все блоки в порядке PRD 8.2;
4. `s-narrow` — измерительная методика на 360 px: подписаны текущая зона и края домена.

Данные для холста берутся из референсной книги: три шкалы (27 из 45 «Высокий»,
6 из 25 «Умеренная», 30 из 40 «Умеренное») и профиль «Возрастающее истощение».
У третьей шкалы благоприятный край СЛЕВА — эскиз обязан это показывать.

- [ ] **Step 4: Заполнить пояснения**

В `wf-notes` — правила: порядок блоков фиксирован, цвет никогда не единственный носитель
смысла, отдельной цветовой легенды нет. В `wf-mapping` — соответствие блоков разделам PRD.

- [ ] **Step 5: Снять скриншот в браузере**

Эскиз проверяется в реальном браузере, а не глазами по разметке. Запуск через глобальный
`chrome-headless-shell.exe` и `http.server` из КОРНЯ репозитория; временная копия — в
`.playwright-mcp/`. Временные файлы в корне запрещены.

- [ ] **Step 6: Отдать эскиз на согласование**

Показать скриншоты четырёх состояний. Не переходить к Task 2 до явного согласования:
реализация UI без утверждённого эскиза откатывается.

- [ ] **Step 7: Commit**

```bash
git add docs/wireframes/prd29-measurement-results.html
git commit -m "docs(prd-29): эскиз экрана итогов измерительного теста"
```

---

## Task 2: Типы толкования и поиск исхода

**Files:**

- Create: `shared/scales/interpretation.ts`
- Test: `shared/scales/__tests__/interpretation.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// shared/scales/__tests__/interpretation.test.ts
import { describe, it, expect } from "vitest";
import {
  findBand,
  findOutcome,
  parseScaleInterpretation,
  parseIndicatorInterpretation,
} from "../interpretation";

const MASLACH_EE = [
  { min: 0, max: 14, level: "low", label: "Низкий", text: "Ресурс в норме." },
  { min: 15, max: 24, level: "moderate", label: "Умеренный" },
  { min: 25, max: 45, level: "high", label: "Высокий", text: "Ресурс расходуется быстрее." },
];

describe("findBand", () => {
  it("возвращает интервал, в который попало значение", () => {
    expect(findBand(MASLACH_EE, 27)?.level).toBe("high");
    expect(findBand(MASLACH_EE, 14)?.level).toBe("low");
    expect(findBand(MASLACH_EE, 15)?.level).toBe("moderate");
  });

  it("включает обе границы", () => {
    expect(findBand(MASLACH_EE, 0)?.level).toBe("low");
    expect(findBand(MASLACH_EE, 45)?.level).toBe("high");
  });

  it("возвращает null вне интервалов и на пустом списке", () => {
    expect(findBand(MASLACH_EE, 46)).toBeNull();
    expect(findBand([], 10)).toBeNull();
  });
});

describe("findOutcome", () => {
  const OUTCOMES = [
    { code: "engaged", label: "Вовлечённость" },
    { code: "burnout", label: "Выгорание", text: "Требует внимания специалиста." },
  ];

  it("находит исход по коду", () => {
    expect(findOutcome(OUTCOMES, "burnout")?.label).toBe("Выгорание");
  });

  it("возвращает null для неизвестного кода", () => {
    expect(findOutcome(OUTCOMES, "unknown")).toBeNull();
  });

  it("приводит булево значение к кодам true/false", () => {
    const b = [{ code: "true", label: "Да" }, { code: "false", label: "Нет" }];
    expect(findOutcome(b, true)?.label).toBe("Да");
    expect(findOutcome(b, false)?.label).toBe("Нет");
  });
});

describe("parseScaleInterpretation", () => {
  it("читает домен, направление и интервалы из config_json", () => {
    const parsed = parseScaleInterpretation({
      domainMin: 0,
      domainMax: 45,
      valence: "lower_is_better",
      bands: MASLACH_EE,
    });
    expect(parsed.domainMin).toBe(0);
    expect(parsed.domainMax).toBe(45);
    expect(parsed.valence).toBe("lower_is_better");
    expect(parsed.bands).toHaveLength(3);
  });

  it("выводит домен из охвата интервалов, когда он не задан", () => {
    const parsed = parseScaleInterpretation({ bands: MASLACH_EE });
    expect(parsed.domainMin).toBe(0);
    expect(parsed.domainMax).toBe(45);
  });

  it("даёт нейтральное направление и пустой домен на пустом конфиге", () => {
    const parsed = parseScaleInterpretation({});
    expect(parsed.valence).toBe("none");
    expect(parsed.domainMin).toBeNull();
    expect(parsed.domainMax).toBeNull();
    expect(parsed.bands).toEqual([]);
  });

  it("сортирует интервалы по возрастанию min", () => {
    const parsed = parseScaleInterpretation({
      bands: [{ min: 25, max: 45, level: "high" }, { min: 0, max: 14, level: "low" }],
    });
    expect(parsed.bands.map((b) => b.level)).toEqual(["low", "high"]);
  });
});

describe("parseIndicatorInterpretation", () => {
  it("читает перечень исходов", () => {
    const parsed = parseIndicatorInterpretation({
      outcomes: [{ code: "engaged", label: "Вовлечённость" }],
    });
    expect(parsed.outcomes).toHaveLength(1);
    expect(parsed.bands).toEqual([]);
  });

  it("читает интервалы для числового показателя", () => {
    const parsed = parseIndicatorInterpretation({ bands: MASLACH_EE });
    expect(parsed.bands).toHaveLength(3);
    expect(parsed.outcomes).toEqual([]);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- shared/scales/__tests__/interpretation.test.ts`
Expected: FAIL, «Cannot find module '../interpretation'».

- [ ] **Step 3: Реализовать модуль**

```ts
/**
 * @module shared/scales/interpretation
 *
 * The interpretation model shared by scales (PRD-5) and result variables (PRD-2):
 * an ordered list of outcomes carrying a label, an explanatory text, an optional
 * tone override and optional feedback. Only the MATCH differs — a numeric band for
 * numbers, an exact code for strings and booleans.
 *
 * Reading is defensive by design: the source is a jsonb column an author edits, so
 * every accessor degrades to a neutral default rather than throwing. A missing
 * domain falls back to the span of the bands, which is what a legacy scale (bands
 * without an explicit domain) effectively means.
 *
 * Pure — no DOM, no Node — bundled verbatim into the SCORM package.
 */

export type LevelTone = "favorable" | "neutral" | "attention" | "critical";
export type Valence = "higher_is_better" | "lower_is_better" | "none";
export type LearnerVisibility = "hidden" | "level" | "level_and_value";

export interface RecommendationLink { title: string; url?: string }

export interface FeedbackBlock {
  text?: string;
  links?: RecommendationLink[];
  events?: RecommendationLink[];
  assets?: RecommendationLink[];
}

export interface InterpretationBand {
  min: number;
  max: number;
  level: string;
  label?: string;
  text?: string;
  tone?: LevelTone;
  feedback?: FeedbackBlock;
}

export interface InterpretationOutcome {
  code: string;
  label: string;
  text?: string;
  tone?: LevelTone;
  feedback?: FeedbackBlock;
}

export interface ScaleInterpretation {
  domainMin: number | null;
  domainMax: number | null;
  valence: Valence;
  bands: InterpretationBand[];
}

export interface IndicatorInterpretation {
  domainMin: number | null;
  domainMax: number | null;
  valence: Valence;
  bands: InterpretationBand[];
  outcomes: InterpretationOutcome[];
}

const VALENCES: readonly Valence[] = ["higher_is_better", "lower_is_better", "none"];

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asBands(value: unknown): InterpretationBand[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const b = raw as Record<string, unknown>;
      const min = asNumber(b.min);
      const max = asNumber(b.max);
      if (min === null || max === null) return null;
      const band: InterpretationBand = { min, max, level: String(b.level ?? "") };
      if (b.label) band.label = String(b.label);
      if (b.text) band.text = String(b.text);
      if (b.tone) band.tone = b.tone as LevelTone;
      if (b.feedback) band.feedback = b.feedback as FeedbackBlock;
      return band;
    })
    .filter((b): b is InterpretationBand => b !== null)
    .sort((a, b) => a.min - b.min);
}

function asOutcomes(value: unknown): InterpretationOutcome[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const o = raw as Record<string, unknown>;
      const code = String(o.code ?? "");
      if (!code) return null;
      const outcome: InterpretationOutcome = { code, label: String(o.label ?? code) };
      if (o.text) outcome.text = String(o.text);
      if (o.tone) outcome.tone = o.tone as LevelTone;
      if (o.feedback) outcome.feedback = o.feedback as FeedbackBlock;
      return outcome;
    })
    .filter((o): o is InterpretationOutcome => o !== null);
}

function asValence(value: unknown): Valence {
  return VALENCES.indexOf(value as Valence) !== -1 ? (value as Valence) : "none";
}

/** Domain from the config, falling back to the span the bands themselves cover. */
function resolveDomain(
  config: Record<string, unknown>,
  bands: InterpretationBand[],
): { domainMin: number | null; domainMax: number | null } {
  const explicitMin = asNumber(config.domainMin);
  const explicitMax = asNumber(config.domainMax);
  if (explicitMin !== null && explicitMax !== null) {
    return { domainMin: explicitMin, domainMax: explicitMax };
  }
  if (bands.length === 0) return { domainMin: null, domainMax: null };
  return { domainMin: bands[0].min, domainMax: bands[bands.length - 1].max };
}

/** Parse a scale's `config_json` into its interpretation. Never throws. */
export function parseScaleInterpretation(configJson: unknown): ScaleInterpretation {
  const config = (configJson ?? {}) as Record<string, unknown>;
  const bands = asBands(config.bands);
  return { ...resolveDomain(config, bands), valence: asValence(config.valence), bands };
}

/** Parse a result variable's `config_json` into its interpretation. Never throws. */
export function parseIndicatorInterpretation(configJson: unknown): IndicatorInterpretation {
  const config = (configJson ?? {}) as Record<string, unknown>;
  const bands = asBands(config.bands);
  return {
    ...resolveDomain(config, bands),
    valence: asValence(config.valence),
    bands,
    outcomes: asOutcomes(config.outcomes),
  };
}

/** The band a numeric value falls into; both bounds are inclusive. */
export function findBand(bands: InterpretationBand[], value: number): InterpretationBand | null {
  for (const band of bands) {
    if (value >= band.min && value <= band.max) return band;
  }
  return null;
}

/** The outcome a string/boolean value maps to, matched by exact code. */
export function findOutcome(
  outcomes: InterpretationOutcome[],
  value: string | boolean | null | undefined,
): InterpretationOutcome | null {
  if (value === null || value === undefined) return null;
  const code = String(value);
  for (const outcome of outcomes) {
    if (outcome.code === code) return outcome;
  }
  return null;
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- shared/scales/__tests__/interpretation.test.ts`
Expected: PASS, 12 тестов.

- [ ] **Step 5: Commit**

```bash
git add shared/scales/interpretation.ts shared/scales/__tests__/interpretation.test.ts
git commit -m "feat(prd-29): модель толкования для шкал и показателей"
```

---

## Task 3: Расчёт домена шкалы по вкладам

**Files:**

- Create: `shared/scales/domain.ts`
- Test: `shared/scales/__tests__/domain.test.ts`

- [ ] **Step 1: Написать падающий тест**

Данные взяты из референсной книги: девять вопросов шкалы `emotional_exhaustion`, у каждого
шесть вариантов со значениями 0..5 и весом 1. Теоретический максимум — 45.

```ts
// shared/scales/__tests__/domain.test.ts
import { describe, it, expect } from "vitest";
import { computeScaleDomain } from "../domain";
import type { MeasurementSpec } from "../engine";

/** Nine questions, six graduations each (0..5), weight 1 — the Maslach EE scale. */
function maslachEE(): MeasurementSpec[] {
  const out: MeasurementSpec[] = [];
  for (let q = 1; q <= 9; q += 1) {
    for (let v = 0; v <= 5; v += 1) {
      out.push({
        questionId: `q${q}`,
        scaleKey: "emotional_exhaustion",
        sourceType: "option",
        sourceKey: String(v),
        value: v,
        weight: 1,
      });
    }
  }
  return out;
}

describe("computeScaleDomain", () => {
  it("для sum складывает максимальный вклад каждого вопроса", () => {
    expect(computeScaleDomain("sum", maslachEE())).toEqual({ min: 0, max: 45 });
  });

  it("учитывает вес", () => {
    const m: MeasurementSpec[] = [
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "0", value: 2, weight: 3 },
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "1", value: 1, weight: 3 },
    ];
    expect(computeScaleDomain("sum", m)).toEqual({ min: 0, max: 6 });
  });

  it("для avg берёт границы одного вклада", () => {
    expect(computeScaleDomain("avg", maslachEE())).toEqual({ min: 0, max: 5 });
  });

  it("для max и min берёт границы множества вкладов", () => {
    expect(computeScaleDomain("max", maslachEE())).toEqual({ min: 0, max: 5 });
    expect(computeScaleDomain("min", maslachEE())).toEqual({ min: 0, max: 5 });
  });

  it("учитывает отрицательные вклады в нижней границе", () => {
    const m: MeasurementSpec[] = [
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "0", value: -2, weight: 1 },
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "1", value: 3, weight: 1 },
    ];
    expect(computeScaleDomain("sum", m)).toEqual({ min: -2, max: 3 });
  });

  it("возвращает null на пустом списке вкладов", () => {
    expect(computeScaleDomain("sum", [])).toBeNull();
  });

  it("для weighted_avg возвращает null — домен считать нечем", () => {
    expect(computeScaleDomain("weighted_avg", maslachEE())).toBeNull();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- shared/scales/__tests__/domain.test.ts`
Expected: FAIL, «Cannot find module '../domain'».

- [ ] **Step 3: Реализовать модуль**

```ts
/**
 * @module shared/scales/domain
 *
 * Theoretical range of a scale, derived from its declared measurement units.
 *
 * A scale needs a domain before it can be drawn as a ruler, a ring or an "X of Y"
 * value: `normalization: none` leaves `percent` undefined, so geometry has nothing
 * to anchor on. Asking the methodologist to compute it by hand is avoidable — the
 * contributions are explicit, so the extremes follow from them.
 *
 * The result SEEDS the stored domain; it is never used at render time. Recomputing
 * on every render would silently reinterpret past results the moment a question is
 * added to the test (see PRD-29 §4.1).
 *
 * Pure — no DOM, no Node.
 */

import type { MeasurementSpec, ScaleAggregation } from "./engine";

export interface ScaleDomain { min: number; max: number }

/**
 * Theoretical `{ min, max }` of a scale over its measurement units, or `null` when
 * it cannot be derived (no units, or `weighted_avg` whose divisor depends on which
 * units actually fire).
 *
 * For `sum` exactly one unit per question contributes, so the extremes are the sums
 * of the per-question extremes. For `avg`, `max` and `min` the result is bounded by
 * a single unit, so the extremes are those of the whole set.
 */
export function computeScaleDomain(
  aggregation: ScaleAggregation,
  measurements: MeasurementSpec[],
): ScaleDomain | null {
  if (measurements.length === 0) return null;
  if (aggregation === "weighted_avg") return null;

  const deltas = measurements.map((m) => m.value * (m.weight ?? 1));

  if (aggregation === "sum") {
    const byQuestion = new Map<string, { min: number; max: number }>();
    measurements.forEach((m, i) => {
      const delta = deltas[i];
      const cur = byQuestion.get(m.questionId);
      if (!cur) byQuestion.set(m.questionId, { min: delta, max: delta });
      else byQuestion.set(m.questionId, { min: Math.min(cur.min, delta), max: Math.max(cur.max, delta) });
    });
    let min = 0;
    let max = 0;
    byQuestion.forEach((r) => {
      min += r.min;
      max += r.max;
    });
    return { min, max };
  }

  return { min: Math.min(...deltas), max: Math.max(...deltas) };
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- shared/scales/__tests__/domain.test.ts`
Expected: PASS, 7 тестов. Первый тест — контрольный: 45 совпадает с верхней границей
интервалов референсной книги.

- [ ] **Step 5: Commit**

```bash
git add shared/scales/domain.ts shared/scales/__tests__/domain.test.ts
git commit -m "feat(prd-29): расчёт домена шкалы по вкладам вопросов"
```

---

## Task 4: Рампа цветов уровней

**Files:**

- Create: `shared/template/level-ramp.ts`
- Test: `shared/template/__tests__/level-ramp.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// shared/template/__tests__/level-ramp.test.ts
import { describe, it, expect } from "vitest";
import { LEVEL_SCHEMES, parseHsl, rampColor, zoneColors } from "../level-ramp";

const TRAFFIC = LEVEL_SCHEMES.traffic;

describe("parseHsl", () => {
  it("разбирает тройку из параметров дизайна", () => {
    expect(parseHsl("142 76% 36%")).toEqual({ h: 142, s: 76, l: 36 });
  });

  it("возвращает null на мусоре", () => {
    expect(parseHsl("")).toBeNull();
    expect(parseHsl("#22c55e")).toBeNull();
  });
});

describe("rampColor", () => {
  it("на краях отдаёт опорные цвета без изменений", () => {
    expect(rampColor(TRAFFIC, 0)).toBe(TRAFFIC.unfavorable);
    expect(rampColor(TRAFFIC, 1)).toBe(TRAFFIC.favorable);
  });

  it("в середине отдаёт средний опорный цвет", () => {
    expect(rampColor(TRAFFIC, 0.5)).toBe(TRAFFIC.mid);
  });

  it("идёт по короткой дуге тона: между красным и жёлтым нет зелёного", () => {
    const parsed = parseHsl(rampColor(TRAFFIC, 0.25))!;
    expect(parsed.h).toBeGreaterThan(0);
    expect(parsed.h).toBeLessThan(38);
  });

  it("без середины интерполирует напрямую", () => {
    const ramp = { favorable: "0 0% 100%", mid: null, unfavorable: "0 0% 0%" };
    expect(parseHsl(rampColor(ramp, 0.5))!.l).toBe(50);
  });

  it("зажимает позицию в границах", () => {
    expect(rampColor(TRAFFIC, -1)).toBe(TRAFFIC.unfavorable);
    expect(rampColor(TRAFFIC, 2)).toBe(TRAFFIC.favorable);
  });
});

describe("zoneColors", () => {
  it("при higher_is_better благоприятный цвет у последней зоны", () => {
    const colors = zoneColors(TRAFFIC, 3, "higher_is_better");
    expect(colors[0]).toBe(TRAFFIC.unfavorable);
    expect(colors[2]).toBe(TRAFFIC.favorable);
  });

  it("при lower_is_better порядок обратный", () => {
    const colors = zoneColors(TRAFFIC, 3, "lower_is_better");
    expect(colors[0]).toBe(TRAFFIC.favorable);
    expect(colors[2]).toBe(TRAFFIC.unfavorable);
  });

  it("при none использует нейтральную рампу независимо от схемы", () => {
    const colors = zoneColors(TRAFFIC, 3, "none");
    expect(colors[0]).toBe(LEVEL_SCHEMES.neutral.unfavorable);
    expect(colors[2]).toBe(LEVEL_SCHEMES.neutral.favorable);
  });

  it("выдаёт ровно N цветов при любом N", () => {
    expect(zoneColors(TRAFFIC, 2, "higher_is_better")).toHaveLength(2);
    expect(zoneColors(TRAFFIC, 7, "higher_is_better")).toHaveLength(7);
  });

  it("единственную зону красит серединой рампы", () => {
    expect(zoneColors(TRAFFIC, 1, "higher_is_better")).toEqual([TRAFFIC.mid]);
  });

  it("на нуле зон отдаёт пустой список", () => {
    expect(zoneColors(TRAFFIC, 0, "higher_is_better")).toEqual([]);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- shared/template/__tests__/level-ramp.test.ts`
Expected: FAIL, «Cannot find module '../level-ramp'».

- [ ] **Step 3: Реализовать модуль**

```ts
/**
 * @module shared/template/level-ramp
 *
 * Colour ramp for interpretation levels, modelled on spreadsheet conditional
 * formatting: two endpoints plus an optional midpoint. A zone's colour follows from
 * its POSITION in the ordered list, so any number of levels is covered by three
 * reference colours — two zones land on the endpoints, three reproduce the classic
 * three-colour scale, seven give seven steps.
 *
 * Colours are HSL triples ("142 76% 36%") because that is how design params are
 * stored (see params-css) — the design CSS wraps them as `hsl(var(--x))`, so a
 * value must never carry its own `hsl(...)` or `#rrggbb` wrapper.
 *
 * Interpolation runs here rather than through CSS `color-mix()`: the SCORM package
 * renders inside whatever engine the LMS embeds, and computing in Core keeps both
 * hosts byte-identical.
 *
 * Hue interpolation takes the SHORT arc, which is also what a traffic-light ramp
 * wants: 142 down to 0 passes through yellow and orange rather than through blue.
 *
 * Pure — no DOM, no Node.
 */

import type { Valence } from "../scales/interpretation";

export type HslTriple = string;

export interface LevelRamp {
  favorable: HslTriple;
  mid: HslTriple | null;
  unfavorable: HslTriple;
}

/** Built-in schemes offered in the design params; `custom` supplies its own triples. */
export const LEVEL_SCHEMES: Record<"traffic" | "neutral", LevelRamp> = {
  traffic: { favorable: "142 76% 36%", mid: "38 92% 50%", unfavorable: "0 84% 60%" },
  neutral: { favorable: "215 16% 65%", mid: null, unfavorable: "215 16% 35%" },
};

export interface Hsl { h: number; s: number; l: number }

const HSL_RE = /^\s*(-?[\d.]+)\s+(-?[\d.]+)%\s+(-?[\d.]+)%\s*$/;

/** Parse a stored triple; `null` when the value is not in the design-param format. */
export function parseHsl(triple: HslTriple): Hsl | null {
  const m = HSL_RE.exec(String(triple ?? ""));
  if (!m) return null;
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

function formatHsl(c: Hsl): HslTriple {
  const round = (n: number) => Math.round(n * 10) / 10;
  return `${round(c.h)} ${round(c.s)}% ${round(c.l)}%`;
}

/** Interpolate hue along the SHORT arc of the colour wheel. */
function lerpHue(from: number, to: number, t: number): number {
  let delta = ((to - from) % 360 + 540) % 360 - 180;
  const h = from + delta * t;
  return (h % 360 + 360) % 360;
}

function lerp(from: Hsl, to: Hsl, t: number): Hsl {
  return {
    h: lerpHue(from.h, to.h, t),
    s: from.s + (to.s - from.s) * t,
    l: from.l + (to.l - from.l) * t,
  };
}

function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Colour at position `t` of the ramp: `0` is the unfavourable end, `1` the
 * favourable one. With a midpoint the ramp is two segments meeting at `0.5`.
 * Endpoints are returned verbatim so a scheme's exact triples survive round-trip.
 */
export function rampColor(ramp: LevelRamp, t: number): HslTriple {
  const p = clamp01(t);
  if (p === 0) return ramp.unfavorable;
  if (p === 1) return ramp.favorable;

  const low = parseHsl(ramp.unfavorable);
  const high = parseHsl(ramp.favorable);
  if (!low || !high) return ramp.mid ?? ramp.favorable;

  const mid = ramp.mid ? parseHsl(ramp.mid) : null;
  if (!mid) return formatHsl(lerp(low, high, p));
  if (p === 0.5) return ramp.mid as HslTriple;
  return p < 0.5
    ? formatHsl(lerp(low, mid, p / 0.5))
    : formatHsl(lerp(mid, high, (p - 0.5) / 0.5));
}

/**
 * Colours for `count` zones ordered by ascending value. `valence` decides which end
 * of the ramp the highest zone gets; `none` swaps the scheme for the neutral ramp,
 * because a typology has no better or worse level to signal.
 */
export function zoneColors(ramp: LevelRamp, count: number, valence: Valence): HslTriple[] {
  if (count <= 0) return [];
  const effective = valence === "none" ? LEVEL_SCHEMES.neutral : ramp;
  if (count === 1) return [rampColor(effective, 0.5)];

  const out: HslTriple[] = [];
  for (let i = 0; i < count; i += 1) {
    const position = i / (count - 1);
    out.push(rampColor(effective, valence === "lower_is_better" ? 1 - position : position));
  }
  return out;
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- shared/template/__tests__/level-ramp.test.ts`
Expected: PASS, 13 тестов.

- [ ] **Step 5: Commit**

```bash
git add shared/template/level-ramp.ts shared/template/__tests__/level-ramp.test.ts
git commit -m "feat(prd-29): рампа цветов уровней по образцу условного форматирования"
```

---

## Task 5: Сборка карточки шкалы и показателя

**Files:**

- Create: `shared/template/measure-view.ts`
- Test: `shared/template/__tests__/measure-view.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// shared/template/__tests__/measure-view.test.ts
import { describe, it, expect } from "vitest";
import { buildMeasureView, resolveRenderKind } from "../measure-view";
import { LEVEL_SCHEMES } from "../level-ramp";

const EE_BANDS = [
  { min: 0, max: 14, level: "low", label: "Низкий" },
  { min: 15, max: 24, level: "moderate", label: "Умеренный" },
  { min: 25, max: 45, level: "high", label: "Высокий", text: "Ресурс расходуется быстрее." },
];

function ee(overrides: Partial<Parameters<typeof buildMeasureView>[0]> = {}) {
  return buildMeasureView({
    key: "emotional_exhaustion",
    name: "Эмоциональное истощение",
    value: 27,
    visibility: "level_and_value",
    interpretation: { domainMin: 0, domainMax: 45, valence: "lower_is_better", bands: EE_BANDS },
    requestedKind: "band_ruler",
    ramp: LEVEL_SCHEMES.traffic,
    ...overrides,
  });
}

describe("resolveRenderKind", () => {
  it("оставляет запрошенный вид, когда он выполним", () => {
    expect(resolveRenderKind("band_ruler", { hasDomain: true, hasBands: true, isNumeric: true }))
      .toBe("band_ruler");
  });

  it("откатывает линейку до значения из максимума без интервалов", () => {
    expect(resolveRenderKind("band_ruler", { hasDomain: true, hasBands: false, isNumeric: true }))
      .toBe("value_of_max");
  });

  it("откатывает кольцо до значения без домена", () => {
    expect(resolveRenderKind("ring", { hasDomain: false, hasBands: false, isNumeric: true }))
      .toBe("value");
  });

  it("для нечислового значения всегда метка", () => {
    expect(resolveRenderKind("ring", { hasDomain: true, hasBands: true, isNumeric: false }))
      .toBe("label");
  });

  it("градиент требует домена и отсутствия интервалов", () => {
    expect(resolveRenderKind("gradient_bar", { hasDomain: true, hasBands: false, isNumeric: true }))
      .toBe("gradient_bar");
    expect(resolveRenderKind("gradient_bar", { hasDomain: true, hasBands: true, isNumeric: true }))
      .toBe("band_ruler");
  });
});

describe("buildMeasureView", () => {
  it("подставляет метку и текст сработавшего интервала", () => {
    const v = ee();
    expect(v.levelLabel).toBe("Высокий");
    expect(v.text).toBe("Ресурс расходуется быстрее.");
  });

  it("подписывает значение как «X из Y»", () => {
    expect(ee().valueLabel).toBe("27 из 45");
  });

  it("скрывает значение при видимости level", () => {
    const v = ee({ visibility: "level" });
    expect(v.showValue).toBe(false);
    expect(v.levelLabel).toBe("Высокий");
  });

  it("строит смежные зоны, покрывающие домен целиком", () => {
    const zones = ee().zones;
    expect(zones).toHaveLength(3);
    expect(zones[0].leftPercent).toBeCloseTo(0);
    // Ширины округлены до десятых, поэтому сумма 99.9 — сверяем с точностью до единиц.
    const total = zones.reduce((sum, z) => sum + z.widthPercent, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it("помечает текущую зону", () => {
    expect(ee().zones.map((z) => z.current)).toEqual([false, false, true]);
  });

  it("ставит маркер по сырому значению", () => {
    expect(ee().markerPercent).toBeCloseTo(60);
  });

  it("при lower_is_better первая зона благоприятна", () => {
    expect(ee().zones[0].color).toBe(LEVEL_SCHEMES.traffic.favorable);
  });

  it("при higher_is_better первая зона неблагоприятна", () => {
    const v = ee({
      interpretation: { domainMin: 0, domainMax: 45, valence: "higher_is_better", bands: EE_BANDS },
    });
    expect(v.zones[0].color).toBe(LEVEL_SCHEMES.traffic.unfavorable);
  });

  it("переопределение тона на интервале побеждает вычисленный", () => {
    const bands = [{ ...EE_BANDS[0] }, { ...EE_BANDS[1] }, { ...EE_BANDS[2], tone: "critical" as const }];
    const v = ee({
      interpretation: { domainMin: 0, domainMax: 45, valence: "lower_is_better", bands },
    });
    expect(v.tone).toBe("critical");
  });

  it("строковое значение отдаёт метку исхода и пустые зоны", () => {
    const v = buildMeasureView({
      key: "burnout_level",
      name: "Состояние",
      value: "growing",
      visibility: "level",
      interpretation: {
        domainMin: null,
        domainMax: null,
        valence: "none",
        bands: [],
        outcomes: [{ code: "growing", label: "Возрастающее истощение", tone: "attention" }],
      },
      requestedKind: "band_ruler",
      ramp: LEVEL_SCHEMES.traffic,
    });
    expect(v.renderKind).toBe("label");
    expect(v.levelLabel).toBe("Возрастающее истощение");
    expect(v.tone).toBe("attention");
    expect(v.zones).toEqual([]);
  });

  it("считает смещение кольца для вида ring", () => {
    const v = ee({ requestedKind: "ring" });
    expect(v.renderKind).toBe("ring");
    expect(v.percent).toBe(60);
    expect(v.ringDashoffset).toBeCloseTo(158.3, 0);
  });

  it("значение вне интервалов даёт пустую метку без падения", () => {
    const v = ee({ value: 99 });
    expect(v.levelLabel).toBe("");
    expect(v.tone).toBe("neutral");
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- shared/template/__tests__/measure-view.test.ts`
Expected: FAIL, «Cannot find module '../measure-view'».

- [ ] **Step 3: Реализовать модуль**

```ts
/**
 * @module shared/template/measure-view
 *
 * Turns one scale or one result variable into the card the results screen draws.
 * The card is a fixed composition of four slots — name, value, level, explanation —
 * and the chosen render kind governs the VALUE slot only. That is why a diagram and
 * a "your level" label never compete: the level is always present.
 *
 * Everything the layout needs is precomputed here (zone geometry, zone colours,
 * marker position, ring offset, the fallen-back render kind), so the DSL binds
 * values and never computes. Both hosts call this module, so a scale cannot render
 * differently in the web player and in the SCORM package.
 *
 * Pure — no DOM, no Node.
 */

import {
  findBand,
  findOutcome,
  type IndicatorInterpretation,
  type LearnerVisibility,
  type LevelTone,
  type ScaleInterpretation,
} from "../scales/interpretation";
import { rampColor, zoneColors, type HslTriple, type LevelRamp } from "./level-ramp";

export type RenderKind = "label" | "value" | "value_of_max" | "ring" | "band_ruler" | "gradient_bar";

/** Ring geometry from `layouts/results.html` (`<circle r="63">`). */
const RING_CIRCUMFERENCE = 2 * Math.PI * 63;

export interface CtxMeasureZone {
  label: string;
  leftPercent: number;
  widthPercent: number;
  color: HslTriple;
  current: boolean;
}

export interface CtxMeasureView {
  key: string;
  name: string;
  renderKind: RenderKind;
  showValue: boolean;
  valueLabel: string;
  levelLabel: string;
  tone: LevelTone;
  text?: string;
  zones: CtxMeasureZone[];
  markerPercent?: number;
  percent?: number;
  ringDashoffset?: number;
}

export interface MeasureCapabilities {
  hasDomain: boolean;
  hasBands: boolean;
  isNumeric: boolean;
}

export interface MeasureViewInput {
  key: string;
  name: string;
  value: number | string | boolean | null | undefined;
  visibility: LearnerVisibility;
  interpretation: ScaleInterpretation | IndicatorInterpretation;
  /** Author's choice from the design params, before feasibility fallback. */
  requestedKind: RenderKind;
  ramp: LevelRamp;
}

/** Descending order of richness; the first feasible kind wins. */
const FALLBACK_ORDER: RenderKind[] = ["gradient_bar", "band_ruler", "ring", "value_of_max", "value", "label"];

function isFeasible(kind: RenderKind, caps: MeasureCapabilities): boolean {
  if (!caps.isNumeric) return kind === "label";
  switch (kind) {
    case "gradient_bar":
      return caps.hasDomain && !caps.hasBands;
    case "band_ruler":
      return caps.hasDomain && caps.hasBands;
    case "ring":
    case "value_of_max":
      return caps.hasDomain;
    case "value":
    case "label":
      return true;
  }
}

/**
 * The kind actually drawn: the requested one when feasible, else the next feasible
 * kind down the ladder. A fallback is normal operation, not an error — an author
 * picks one kind for the whole test and its scales differ.
 */
export function resolveRenderKind(requested: RenderKind, caps: MeasureCapabilities): RenderKind {
  if (isFeasible(requested, caps)) return requested;
  const start = FALLBACK_ORDER.indexOf(requested);
  for (let i = Math.max(start, 0); i < FALLBACK_ORDER.length; i += 1) {
    if (isFeasible(FALLBACK_ORDER[i], caps)) return FALLBACK_ORDER[i];
  }
  return "label";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function outcomesOf(i: ScaleInterpretation | IndicatorInterpretation) {
  return (i as IndicatorInterpretation).outcomes ?? [];
}

/** Zone geometry: each band runs to the NEXT band's start, so zones are contiguous. */
function buildZones(
  input: MeasureViewInput,
  domainMin: number,
  domainMax: number,
  currentLevel: string,
): CtxMeasureZone[] {
  const bands = input.interpretation.bands;
  const span = domainMax - domainMin;
  if (span <= 0) return [];
  const colors = zoneColors(input.ramp, bands.length, input.interpretation.valence);
  return bands.map((band, i) => {
    const right = i + 1 < bands.length ? bands[i + 1].min : domainMax;
    return {
      label: band.label ?? band.level,
      leftPercent: round1(((band.min - domainMin) / span) * 100),
      widthPercent: round1(((right - band.min) / span) * 100),
      color: colors[i],
      current: band.level === currentLevel && currentLevel !== "",
    };
  });
}

/** Tone of the current level: the author's override, else the ramp position. */
function toneOf(
  input: MeasureViewInput,
  override: LevelTone | undefined,
  index: number,
  count: number,
): LevelTone {
  if (override) return override;
  const { valence } = input.interpretation;
  if (valence === "none" || count <= 1 || index < 0) return "neutral";
  const position = index / (count - 1);
  const t = valence === "lower_is_better" ? 1 - position : position;
  if (t >= 0.75) return "favorable";
  if (t >= 0.5) return "neutral";
  if (t >= 0.25) return "attention";
  return "critical";
}

/**
 * Build the card. `value` may be a number (scale, numeric indicator), a string
 * (indicator outcome code) or a boolean; the shape of the interpretation decides
 * how it is matched.
 */
export function buildMeasureView(input: MeasureViewInput): CtxMeasureView {
  const { interpretation } = input;
  const isNumeric = typeof input.value === "number" && Number.isFinite(input.value);
  const hasDomain = interpretation.domainMin !== null && interpretation.domainMax !== null;
  const hasBands = interpretation.bands.length > 0;
  const renderKind = resolveRenderKind(input.requestedKind, { hasDomain, hasBands, isNumeric });
  const showValue = input.visibility === "level_and_value" && renderKind !== "label";

  const base: CtxMeasureView = {
    key: input.key,
    name: input.name,
    renderKind,
    showValue,
    valueLabel: "",
    levelLabel: "",
    tone: "neutral",
    zones: [],
  };

  if (!isNumeric) {
    const outcomes = outcomesOf(interpretation);
    const outcome = findOutcome(outcomes, input.value as string | boolean);
    if (!outcome) return base;
    return {
      ...base,
      levelLabel: outcome.label,
      tone: outcome.tone ?? "neutral",
      ...(outcome.text ? { text: outcome.text } : {}),
    };
  }

  const value = input.value as number;
  const domainMin = interpretation.domainMin ?? 0;
  const domainMax = interpretation.domainMax ?? 0;
  const band = findBand(interpretation.bands, value);
  const bandIndex = band ? interpretation.bands.indexOf(band) : -1;

  const view: CtxMeasureView = {
    ...base,
    valueLabel: hasDomain ? `${round1(value)} из ${round1(domainMax)}` : String(round1(value)),
    levelLabel: band ? band.label ?? band.level : "",
    tone: toneOf(input, band?.tone, bandIndex, interpretation.bands.length),
    ...(band?.text ? { text: band.text } : {}),
  };

  if (!hasDomain) return view;

  const span = domainMax - domainMin;
  const ratio = span > 0 ? (value - domainMin) / span : 0;
  const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;

  if (renderKind === "band_ruler") {
    view.zones = buildZones(input, domainMin, domainMax, band?.level ?? "");
    view.markerPercent = round1(clamped * 100);
  }
  if (renderKind === "gradient_bar") {
    view.markerPercent = round1(clamped * 100);
    view.zones = [
      {
        label: "",
        leftPercent: 0,
        widthPercent: 100,
        color: rampColor(input.ramp, interpretation.valence === "lower_is_better" ? 1 - clamped : clamped),
        current: true,
      },
    ];
  }
  if (renderKind === "ring") {
    view.percent = Math.round(clamped * 100);
    view.ringDashoffset = round1(RING_CIRCUMFERENCE * (1 - clamped));
  }

  return view;
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- shared/template/__tests__/measure-view.test.ts`
Expected: PASS, 18 тестов.

- [ ] **Step 5: Commit**

```bash
git add shared/template/measure-view.ts shared/template/__tests__/measure-view.test.ts
git commit -m "feat(prd-29): сборка карточки шкалы и показателя"
```

---

## Task 6: Хранение — колонка и перечень видимости

**Files:**

- Modify: `shared/schema.ts` (таблицы `scales` и `resultVariables`)
- Create: `migrations/036_prd29_measurement_results.sql`
- Test: `shared/__tests__/schema-prd29.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// shared/__tests__/schema-prd29.test.ts
import { describe, it, expect } from "vitest";
import { insertScaleSchema, insertResultVariableSchema } from "../schema";

describe("insertScaleSchema (PRD-29)", () => {
  it("принимает три позиции видимости", () => {
    for (const learnerVisibility of ["hidden", "level", "level_and_value"] as const) {
      const parsed = insertScaleSchema.parse({
        testId: "t1", key: "s1", label: "Шкала", type: "number", learnerVisibility,
      });
      expect(parsed.learnerVisibility).toBe(learnerVisibility);
    }
  });

  it("отклоняет значение вне перечня", () => {
    expect(() =>
      insertScaleSchema.parse({ testId: "t1", key: "s1", label: "Ш", type: "number", learnerVisibility: "yes" }),
    ).toThrow();
  });

  it("по умолчанию скрывает шкалу от ученика", () => {
    const parsed = insertScaleSchema.parse({ testId: "t1", key: "s1", label: "Ш", type: "number" });
    expect(parsed.learnerVisibility).toBe("hidden");
  });
});

describe("insertResultVariableSchema (PRD-29)", () => {
  it("принимает configJson с перечнем исходов", () => {
    const parsed = insertResultVariableSchema.parse({
      testId: "t1", name: "burnout_level", label: "Состояние", type: "string", formula: '"engaged"',
      configJson: { outcomes: [{ code: "engaged", label: "Вовлечённость" }] },
    });
    expect(parsed.configJson).toEqual({ outcomes: [{ code: "engaged", label: "Вовлечённость" }] });
  });

  it("по умолчанию даёт пустой configJson", () => {
    const parsed = insertResultVariableSchema.parse({
      testId: "t1", name: "v", label: "V", type: "number", formula: "1",
    });
    expect(parsed.configJson).toEqual({});
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- shared/__tests__/schema-prd29.test.ts`
Expected: FAIL, `learnerVisibility` не распознан.

- [ ] **Step 3: Изменить схему**

В `shared/schema.ts` в таблице `scales` заменить строку `showToLearner` на:

```ts
  // PRD-29: three positions instead of a boolean. Psychodiagnostics routinely needs
  // the LEVEL disclosed while the raw score stays hidden — the score invites
  // self-diagnosis and comparison between people.
  learnerVisibility: text("learner_visibility", { enum: ["hidden", "level", "level_and_value"] })
    .notNull()
    .default("hidden"),
```

Ту же строку добавить в `resultVariables`, и там же — новую колонку:

```ts
  // PRD-29: interpretation of the indicator — the outcome list for string/boolean
  // values, bands for numeric ones. `scales` already has its own config_json.
  configJson: jsonb("config_json").$type<Record<string, unknown>>().notNull().default({}),
```

В `insertResultVariableSchema` добавить в `.extend({ ... })`:

```ts
    configJson: z.record(z.string(), z.unknown()).default({}),
```

- [ ] **Step 4: Написать миграцию**

```sql
-- migrations/036_prd29_measurement_results.sql
-- PRD-29 (2026-07-30): показ шкал и показателей ученику.
--   * result_variables.config_json — толкование показателя: перечень исходов для строковых и
--     булевых, интервалы для числовых. У scales такая колонка уже есть.
--   * learner_visibility на обеих таблицах вместо булева show_to_learner. Средняя позиция
--     («уровень и толкование, без числа») невыразима булевым флагом, а именно она нужна
--     психодиагностике.
--
-- Структура схемы — источник правды (применяется через drizzle-kit). Файл документирует
-- изменение и безопасен при повторном запуске: ADD COLUMN IF NOT EXISTS идемпотентен, а
-- перенос данных выполняется только пока жива старая колонка.

BEGIN;

ALTER TABLE result_variables ADD COLUMN IF NOT EXISTS config_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE scales ADD COLUMN IF NOT EXISTS learner_visibility text NOT NULL DEFAULT 'hidden';
ALTER TABLE result_variables ADD COLUMN IF NOT EXISTS learner_visibility text NOT NULL DEFAULT 'hidden';

-- Перенос: false -> hidden (уже значение по умолчанию), true -> level_and_value.
UPDATE scales SET learner_visibility = 'level_and_value'
  WHERE show_to_learner IS TRUE AND learner_visibility = 'hidden';
UPDATE result_variables SET learner_visibility = 'level_and_value'
  WHERE show_to_learner IS TRUE AND learner_visibility = 'hidden';

ALTER TABLE scales DROP CONSTRAINT IF EXISTS scales_learner_visibility_check;
ALTER TABLE scales ADD CONSTRAINT scales_learner_visibility_check
  CHECK (learner_visibility IN ('hidden', 'level', 'level_and_value'));
ALTER TABLE result_variables DROP CONSTRAINT IF EXISTS result_variables_learner_visibility_check;
ALTER TABLE result_variables ADD CONSTRAINT result_variables_learner_visibility_check
  CHECK (learner_visibility IN ('hidden', 'level', 'level_and_value'));

ALTER TABLE scales DROP COLUMN IF EXISTS show_to_learner;
ALTER TABLE result_variables DROP COLUMN IF EXISTS show_to_learner;

COMMIT;
```

- [ ] **Step 5: Найти и починить обращения к старому полю**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i showToLearner`

Ожидаемые точки: `client/src/features/tests/editor/*-api.ts`, `test-editor.types.ts`,
`test-editor.mappers.ts`, обе секции редактора, `server/scorm/builders/test-json.ts`.
Переименовать поле и заменить булеву проверку на `!== "hidden"` там, где решается факт
публикации. Тесты, ссылающиеся на `showToLearner`, обновить в том же коммите.

- [ ] **Step 6: Прогнать проверки**

Run: `npm run check`
Expected: 0 ошибок.

Run: `npm test`
Expected: PASS. Порог покрытия 80 процентов не должен покраснеть; если краснеет — остановиться
и доложить, а не дописывать тесты вне кода задачи.

- [ ] **Step 7: Применить схему к dev-базе**

Перед подключением посмотреть `.env`: dev-база — Docker на `localhost:55432`, а не системный
PostgreSQL на 5432.

Run: `npm run db:push`
Expected: две новые колонки, две удалённые.

- [ ] **Step 8: Commit**

```bash
git add shared/schema.ts shared/__tests__/schema-prd29.test.ts migrations/036_prd29_measurement_results.sql
git add client/src server/scorm/builders/test-json.ts
git commit -m "feat(prd-29): config_json показателя и трёхпозиционная видимость"
```

---

## Task 7: Сбор рекомендаций из трёх источников

**Files:**

- Create: `shared/template/recommendations.ts`
- Test: `shared/template/__tests__/recommendations.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// shared/template/__tests__/recommendations.test.ts
import { describe, it, expect } from "vitest";
import { collectRecommendations } from "../recommendations";

const COURSE = { title: "Управление нагрузкой", url: "https://lms/1" };

describe("collectRecommendations", () => {
  it("собирает пустой блок, когда источников нет", () => {
    const r = collectRecommendations([]);
    expect(r.hasAny).toBe(false);
    expect(r.texts).toEqual([]);
  });

  it("сохраняет порядок источников", () => {
    const r = collectRecommendations([
      { text: "Общая по тесту" },
      { text: "От профиля" },
      { text: "От шкалы" },
    ]);
    expect(r.texts).toEqual(["Общая по тесту", "От профиля", "От шкалы"]);
  });

  it("схлопывает одинаковые ссылки первым вхождением", () => {
    const r = collectRecommendations([
      { links: [COURSE] },
      { links: [{ ...COURSE }] },
    ]);
    expect(r.links).toHaveLength(1);
  });

  it("различает ссылки с одинаковым названием и разными адресами", () => {
    const r = collectRecommendations([
      { links: [COURSE, { title: COURSE.title, url: "https://lms/2" }] },
    ]);
    expect(r.links).toHaveLength(2);
  });

  it("схлопывает одинаковые тексты", () => {
    const r = collectRecommendations([{ text: "Отдых" }, { text: "Отдых" }]);
    expect(r.texts).toEqual(["Отдых"]);
  });

  it("игнорирует пустые и пробельные тексты", () => {
    const r = collectRecommendations([{ text: "   " }, { text: "" }]);
    expect(r.texts).toEqual([]);
    expect(r.hasAny).toBe(false);
  });

  it("разносит мероприятия и материалы по своим спискам", () => {
    const r = collectRecommendations([
      { events: [{ title: "Встреча группы" }], assets: [{ title: "Памятка.pdf", url: "/a.pdf" }] },
    ]);
    expect(r.events).toHaveLength(1);
    expect(r.assets).toHaveLength(1);
    expect(r.hasAny).toBe(true);
  });

  it("пропускает отсутствующие источники", () => {
    const r = collectRecommendations([null, undefined, { text: "Есть" }]);
    expect(r.texts).toEqual(["Есть"]);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- shared/template/__tests__/recommendations.test.ts`
Expected: FAIL, «Cannot find module '../recommendations'».

- [ ] **Step 3: Реализовать модуль**

```ts
/**
 * @module shared/template/recommendations
 *
 * Collects the recommendations that fired into the ONE block at the bottom of the
 * results screen. Three sources feed it — the test's own feedback, the outcome of a
 * result variable, and the band of each scale — and a measurement test easily fires
 * all of them at once. Rendering each in place would scatter four partly-overlapping
 * lists across the screen, so they are merged instead.
 *
 * The block is structured by RESOURCE TYPE, not by cause: which level produced a
 * given recommendation is carried by its own wording, and a "because your exhaustion
 * is high" caption would add noise without information.
 *
 * Order inside each list follows the caller's source order (test, then indicator,
 * then scales), so the general precedes the specific and dedup keeps the general copy.
 *
 * Pure — no DOM, no Node.
 */

import type { FeedbackBlock, RecommendationLink } from "../scales/interpretation";

export interface CtxRecommendations {
  texts: string[];
  links: RecommendationLink[];
  events: RecommendationLink[];
  assets: RecommendationLink[];
  hasAny: boolean;
}

function dedupLinks(items: RecommendationLink[]): RecommendationLink[] {
  const seen = new Set<string>();
  const out: RecommendationLink[] = [];
  for (const item of items) {
    const key = `${item.title}|${item.url ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Merge the fired feedback blocks in source order. Absent sources are skipped. */
export function collectRecommendations(
  sources: Array<FeedbackBlock | null | undefined>,
): CtxRecommendations {
  const present = sources.filter((s): s is FeedbackBlock => !!s);
  const texts: string[] = [];
  const seenText = new Set<string>();
  for (const source of present) {
    const text = String(source.text ?? "").trim();
    if (!text || seenText.has(text)) continue;
    seenText.add(text);
    texts.push(text);
  }
  const links = dedupLinks(present.flatMap((s) => s.links ?? []));
  const events = dedupLinks(present.flatMap((s) => s.events ?? []));
  const assets = dedupLinks(present.flatMap((s) => s.assets ?? []));
  return {
    texts,
    links,
    events,
    assets,
    hasAny: texts.length > 0 || links.length > 0 || events.length > 0 || assets.length > 0,
  };
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- shared/template/__tests__/recommendations.test.ts`
Expected: PASS, 8 тестов.

- [ ] **Step 5: Commit**

```bash
git add shared/template/recommendations.ts shared/template/__tests__/recommendations.test.ts
git commit -m "feat(prd-29): сбор рекомендаций из трёх источников в один блок"
```

---

## Task 8: Контекст итогов

**Files:**

- Modify: `shared/template/context.ts` (интерфейс `CtxResult`)
- Modify: `shared/template/result-context.ts` (`ResultInput`, `ResultContextOptions`, `buildResultContext`)
- Modify: `server/services/result-context.ts`
- Modify: `server/services/scoring-config.ts`
- Create: `shared/template/results-blocks.ts`
- Test: `shared/template/__tests__/result-context-measures.test.ts`
- Test: `shared/template/__tests__/results-blocks.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// shared/template/__tests__/result-context-measures.test.ts
import { describe, it, expect } from "vitest";
import { buildResultContext } from "../result-context";
import { LEVEL_SCHEMES } from "../level-ramp";

const BASE = {
  passed: false,
  percent: 0,
  totalQuestions: 22,
  correct: 0,
  earnedPoints: 0,
  possiblePoints: 0,
  topicResults: [],
};

const MEASURES = {
  ramp: LEVEL_SCHEMES.traffic,
  scaleKind: "band_ruler" as const,
  indicatorKind: "label" as const,
  scales: [
    {
      key: "emotional_exhaustion",
      name: "Эмоциональное истощение",
      value: 27,
      visibility: "level_and_value" as const,
      interpretation: {
        domainMin: 0,
        domainMax: 45,
        valence: "lower_is_better" as const,
        bands: [
          { min: 0, max: 14, level: "low", label: "Низкий" },
          { min: 15, max: 24, level: "moderate", label: "Умеренный" },
          { min: 25, max: 45, level: "high", label: "Высокий", feedback: { text: "Восстановите режим отдыха." } },
        ],
      },
    },
  ],
  indicators: [
    {
      key: "burnout_level",
      name: "Состояние",
      value: "growing",
      visibility: "level" as const,
      interpretation: {
        domainMin: null,
        domainMax: null,
        valence: "none" as const,
        bands: [],
        outcomes: [
          { code: "growing", label: "Возрастающее истощение", tone: "attention" as const,
            feedback: { text: "Обсудите нагрузку с руководителем.", links: [{ title: "Курс", url: "/c" }] } },
        ],
      },
    },
  ],
  testFeedback: { text: "Опросник носит справочный характер." },
};

describe("buildResultContext + measures", () => {
  it("не добавляет новых полей, когда измерений нет", () => {
    const ctx = buildResultContext(BASE, "Тест");
    expect(ctx.result.scales).toBeUndefined();
    expect(ctx.result.indicators).toBeUndefined();
    expect(ctx.result.recommendations).toBeUndefined();
  });

  it("кладёт карточки шкал и показателей", () => {
    const ctx = buildResultContext(BASE, "Маслач", { measures: MEASURES });
    expect(ctx.result.scales).toHaveLength(1);
    expect(ctx.result.scales![0].levelLabel).toBe("Высокий");
    expect(ctx.result.indicators).toHaveLength(1);
    expect(ctx.result.indicators![0].levelLabel).toBe("Возрастающее истощение");
  });

  it("не включает скрытые шкалы", () => {
    const hidden = { ...MEASURES, scales: [{ ...MEASURES.scales[0], visibility: "hidden" as const }] };
    const ctx = buildResultContext(BASE, "Маслач", { measures: hidden });
    expect(ctx.result.scales).toBeUndefined();
  });

  it("собирает рекомендации в порядке тест, показатель, шкала", () => {
    const ctx = buildResultContext(BASE, "Маслач", { measures: MEASURES });
    expect(ctx.result.recommendations!.texts).toEqual([
      "Опросник носит справочный характер.",
      "Обсудите нагрузку с руководителем.",
      "Восстановите режим отдыха.",
    ]);
    expect(ctx.result.recommendations!.links).toHaveLength(1);
  });

  it("берёт рекомендации только у сработавших интервалов", () => {
    const low = { ...MEASURES, scales: [{ ...MEASURES.scales[0], value: 5 }], indicators: [], testFeedback: null };
    const ctx = buildResultContext(BASE, "Маслач", { measures: low });
    expect(ctx.result.recommendations!.hasAny).toBe(false);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- shared/template/__tests__/result-context-measures.test.ts`
Expected: FAIL, `measures` не принимается.

- [ ] **Step 3: Написать падающий тест разрешения блоков**

```ts
// shared/template/__tests__/results-blocks.test.ts
import { describe, it, expect } from "vitest";
import { resolveResultsBlocks } from "../results-blocks";

const STATE = { hasPassThreshold: true, hasVisibleScales: true, hasVisibleIndicators: true };

describe("resolveResultsBlocks", () => {
  it("при auto включает сводку, когда у теста есть порог", () => {
    const b = resolveResultsBlocks({}, STATE);
    expect(b.scoreSummary).toBe(true);
  });

  it("при auto выключает сводку у теста без порога", () => {
    const b = resolveResultsBlocks({}, { ...STATE, hasPassThreshold: false });
    expect(b.scoreSummary).toBe(false);
  });

  it("при auto включает шкалы и показатели по их наличию", () => {
    const b = resolveResultsBlocks({}, { ...STATE, hasVisibleScales: false });
    expect(b.scales).toBe(false);
    expect(b.indicators).toBe(true);
  });

  it("show перебивает автоматику", () => {
    const b = resolveResultsBlocks({ scoreSummary: "show" }, { ...STATE, hasPassThreshold: false });
    expect(b.scoreSummary).toBe(true);
  });

  it("hide перебивает автоматику", () => {
    const b = resolveResultsBlocks({ scales: "hide" }, STATE);
    expect(b.scales).toBe(false);
  });

  it("неизвестное значение настройки читается как auto", () => {
    const b = resolveResultsBlocks({ scales: "maybe" } as never, STATE);
    expect(b.scales).toBe(true);
  });
});
```

Run: `npm test -- shared/template/__tests__/results-blocks.test.ts`
Expected: FAIL, «Cannot find module '../results-blocks'».

- [ ] **Step 4: Реализовать разрешение блоков**

```ts
/**
 * @module shared/template/results-blocks
 *
 * Resolves the results screen's block settings into three booleans.
 *
 * Each block is a three-position setting rather than a checkbox because the useful
 * default is "decide for me": the manifest cannot know whether a given test has a
 * pass threshold or visible scales. `auto` derives the answer from the test, while
 * `show` and `hide` let the author see and override that derivation — an implicit
 * rule the author cannot inspect reads as a bug the first time a block vanishes.
 *
 * Pure — no DOM, no Node.
 */

export type BlockSetting = "auto" | "show" | "hide";

export interface ResultsBlockSettings {
  scoreSummary?: BlockSetting;
  indicators?: BlockSetting;
  scales?: BlockSetting;
}

/** What the test itself offers, used to answer `auto`. */
export interface ResultsBlockState {
  hasPassThreshold: boolean;
  hasVisibleScales: boolean;
  hasVisibleIndicators: boolean;
}

export interface ResultsBlocks {
  scoreSummary: boolean;
  indicators: boolean;
  scales: boolean;
}

function resolve(setting: BlockSetting | undefined, auto: boolean): boolean {
  if (setting === "show") return true;
  if (setting === "hide") return false;
  return auto;
}

/** Effective visibility of each block. Unknown setting values degrade to `auto`. */
export function resolveResultsBlocks(
  settings: ResultsBlockSettings,
  state: ResultsBlockState,
): ResultsBlocks {
  return {
    scoreSummary: resolve(settings.scoreSummary, state.hasPassThreshold),
    indicators: resolve(settings.indicators, state.hasVisibleIndicators),
    scales: resolve(settings.scales, state.hasVisibleScales),
  };
}
```

Run: `npm test -- shared/template/__tests__/results-blocks.test.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 5: Расширить контракт контекста**

В `shared/template/context.ts` внутрь `CtxResult` добавить, перед `[key: string]: unknown`:

```ts
  /**
   * PRD-29: measurement blocks. Present only when the test has visible scales /
   * indicators AND the block is on — absence keeps the control-test screen
   * byte-identical, so the layout gates on presence alone.
   */
  scales?: CtxMeasureView[];
  indicators?: CtxMeasureView[];
  recommendations?: CtxRecommendations;
  /** The score summary always HAS data, so it needs its own flag. */
  showScoreSummary?: boolean;
```

и импорт типов в шапке файла:

```ts
import type { CtxMeasureView } from "./measure-view";
import type { CtxRecommendations } from "./recommendations";
```

- [ ] **Step 6: Расширить построитель контекста**

В `shared/template/result-context.ts` добавить входной тип и обработку:

```ts
import { buildMeasureView, type CtxMeasureView, type MeasureViewInput, type RenderKind } from "./measure-view";
import { collectRecommendations } from "./recommendations";
import type { FeedbackBlock, IndicatorInterpretation, LearnerVisibility, ScaleInterpretation }
  from "../scales/interpretation";
import type { LevelRamp } from "./level-ramp";

/** One scale or indicator as the host hands it over, before presentational shaping. */
export interface MeasureInput {
  key: string;
  name: string;
  value: number | string | boolean | null | undefined;
  visibility: LearnerVisibility;
  interpretation: ScaleInterpretation | IndicatorInterpretation;
}

/** PRD-29 measurement input: the visible measures plus the design-param choices. */
export interface MeasuresInput {
  ramp: LevelRamp;
  scaleKind: RenderKind;
  indicatorKind: RenderKind;
  scales: MeasureInput[];
  indicators: MeasureInput[];
  testFeedback?: FeedbackBlock | null;
}

/** Feedback of the level that actually fired, for the recommendations block. */
function firedFeedback(m: MeasureInput): FeedbackBlock | null {
  const { interpretation } = m;
  if (typeof m.value === "number") {
    const band = interpretation.bands.find((b) => (m.value as number) >= b.min && (m.value as number) <= b.max);
    return band?.feedback ?? null;
  }
  const outcomes = (interpretation as IndicatorInterpretation).outcomes ?? [];
  const outcome = outcomes.find((o) => o.code === String(m.value));
  return outcome?.feedback ?? null;
}
```

Добавить `measures?: MeasuresInput` в `ResultContextOptions`, а в `MeasuresInput` — поле
`blockSettings?: ResultsBlockSettings`. В конце `buildResultContext`, перед `return`, дописать:

```ts
  if (opts.measures) {
    const visibleScales = opts.measures.scales.filter((m) => m.visibility !== "hidden");
    const visibleIndicators = opts.measures.indicators.filter((m) => m.visibility !== "hidden");
    const blocks = resolveResultsBlocks(opts.measures.blockSettings ?? {}, {
      hasPassThreshold: opts.measures.hasPassThreshold === true,
      hasVisibleScales: visibleScales.length > 0,
      hasVisibleIndicators: visibleIndicators.length > 0,
    });
    result.showScoreSummary = blocks.scoreSummary;

    if (blocks.scales && visibleScales.length) {
      result.scales = visibleScales.map((m) =>
        buildMeasureView({ ...m, requestedKind: opts.measures!.scaleKind, ramp: opts.measures!.ramp }));
    }
    if (blocks.indicators && visibleIndicators.length) {
      result.indicators = visibleIndicators.map((m) =>
        buildMeasureView({ ...m, requestedKind: opts.measures!.indicatorKind, ramp: opts.measures!.ramp }));
    }
    // Order matters: general first, then the profile, then the scales — dedup keeps
    // the first occurrence, so a general recommendation outranks its specific copy.
    // A hidden block contributes nothing: the learner never saw what caused it.
    const recommendations = collectRecommendations([
      opts.measures.testFeedback,
      ...(blocks.indicators ? visibleIndicators.map(firedFeedback) : []),
      ...(blocks.scales ? visibleScales.map(firedFeedback) : []),
    ]);
    if (recommendations.hasAny) result.recommendations = recommendations;
  }
```

`MeasuresInput` при этом получает ещё одно поле:

```ts
  /** Whether the test has a pass threshold — the `auto` answer for the score summary. */
  hasPassThreshold?: boolean;
  blockSettings?: ResultsBlockSettings;
```

Импорты `CtxMeasureView` и `MeasureViewInput` в Step 6 не понадобятся — фильтрация и сборка
выполняются прямо здесь; не заводить отдельную обёртку, которая ничего не добавляет.

- [ ] **Step 7: Убедиться, что тест проходит**

Run: `npm test -- shared/template/__tests__/result-context-measures.test.ts`
Expected: PASS, 5 тестов. Тест «не добавляет новых полей, когда измерений нет» проверяет, что
`opts.measures` отсутствует целиком — тогда и `showScoreSummary` не появляется и контрольный
экран остаётся прежним.

- [ ] **Step 8: Прокинуть толкование через загрузчик конфигурации**

В `server/services/scoring-config.ts` заменить чтение `bands` на полное толкование, чтобы
домен и направление доехали до потребителей:

```ts
import { parseScaleInterpretation } from "@shared/scales/interpretation";

  const scales: ScaleSpec[] = scaleRows.map((s) => {
    const interpretation = parseScaleInterpretation(s.configJson);
    return {
      key: s.key,
      aggregation: s.aggregation as ScaleSpec["aggregation"],
      normalization: s.normalization as ScaleSpec["normalization"],
      direction: s.direction as ScaleSpec["direction"],
      bands: interpretation.bands,
    };
  });
```

- [ ] **Step 9: Собрать входы на веб-хосте**

В `server/services/result-context.ts` добавить экспортируемую функцию и вызвать её там, где
строится контекст итогов:

```ts
import { computeResultVariables } from "@shared/formula/result-variables";
import { LEVEL_SCHEMES, type LevelRamp } from "@shared/template/level-ramp";
import { parseIndicatorInterpretation, parseScaleInterpretation } from "@shared/scales/interpretation";
import type { MeasureInput, MeasuresInput } from "@shared/template/result-context";
import type { RenderKind } from "@shared/template/measure-view";
import type { ResultsBlockSettings } from "@shared/template/results-blocks";
import type { ResultVariable, Scale } from "@shared/schema";
import type { ScaleResult } from "@shared/formula/types";

/** Rows and computed values the measures block needs, gathered by the caller. */
export interface MeasuresSource {
  scales: Scale[];
  variables: ResultVariable[];
  scaleResults: Record<string, ScaleResult>;
  variableValues: Record<string, unknown>;
  /** Effective design params of the test (already merged with manifest defaults). */
  params: Record<string, unknown>;
  /** Settings of the chosen `results` variant. */
  blockSettings: ResultsBlockSettings;
  hasPassThreshold: boolean;
  testFeedback?: { text?: string } | null;
}

/**
 * The ramp: a named scheme, or the author's three triples when `custom` is chosen.
 * A missing custom colour falls back to the traffic scheme's own end, so a
 * half-filled form still renders a sane ramp instead of a blank one.
 */
function resolveRamp(params: Record<string, unknown>): LevelRamp {
  const scheme = String(params.levelScheme ?? "traffic");
  if (scheme !== "custom") return LEVEL_SCHEMES[scheme === "neutral" ? "neutral" : "traffic"];
  return {
    favorable: String(params.levelColorFavorable ?? LEVEL_SCHEMES.traffic.favorable),
    mid: params.levelColorMid ? String(params.levelColorMid) : null,
    unfavorable: String(params.levelColorUnfavorable ?? LEVEL_SCHEMES.traffic.unfavorable),
  };
}

/** Build the PRD-29 measures input for the results context. */
export function buildMeasuresInput(source: MeasuresSource): MeasuresInput {
  const scales: MeasureInput[] = source.scales
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({
      key: s.key,
      name: s.label || s.key,
      value: source.scaleResults[s.key]?.raw ?? null,
      visibility: s.learnerVisibility,
      interpretation: parseScaleInterpretation(s.configJson),
    }));

  const indicators: MeasureInput[] = source.variables
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((v) => ({
      key: v.name,
      name: v.label || v.name,
      value: source.variableValues[v.name] as number | string | boolean | null,
      visibility: v.learnerVisibility,
      interpretation: parseIndicatorInterpretation(v.configJson),
    }));

  return {
    ramp: resolveRamp(source.params),
    scaleKind: String(source.params.scaleRenderKind ?? "band_ruler") as RenderKind,
    indicatorKind: String(source.params.indicatorRenderKind ?? "label") as RenderKind,
    scales,
    indicators,
    testFeedback: source.testFeedback ?? null,
    hasPassThreshold: source.hasPassThreshold,
    blockSettings: source.blockSettings,
  };
}
```

Передать результат в `buildSharedResultContext(..., { ..., measures: buildMeasuresInput(...) })`.
Вызывать ТОЛЬКО когда у теста есть шкалы или показатели: иначе `opts.measures` остаётся
неопределённым и контрольный экран не меняется ни на байт.

- [ ] **Step 10: Прогнать проверки**

Run: `npm run check`
Expected: 0 ошибок.

Run: `npm test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add shared/template/context.ts shared/template/result-context.ts shared/template/results-blocks.ts
git add shared/template/__tests__/result-context-measures.test.ts shared/template/__tests__/results-blocks.test.ts
git add server/services/result-context.ts server/services/scoring-config.ts
git commit -m "feat(prd-29): шкалы, показатели и рекомендации в контексте итогов"
```

---

## Task 9: Разметка экрана итогов

**Files:**

- Modify: `server/scorm/templates/default/layouts/results.html`

- [ ] **Step 1: Свериться с утверждённым эскизом**

Открыть `docs/wireframes/prd29-measurement-results.html`. Разметка обязана повторять эскиз;
отступление означает откат и повторное согласование.

- [ ] **Step 2: Обернуть существующую сводку в условие**

Заменить блок `<div class="tb-score-strip">…</div>` (строки 16-32) на тот же блок, обёрнутый
в `{{#if result.showScoreSummary}}` … `{{/if}}`. Внутренняя разметка не меняется ни на символ:
контрольный тест обязан выглядеть как сегодня.

- [ ] **Step 3: Добавить блок показателей перед блоком тем**

```html
      {{#if result.indicators}}
      <div class="tb-scene__q"><h3 class="tb-scene__subhead">Ваш результат</h3></div>
      <div class="tb-measures tb-measures--lead">
        {{#each result.indicators}}
        <div class="ou-card tb-measure tb-measure--{{tone}}">
          <div class="ou-card__body">
            <span class="tb-measure__name">{{name}}</span>
            <span class="ou-tag ou-tag--s tb-measure__level">{{levelLabel}}</span>
            {{#if text}}<p class="tb-measure__text">{{text}}</p>{{/if}}
          </div>
        </div>
        {{/each}}
      </div>
      {{/if}}
```

- [ ] **Step 4: Добавить блок шкал**

```html
      {{#if result.scales}}
      <hr class="ou-separator ou-separator--horizontal">
      <div class="tb-scene__q"><h3 class="tb-scene__subhead">По шкалам</h3></div>
      <div class="tb-measures">
        {{#each result.scales}}
        <div class="ou-card tb-measure tb-measure--{{tone}}" data-render="{{renderKind}}">
          <div class="ou-card__body">
            <div class="tb-measure__head">
              <span class="tb-measure__name">{{name}}</span>
              {{#if showValue}}<span class="tb-measure__value">{{valueLabel}}</span>{{/if}}
            </div>
            {{#if zones}}
            <div class="tb-ruler">
              <div class="tb-ruler__track">
                {{#each zones}}
                <span class="tb-ruler__zone{{#if current}} is-current{{/if}}"
                      style="left:{{leftPercent}}%;width:{{widthPercent}}%;--tb-zone:{{color}}">
                  <span class="tb-ruler__zone-label">{{label}}</span>
                </span>
                {{/each}}
              </div>
              <span class="tb-ruler__marker" style="left:{{markerPercent}}%"></span>
            </div>
            {{/if}}
            <span class="ou-tag ou-tag--s tb-measure__level">{{levelLabel}}</span>
            {{#if text}}<p class="tb-measure__text">{{text}}</p>{{/if}}
          </div>
        </div>
        {{/each}}
      </div>
      {{/if}}
```

- [ ] **Step 5: Добавить блок рекомендаций после блока тем**

```html
      {{#if result.recommendations.hasAny}}
      <hr class="ou-separator ou-separator--horizontal">
      <div class="tb-scene__q"><h3 class="tb-scene__subhead">Что можно сделать</h3></div>
      <div class="tb-recos">
        {{#each result.recommendations.texts}}<p class="tb-recos__text">{{this}}</p>{{/each}}
        {{#if result.recommendations.links}}
        <div class="tb-recos__group">
          <span class="tb-recos__group-title">Пройти обучение</span>
          {{#each result.recommendations.links}}<a class="tb-rec" href="{{url}}" target="_blank" rel="noopener noreferrer">{{title}}</a>{{/each}}
        </div>
        {{/if}}
        {{#if result.recommendations.events}}
        <div class="tb-recos__group">
          <span class="tb-recos__group-title">Мероприятия</span>
          {{#each result.recommendations.events}}<span class="tb-rec">{{title}}</span>{{/each}}
        </div>
        {{/if}}
        {{#if result.recommendations.assets}}
        <div class="tb-recos__group">
          <span class="tb-recos__group-title">Материалы</span>
          {{#each result.recommendations.assets}}<a class="tb-rec" href="{{url}}" target="_blank" rel="noopener noreferrer">{{title}}</a>{{/each}}
        </div>
        {{/if}}
      </div>
      {{/if}}
```

- [ ] **Step 6: Проверить поддержку конструкции в DSL**

Run: `npm test -- shared/template/dsl.test.ts`
Expected: PASS. Если `{{#each}}` по массиву строк с `{{this}}` не поддержан, добавить
поддержку в `shared/template/dsl.ts` вместе с тестом в том же коммите.

- [ ] **Step 7: Commit**

```bash
git add server/scorm/templates/default/layouts/results.html
git commit -m "feat(prd-29): блоки показателей, шкал и рекомендаций в макете итогов"
```

---

## Task 10: Стили карточки и линейки

**Files:**

- Modify: `server/scorm/templates/default/styles/theme.css`

- [ ] **Step 1: Объявить токены тона рядом с существующими pass/fail**

Найти строку `/* passClass (is-pass/is-fail) drives the DS ring fill + verdict tag colour. */`
и добавить перед ней:

```css
/* PRD-29: interpretation tones. Named in methodology terms; the DS semantic families
   already carry the three roles a zone needs — solid, soft fill, text on fill. */
.tb-scene {
  --tb-tone-favorable: var(--ou-success-default);
  --tb-tone-neutral: var(--ou-info-default);
  --tb-tone-attention: var(--ou-warning-default);
  --tb-tone-critical: var(--ou-error-default);
}
.tb-measure--favorable .tb-measure__level { background: var(--ou-success-soft); color: var(--ou-success-on-soft); }
.tb-measure--neutral   .tb-measure__level { background: var(--ou-info-soft);    color: var(--ou-info-on-soft); }
.tb-measure--attention .tb-measure__level { background: var(--ou-warning-soft); color: var(--ou-warning-on-soft); }
.tb-measure--critical  .tb-measure__level { background: var(--ou-error-soft);   color: var(--ou-error-on-soft); }
```

- [ ] **Step 2: Добавить стили карточки и линейки**

```css
/* PRD-29: measure card — name, value, ruler, level, explanation. */
.tb-measures { display: flex; flex-direction: column; gap: 12px; }
.tb-measure__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.tb-measure__name { font-weight: 600; }
.tb-measure__value { font-variant-numeric: tabular-nums; color: hsl(var(--muted-foreground)); }
.tb-measure__text { margin: 8px 0 0; color: hsl(var(--muted-foreground)); }

/* The ruler paints zones DISCRETELY — the finding of a banded method is categorical,
   and a gradient would hide the step across a band boundary. The marker carries the
   nuance inside a zone instead. */
.tb-ruler { position: relative; margin: 12px 0 8px; padding-bottom: 18px; }
.tb-ruler__track { position: relative; height: 10px; border-radius: 5px; overflow: hidden; }
.tb-ruler__zone { position: absolute; top: 0; height: 100%; background: hsl(var(--tb-zone)); }
.tb-ruler__zone-label {
  position: absolute; top: 12px; left: 0; font-size: 11px; white-space: nowrap;
  color: hsl(var(--muted-foreground)); opacity: 0;
}
.tb-ruler__zone.is-current .tb-ruler__zone-label { opacity: 1; }
.tb-ruler__marker {
  position: absolute; top: -3px; width: 2px; height: 16px; margin-left: -1px;
  background: hsl(var(--foreground)); border-radius: 1px;
}

/* Wide enough for every label; below that only the current zone stays legible. */
@media (min-width: 640px) {
  .tb-ruler__zone-label { opacity: 1; }
}

/* PRD-29: the single recommendations block, structured by resource type. */
.tb-recos { display: flex; flex-direction: column; gap: 12px; }
.tb-recos__text { margin: 0; }
.tb-recos__group { display: flex; flex-direction: column; gap: 6px; }
.tb-recos__group-title { font-size: 12px; text-transform: uppercase; color: hsl(var(--muted-foreground)); }
```

- [ ] **Step 3: Проверить существование использованных токенов**

Run: `npx rg -n -- "--ou-info-soft|--ou-warning-on-soft|--ou-info-on-soft" client/src/styles/vendor/university-rt.css`
Expected: каждое имя найдено. Отсутствующий токен добавляется в `vendor/ui-kit` по
согласованию, локальный шим заводить нельзя.

- [ ] **Step 4: Продублировать правку в файл, который грузится**

`university-rt.css` лежит в ДВУХ копиях: `vendor/ui-kit` — источник, `client/src/styles/vendor`
— то, что реально грузится. Если в Step 3 понадобилась правка DS, внести её в ОБЕ копии.

- [ ] **Step 5: Commit**

```bash
git add server/scorm/templates/default/styles/theme.css
git commit -m "feat(prd-29): стили карточки измерения и линейки с зонами"
```

---

## Task 11: Параметры варианта дизайна

**Files:**

- Modify: `server/scorm/templates/default/manifest.json`
- Test: `server/__tests__/template-manifest-prd29.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// server/__tests__/template-manifest-prd29.test.ts
import { describe, it, expect } from "vitest";
import manifest from "../scorm/templates/default/manifest.json";

const params = manifest.params as Array<Record<string, unknown>>;
const byKey = (key: string) => params.find((p) => p.key === key);

describe("manifest params (PRD-29)", () => {
  it("объявляет схему уровней с четырьмя значениями", () => {
    const p = byKey("levelScheme");
    expect(p?.type).toBe("select");
    expect((p?.options as Array<{ value: string }>).map((o) => o.value))
      .toEqual(["traffic", "neutral", "custom"]);
  });

  it("объявляет три цвета рампы с пустым значением по умолчанию", () => {
    for (const key of ["levelColorFavorable", "levelColorMid", "levelColorUnfavorable"]) {
      const p = byKey(key);
      expect(p?.type).toBe("color");
      expect(p?.default).toBeNull();
    }
  });

  it("объявляет виды рендера для шкал и показателей", () => {
    expect(byKey("scaleRenderKind")?.type).toBe("select");
    expect(byKey("indicatorRenderKind")?.type).toBe("select");
  });
});

describe("manifest contentTemplates (PRD-29)", () => {
  it("вид итогов получает три настройки блоков", () => {
    const results = (manifest.contentTemplates as Array<Record<string, unknown>>)
      .find((c) => c.kind === "results");
    const settings = results?.settings as Array<{ key: string; type: string; default: string }>;
    const keys = settings.map((s) => s.key);
    expect(keys).toEqual(["scoreSummary", "indicators", "scales"]);
    settings.forEach((s) => {
      expect(s.type).toBe("select");
      expect(s.default).toBe("auto");
    });
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- server/__tests__/template-manifest-prd29.test.ts`
Expected: FAIL, параметры не найдены.

- [ ] **Step 3: Добавить параметры в манифест**

В массив `params` дописать (группа существующая — «Цвета», секция `branding`):

```json
{ "key": "levelScheme", "type": "select", "label": "Цветовая схема уровней",
  "default": "traffic", "group": "Цвета", "section": "branding",
  "description": "Как окрашиваются уровни шкал и показателей. «Своя» открывает три поля цвета.",
  "options": [
    { "value": "traffic", "label": "Зелёный — жёлтый — красный" },
    { "value": "neutral", "label": "Нейтральная, оттенки одного цвета" },
    { "value": "custom", "label": "Своя" }
  ] },
{ "key": "levelColorFavorable", "type": "color", "cssVar": "--tb-level-favorable",
  "label": "Цвет благоприятного края", "default": null, "group": "Цвета", "section": "branding",
  "description": "Применяется, когда выбрана схема «Своя»." },
{ "key": "levelColorMid", "type": "color", "cssVar": "--tb-level-mid",
  "label": "Цвет середины", "default": null, "group": "Цвета", "section": "branding",
  "description": "Необязателен: без него переход идёт напрямую из края в край." },
{ "key": "levelColorUnfavorable", "type": "color", "cssVar": "--tb-level-unfavorable",
  "label": "Цвет неблагоприятного края", "default": null, "group": "Цвета", "section": "branding",
  "description": "Применяется, когда выбрана схема «Своя»." },
{ "key": "scaleRenderKind", "type": "select", "label": "Вид шкал",
  "default": "band_ruler", "group": "Итоги", "section": "branding",
  "description": "Применяется там, где выполним; иначе откатывается на ближайший доступный.",
  "options": [
    { "value": "label", "label": "Только уровень" },
    { "value": "value", "label": "Значение" },
    { "value": "value_of_max", "label": "Значение из максимума" },
    { "value": "ring", "label": "Кольцо" },
    { "value": "band_ruler", "label": "Линейка с зонами" },
    { "value": "gradient_bar", "label": "Полоса-градусник" }
  ] },
{ "key": "indicatorRenderKind", "type": "select", "label": "Вид показателей",
  "default": "label", "group": "Итоги", "section": "branding",
  "description": "Применяется там, где выполним; иначе откатывается на ближайший доступный.",
  "options": [
    { "value": "label", "label": "Только уровень" },
    { "value": "value", "label": "Значение" },
    { "value": "value_of_max", "label": "Значение из максимума" },
    { "value": "ring", "label": "Кольцо" },
    { "value": "band_ruler", "label": "Линейка с зонами" },
    { "value": "gradient_bar", "label": "Полоса-градусник" }
  ] }
```

- [ ] **Step 4: Добавить настройки виду итогов**

В `contentTemplates` у записи с `"kind": "results"` заменить `"settings": []` на:

```json
"settings": [
  { "key": "scoreSummary", "type": "select", "label": "Сводка баллов", "default": "auto",
    "options": [
      { "value": "auto", "label": "Автоматически" },
      { "value": "show", "label": "Показывать" },
      { "value": "hide", "label": "Скрывать" }
    ] },
  { "key": "indicators", "type": "select", "label": "Показатели", "default": "auto",
    "options": [
      { "value": "auto", "label": "Автоматически" },
      { "value": "show", "label": "Показывать" },
      { "value": "hide", "label": "Скрывать" }
    ] },
  { "key": "scales", "type": "select", "label": "Шкалы", "default": "auto",
    "options": [
      { "value": "auto", "label": "Автоматически" },
      { "value": "show", "label": "Показывать" },
      { "value": "hide", "label": "Скрывать" }
    ] }
]
```

Поднять `"version"` манифеста с `1.3.0` до `1.4.0`.

- [ ] **Step 5: Убедиться, что тест проходит**

Run: `npm test -- server/__tests__/template-manifest-prd29.test.ts`
Expected: PASS, 4 теста.

- [ ] **Step 6: Проверить валидатор манифеста**

Run: `npm test -- server/__tests__` и `npm run check`
Expected: PASS. Если валидатор не знает `options` у `select`, добавить поддержку в
`server/template-registry.ts` вместе с тестом.

- [ ] **Step 7: Commit**

```bash
git add server/scorm/templates/default/manifest.json server/__tests__/template-manifest-prd29.test.ts
git commit -m "feat(prd-29): параметры схемы уровней, видов рендера и блоков итогов"
```

---

## Task 12: SCORM-пакет

**Files:**

- Modify: `server/scorm/builders/test-json.ts`
- Modify: `server/scorm/template/app/render/resultsPage.js`
- Test: `server/scorm/__tests__/test-json-prd29.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// server/scorm/__tests__/test-json-prd29.test.ts
import { describe, it, expect } from "vitest";
import { buildTestJson } from "../builders/test-json";

const SCALE = {
  id: "s1", key: "emotional_exhaustion", label: "Эмоциональное истощение", type: "number",
  aggregation: "sum", normalization: "none", direction: "positive",
  learnerVisibility: "level_and_value", scormTarget: "none", sortOrder: 0,
  configJson: {
    domainMin: 0, domainMax: 45, valence: "lower_is_better",
    bands: [{ min: 0, max: 14, level: "low", label: "Низкий" },
            { min: 25, max: 45, level: "high", label: "Высокий", text: "Ресурс расходуется быстрее." }],
  },
} as never;

describe("buildTestJson (PRD-29)", () => {
  it("запекает домен, направление и толкования интервалов", () => {
    const json = buildTestJson({ test: { id: "t1", title: "Маслач" }, sections: [], questions: [], scales: [SCALE] } as never);
    const baked = json.scales![0];
    expect(baked.domainMin).toBe(0);
    expect(baked.domainMax).toBe(45);
    expect(baked.valence).toBe("lower_is_better");
    expect(baked.bands[1].text).toBe("Ресурс расходуется быстрее.");
  });

  it("запекает видимость для ученика", () => {
    const json = buildTestJson({ test: { id: "t1", title: "Маслач" }, sections: [], questions: [], scales: [SCALE] } as never);
    expect(json.scales![0].learnerVisibility).toBe("level_and_value");
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- server/scorm/__tests__/test-json-prd29.test.ts`
Expected: FAIL, `domainMin` отсутствует.

- [ ] **Step 3: Запечь новые поля**

В `server/scorm/builders/test-json.ts` в блоке `data.scales.map` (около строки 434) заменить
чтение `config.bands` на полное толкование:

```ts
    test.scales = data.scales.map((s) => {
      const interpretation = parseScaleInterpretation(s.configJson);
      return {
        key: s.key,
        label: s.label,
        type: s.type,
        aggregation: s.aggregation,
        normalization: s.normalization,
        direction: s.direction,
        scormTarget: s.scormTarget,
        // PRD-29: the package renders the same cards the web host does, so it needs
        // the whole interpretation, not just the bands the engine grades with.
        domainMin: interpretation.domainMin,
        domainMax: interpretation.domainMax,
        valence: interpretation.valence,
        learnerVisibility: s.learnerVisibility,
        bands: interpretation.bands,
      };
    });
```

Аналогично для `resultVariables`: добавить `learnerVisibility` и `configJson`.

- [ ] **Step 4: Собрать контекст в рантайме пакета**

В `server/scorm/template/app/render/resultsPage.js` добавить функцию и вызвать её там, где
строится контекст итогов. Файл — plain JS без модулей: только `var`, `function` и
`TBTemplate.*`; синтаксис ES2015+ здесь не используется.

```js
// PRD-29: the package renders the SAME cards the web host does, through the SAME
// shared builder — so `measures` is assembled here to the identical shape.
function buildMeasuresInput(scaleComputation, varComputation) {
  var params = (typeof TEST_DATA !== 'undefined' && TEST_DATA.designParams) || {};
  var scheme = String(params.levelScheme || 'traffic');
  var ramp;
  if (scheme === 'custom') {
    ramp = {
      favorable: String(params.levelColorFavorable || TBTemplate.LEVEL_SCHEMES.traffic.favorable),
      mid: params.levelColorMid ? String(params.levelColorMid) : null,
      unfavorable: String(params.levelColorUnfavorable || TBTemplate.LEVEL_SCHEMES.traffic.unfavorable)
    };
  } else {
    ramp = TBTemplate.LEVEL_SCHEMES[scheme === 'neutral' ? 'neutral' : 'traffic'];
  }

  var scaleValues = (scaleComputation && scaleComputation.values) || {};
  var varValues = (varComputation && varComputation.values) || {};

  var scales = ((typeof TEST_DATA !== 'undefined' && TEST_DATA.scales) || []).map(function (s) {
    return {
      key: s.key,
      name: s.label || s.key,
      value: scaleValues[s.key] ? scaleValues[s.key].raw : null,
      visibility: s.learnerVisibility || 'hidden',
      interpretation: TBTemplate.parseScaleInterpretation(s)
    };
  });

  var indicators = ((typeof TEST_DATA !== 'undefined' && TEST_DATA.resultVariables) || []).map(function (v) {
    return {
      key: v.name,
      name: v.label || v.name,
      value: varValues[v.name],
      visibility: v.learnerVisibility || 'hidden',
      interpretation: TBTemplate.parseIndicatorInterpretation(v.configJson)
    };
  });

  var settings = (typeof TEST_DATA !== 'undefined' && TEST_DATA.resultsSettings) || {};
  return {
    ramp: ramp,
    scaleKind: String(params.scaleRenderKind || 'band_ruler'),
    indicatorKind: String(params.indicatorRenderKind || 'label'),
    scales: scales,
    indicators: indicators,
    testFeedback: (typeof TEST_DATA !== 'undefined' && TEST_DATA.feedback) || null,
    hasPassThreshold: !!(typeof TEST_DATA !== 'undefined' && TEST_DATA.passingScore),
    blockSettings: settings
  };
}
```

Передать результат в существующий вызов построителя:

```js
  var ctx = TBTemplate.buildResultContext(input, title, {
    withTopicPoints: true,
    measures: buildMeasuresInput(scaleComputation, varComputation)
  });
```

Вызывать только когда `TEST_DATA.scales` или `TEST_DATA.resultVariables` непусты.

Экспортировать из `shared/template/runtime-entry.ts` в глобал `TBTemplate`:
`LEVEL_SCHEMES`, `parseScaleInterpretation`, `parseIndicatorInterpretation`. Без этого
рантайм упадёт на первом же вызове.

Примечание: `parseScaleInterpretation` в пакете принимает ЗАПЕЧЁННУЮ шкалу (домен и valence
лежат на верхнем уровне, а не внутри `configJson`), поэтому в Step 3 поля кладутся плоско.
Функция читает и то, и другое: `resolveDomain` смотрит `domainMin`/`domainMax` в переданном
объекте, а `bands` — там же.

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test -- server/scorm/__tests__/test-json-prd29.test.ts`
Expected: PASS, 2 теста.

- [ ] **Step 6: Пересобрать пакет и проверить в плеере**

Правки рантайм-JS требуют ПЕРЕСБОРКИ пакета, а не перезапуска dev-сервера; правки серверного
TypeScript — наоборот, перезапуска (`tsx` работает без watch).

```bash
npm run scorm:template
npm run scorm:player
```

Открыть `http://localhost:5050`, пройти тест до итогов, убедиться, что карточки шкал
и рекомендации отрисованы так же, как в вебе.

- [ ] **Step 7: Commit**

```bash
git add server/scorm/builders/test-json.ts server/scorm/template/app/render/resultsPage.js
git add server/scorm/__tests__/test-json-prd29.test.ts
git commit -m "feat(prd-29): шкалы и показатели на экране итогов SCORM-пакета"
```

---

## Task 13: Редактор шкалы — домен, направление, видимость

**Files:**

- Modify: `client/src/features/tests/editor/sections/scales-section.tsx`
- Modify: `client/src/features/tests/editor/scales-api.ts`
- Modify: `client/src/features/tests/editor/test-editor.types.ts`
- Test: `client/src/features/tests/editor/sections/__tests__/scales-prd29.test.tsx`

- [ ] **Step 1: Написать падающий тест**

```tsx
// client/src/features/tests/editor/sections/__tests__/scales-prd29.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScalesSection } from "../scales-section";
import { emptyTestEditorModel } from "../../test-editor.types";

function modelWithScale() {
  const model = emptyTestEditorModel();
  model.scales = [{
    clientKey: "k1", key: "ee", label: "Эмоциональное истощение", type: "number",
    aggregation: "sum", normalization: "none", direction: "positive",
    bands: [], learnerVisibility: "hidden", scormTarget: "none", sortOrder: 0,
    domainMin: null, domainMax: null, valence: "none",
  }];
  return model;
}

describe("ScalesSection (PRD-29)", () => {
  it("показывает выбор видимости — тогл больше не скрыт", () => {
    render(<ScalesSection model={modelWithScale()} updateModel={() => {}} />);
    expect(screen.getByTestId("scales-visibility-0")).toBeInTheDocument();
  });

  it("показывает поля домена", () => {
    render(<ScalesSection model={modelWithScale()} updateModel={() => {}} />);
    expect(screen.getByTestId("scales-domain-min-0")).toBeInTheDocument();
    expect(screen.getByTestId("scales-domain-max-0")).toBeInTheDocument();
  });

  it("показывает выбор благоприятного направления", () => {
    render(<ScalesSection model={modelWithScale()} updateModel={() => {}} />);
    expect(screen.getByTestId("scales-valence-0")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- client/src/features/tests/editor/sections/__tests__/scales-prd29.test.tsx`
Expected: FAIL, элементы не найдены.

- [ ] **Step 3: Снять сокрытие тогла и заменить его на выбор**

Удалить константу `SHOW_LEARNER_RESULT_TOGGLE` и её условие (строки 64-66 и место
использования около строки 610). Вместо `Switch` поставить `Select` из ui-kit:

```tsx
          <Select<LearnerVisibility>
            size="m"
            fullWidth
            label="Показывать обучающемуся"
            value={s.learnerVisibility}
            disabled={readOnly}
            options={[
              { value: "hidden", label: "Не показывать" },
              { value: "level", label: "Уровень и толкование" },
              { value: "level_and_value", label: "Уровень, толкование и значение" },
            ]}
            onChange={(value) => onChange({ learnerVisibility: value })}
            data-testid={`scales-visibility-${index}`}
          />
```

Импортировать готовый компонент из ui-kit; писать `.ou-*` разметку руками нельзя.

- [ ] **Step 4: Добавить домен и направление**

```tsx
          <div className="ou-formrow">
            <Input
              size="m" type="number" label="Минимум шкалы"
              value={s.domainMin ?? ""} disabled={readOnly}
              onChange={(e) => onChange({ domainMin: e.target.value === "" ? null : Number(e.target.value) })}
              data-testid={`scales-domain-min-${index}`}
            />
            <Input
              size="m" type="number" label="Максимум шкалы"
              value={s.domainMax ?? ""} disabled={readOnly}
              onChange={(e) => onChange({ domainMax: e.target.value === "" ? null : Number(e.target.value) })}
              data-testid={`scales-domain-max-${index}`}
            />
          </div>
          <Select<Valence>
            size="m" fullWidth label="Благоприятное направление"
            value={s.valence} disabled={readOnly}
            options={[
              { value: "higher_is_better", label: "Чем больше, тем лучше" },
              { value: "lower_is_better", label: "Чем больше, тем хуже" },
              { value: "none", label: "Без оценки" },
            ]}
            onChange={(value) => onChange({ valence: value })}
            data-testid={`scales-valence-${index}`}
          />
```

- [ ] **Step 5: Предзаполнить домен расчётом**

Под полями домена — кнопка, вызывающая `computeScaleDomain` по вкладам этой шкалы из модели:

```tsx
          <Button
            size="s" variant="secondary" disabled={readOnly}
            onClick={() => {
              const domain = computeScaleDomain(s.aggregation, measurementsOf(model, s));
              if (domain) onChange({ domainMin: domain.min, domainMax: domain.max });
            }}
            data-testid={`scales-domain-suggest-${index}`}
          >
            Рассчитать по вкладам
          </Button>
```

Если сохранённый домен расходится с расчётным, под кнопкой показать `ou-banner` с
предупреждением. Тихого пересчёта не делать.

- [ ] **Step 6: Провести поля через модель и API**

В `test-editor.types.ts` добавить в `ScaleModel` поля `domainMin: number | null`,
`domainMax: number | null`, `valence: Valence`, `learnerVisibility: LearnerVisibility`;
в `scales-api.ts` — упаковку `domainMin`/`domainMax`/`valence` в `configJson` при отправке
и распаковку при чтении.

- [ ] **Step 7: Убедиться, что тесты проходят**

Run: `npm test -- client/src/features/tests/editor`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/src/features/tests/editor
git commit -m "feat(prd-29): домен, направление и видимость в редакторе шкал"
```

---

## Task 14: Редактор толкований

**Files:**

- Modify: `client/src/features/tests/editor/sections/scales-section.tsx` (таблица интервалов)
- Modify: `client/src/features/tests/editor/sections/result-variables-section.tsx` (перечень исходов)
- Test: `client/src/features/tests/editor/sections/__tests__/interpretation-editor.test.tsx`

- [ ] **Step 1: Написать падающий тест**

```tsx
// client/src/features/tests/editor/sections/__tests__/interpretation-editor.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InterpretationBandsEditor } from "../interpretation-bands-editor";
import { OutcomesEditor } from "../outcomes-editor";

describe("InterpretationBandsEditor", () => {
  it("рисует строку на каждый интервал", () => {
    render(<InterpretationBandsEditor
      bands={[{ min: 0, max: 14, level: "low", label: "Низкий" }]}
      readOnly={false} onChange={() => {}} />);
    expect(screen.getByTestId("band-label-0")).toHaveValue("Низкий");
  });

  it("даёт поле толкования на каждый интервал", () => {
    const onChange = vi.fn();
    render(<InterpretationBandsEditor
      bands={[{ min: 0, max: 14, level: "low", label: "Низкий" }]}
      readOnly={false} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("band-text-0"), { target: { value: "Ресурс в норме." } });
    expect(onChange).toHaveBeenCalledWith([
      { min: 0, max: 14, level: "low", label: "Низкий", text: "Ресурс в норме." },
    ]);
  });
});

describe("OutcomesEditor", () => {
  it("рисует строку на каждый исход", () => {
    render(<OutcomesEditor
      outcomes={[{ code: "engaged", label: "Вовлечённость" }]}
      readOnly={false} onChange={() => {}} />);
    expect(screen.getByTestId("outcome-code-0")).toHaveValue("engaged");
  });

  it("добавляет исход по кнопке", () => {
    const onChange = vi.fn();
    render(<OutcomesEditor outcomes={[]} readOnly={false} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("outcome-add"));
    expect(onChange).toHaveBeenCalledWith([{ code: "", label: "" }]);
  });

  it("предлагает исходы, найденные в формуле", () => {
    render(<OutcomesEditor outcomes={[]} readOnly={false} onChange={() => {}}
      suggestedCodes={["engaged", "burnout"]} />);
    expect(screen.getByTestId("outcome-suggest")).toHaveTextContent("engaged");
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- client/src/features/tests/editor/sections/__tests__/interpretation-editor.test.tsx`
Expected: FAIL, модули не найдены.

- [ ] **Step 3: Создать редактор интервалов**

```tsx
// client/src/features/tests/editor/sections/interpretation-bands-editor.tsx
/**
 * @module client/features/tests/editor/sections/interpretation-bands-editor
 *
 * Table editor for a numeric interpretation: one row per band, carrying the
 * boundaries, the level label, the explanatory text and an optional tone override.
 *
 * Tone is offered as a closed list of METHODOLOGICAL states rather than colours —
 * the template decides how a state looks, so the same data renders correctly in a
 * light theme, a dark theme and a differently-branded template.
 */

import { Button, Input, Select, Textarea, Banner } from "@universityrt/ui-kit";
import type { InterpretationBand, LevelTone } from "@shared/scales/interpretation";

const TONE_OPTIONS: Array<{ value: LevelTone | ""; label: string }> = [
  { value: "", label: "По направлению шкалы" },
  { value: "favorable", label: "Благоприятный" },
  { value: "neutral", label: "Нейтральный" },
  { value: "attention", label: "Внимание" },
  { value: "critical", label: "Критический" },
];

export type InterpretationBandsEditorProps = {
  bands: InterpretationBand[];
  readOnly: boolean;
  onChange: (bands: InterpretationBand[]) => void;
  domainMin?: number | null;
  domainMax?: number | null;
};

/** Gaps, overlaps and out-of-domain bands make the ruler unreadable — surface them. */
function validate(bands: InterpretationBand[], min?: number | null, max?: number | null): string[] {
  const problems: string[] = [];
  const sorted = bands.slice().sort((a, b) => a.min - b.min);
  sorted.forEach((band, i) => {
    if (band.min > band.max) problems.push(`Интервал «${band.label ?? band.level}»: начало больше конца`);
    if (i > 0 && band.min <= sorted[i - 1].max) problems.push(`Интервалы «${sorted[i - 1].label ?? ""}» и «${band.label ?? ""}» пересекаются`);
    if (i > 0 && band.min > sorted[i - 1].max + 1) problems.push(`Между «${sorted[i - 1].label ?? ""}» и «${band.label ?? ""}» есть разрыв`);
  });
  if (sorted.length && min != null && sorted[0].min < min) problems.push("Первый интервал выходит за минимум шкалы");
  if (sorted.length && max != null && sorted[sorted.length - 1].max > max) problems.push("Последний интервал выходит за максимум шкалы");
  return problems;
}

export function InterpretationBandsEditor({
  bands, readOnly, onChange, domainMin, domainMax,
}: InterpretationBandsEditorProps) {
  const patch = (i: number, next: Partial<InterpretationBand>) =>
    onChange(bands.map((b, j) => (j === i ? { ...b, ...next } : b)));
  const problems = validate(bands, domainMin, domainMax);

  return (
    <div className="tb-bands-editor">
      {bands.map((band, i) => (
        <div className="ou-formrow" key={`${band.level}-${i}`}>
          <Input size="s" type="number" label="От" value={band.min} disabled={readOnly}
            onChange={(e) => patch(i, { min: Number(e.target.value) })}
            data-testid={`band-min-${i}`} />
          <Input size="s" type="number" label="До" value={band.max} disabled={readOnly}
            onChange={(e) => patch(i, { max: Number(e.target.value) })}
            data-testid={`band-max-${i}`} />
          <Input size="s" label="Метка уровня" value={band.label ?? ""} disabled={readOnly}
            onChange={(e) => patch(i, { label: e.target.value })}
            data-testid={`band-label-${i}`} />
          <Select<LevelTone | ""> size="s" label="Оценка уровня" value={band.tone ?? ""}
            disabled={readOnly} options={TONE_OPTIONS}
            onChange={(value) => patch(i, value ? { tone: value } : { tone: undefined })}
            data-testid={`band-tone-${i}`} />
          <Textarea size="s" label="Толкование" value={band.text ?? ""} disabled={readOnly}
            onChange={(e) => patch(i, { text: e.target.value })}
            data-testid={`band-text-${i}`} />
          <Button size="s" variant="ghost" disabled={readOnly}
            onClick={() => onChange(bands.filter((_, j) => j !== i))}
            data-testid={`band-remove-${i}`}>Удалить</Button>
        </div>
      ))}
      <Button size="s" variant="secondary" disabled={readOnly}
        onClick={() => onChange([...bands, { min: 0, max: 0, level: `level_${bands.length + 1}`, label: "" }])}
        data-testid="band-add">Добавить интервал</Button>
      {problems.length > 0 && (
        <Banner variant="warning" data-testid="band-problems">{problems.join("; ")}</Banner>
      )}
    </div>
  );
}
```

Перед использованием сверить имена компонентов и их пропсы с `vendor/ui-kit` — писать
`.ou-*` разметку руками нельзя, а недостающий примитив добавляется в ui-kit по согласованию.

- [ ] **Step 4: Создать редактор исходов**

```tsx
// client/src/features/tests/editor/sections/outcomes-editor.tsx
/**
 * @module client/features/tests/editor/sections/outcomes-editor
 *
 * Editor for a string/boolean indicator's outcome list — the set of values the
 * formula may return. Declaring outcomes is what makes a typo in the formula an
 * editing-time error instead of an empty card for one unlucky learner.
 *
 * `suggestedCodes` carries the literals found in the formula that the list does not
 * declare yet, so an existing formula seeds its own outcome list in one click.
 */

import { Button, Input, Select, Textarea } from "@universityrt/ui-kit";
import type { InterpretationOutcome, LevelTone } from "@shared/scales/interpretation";

const TONE_OPTIONS: Array<{ value: LevelTone; label: string }> = [
  { value: "favorable", label: "Благоприятный" },
  { value: "neutral", label: "Нейтральный" },
  { value: "attention", label: "Внимание" },
  { value: "critical", label: "Критический" },
];

export type OutcomesEditorProps = {
  outcomes: InterpretationOutcome[];
  readOnly: boolean;
  onChange: (outcomes: InterpretationOutcome[]) => void;
  suggestedCodes?: string[];
};

export function OutcomesEditor({ outcomes, readOnly, onChange, suggestedCodes = [] }: OutcomesEditorProps) {
  const patch = (i: number, next: Partial<InterpretationOutcome>) =>
    onChange(outcomes.map((o, j) => (j === i ? { ...o, ...next } : o)));

  return (
    <div className="tb-outcomes-editor">
      {outcomes.map((outcome, i) => (
        <div className="ou-formrow" key={`${outcome.code}-${i}`}>
          <Input size="s" label="Код" value={outcome.code} disabled={readOnly}
            onChange={(e) => patch(i, { code: e.target.value })}
            data-testid={`outcome-code-${i}`} />
          <Input size="s" label="Метка" value={outcome.label} disabled={readOnly}
            onChange={(e) => patch(i, { label: e.target.value })}
            data-testid={`outcome-label-${i}`} />
          <Select<LevelTone> size="s" label="Оценка" value={outcome.tone ?? "neutral"}
            disabled={readOnly} options={TONE_OPTIONS}
            onChange={(value) => patch(i, { tone: value })}
            data-testid={`outcome-tone-${i}`} />
          <Textarea size="s" label="Толкование" value={outcome.text ?? ""} disabled={readOnly}
            onChange={(e) => patch(i, { text: e.target.value })}
            data-testid={`outcome-text-${i}`} />
          <Button size="s" variant="ghost" disabled={readOnly}
            onClick={() => onChange(outcomes.filter((_, j) => j !== i))}
            data-testid={`outcome-remove-${i}`}>Удалить</Button>
        </div>
      ))}
      <Button size="s" variant="secondary" disabled={readOnly}
        onClick={() => onChange([...outcomes, { code: "", label: "" }])}
        data-testid="outcome-add">Добавить исход</Button>
      {suggestedCodes.length > 0 && (
        <div className="tb-outcomes-editor__suggest" data-testid="outcome-suggest">
          <span>В формуле встречаются коды, которых нет в перечне:</span>
          {suggestedCodes.map((code) => (
            <Button key={code} size="s" variant="ghost" disabled={readOnly}
              onClick={() => onChange([...outcomes, { code, label: code }])}>{code}</Button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Встроить редакторы в секции**

В карточку шкалы — редактор интервалов вместо нынешнего плоского списка `bands`.
В карточку показателя — редактор исходов для типов `string` и `boolean`, редактор интервалов
для `number`.

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `npm test -- client/src/features/tests/editor`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/features/tests/editor/sections
git commit -m "feat(prd-29): редакторы интервалов и перечня исходов"
```

---

## Task 15: Сверка формулы с перечнем исходов

**Files:**

- Create: `shared/formula/outcome-literals.ts`
- Test: `shared/formula/__tests__/outcome-literals.test.ts`
- Modify: `client/src/features/tests/editor/sections/result-variables-section.tsx`

- [ ] **Step 1: Написать падающий тест**

```ts
// shared/formula/__tests__/outcome-literals.test.ts
import { describe, it, expect } from "vitest";
import { collectStringLiterals, findUnknownOutcomes } from "../outcome-literals";

describe("collectStringLiterals", () => {
  it("собирает строковые константы формулы", () => {
    expect(collectStringLiterals('IF(scaleById("s").raw > 10, "high", "low")').sort())
      .toEqual(["high", "low", "s"]);
  });

  it("не падает на синтаксически неверной формуле", () => {
    expect(collectStringLiterals("IF(")).toEqual([]);
  });

  it("схлопывает повторы", () => {
    expect(collectStringLiterals('IF(1, "a", "a")')).toEqual(["a"]);
  });
});

describe("findUnknownOutcomes", () => {
  it("находит исход, которого нет в перечне", () => {
    expect(findUnknownOutcomes('IF(1, "growing", "burnout")', ["growing"])).toEqual(["burnout"]);
  });

  it("игнорирует аргументы функций доступа к шкалам", () => {
    expect(findUnknownOutcomes('IF(scaleById("ee").raw > 10, "growing", "growing")', ["growing"]))
      .toEqual([]);
  });

  it("возвращает пустой список, когда перечень пуст", () => {
    expect(findUnknownOutcomes('IF(1, "a", "b")', [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- shared/formula/__tests__/outcome-literals.test.ts`
Expected: FAIL, «Cannot find module '../outcome-literals'».

- [ ] **Step 3: Реализовать модуль**

```ts
/**
 * @module shared/formula/outcome-literals
 *
 * Reconciles a string indicator's formula with its declared outcome list.
 *
 * The formula returns an outcome CODE. Nothing else checks that the codes it can
 * return actually exist: a one-character typo silently produces an empty card, and
 * only for the learner who lands in that branch. Walking the AST turns that into an
 * editing-time error.
 *
 * Accessor arguments (`scaleById("ee")`) are string literals too, so they are
 * excluded — they name a scale, not an outcome.
 *
 * Pure — no DOM, no Node.
 */

import { parse } from "./parser";
import type { Ast } from "./types";

/** Function names whose string arguments address an entity, not an outcome. */
const ACCESSORS = new Set(["scalebyid", "topicbyid", "topicbyname", "tagbyid", "var", "sectionbyid"]);

function walk(node: Ast, out: Set<string>, skip: Set<Ast>): void {
  if (!node || typeof node !== "object") return;
  const n = node as unknown as Record<string, unknown>;
  if (n.type === "string" && !skip.has(node)) {
    out.add(String(n.value ?? ""));
    return;
  }
  if (n.type === "call" && typeof n.name === "string" && ACCESSORS.has(n.name.toLowerCase())) {
    const args = (n.args as Ast[]) ?? [];
    args.forEach((a) => skip.add(a));
  }
  Object.values(n).forEach((value) => {
    if (Array.isArray(value)) value.forEach((v) => walk(v as Ast, out, skip));
    else if (value && typeof value === "object") walk(value as Ast, out, skip);
  });
}

/** Every distinct string literal in the formula, accessor arguments included. */
export function collectStringLiterals(formula: string): string[] {
  try {
    const ast = parse(formula);
    const out = new Set<string>();
    walk(ast, out, new Set());
    return Array.from(out);
  } catch {
    return [];
  }
}

/**
 * Literals the formula can return that the outcome list does not declare. An empty
 * outcome list yields nothing: the author has not started declaring outcomes yet, and
 * flagging every literal at that point would be noise.
 */
export function findUnknownOutcomes(formula: string, codes: string[]): string[] {
  if (codes.length === 0) return [];
  try {
    const ast = parse(formula);
    const literals = new Set<string>();
    const skip = new Set<Ast>();
    walk(ast, literals, skip);
    const known = new Set(codes);
    return Array.from(literals).filter((l) => !known.has(l));
  } catch {
    return [];
  }
}
```

Если структура AST в `shared/formula/types.ts` называет узлы иначе (`args` против
`arguments`, `name` против `callee`), привести обход в соответствие ФАКТИЧЕСКИМ именам —
и поправить тест, а не подгонять модуль под догадку.

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- shared/formula/__tests__/outcome-literals.test.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 5: Подключить сверку к редактору**

В `result-variables-section.tsx` при каждом изменении формулы или перечня вызывать
`findUnknownOutcomes` и показывать `ou-banner` со списком неизвестных кодов и кнопкой
«Добавить в перечень». Ошибку показывать, но сохранение не блокировать: автор может
заполнять формулу и перечень в любом порядке.

- [ ] **Step 6: Commit**

```bash
git add shared/formula/outcome-literals.ts shared/formula/__tests__/outcome-literals.test.ts
git add client/src/features/tests/editor/sections/result-variables-section.tsx
git commit -m "feat(prd-29): сверка литералов формулы с перечнем исходов"
```

---

## Task 16: Приёмка

**Files:**

- Create: `docs/specs/prd-29/acceptance.md`

- [ ] **Step 1: Подготовить референсный тест**

Импортировать `docs/references/workbook_Выгорание_Маслач (1).xlsx`. В редакторе дозаполнить
то, чего в книге ещё нет: домен (кнопка «Рассчитать по вкладам» должна дать 45, 25 и 40),
направление (`lower_is_better` у первых двух шкал, `higher_is_better` у третьей),
толкования интервалов, перечень из пяти исходов показателя, видимость `level` у шкал
и `level` у показателя.

- [ ] **Step 2: Прогнать веб-сценарий в браузере**

Пройти тест целиком под учеником и проверить на экране итогов:

- сводка баллов отсутствует (порога у теста нет, настройка `auto`);
- блок «Ваш результат» стоит выше блока «По шкалам»;
- у третьей шкалы благоприятный край СЛЕВА при той же цветовой схеме;
- маркер стоит внутри текущей зоны, а не на её границе;
- метка уровня присутствует у каждой карточки, число отсутствует при видимости `level`;
- блок «Что можно сделать» один, ссылки не повторяются.

Проверка выполняется в реальном браузере. Модульных тестов и `npm run check` недостаточно.

- [ ] **Step 3: Прогнать SCORM-сценарий**

```bash
npm run scorm:template
npm run scorm:player
```

Сравнить экран итогов с веб-версией. Расхождение — дефект паритета, а не особенность хоста.

- [ ] **Step 4: Прогнать контрольный тест**

Открыть любой существующий тест с порогом и без шкал. Экран итогов обязан выглядеть в
точности как до изменений.

- [ ] **Step 5: Проверить откаты**

- шкала без домена — вид `label`, предупреждений нет;
- показатель со строковым значением при `scaleRenderKind: band_ruler` — метка;
- формула, возвращающая код вне перечня, — предупреждение в редакторе.

- [ ] **Step 6: Записать матрицу приёмки**

Создать `docs/specs/prd-29/acceptance.md` по образцу
`docs/specs/prd-15/acceptance-matrix.md`: строка на проверку, ожидаемый результат,
фактический, ссылка на скриншот.

- [ ] **Step 7: Прогнать полный набор проверок**

Run: `npm run check`
Expected: 0 ошибок.

Run: `npm test`
Expected: PASS, порог покрытия 80 процентов держится.

Run: `npm run lint:md`
Expected: 0 замечаний.

Не запускать `vitest` параллельно с `npm test`: они делят каталог покрытия и мешают друг другу.

- [ ] **Step 8: Commit**

```bash
git add docs/specs/prd-29/acceptance.md
git commit -m "docs(prd-29): матрица приёмки"
```

---

## Известные ограничения

- Книга Excel новых полей не переносит: после импорта методику дозаполняют в интерфейсе.
  Вынесено в отдельную спеку (PRD-29 §13.4).
- Итоги раздела не показывают шкал. Шкала считается по всему тесту, и частичный расчёт был
  бы неверен; при необходимости автор заводит шкалу, измерения которой лежат внутри раздела.
- Отчёт PDF шкал и показателей пока не показывает (PRD-29 §13.1).
- Показатель задаётся формулой; таблица решений по уровням шкал — следующая спека
  (PRD-29 §13.2). До неё сложные профили пишутся вложенными `IF`.
