# PRD-47: план реализации — измерения и диаграмма в отчёте

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Цель:** отчёт печатает блок измерений и диаграмму — одинаково в вебе и в SCORM-пакете, с
цветами шкал, заданными на экране итогов, и с честным «авто» для ипсативных методик; настройки
отчёта переезжают на вкладку «Оформление».

**Решение:** один сборщик входа отчёта в `shared/report`, два поставщика данных (хосты).
Хранение настроек не меняется, PRD-27 §4.2 в силе. Требования — [спека
PRD-47](../specs/prd-47/report-scales-chart.md), решения владельца в её разделе 2.

**Ветка:** от `main`. Спека сверена с кодом 2026-08-08.

---

## Что план НЕ делает

- Печать (ч/б, разбиение страниц, узоры) — решение владельца 2.3, вне рамок.
- Своя настройка «показывать блок шкал» у отчёта — решение 2.6, не нужна.
- Перенос хранения полей отчёта в `design_settings_json` — решение 2.5, переезжает только
  интерфейс.

## Карта файлов

| Файл | Ответственность |
| --- | --- |
| `shared/report/report-measures.ts` (создать) | ЕДИНСТВЕННОЕ место, где вход экрана превращается во вход отчёта |
| `shared/report/__tests__/report-measures.test.ts` (создать) | Тесты этого превращения |
| `client/src/features/learner/attempt-report.ts` | Веб зовёт сборщик вместо своей сборки `chartSettings` |
| `server/services/scale-composition.ts` | Guard ипсативности учитывает обе настройки |
| `server/routes/attempts.ts` | Передаёт в guard настройки отчёта |
| `server/scorm/template/app/utils/pdfExport.js` | Пакет передаёт измерения в отчёт |
| `shared/template/preview-context.ts` | Контракт демо-набора получает измерения |
| `server/scorm/templates/default/demo/course.json` | Демо-измерения поставляемого шаблона |
| `shared/report/report-preview.ts`, `shared/template/smoke-runner.ts` | Предпросмотр и смоук читают демо-измерения |
| `client/src/features/tests/editor/sections/design-section.tsx` | Пункт рейла «Отчёт о результатах» |
| `client/src/features/tests/editor/sections/basic-settings-section.tsx` | Карточка уходит отсюда |

## Порядок и почему он такой

Срез A даёт ядро и чинит веб — после него автор уже видит свои цвета в отчёте. Срез B тянет то
же в пакет. Срез C возвращает предпросмотр. Срез D двигает интерфейс. Каждый срез самодостаточен
и коммитится отдельно.

---

## Срез A. Вход отчёта собирается одним местом

### Задача A1: сборщик `buildReportMeasures`

**Файлы:**

- Создать: `shared/report/report-measures.ts`
- Создать: `shared/report/__tests__/report-measures.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
/**
 * @module shared/report/__tests__/report-measures
 *
 * PRD-47 §5.1: вход отчёта делается ИЗ входа экрана, а не собирается заново. Правило:
 * вид, предел оси и переключатель радара берутся из полей варианта ОТЧЁТА, всё
 * остальное в `chartSettings` — с экрана. Облик шкал колонки в отчёте не имеет и обязан
 * приехать оттуда, иначе профиль в двух документах окажется разного цвета.
 */
import { describe, expect, it } from "vitest";

import { buildReportMeasures } from "../report-measures";
import type { MeasuresInput } from "../../template/result-context";

const SCREEN: MeasuresInput = {
  ramp: "traffic",
  scaleKind: "band_ruler",
  indicatorKind: "label",
  scales: [],
  indicators: [],
  chartSettings: {
    scalesChartKind: "rose",
    radarAxisLimit: "attempt",
    scaleAppearance: { cel: { color: "210 60% 50%", icon: "target" } },
  },
  ipsativeScales: true,
};

describe("buildReportMeasures", () => {
  it("берёт вид, предел оси и переключатель радара из полей отчёта", () => {
    const out = buildReportMeasures(SCREEN, {
      scalesChartKind: "radar",
      radarAxisLimit: "domain",
      showCompetencyRadar: true,
    });

    expect(out.chartSettings?.scalesChartKind).toBe("radar");
    expect(out.chartSettings?.radarAxisLimit).toBe("domain");
    expect(out.chartSettings?.showCompetencyRadar).toBe(true);
  });

  it("переносит облик шкал с экрана — своей колонки у отчёта нет", () => {
    const out = buildReportMeasures(SCREEN, { scalesChartKind: "radar" });

    expect(out.chartSettings?.scaleAppearance).toEqual({
      cel: { color: "210 60% 50%", icon: "target" },
    });
  });

  it("не трогает измерения и признак ипсативности", () => {
    const out = buildReportMeasures(SCREEN, { scalesChartKind: "none" });

    expect(out.scales).toBe(SCREEN.scales);
    expect(out.indicators).toBe(SCREEN.indicators);
    expect(out.ipsativeScales).toBe(true);
  });

  it("пустые поля отчёта не подменяются экранными: отчёт задаёт вид сам", () => {
    // Иначе тест, где автор сознательно выключил диаграмму в отчёте, начал бы её печатать.
    const out = buildReportMeasures(SCREEN, {});

    expect(out.chartSettings?.scalesChartKind).toBeUndefined();
    expect(out.chartSettings?.showCompetencyRadar).toBe(false);
    // …а облик всё равно приезжает: он не про выбор вида.
    expect(out.chartSettings?.scaleAppearance).toBeTruthy();
  });

  it("экранный вход не мутируется", () => {
    const before = JSON.stringify(SCREEN);
    buildReportMeasures(SCREEN, { scalesChartKind: "radar" });
    expect(JSON.stringify(SCREEN)).toBe(before);
  });
});
```

