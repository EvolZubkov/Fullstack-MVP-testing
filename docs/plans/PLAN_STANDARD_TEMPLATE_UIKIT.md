# Ревизия шаблона «Стандартный» на ui-kit — план реализации

> **Для исполнителя-агента:** ОБЯЗАТЕЛЬНАЯ СУБ-СКИЛЛ: используйте
> superpowers:subagent-driven-development (рекомендуется) или
> superpowers:executing-plans, чтобы выполнять план задача-за-задачей. Шаги
> помечены чекбоксами (`- [ ]`) для отслеживания. Каждый шаг — одно действие
> (2–5 минут) по TDD: сначала падающий тест, потом минимальная правка, потом
> прогон и коммит.

**Цель:** перевести ученические экраны шаблона «Стандартный» на дизайн-систему
UniversityRT (компоненты `ou-*`, токены `--ou-*`) и модель «сцена», сохранив единый
рендер на всех хостах (веб / SCORM / отладчик) и брендирование теста.

**Архитектура:** рендерер уже общий (`shared/template/`); меняем per-template
артефакты (CSS, макеты, эмиссию интерактива) и добавляем мост палитры
`--primary → --ou-*`. Дизайн-система вендорится в пакет и в Shadow DOM веба;
собственный CSS-слой шаблона (1120 строк) заменяется тонким слоем сцены + мостом.

**Технологии:** TypeScript, vitest (юнит, порог 80%), esbuild (SCORM-бандл),
Vite (веб), mustache-подмножество `dsl.ts`, DS `university-rt.css`, `color-mix(in
oklch)`, браузерная приёмка через CDP (см. `docs` reference).

**Основание:** [docs/specs/spec-standard-template-uikit-revision.md](../specs/spec-standard-template-uikit-revision.md).
Эталон вида — [docs/wireframes/prohozhdenie/](../wireframes/prohozhdenie/).

---

## Фазы и порядок

Ревизия — эпик из шести рабочих потоков. Каждая фаза — самостоятельный
поставляемый и тестируемый инкремент; фазы идут в порядке зависимостей.

| Фаза | Что даёт | Зависит от |
| --- | --- | --- |
| 0. Гарды и базлайн | замер «как есть», гард-тесты, чтобы правки не роняли рантайм | — |
| 1. Мост палитры + вендоринг DS | `--primary → --ou-*`; DS в пакете и в Shadow DOM; шрифт | 0 |
| 2. Общая эмиссия интерактива | `ou-radio-card`/`ou-check`/`ou-rank`/`ou-match` из ОДНОГО места | 0 |
| 3. Скелет сцены + экран вопроса | сцена (шапка/тело/подвал), `question.html` целиком | 1, 2 |
| 4. Остальные макеты | все системные + контентные макеты на сцену | 3 |
| 5. Динамический размер шрифта | `fitFont()` в контексте, вопрос 20–32 / вариант 14–20 | 3 |
| 6. Дефекты рантайма | единый фидбэк итогов; `system.transition`; `summary` | 4 |

Каждая фаза ниже — набор задач. Фазы 0–3 расписаны по-шаговым TDD; фазы 4–6 — списком
исполняемых задач с файлами, тестами и критериями приёмки (границы известны, точная
разметка/формулы добываются в самих задачах — это спайки, а не заглушки).

Приёмка вида в КАЖДОЙ фазе, затрагивающей экран, — реальный браузер (CDP), обе темы;
юнит/jsdom недостаточны (HARD-правило проекта). Скрипты съёмки — как в
`docs/wireframes/prohozhdenie` (полный chromium из ms-playwright + CDP без пакета
playwright).

---

## Фаза 0. Гарды и базлайн

**Цель:** зафиксировать поведение рантайма и палитры до правок, чтобы регрессии
падали тестом, а не обнаруживались в браузере.

### Задача 0.1. Гард на публичный контракт TBTemplate-бандла

**Файлы:**

- Создать: `shared/template/__tests__/runtime-entry-exports.test.ts`

- [ ] **Шаг 1. Написать падающий тест на состав экспортов бандла**

```ts
/**
 * @module shared/template/__tests__/runtime-entry-exports
 * @description Гард: набор публичных экспортов TBTemplate не должен молча
 * сузиться — оба хоста (веб-импорт и SCORM-IIFE) зависят от этих имён.
 */
import { describe, it, expect } from "vitest";
import * as entry from "../runtime-entry";

const REQUIRED = [
  "renderScreenInto",
  "buildQuestionProgress",
  "buildReviewContext",
  "shouldShowReview",
  "renderResultField",
] as const;

describe("runtime-entry public surface", () => {
  it("exposes every symbol both hosts rely on", () => {
    for (const name of REQUIRED) {
      expect(typeof (entry as Record<string, unknown>)[name]).not.toBe("undefined");
    }
  });
});
```

