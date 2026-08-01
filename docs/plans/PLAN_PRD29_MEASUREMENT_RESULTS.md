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
| Э4 — веб-контекст и блоки | 8.1, 9 | Task 8, 8b |
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

/** Засечка границы на рельсе (`ou-slider__mark` + `ou-slider__mark-lbl`). */
export interface CtxMeasureMark {
  percent: number;
  label: string;
}

/** Строка шкалы или показателя на экране итогов. */
export interface CtxMeasureView {
  key: string;
  name: string;
  renderKind: RenderKind;
  showValue: boolean;
  /** Число и максимум порознь: `ou-slider__val` печатает `<strong>27</strong> из 45`. */
  valueText: string;
  maxText: string;
  /** Единой строкой — для видов без рельса (`value`, `value_of_max`). */
  valueLabel: string;
  levelLabel: string;
  tone: LevelTone;
  /** Core-prepared класс плашки уровня. */
  toneClass: string;
  /** Core-prepared модификатор `ou-banner--*` для блока показателя. */
  bannerVariant: "success" | "info" | "warning" | "error";
  text?: string;
  zones: CtxMeasureZone[];
  /** Числовые границы под рельсом: края домена и начала интервалов. */
  marks: CtxMeasureMark[];
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
| `shared/scales/engine.ts` (править) | вынести `achievableRange` — общий расчёт достижимого диапазона |
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
| `client/src/features/tests/editor/sections/start-pages-section.tsx` (править) | подписи `optionLabels` у настроек страницы |
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

## Task 3: Достижимый диапазон шкалы

**Files:**

- Modify: `shared/scales/engine.ts` (вынести и экспортировать `achievableRange`)
- Test: `shared/scales/__tests__/achievable-range.test.ts`

Домен шкалы предзаполняется её теоретическим диапазоном. Наивно вывести его как «сумма
максимальных вкладов каждого вопроса» НЕЛЬЗЯ — движок уже считает этот диапазон, и
считает иначе:

- у одноиндексного вопроса (`single`, `scale`) срабатывает ровно ОДИН вклад, а
  неизмеряемый вариант даёт ноль, поэтому диапазон вопроса — `[min(0, …), max(0, …)]`;
- у `multiple` / `matching` / `ranking` вкладов срабатывает несколько, поэтому крайние
  значения — суммы отрицательных и положительных вкладов;
- агрегация применяется к пер-вопросным крайним значениям тем же `aggregate`, включая
  `weighted_avg`.

Эта математика живёт в `rawRange` (`shared/scales/engine.ts`). Второй экземпляр той же
логики разъедется с первым: домен, посчитанный иначе, чем движок нормирует `percent`,
даст линейку, на которой значение стоит не там, где стоит его уровень. Поэтому задача —
не написать новый расчёт, а ВЫНЕСТИ существующий и позвать его с другим входом.

Разница входов ровно одна: `rawRange` берёт только ВЫДАННЫЕ вопросы (у которых есть
запись в `answers`), потому что невыданный вопрос вносит ноль и его крайние значения
вытолкнули бы `raw` за границы. Домен же теоретический — он считается по ВСЕМ
объявленным вкладам, независимо от выдачи.

- [ ] **Step 1: Написать падающий тест**

```ts
// shared/scales/__tests__/achievable-range.test.ts
import { describe, it, expect } from "vitest";
import { achievableRange } from "../engine";
import type { MeasurementSpec, QuestionType } from "../engine";

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

/** Every question of the Maslach scale is a graduated `scale` question. */
function maslachTypes(): Record<string, QuestionType> {
  const types: Record<string, QuestionType> = {};
  for (let q = 1; q <= 9; q += 1) types[`q${q}`] = "scale";
  return types;
}

describe("achievableRange", () => {
  it("для sum складывает достижимые крайние значения каждого вопроса", () => {
    expect(achievableRange(maslachEE(), "sum", maslachTypes())).toEqual({ min: 0, max: 45 });
  });

  it("учитывает вес", () => {
    const m: MeasurementSpec[] = [
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "0", value: 2, weight: 3 },
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "1", value: 1, weight: 3 },
    ];
    expect(achievableRange(m, "sum", { q1: "single" })).toEqual({ min: 0, max: 6 });
  });

  it("зажимает нижнюю границу нулём: одноиндексный вопрос может не выбрать измеряемый вариант", () => {
    const m: MeasurementSpec[] = [
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "0", value: 3, weight: 1 },
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "1", value: 5, weight: 1 },
    ];
    expect(achievableRange(m, "sum", { q1: "single" })).toEqual({ min: 0, max: 5 });
  });

  it("для множественного выбора складывает вклады внутри вопроса", () => {
    const m: MeasurementSpec[] = [
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "0", value: 2, weight: 1 },
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "1", value: 3, weight: 1 },
    ];
    expect(achievableRange(m, "sum", { q1: "multiple" })).toEqual({ min: 0, max: 5 });
  });

  it("учитывает отрицательные вклады в нижней границе", () => {
    const m: MeasurementSpec[] = [
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "0", value: -2, weight: 1 },
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "1", value: 3, weight: 1 },
    ];
    expect(achievableRange(m, "sum", { q1: "single" })).toEqual({ min: -2, max: 3 });
  });

  it("для avg берёт границы одного вклада", () => {
    expect(achievableRange(maslachEE(), "avg", maslachTypes())).toEqual({ min: 0, max: 5 });
  });

  it("для max и min берёт границы множества вкладов", () => {
    expect(achievableRange(maslachEE(), "max", maslachTypes())).toEqual({ min: 0, max: 5 });
    expect(achievableRange(maslachEE(), "min", maslachTypes())).toEqual({ min: 0, max: 5 });
  });

  it("считает и weighted_avg", () => {
    expect(achievableRange(maslachEE(), "weighted_avg", maslachTypes())).toEqual({ min: 0, max: 5 });
  });

  it("возвращает null на пустом списке вкладов", () => {
    expect(achievableRange([], "sum", {})).toBeNull();
  });

  it("не зависит от порядка вкладов", () => {
    const straight = achievableRange(maslachEE(), "sum", maslachTypes());
    const reversed = achievableRange(maslachEE().reverse(), "sum", maslachTypes());
    expect(reversed).toEqual(straight);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- shared/scales/__tests__/achievable-range.test.ts`
Expected: FAIL, `achievableRange` не экспортируется из `../engine`.

- [ ] **Step 3: Вынести расчёт из `rawRange`**

В `shared/scales/engine.ts` заменить тело `rawRange` на фильтр плюс вызов, а саму
математику поднять в новую экспортируемую функцию. Комментарий, объясняющий пер-вопросные
крайние значения, переезжает вместе с кодом.

```ts
/**
 * Achievable `{ min, max }` of a scale over a set of measurement units — the range
 * `raw` can land in. Exported because two callers need the SAME arithmetic on
 * different inputs: `percent` normalization runs it over the DELIVERED units, while
 * PRD-29 seeds a scale's stored domain from ALL declared ones. A second copy would
 * drift, and a domain computed differently from the one `percent` normalizes against
 * puts the ruler's marker somewhere other than its own level.
 *
 * Per-question achievable contribution:
 * - single / scale: exactly one unit fires and an unmeasured option scores 0, so the
 *   range is `[min(0, …vals), max(0, …vals)]`;
 * - multiple / matching / ranking: several units can fire together (a subset of
 *   options, every formed pair, every placement), so the extremes are the sums of the
 *   negative / positive units — the same way `raw` sums the active ones.
 *
 * `null` when there is nothing to measure: an empty set has no range, and reporting
 * `{ min: 0, max: 0 }` would look like a legitimate zero-width domain.
 */
export function achievableRange(
  measurements: MeasurementSpec[],
  agg: ScaleAggregation,
  questionTypes: Record<string, QuestionType>,
): { min: number; max: number } | null {
  if (measurements.length === 0) return null;

  const byQuestion = new Map<string, MeasurementSpec[]>();
  for (const m of measurements) {
    const list = byQuestion.get(m.questionId) ?? [];
    list.push(m);
    byQuestion.set(m.questionId, list);
  }

  const mins: number[] = [];
  const maxes: number[] = [];
  const weights: number[] = [];
  for (const [questionId, ms] of byQuestion) {
    const vals = ms.map((m) => m.value * m.weight);
    if (isSingleIndexChoice(questionTypes[questionId] ?? "")) {
      mins.push(Math.min(0, ...vals));
      maxes.push(Math.max(0, ...vals));
    } else {
      mins.push(vals.filter((v) => v < 0).reduce((s, v) => s + v, 0));
      maxes.push(vals.filter((v) => v > 0).reduce((s, v) => s + v, 0));
    }
    weights.push(ms.reduce((s, m) => s + m.weight, 0) / ms.length);
  }

  return { min: aggregate(mins, agg, weights), max: aggregate(maxes, agg, weights) };
}
```

`rawRange` сокращается до фильтра по выданным вопросам и делегирования. Прежнее поведение
сохраняется: пустой отфильтрованный список раньше давал `aggregate([], …) = 0` для обеих
границ, поэтому `null` здесь разворачивается обратно в нули.

```ts
function rawRange(
  scaleMeasurements: MeasurementSpec[],
  agg: ScaleAggregation,
  questionTypes: Record<string, QuestionType>,
  answers: Record<string, Answer>,
): { min: number; max: number } {
  // Only units the learner was actually given bound the range: a bank question the
  // draw did not deliver contributes 0 to `raw`, so counting its extremes would push
  // `raw` outside [min, max] and make percent go negative / exceed 100.
  const delivered = scaleMeasurements.filter((m) =>
    Object.prototype.hasOwnProperty.call(answers, m.questionId),
  );
  return achievableRange(delivered, agg, questionTypes) ?? { min: 0, max: 0 };
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- shared/scales/__tests__/achievable-range.test.ts`
Expected: PASS, 10 тестов. Первый — контрольный: 45 совпадает с верхней границей
интервалов референсной книги.

- [ ] **Step 5: Убедиться, что движок не сломан**

Run: `npm test -- shared/scales/engine.test.ts`
Expected: PASS без единого изменения в самом файле теста. Если хоть один тест движка
покраснел — вынос выполнен неверно, чинить вынос, а не тест.

Run: `npm run check`
Expected: 0 ошибок.

- [ ] **Step 6: Commit**

```bash
git add shared/scales/engine.ts shared/scales/__tests__/achievable-range.test.ts
git commit -m "feat(prd-29): достижимый диапазон шкалы вынесен из rawRange"
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

## Task 5: Сборка строки шкалы и показателя

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

  it("НИКОГДА не подставляет кольцо автоматически вместо линейки", () => {
    // Кольцо печатает процент, а при normalization: none процент не определён.
    // Как явный выбор автора оно допустимо, как автозамена — нет.
    expect(resolveRenderKind("band_ruler", { hasDomain: true, hasBands: false, isNumeric: true }))
      .not.toBe("ring");
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

  it("отдаёт число и максимум порознь для ou-slider__val", () => {
    expect(ee().valueText).toBe("27");
    expect(ee().maxText).toBe("45");
  });

  it("ставит засечки на края домена и начала интервалов", () => {
    expect(ee().marks).toEqual([
      { percent: 0, label: "0" },
      { percent: 33.3, label: "15" },
      { percent: 55.6, label: "25" },
      { percent: 100, label: "45" },
    ]);
  });

  it("готовит класс плашки и вариант баннера по тону", () => {
    const v = ee();
    expect(v.tone).toBe("critical");
    expect(v.toneClass).toBe("tb-tone--critical");
    expect(v.bannerVariant).toBe("error");
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

  it("средний интервал получает тон «внимание», а не «нейтральный»", () => {
    // Тон обязан совпадать с цветом своей зоны: середина рампы жёлтая, значит и
    // плашка уровня жёлтая. Нейтральный тон остаётся только за valence: none.
    const v = ee({ value: 20 });
    expect(v.levelLabel).toBe("Умеренный");
    expect(v.tone).toBe("attention");
  });

  it("при valence none тон нейтральный на любом интервале", () => {
    const v = ee({
      interpretation: { domainMin: 0, domainMax: 45, valence: "none", bands: EE_BANDS },
    });
    expect(v.tone).toBe("neutral");
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

export interface CtxMeasureMark {
  percent: number;
  label: string;
}

export type BannerVariant = "success" | "info" | "warning" | "error";

export interface CtxMeasureView {
  key: string;
  name: string;
  renderKind: RenderKind;
  showValue: boolean;
  valueText: string;
  maxText: string;
  valueLabel: string;
  levelLabel: string;
  tone: LevelTone;
  toneClass: string;
  bannerVariant: BannerVariant;
  text?: string;
  zones: CtxMeasureZone[];
  marks: CtxMeasureMark[];
  markerPercent?: number;
  percent?: number;
  ringDashoffset?: number;
}

/**
 * Tone to DS presentation. The tag gets a template class, the indicator banner a
 * DS modifier — the layout binds a prepared string and never maps anything itself.
 */
const BANNER_BY_TONE: Record<LevelTone, BannerVariant> = {
  favorable: "success",
  neutral: "info",
  attention: "warning",
  critical: "error",
};

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

/**
 * Fallback chain per requested kind, most-preferred first. A single "descending
 * richness" list cannot express this, because degradation is not one-dimensional.
 *
 * A ring reports a PERCENT, and for a scale with `normalization: none` a percent is
 * undefined — that is the premise of this whole feature. So a ring is legitimate only
 * as the author's explicit choice and must never be an automatic substitute for a
 * bar; otherwise the tool invents a number the methodology never produced.
 *
 * A gradient bar carries the opposite risk: without bands there is no level, no tone
 * and no explanatory text, so a colour continuum would imply an evaluation the author
 * never made. It degrades to the plain «27 из 45», which claims nothing.
 *
 * Between the two linear readouts the move is sideways, not down: a bar asked for with
 * bands present becomes the banded ruler, and a ruler asked for without bands becomes
 * the plain value.
 */
const FALLBACK_CHAINS: Record<RenderKind, RenderKind[]> = {
  gradient_bar: ["gradient_bar", "band_ruler", "value_of_max", "value", "label"],
  band_ruler: ["band_ruler", "value_of_max", "value", "label"],
  ring: ["ring", "value_of_max", "value", "label"],
  value_of_max: ["value_of_max", "value", "label"],
  value: ["value", "label"],
  label: ["label"],
};

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
  for (const kind of FALLBACK_CHAINS[requested] ?? ["label"]) {
    if (isFeasible(kind, caps)) return kind;
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

/**
 * Tone of the current level: the author's override, else the ramp position.
 *
 * The thresholds mirror the RAMP, not an independent ladder: the tag sits next to a
 * zone painted from the same position, so a midpoint that reads yellow on the ruler
 * must not read blue on the tag. `neutral` is therefore reserved for `valence: none`
 * — the one case that genuinely carries no evaluation.
 */
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
  if (t >= 0.375) return "attention";
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
    valueText: "",
    maxText: "",
    valueLabel: "",
    levelLabel: "",
    tone: "neutral",
    toneClass: "tb-tone--neutral",
    bannerVariant: "info",
    zones: [],
    marks: [],
  };

  if (!isNumeric) {
    const outcomes = outcomesOf(interpretation);
    const outcome = findOutcome(outcomes, input.value as string | boolean);
    if (!outcome) return base;
    const tone = outcome.tone ?? "neutral";
    return {
      ...base,
      levelLabel: outcome.label,
      tone,
      toneClass: `tb-tone--${tone}`,
      bannerVariant: BANNER_BY_TONE[tone],
      ...(outcome.text ? { text: outcome.text } : {}),
    };
  }

  const value = input.value as number;
  const domainMin = interpretation.domainMin ?? 0;
  const domainMax = interpretation.domainMax ?? 0;
  const band = findBand(interpretation.bands, value);
  const bandIndex = band ? interpretation.bands.indexOf(band) : -1;

  const tone = toneOf(input, band?.tone, bandIndex, interpretation.bands.length);
  const view: CtxMeasureView = {
    ...base,
    valueText: String(round1(value)),
    maxText: hasDomain ? String(round1(domainMax)) : "",
    valueLabel: hasDomain ? `${round1(value)} из ${round1(domainMax)}` : String(round1(value)),
    levelLabel: band ? band.label ?? band.level : "",
    tone,
    toneClass: `tb-tone--${tone}`,
    bannerVariant: BANNER_BY_TONE[tone],
    ...(band?.text ? { text: band.text } : {}),
  };

  if (!hasDomain) return view;

  const span = domainMax - domainMin;
  const ratio = span > 0 ? (value - domainMin) / span : 0;
  const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;

  if (renderKind === "band_ruler") {
    view.zones = buildZones(input, domainMin, domainMax, band?.level ?? "");
    view.markerPercent = round1(clamped * 100);
    // Boundaries are NUMBERS under the rail; the level NAME lives in the tag beside
    // it. Printing zone names under the rail crowds three labels into a 6px track and
    // breaks entirely on a narrow screen — the tag says it once, unambiguously.
    view.marks = [
      { percent: 0, label: String(round1(domainMin)) },
      ...interpretation.bands
        .slice(1)
        .map((b) => ({ percent: round1(((b.min - domainMin) / span) * 100), label: String(round1(b.min)) })),
      { percent: 100, label: String(round1(domainMax)) },
    ];
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
Expected: PASS, 23 теста (22 исходных плюс проверка на автоподстановку кольца).

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

  it("приводит вложения к ссылке и отбрасывает незагруженные", () => {
    // Редактор хранит канонический дескриптор PDF, где адрес лежит в scormHref.
    const withAssets = {
      ...MEASURES,
      indicators: [
        {
          ...MEASURES.indicators[0],
          interpretation: {
            ...MEASURES.indicators[0].interpretation,
            outcomes: [
              {
                code: "growing",
                label: "Возрастающее истощение",
                feedback: {
                  assets: [
                    { title: "Памятка.pdf", fileName: "p.pdf", mimeType: "application/pdf", scormHref: "/a/p.pdf" },
                    { title: "Не загружено.pdf", fileName: "q.pdf", mimeType: "application/pdf" },
                  ],
                },
              },
            ],
          },
        },
      ],
      scales: [],
      testFeedback: null,
    };
    const ctx = buildResultContext(BASE, "Маслач", { measures: withAssets });
    expect(ctx.result.recommendations!.assets).toEqual([{ title: "Памятка.pdf", url: "/a/p.pdf" }]);
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
  /**
   * The score summary always HAS data, so it needs its own flag — and the flag is
   * NEGATIVE. A control test passes no measures at all, so a positive flag would be
   * absent and the layout would hide the summary in every package and preview.
   * Absent = shown; only the suppression is recorded.
   */
  hideScoreSummary?: boolean;
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

/**
 * Feedback of the level that actually fired, NORMALISED for the recommendations
 * block.
 *
 * The author's editor stores the canonical `feedbackContentSchema` shape, where an
 * asset is a PDF descriptor — `{ title, fileName, mimeType, scormHref? }` — and the
 * address lives in `scormHref`, not `url`. `collectRecommendations` works on
 * `RecommendationLink { title, url? }`, so the host adapts before handing over;
 * without this the «Материалы» block renders links with an empty href.
 *
 * An asset with no persisted href is DROPPED rather than rendered dead: the file was
 * never uploaded, so there is nothing to open.
 */
function normalizeFeedback(raw: unknown): FeedbackBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const links = (f.links as Array<{ title?: string; url?: string }> | undefined) ?? [];
  const events = (f.events as Array<{ title?: string; url?: string }> | undefined) ?? [];
  const assets = (f.assets as Array<{ title?: string; scormHref?: string }> | undefined) ?? [];
  return {
    ...(f.text ? { text: String(f.text) } : {}),
    links: links.map((l) => ({ title: String(l.title ?? ""), ...(l.url ? { url: l.url } : {}) })),
    events: events.map((e) => ({ title: String(e.title ?? ""), ...(e.url ? { url: e.url } : {}) })),
    assets: assets
      .filter((a) => !!a.scormHref)
      .map((a) => ({ title: String(a.title ?? ""), url: a.scormHref as string })),
  };
}

/** Feedback of the level that actually fired, for the recommendations block. */
function firedFeedback(m: MeasureInput): FeedbackBlock | null {
  const { interpretation } = m;
  if (typeof m.value === "number") {
    const band = interpretation.bands.find((b) => (m.value as number) >= b.min && (m.value as number) <= b.max);
    return normalizeFeedback(band?.feedback);
  }
  const outcomes = (interpretation as IndicatorInterpretation).outcomes ?? [];
  const outcome = outcomes.find((o) => o.code === String(m.value));
  return normalizeFeedback(outcome?.feedback);
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
    // INVERTED on purpose — see the contract note on `hideScoreSummary`.
    if (!blocks.scoreSummary) result.hideScoreSummary = true;

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
Expected: PASS, 6 тестов. Тест «не добавляет новых полей, когда измерений нет» проверяет, что
`opts.measures` отсутствует целиком — тогда не появляется и `hideScoreSummary`, а его
отсутствие означает «показывать», так что контрольный экран остаётся прежним.

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

## Task 8b: Проброс измерений на веб-хосте

**Files:**

- Modify: `server/services/template-render.ts`
- Modify: `server/routes/attempts.ts`
- Modify: `server/services/result-context.ts` (`testFeedback` — полный блок, а не только текст)
- Test: `tests/results-render-measures.test.ts`

Task 8 собрала `buildMeasuresInput`, но передать её результат оказалось некуда: цепочка на
вебе идёт `routes/attempts.ts` → `template-render.readResultsRenderPayload` →
`result-context.buildResultContext`, и `buildResultContext` зовётся ДВУМЯ аргументами. Ни
одно звено не несёт ни строк шкал и показателей, ни эффективных параметров дизайна, ни
настроек варианта «Итоги». Пока этого нет, экран итогов на живом вебе не меняется ни на
байт, сколько бы ядро ни считало.

Задача — дотянуть данные до построителя. Ничего нового не вычисляется: всё уже посчитано
и лежит либо в попытке, либо в базе.

### Откуда что берётся

| Что нужно | Источник |
| --- | --- |
| Значения шкал и показателей | `AttemptResult.scaleResults` и `AttemptResult.resultVariables` — уже сохранены в попытке, пересчитывать нельзя |
| Строки шкал и показателей | `storage.getScales` / `storage.getResultVariables`, а для попытки со снимком — из снимка |
| Эффективные параметры дизайна | считаются ВНУТРИ `readScreenTemplate` при разрешении `design` против манифеста; наружу не отдаются |
| Настройки варианта «Итоги» | `content_pages` с `kind = "results"`, поле `settings_json` |
| Есть ли порог прохождения | настройки теста |
| Обратная связь теста | `tests.feedback_json` |

### Ловушка со снимком (PRD-15)

Попытка, привязанная к снимку (`attempts.snapshot_id`), обязана читать шкалы и показатели
ИЗ СНИМКА, а не из живых строк: иначе правка толкования задним числом изменит результат
уже пройденной попытки. Механизм существует — `loadScoringConfig(testId, source)` принимает
источник, и снимок им уже пользуется. Взять тот же источник, а не ходить в `storage`
напрямую.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/results-render-measures.test.ts
import { describe, it, expect } from "vitest";
import { readResultsRenderPayload } from "../server/services/template-render";

const DIR = "server/scorm/templates/default";

const RESULT = {
  overallPassed: false,
  overallPercent: 0,
  totalQuestions: 22,
  totalCorrect: 0,
  totalEarnedPoints: 0,
  totalPossiblePoints: 0,
  topicResults: [],
  scaleResults: { ee: { raw: 27, normalized: 27, percent: 0, level: "high", label: "Высокий", hasValue: true } },
  resultVariables: {},
} as never;

const MEASURES = {
  scales: [
    {
      key: "ee",
      label: "Эмоциональное истощение",
      learnerVisibility: "level_and_value",
      sortOrder: 0,
      configJson: {
        domainMin: 0,
        domainMax: 45,
        valence: "lower_is_better",
        bands: [
          { min: 0, max: 24, level: "low", label: "Низкий" },
          { min: 25, max: 45, level: "high", label: "Высокий", text: "Ресурс расходуется быстрее." },
        ],
      },
    },
  ],
  variables: [],
  params: {},
  blockSettings: {},
  hasPassThreshold: false,
  testFeedback: null,
} as never;

describe("readResultsRenderPayload + измерения", () => {
  it("без измерений контекст не получает новых полей", () => {
    const payload = readResultsRenderPayload(DIR, RESULT, "Маслач");
    expect(payload).not.toBeNull();
    expect((payload!.context.result as Record<string, unknown>).scales).toBeUndefined();
  });

  it("с измерениями кладёт шкалу в контекст", () => {
    const payload = readResultsRenderPayload(DIR, RESULT, "Маслач", null, undefined, undefined, MEASURES);
    const scales = (payload!.context.result as { scales?: Array<{ levelLabel: string; valueText: string }> }).scales;
    expect(scales).toHaveLength(1);
    expect(scales![0].levelLabel).toBe("Высокий");
    expect(scales![0].valueText).toBe("27");
  });

  it("скрытая шкала в контекст не попадает", () => {
    const hidden = { ...MEASURES, scales: [{ ...MEASURES.scales[0], learnerVisibility: "hidden" }] };
    const payload = readResultsRenderPayload(DIR, RESULT, "Маслач", null, undefined, undefined, hidden as never);
    expect((payload!.context.result as Record<string, unknown>).scales).toBeUndefined();
  });
});
```

Run: `npm test -- tests/results-render-measures.test.ts`
Expected: FAIL — седьмого параметра у `readResultsRenderPayload` нет.

- [ ] **Step 2: Отдать наружу эффективные параметры дизайна**

`readScreenTemplate` разрешает параметры теста против манифеста внутри себя и наружу их не
возвращает, а рампе цветов они нужны. Добавить разрешённые параметры в возвращаемое
значение (поле рядом с уже возвращаемыми разметкой и стилями) — БЕЗ смены сигнатуры и без
второго разрешения параметров: второй расчёт разъедется с первым при первой же правке.

- [ ] **Step 3: Принять измерения в `readResultsRenderPayload`**

Добавить СЕДЬМОЙ необязательный параметр `measures?: MeasuresSource`. Когда он передан,
подмешать в него эффективные параметры из Step 2 и отдать в `buildResultContext` третьим
аргументом. Когда не передан — вызов остаётся двухаргументным, и контрольный экран не
меняется ни на байт.

Адаптивная ветка (`results.adaptive.html`) измерений НЕ получает: у адаптивного результата
своя композиция уровней, и PRD-29 её не трогает.

- [ ] **Step 4: Собрать источник в маршруте**

В `server/routes/attempts.ts` рядом с существующим вызовом (около строки 1194) собрать
`MeasuresSource` и передать седьмым аргументом. Собирать ТОЛЬКО когда у теста есть шкалы
или показатели — иначе передавать `undefined`.

Строки шкал и показателей брать тем же источником, что и `loadScoringConfig`: для попытки
со `snapshot_id` — из снимка, иначе из живых строк. Значения брать из сохранённого
`AttemptResult`, не пересчитывая.

Настройки варианта «Итоги» читать из `content_pages` с `kind = "results"` (`settings_json`);
отсутствие страницы или поля — пустой объект, и тогда все три блока работают в режиме
«автоматически».

- [ ] **Step 5: Провести обратную связь теста целиком**

Сейчас `MeasuresSource.testFeedback` объявлен как `{ text?: string } | null` и уходит в
сборщик БЕЗ нормализации, в отличие от обратной связи интервалов и исходов. Значит ссылки,
мероприятия и материалы уровня ТЕСТА не попадут в блок никогда — а PRD-29 §7.1 называет
тест одним из трёх равноправных источников.

Расширить тип до полного блока (`tests.feedback_json` хранит текст, ссылки, мероприятия и
вложения) и пропустить его через ту же `normalizeFeedback`, что и остальные два источника.
Добавить тест: материал уровня теста доезжает до блока и получает адрес из `scormHref`.

- [ ] **Step 6: Прогнать проверки**

Run: `npm test -- tests/results-render-measures.test.ts`
Expected: PASS.

Run: `npm run check`
Expected: 0 ошибок.

Run: `npm test`
Expected: PASS, порог покрытия держится.

- [ ] **Step 7: Commit**

```bash
git add server/services/template-render.ts server/routes/attempts.ts
git add server/services/result-context.ts tests/results-render-measures.test.ts
git commit -m "feat(prd-29): проброс измерений на веб-хосте"
```

---

## Task 9: Разметка экрана итогов

**Files:**

- Modify: `server/scorm/templates/default/layouts/results.html`

Разметка обязана повторять утверждённый эскиз `docs/wireframes/prd29-measurement-results.html`.
Классы и заголовки берутся ОТТУДА дословно, а не придумываются заново.

Два правила, из которых следует всё остальное:

- ядро отдаёт готовое, разметка ничего не вычисляет;
- контрольный тест обязан остаться прежним, поэтому признак сводки ОТРИЦАТЕЛЬНЫЙ:
  `hideScoreSummary` пишется только при подавлении, а его отсутствие означает «показывать».
  Положительный признак был бы ложью для всех, кто не передаёт измерения, — а это SCORM-рантайм,
  предпросмотр и любой контрольный тест.

- [ ] **Step 1: Свериться с утверждённым эскизом**

Открыть `docs/wireframes/prd29-measurement-results.html`. Отступление означает откат работы.

- [ ] **Step 2: Обернуть существующую сводку в условие**

Блок `<div class="tb-score-strip">…</div>` обернуть в `{{#unless result.hideScoreSummary}}` …
`{{/unless}}`. Внутреннюю разметку не менять НИ НА СИМВОЛ.

- [ ] **Step 3: Добавить блок показателей перед блоком тем**

Ведущий разделитель ставится только тогда, когда выше действительно есть сводка: блоку
показателей может предшествовать лишь она, поэтому признак точен.

```html
      {{#unless result.hideScoreSummary}}<hr class="ou-separator ou-separator--horizontal">{{/unless}}
      {{#if result.indicators}}
      <div class="tb-scene__q"><h3 class="tb-scene__subhead">Ваш результат</h3></div>
      <div class="tb-measures">
        {{#each result.indicators}}
        <div class="ou-formsection tb-measure">
          <div class="ou-formsection__intro">
            <h4 class="ou-formsection__title">{{name}}</h4>
          </div>
          <div class="ou-formsection__body">
            <div class="ou-banner ou-banner--subtle ou-banner--{{bannerVariant}}">
              <div class="ou-banner__body">
                <div class="ou-banner__title">{{levelLabel}}</div>
                {{#if text}}<div class="ou-banner__desc">{{text}}</div>{{/if}}
              </div>
            </div>
          </div>
        </div>
        {{/each}}
      </div>
      {{/if}}
```

- [ ] **Step 4: Добавить блок шкал**

Хвостового разделителя у блока НЕТ: следующий блок несёт свой ведущий, иначе между блоками
встанет двойная линейка.

Слот значения ветвится по виду. Рельс печатает число и максимум порознь, чтобы шапка
`ou-slider__val` выглядела как в дизайн-системе; виды без рельса печатают готовую строку
`valueLabel` — она заведена контрактом ровно для них, и при отсутствии домена «27 из »
не получится. Кольцо использует подготовленные ядром `percent` и `ringDashoffset`.

```html
      {{#if result.scales}}
      <hr class="ou-separator ou-separator--horizontal">
      <div class="tb-scene__q"><h3 class="tb-scene__subhead">По шкалам</h3></div>
      <div class="tb-measures">
        {{#each result.scales}}
        <div class="ou-formsection tb-measure" data-render="{{renderKind}}">
          <div class="ou-formsection__intro">
            <h4 class="ou-formsection__title">{{name}}</h4>
            <span class="ou-tag ou-tag--l tb-measure__level {{toneClass}}">{{levelLabel}}</span>
          </div>
          <div class="ou-formsection__body">
            {{#if zones}}
            <div class="ou-slider ou-slider--h tb-measure__slider">
              <div class="ou-slider__header">
                {{#if showValue}}<span class="ou-slider__val"><strong>{{valueText}}</strong> из {{maxText}}</span>{{/if}}
              </div>
              <div class="ou-slider__rail" role="img" aria-label="{{ariaLabel}}">
                {{#each zones}}
                <span class="ou-slider__fill tb-zone{{#if current}} is-current{{/if}}"
                      style="left:{{leftPercent}}%;width:{{widthPercent}}%;--tb-zone:{{color}}"></span>
                {{/each}}
                <span class="ou-slider__thumb tb-measure__marker" style="left:{{markerPercent}}%"></span>
                <div class="ou-slider__marks">
                  {{#each marks}}
                  <span class="ou-slider__mark" style="left:{{percent}}%"></span>
                  <span class="ou-slider__mark-lbl" style="left:{{percent}}%">{{label}}</span>
                  {{/each}}
                </div>
              </div>
            </div>
            {{/if}}
            {{#if ringDashoffset}}
            <div class="ou-ring tb-ring" role="img" aria-label="{{ariaLabel}}">
              <svg class="ou-ring__svg" width="140" height="140" viewBox="0 0 140 140">
                <circle class="ou-ring__track" cx="70" cy="70" r="63" stroke-width="12"></circle>
                <circle class="ou-ring__fill" cx="70" cy="70" r="63" stroke-width="12" stroke-linecap="round"
                        stroke-dasharray="395.84" stroke-dashoffset="{{ringDashoffset}}"></circle>
              </svg>
              <div class="ou-ring__center">
                <div class="ou-ring__value"><span>{{percent}}</span>%</div>
                <div class="ou-ring__label">{{levelLabel}}</div>
              </div>
            </div>
            {{/if}}
            {{#unless zones}}{{#unless ringDashoffset}}
            {{#if showValue}}<span class="ou-slider__val"><strong>{{valueLabel}}</strong></span>{{/if}}
            {{/unless}}{{/unless}}
            {{#if text}}<p class="ou-formsection__sub">{{text}}</p>{{/if}}
          </div>
        </div>
        {{/each}}
      </div>
      {{/if}}
```

- [ ] **Step 5: Добавить блок рекомендаций после блока тем**

Классы взяты из эскиза: `tb-recs-block` — обёртка, `tb-recs-group` — группа по типу ресурса,
`tb-recs-group__text` — абзац текста, `tb-eyebrow` — надзаголовок группы, `tb-recs` — ряд
чипов (он даёт перенос и зазор, без него чипы слипнутся).

Пиктограммы в чипах взяты дословно из блока обратной связи темы этого же файла: ссылка у
курса и материала, календарь у мероприятия. Эскиз старше этой правки и показывает чипы
голыми — здесь верен файл, иначе на одном экране окажутся чипы с иконками и без.

```html
      {{#if result.recommendations.hasAny}}
      <hr class="ou-separator ou-separator--horizontal">
      <div class="tb-scene__q"><h3 class="tb-scene__subhead">Рекомендации</h3></div>
      <div class="tb-recs-block">
        {{#if result.recommendations.texts}}
        <div class="tb-recs-group">
          {{#each result.recommendations.texts}}<p class="tb-recs-group__text">{{this}}</p>{{/each}}
        </div>
        {{/if}}
        {{#if result.recommendations.links}}
        <div class="tb-recs-group">
          <span class="tb-eyebrow">Пройти обучение</span>
          <div class="tb-recs">
            {{#each result.recommendations.links}}<a class="tb-rec" href="{{url}}" target="_blank" rel="noopener noreferrer">{{ICO_LINK}}{{title}}</a>{{/each}}
          </div>
        </div>
        {{/if}}
        {{#if result.recommendations.events}}
        <div class="tb-recs-group">
          <span class="tb-eyebrow">Мероприятия</span>
          <div class="tb-recs">
            {{#each result.recommendations.events}}<span class="tb-rec">{{ICO_CAL}}{{title}}</span>{{/each}}
          </div>
        </div>
        {{/if}}
        {{#if result.recommendations.assets}}
        <div class="tb-recs-group">
          <span class="tb-eyebrow">Материалы</span>
          <div class="tb-recs">
            {{#each result.recommendations.assets}}<a class="tb-rec" href="{{url}}" target="_blank" rel="noopener noreferrer">{{ICO_LINK}}{{title}}</a>{{/each}}
          </div>
        </div>
        {{/if}}
      </div>
      {{/if}}
```

`{{ICO_LINK}}` и `{{ICO_CAL}}` — НЕ конструкции движка, а указание подставить сюда дословно
разметку `<span class="tb-rec__ico">…</span>` из блока обратной связи темы того же файла:
первую (со скрепкой-ссылкой) для курсов и материалов, вторую (с календарём) для мероприятий.

- [ ] **Step 6: Проверить поддержку конструкций движком**

Run: `npm test -- shared/template/dsl.test.ts`
Expected: PASS. Перебор массива строк с `{{this}}` уже поддержан и покрыт тестом, правка
движка не нужна. Пустой массив в `{{#if}}` ложен, поэтому «нет данных — нет блока» держится.

- [ ] **Step 7: Проверить, что контрольный экран не изменился**

Run: `npm test -- tests/results-template-gating.test.ts tests/template-layout-parity.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/scorm/templates/default/layouts/results.html
git commit -m "feat(prd-29): блоки показателей, шкал и рекомендаций в макете итогов"
```

---

## Task 10: Стили строки измерения

**Files:**

- Modify: `server/scorm/templates/default/styles/theme.css`

- [ ] **Step 1: Объявить токены тона рядом с существующими pass/fail**

Найти строку `/* passClass (is-pass/is-fail) drives the DS ring fill + verdict tag colour. */`
и добавить перед ней:

```css
/* PRD-29: interpretation tones. Named in methodology terms; the DS semantic families
   already carry the three roles a zone needs — solid, soft fill, text on fill. */
.tb-scene .ou-tag.tb-tone--favorable { background: var(--ou-success-soft); color: var(--ou-success-on-soft); }
.tb-scene .ou-tag.tb-tone--neutral   { background: var(--ou-info-soft);    color: var(--ou-info-on-soft); }
.tb-scene .ou-tag.tb-tone--attention { background: var(--ou-warning-soft); color: var(--ou-warning-on-soft); }
.tb-scene .ou-tag.tb-tone--critical  { background: var(--ou-error-soft);   color: var(--ou-error-on-soft); }
```

- [ ] **Step 2: Добавить стили строки шкалы**

Собственных правил остаётся минимум: раскладка строки и три поправки к `ou-slider`,
который спроектирован как интерактивный элемент управления, а здесь только показывает.

```css
/* PRD-29: measure row. `ou-formsection` supplies the two-column grid and the hairline
   between rows; the delta is what the DS cannot know — the zone colour, the read-only
   state of a control-shaped element, and the vertical budget of THIS screen.

   The section's own 32px rhythm is for a settings form that scrolls freely. Here four
   sections spend 256px of a 650px body on padding alone, which pushes the third scale
   below the fold — and a measurement result exists to be read as a whole. */
.tb-measure.ou-formsection { padding: 16px 0; }
.tb-measure__level { align-self: flex-start; }

/* Hierarchy by WEIGHT, not size: a block heading and an entity name sit at the same
   16px, so raising the heading would mean raising `tb-scene__subhead` everywhere —
   including «Результаты по темам» on the control screen, which §11 freezes. */
.tb-measure .ou-formsection__title { font-weight: 400; }

/* The DS slider is a 360px-wide control; here it is a full-width readout inside the
   content column, so the cap is relaxed and the grab affordances are removed. With
   the name moved to the label column the header holds the value alone — keep it right. */
.tb-measure__slider { max-width: none; display: flex; }
.tb-measure__slider .ou-slider__header { justify-content: flex-end; }
.tb-measure__slider .ou-slider__rail { margin-bottom: 18px; }
.tb-measure__marker { cursor: default; pointer-events: none; }

/* The value is the reading the learner came for, so it carries display weight while
   the domain stays quiet. At the slider's own body-s it read as a footnote next to a
   20px scale name. */
.tb-measure__slider .ou-slider__val { font: var(--ou-text-body-m); }
.tb-measure__slider .ou-slider__val strong { font: var(--ou-text-display-s); }

/* Narrow scene: the two-column section collapses to a single stack. The query
   measures the SCENE (`@container tbscene`), not the viewport — the whole mobile
   adaptation of this template is built on container steps 900 / 700 / 520, and a
   viewport `@media` here would fire out of step with everything around it. 700 is
   the step where the rest of the scene already goes single-column. */
@container tbscene (max-width: 700px) {
  .tb-measure.ou-formsection { display: flex; flex-direction: column; gap: 16px; }
}

/* Zones paint the rail DISCRETELY: the finding of a banded method is categorical, and
   a gradient would hide the step across a boundary. `ou-slider__fill` already gives the
   absolute positioning and the pill radius; only the colour is ours. Square inner
   corners keep adjacent zones from showing a gap. */
.tb-zone { background: hsl(var(--tb-zone)); border-radius: 0; }
.tb-zone:first-of-type { border-start-start-radius: 999px; border-end-start-radius: 999px; }
.tb-zone:last-of-type { border-start-end-radius: 999px; border-end-end-radius: 999px; }




/* PRD-29: the single recommendations block, structured by resource type. Class names
   come from the approved wireframe; the chip row (`tb-recs`) and the chip itself
   (`tb-rec`) already exist in this file and are reused as they are. */
.tb-recs-block { display: flex; flex-direction: column; gap: var(--ou-space-4); }
.tb-recs-group { display: flex; flex-direction: column; gap: var(--ou-space-2); align-items: flex-start; }
.tb-recs-group__text { margin: 0; font: var(--ou-text-body-m); color: var(--ou-fg-soft); }
```

Проверить в браузере, что засечки `ou-slider__mark-lbl` не наезжают друг на друга при
близких границах (у «Отстранённости» это 4 и 9 на домене 0..25). Если наезжают — прятать
подписи промежуточных границ ниже 480 px, оставляя края домена. Название уровня при этом
не теряется: оно стоит словом в `ou-tag`.

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
git commit -m "feat(prd-29): стили строки измерения поверх ou-slider"
```

---

## Task 11: Параметры варианта дизайна

**Files:**

- Modify: `server/scorm/templates/default/manifest.json`
- Modify: `client/src/features/tests/editor/sections/start-pages-section.tsx` (подписи у настроек)
- Test: `server/__tests__/template-manifest-prd29.test.ts`
- Test: `client/src/features/tests/editor/sections/__tests__/setting-option-labels.test.tsx`

Формат объявления в манифесте фиксирован существующим кодом, отступать от него нельзя:
`select` несёт `options` МАССИВОМ СТРОК, а человекочитаемые подписи лежат отдельно в
`optionLabels` — словаре «значение в подпись». Так уже объявлен параметр `progressMode`
в этом же манифесте, и так его читает `design-section.tsx`.

Есть асимметрия, которую надо закрыть: у параметров дизайна `optionLabels` поддержан, а у
настроек страницы (`contentTemplates[].settings[]`) — нет, `start-pages-section.tsx`
подставляет в подпись само значение. Оставить как есть нельзя: автор увидел бы в списке
английские коды `auto`, `show`, `hide`. Переводить сами значения на русский тоже нельзя —
их сравнивает код. Поэтому пробел закрывается в общем механизме, а не обходится локально.

- [ ] **Step 1: Написать падающий тест на манифест**

```ts
// server/__tests__/template-manifest-prd29.test.ts
import { describe, it, expect } from "vitest";
import manifest from "../scorm/templates/default/manifest.json";

const params = manifest.params as Array<Record<string, unknown>>;
const byKey = (key: string) => params.find((p) => p.key === key);

describe("manifest params (PRD-29)", () => {
  it("объявляет схему уровней списком строк с подписями", () => {
    const p = byKey("levelScheme");
    expect(p?.type).toBe("select");
    expect(p?.options).toEqual(["traffic", "neutral", "custom"]);
    expect(Object.keys(p?.optionLabels as Record<string, string>)).toEqual([
      "traffic",
      "neutral",
      "custom",
    ]);
  });

  it("объявляет три цвета рампы с пустым значением по умолчанию", () => {
    for (const key of ["levelColorFavorable", "levelColorMid", "levelColorUnfavorable"]) {
      const p = byKey(key);
      expect(p?.type).toBe("color");
      expect(p?.default).toBeNull();
      expect(typeof p?.cssVar).toBe("string");
    }
  });

  it("объявляет виды рендера для шкал и показателей", () => {
    for (const key of ["scaleRenderKind", "indicatorRenderKind"]) {
      const p = byKey(key);
      expect(p?.type).toBe("select");
      expect(p?.options).toEqual([
        "label",
        "value",
        "value_of_max",
        "ring",
        "band_ruler",
        "gradient_bar",
      ]);
      expect(p?.optionLabels).toBeTruthy();
    }
  });
});

describe("manifest contentTemplates (PRD-29)", () => {
  it("вид итогов получает три настройки блоков с русскими подписями", () => {
    const results = (manifest.contentTemplates as Array<Record<string, unknown>>)
      .find((c) => c.kind === "results");
    const settings = results?.settings as Array<Record<string, unknown>>;
    expect(settings.map((s) => s.key)).toEqual(["scoreSummary", "indicators", "scales"]);
    settings.forEach((s) => {
      expect(s.type).toBe("select");
      expect(s.default).toBe("auto");
      expect(s.options).toEqual(["auto", "show", "hide"]);
      expect(s.optionLabels).toEqual({
        auto: "Автоматически",
        show: "Показывать",
        hide: "Скрывать",
      });
    });
  });
});
```

Run: `npm test -- server/__tests__/template-manifest-prd29.test.ts`
Expected: FAIL, параметры не найдены.

- [ ] **Step 2: Добавить параметры в манифест**

В массив `params` дописать (группа «Цвета» существует, группа «Итоги» новая):

```json
{ "key": "levelScheme", "type": "select", "label": "Цветовая схема уровней",
  "default": "traffic", "group": "Цвета", "section": "branding",
  "options": ["traffic", "neutral", "custom"],
  "optionLabels": {
    "traffic": "Зелёный — жёлтый — красный",
    "neutral": "Нейтральная, оттенки одного цвета",
    "custom": "Своя"
  },
  "description": "Как окрашиваются уровни шкал и показателей. «Своя» задействует три поля цвета ниже." },
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
  "options": ["label", "value", "value_of_max", "ring", "band_ruler", "gradient_bar"],
  "optionLabels": {
    "label": "Только уровень",
    "value": "Значение",
    "value_of_max": "Значение из максимума",
    "ring": "Кольцо",
    "band_ruler": "Линейка с зонами",
    "gradient_bar": "Полоса-градусник"
  },
  "description": "Применяется там, где выполним; иначе откатывается на ближайший доступный." },
{ "key": "indicatorRenderKind", "type": "select", "label": "Вид показателей",
  "default": "label", "group": "Итоги", "section": "branding",
  "options": ["label", "value", "value_of_max", "ring", "band_ruler", "gradient_bar"],
  "optionLabels": {
    "label": "Только уровень",
    "value": "Значение",
    "value_of_max": "Значение из максимума",
    "ring": "Кольцо",
    "band_ruler": "Линейка с зонами",
    "gradient_bar": "Полоса-градусник"
  },
  "description": "Применяется там, где выполним; иначе откатывается на ближайший доступный." }