- [ ] **Шаг 2. Прогнать и убедиться, что падает**

Запуск: `npm test -- shared/report/__tests__/report-measures.test.ts`
Ожидание: FAIL, `Failed to resolve import "../report-measures"`.

- [ ] **Шаг 3. Написать сборщик**

```ts
/**
 * @module shared/report/report-measures
 *
 * PRD-47 §5.1. Превращает вход измерений ЭКРАНА во вход измерений ОТЧЁТА.
 *
 * Оба хоста уже умеют собирать вход экрана — веб в `server/services/result-context.ts`,
 * пакет в `render/viewResults.js`. Отчёту нужен тот же набор данных и ДРУГИЕ настройки
 * диаграммы: у него свой переключатель вида (PRD-35 §9). Собирать вход заново на каждом
 * хосте значит держать две сборки синхронными руками — этот продукт уже трижды платил за
 * такие пары.
 *
 * Что берётся откуда:
 * - вид, предел оси, переключатель радара — из полей варианта ОТЧЁТА;
 * - облик шкал (цвет и пиктограмма) — с ЭКРАНА: колонки у отчёта нет и не будет,
 *   покраска не свойство страницы (решение владельца 2.2);
 * - измерения, шкала уровней, признак ипсативности — с экрана без изменений.
 */
import type { MeasuresInput } from "../template/result-context";
import type { ChartKindSettings } from "../template/scales-chart";

/** Поля варианта отчёта, как их отдаёт `resolveReportBake`. */
export interface ReportChartValues {
  scalesChartKind?: unknown;
  radarAxisLimit?: unknown;
  showCompetencyRadar?: unknown;
}

/**
 * @param screen Вход измерений экрана итогов этого же прогона.
 * @param values Значения полей варианта отчёта (уже слитые с умолчаниями манифеста).
 */
export function buildReportMeasures(
  screen: MeasuresInput,
  values: ReportChartValues,
): MeasuresInput {
  const chartSettings: ChartKindSettings = {
    // Облик — первым: он приходит с экрана и не должен зависеть от порядка полей отчёта.
    ...(screen.chartSettings ?? {}),
    scalesChartKind: values.scalesChartKind as ChartKindSettings["scalesChartKind"],
    radarAxisLimit: values.radarAxisLimit as ChartKindSettings["radarAxisLimit"],
    showCompetencyRadar: values.showCompetencyRadar === true,
  };
  return { ...screen, chartSettings };
}
```

- [ ] **Шаг 4. Прогнать — зелено**

Запуск: `npm test -- shared/report/__tests__/report-measures.test.ts`
Ожидание: PASS, 5 тестов.

- [ ] **Шаг 5. Коммит**

```bash
git add shared/report/report-measures.ts shared/report/__tests__/report-measures.test.ts
git commit -m "feat(prd-47): вход отчёта делается из входа экрана одним сборщиком"
```

### Задача A2: веб-отчёт зовёт сборщик

**Файлы:**

- Изменить: `client/src/features/learner/attempt-report.ts:116-134`
- Изменить: `client/src/features/learner/__tests__/attempt-report.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

Дописать в существующий `describe("downloadAttemptReport", …)`:

```ts
  it("несёт облик шкал с экрана в отчёт (PRD-47 §4.2)", async () => {
    const { downloadAttemptReport } = await import("../attempt-report");
    const measures = {
      ramp: "traffic",
      scaleKind: "band_ruler",
      indicatorKind: "label",
      scales: [],
      indicators: [],
      chartSettings: { scaleAppearance: { cel: { color: "210 60% 50%" } } },
    };
    await downloadAttemptReport(
      standardReport as never,
      { ...render, values: { scalesChartKind: "rose" } } as never,
      measures as never,
    );
    const opts = buildReportContextMock.mock.calls[0][1];
    expect(opts.measures.chartSettings.scaleAppearance).toEqual({ cel: { color: "210 60% 50%" } });
    expect(opts.measures.chartSettings.scalesChartKind).toBe("rose");
  });