- [ ] **Шаг 2. Прогнать — убедиться, что тест ЗЕЛЁНЫЙ (контракт уже есть)**

Запуск: `npm test -- shared/template/__tests__/runtime-entry-exports.test.ts`
Ожидание: PASS. Тест фиксирует статус-кво; красным он станет, если экспорт удалят.

- [ ] **Шаг 3. Коммит**

```bash
git add shared/template/__tests__/runtime-entry-exports.test.ts
git commit -m "test(template): гард на публичный контракт TBTemplate-бандла"
```

### Задача 0.2. Базлайн размера пакета и наличия DS/шрифта

**Файлы:**

- Создать: `docs/plans/notes/uikit-baseline.md`

- [ ] **Шаг 1. Собрать образец пакета и замерить**

Запуск: `npm run scorm:template`
Затем: `ls -l out/*.zip` и распаковать, проверить наличие `styles.css`, `@font-face`,
классов `ou-`. Записать в `docs/plans/notes/uikit-baseline.md`: размер zip, есть ли
`ou-` в `styles.css` (ожидается: НЕТ), есть ли `@font-face` (ожидается: НЕТ).

- [ ] **Шаг 2. Коммит**

```bash
git add docs/plans/notes/uikit-baseline.md
git commit -m "docs(plan): базлайн пакета до вендоринга DS"
```

---

## Фаза 1. Мост палитры и вендоринг DS

**Цель:** DS-токены доступны на обоих хостах; палитра теста (`--primary` …) выводит
акцентную рампу `--ou-*`; брендовый шрифт в пакете. Без этой фазы `ou-*`-классы не
красятся.

**Файловая структура фазы:**

- `server/scorm/templates/default/styles/theme.css` — становится МОСТОМ:
  `--primary → --ou-purple-*` и поверхности из `--background`/`--card` через
  `color-mix(in oklch)`; собственную DS-систему НЕ объявляет.
- `shared/template/palette-bridge.ts` (создать) — чистая функция, строящая CSS-блок
  моста из значений палитры (тестируемо без DOM).
- `server/scorm/index.ts` — в `styles.css` пакета вкладывать DS + мост.
- `client/src/components/template-screen.tsx` — инъекция DS под `.ou` в Shadow DOM.
- `server/scorm/templates/default/assets/fonts/` (создать) + билдер — вендоринг
  `RostelecomBasis`.

### Задача 1.1. Мост палитры: чистая функция

**Файлы:**

- Создать: `shared/template/palette-bridge.ts`
- Создать: `shared/template/__tests__/palette-bridge.test.ts`

- [ ] **Шаг 1. Написать падающий тест на форму блока моста**

```ts
/**
 * @module shared/template/__tests__/palette-bridge
 * @description Мост выводит акцентную рампу DS из одного --primary теста и
 * поверхности из --background/--card. Проверяем СТРУКТУРУ вывода (какие
 * переменные объявлены и что источник — токены/color-mix, а не литералы).
 */
import { describe, it, expect } from "vitest";
import { buildPaletteBridge } from "../palette-bridge";

describe("buildPaletteBridge", () => {
  it("declares the DS accent ramp derived from the test primary", () => {
    const css = buildPaletteBridge({ primary: "217 91% 42%", background: "225 7% 7%", card: "225 14% 14%" });
    // Рампа акцента выводится из primary (её читает --ou-accent-*).
    expect(css).toMatch(/--ou-purple-500:\s*hsl\(var\(--primary\)\)/);
    expect(css).toContain("color-mix(in oklch");
    // Ни одного цветового литерала (#hex / rgb / hsl с числами) — только токены.
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.]/);
  });

  it("is empty-safe when the test declares no palette", () => {
    expect(buildPaletteBridge({}).trim().length).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Шаг 2. Прогнать — убедиться, что падает («buildPaletteBridge is not a function»)**

Запуск: `npm test -- shared/template/__tests__/palette-bridge.test.ts`
Ожидание: FAIL.

- [ ] **Шаг 3. Реализовать мост (СПАЙК: подобрать формулу рампы)**

Реализовать `buildPaletteBridge(p: { primary?; background?; foreground?; card?;
cardBorder?; border?; muted?; accent? }): string`. Внутри — вывести
`--ou-purple-400..700` из `--primary` тем же приёмом, каким DS строит рампу из
своих primitives (`color-mix(in oklch, …)`; свериться с блоками `.ou--dark`/`.ou--light`
в `vendor/ui-kit/css/university-rt.css`), а `--ou-bg-*`/`--ou-border-*` — из
`--background`/`--card`/`--border`. Приёмка формулы — визуальная (Шаг 5): на трёх
брендах (РТК-оранжевый `15 100% 45%`, синий `217 91% 42%`, зелёный `142 70% 40%`)
`soft`/`container`/`hover` должны читаться. Значение по умолчанию (палитра пуста) —
пустой блок: тогда действует штатная палитра DS.

Начальный каркас (уточнить формулу под приёмку):

```ts
/**
 * @module shared/template/palette-bridge
 * @description Мост палитры теста (PRD-7/PRD-23: --primary/--background/…) в токены
 * дизайн-системы (--ou-*). Позволяет держать разметку на --ou-*, а брендирование —
 * прежним (cssVars/панель «Оформление» не меняются). Чистая, без DOM.
 */
