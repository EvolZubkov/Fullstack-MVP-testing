# PRD-39: слияние карточек сопоставления вместо стрелки — план реализации

> **Для агентов:** обязательный под-скилл — `superpowers:subagent-driven-development`
> (рекомендуется) либо `superpowers:executing-plans`. Шаги помечены чекбоксами `- [ ]`.

**Цель:** вопрос-сопоставление (`ou-match`) во всех шаблонах соединяет пару не стрелкой, а
слиянием обеих карточек и зазора между ними в единую панель со швом-перфорацией; экран
проверки красит всю слитую панель по вердикту (зелёная/красная), а не только карточку ответа.

**Требования:** [PRD-39](../specs/prd-39/matching-connector-merge.md).

**Подход:** единственная точка ветвления визуального режима — общий рендерер `renderMatching`
в `shared/template/question-interaction.ts` (используется и вебом, и SCORM-пакетом через
`TBTemplate.renderMatching`), он печатает класс `ou-match--gap-narrow` вместо
`ou-match--gap-wide`. Дизайн-система (`vendor/ui-kit/css/university-rt.css`, зеркало —
`client/src/styles/vendor/university-rt.css`) уже реализует narrow-режим, но её правило
акцентной заливки «просто соединено» исключает review-строки по классам
`ou-match__row--correct`/`--incorrect`, которых в реальной разметке приложения не бывает —
приложение метит их `correct-answer`/`incorrect-answer`. Из-за этого исключение никогда не
срабатывает, и DS перебивает зелёный/красный вердикт лиловой заливкой. Правится в самой DS
(правило должно уважать оба соглашения об именовании), затем в `theme.css` обоих встроенных
шаблонов добавляется недостающая покраска вердикта на зазоре и фиксированной карточке (её
раньше не было вообще — красилась только перетаскиваемая карточка).

**Стек:** TypeScript (framework-free рендерер), Vitest, CSS (design-system таблица +
шаблонные `theme.css`), Playwright MCP для визуальной приёмки.

**Порядок:** задачи 1-4 идут строго по порядку — задача 3/4 (покраска вердикта в `theme.css`)
без задачи 2 (снятие лилового перебития в DS) будет визуально перебита обратно; задача 5
(приёмка) идёт последней, когда все правки на месте.

---

## Задача 1: общий рендерер — режим слияния вместо стрелки

**Файлы:**

- Изменить: `shared/template/question-interaction.ts:462` и `:479-486`
- Тест: `shared/template/__tests__/question-interaction.test.ts`

- [ ] **Шаг 1: написать падающий тест**

В `shared/template/__tests__/question-interaction.test.ts` внутри `describe("renderMatching", ...)`
добавить новый `it` сразу после теста `"joins a matched pair and marks review"` (после строки 151):

```ts
  it("uses the narrow merge-panel gap mode, never the arrow", () => {
    const html = renderMatching(Q, {}, undefined);
    expect(html).toContain("ou-match--gap-narrow");
    expect(html).not.toContain("ou-match--gap-wide");
    expect(html).toContain("ou-match__seam");
    expect(html).not.toContain("ou-match__gap-arrow");
  });
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запустить: `npm test -- shared/template/__tests__/question-interaction.test.ts`
Ожидается: FAIL — `renderMatching` пока печатает `ou-match--gap-wide` и `ou-match__gap-arrow`,
а не `ou-match--gap-narrow`/`ou-match__seam`.

- [ ] **Шаг 3: переключить рендерер на narrow-режим**

В `shared/template/question-interaction.ts` заменить строку 462:

```ts
  let html = `<div class="ou-match ou-match--gap-wide ou-match--side-r ou-match--icon-dots" style="--ou-match-cols:${columns}">`;
```

на:

```ts
  let html = `<div class="ou-match ou-match--gap-narrow ou-match--side-r ou-match--icon-dots" style="--ou-match-cols:${columns}">`;
```

Заменить блок строк 479-486 (комментарий + разметка зазора):

```ts
    // Connection indicator in the gap: a chevron-left «‹» pointing from the answer
    // toward its prompt. Dashed grey hint by default, solid + accent once the row is
    // connected (the DS `ou-match__gap-arrow` styling). The path is drawn pointing
    // right; the DS's `.ou-match--side-r` `scaleX(-1)` flips it to a left chevron.
    html +=
      '<div class="ou-match__gap" aria-hidden="true">' +
      '<svg class="ou-match__gap-arrow" viewBox="0 0 28 12"><path d="M10 2 L18 6 L10 10"></path></svg>' +
      '</div>';