```

Если в файле нет мока `buildReportContext`, добавить его рядом с существующими моками:

```ts
const { buildReportContextMock } = vi.hoisted(() => ({ buildReportContextMock: vi.fn(() => ({})) }));
vi.mock("@shared/report/report-context", () => ({
  buildReportContext: buildReportContextMock,
  buildAdaptiveReportContext: buildReportContextMock,
}));
```

- [ ] **Шаг 2. Прогнать и убедиться, что падает**

Запуск: `npm test -- client/src/features/learner/__tests__/attempt-report.test.ts`
Ожидание: FAIL — `scaleAppearance` в переданных настройках `undefined`: сегодня хост строит
`chartSettings` с нуля и облик теряет.

- [ ] **Шаг 3. Заменить ручную сборку вызовом**

Было (строки 116-134):

```ts
  const opts = {
    values,
    design: render.design,
    ...(measures
      ? {
          measures: {
            ...measures,
            chartSettings: {
              scalesChartKind: values.scalesChartKind as never,
              showCompetencyRadar: values.showCompetencyRadar === true,
              radarAxisLimit: values.radarAxisLimit,
            },
          },
        }
      : {}),
  };
```

Стало:

```ts
  const opts = {
    values,
    design: render.design,
    // PRD-47 §5.1: вход отчёта делает ОДИН сборщик, общий с пакетом. Своя сборка здесь
    // теряла облик шкал: она строила `chartSettings` с нуля, а карта цвета и пиктограмм
    // приезжает с экрана и колонки в отчёте не имеет.
    ...(measures ? { measures: buildReportMeasures(measures, values) } : {}),
  };
```

Импорт рядом с соседними:

```ts
import { buildReportMeasures } from "@shared/report/report-measures";
```

- [ ] **Шаг 4. Прогнать — зелено**

Запуск: `npm test -- client/src/features/learner/__tests__/attempt-report.test.ts`
Ожидание: PASS, включая существовавшие тесты (они проверяли `showRadar`/вид — сборщик их
поведение сохраняет).

- [ ] **Шаг 5. Коммит**

```bash
git add client/src/features/learner/attempt-report.ts \
        client/src/features/learner/__tests__/attempt-report.test.ts
git commit -m "fix(prd-47): облик шкал доезжает из экрана в веб-отчёт"
```

### Задача A3: «авто» в отчёте перестаёт врать

**Файлы:**

- Изменить: `server/services/scale-composition.ts:96-104`
- Изменить: `server/routes/attempts.ts:210-234`
- Изменить: `server/__tests__/scale-composition.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

Дописать в `server/__tests__/scale-composition.test.ts`:

```ts
  it("считает признак, когда «авто» стоит ТОЛЬКО в отчёте (PRD-47 §4.3)", async () => {
    // Экран называет вид явно, отчёт оставлен на «авто». Без этого признака отчёт
    // нарисует радар на ипсативной методике — расхождение двух хостов одного продукта.
    await expect(
      ipsativeScalesForDelivery(src, "t1", visible, { scalesChartKind: "rose" }, { scalesChartKind: "auto" }),
    ).resolves.toBe(true);
  });

  it("не считает, когда «авто» нет ни там, ни там", async () => {
    await expect(
      ipsativeScalesForDelivery(src, "t1", visible, { scalesChartKind: "rose" }, { scalesChartKind: "radar" }),
    ).resolves.toBe(false);
  });
```

- [ ] **Шаг 2. Прогнать и убедиться, что падает**

Запуск: `npm test -- server/__tests__/scale-composition.test.ts`
Ожидание: FAIL — пятый аргумент функция не принимает, первый тест даёт `false`.

- [ ] **Шаг 3. Расширить guard**

В `server/services/scale-composition.ts` заменить сигнатуру и первую проверку:

```ts
export async function ipsativeScalesForDelivery(
  src: CompositionSource,
  testId: string,
  scales: Scale[],
  settings: ChartKindSettings,
  reportSettings: ChartKindSettings = {},
): Promise<boolean> {
  // PRD-47 §5.3: «авто» в ЛЮБОЙ из двух настроек. Признак считается один раз на выдачу и
  // едет к обоим документам; считать его при генерации отчёта нельзя — в пакете отчёт
  // собирается на клиенте из запечённых данных, читать оттуда нечем.
  if (chartKindSetting(settings) !== "auto" && chartKindSetting(reportSettings) !== "auto") {
    return false;
  }
```

Обновить шапку функции: строку про guard «настройка ЭКРАНА равна `auto`» заменить на «`auto` в
настройке экрана ИЛИ отчёта», а абзац про известное расхождение — снять, он закрыт.

- [ ] **Шаг 4. Передать настройки отчёта из маршрута**

В `server/routes/attempts.ts` рядом с чтением `blockSettings`:

```ts
    // PRD-47 §5.3: у отчёта свой переключатель вида, и «авто» в нём требует того же
    // признака. `tests.report_settings_json` ветвится по РЕЖИМУ теста (не по виду
    // манифеста), поэтому берём ветку своего режима. Умолчания манифеста здесь не нужны:
    // на «авто» они не ставятся, а отсутствие ветки означает вариант по умолчанию.
    const reportBranch =
      deliveredTest?.mode === "adaptive"
        ? deliveredTest?.reportSettingsJson?.adaptive
        : deliveredTest?.reportSettingsJson?.standard;
    const reportChartSettings = (reportBranch?.values ?? {}) as ChartKindSettings;
```

Импорт типа, если его в файле ещё нет:

```ts
import type { ChartKindSettings } from "@shared/template/scales-chart";
```

и в вызове:

```ts
      ipsativeScales: await ipsativeScalesForDelivery(
        src,
        attempt.testId,
        scales,
        blockSettings,
        reportChartSettings,
      ),
```

- [ ] **Шаг 5. Прогнать оба сьюта**

Запуск: `npm test -- server/__tests__/scale-composition.test.ts tests/routes.attempts.test.ts`
Ожидание: PASS. Если файла `tests/routes.attempts.test.ts` нет — прогнать `npm test -- server/__tests__`.

- [ ] **Шаг 6. Коммит**

```bash
git add server/services/scale-composition.ts server/routes/attempts.ts \
        server/__tests__/scale-composition.test.ts
git commit -m "fix(prd-47): «авто» в отчёте получает признак ипсативности"
```

---

## Срез B. Пакет догоняет веб

Выпечка признак ипсативности уже считает БЕЗУСЛОВНО (`server/scorm/build-export-data.ts:117`),
поэтому в пакете правится ровно одно: отчёт не получает измерений.

### Задача B1: пакет передаёт измерения в отчёт

**Файлы:**

- Изменить: `server/scorm/template/app/utils/pdfExport.js:226-233`
- Изменить: `shared/template/runtime-entry.ts` (экспорт сборщика в бандл)
- Изменить: `tests/scorm-runtime-exports.test.ts` (если файла нет — создать по образцу ниже)

- [ ] **Шаг 1. Написать падающий тест на экспорт из бандла**

```ts
/**
 * @module tests/scorm-runtime-exports
 *
 * Пакетный рантайм умеет только то, что бандл `TBTemplate` ему отдал. Отчёт в пакете
 * собирает вход измерений тем же сборщиком, что веб (PRD-47 §5.1), поэтому сборщик обязан
 * быть в экспортах — иначе `pdfExport.js` молча соберёт отчёт без диаграммы.
 */
import { describe, expect, it } from "vitest";

import * as runtime from "../shared/template/runtime-entry";

describe("экспорты рантайма пакета", () => {
  it("отдают сборщик входа отчёта", () => {
    expect(typeof runtime.buildReportMeasures).toBe("function");
  });
});
```

- [ ] **Шаг 2. Прогнать и убедиться, что падает**

Запуск: `npm test -- tests/scorm-runtime-exports.test.ts`
Ожидание: FAIL — `expected "undefined" to be "function"`.

- [ ] **Шаг 3. Добавить экспорт**

В `shared/template/runtime-entry.ts` рядом со строкой 209-210:

```ts
export { buildReportMeasures } from "../report/report-measures";
```

- [ ] **Шаг 4. Прогнать — зелено**

Запуск: `npm test -- tests/scorm-runtime-exports.test.ts`
Ожидание: PASS.

- [ ] **Шаг 5. Научить `pdfExport.js` передавать измерения**

Было (строки 226-233):

```js
    var opts = {
      design: (typeof scormDesignContext === 'function') ? scormDesignContext() : {},
      // Значения полей варианта — те, что автор задал в блоке обратной связи (FR-16).
      values: pdfImageValues
    };
```

Стало:

```js
    var opts = {
      design: (typeof scormDesignContext === 'function') ? scormDesignContext() : {},
      // Значения полей варианта — те, что автор задал в блоке обратной связи (FR-16).
      values: pdfImageValues
    };
    // PRD-47 §4.1: без этого отчёт в LMS печатался без блока измерений ЦЕЛИКОМ — не без
    // одной фигуры. Вход экрана уже собран рантаймом; в отчётный его превращает тот же
    // сборщик, что на вебе, поэтому вид берётся из полей отчёта, а облик шкал — с экрана.
    var screenMeasures = (typeof currentAttemptMeasures === 'function')
      ? currentAttemptMeasures(results)
      : null;
    if (screenMeasures && TB && typeof TB.buildReportMeasures === 'function') {
      opts.measures = TB.buildReportMeasures(screenMeasures, pdfImageValues || {});
    }
```

Проверить, что переменная `TB` в этой функции определена; если нет — взять её тем же способом,
что соседний код: `var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;`.

- [ ] **Шаг 6. Собрать пакет и проверить руками**

```bash
npm run scorm:sample
npm run scorm:player
```

Ожидание: в собранном пакете пройти тест со шкалами, скачать отчёт — в PDF есть блок измерений
и та же фигура, что на экране итогов. Тест без шкал отчёт не меняет.

- [ ] **Шаг 7. Коммит**

```bash
git add shared/template/runtime-entry.ts tests/scorm-runtime-exports.test.ts \
        server/scorm/template/app/utils/pdfExport.js
git commit -m "fix(prd-47): отчёт в SCORM-пакете получает измерения и диаграмму"
```

---

## Срез C. Предпросмотр и смоук показывают измерения

### Задача C1: демо-набор получает измерения

**Файлы:**

- Изменить: `shared/template/preview-context.ts:102-122`
- Изменить: `server/scorm/templates/default/demo/course.json`
- Создать: `shared/template/__tests__/preview-context.test.ts` (файла нет — проверено 2026-08-08)