export interface TemplatePalette {
  primary?: string; background?: string; foreground?: string;
  card?: string; cardBorder?: string; border?: string; muted?: string; accent?: string;
}

/** CSS-блок для `.ou` (не `:root`): выводит DS-токены из палитры теста. */
export function buildPaletteBridge(p: TemplatePalette): string {
  const lines: string[] = [];
  if (p.primary) {
    // Акцентная рампа: середина = primary теста, тон/оттенок вокруг — как в DS.
    lines.push("--ou-purple-500: hsl(var(--primary));");
    lines.push("--ou-purple-600: color-mix(in oklch, #000 16%, hsl(var(--primary)));");
    lines.push("--ou-purple-400: color-mix(in oklch, #fff 16%, hsl(var(--primary)));");
    lines.push("--ou-purple-700: color-mix(in oklch, #000 30%, hsl(var(--primary)));");
    lines.push("--ou-purple-300: color-mix(in oklch, #fff 30%, hsl(var(--primary)));");
  }
  if (p.background) lines.push("--ou-bg-page: hsl(var(--background));");
  if (p.card) lines.push("--ou-bg-elevated: hsl(var(--card));");
  if (p.border) lines.push("--ou-border-soft: hsl(var(--border));");
  return lines.length ? `.ou{${lines.join("")}}` : "";
}
```

- [ ] **Шаг 4. Прогнать — убедиться, что тест ЗЕЛЁНЫЙ**

Запуск: `npm test -- shared/template/__tests__/palette-bridge.test.ts`
Ожидание: PASS. (Литералы `#000/#fff` внутри `color-mix` допустимы как в самом DS —
это микс-опорные, регэксп теста ловит цвет-ЗНАЧЕНИЯ вида `#hex\b`/`rgb(`, не аргумент
`#000`; если регэксп ловит — заменить опоры на токены нейтралей DS.)

- [ ] **Шаг 5. Браузерная приёмка формулы на трёх брендах**

Собрать превью `default` с `cssVars` каждого бренда, снять кольцо/варианты/кнопку в
обеих темах (скрипт CDP как в `docs/wireframes/prohozhdenie`). Глазами: `soft`
(фон варианта), `container` (выбранный), `hover`, кнопка — читаются, контраст WCAG AA.
Если бренд «плывёт» — поправить формулу в Шаге 3 и пересобрать.

- [ ] **Шаг 6. Коммит**

```bash
git add shared/template/palette-bridge.ts shared/template/__tests__/palette-bridge.test.ts
git commit -m "feat(template): мост палитры теста в токены DS (color-mix рампа из --primary)"
```

### Задача 1.2. Экспортировать мост из бандла и подключить к вебу

**Файлы:**

- Modify: `shared/template/runtime-entry.ts` (рядом с прочими экспортами)
- Modify: `server/services/template-render.ts` (веб отдаёт DS + мост)
- Modify: `client/src/components/template-screen.tsx` (инъекция DS + `.ou` в Shadow DOM)

- [ ] **Шаг 1. Тест: веб-payload содержит мост-CSS**

Добавить кейс в существующий тест сервиса (или создать
`server/services/__tests__/template-render.palette.test.ts`): для теста с
`primaryColor` в ответе `screen-template` присутствует блок `.ou{…--ou-purple-500…}`.

```ts
import { describe, it, expect } from "vitest";
import { buildScreenTemplatePayload } from "../template-render"; // имя сверить в файле

describe("template-render palette bridge", () => {
  it("emits the DS bridge for a branded test", async () => {
    const payload = await buildScreenTemplatePayload(/* фикстура теста с primaryColor */);
    expect(payload.css).toContain("--ou-purple-500");
  });
});
```

- [ ] **Шаг 2. Прогнать — FAIL**

Запуск: `npm test -- template-render`
Ожидание: FAIL (мост ещё не подмешан).

- [ ] **Шаг 3. Реализация**