```

- [ ] **Step 3: Добавить настройки виду итогов**

В `contentTemplates` у записи с `"kind": "results"` заменить `"settings": []` на:

```json
"settings": [
  { "key": "scoreSummary", "type": "select", "label": "Сводка баллов", "default": "auto",
    "options": ["auto", "show", "hide"],
    "optionLabels": { "auto": "Автоматически", "show": "Показывать", "hide": "Скрывать" } },
  { "key": "indicators", "type": "select", "label": "Показатели", "default": "auto",
    "options": ["auto", "show", "hide"],
    "optionLabels": { "auto": "Автоматически", "show": "Показывать", "hide": "Скрывать" } },
  { "key": "scales", "type": "select", "label": "Шкалы", "default": "auto",
    "options": ["auto", "show", "hide"],
    "optionLabels": { "auto": "Автоматически", "show": "Показывать", "hide": "Скрывать" } }
]
```

Поднять `"version"` манифеста с `1.3.0` до `1.4.0`.

- [ ] **Step 4: Написать падающий тест на подписи настроек**

Контрол настройки — это КОМПОНЕНТ `SettingControl` в `start-pages-section.tsx` (около
строки 1972), принимающий ОДИН объект пропсов. Кроме `setting` / `value` / `onChange` он
требует `sequenceIds`, `sequenceTotal` и `testId` — они нужны ветке `sequence` того же
диспетчера. Тест передаёт их заглушками: ветка `select` их не читает.

Компонент не экспортирован — экспортировать его под СВОИМ именем. Ни переименовывать, ни
переводить на позиционные аргументы не нужно: подгонять боевой код под форму теста —
это ставить телегу впереди лошади.

```tsx
// client/src/features/tests/editor/sections/__tests__/setting-option-labels.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingControl } from "../start-pages-section";