```

на:

```ts
    // Connection indicator in the gap: a wavy seam, invisible until the row connects.
    // Narrow-mode DS CSS (`ou-match--gap-narrow`) then fuses both cards and this cell
    // into one panel and reveals the seam over the join — no arrow is ever drawn.
    html +=
      '<div class="ou-match__gap" aria-hidden="true">' +
      '<svg class="ou-match__seam" viewBox="0 0 6 48" preserveAspectRatio="none">' +
      '<path d="M3 0 Q0 4 3 8 Q6 12 3 16 Q0 20 3 24 Q6 28 3 32 Q0 36 3 40 Q6 44 3 48"></path>' +
      '</svg></div>';
```

- [ ] **Шаг 4: убедиться, что тест проходит**

Запустить: `npm test -- shared/template/__tests__/question-interaction.test.ts`
Ожидается: PASS, все тесты `describe("renderMatching", ...)` зелёные (в т.ч. существующие —
разметка колонок/`data-drop`/review-класс строки не менялась).

- [ ] **Шаг 5: закоммитить**

```bash
git add shared/template/question-interaction.ts shared/template/__tests__/question-interaction.test.ts
git commit -m "feat(prd-39): renderMatching печатает режим слияния вместо стрелки"
```

---

## Задача 2: дизайн-система — акцентная заливка уважает оба соглашения об именовании review-класса

**Контекст:** `Matching.tsx` (сам компонент ui-kit) метит review-строку `ou-match__row--correct`/
`ou-match__row--incorrect`. Остальная разметка этой DS (и framework-free рендерер приложения)
метит её `correct-answer`/`incorrect-answer` — так же, как `ou-radio-card`/`ou-rank__item`.
Правило «просто соединено» (accent-заливка) в narrow-режиме исключает review-строки только по
первому соглашению, поэтому во втором случае никогда не исключает — accent-заливка перебивает
зелёный/красный по специфичности (6 классов у DS-правила против 3-4 у любой сценовой покраски).
Правится ОБА CSS-файла DS — они обязаны совпадать побайтово (`tests/ds-touch-dnd.test.ts`).

**Файлы:**

- Изменить: `vendor/ui-kit/css/university-rt.css` (~строка 4304-4313)
- Изменить: `client/src/styles/vendor/university-rt.css` (тот же блок, тот же номер строки —
  файлы идентичны)
- Тест (существующий, не создаётся заново): `tests/ds-touch-dnd.test.ts`

- [ ] **Шаг 1: править исходную копию (`vendor/ui-kit/css/university-rt.css`)**

Найти блок (комментарий «merge mode» стоит прямо над ним):

```css
.ou-match--gap-narrow .ou-match__row.is-connected:not(.ou-match__row--correct):not(.ou-match__row--incorrect) .ou-match__card {
  background: var(--ou-accent-soft);
  border-color: var(--ou-accent-default);
  color: var(--ou-accent-on-soft);
}
.ou-match--gap-narrow .ou-match__row.is-connected:not(.ou-match__row--correct):not(.ou-match__row--incorrect) .ou-match__gap {
  background: var(--ou-accent-soft);
  border-top: 1px solid var(--ou-accent-default);
  border-bottom: 1px solid var(--ou-accent-default);
  color: var(--ou-accent-default);
}
```

Заменить на:

```css
/* A consumer may mark a reviewed row with this component's own BEM modifiers
 * (`ou-match__row--correct`/`--incorrect`, set by `Matching.tsx`'s `rowMod`) OR with
 * the generic `correct-answer`/`incorrect-answer` classes the rest of this DS's
 * question components use. Either convention must exclude the "just connected"
 * accent tint from a reviewed row, or accent purple silently outranks the verdict
 * color by specificity.
 */