- [ ] **Шаг 1. Написать падающий тест**

Новый файл целиком:

```ts
/**
 * @module shared/template/__tests__/preview-context
 *
 * PRD-47 §5.4: демо-набор шаблона — ЕДИНСТВЕННЫЙ источник измерений для обоих
 * предпросмотров. Вторая выдумка специально для отчёта разошлась бы со страничной, и
 * автор сверял бы два разных вымысла.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { PreviewDemoDataset } from "../preview-context";

/** Демо-набор поставляемого шаблона — тот же файл, что читает предпросмотр страниц. */
function demoDataset(): PreviewDemoDataset {
  return JSON.parse(
    readFileSync("server/scorm/templates/default/demo/course.json", "utf8"),
  ) as PreviewDemoDataset;
}

describe("демо-набор шаблона", () => {
  it("несёт измерения для экрана итогов и отчёта (PRD-47 §5.4)", () => {
    const demo = demoDataset();

    expect(demo.runtime?.measures?.scales?.length).toBeGreaterThanOrEqual(2);
    expect(demo.runtime?.measures?.scales?.[0]).toHaveProperty("interpretation");
  });

  it("даёт шкалам домен, иначе линейка и диаграмма нарисуются пустыми", () => {
    const first = demoDataset().runtime!.measures!.scales[0];

    expect(first.interpretation.domainMax).toBeGreaterThan(0);
    expect(first.value).not.toBeNull();
  });
});
```

- [ ] **Шаг 2. Прогнать и убедиться, что падает**

Запуск: `npm test -- shared/template/__tests__/preview-context.test.ts`
Ожидание: FAIL — `runtime.measures` в наборе нет, и типа тоже.

- [ ] **Шаг 3. Расширить контракт**

В `shared/template/preview-context.ts` в `PreviewDemoDataset.runtime`:

```ts
  runtime?: {
    result?: Record<string, unknown>;
    sectionResult?: Record<string, unknown>;
    progress?: Record<string, unknown>;
    /**
     * PRD-47 §5.4: демо-измерения для предпросмотра — блок шкал, показателей и диаграммы.
     * Живут здесь, а не в отдельном файле отчёта: предпросмотр СТРАНИЦЫ итогов и
     * предпросмотр ОТЧЁТА обязаны показывать одно и то же, иначе автор сверяет два разных
     * вымысла. Форма — `MeasuresInput` шаблонного ядра.
     */
    measures?: MeasuresInput;
  };
```

Импорт типа — из `./result-context`.

- [ ] **Шаг 4. Положить демо-измерения в поставляемый шаблон**

В `server/scorm/templates/default/demo/course.json` в объект `runtime` добавить:

```json
"measures": {
  "ramp": "traffic",
  "scaleKind": "band_ruler",
  "indicatorKind": "label",
  "hasPassThreshold": true,
  "ipsativeScales": false,
  "chartSettings": { "scalesChartKind": "radar", "radarAxisLimit": "domain" },
  "scales": [
    {
      "key": "demo_focus",
      "name": "Ориентация на результат",
      "value": 34,
      "visibility": "level_and_value",
      "interpretation": {
        "domainMin": 0,
        "domainMax": 50,
        "displayMax": null,
        "valence": "higher_is_better",
        "bands": [
          { "min": 0, "max": 24, "level": "low", "label": "Низкий" },
          { "min": 25, "max": 50, "level": "high", "label": "Высокий" }
        ]
      }
    },
    {
      "key": "demo_team",
      "name": "Работа в команде",
      "value": 18,
      "visibility": "level_and_value",
      "interpretation": {
        "domainMin": 0,
        "domainMax": 50,
        "displayMax": null,
        "valence": "higher_is_better",
        "bands": [
          { "min": 0, "max": 24, "level": "low", "label": "Низкий" },
          { "min": 25, "max": 50, "level": "high", "label": "Высокий" }
        ]
      }
    }
  ],
  "indicators": []
}
```

- [ ] **Шаг 5. Прогнать — зелено**

Запуск: `npm test -- shared/template/__tests__/preview-context.test.ts`
Ожидание: PASS.

- [ ] **Шаг 6. Коммит**

```bash
git add shared/template/preview-context.ts server/scorm/templates/default/demo/course.json \
        shared/template/__tests__/preview-context.test.ts
git commit -m "feat(prd-47): демо-набор шаблона несёт измерения для предпросмотра"
```

### Задача C2: предпросмотр отчёта и смоук читают демо-измерения

**Файлы:**

- Изменить: `shared/template/smoke-runner.ts:275-290`
- Создать: `shared/report/__tests__/report-preview-measures.test.ts` (в каталоге сейчас только
  `report-radar.test.ts` — проверено 2026-08-08)

- [ ] **Шаг 0. Прочитать место вставки**

Прочитать `shared/template/smoke-runner.ts` вокруг строк 275-290 и выяснить ОДИН факт: доступен
ли демо-набор (`PreviewDemoDataset`) в той функции, где строится контекст отчёта. Он читается
для экранов, поэтому обычно рядом; если в этой функции его нет — протащить параметром от
вызывающего, не читая файл второй раз внутри.

