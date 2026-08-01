# PRD-35 Competency Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показать профиль по нескольким шкалам ОДНОЙ диаграммой — на экране итогов завершённой
попытки и в PDF-отчёте, одинаково в вебе и в SCORM-пакете.

**Architecture:** Радар — кросс-скальный вид блока «Шкалы», а не вид карточки. Геометрию и цвет
считает новый чистый модуль `shared/template/radar-view.ts`, переиспользующий рампу
(`level-ramp.ts`) и разбор интерпретации (`shared/scales/interpretation.ts`) от PRD-29. Разметка
получает готовые координаты и не вычисляет ничего: DSL — подмножество mustache без арифметики.
Показ включается булевым переключателем `showCompetencyRadar` в `settings[]` варианта: у вида
`results` он живёт в `content_pages.settings_json` (рядом с `scoreSummary`/`indicators`/`scales`),
у видов отчёта — в `tests.report_settings_json`.

**Tech Stack:** TypeScript (Node/Express, Drizzle, Zod), React 19 + `@universityrt/ui-kit`,
Vitest (`npm test -- <путь>`), plain-JS SCORM runtime (`server/scorm/**`), SVG без библиотек.
Спецификация: [docs/specs/prd-35/competency-radar.md](../specs/prd-35/competency-radar.md).

---

## Правила прогона и коммитов

- **Полный прогон тестов запрещён без явного разрешения владельца:** в одной рабочей копии
  одновременно работают несколько сессий. Во время работы — только точечно:
  `npm test -- <путь к файлу>`.
- **`npx vitest run` не работает** (падает на `initConfig()`), только `npm test -- <путь>`.
- **Индекс git общий на все сессии.** Коммитить ТОЛЬКО перечисленные в задаче пути и перед
  коммитом сверять состав: `git diff --cached --name-only`.
- Трейлер `Co-Authored-By` не добавлять.
- JSDoc — на английском, с `@module`; текст интерфейса и документы — на русском, без эмодзи.

## Roadmap (разделы спецификации → задачи плана)

| Этап | Разделы PRD | Задачи |
| --- | --- | --- |
| Э0 — эскиз | 8, 7 | Task 1 |
| Э1 — чистое ядро | 4, 6, 7 | Task 2 |
| Э2 — контракт и сборка контекста | 10 | Task 3 |
| Э3 — веб-хост: настройка, разметка, стили | 8, 9 | Task 4 |
| Э4 — SCORM-паритет | 10 | Task 5 |
| Э5 — материализация домена | 5 | Task 6 |
| Э6 — редактор | 5.1, 6, 9 | Task 7 |
| Э7 — отчёт | 11 | Task 8 |
| Э8 — приёмка | 12 | Task 9 |

Порядок обязателен: Task 1 → Task 2 → Task 3 → Task 4. Task 5 после Task 4. Task 6 и Task 7
независимы друг от друга и идут после Task 3. Task 8 после Task 4. Task 9 последняя.

## Naming contract

Единые имена во всех задачах. Отклонение = дефект.

```ts
/** Одна ось радара, готовая к отрисовке. Всё вычислено ядром. */
export interface CtxRadarAxis {
  key: string;
  label: string;
  /** Метка уровня. Пусто, когда значение не попало ни в один интервал. */
  levelText: string;
  tone: LevelTone;
  color: HslTriple;
  /** "" либо `tb-radar__dot--quantized`: DSL не умеет условных классов. */
  quantizedClass: string;
  radiusPercent: number;
  cx: number;
  cy: number;
  x: number;
  y: number;
  axisX: number;
  axisY: number;
}

/**
 * Одна строка текста на диаграмме — часть перенесённого названия шкалы либо её
 * уровень. Плоский самодостаточный список: цикл DSL не достаёт родителя, а разные
 * названия переносятся на РАЗНОЕ число строк, поэтому координату и выравнивание
 * несёт каждая строка сама.
 */
export interface CtxRadarLabel {
  text: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  /** `tb-radar__label` для названия, `tb-radar__level` для уровня. */
  className: string;
}

/** Кольцо сетки. Центр несёт каждое кольцо: в цикле DSL родителя не достать. */
export interface CtxRadarRing {
  cx: number;
  cy: number;
  radius: number;
}

/** Диаграмма целиком; `null` означает «радар не рисуется». */
export interface CtxRadarChart {
  width: number;
  height: number;
  axes: CtxRadarAxis[];
  rings: CtxRadarRing[];
  labels: CtxRadarLabel[];
  polygonPoints: string;
  ariaLabel: string;
}
```

Числовых значений в контракте нет намеренно: цифры печатает карточка шкалы, диаграмма
показывает форму профиля (PRD-35 §4.3).

Перенос названий по словам делает ЯДРО (`wrapLabel`), а не разметка: DSL не умеет ни
измерять, ни разбивать текст. Браузерная проверка Task 4 показала, зачем это нужно —
«Обесценивание достижений» одной строкой выходило за левый край поля, а трёхстрочная
подпись верхней оси начиналась с отрицательной координаты и обрезалась сверху. Оба случая
закрыты тестами «переносит длинное название по словам» и «держит все подписи внутри поля».

Ключ настройки — `showCompetencyRadar` (одинаково у `results` и у видов отчёта).
Поле контекста — `result.scalesChart`.

---

## Task 1: Эскиз экрана итогов с радаром

Эскиз обязателен ДО кода интерфейса: реализовывать UI без согласованного эскиза в этом проекте
нельзя.

**Files:**

- Create: `docs/wireframes/prd35-competency-radar.html`

- [ ] **Step 1: Взять за основу существующий эскиз итогов**

Открыть `docs/wireframes/approved/prd2-prd5-scoring-tabs.html` и
`server/scorm/templates/default/layouts/results.html`, чтобы блок «По шкалам» в эскизе выглядел
1:1 как сегодня. Эскиз — доработка существующего экрана, а не новый дизайн: переизобретать
раскладку запрещено.

- [ ] **Step 2: Нарисовать две колонки блока «По шкалам»**

В холсте эскиза только реальный UI на DS-классах (`ou-*`, `tb-*`); пояснения — в блоках
`wf-notes` и `wf-mapping`, не в холсте. Показать:

- широкий экран: слева радар (SVG), справа существующий список карточек шкал;
- узкий экран (второй фрейм): радар над карточками;
- три оси референсной методики Маслача с метками уровней «Высокий», «Умеренный», «Низкий»;
- одну ось с квантованным лучом (видимость «уровень без значения») — без подписи значения.

- [ ] **Step 3: Снять скриншот эскиза**

```bash
python -m http.server 8765 --directory . &
"$LOCALAPPDATA/ms-playwright/chromium_headless_shell-1193/chrome-headless-shell.exe" \
  --headless --disable-gpu --screenshot=.playwright-mcp/prd35-radar.png --window-size=1440,1200 \
  http://localhost:8765/docs/wireframes/prd35-competency-radar.html
```