.ou-match--gap-narrow .ou-match__row.is-connected:not(.ou-match__row--correct):not(.ou-match__row--incorrect):not(.correct-answer):not(.incorrect-answer) .ou-match__card {
  background: var(--ou-accent-soft);
  border-color: var(--ou-accent-default);
  color: var(--ou-accent-on-soft);
}
.ou-match--gap-narrow .ou-match__row.is-connected:not(.ou-match__row--correct):not(.ou-match__row--incorrect):not(.correct-answer):not(.incorrect-answer) .ou-match__gap {
  background: var(--ou-accent-soft);
  border-top: 1px solid var(--ou-accent-default);
  border-bottom: 1px solid var(--ou-accent-default);
  color: var(--ou-accent-default);
}
```

- [ ] **Шаг 2: убедиться, что гард двух копий теперь падает**

Запустить: `npm test -- tests/ds-touch-dnd.test.ts`
Ожидается: FAIL на тесте `"совпадают побайтово"` — копии разошлись, ровно этого мы и ждём
после правки только одного файла.

- [ ] **Шаг 3: повторить ту же правку в зеркальной копии (`client/src/styles/vendor/university-rt.css`)**

Тот же блок, та же замена, что в шаге 1.

- [ ] **Шаг 4: убедиться, что гард снова проходит**

Запустить: `npm test -- tests/ds-touch-dnd.test.ts`
Ожидается: PASS — обе копии снова побайтово совпадают.

- [ ] **Шаг 5: закоммитить**

```bash
git add vendor/ui-kit/css/university-rt.css client/src/styles/vendor/university-rt.css
git commit -m "fix(ui-kit): narrow-match accent tint учитывает generic review-классы"
```

---

## Задача 3: шаблон «Стандартный» — зазор и покраска вердикта на слитой панели

**Файлы:**

- Изменить: `server/scorm/templates/default/styles/theme.css` (раздел «Matching scene»,
  ~строка 570-590)

- [ ] **Шаг 1: заменить блок «Matching scene»**

Найти (комментарий «Column gap…» и всё до `.ou-match__placeholder`):

```css
/* ── Matching scene ─────────────────────────────────────────────── */
/* Column gap between the two matching sides — 24px (DS default is 56px wide). */
.tb-scene .ou-match { width: 100%; row-gap: var(--ou-space-2); --ou-match-gap-w: var(--ou-space-6); }
/* The draggable answer chips no longer carry the native `draggable` flag (it broke
   real-mouse dragging), so restore the grab affordance explicitly. */
.tb-scene .ou-match__card--drag:not(.ou-match__card--empty),
.tb-scene .ou-rank__item { cursor: grab; }
.tb-scene .ou-match__card--drag.dragging,
.tb-scene .ou-rank__item.dragging { cursor: grabbing; }
/* Drop-target feedback comes from the DS itself: the pointer engine adds
   `.ou-match__row.is-target`, which lights the LEFT prompt (`.ou-match__row.is-target
   .ou-match__card--fixed` in university-rt.css). No extra rule needed here. */
/* After a pair connects, the DS tints only the RIGHT card + the arrow. Tint the LEFT
   prompt too so the whole matched row reads as connected (review states keep their own
   green/red tint, so exclude them). */
.tb-scene .ou-match__row.is-connected:not(.correct-answer):not(.incorrect-answer) .ou-match__card--fixed {
  border-color: var(--ou-accent-default);
  background: var(--ou-accent-soft);
  color: var(--ou-accent-on-soft);
}
.ou-match__placeholder { font: var(--ou-text-body-s); color: var(--ou-fg-muted); }
```

Заменить на:

```css
/* ── Matching scene ─────────────────────────────────────────────── */
/* Merge-panel gap (PRD-39): no override — the DS's own narrow-mode default (8px) is
   exactly the flush, seam-between look the merge is designed for. */
.tb-scene .ou-match { width: 100%; row-gap: var(--ou-space-2); }
/* The draggable answer chips no longer carry the native `draggable` flag (it broke
   real-mouse dragging), so restore the grab affordance explicitly. */
.tb-scene .ou-match__card--drag:not(.ou-match__card--empty),
.tb-scene .ou-rank__item { cursor: grab; }
.tb-scene .ou-match__card--drag.dragging,
.tb-scene .ou-rank__item.dragging { cursor: grabbing; }
/* Drop-target feedback comes from the DS itself: the pointer engine adds
   `.ou-match__row.is-target`, which lights the LEFT prompt (`.ou-match__row.is-target
   .ou-match__card--fixed` in university-rt.css). No extra rule needed here. */
/* "Just connected" tint needs no scene rule any more: in merge mode the DS already
   tints BOTH cards + the gap together (`ou-match--gap-narrow` in university-rt.css),
   unlike the old arrow mode which only tinted the answer card. */
/* Review verdict (PRD-39): this app marks a matched row `correct-answer`/
   `incorrect-answer` (the choice/ranking convention), not the DS component's own BEM
   modifiers — so the DS ships no color for the fixed prompt or the gap/seam under
   those classes. Paint them here so the WHOLE merged panel reads as one verdict, not
   just the draggable half. */