Записать ответ в шаге 3: план не может знать имя локальной переменной, а угадывать его —
источник неверного кода.

- [ ] **Шаг 1. Написать падающий тест**

Новый файл целиком:

```ts
/**
 * @module shared/report/__tests__/report-preview-measures
 *
 * PRD-47 §5.4: у предпросмотра нет прогона, поэтому измерения ему даёт демо-набор
 * шаблона. Тест держит контракт «отчёт умеет принять измерения и довести их до
 * контекста» — без него предпросмотр молча остаётся без диаграммы, как это и было до
 * PRD-47.
 */
import { describe, expect, it } from "vitest";

import { buildReportContext } from "../report-context";
import { buildReportPreviewInput } from "../report-preview";
import type { MeasuresInput } from "../../template/result-context";

const DEMO_MEASURES: MeasuresInput = {
  ramp: "traffic",
  scaleKind: "band_ruler",
  indicatorKind: "label",
  scales: [
    {
      key: "demo_focus",
      name: "Ориентация на результат",
      value: 34,
      visibility: "level_and_value",
      interpretation: {
        domainMin: 0,
        domainMax: 50,
        displayMax: null,
        valence: "higher_is_better",
        bands: [{ min: 0, max: 50, level: "high", label: "Высокий" }],
      },
    },
  ],
  indicators: [],
  chartSettings: { scalesChartKind: "radar" },
};

describe("предпросмотр отчёта", () => {
  it("доводит демо-измерения до контекста (PRD-47 §5.4)", () => {
    const input = buildReportPreviewInput(
      { title: "Демо", sections: [{ topicId: "t1", topicName: "Тема", questionCount: 4 }] },
      "passed",
    );

    const context = buildReportContext(input as never, {
      values: { scalesChartKind: "radar" },
      isPreview: true,
      measures: DEMO_MEASURES,
    });

    expect(context.measures).toBeTruthy();
    expect(context.measures!.scales).toHaveLength(1);
  });
});
```

Сигнатуру `buildReportPreviewInput` сверить по файлу перед запуском: у неё два параметра —
описание теста и желаемый вердикт.

- [ ] **Шаг 2. Прогнать и убедиться, что падает**

Запуск: `npm test -- shared/report/__tests__/report-preview-measures.test.ts`
Ожидание: FAIL — `context.measures` не определён, потому что построитель их не получал.

- [ ] **Шаг 3. Прокинуть демо-измерения в смоук**

В `shared/template/smoke-runner.ts` в обеих ветках построения контекста отчёта добавить
`measures`, взяв демо-набор из переменной, найденной на шаге 0 (ниже она названа `demo`):

```ts
      const reportOpts = {
        values,
        isPreview: true,
        // PRD-47 §5.4: те же демо-измерения, что у экранов. Ветка `undefined` сохраняет
        // прежнее поведение для шаблонов, чей демо-набор измерений не объявил.
        ...(demo.runtime?.measures
          ? { measures: buildReportMeasures(demo.runtime.measures, values) }
          : {}),
      };
      const context = isAdaptive
        ? buildAdaptiveReportContext(buildAdaptiveReportPreviewInput(test, "failed"), reportOpts)
        : buildReportContext(buildReportPreviewInput(test, "failed"), reportOpts);
```

Импорт:

```ts
import { buildReportMeasures } from "../report/report-measures";
```

- [ ] **Шаг 4. Прогнать — зелено**

Запуск: `npm test -- shared/report/__tests__ shared/template/__tests__`
Ожидание: PASS.

- [ ] **Шаг 5. Коммит**

```bash
git add shared/report/report-preview.ts shared/template/smoke-runner.ts \
        shared/report/__tests__/report-preview.test.ts
git commit -m "feat(prd-47): предпросмотр отчёта и смоук показывают измерения"
```

### Задача C3: предпросмотр СТРАНИЦЫ итогов читает тот же набор

**Файлы:**

- Изменить: `shared/template/preview-context.ts` (`buildScreenInputs`)
- Изменить: `shared/template/__tests__/preview-context.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
  it("экран итогов в предпросмотре получает те же демо-измерения", () => {
    // Разные источники у двух предпросмотров означали бы, что автор сверяет два вымысла.
    const screens = buildScreenInputs(demoDataset, { templateId: "default" });
    const results = screens.find((s) => s.route === "results")!;

    expect(results.context.measures?.scales?.length).toBe(
      demoDataset.runtime!.measures!.scales.length,
    );
  });
```

- [ ] **Шаг 2. Прогнать и убедиться, что падает**

Запуск: `npm test -- shared/template/__tests__/preview-context.test.ts`
Ожидание: FAIL — `measures` в контексте экрана нет.

- [ ] **Шаг 3. Подать измерения в контекст экрана итогов**

`shared/template/preview-context.ts:576` — третий параметр `buildResultContext` это
`ResultContextOptions`, у которых уже есть поле `measures`. Было:

```ts
        : buildResultContext(resultInputFromRuntime(dataset), c.title);
```