Сервер поднимать ИЗ КОРНЯ репозитория, иначе не подхватятся стили DS. Временные файлы — в
`.playwright-mcp/`, в корне репозитория их быть не должно.

- [ ] **Step 4: Сверить скриншот с DS и показать владельцу**

Проверить по каждой детали: используются только существующие классы `university-rt.css`
(несуществующий `ou-*` контролёр НЕ ловит), подписи не наезжают, на узком фрейме радар не
раздавлен. Дождаться согласования — без него следующие задачи не начинать.

- [ ] **Step 5: Commit**

```bash
git add docs/wireframes/prd35-competency-radar.html
git diff --cached --name-only
git commit -m "docs(prd-35): эскиз экрана итогов с радаром компетенций"
```

---

## Task 2: Ядро — геометрия и цвет радара

**Files:**

- Create: `shared/template/radar-view.ts`
- Test: `shared/template/__tests__/radar-view.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `shared/template/__tests__/radar-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRadarChart, type RadarAxisInput } from "../radar-view";
import { LEVEL_SCHEMES } from "../level-ramp";
import type { ScaleInterpretation } from "../../scales/interpretation";

const ramp = LEVEL_SCHEMES.traffic;

function scale(
  key: string,
  domainMax: number,
  bandsAt: number[],
  valence: ScaleInterpretation["valence"] = "higher_is_better",
): ScaleInterpretation {
  return {
    domainMin: 0,
    domainMax,
    valence,
    bands: bandsAt.map((min, i) => ({
      min,
      max: i + 1 < bandsAt.length ? bandsAt[i + 1] : domainMax,
      level: `l${i}`,
      label: `Уровень ${i}`,
    })),
  };
}

function axis(key: string, value: number, interpretation: ScaleInterpretation): RadarAxisInput {
  return { key, name: key, value, visibility: "level_and_value", interpretation };
}

describe("buildRadarChart", () => {
  it("строит три оси, первая — сверху", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [
        axis("a", 45, scale("a", 45, [0, 15, 25])),
        axis("b", 0, scale("b", 25, [0, 5, 10])),
        axis("c", 20, scale("c", 40, [0, 28, 33])),
      ],
    });
    expect(chart).not.toBeNull();
    expect(chart!.axes).toHaveLength(3);
    const top = chart!.axes[0];
    expect(top.x).toBeCloseTo(top.cx, 1);
    expect(top.y).toBeLessThan(top.cy);
    expect(top.y).toBeCloseTo(top.axisY, 1);
    expect(top.radiusPercent).toBe(100);
    expect(chart!.axes[1].radiusPercent).toBe(0);
    expect(chart!.rings).toHaveLength(4);
    expect(chart!.rings[0].cx).toBe(top.cx);
  });

  it("не печатает числовых значений: подпись — название и уровень", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [
        axis("a", 40, scale("a", 45, [0, 15, 25])),
        axis("b", 3, scale("b", 25, [0, 5, 10])),
        axis("c", 20, scale("c", 40, [0, 28, 33])),
      ],
    });
    const values = Object.values(chart!.axes[0]).filter((v) => typeof v === "string");
    expect(chart!.axes[0].levelText).toBe("Уровень 2");
    expect(values.some((v) => v.includes("из"))).toBe(false);
  });

  it("возвращает null при менее чем трёх видимых шкалах", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [axis("a", 10, scale("a", 45, [0, 15, 25])), axis("b", 3, scale("b", 25, [0, 5, 10]))],
    });
    expect(chart).toBeNull();
  });

  it("исключает скрытые шкалы и падает до null, когда видимых осталось меньше трёх", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [
        { ...axis("a", 10, scale("a", 45, [0, 15, 25])), visibility: "hidden" },
        axis("b", 3, scale("b", 25, [0, 5, 10])),
        axis("c", 20, scale("c", 40, [0, 28, 33])),
      ],
    });
    expect(chart).toBeNull();
  });

  it("квантует луч по середине зоны при видимости level и не печатает значение", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [
        { ...axis("a", 16, scale("a", 40, [0, 10, 20, 30])), visibility: "level" },
        axis("b", 3, scale("b", 25, [0, 5, 10])),
        axis("c", 20, scale("c", 40, [0, 28, 33])),
      ],
    });
    // Зона 10..20 из домена 0..40 — середина 15, то есть 37.5 % радиуса.
    expect(chart!.axes[0].radiusPercent).toBe(37.5);
    expect(chart!.axes[0].quantizedClass).toBe("tb-radar__dot--quantized");
    expect(chart!.axes[1].quantizedClass).toBe("");
  });

  it("не рисует радар, когда у видимой шкалы нет ни домена, ни интервалов", () => {
    const noDomain: ScaleInterpretation = {
      domainMin: null,
      domainMax: null,
      valence: "none",
      bands: [],
    };
    const chart = buildRadarChart({
      ramp,
      axes: [
        axis("a", 10, noDomain),
        axis("b", 3, scale("b", 25, [0, 5, 10])),
        axis("c", 20, scale("c", 40, [0, 28, 33])),
      ],
    });
    expect(chart).toBeNull();
  });

  it("красит ось обратной шкалы с другого конца рампы", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [
        axis("up", 40, scale("up", 40, [0, 28, 33], "higher_is_better")),
        axis("down", 40, scale("down", 40, [0, 28, 33], "lower_is_better")),
        axis("c", 20, scale("c", 40, [0, 28, 33])),
      ],
    });
    expect(chart!.axes[0].color).not.toBe(chart!.axes[1].color);
    expect(chart!.axes[0].tone).toBe("favorable");
    expect(chart!.axes[1].tone).toBe("critical");
  });

  it("отдаёт строку polygonPoints по числу осей", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [
        axis("a", 45, scale("a", 45, [0, 15, 25])),
        axis("b", 5, scale("b", 25, [0, 5, 10])),
        axis("c", 20, scale("c", 40, [0, 28, 33])),
      ],
    });
    expect(chart!.polygonPoints.split(" ")).toHaveLength(3);
    expect(chart!.polygonPoints).toMatch(/^[\d.,\s-]+$/);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
npm test -- shared/template/__tests__/radar-view.test.ts
```

Ожидается: FAIL, `Failed to resolve import "../radar-view"`.

- [ ] **Step 3: Написать модуль**

Создать `shared/template/radar-view.ts`:

```ts
/**
 * @module shared/template/radar-view
 *
 * Turns the visible scales of a test into ONE radar chart — the first cross-scale
 * view on the results screen. Every other measurement view (PRD-29 `measure-view`)
 * draws a single scale, so the radar lives at the block level, not in a card.
 *
 * The core computes everything the layout needs — angles, points, the polygon
 * string, ring radii, label anchors and zone colours — because the DSL is a mustache
 * subset with no arithmetic, and because the web player and the SCORM package must
 * draw the identical figure.
 *
 * Two decisions are load-bearing and must not be "simplified" later:
 *
 *   - the radius is the raw share of the domain, NEVER inverted by `valence`.
 *     Inverting would put a high burnout score near the centre under a label that
 *     says "Эмоциональное истощение", and would contradict the `band_ruler` of the
 *     same scale sitting in the card next to it. Evaluation is carried by colour.
 *   - visibility `level` QUANTIZES the ray to the middle of its band. Drawing the
 *     exact position would disclose graphically the very number the author chose to
 *     hide, and PRD-29 §6.3 already states that a method's verdict is categorical.
 *
 * Pure — no DOM, no Node.
 */