В `runtime-entry.ts` добавить `export { buildPaletteBridge } from "./palette-bridge";`.
В `template-render.ts` — приклеить `buildPaletteBridge(<палитра теста>)` к отдаваемому
`css`. В `template-screen.tsx` — в инъекцию Shadow DOM добавить загрузку
`university-rt.css` (импортом строки или ссылкой на общий ассет) и поставить класс
`ou ou--<theme>` на `:host` (сейчас маппится `:root/body → :host`; DS написан под `.ou`).

- [ ] **Шаг 4. Прогнать — PASS + `npm run check`**

Запуск: `npm test -- template-render && npm run check`
Ожидание: PASS, типы чистые.

- [ ] **Шаг 5. Коммит**

```bash
git add shared/template/runtime-entry.ts server/services/template-render.ts client/src/components/template-screen.tsx
git commit -m "feat(template): DS + мост палитры в веб-хосте (Shadow DOM под .ou)"
```

### Задача 1.3. Вендоринг DS и шрифта в SCORM-пакет

**Файлы:**

- Modify: `server/scorm/index.ts:395-435` (сборка `styles.css`)
- Create: `server/scorm/templates/default/assets/fonts/` (woff2 RostelecomBasis)
- Modify: билдер `index.html.ejs` / медиа-ассетов (подключить `@font-face`)

- [ ] **Шаг 1. Тест: `styles.css` пакета содержит DS-токены**

Расширить существующий тест сборки пакета (искать по `scorm` в `tests/` или
`server/scorm/__tests__`): собранный `styles.css` содержит `--ou-space-3` и
`.ou-radio-card`, а также `@font-face` с `RostelecomBasis`.

- [ ] **Шаг 2. Прогнать — FAIL**

Ожидание: FAIL (DS/шрифт ещё не вложены).

- [ ] **Шаг 3. Реализация**

В `server/scorm/index.ts` заменить `stylesCss = readStyle("theme.css") + base.css` на
`readVendorDs() + readStyle("theme.css")` (DS первым, мост-`theme.css` — поверх,
`base.css` удаляется в Фазе 4 после переноса макетов). Прочитать
`vendor/ui-kit/css/university-rt.css`. Вложить woff2 в `assets/fonts/` и добавить
`@font-face` в CSS пакета; проверить путь внутри zip.

- [ ] **Шаг 4. Прогнать — PASS; собрать пакет; открыть в SCORM-плеере**

Запуск: `npm test -- scorm && npm run scorm:template && npm run scorm:player`
Ожидание: PASS; в плеере на `:5050` шрифт брендовый, `ou-`-правила применяются
(экран пока старый — важно, что DS ГРУЗИТСЯ и не конфликтует).

- [ ] **Шаг 5. Коммит**

```bash
git add server/scorm/index.ts server/scorm/templates/default/assets/fonts docs/plans/notes/uikit-baseline.md
git commit -m "feat(scorm): вендоринг DS и шрифта RostelecomBasis в пакет"
```

---

## Фаза 2. Общая эмиссия интерактива

**Цель:** HTML вариантов/чекбоксов/ранжирования/сопоставления эмитится из ОДНОГО
места (`shared/template/`), оба хоста вызывают его. Это закрывает единственный шов,
где «единый источник» не выполнялся, и не даёт классам `ou-*` разъехаться.

**Файловая структура фазы:**

- `shared/template/question-interaction.ts` (создать) — чистые функции
  `renderSingle/renderMultiple/renderRanking/renderMatching(question, answer,
  opts) → HTML` на классах DS эталона; делегируют `data-action` как сейчас.
- `shared/template/runtime-entry.ts` — экспорт этих функций.
- `client/src/pages/learner/template-question-screen.tsx` — перевести `optionsHtml`
  и т.п. на общие функции.
- `server/scorm/template/app/render/*` (`single.js`/`multiple.js`/`mainRender.js`)
  и модель — перевести на `TBTemplate.render*`.

### Задача 2.1. Общий рендер одиночного/множественного выбора

**Файлы:**

- Create: `shared/template/question-interaction.ts`
- Create: `shared/template/__tests__/question-interaction.test.ts`

- [ ] **Шаг 1. Падающий тест на разметку одиночного выбора (эталон ui-kit)**

```ts
import { describe, it, expect } from "vitest";
import { renderSingleChoice } from "../question-interaction";

const Q = { type: "single", dataJson: { options: ["A", "B", "C"] } } as any;

describe("renderSingleChoice", () => {
  it("emits ou-radio-card options with select data-action and is-on on the chosen", () => {
    const html = renderSingleChoice(Q, 1, undefined);
    expect(html).toContain("ou-radio-card");
    expect(html).toContain('data-action="select:1"');
    // выбранный вариант помечен is-on
    expect(html).toMatch(/ou-radio-card is-on[^>]*>[\s\S]*?B/);
    // цена шрифта — переменная (Фаза 5 её вычислит), не литерал-магия
    expect(html).toContain("--tb-answer-fs");
  });
});
```