Стало:

```ts
        : buildResultContext(resultInputFromRuntime(dataset), c.title, {
            // PRD-47 §5.4: тот же демо-набор, что получает отчёт. Отсутствие ключа
            // сохраняет прежний вид для шаблонов, чей демо-набор измерений не объявил.
            ...(dataset.runtime?.measures ? { measures: dataset.runtime.measures } : {}),
          });
```

- [ ] **Шаг 4. Прогнать — зелено**

Запуск: `npm test -- shared/template/__tests__/preview-context.test.ts`
Ожидание: PASS.

- [ ] **Шаг 5. Коммит**

```bash
git add shared/template/preview-context.ts shared/template/__tests__/preview-context.test.ts
git commit -m "feat(prd-47): предпросмотр страницы итогов показывает демо-измерения"
```

---

## Срез D. Настройки отчёта переезжают на «Оформление»

### Задача D1: пункт рейла «Отчёт о результатах»

**Файлы:**

- Изменить: `client/src/features/tests/editor/sections/design-section.tsx:87-152`
- Изменить: `client/src/features/tests/editor/sections/__tests__/design-section.test.tsx`

- [ ] **Шаг 1. Написать падающий тест**

```tsx
  it("показывает пункт «Отчёт о результатах» даже без объявленных видов (PRD-47 §6.2)", () => {
    // Прочие пункты прячутся при отсутствии параметров, этот — нет: отчёт есть у любого
    // теста, и при шаблоне без видов карточка объясняет, что он соберётся «Стандартным».
    render(<DesignSection {...propsWithTemplateWithoutParams} />);

    expect(screen.getByTestId("design-rail-report")).toBeInTheDocument();
  });

  it("блокирует пункт, пока шаблон не разрешён", () => {
    render(<DesignSection {...propsWithMissingTemplate} />);

    expect(screen.getByTestId("design-rail-report")).toBeDisabled();
  });
```

- [ ] **Шаг 2. Прогнать и убедиться, что падает**

Запуск: `npm test -- client/src/features/tests/editor/sections/__tests__/design-section.test.tsx`
Ожидание: FAIL — элемента с `design-rail-report` нет.

- [ ] **Шаг 3. Добавить пункт в рейл**

```ts
type DesignRailKey = "template" | "branding" | "colors" | "layout" | "progress" | "report";

const RAIL_ITEMS: { key: DesignRailKey; label: string }[] = [
  { key: "template", label: "Шаблон" },
  { key: "branding", label: "Брендирование" },
  { key: "colors", label: "Цвета" },
  { key: "layout", label: "Макет" },
  { key: "progress", label: "Прогресс и шапка" },
  // PRD-47 §6.2: отчёт — часть шаблона, поэтому его поля живут здесь, а не в общих
  // настройках теста. Хранение при этом не переезжает (PRD-27 §4.2).
  { key: "report", label: "Отчёт о результатах" },
];
```

В `visibleRail` пункт не фильтруется по параметрам:

```ts
    return RAIL_ITEMS.filter(
      (item) =>
        item.key === "template" ||
        // Отчёт есть у любого теста: даже когда шаблон не объявил видов, карточка
        // объясняет, что отчёт соберётся видом «Стандартный». Спрятать пункт значит
        // спрятать это объяснение.
        item.key === "report" ||
        paramsForRail(params, item.key).length > 0,
    );
```

- [ ] **Шаг 4. Прогнать — зелено**

Запуск: `npm test -- client/src/features/tests/editor/sections/__tests__/design-section.test.tsx`
Ожидание: PASS. Блокировка при нерешённом шаблоне работает уже существующей `isRailDisabled`.

- [ ] **Шаг 5. Коммит**

```bash
git add client/src/features/tests/editor/sections/design-section.tsx \
        client/src/features/tests/editor/sections/__tests__/design-section.test.tsx
git commit -m "feat(prd-47): пункт рейла «Отчёт о результатах» на вкладке «Оформление»"
```

### Задача D2: карточка переезжает

**Файлы:**

- Изменить: `client/src/features/tests/editor/sections/design-section.tsx`
- Изменить: `client/src/features/tests/editor/sections/basic-settings-section.tsx:354-378`
- Изменить: `client/src/features/tests/editor/sections/__tests__/basic-settings-section.test.tsx`

- [ ] **Шаг 1. Написать падающий тест**

```tsx
  it("не показывает карточку отчёта в «Основном» — она переехала на «Оформление»", () => {
    render(<BasicSettingsSection {...props} />);

    expect(screen.queryByTestId("report-settings-card")).not.toBeInTheDocument();
  });
```

и в тестах раздела оформления:

```tsx
  it("рисует карточку отчёта в своём пункте рейла", async () => {
    render(<DesignSection {...props} />);
    await userEvent.click(screen.getByTestId("design-rail-report"));

    expect(screen.getByTestId("report-settings-card")).toBeInTheDocument();
  });
```

- [ ] **Шаг 2. Прогнать и убедиться, что падают оба**