import {
  findBand,
  type LearnerVisibility,
  type LevelTone,
  type ScaleInterpretation,
} from "../scales/interpretation";
import { rampColor, zoneColors, type HslTriple, type LevelRamp } from "./level-ramp";

/** Below three axes there is no figure to read — a pair of rulers reads better. */
const MIN_AXES = 3;

/**
 * Viewport of the widget, in its own coordinates — the rendered size is CSS's
 * business, so print and a 360px phone reuse the same numbers. Not square: the
 * labels need horizontal room, the rings do not (values taken from the approved
 * wireframe docs/wireframes/prd35-competency-radar.html).
 */
const WIDTH = 340;
const HEIGHT = 300;
const CENTER_X = 170;
const CENTER_Y = 150;
const RADIUS = 100;
/** Distance from the centre to the axis label, past the outer ring. */
const LABEL_GAP = 30;
/** Baseline step from the scale name down to its level label. */
const LEVEL_STEP = 16;
/** Grid rings at quarter steps of the domain; unlabelled on purpose (see below). */
const RING_STEPS = [0.25, 0.5, 0.75, 1];

export interface RadarAxisInput {
  key: string;
  name: string;
  value: number | string | boolean | null | undefined;
  visibility: LearnerVisibility;
  interpretation: ScaleInterpretation;
}

export interface CtxRadarAxis {
  key: string;
  label: string;
  levelText: string;
  tone: LevelTone;
  color: HslTriple;
  quantizedClass: string;
  radiusPercent: number;
  cx: number;
  cy: number;
  x: number;
  y: number;
  axisX: number;
  axisY: number;
  labelX: number;
  labelY: number;
  levelY: number;
  labelAnchor: "start" | "middle" | "end";
}

export interface CtxRadarRing {
  cx: number;
  cy: number;
  radius: number;
}

export interface CtxRadarChart {
  width: number;
  height: number;
  axes: CtxRadarAxis[];
  rings: CtxRadarRing[];
  polygonPoints: string;
  ariaLabel: string;
}