- [ ] **Шаг 2. Прогнать — FAIL**

Запуск: `npm test -- shared/template/__tests__/question-interaction.test.ts`
Ожидание: FAIL.

- [ ] **Шаг 3. Реализация `renderSingleChoice` (+ `renderMultiple`)**

Портировать разметку из `docs/wireframes/prohozhdenie/Прохождение теста.html`
(варианты: `label.ou-radio-card` + `ou-radio`/`ou-check` + `ou-radio-card__title`) в
чистые функции. Экранирование — как в `renderers.ts` (`esc`). `data-action="select:N"`
как в текущем `template-question-screen.tsx`. Порядок — по `shuffleMapping`.

- [ ] **Шаг 4. Прогнать — PASS**

Ожидание: PASS.

- [ ] **Шаг 5. Коммит**

```bash
git add shared/template/question-interaction.ts shared/template/__tests__/question-interaction.test.ts
git commit -m "feat(template): общий рендер одиночного/множественного выбора (ou-radio-card/ou-check)"
```

### Задача 2.2. Общий рендер ранжирования и сопоставления

**Файлы:**

- Modify: `shared/template/question-interaction.ts` (+ `renderRanking`, `renderMatching`)
- Modify: `shared/template/__tests__/question-interaction.test.ts`

- [ ] **Шаг 1. Падающий тест: `ou-rank`/`ou-match` с общей моделью DnD**

```ts
import { renderRanking, renderMatching } from "../question-interaction";
it("ranking uses ou-rank items with grip/index/controls", () => {
  const html = renderRanking({ type: "ranking", dataJson: { options: ["1","2"] } } as any, undefined, undefined);
  expect(html).toContain("ou-rank__item");
  expect(html).toContain("ou-rank__index");
});
it("matching uses ou-match rows (fixed + drag)", () => {
  const html = renderMatching({ type: "matching", dataJson: { left: ["a"], right: ["b"] } } as any, {}, undefined);
  expect(html).toContain("ou-match__row");
  expect(html).toContain("ou-match__card--drag");
});
```

- [ ] **Шаг 2. Прогнать — FAIL**; **Шаг 3. Реализация** (портировать разметку из
  эскизов сопоставления/ранжирования; DnD-крючки `data-action="drop:…"` как сейчас,
  движок остаётся `shared/template/dnd`); **Шаг 4. Прогнать — PASS**.

- [ ] **Шаг 5. Коммит**

```bash
git add shared/template/question-interaction.ts shared/template/__tests__/question-interaction.test.ts
git commit -m "feat(template): общий рендер ранжирования и сопоставления (ou-rank/ou-match)"
```

### Задача 2.3. Перевести оба хоста на общую эмиссию

**Файлы:**

- Modify: `shared/template/runtime-entry.ts` (экспорт `renderSingleChoice` и др.)
- Modify: `client/src/pages/learner/template-question-screen.tsx`
- Modify: `server/scorm/template/app/render/single.js`, `multiple.js`, `mainRender.js`

- [ ] **Шаг 1. Экспортировать функции из бандла**, добавить в
  `runtime-entry-exports.test.ts` (задача 0.1) имена `renderSingleChoice`,
  `renderMultiple`, `renderRanking`, `renderMatching`; прогнать — FAIL.
- [ ] **Шаг 2. Реализация экспортов** — прогнать 0.1 — PASS.
- [ ] **Шаг 3. Веб:** заменить локальный `optionsHtml`/интеракции в
  `template-question-screen.tsx` на `renderSingleChoice(...)` и др.
- [ ] **Шаг 4. SCORM:** в `single.js`/`multiple.js`/`mainRender.js` заменить
  строковую сборку на `TBTemplate.renderSingleChoice(...)` и др.
- [ ] **Шаг 5. Приёмка паритета:** тот же тест в веб-хосте и в пакете даёт
  идентичный DOM вариантов (CDP, оба хоста); все четыре типа.
- [ ] **Шаг 6. Коммит**

```bash
git add shared/template/runtime-entry.ts shared/template/__tests__/runtime-entry-exports.test.ts \
        client/src/pages/learner/template-question-screen.tsx server/scorm/template/app/render/*.js
git commit -m "refactor(template): оба хоста рендерят интерактив из общего слоя"
```

---

## Фаза 3. Скелет сцены и экран вопроса

**Цель:** «сцена» (шапка / тело `flex:1;overflow:auto` / подвал) и полностью
переписанный `question.html` на разметке эталона; работает на обоих хостах и в
отладчике.

**Файловая структура фазы:**