Запуск: `npm test -- client/src/features/tests/editor/sections/__tests__/basic-settings-section.test.tsx client/src/features/tests/editor/sections/__tests__/design-section.test.tsx`
Ожидание: FAIL — карточка ещё в «Основном» и ещё не в «Оформлении».

- [ ] **Шаг 3. Убрать карточку из «Основного»**

Из `basic-settings-section.tsx` удалить импорт `ReportSettingsCard`, блок её вызова (строки
354-378) и предшествующий ему `<hr className="wf-sep" />`. Ничего взамен не вставлять: раздел
заканчивается блоком сценария прохождения.

- [ ] **Шаг 4. Вставить карточку в раздел оформления**

В `design-section.tsx` в теле раздела, рядом с ветками остальных пунктов рейла, добавить ветку
пункта `report` с ТЕМ ЖЕ вызовом, что стоял в «Основном»:

```tsx
      {effectiveActive === "report" && (
        <ReportSettingsCard
          mode={model.mode}
          draftTemplateId={draftTemplateId}
          designParams={draftDesignParams}
          value={model.report ?? {}}
          onChange={(next) => updateModel((m) => ({ ...m, report: next }))}
          testName={model.basic.title}
          sections={model.sections.map((s) => ({
            topicId: s.topicId,
            topicName: s.topicName,
            questionCount: s.drawCount,
          }))}
          levelNames={
            model.mode === "adaptive"
              ? (model.adaptive.topics.find((t) => t.enabled)?.levels ?? []).map((l) => l.levelName)
              : undefined
          }
        />
      )}
```

Пропсы `draftTemplateId` и `draftDesignParams` карточка получала из соседней вкладки; теперь они
её собственные — берутся из состояния раздела оформления. Имена локальных переменных сверить по
файлу: раздел уже держит черновой шаблон, потому что рисует по нему остальные пункты.

Контракт компонента `ReportSettingsCard` в этой задаче НЕ меняется: переезд не должен смешиваться
с правкой пропсов, иначе разбор регрессии перестанет отличать одно от другого.

Если `model`, `updateModel` или черновые параметры в раздел не приходят — протащить их пропсами
от вызывающего (`test-editor` drawer), не читая модель внутри второй раз.

- [ ] **Шаг 5. Прогнать — зелено**

Запуск: `npm test -- client/src/features/tests/editor`
Ожидание: PASS, 59+ файлов.

- [ ] **Шаг 6. Коммит**

```bash
git add client/src/features/tests/editor/sections/design-section.tsx \
        client/src/features/tests/editor/sections/basic-settings-section.tsx \
        client/src/features/tests/editor/sections/__tests__/
git commit -m "feat(prd-47): карточка отчёта переехала на вкладку «Оформление»"
```

### Задача D3: приёмка в браузере

- [ ] **Шаг 1. Поднять dev из worktree**

```bash
PORT=8097 npm run dev
```

Осторожно: dev из worktree переписывает `templates.source_path` и манифест шаблона `default`
ГЛОБАЛЬНО. После приёмки восстановить: `source_path` =
`C:\Repositories\test-builder\server\scorm\templates\default`, манифест сверить с веткой `main`
ГЛУБОКИМ равенством (`jsonb` нормализует порядок ключей, поэтому сверка по хешу строки даёт
ложное расхождение).

- [ ] **Шаг 2. Пройти сценарии приёмки спеки**

Открыть тест «Опросник ведущего стиля ЧИЛ» (`4020d092-2fab-48b9-9a09-60f4c01ac7b7`) и проверить
по списку раздела 8 спеки:

1. Настройки отчёта открываются с рейла «Оформление»; в «Настройки → Основное» их нет.
2. «Авто» в отчёте на ипсативной методике даёт розу.
3. Цвет и пиктограмма шкал в отчёте совпадают с экраном.
4. «Отменить» на вкладке «Оформление» откатывает правки ОБОИХ черновиков предсказуемо.
5. Предпросмотр отчёта показывает блок измерений и диаграмму.

- [ ] **Шаг 3. Снимки — в `.playwright-mcp/`**

Скриншоты Playwright падают в КОРЕНЬ главной копии; переносить.

- [ ] **Шаг 4. Коммит отчёта о приёмке**

```bash
git add docs/reports/prd47-report-measures-acceptance.md
git commit -m "docs(prd-47): отчёт о приёмке"
```

---

## Финал

- [ ] `npx tsc --noEmit -p tsconfig.json` — чисто (две ошибки в `analytics.tsx` и
  `test-analytics.tsx` существовали до работы).
- [ ] `npm run check:guards` — оба гарда проходят.
- [ ] Адресный прогон командой:

```bash
npm test -- shared/report shared/template/__tests__ server/__tests__ \
  client/src/features/tests/editor client/src/features/learner
```

- [ ] Полный `npm run test:cov` — ТОЛЬКО с явного разрешения владельца; на стволе он красный
  (88 падений в 12 файлах по замеру 2026-08-08), и своё падение надо отделять от чужого.
- [ ] Обновить шапку спеки PRD-47: статус «реализовано», дата, коммиты.
- [ ] Строку PRD-35 в ROADMAP сузить: предпросмотр отчёта после среза C проверен.