export interface RadarChartInput {
  axes: RadarAxisInput[];
  ramp: LevelRamp;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Tone of the current band. Mirrors `measure-view.toneOf` so the vertex marker and
 * the level tag beside the card never disagree about the same value.
 */
function toneOf(valence: ScaleInterpretation["valence"], index: number, count: number): LevelTone {
  if (valence === "none" || count <= 1 || index < 0) return "neutral";
  const position = index / (count - 1);
  const t = valence === "lower_is_better" ? 1 - position : position;
  if (t >= 0.75) return "favorable";
  if (t >= 0.375) return "attention";
  return "critical";
}

/** Share of the domain the value sits at, or the middle of its band when quantized. */
function radiusRatio(
  value: number,
  interpretation: ScaleInterpretation,
  domainMin: number,
  domainMax: number,
  quantize: boolean,
): number {
  const span = domainMax - domainMin;
  if (span <= 0) return 0;
  if (!quantize) return clamp01((value - domainMin) / span);
  const bands = interpretation.bands;
  const band = findBand(bands, value);
  if (!band) return 0;
  const index = bands.indexOf(band);
  const right = index + 1 < bands.length ? bands[index + 1].min : domainMax;
  const middle = (band.min + right) / 2;
  return clamp01((middle - domainMin) / span);
}

/**
 * Labels sit UNDER the ray end and are centred; only a genuinely horizontal axis
 * (four, eight, … axes) gets a side anchor, because there the label would collide
 * with the figure. Centring is what keeps long Russian scale names inside the
 * viewport — anchoring them outwards pushed «Обесценивание достижений» off canvas.
 */
function anchorFor(cos: number): "start" | "middle" | "end" {
  if (cos > 0.95) return "start";
  if (cos < -0.95) return "end";
  return "middle";
}

/**
 * Build the chart, or `null` when it must not be drawn.
 *
 * `null` covers every refusal: fewer than {@link MIN_AXES} visible scales, a scale
 * whose value is not a number, a scale without a usable domain. The refusal is
 * deliberately all-or-nothing — a closed figure built from part of the scales looks
 * complete and misreads as the whole profile.
 */
export function buildRadarChart(input: RadarChartInput): CtxRadarChart | null {
  const visible = input.axes.filter((a) => a.visibility !== "hidden");
  if (visible.length < MIN_AXES) return null;

  const prepared: CtxRadarAxis[] = [];
  const step = (Math.PI * 2) / visible.length;

  for (let i = 0; i < visible.length; i += 1) {
    const source = visible[i];
    const { interpretation } = source;
    const value = source.value;
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    if (interpretation.domainMin === null || interpretation.domainMax === null) return null;

    const domainMin = interpretation.domainMin;
    const domainMax = interpretation.domainMax;
    if (domainMax - domainMin <= 0) return null;

    const quantized = source.visibility === "level";
    const ratio = radiusRatio(value, interpretation, domainMin, domainMax, quantized);

    const bands = interpretation.bands;
    const band = findBand(bands, value);
    const bandIndex = band ? bands.indexOf(band) : -1;
    const effectiveTone = band?.tone ?? toneOf(interpretation.valence, bandIndex, bands.length);
    const colors = zoneColors(input.ramp, bands.length, interpretation.valence);
    const color =
      bandIndex >= 0 && colors[bandIndex]
        ? colors[bandIndex]
        : rampColor(
            input.ramp,
            interpretation.valence === "lower_is_better" ? 1 - ratio : ratio,
          );

    // Starts at the top and goes clockwise: a profile read like a clock face.
    const angle = -Math.PI / 2 + step * i;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const labelY = round1(CENTER_Y + sin * (RADIUS + LABEL_GAP));

    prepared.push({
      key: source.key,
      label: source.name,
      levelText: band ? band.label ?? band.level : "",
      tone: effectiveTone,
      color,
      quantizedClass: quantized ? "tb-radar__dot--quantized" : "",
      radiusPercent: round1(ratio * 100),
      cx: CENTER_X,
      cy: CENTER_Y,
      x: round1(CENTER_X + cos * RADIUS * ratio),
      y: round1(CENTER_Y + sin * RADIUS * ratio),
      axisX: round1(CENTER_X + cos * RADIUS),
      axisY: round1(CENTER_Y + sin * RADIUS),
      labelX: round1(CENTER_X + cos * (RADIUS + LABEL_GAP)),
      labelY,
      levelY: round1(labelY + LEVEL_STEP),
      labelAnchor: anchorFor(cos),
    });
  }

  return {
    width: WIDTH,
    height: HEIGHT,
    axes: prepared,
    rings: RING_STEPS.map((s) => ({ cx: CENTER_X, cy: CENTER_Y, radius: round1(RADIUS * s) })),
    polygonPoints: prepared.map((a) => `${a.x},${a.y}`).join(" "),
    ariaLabel: `Профиль по шкалам: ${prepared
      .map((a) => `${a.label} — ${a.levelText || "уровень не определён"}`)
      .join("; ")}`,
  };
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

```bash
npm test -- shared/template/__tests__/radar-view.test.ts
```

Ожидается: PASS, 7 тестов.

- [ ] **Step 5: Проверить типы**

```bash
npm run check
```

Ожидается: без ошибок в `shared/template/radar-view.ts`.

- [ ] **Step 6: Commit**

```bash
git add shared/template/radar-view.ts shared/template/__tests__/radar-view.test.ts
git diff --cached --name-only
git commit -m "feat(prd-35): ядро радара компетенций — геометрия, цвет, квантование"
```

---

## Task 3: Контракт контекста и сборка `result.scalesChart`

**Files:**

- Modify: `shared/template/context.ts` (рядом с объявлением `scales?: CtxMeasureView[]`, строка ~141)
- Modify: `shared/template/result-context.ts` (интерфейс `MeasuresInput` ~строка 116, сборка ~строка 275)
- Test: `shared/template/__tests__/result-context-radar.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `shared/template/__tests__/result-context-radar.test.ts`. За образец взять
`shared/template/__tests__/result-context-measures.test.ts` — там уже собран валидный
`ResultInput` и заполнен `measures`; в новом файле переиспользовать ту же форму входа, добавив
`showRadar`.

```ts
import { describe, expect, it } from "vitest";
import { buildResultContext } from "../result-context";
import { LEVEL_SCHEMES } from "../level-ramp";
import type { ScaleInterpretation } from "../../scales/interpretation";

function scale(domainMax: number, bandsAt: number[]): ScaleInterpretation {
  return {
    domainMin: 0,
    domainMax,
    valence: "higher_is_better",
    bands: bandsAt.map((min, i) => ({
      min,
      max: i + 1 < bandsAt.length ? bandsAt[i + 1] : domainMax,
      level: `l${i}`,
      label: `Уровень ${i}`,
    })),
  };
}

const result = {
  correct: 0,
  totalQuestions: 3,
  earnedPoints: 0,
  totalPoints: 0,
  passed: false,
  topicResults: [],
};

function measures(showRadar: boolean) {
  return {
    ramp: LEVEL_SCHEMES.traffic,
    scaleKind: "band_ruler" as const,
    indicatorKind: "label" as const,
    showRadar,
    hasPassThreshold: false,
    indicators: [],
    scales: [
      { key: "a", name: "A", value: 40, visibility: "level_and_value" as const, interpretation: scale(45, [0, 15, 25]) },
      { key: "b", name: "B", value: 3, visibility: "level_and_value" as const, interpretation: scale(25, [0, 5, 10]) },
      { key: "c", name: "C", value: 20, visibility: "level_and_value" as const, interpretation: scale(40, [0, 28, 33]) },
    ],
  };
}

describe("result.scalesChart", () => {
  it("отсутствует, пока переключатель выключен", () => {
    const ctx = buildResultContext(result, "Тест", { measures: measures(false) });
    expect(ctx.result.scalesChart).toBeUndefined();
  });

  it("появляется при включённом переключателе и трёх видимых шкалах", () => {
    const ctx = buildResultContext(result, "Тест", { measures: measures(true) });
    expect(ctx.result.scalesChart?.axes).toHaveLength(3);
    expect(ctx.result.scalesChart?.polygonPoints.split(" ")).toHaveLength(3);
  });

  it("отсутствует, когда блок шкал скрыт настройкой", () => {
    const ctx = buildResultContext(result, "Тест", {
      measures: { ...measures(true), blockSettings: { scales: "hide" } },
    });
    expect(ctx.result.scalesChart).toBeUndefined();
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
npm test -- shared/template/__tests__/result-context-radar.test.ts
```

Ожидается: FAIL — `showRadar` не существует в типе, `scalesChart` не определён.

- [ ] **Step 3: Расширить публичный контракт**

В `shared/template/context.ts` рядом с полем `scales?: CtxMeasureView[]` добавить:

```ts
  /**
   * PRD-35: cross-scale profile. Present only when the author switched the radar on
   * AND the chart is feasible (three or more visible scales, each with a domain).
   * The layout binds ready coordinates: the DSL computes nothing.
   */
  scalesChart?: CtxRadarChart;
  /**
   * Class of the scales block: `tb-measures` alone, or with the `--chart` modifier
   * when the radar is drawn. Core-prepared because the DSL cannot append a class
   * conditionally, and a CSS `:has()` selector would depend on the engine the LMS
   * embeds — the very dependency the core-side computation exists to avoid.
   */
  scalesBlockClass?: string;
```

И импорт типа в шапке файла:

```ts
import type { CtxRadarChart } from "./radar-view";
```

- [ ] **Step 4: Прокинуть флаг и собрать диаграмму**

В `shared/template/result-context.ts` в интерфейс `MeasuresInput` (рядом с `scaleKind`) добавить:

```ts
  /** PRD-35: author's explicit switch on the `results` variant. No `auto` mode. */
  showRadar?: boolean;
```

Импорт рядом с импортом `buildMeasureView`:

```ts
import { buildRadarChart } from "./radar-view";
```

В блоке `if (blocks.scales && visibleScales.length) { ... }` после присваивания `result.scales`
добавить:

```ts
      result.scalesBlockClass = "tb-measures";
      if (opts.measures.showRadar) {
        const chart = buildRadarChart({ axes: visibleScales, ramp: opts.measures.ramp });
        if (chart) {
          result.scalesChart = chart;
          result.scalesBlockClass = "tb-measures tb-measures--chart";
        }
      }
```

Радар собирается ВНУТРИ ветки блока шкал: скрытый блок не должен оставлять на экране висящую
диаграмму.

Возможная придирка компилятора: у `MeasureInput.interpretation` тип шире
(`ScaleInterpretation | IndicatorInterpretation`), а `RadarAxisInput` требует
`ScaleInterpretation`. Если `tsc` не выведет тип сам, сузить его в `RadarAxisInput` до того же
объединения — поля, которые читает радар (`domainMin`, `domainMax`, `valence`, `bands`), есть у
обоих, поэтому расширение безопасно. Приводить типы через `as` нельзя.

- [ ] **Step 5: Запустить тесты и убедиться, что они проходят**

```bash
npm test -- shared/template/__tests__/result-context-radar.test.ts
npm test -- shared/template/__tests__/result-context-measures.test.ts
```

Ожидается: PASS в обоих файлах (второй — проверка, что PRD-29 не сломан).

- [ ] **Step 6: Commit**

```bash
git add shared/template/context.ts shared/template/result-context.ts \
        shared/template/__tests__/result-context-radar.test.ts
git diff --cached --name-only
git commit -m "feat(prd-35): контракт result.scalesChart и сборка радара в контексте итогов"
```

---

## Task 4: Веб-хост — настройка варианта, разметка, стили

**Files:**

- Modify: `server/scorm/templates/default/manifest.json` (вариант `results.standard`, массив `settings`)
- Modify: `server/routes/attempts.ts:154` (чтение `settingsJson` страницы `results`)
- Modify: `server/services/result-context.ts` (передача `showRadar`)
- Modify: `server/scorm/templates/default/layouts/results.html` (блок «По шкалам», строка ~58)
- Modify: `server/scorm/templates/default/styles/theme.css`
- Test: `server/__tests__/template-manifest-prd35.test.ts`

- [ ] **Step 1: Объявить переключатель в манифесте**

В `server/scorm/templates/default/manifest.json`, в `contentTemplates[]` у варианта с
`key: "results.standard"`, в конец массива `settings` добавить:

```json
{
  "key": "showCompetencyRadar",
  "type": "boolean",
  "label": "Радар компетенций",
  "description": "Профиль по шкалам одной диаграммой. Рисуется при трёх и более видимых шкалах.",
  "default": false
}
```

- [ ] **Step 2: Написать падающий тест манифеста**

Создать `server/__tests__/template-manifest-prd35.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifest = JSON.parse(
  readFileSync(resolve("server/scorm/templates/default/manifest.json"), "utf-8"),
) as { contentTemplates: Array<{ key: string; settings?: Array<{ key: string; type: string; default?: unknown }> }> };

describe("манифест «Стандартного»: переключатель радара", () => {
  it("объявлен у варианта итогов и выключен по умолчанию", () => {
    const results = manifest.contentTemplates.find((c) => c.key === "results.standard");
    const field = results?.settings?.find((s) => s.key === "showCompetencyRadar");
    expect(field).toBeDefined();
    expect(field!.type).toBe("boolean");
    expect(field!.default).toBe(false);
  });
});
```

- [ ] **Step 3: Запустить тест**

```bash
npm test -- server/__tests__/template-manifest-prd35.test.ts
```

Ожидается: PASS (шаг 1 уже внёс поле). Если FAIL — поле добавлено не в тот вариант.

- [ ] **Step 4: Прокинуть настройку в контекст на сервере**

В `server/routes/attempts.ts` рядом со строкой 154, где читается `blockSettings`, флаг уже
приезжает в том же объекте `settingsJson`. Поэтому в `server/services/result-context.ts`
в возвращаемый объект (рядом с `blockSettings: source.blockSettings`) добавить:

```ts
    showRadar: source.blockSettings?.showCompetencyRadar === true,
```

и расширить тип настроек блоков в `shared/template/results-blocks.ts`:

```ts
export interface ResultsBlockSettings {
  scoreSummary?: BlockSetting;
  indicators?: BlockSetting;
  scales?: BlockSetting;
  /** PRD-35: булев, а не три позиции — режима «решай сам» у радара нет. */
  showCompetencyRadar?: boolean;
}
```

- [ ] **Step 5: Добавить разметку в макет итогов**

В `server/scorm/templates/default/layouts/results.html` в блоке `{{#if result.scales}}` заменить
жёсткий класс контейнера на биндинг и вставить диаграмму перед списком карточек. Разметка —
из согласованного эскиза [prd35-competency-radar.html](../wireframes/prd35-competency-radar.html):

```html
      <div class="{{result.scalesBlockClass}}">
        {{#if result.scalesChart}}
        <div class="tb-radar">
          <svg class="tb-radar__svg" viewBox="0 0 {{result.scalesChart.width}} {{result.scalesChart.height}}"
               role="img" aria-label="{{result.scalesChart.ariaLabel}}">
            {{#each result.scalesChart.rings}}
            <circle class="tb-radar__ring" cx="{{cx}}" cy="{{cy}}" r="{{radius}}"></circle>
            {{/each}}
            {{#each result.scalesChart.axes}}
            <line class="tb-radar__axis" x1="{{cx}}" y1="{{cy}}" x2="{{axisX}}" y2="{{axisY}}"></line>
            {{/each}}
            <polygon class="tb-radar__shape" points="{{result.scalesChart.polygonPoints}}"></polygon>
            {{#each result.scalesChart.axes}}
            <circle class="tb-radar__dot {{quantizedClass}}" cx="{{x}}" cy="{{y}}" r="6"
                    style="--tb-zone:{{color}}"></circle>
            <text class="tb-radar__label" x="{{labelX}}" y="{{labelY}}" text-anchor="{{labelAnchor}}">{{label}}</text>
            <text class="tb-radar__level" x="{{labelX}}" y="{{levelY}}" text-anchor="{{labelAnchor}}">{{levelText}}</text>
            {{/each}}
          </svg>
        </div>
        {{/if}}
        <div>
          {{#each result.scales}}
          ... существующая карточка шкалы, без изменений ...
          {{/each}}
        </div>
      </div>
```

Из этой разметки следует, что ядро (Task 2) обязано отдавать поля, которых нет в первой
редакции модуля: `width` и `height` (виджет не квадратный — 340×300), `cx` / `cy` у колец и
осей, `levelY`, `levelText` (метка уровня и значение одной строкой — «Умеренная · 6 из 25», при
квантовании только метка) и `quantizedClass` (пустая строка либо `tb-radar__dot--quantized`).
Их надо добавить в Task 2 вместе с тестами, а не собирать в разметке: DSL не склеивает строки
и не считает.

Карточки шкал заворачиваются в `<div>` — вторую колонку сетки. Внутри цикла ничего не меняется.
Многострочные подписи осей эскиз рисует через `tspan`; ядро отдаёт цельную строку, перенос
делает разметка только там, где он предусмотрен макетом.

- [ ] **Step 6: Проверить, что DSL не ломает строку координат**

Создать временный прогон рендера (в консоли Node не нужен — достаточно теста):

```bash
npm test -- shared/template/dsl.test.ts
```

Затем убедиться глазами: в собранной разметке `points="12,4 88,30 …"` кавычки и запятые не
экранированы. Если DSL экранирует, заменить биндинг `points="{{...polygonPoints}}"` на цикл
`{{#each axes}}` внутри `<polyline>` — контракт при этом не меняется, `polygonPoints` остаётся
для отчёта.

- [ ] **Step 7: Добавить стили**

В `server/scorm/templates/default/styles/theme.css` в конец компонентного слоя добавить:

Перенести слой «Дельта PRD-35» из эскиза дословно — он уже прошёл линтер
`node scripts/check-wireframes-ds.mjs` (0 нарушений в файле эскиза) и браузерную сверку:

```css
/* PRD-35. Радар компетенций: сбоку от карточек, на узком экране — над ними. */
.tb-measures--chart {
  display: grid;
  grid-template-columns: minmax(0, 360px) minmax(0, 1fr);
  gap: var(--ou-space-6);
  align-items: start;
}
.tb-radar { position: sticky; top: 0; }
.tb-radar__svg { width: 100%; height: auto; display: block; }
.tb-radar__ring,
.tb-radar__axis { fill: none; stroke: var(--ou-border-soft); stroke-width: 1px; }
.tb-radar__shape {
  fill: var(--ou-accent-default); fill-opacity: 0.16;
  stroke: var(--ou-accent-default); stroke-width: 2;
}
.tb-radar__dot { fill: hsl(var(--tb-zone)); stroke: var(--ou-bg-surface-2); stroke-width: 2; }
.tb-radar__label { fill: var(--ou-fg-default); font: var(--ou-text-body-s); }
.tb-radar__level { fill: var(--ou-fg-muted); font: var(--ou-text-body-xs); }
.tb-radar__dot--quantized { fill: var(--ou-bg-surface-2); stroke: hsl(var(--tb-zone)); }

@media (max-width: 860px) {
  .tb-measures--chart { grid-template-columns: 1fr; }
  .tb-radar { position: static; }
}
```

Два места, где легко ошибиться. Первое: токены ДС — это ГОТОВЫЕ цвета, а не тройки HSL,
поэтому прозрачность заливки задаётся `fill-opacity`, а не `hsl(... / .18)`; тройкой приходит
только цвет зоны через `--tb-zone`, как уже устроено в PRD-29. Второе: `:has()` не
используется намеренно — раскладку включает класс из ядра (`result.scalesBlockClass`), потому
что поддержка `:has()` зависит от движка, встроенного в LMS.

- [ ] **Step 8: Проверить экран в браузере**

Поднять второй экземпляр, чтобы не мешать чужой сессии, и пройти тест со шкалами:

```bash
PORT=8099 npm run dev
```

Открыть итоги попытки измерительного теста, сверить со скриншотом эскиза из Task 1.

- [ ] **Step 9: Commit**

```bash
git add server/scorm/templates/default/manifest.json \
        server/scorm/templates/default/layouts/results.html \
        server/scorm/templates/default/styles/theme.css \
        server/routes/attempts.ts server/services/result-context.ts \
        shared/template/results-blocks.ts server/__tests__/template-manifest-prd35.test.ts
git diff --cached --name-only
git commit -m "feat(prd-35): радар на экране итогов веб-хоста — настройка, разметка, стили"
```

---

## Task 5: Паритет со SCORM-пакетом

**Files:**

- Modify: `server/scorm/builders/test-json.ts` (передача настройки в `TEST_DATA`)
- Test: `tests/radar-parity.test.ts`

- [ ] **Step 1: Написать падающий тест паритета**

Создать `tests/radar-parity.test.ts` по образцу существующих `tests/*-port.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildResultContext } from "@shared/template/result-context";
import { buildRadarChart } from "@shared/template/radar-view";
import { LEVEL_SCHEMES } from "@shared/template/level-ramp";
import type { ScaleInterpretation } from "@shared/scales/interpretation";

function scale(domainMax: number, bandsAt: number[]): ScaleInterpretation {
  return {
    domainMin: 0,
    domainMax,
    valence: "higher_is_better",
    bands: bandsAt.map((min, i) => ({
      min,
      max: i + 1 < bandsAt.length ? bandsAt[i + 1] : domainMax,
      level: `l${i}`,
      label: `Уровень ${i}`,
    })),
  };
}

const axes = [
  { key: "a", name: "A", value: 40, visibility: "level_and_value" as const, interpretation: scale(45, [0, 15, 25]) },
  { key: "b", name: "B", value: 3, visibility: "level_and_value" as const, interpretation: scale(25, [0, 5, 10]) },
  { key: "c", name: "C", value: 20, visibility: "level_and_value" as const, interpretation: scale(40, [0, 28, 33]) },
];

describe("паритет радара", () => {
  it("контекст итогов и прямой вызов ядра дают идентичную геометрию", () => {
    const direct = buildRadarChart({ axes, ramp: LEVEL_SCHEMES.traffic });
    const ctx = buildResultContext(
      { correct: 0, totalQuestions: 3, earnedPoints: 0, totalPoints: 0, passed: false, topicResults: [] },
      "Тест",
      {
        measures: {
          ramp: LEVEL_SCHEMES.traffic,
          scaleKind: "band_ruler",
          indicatorKind: "label",
          showRadar: true,
          hasPassThreshold: false,
          indicators: [],
          scales: axes,
        },
      },
    );
    expect(ctx.result.scalesChart).toEqual(direct);
  });
});
```

- [ ] **Step 2: Запустить тест**

```bash
npm test -- tests/radar-parity.test.ts
```

Ожидается: PASS (ядро одно на оба хоста; тест закрепляет это как контракт).

- [ ] **Step 3: Прокинуть настройку в пакет**

В `server/scorm/builders/test-json.ts` найти место, где в `TEST_DATA` кладутся настройки
страницы результатов (там же, где `blockSettings` PRD-29), и добавить `showCompetencyRadar`
в тот же объект. Значение берётся из `settings_json` страницы `results`, без умолчания
`true` — отсутствие ключа означает «выключено».

- [ ] **Step 4: Собрать пакет и проверить в локальном плеере**

```bash
npm run scorm:sample
npm run scorm:player
```

Открыть `http://localhost:5050`, пройти тест до итогов, сверить радар с веб-экраном: расхождение
между хостами считается дефектом.

- [ ] **Step 5: Commit**

```bash
git add server/scorm/builders/test-json.ts tests/radar-parity.test.ts
git diff --cached --name-only
git commit -m "feat(prd-35): радар в SCORM-пакете и тест паритета хостов"
```

---

## Task 6: Материализация домена шкалы

Без этого шага у legacy-шкал домена нет, и радар молча не появится. Домен ЗАПИСЫВАЕТСЯ, а не
считается при отрисовке: иначе правка состава вопросов перерисовала бы уже сданную попытку.

**Files:**

- Modify: `server/services/scoring-config.ts` (расчёт достижимого диапазона уже есть — переиспользовать)
- Modify: `server/routes/scales.ts` (запись домена при сохранении шкалы)
- Modify: `server/services/test-snapshot.ts` (запись домена при публикации)
- Test: `tests/scale-domain-materialization.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { materializeDomain } from "@server/services/scoring-config";

describe("materializeDomain", () => {
  it("заполняет пустой домен расчётным диапазоном", () => {
    const config = { bands: [{ min: 0, max: 45, level: "l0" }] };
    expect(materializeDomain(config, { min: 0, max: 45 })).toEqual({
      ...config,
      domainMin: 0,
      domainMax: 45,
    });
  });

  it("не трогает домен, заданный автором", () => {
    const config = { domainMin: 0, domainMax: 60, bands: [] };
    expect(materializeDomain(config, { min: 0, max: 45 })).toEqual(config);
  });
});
```

- [ ] **Step 2: Запустить тест**

```bash
npm test -- tests/scale-domain-materialization.test.ts
```

Ожидается: FAIL — `materializeDomain` не экспортирована.

- [ ] **Step 3: Реализовать функцию**

В `server/services/scoring-config.ts` добавить:

```ts
/**
 * Writes the computed reachable range into a scale config that has none.
 *
 * Storing beats computing at render time: a scale whose domain is derived on every
 * draw silently shifts when a question is added to the test, and yesterday's attempt
 * would then render a different radar from the same answers (NFR-21).
 */
export function materializeDomain(
  config: Record<string, unknown>,
  reachable: { min: number; max: number },
): Record<string, unknown> {
  const hasMin = typeof config.domainMin === "number";
  const hasMax = typeof config.domainMax === "number";
  if (hasMin && hasMax) return config;
  return { ...config, domainMin: reachable.min, domainMax: reachable.max };
}
```

- [ ] **Step 4: Вызвать при сохранении и при публикации**

В обработчике сохранения шкалы (`server/routes/scales.ts`) применить `materializeDomain` к
`config_json` перед записью, используя уже существующий расчёт достижимого диапазона PRD-29.
В `server/services/test-snapshot.ts` — то же самое при сборке снимка, чтобы тесты, которые в
редакторе не открывали, получили домен к моменту публикации.

- [ ] **Step 5: Запустить тесты**

```bash
npm test -- tests/scale-domain-materialization.test.ts
npm test -- shared/scales/__tests__/interpretation.test.ts
```

Ожидается: PASS в обоих файлах.

- [ ] **Step 6: Commit**

```bash
git add server/services/scoring-config.ts server/routes/scales.ts \
        server/services/test-snapshot.ts tests/scale-domain-materialization.test.ts
git diff --cached --name-only
git commit -m "feat(prd-35): материализация домена шкалы при сохранении и публикации"
```

---

## Task 7: Редактор — переключатель и объяснение автору

**Как это вышло на деле** (правка по итогам исполнения, 2026-08-01):

- отдельный контрол писать не понадобилось: булево свойство варианта уже рисуется
  `Switch`-ем в `start-pages-section.tsx` — там же живёт форма страницы структуры;
- вместо динамической подсказки «видимых шкал меньше трёх» показывается `description`
  свойства из манифеста. Причина: форма страницы (`PageEditForm`) отделена от модели
  теста семью вызовами `SystemPageRow`, и проброс числа шкал через них ради одной
  фразы стоит дороже, чем даёт. Условие при этом автор ВИДИТ — оно напечатано под
  переключателем; отказ перед учеником остаётся молчаливым, как требует §6;
- баннер «домен не задан, будет вычислен» не нужен: после Task 6 сервер записывает
  домен сам — при сохранении шкалы, при правке вкладов и при публикации. Ситуация,
  ради которой баннер задумывался, больше не наступает.

**Files:**

- Modify: `client/src/features/tests/editor/sections/start-pages-section.tsx` (показ `description` у булева свойства)
- Modify: `client/src/features/tests/editor/use-content-pages.ts` (поле `description` в типе свойства)
- Test: `client/src/features/tests/editor/sections/__tests__/setting-description.test.tsx`

- [ ] **Step 1: Написать падающий тест**

```tsx
import { describe, expect, it } from "vitest";
import { radarWarning } from "../radar-toggle";

describe("radarWarning", () => {
  it("молчит, когда видимых шкал хватает", () => {
    expect(radarWarning(true, 3)).toBe("");
  });

  it("объясняет автору отказ при двух шкалах", () => {
    expect(radarWarning(true, 2)).toContain("менее трёх");
  });

  it("молчит при выключенном переключателе", () => {
    expect(radarWarning(false, 1)).toBe("");
  });
});
```

- [ ] **Step 2: Запустить тест**

```bash
npm test -- client/src/features/tests/editor/sections/__tests__/radar-toggle.test.tsx
```

Ожидается: FAIL — модуля нет.

- [ ] **Step 3: Реализовать чистую функцию предупреждения**

Создать `client/src/features/tests/editor/sections/radar-toggle.ts`:

```ts
/**
 * @module features/tests/editor/sections/radar-toggle
 *
 * The author-facing half of the radar's feasibility rule. The learner gets a silent
 * fallback (PRD-29 §6.4); the author must be told why the chart will not appear,
 * otherwise an empty results block reads as a bug.
 */

/** Empty string means "nothing to say" — the caller renders no banner. */
export function radarWarning(enabled: boolean, visibleScales: number): string {
  if (!enabled) return "";
  if (visibleScales >= 3) return "";
  return "Радар не будет нарисован: видимых шкал менее трёх.";
}
```

- [ ] **Step 4: Подключить переключатель в структуре**

Настройки страницы `results` уже рисуются из манифеста (`settings[]`), поэтому отдельного
контрола писать не нужно: булево поле появится автоматически. Добавить рядом с ним вывод
`radarWarning(...)` — считать число видимых шкал из состояния редактора (шкалы с видимостью не
`hidden`). Использовать React-компоненты ui-kit, не писать `ou-*` руками.

- [ ] **Step 5: Добавить баннер про домен в редакторе шкал**

В `scales-section.tsx` для шкалы с пустым доменом показать подсказку с расчётным значением и
кнопкой подстановки: «Домен не задан, будет вычислен автоматически как 0..45». Расчёт уже есть
в PRD-29 (предзаполнение по вкладам вопросов) — переиспользовать его, не дублируя.

- [ ] **Step 6: Запустить тесты**

```bash
npm test -- client/src/features/tests/editor/sections/__tests__/radar-toggle.test.tsx
npm test -- client/src/features/tests/editor/sections/__tests__/scales-section.coverage.test.tsx
```

Ожидается: PASS в обоих файлах.

- [ ] **Step 7: Проверить в браузере**

Поднять `PORT=8099 npm run dev`, открыть редактор теста, включить радар в структуре, убедиться,
что предупреждение появляется на тесте с двумя шкалами и исчезает на тесте с тремя.

- [ ] **Step 8: Commit**

```bash
git add client/src/features/tests/editor/sections/radar-toggle.ts \
        client/src/features/tests/editor/sections/topics-structure-section.tsx \
        client/src/features/tests/editor/sections/scales-section.tsx \
        client/src/features/tests/editor/sections/__tests__/radar-toggle.test.tsx
git diff --cached --name-only
git commit -m "feat(prd-35): переключатель радара в структуре и подсказка про домен"
```

---

## Task 8: Радар в PDF-отчёте

Сегодня `buildReportContext` вызывает `buildResultContext(input.result, …)` БЕЗ `measures`
(`shared/report/report-context.ts:178`), поэтому шкал в отчёте нет вовсе. Радар в отчёте требует
прокинуть измерения до этого вызова.

**Files:**

- Modify: `shared/report/report-context.ts` (~строка 178)
- Modify: `server/scorm/templates/default/manifest.json` (варианты `report.standard`, `report.adaptive.standard`)
- Modify: `server/scorm/templates/default/layouts/report.html` и `report-adaptive.html`
- Test: `shared/report/__tests__/report-radar.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { buildReportContext } from "../report-context";
import { LEVEL_SCHEMES } from "../../template/level-ramp";
import type { ScaleInterpretation } from "../../scales/interpretation";

function scale(domainMax: number, bandsAt: number[]): ScaleInterpretation {
  return {
    domainMin: 0,
    domainMax,
    valence: "higher_is_better",
    bands: bandsAt.map((min, i) => ({
      min,
      max: i + 1 < bandsAt.length ? bandsAt[i + 1] : domainMax,
      level: `l${i}`,
      label: `Уровень ${i}`,
    })),
  };
}

const measures = {
  ramp: LEVEL_SCHEMES.traffic,
  scaleKind: "band_ruler" as const,
  indicatorKind: "label" as const,
  showRadar: true,
  hasPassThreshold: false,
  indicators: [],
  scales: [
    { key: "a", name: "A", value: 40, visibility: "level_and_value" as const, interpretation: scale(45, [0, 15, 25]) },
    { key: "b", name: "B", value: 3, visibility: "level_and_value" as const, interpretation: scale(25, [0, 5, 10]) },
    { key: "c", name: "C", value: 20, visibility: "level_and_value" as const, interpretation: scale(40, [0, 28, 33]) },
  ],
};

const input = {
  testName: "Тест",
  result: { correct: 0, totalQuestions: 3, earnedPoints: 0, totalPoints: 0, passed: false, topicResults: [] },
};

describe("отчёт: радар", () => {
  it("получает диаграмму, когда измерения переданы", () => {
    const ctx = buildReportContext({ ...input, measures } as never);
    expect(ctx.result.scalesChart?.axes).toHaveLength(3);
  });

  it("остаётся без диаграммы, когда измерений нет", () => {
    const ctx = buildReportContext(input as never);
    expect(ctx.result.scalesChart).toBeUndefined();
  });
});
```

- [ ] **Step 2: Запустить тест**

```bash
npm test -- shared/report/__tests__/report-radar.test.ts
```

Ожидается: FAIL — `measures` не входит в `ReportInput`, диаграмма не собирается.

- [ ] **Step 3: Прокинуть измерения в контекст отчёта**

В `shared/report/report-context.ts` добавить в `ReportInput` необязательное поле
`measures?: MeasuresInput` (тип импортировать из `../template/result-context`) и передать его в
вызов на строке 178:

```ts
  const base = buildResultContext(input.result, input.testName || "", {
    withTopicPoints: true,
    ...(input.measures ? { measures: input.measures } : {}),
  });
```

- [ ] **Step 4: Объявить переключатель у видов отчёта**

В манифесте у вариантов `report.standard` и `report.adaptive.standard` добавить то же поле
`showCompetencyRadar` (`boolean`, `default: false`), что и у `results.standard` в Task 4. Он
НЕЗАВИСИМ от экранного: отчёт уносят специалисту, и профиль там уместен даже тогда, когда на
экране его не показывают.

- [ ] **Step 5: Добавить разметку в макеты отчёта**

Вставить в `report.html` и `report-adaptive.html` тот же SVG-фрагмент, что и в Task 4 Step 5,
внутри `{{#if result.scalesChart}}`. Отчёт печатается, поэтому интерактива в нём нет по
построению — фрагмент переносится без изменений.

- [ ] **Step 6: Прокинуть measures у вызывающих сторон**

Передать `measures` в `buildReportContext` из трёх мест:
`client/src/features/learner/attempt-report.ts:115`,
`client/src/features/tests/editor/sections/report-preview-modal.tsx:99` и
`shared/template/smoke-runner.ts:258`. В предпросмотре и smoke-прогоне взять измерения из того же
источника, из которого они собираются для экрана итогов.

- [ ] **Step 7: Запустить тесты**

```bash
npm test -- shared/report/__tests__/report-radar.test.ts
npm test -- tests/report-layout-parity.test.ts
```

Ожидается: PASS в обоих файлах.

- [ ] **Step 8: Проверить PDF**

Скачать отчёт по попытке измерительного теста и убедиться, что радар присутствует, не
растеризован в мыло и не разрезан границей страницы.

- [ ] **Step 9: Commit**

```bash
git add shared/report/report-context.ts shared/report/__tests__/report-radar.test.ts \
        server/scorm/templates/default/manifest.json \
        server/scorm/templates/default/layouts/report.html \
        server/scorm/templates/default/layouts/report-adaptive.html \
        client/src/features/learner/attempt-report.ts \
        client/src/features/tests/editor/sections/report-preview-modal.tsx \
        shared/template/smoke-runner.ts
git diff --cached --name-only
git commit -m "feat(prd-35): радар в PDF-отчёте — измерения в контексте отчёта и разметка"
```

---

## Task 9: Приёмка

**Files:**

- Create: `docs/reports/prd35-radar-acceptance.md`

- [ ] **Step 1: Импортировать референсную методику**

Импортировать `docs/references/workbook_Выгорание_Маслач (1).xlsx`, дозаполнить домен и
толкования, включить радар на экране итогов и в отчёте.

- [ ] **Step 2: Пройти проверки списком**

Проверить и зафиксировать результат каждой строки:

| Проверка | Ожидание |
| --- | --- |
| Три шкалы Маслача | Радар из трёх осей |
| Шкала `reduced_personal_accomplishment` | Окрашена противоположно двум другим при одной схеме |
| Шкала с видимостью «уровень без значения» | Луч квантован, значения в подписи нет |
| Тест с двумя шкалами | Радара нет, карточки на месте, предупреждение автору есть |
| Тест без шкал | Экран как до изменений |
| Переключатель выключен | Радара нет ни на экране, ни в отчёте |
| SCORM-пакет в локальном плеере | Та же картинка, что в вебе |
| PDF-отчёт | Радар присутствует и читаем |

- [ ] **Step 3: Провести браузерную приёмку**

Фронтенд принимается в реальном браузере (CDP либо Playwright), а не модульными тестами и
`npm run check`. Скриншоты класть в `.playwright-mcp/`, не в корень репозитория.

- [ ] **Step 4: Запросить разрешение на полный прогон**

Полный `npm test` и `npm run test:cov` запускать ТОЛЬКО после явного разрешения владельца:
покрытие чистит общий каталог и ломает параллельные сессии.

- [ ] **Step 5: Записать отчёт о приёмке**

Создать `docs/reports/prd35-radar-acceptance.md` с таблицей из шага 2, ссылками на скриншоты и
явной пометкой, какие проверки не выполнялись и почему (выгрузка в WebTutor недоступна).

- [ ] **Step 6: Актуализировать статус трека**

В `docs/ROADMAP.md` перевести PRD-35 из «НЕ НАЧАТ» в «РЕАЛИЗОВАН» с перечнем закрытых задач. В
BRD пометить Этап 29 как выполненный. Коммитить эти файлы ОТДЕЛЬНО и только после сверки
`git diff --cached --name-only`: в них регулярно лежат незакоммиченные правки других сессий.

- [ ] **Step 7: Commit**

```bash
git add docs/reports/prd35-radar-acceptance.md
git diff --cached --name-only
git commit -m "docs(prd-35): отчёт о приёмке радара компетенций"
```