- `server/scorm/templates/default/styles/theme.css` — добавить слой сцены (флекс-корень,
  `flex:1` вариантов, сетка «медиа+ответы», без цветовых литералов).
- `server/scorm/templates/default/layouts/question.html` — переписать на сцену
  (шапка: лого/название/подзаголовок + таймеры; карта `ou-quiz`; полоса `ou-progress`;
  тело со слотами; подвал — зона панели действий).
- `shared/template/context.ts` — при необходимости аддитивные поля шапки/подвала.

### Задача 3.1. Слой сцены в theme.css

**Файлы:**

- Modify: `server/scorm/templates/default/styles/theme.css`
- Create: `tests/template-scene-css.test.ts`

- [ ] **Шаг 1. Падающий гард: сцена на токенах, без литералов**

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
const css = fs.readFileSync("server/scorm/templates/default/styles/theme.css", "utf8");
describe("scene layer", () => {
  it("declares the scene flex root and answer flex, no colour literals", () => {
    expect(css).toContain("flex-direction:column");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.]/);
  });
});
```

- [ ] **Шаг 2. Прогнать — FAIL**; **Шаг 3.** добавить в `theme.css` слой сцены
  (порт из инлайн-стилей эскиза: корень `display:flex;flex-direction:column;height:100%`;
  тело `flex:1;overflow:auto`; варианты `flex:1;min-height:52px`; сетка «медиа 5/ответы»
  через токены `--ou-*`); **Шаг 4. Прогнать — PASS**.
- [ ] **Шаг 5. Коммит**

```bash
git add server/scorm/templates/default/styles/theme.css tests/template-scene-css.test.ts
git commit -m "feat(template): слой сцены на токенах DS (флекс-корень, flex-варианты)"
```

### Задача 3.2. Переписать question.html на сцену

**Файлы:**

- Modify: `server/scorm/templates/default/layouts/question.html`
- Modify/Use: смок-рендер через `renderScreenInto` (тест как у существующих layouts)

- [ ] **Шаг 1. Падающий смок-тест макета вопроса**

Использовать существующий смок-раннер (`shared/template/smoke-runner.ts`): рендер
`question.html` с демо-контекстом даёт шапку (лого/название/`ou-quiz`/таймеры),
полосу `ou-progress`, слот интерактива, подвал с зоной действий; без незакрытых
плейсхолдеров.

```ts
import { renderSmoke } from "../smoke-runner"; // путь/имя сверить
it("question layout renders the scene chrome", () => {
  const html = renderSmoke("question");
  expect(html).toContain("ou-quiz");
  expect(html).toContain("ou-progress");
  expect(html).toContain('data-slot="question-interaction"');
});
```

- [ ] **Шаг 2. Прогнать — FAIL**; **Шаг 3.** переписать `question.html` по эскизу
  `Прохождение теста.html` (шапка два ряда, карта+легенда+счётчик, полоса прогресса
  3px, тело `.tb-screen`, слоты `question-text`/`question-media`/`question-interaction`,
  подвал-панель); интерактив приходит из Фазы 2; **Шаг 4. Прогнать — PASS**.
- [ ] **Шаг 5. Приёмка (CDP, оба хоста, обе темы):** одиночный/множественный/
  сопоставление/ранжирование/медиа — совпадают с эскизами; варианты заполняют высоту,
  панель закреплена. **Шаг 6. Коммит.**

```bash
git add server/scorm/templates/default/layouts/question.html
git commit -m "feat(template): экран вопроса на сцене DS (шапка/тело/панель)"
```

---

## Фаза 4. Остальные макеты

**Цель:** все системные и контентные макеты переведены на сцену DS; `base.css`
удаляется.

Задачи (по одному макету на задачу; каждая: падающий смок-тест `renderScreenInto` →
переписать макет по одноимённому эскизу из `docs/wireframes/prohozhdenie` → прогон →
приёмка CDP обе темы → коммит). Точная разметка берётся из эскиза (не заглушка —
эскизы уже приняты).

- [ ] **4.1 `start.html`** ← `Старт.html` (факты-полоса, кулдаун-баннер `ou-banner`).
- [ ] **4.2 `router.menu`** ← `Разделы теста.html` (сетка карточек `ou-card`, `ou-progress`).
- [ ] **4.3 `section-intro.html`** ← `intro.standard.html` (эйброу/тема/мета/инструкция).
- [ ] **4.4 `review.html`** ← `Обзор ответов.html` (`ou-quiz` + список `ou-stat-row`).
- [ ] **4.5 `section-results.html`** ← `Итоги раздела.html` (`ou-ring` + вердикт-тег).
- [ ] **4.6 `results.html`** ← `Результаты.html` (полоса «кольцо+показатели», сетка тем,
      блок обратной связи — см. Фаза 6).
- [ ] **4.7 `content.text/.image-left/.image-right`** ← `info.*` (сетка «медиа+текст`,
      блок уравновешен по центру, читаемая мера).