const STUBS = { sequenceIds: [], sequenceTotal: 0, testId: "setting" };

describe("настройка страницы типа select", () => {
  it("показывает человекочитаемую подпись из optionLabels", () => {
    render(
      <SettingControl
        {...STUBS}
        setting={{
          key: "scales",
          type: "select",
          label: "Шкалы",
          options: ["auto", "show", "hide"],
          optionLabels: { auto: "Автоматически", show: "Показывать", hide: "Скрывать" },
        }}
        value="auto"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Автоматически")).toBeInTheDocument();
    expect(screen.queryByText("auto")).toBeNull();
  });

  it("падает обратно на значение, когда подписи не объявлены", () => {
    render(
      <SettingControl
        {...STUBS}
        setting={{ key: "mode", type: "select", label: "Режим", options: ["fast", "slow"] }}
        value="fast"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("fast")).toBeInTheDocument();
  });
});
```

Run: `npm test -- client/src/features/tests/editor/sections/__tests__/setting-option-labels.test.tsx`
Expected: FAIL — `SettingControl` не экспортирован.

- [ ] **Step 5: Поддержать подписи у настроек страницы**

Три точечные правки, сигнатуры не меняются:

1. В `client/src/features/tests/editor/use-content-pages.ts` в тип `ContentTemplateSetting`
   добавить `optionLabels?: Record<string, string>;` рядом с `options` — сейчас поля нет,
   и подписи просто некуда положить.

2. В `client/src/features/tests/editor/sections/start-pages-section.tsx` в ветке
   `case "select"` заменить построение списка на
   `options={(st.options ?? []).map((o) => ({ value: o, label: st.optionLabels?.[o] ?? o }))}`.
3. Там же экспортировать `SettingControl` (`export function SettingControl`).

Без этого автор увидит в списке `auto`, `show`, `hide` — английские коды в интерфейсе.
Переводить сами ЗНАЧЕНИЯ нельзя: их сравнивает `resolveResultsBlocks`.

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `npm test -- server/__tests__/template-manifest-prd29.test.ts`
Expected: PASS, 4 теста.

Run: `npm test -- client/src/features/tests/editor/sections/__tests__/setting-option-labels.test.tsx`
Expected: PASS, 2 теста.

- [ ] **Step 7: Проверить валидатор манифеста и типы**

Run: `npm run check`
Expected: 0 ошибок.

Run: `npm test -- shared/template/__tests__ server/__tests__`
Expected: PASS. Валидатор (`shared/template/field-types.ts`) требует у `select` непустой
`options` и не запрещает `optionLabels`, поэтому новых правил вводить не нужно; если
проверка манифеста всё же покраснела — остановиться и доложить, а не ослаблять валидатор.

- [ ] **Step 8: Commit**

```bash
git add server/scorm/templates/default/manifest.json server/__tests__/template-manifest-prd29.test.ts
git add client/src/features/tests/editor/sections/start-pages-section.tsx
git add client/src/features/tests/editor/sections/__tests__/setting-option-labels.test.tsx
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

  it("по умолчанию поля домена скрыты — он выводится из интервалов", () => {
    render(<ScalesSection model={modelWithScale()} updateModel={() => {}} />);
    expect(screen.getByTestId("scales-domain-manual-0")).toBeInTheDocument();
    expect(screen.queryByTestId("scales-domain-min-0")).toBeNull();
  });

  it("показывает поля домена, когда границы заданы вручную", () => {
    const model = modelWithScale();
    model.scales[0].domainMin = 0;
    model.scales[0].domainMax = 45;
    render(<ScalesSection model={model} updateModel={() => {}} />);
    expect(screen.getByTestId("scales-domain-min-0")).toBeInTheDocument();
    expect(screen.getByTestId("scales-domain-max-0")).toBeInTheDocument();
  });

  it("ноль остаётся законным значением границы, а не признаком «не задано»", () => {
    const model = modelWithScale();
    model.scales[0].domainMin = 0;
    model.scales[0].domainMax = 45;
    render(<ScalesSection model={model} updateModel={() => {}} />);
    expect(screen.getByTestId("scales-domain-min-0")).toHaveValue(0);
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

Числовые поля — `NumberInput` из ui-kit (со степпером), а не `Input type="number"`: весь
редактор уже собран на нём.

Ловушка с «пусто»: `NumberInput.value` обязательно число, и в проекте отсутствующее
значение выражают нулём-сигналом плюс подсказкой («Оставьте 0 для неограниченного числа
попыток»). ЗДЕСЬ так нельзя — ноль законное значение домена, все три домена референсной
методики начинаются с нуля. Поэтому «не задан» выражается явным переключателем, а не
значением поля: выключен — домен выводится из охвата интервалов, ровно как это делает
`parseScaleInterpretation`; включён — появляются два поля, засеянные текущим доменом.

```tsx
          <div className="ou-formfield">
            <Switch
              label="Задать границы шкалы вручную"
              checked={s.domainMin !== null && s.domainMax !== null}
              disabled={readOnly}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? { domainMin: effectiveDomain(s).min, domainMax: effectiveDomain(s).max }
                    : { domainMin: null, domainMax: null },
                )
              }
              data-testid={`scales-domain-manual-${index}`}
            />
          </div>
          {s.domainMin !== null && s.domainMax !== null && (
            <div className="ou-formgroup ou-formgroup--two">
              <div className="ou-formfield">
                <NumberInput
                  size="m" label="Минимум шкалы"
                  value={s.domainMin} disabled={readOnly}
                  onChange={(next) => onChange({ domainMin: next })}
                  data-testid={`scales-domain-min-${index}`}
                />
              </div>
              <div className="ou-formfield">
                <NumberInput
                  size="m" label="Максимум шкалы"
                  value={s.domainMax} disabled={readOnly}
                  onChange={(next) => onChange({ domainMax: next })}
                  data-testid={`scales-domain-max-${index}`}
                />
              </div>
            </div>
          )}
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

Под полями домена — кнопка, вызывающая `achievableRange` (Task 3) по вкладам этой шкалы.
Функции нужны типы вопросов: без них множественный выбор посчитается как одноиндексный
и максимум выйдет заниженным. Типы берутся из той же модели редактора, что и вклады.

```tsx
          <Button
            size="s" variant="secondary" disabled={readOnly}
            onClick={() => {
              const domain = achievableRange(
                measurementsOf(model, s),
                s.aggregation,
                questionTypesOf(model),
              );
              if (domain) onChange({ domainMin: domain.min, domainMax: domain.max });
            }}
            data-testid={`scales-domain-suggest-${index}`}
          >
            Рассчитать по вкладам
          </Button>
```

Если сохранённый домен расходится с расчётным, под кнопкой показать `ou-banner` с
предупреждением. Тихого пересчёта не делать.

- [ ] **Step 6: Перевести колонку книги Excel на три значения**

Пока видимость была булевой, колонка «Показывать ученику» в книге была парой «да / нет».
С появлением средней позиции пара становится ловушкой: экспорт и последующий импорт
схлопывают `level` в `level_and_value`, то есть раскрывают ученику числовое значение там,
где методолог его закрыл.

В `server/utils/workbook-sheets.ts` колонка принимает три значения — «нет», «уровень»,
«уровень и значение». Импорт старых книг сохраняется: `да` читается как «уровень и
значение», `нет` — как «нет». Добавить тест на круговой обход: шкала с `level` после
экспорта и импорта обязана остаться `level`.

- [ ] **Step 7: Провести поля через модель и API**

В `test-editor.types.ts` добавить в `ScaleModel` поля `domainMin: number | null`,
`domainMax: number | null`, `valence: Valence`, `learnerVisibility: LearnerVisibility`;
в `scales-api.ts` — упаковку `domainMin`/`domainMax`/`valence` в `configJson` при отправке
и распаковку при чтении.

- [ ] **Step 8: Убедиться, что тесты проходят**

Run: `npm test -- client/src/features/tests/editor tests/workbook-sheets.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/src/features/tests/editor
git commit -m "feat(prd-29): домен, направление и видимость в редакторе шкал"
```

---

## Task 14: Толкования в редакторе — интервалы и перечень исходов

**Files:**

- Modify: `client/src/features/tests/editor/test-editor.types.ts` (`ScaleBandModel`)
- Modify: `client/src/features/tests/editor/sections/scales-section.tsx` (существующий `BandsEditor`)
- Create: `client/src/features/tests/editor/sections/outcomes-editor.tsx`
- Modify: `client/src/features/tests/editor/sections/result-variables-section.tsx`
- Test: `client/src/features/tests/editor/sections/__tests__/interpretation-editor.test.tsx`

**Переиспользуем, а не пишем заново.** В проекте уже есть два готовых куска:

- `BandsEditor` в `scales-section.tsx` — таблица `tb-table tb-bands-table` с колонками
  min / max / Метка / Уровень / действия, `Input size="s"`, `IconButton` с иконкой корзины,
  подписи через `aria-label`, фабрика `emptyBand()` и стабильный `clientKey`. Новый редактор
  интервалов заводить НЕЛЬЗЯ — расширяем этот.
- `FeedbackEditorModal` в `feedback-editor-modal.tsx` — редактор обратной связи (текст,
  курсы, мероприятия, вложения) с флагами `hideAssets` / `hideEvents`. Рекомендации на
  интервале и на исходе открываются ИМ, а не новым инлайновым блоком.

Новый компонент в этой задаче ровно один — редактор перечня исходов: для показателей в
проекте нет ничего похожего.

**Раскладка длинного текста.** Толкование — абзац, и в ячейку таблицы он не помещается.
Поэтому у каждой строки есть раскрывающаяся строка-продолжение (`<tr>` с `colSpan`), где
живут толкование и кнопка «Рекомендации». Сама таблица остаётся компактной.

- [ ] **Step 1: Расширить модель интервала**

В `client/src/features/tests/editor/test-editor.types.ts`:

```ts
export type ScaleBandModel = {
  clientKey?: string;
  min: string;
  max: string;
  label: string;
  level: string;
  /** PRD-29: what this level MEANS, shown to the learner under the ruler. */
  text: string;
  /**
   * PRD-29: author's override of the tone derived from the ramp position. Empty =
   * derive it. A closed list of METHODOLOGICAL states, never a colour — the template
   * decides how each state looks.
   */
  tone: LevelTone | "";
  /** PRD-29: recommendations that fire when the learner lands in this band. */
  feedback?: FeedbackEditorValue;
};
```

`emptyBand()` дополняется `text: ""` и `tone: ""`.

- [ ] **Step 2: Написать падающий тест**

```tsx
// client/src/features/tests/editor/sections/__tests__/interpretation-editor.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OutcomesEditor } from "../outcomes-editor";

describe("OutcomesEditor", () => {
  const OUTCOMES = [{ clientKey: "o1", code: "engaged", label: "Вовлечённость", text: "", tone: "" as const }];

  it("рисует строку на каждый исход", () => {
    render(<OutcomesEditor outcomes={OUTCOMES} index={0} readOnly={false} onChange={() => {}} />);
    expect(screen.getByLabelText("код исхода 1")).toHaveValue("engaged");
    expect(screen.getByLabelText("метка исхода 1")).toHaveValue("Вовлечённость");
  });

  it("добавляет исход по кнопке", () => {
    const onChange = vi.fn();
    render(<OutcomesEditor outcomes={[]} index={0} readOnly={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Добавить исход/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
  });

  it("удаляет исход", () => {
    const onChange = vi.fn();
    render(<OutcomesEditor outcomes={OUTCOMES} index={0} readOnly={false} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Удалить исход 1"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("в режиме только для чтения не показывает удаление и добавление", () => {
    render(<OutcomesEditor outcomes={OUTCOMES} index={0} readOnly onChange={() => {}} />);
    expect(screen.queryByLabelText("Удалить исход 1")).toBeNull();
    expect(screen.queryByRole("button", { name: /Добавить исход/i })).toBeNull();
  });

  it("подсказывает коды, найденные в формуле, и добавляет их одним нажатием", () => {
    const onChange = vi.fn();
    render(
      <OutcomesEditor
        outcomes={[]}
        index={0}
        readOnly={false}
        onChange={onChange}
        suggestedCodes={["engaged", "burnout"]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "burnout" }));
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ code: "burnout", label: "burnout" });
  });

  it("не показывает блок подсказок, когда неизвестных кодов нет", () => {
    render(<OutcomesEditor outcomes={OUTCOMES} index={0} readOnly={false} onChange={() => {}} />);
    expect(screen.queryByText(/В формуле встречаются коды/i)).toBeNull();
  });
});
```

Run: `npm test -- client/src/features/tests/editor/sections/__tests__/interpretation-editor.test.tsx`
Expected: FAIL, модуль `../outcomes-editor` не найден.

- [ ] **Step 3: Расширить существующий `BandsEditor`**

В `scales-section.tsx`, НЕ создавая нового компонента:

- в `<colgroup>` и `<thead>` добавить колонку «Оценка» перед колонкой действий;
- в строку добавить ячейку с `Select<LevelTone | "">` размера `s`, подписи:
  «По направлению шкалы» (значение `""`), «Благоприятный», «Нейтральный», «Внимание»,
  «Критический»; `aria-label` вида `оценка диапазона ${j + 1}`;
- под каждой строкой добавить строку-продолжение:

```tsx
                <tr key={`${k}-detail`} className="tb-bands-table__detail">
                  <td colSpan={6}>
                    <Textarea
                      size="s"
                      value={b.text}
                      disabled={readOnly}
                      placeholder="Что означает этот уровень — текст для обучающегося"
                      aria-label={`толкование диапазона ${j + 1}`}
                      onChange={(e) => update(j, { text: e.target.value })}
                    />
                    {!readOnly && (
                      <Button size="s" variant="ghost" onClick={() => setFeedbackFor(j)}>
                        {b.feedback ? "Рекомендации заданы" : "Рекомендации"}
                      </Button>
                    )}
                  </td>
                </tr>
```

Кнопка открывает существующий `FeedbackEditorModal` с заголовком вида
«Рекомендации для уровня «Высокий»» и `hideAssets={false}`; сохранение кладёт значение в
`update(j, { feedback: value })`. Состояние открытого окна — локальный `useState<number | null>`.

- [ ] **Step 4: Создать редактор перечня исходов**

Файл `client/src/features/tests/editor/sections/outcomes-editor.tsx`. Устройство ЗЕРКАЛЬНО
`BandsEditor`: та же таблица `tb-table tb-bands-table`, те же `Input size="s"`, тот же
`IconButton` с корзиной, те же `aria-label`, та же строка-продолжение с толкованием и
кнопкой рекомендаций. Колонки: Код, Метка, Оценка, действия.

Дополнительно — блок подсказок под таблицей: коды, найденные в формуле, но отсутствующие в
перечне (приходят пропом `suggestedCodes` из Task 15), каждый кнопкой, добавляющей исход
одним нажатием. Блок не рисуется, когда список пуст.

Модель исхода зеркальна `ScaleBandModel`:

```ts
export type OutcomeModel = {
  clientKey?: string;
  code: string;
  label: string;
  text: string;
  tone: LevelTone | "";
  feedback?: FeedbackEditorValue;
};
```

- [ ] **Step 5: Провести новые поля через круговой обход**

Это самый опасный шаг задачи. Сохранение шкалы переписывает `config_json` ЦЕЛИКОМ:
`toConfigJson` в `scales-api.ts` собирает объект заново из модели редактора. Пока модель
не несла `text` / `tone` / `feedback`, терять было нечего. Как только эта задача их
добавляет, любое сохранение шкалы сотрёт толкования, если обе стороны не доработаны:

- ЗАПИСЬ — `bandsToPayload` в `client/src/features/tests/editor/scales-api.ts`: класть
  `text` и `tone` (пустые значения не писать, чтобы конфиг не пух), а также `feedback`;
- ЧТЕНИЕ — `buildScalesFromApi` в `client/src/features/tests/editor/test-editor.mappers.ts`
  (около строки 673): разбирать те же поля обратно в модель, с защитой от мусора, как это
  сделано для остальных полей шкалы.

Тест на круговой обход обязателен: модель с заполненными `text`, `tone` и `feedback`
после `toConfigJson` и обратного разбора обязана совпасть с исходной. Без него регресс
пройдёт незамеченным — интерфейс покажет пустые поля только после перезагрузки страницы.

- [ ] **Step 6: Встроить редакторы**

В карточке показателя (`result-variables-section.tsx`): `OutcomesEditor` для типов `string`
и `boolean`, расширенный `BandsEditor` для `number`. Для показателя круговой обход через
`config_json` устроить так же, как для шкалы, — запись и чтение симметричными парами.

- [ ] **Step 7: Убедиться, что тесты проходят**

Run: `npm test -- client/src/features/tests/editor`
Expected: PASS. Существующие тесты `BandsEditor` обязаны остаться зелёными: добавление
колонки не должно менять их ожидания. Если покраснели — смотреть на `colSpan` в строке
«Диапазоны не заданы», он тоже вырос.

Run: `npm run check`
Expected: 0 ошибок.

- [ ] **Step 8: Commit**

Коммитить ПОИМЁННО: в `client/src/features/tests/editor/sections/` лежит незакоммиченный
чужой `feedback-preview.tsx`, и `git add` по каталогу утащил бы его в индекс.

```bash
git add client/src/features/tests/editor/test-editor.types.ts
git add client/src/features/tests/editor/test-editor.mappers.ts
git add client/src/features/tests/editor/scales-api.ts
git add client/src/features/tests/editor/sections/scales-section.tsx
git add client/src/features/tests/editor/sections/outcomes-editor.tsx
git add client/src/features/tests/editor/sections/result-variables-section.tsx
git add client/src/features/tests/editor/sections/__tests__/interpretation-editor.test.tsx
git commit -m "feat(prd-29): толкования интервалов и перечень исходов в редакторе"
```

---

## Task 15: Сверка формулы с перечнем исходов

**Files:**

- Create: `shared/formula/outcome-literals.ts`
- Test: `shared/formula/__tests__/outcome-literals.test.ts`
- Modify: `client/src/features/tests/editor/sections/result-variables-section.tsx`

Строковый показатель возвращает КОД исхода. Сегодня никто не проверяет, что коды, которые
формула способна вернуть, вообще объявлены: опечатка в один символ молча даёт пустую
карточку, и только у того ученика, который попал именно в эту ветвь. Обход дерева формулы
превращает это в ошибку редактирования.

Ключевое свойство дерева, на котором всё держится: **ссылки на сущности хранятся полями,
а не строковыми узлами.** У `scaleById("ee").raw` разбор даёт
`{ type: "accessor", fn: "scaleById", arg: "ee", prop: "raw" }` — ключ шкалы лежит в `arg`
обычной строкой. То же у `var` (`name`), у `count` (`keys`, `level`). Поэтому строковым
узлом `{ type: "string" }` оказывается ТОЛЬКО литерал-значение, то есть ровно код исхода.
Никаких списков имён функций-исключений не нужно: отсев структурный.

- [ ] **Step 1: Написать падающий тест**

```ts
// shared/formula/__tests__/outcome-literals.test.ts
import { describe, it, expect } from "vitest";
import { collectStringLiterals, findUnknownOutcomes } from "../outcome-literals";

describe("collectStringLiterals", () => {
  it("собирает строковые константы формулы", () => {
    expect(collectStringLiterals('IF(scaleById("s").raw > 10, "high", "low")').sort())
      .toEqual(["high", "low"]);
  });

  it("не считает литералом ключ шкалы внутри scaleById", () => {
    // Ключ живёт в поле `arg` узла accessor, а не отдельным строковым узлом,
    // поэтому исключается структурно, а не списком имён функций.
    expect(collectStringLiterals('scaleById("emotional_exhaustion").raw > 10')).toEqual([]);
  });

  it("обходит вложенные ветви целиком", () => {
    const f = 'IF(percent >= 0, IF(percent > 50, "a", "b"), IF(percent > 20, "c", "d"))';
    expect(collectStringLiterals(f).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("схлопывает повторы", () => {
    expect(collectStringLiterals('IF(percent >= 0, "a", "a")')).toEqual(["a"]);
  });

  it("не падает на синтаксически неверной формуле", () => {
    expect(collectStringLiterals("IF(")).toEqual([]);
  });
});

describe("findUnknownOutcomes", () => {
  it("находит исход, которого нет в перечне", () => {
    expect(findUnknownOutcomes('IF(percent >= 0, "growing", "burnout")', ["growing"]))
      .toEqual(["burnout"]);
  });

  it("не считает ключ шкалы неизвестным исходом", () => {
    expect(findUnknownOutcomes('IF(scaleById("ee").raw > 10, "growing", "growing")', ["growing"]))
      .toEqual([]);
  });

  it("возвращает пустой список, когда перечень пуст", () => {
    expect(findUnknownOutcomes('IF(percent >= 0, "a", "b")', [])).toEqual([]);
  });

  it("ничего не находит, когда все коды объявлены", () => {
    expect(findUnknownOutcomes('IF(percent >= 0, "a", "b")', ["a", "b", "c"])).toEqual([]);
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
 * The formula returns an outcome CODE, and nothing checks that the codes it can
 * return actually exist: a one-character typo silently produces an empty card, and
 * only for the learner who lands in that branch. Walking the AST turns that into an
 * editing-time error.
 *
 * Entity references are NOT string nodes — `scaleById("ee")` parses to
 * `{ type: "accessor", fn, arg, prop }` with the key in `arg`, and `var` / `count`
 * hold their names the same way. So a `{ type: "string" }` node is always a VALUE
 * literal, which is exactly an outcome code. The filtering is structural; no list of
 * accessor names is needed or wanted.
 *
 * The walk is an exhaustive switch over the `Ast` union rather than a generic object
 * traversal: adding a node type then becomes a compile error here instead of a
 * silently skipped branch.
 *
 * Pure — no DOM, no Node.
 */

import { parse } from "./parser";
import type { Ast } from "./types";

function walk(node: Ast, out: Set<string>): void {
  switch (node.type) {
    case "string":
      out.add(node.value);
      return;
    case "if":
      walk(node.cond, out);
      walk(node.then, out);
      walk(node.otherwise, out);
      return;
    case "unary":
      walk(node.operand, out);
      return;
    case "binary":
      walk(node.left, out);
      walk(node.right, out);
      return;
    case "number":
    case "boolean":
    case "percent":
    case "score":
    case "accessor":
    case "var":
    case "nullary":
    case "count":
      return;
  }
}

/**
 * Every distinct string literal the formula can yield. An unparseable formula gives
 * an empty list: the author is mid-edit, and a syntax error is already reported by
 * the editor's own validation.
 */
export function collectStringLiterals(formula: string): string[] {
  try {
    const out = new Set<string>();
    walk(parse(formula), out);
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
  const known = new Set(codes);
  return collectStringLiterals(formula).filter((literal) => !known.has(literal));
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- shared/formula/__tests__/outcome-literals.test.ts`
Expected: PASS, 9 тестов.

- [ ] **Step 5: Подключить сверку к редактору**

В `client/src/features/tests/editor/sections/result-variables-section.tsx` при каждом
изменении формулы или перечня вызывать `findUnknownOutcomes` и показывать `ou-banner`
со списком неизвестных кодов и кнопкой «Добавить в перечень».

Сохранение НЕ блокировать: автор заполняет формулу и перечень в любом порядке, и
запрет мешал бы работе. Предупреждение — сигнал, а не гейт.

Те же коды передаются в `OutcomesEditor` через `suggestedCodes` (Task 14), так что
добавление в перечень делается одним нажатием и в двух местах не расходится.

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

- [ ] **Step 5: Проверить каркас экрана в реальном окне**

Контракт сцены (`theme.css`): `tb-scene` — колонка на всю высоту с `overflow: hidden`,
шапка и подвал `flex: none`, тело `flex: 1; overflow: auto`. Новые блоки не должны его
нарушать: шапка остаётся сверху, подвал — внизу окна, прокручивается ТОЛЬКО тело.

Проверять в окне фиксированной высоты (1280x800 и 1024x640), а не на кадре, растянутом
по содержимому: растянутый кадр скрывает, сколько экрана занимает измерительный блок и
что вообще видно без прокрутки.

Записать в матрицу, сколько блоков видно без прокрутки при каждом размере.

Прокрутка на экране итогов ПРИНЯТА как норма (решение владельца, 2026-07-31). Замеры на
эскизе: при 1280x800 тело 650 px против 1058 px содержимого — видны профиль, две шкалы
целиком и начало третьей; при 1024x640 — профиль и одна шкала. Требования «все шкалы в
первом экране» нет и быть не может: при пяти-семи шкалах прокрутка неизбежна в любом окне.

Проверяется другое: первый экран даёт ориентировку (профиль виден целиком, блок шкал
начался), обрыв приходится на середину секции, а не встык с границей блока, и подвал
с кнопками доступен без прокрутки.

- [ ] **Step 6: Проверить откаты**

- шкала без домена — вид `label`, предупреждений нет;
- показатель со строковым значением при `scaleRenderKind: band_ruler` — метка;
- формула, возвращающая код вне перечня, — предупреждение в редакторе.

- [ ] **Step 7: Записать матрицу приёмки**

Создать `docs/specs/prd-29/acceptance.md` по образцу
`docs/specs/prd-15/acceptance-matrix.md`: строка на проверку, ожидаемый результат,
фактический, ссылка на скриншот.

- [ ] **Step 8: Прогнать полный набор проверок**

Run: `npm run check`
Expected: 0 ошибок.

Run: `npm test`
Expected: PASS, порог покрытия 80 процентов держится.

Run: `npm run lint:md`
Expected: 0 замечаний.

Не запускать `vitest` параллельно с `npm test`: они делят каталог покрытия и мешают друг другу.

- [ ] **Step 9: Commit**

```bash
git add docs/specs/prd-29/acceptance.md
git commit -m "docs(prd-29): матрица приёмки"
```

---

## Долг, вскрытый при реализации Task 6

Оба пункта обязательны ДО закрытия PRD-29; они не были предусмотрены планом.

### Д-1. Drizzle-миграция для боевого деплоя

`migrations/036_prd29_measurement_results.sql` документирует изменение и применим вручную,
но боевой путь деплоя — `drizzle-kit generate` в каталог `drizzle/` плюс `migrate`
(в каталоге сейчас есть до `0005_role_developer.sql`). Без сгенерированной
`drizzle/0006_*.sql` изменение схемы на прод не поедет.

Сгенерировать миграцию должен владелец: `drizzle-kit` преднагружает `.env` и подключается
к базе, а dev-база содержит копию боевых данных.

### Д-2. Трёхпозиционная видимость в книге Excel

`server/utils/workbook-sheets.ts` оставлен парой «да / нет»: импорт `да` даёт
`level_and_value`, экспорт отдаёт `!== "hidden"`. Средняя позиция `level` через книгу
невыразима, поэтому пара «экспорт, затем импорт» схлопывает `level` в `level_and_value` —
то есть молча раскрывает ученику числовое значение там, где методолог его закрыл.

Сегодня это безвредно: задать `level` автору ещё негде. Но ровно с Task 13 такая
возможность появляется, поэтому колонку нужно перевести на три значения В ТОЙ ЖЕ задаче,
иначе круговой обход через книгу начнёт терять решение методолога.

## Известные ограничения

- Книга Excel новых полей не переносит: после импорта методику дозаполняют в интерфейсе.
  Вынесено в отдельную спеку (PRD-29 §13.4).
- Итоги раздела не показывают шкал. Шкала считается по всему тесту, и частичный расчёт был
  бы неверен; при необходимости автор заводит шкалу, измерения которой лежат внутри раздела.
- Отчёт PDF шкал и показателей пока не показывает (PRD-29 §13.1).
- Показатель задаётся формулой; таблица решений по уровням шкал — следующая спека
  (PRD-29 §13.2). До неё сложные профили пишутся вложенными `IF`.