.tb-scene .ou-match__row.correct-answer .ou-match__card--fixed {
  border-color: var(--ou-success-default);
  background: var(--ou-success-soft);
  color: var(--ou-success-on-soft);
}
.tb-scene .ou-match__row.correct-answer .ou-match__gap {
  background: var(--ou-success-soft);
  border-top: 1px solid var(--ou-success-default);
  border-bottom: 1px solid var(--ou-success-default);
  color: var(--ou-success-default);
}
.tb-scene .ou-match__row.incorrect-answer .ou-match__card--fixed {
  border-color: var(--ou-error-default);
  background: var(--ou-error-soft);
  color: var(--ou-error-on-soft);
}
.tb-scene .ou-match__row.incorrect-answer .ou-match__gap {
  background: var(--ou-error-soft);
  border-top: 1px solid var(--ou-error-default);
  border-bottom: 1px solid var(--ou-error-default);
  color: var(--ou-error-default);
}
.ou-match__placeholder { font: var(--ou-text-body-s); color: var(--ou-fg-muted); }
```

- [ ] **Шаг 2: проверить типы/сборку не сломаны**

Запустить: `npm run check`
Ожидается: PASS (правка чисто CSS, но `check` — дешёвая страховка на весь проект перед
коммитом одной задачи).

- [ ] **Шаг 3: закоммитить**

```bash
git add server/scorm/templates/default/styles/theme.css
git commit -m "feat(prd-39): Стандартный шаблон — зазор и вердикт слитой панели сопоставления"
```

---

## Задача 4: шаблон Certification — тот же зазор и та же покраска вердикта

**Файлы:**

- Изменить: `templates/certification/styles/theme.css` (раздел «Matching scene»,
  ~строка 532-552)

- [ ] **Шаг 1: применить ту же замену, что в Задаче 3, Шаг 1**

Блок в этом файле идентичен блоку из `server/scorm/templates/default/styles/theme.css`
(проверено `diff` в ходе анализа перед планом) — старый/новый текст те же самые, меняется
только файл-адресат.

- [ ] **Шаг 2: закоммитить**

```bash
git add templates/certification/styles/theme.css
git commit -m "feat(prd-39): Certification — зазор и вердикт слитой панели сопоставления"
```

Файл `uploads/templates/certification/styles/theme.css` НЕ трогать — это gitignored
рантайм-копия загруженного шаблона (`uploads/`), не источник истины.

---

## Задача 5: визуальная приёмка

Юнит-тесты проверяют разметку и специфичность CSS-правил на бумаге; фактический каскад в
браузере — нет. Правило проекта: фронтенд принимается вживую (Playwright), юнит/jsdom
недостаточно.

**Файлы:** нет изменений кода — только просмотр уже собранного приложения.

- [ ] **Шаг 1: поднять dev-сервер**

Если основной `npm run dev` занят другой сессией — поднять второй инстанс:
`PORT=8099 npm run dev` (правки серверной части в этой задаче нет, но `theme.css`
раздаётся статикой — рестарт всё равно нужен, чтобы Vite не отдавал старый файл из кэша).

- [ ] **Шаг 2: пройти вопрос-сопоставление в Стандартном шаблоне**

Открыть тест с вопросом типа «сопоставление» на базе Стандартного шаблона (author →
«Тестовый прогон», либо реальное прохождение). Через `mcp__playwright__browser_navigate` +
`browser_snapshot`/`browser_take_screenshot`:

- в исходном состоянии — карточки раздельные, зазор ~8px, стрелки нет;
- перетащить ответ на нужную строку — карточки сливаются в одну панель, посередине видна
  волнистая линия-шов;
- оттащить обратно — панель распадается обратно на две карточки.

- [ ] **Шаг 3: пройти экран проверки в Стандартном шаблоне**

Завершить попытку с одной правильной и одной неправильной парой сопоставления, открыть
результат/review. Проверить: правильная пара — панель целиком зелёная (обе карточки + зазор,
без лилового «просто соединено» цвета), неправильная — целиком красная.

- [ ] **Шаг 4: повторить шаги 2-3 для шаблона Certification**

Тот же прогон на тесте с шаблоном Certification.

- [ ] **Шаг 5: сверить тёмную тему, если шаблон её поддерживает**

Переключить тему (если в UI есть переключатель) и повторить визуальную проверку слитой
панели/цветов вердикта.

- [ ] **Шаг 6: доложить результат**

Зафиксировать в ответе пользователю: что показали скриншоты, совпадает ли с ожиданием из
PRD-39 §1.3 (нет стрелки ни в одном состоянии; слитая панель читается как одно целое;
вердикт красит всю панель; веб и SCORM не расходятся — SCORM своей сборки без пересборки
пакета в этой задаче не проверяется, т.к. рендерер общий и уже покрыт Задачей 1).