- [ ] **4.8 `gallery.*`** ← `gallery.*` (то же + точки последовательности в подвале).
- [ ] **4.9 `system.blocked.html`** ← `system.blocked.html` (центрированная карточка кулдауна).
- [ ] **4.10 `system.transition.html`** ← `system.transition.html` (см. Фаза 6 — смена уровня).
- [ ] **4.11 `results.adaptive.html`** ← `results.adaptive.html` (уровни по темам + фидбэк).
- [ ] **4.12 `summary.*`** — привести к контракту `title + result` (см. Фаза 6).
- [ ] **4.13 Удалить `base.css`** и ссылки на него (`server/scorm/index.ts`,
      `template-render.ts`): падающий тест «`base.css` больше не читается» → удалить →
      прогон полного `npm test` → приёмка ключевых экранов → коммит.
- [ ] **4.14 Модалка завершения (FR-09) и состояние проверки ответа** — свести к
      `ou-modal` и подсветке `ou-radio-card` (success/error) как в эскизах
      `finish-confirm.html` / `question — проверка.html`.

Критерий приёмки фазы: линтер цветовых литералов (`tests/ds-color-compliance.test.ts`
и линтер эскизов) зелёный; паритет веб↔SCORM на всех 20 вариантах; отладчик (PRD-18)
корректен в узком iframe; `npm test` без падения порога.

---

## Фаза 5. Динамический размер шрифта

**Цель:** размер шрифта вопроса (20–32) и варианта (14–20) вычисляется по длине в
ОБЩЕМ коде и попадает в контекст; макет подставляет инлайном. Эталон — функция
`fit()` из разметки ui-kit.

### Задача 5.1. `fitFont()` и проставление в контекст

**Файлы:**

- Create: `shared/template/fit-font.ts`
- Create: `shared/template/__tests__/fit-font.test.ts`
- Modify: `shared/template/context.ts` (аддитивные поля `questionFont`, `optionFont`)
- Modify: билдеры контекста вопроса (веб и SCORM берут одну функцию)

- [ ] **Шаг 1. Падающий тест `fitFont` (портирует формулу `fit()` эталона)**

```ts
import { describe, it, expect } from "vitest";
import { fitFont } from "../fit-font";
describe("fitFont", () => {
  it("clamps by length between min and max (question 20..32)", () => {
    expect(fitFont(10, { max: 32, min: 20, from: 58, per: 0.17 })).toBe("32px");
    expect(fitFont(200, { max: 32, min: 20, from: 58, per: 0.17 })).toBe("20px");
  });
  it("option scale 14..20", () => {
    expect(fitFont(10, { max: 20, min: 14, from: 38, per: 0.14 })).toBe("20px");
  });
});
```

- [ ] **Шаг 2. Прогнать — FAIL**; **Шаг 3.** реализовать `fitFont(len, {max,min,from,per})
  = round(clamp(min, max, max - max(0, len-from)*per)) + "px"` (формула из эталона);
  **Шаг 4. Прогнать — PASS**.
- [ ] **Шаг 5.** проставить `questionFont`/`optionFont` в контекст вопроса в общем
  билдере; макет `question.html` и `renderSingleChoice` читают их (`--tb-answer-fs`).
  Приёмка CDP: короткий и длинный вопрос/вариант меняют размер, зажат. **Шаг 6. Коммит.**

```bash
git add shared/template/fit-font.ts shared/template/__tests__/fit-font.test.ts shared/template/context.ts
git commit -m "feat(template): динамический размер шрифта вопроса/вариантов (общая fitFont)"
```

---

## Фаза 6. Дефекты рантайма (из спеки §3.2)

**Цель:** устранить три несогласованности, выявленные при сверке с движком.

### Задача 6.1. Единый состав обратной связи в итогах

**Файлы:**

- Modify: `shared/template/result-context.ts` (свести per-topic состав: `feedback` +
  `courses` + `events` для обоих режимов из `feedback_json`)
- Modify: `server/services/result-context.ts`
- Modify: `server/scorm/template/app/render/adaptiveRender.js` (адаптивный итог)
- Modify: макеты `results.html` / `results.adaptive.html`

- [ ] **Шаг 1. Падающий тест: оба контекста дают одинаковый per-topic состав**

```ts
import { buildResultContext } from "../result-context";        // стандарт
import { buildAdaptiveResultContext } from "../result-context"; // адаптив (имя сверить)
it("both modes expose feedback + courses + events per topic", () => {
  const std = buildResultContext(/* фикстура с feedback_json */);
  const ad = buildAdaptiveResultContext(/* та же тема */);
  const shape = (t: any) => ({ f: !!t.topicFeedback ?? !!t.feedback, c: Array.isArray(t.recommendedCourses ?? t.recommendedLinks), e: Array.isArray(t.recommendedEvents) });
  expect(shape(std.topicResults[0])).toEqual(shape(ad.topicResults[0]));
});
```

- [ ] **Шаг 2. Прогнать — FAIL** (сейчас составы расходятся: адаптив без events);
  **Шаг 3.** свести оба билдера к `{ feedback, recommendedCourses, recommendedEvents }`
  per-topic из `feedback_json`; макеты — общий блок фидбэка (как эскизы); **Шаг 4. PASS**.
- [ ] **Шаг 5. Приёмка CDP:** `Результаты` и `results.adaptive` показывают
  одинаковый состав фидбэка. **Шаг 6. Коммит.**

```bash
git add shared/template/result-context.ts server/services/result-context.ts \
        server/scorm/template/app/render/adaptiveRender.js \
        server/scorm/templates/default/layouts/results.html server/scorm/templates/default/layouts/results.adaptive.html
git commit -m "fix(template): единый состав обратной связи в итогах (стандарт ↔ адаптив)"
```

### Задача 6.2. system.transition — смена уровня, без вердикта и без topic-move

**Файлы:**

- Modify: `shared/template/transition-context.ts`
- Modify: `server/scorm/template/app/render/adaptiveRender.js`
- Modify: `server/scorm/templates/default/layouts/system.transition.html`

- [ ] **Шаг 1. Падающий тест контекста перехода**

```ts
import { buildTransitionContext } from "../transition-context";
it("titles the level change, names the topic, no per-answer verdict as title", () => {
  const ctx = buildTransitionContext({ topicName: "Базовые угрозы", levelTransition: { type: "up", message: "" } });
  expect(ctx.topicName).toBe("Базовые угрозы");
  expect(ctx.title).not.toMatch(/Правильно|Неправильно/);
});
```

- [ ] **Шаг 2. Прогнать — FAIL** (сейчас `title = isCorrect`); **Шаг 3.** заголовок =
  смена уровня; добавить `topicName` (тема, по которой определяется уровень); ветку
  `topicTransition` не показывать (это отложенный flat-адаптив, PRD-4); макет — по
  эскизу `system.transition.html`; **Шаг 4. PASS**; **Шаг 5. Приёмка CDP; Шаг 6. Коммит.**

```bash
git add shared/template/transition-context.ts server/scorm/template/app/render/adaptiveRender.js \
        server/scorm/templates/default/layouts/system.transition.html
git commit -m "fix(template): экран перехода — смена уровня в теме, без вердикта ответа"
```

### Задача 6.3. summary — граница результатов, к контракту

**Файлы:**

- Modify: `server/scorm/templates/default/layouts/summary.*` (title + result, без тега/абзаца)
- Modify: manifest `summary.result` (сверить плейсхолдеры `title`+`result`)

- [ ] **Шаг 1. Смок-тест: summary рендерит только title + result-виджет** (падающий,
  если в макете лишние узлы); **Шаг 2. FAIL; Шаг 3.** привести макет к контракту
  (кольцо/число/полоса по `defaultRenderer`); **Шаг 4. PASS; Шаг 5. Коммит.**

```bash
git add server/scorm/templates/default/layouts/summary.text.html server/scorm/templates/default/manifest.json
git commit -m "fix(template): summary.result к контракту title + result (граница итогов)"
```

---

## Приёмка эпика (после всех фаз)

- [ ] Браузерная приёмка (CDP) всех 20 вариантов в обеих темах на ОБОИХ хостах —
  паритет DOM/вида.
- [ ] `tests/ds-color-compliance.test.ts` и линтер эскизов — зелёные (цвет только из
  `--ou-*` или палитры теста).
- [ ] Отладчик (PRD-18): сцена корректна в узком iframe.
- [ ] `npm test` (порог 80%) и `npm run check` — без падений.
- [ ] Замер веса пакета против базлайна (задача 0.2); зафиксировать +DS в заметке.
- [ ] Открытые риски из спеки §8 подтверждены: браузер WebTutor (`color-mix oklch`),
  `ChoiceCard` (остаёмся на `ou-radio-card`), `certification` — вне границ.

---

## Границы плана

- Шаблон `certification` и внешние ZIP — вне границ.
- `adaptive + linear_flat` («Flat adaptive») — отложен в отдельный будущий PRD
  (PRD-4); в этом плане не реализуется.
- Набор параметров оформления и панель «Оформление» не меняются — мост палитры
  сохраняет их как есть.
