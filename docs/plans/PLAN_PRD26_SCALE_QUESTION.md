# PRD-26 Scale Question Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** ввести тип вопроса «шкала» (`scale`) — упорядоченный набор градаций с одним
выбором, опциональным правильным ответом и вкладом в шкалы PRD-5, — и отрисовать его в
шаблоне «Стандартный» на обоих хостах как дорожку с точками.

**Architecture:** тип живёт в перечислениях TypeScript и Zod; миграция базы не требуется
(`questions.type` — `text` без `CHECK`). Разметка ответа порождается ОДНОЙ функцией
`renderScale` в `shared/template/question-interaction.ts`, которую веб вызывает напрямую,
а SCORM-пакет — через глобальный `TBTemplate`. Визуально шкала — существующий компонент
дизайн-системы `Stepper` в новом режиме выбора (`ou-stepper--choice`), а не новый
компонент. Отсутствие правильного ответа (`correctJson === null`) переводит вопрос в
измерительный режим: он не приносит баллов и не влияет на процент, но даёт вклад в шкалы.

**Tech Stack:** TypeScript, Express, Drizzle ORM (PostgreSQL), React 19 + Wouter,
`@universityrt/ui-kit`, ExcelJS, Vitest, esbuild (сборка рантайма пакета).

---

## Нормативные документы

- Спецификация: [docs/specs/prd-26/scale-question-type.md](../specs/prd-26/scale-question-type.md).
- Эскиз: [docs/wireframes/question-scale.html](../wireframes/question-scale.html).
- Шкалы и вклады: [docs/specs/prd-5/scales-competency-measurements.md](../specs/prd-5/scales-competency-measurements.md),
  нормативный пример того же опросника: [docs/specs/prd-5/example-mbi.md](../specs/prd-5/example-mbi.md).
- Градуированная цена ответа: [docs/specs/prd-10/graded-answer-scoring.md](../specs/prd-10/graded-answer-scoring.md).
- Паритет хостов: [docs/specs/prd-12/web-runtime-parity.md](../specs/prd-12/web-runtime-parity.md).
- Книга импорта: [docs/specs/prd-14/questions-import-export.md](../specs/prd-14/questions-import-export.md).
- Референс-книга для приёмки: `docs/references/workbook_Выгорание_Маслач.xlsx`.

## Roadmap (спецификация → задачи)

| Фаза спецификации | Задачи плана |
| --- | --- |
| Фаза 0. Эскиз | Task 0 |
| Фаза 1. Дизайн-система | Task 1 |
| Фаза 2. Модель и типы | Task 2, Task 3 |
| Фаза 3. Рендер | Task 4, Task 5, Task 6 |
| Фаза 4. Оценка и шкалы | Task 7, Task 8 |
| Фаза 5. Книга | Task 9, Task 10, Task 11 |
| Фаза 6. Редактор | Task 12, Task 13 |
| Фаза 7. Смежное и приёмка | Task 14, Task 15, Task 16 |

## Структура файлов

**Создаются:**

- `server/scorm/template/app/render/questions/scale.js` — обёртка рантайма пакета над
  `TBTemplate.renderScale` (по образцу `single.js`, без собственной разметки).
- `shared/template/__tests__/question-interaction.scale.test.ts` — тесты разметки шкалы.
- `docs/wireframes/approved/question-scale.html` — эскиз после согласования (перенос).

**Изменяются (дизайн-система):**

- `vendor/ui-kit/src/components/Stepper.tsx` — пропс `choice`, статус `success`.
- `vendor/ui-kit/src/components/Stepper.stories.tsx` — стори режима выбора.
- `vendor/ui-kit/css/university-rt.css` и `client/src/styles/vendor/university-rt.css` —
  правила `ou-stepper--choice`, `is-success`, `ou-stepper--review` (обе копии, иначе
  правило не доедет до приложения).

**Изменяются (модель и расчёт):**

- `shared/schema.ts` — `scale` в перечислениях типов вопроса.
- `shared/scoring/engine.ts` — проверка и градуированная оценка шкалы.
- `shared/scales/engine.ts` — вклад по варианту для шкалы.
- `server/utils/scoring-excel.ts` — формы градуированной цены для шкалы.
- `server/services/effective-scoring.ts` — измерительный режим (нулевая цена).
- `server/routes/attempts.ts` — агрегат результата с измерительными вопросами.

**Изменяются (рендер):**

- `shared/template/question-interaction.ts` — `renderScale`, подсказка типа, `answerTexts`.
- `shared/template/runtime-entry.ts` — экспорт `renderScale` в `TBTemplate`.
- `shared/template/preview-context.ts` — демонстрационная шкала в предпросмотре шаблона.
- `client/src/pages/learner/template-question-screen.tsx` — ветка типа.
- `client/src/components/template-screen.tsx` — клавиатура на шкале.
- `server/scorm/template/app/render/questions/index.js` — диспетчер типа.
- `server/scorm/template/app/utils/shuffle.js` — тождественный порядок для шкалы.
- `server/scorm/template/app/actions/answers.js` — клавиатура на шкале в пакете.
- `server/scorm/templates/default/styles/theme.css` — порог вертикальной раскладки.

**Изменяются (книга):**

- `server/services/questions-import.ts`, `server/services/questions-export.ts`.
- `server/services/workbook-import.ts`, `server/services/workbook-template.ts`.
- `server/routes/questions.ts` — текст справки по колонкам.

**Изменяются (клиент, авторский):**

- `client/src/features/questions/question-editor-drawer.tsx` — тип, градации, переключатель.
- `client/src/features/content/question-preview.tsx`, `content-filters.tsx`, `content-tree.tsx`.
- `client/src/features/tests/editor/sections/question-scoring-modal.tsx`,
  `scoring-builder.tsx`, `scoring-section.tsx`, `scales-api.ts` — тип в списках.
- `client/src/pages/learner/answer-gate.ts` — готовность ответа.
- `client/src/lib/i18n.ts` — строки нового типа.
- `client/src/pages/author/analytics.tsx`, `server/routes/analytics/helpers.ts`,
  `server/routes/analytics/attempts.ts` — распределение ответов.
- `server/scorm/debug-player/assets/inspector-compute.js` — шкала в инспекторе.

---

## Task 0: Согласование эскиза

Эскиз уже собран и проверен в браузере; задача — зафиксировать согласование.

**Files:**

- Move: `docs/wireframes/question-scale.html` → `docs/wireframes/approved/question-scale.html`

- [ ] **Step 1: Показать эскиз и получить согласование**

Поднять статический сервер из корня репозитория и открыть файл:

```bash
python -m http.server 8123
```

`http://localhost:8123/docs/wireframes/question-scale.html` — пять состояний в навбаре.
Согласовать выбранный вариант А на `Stepper`, формулировку подсказки типа (FR-17) и порог
числа градаций для вертикальной раскладки (FR-16).

- [ ] **Step 2: Проверить эскиз линтером дизайн-системы**

```bash
node scripts/check-wireframes-ds.mjs
```

Ожидаемо: по файлу `question-scale.html` нарушений нет (в чужих файлах их много —
грепать по своему).

- [ ] **Step 3: Перенести в approved и обновить шапку файла**

Заменить в шапке `Статус: НА СОГЛАСОВАНИИ` на `СОГЛАСОВАН <дата>`; путь в шапке —
`docs/wireframes/approved/question-scale.html`.

- [ ] **Step 4: Commit**

```bash
git add docs/wireframes/approved/question-scale.html docs/specs/prd-26/scale-question-type.md
git commit -m "docs(prd-26): спецификация и эскиз типа вопроса «шкала»"
```

---

## Task 1: Режим выбора у компонента Stepper

**Files:**

- Modify: `vendor/ui-kit/src/components/Stepper.tsx`
- Modify: `vendor/ui-kit/src/components/Stepper.stories.tsx`
- Modify: `vendor/ui-kit/css/university-rt.css`
- Modify: `client/src/styles/vendor/university-rt.css`

- [ ] **Step 1: Добавить статус `success` и пропс `choice`**

В `Stepper.tsx`: `StepperStatus` получает `'success'`; в className корня добавляется
`choice && 'ou-stepper--choice'` и `review && 'ou-stepper--review'`; в режиме `choice`
bullet рендерится ПУСТЫМ (ни `CheckIcon`, ни `ErrorIcon`, ни `ou-stepper__num`), статус
`success` даёт класс `is-success`. Пропсы документируются JSDoc на английском.

- [ ] **Step 2: Перенести правила режима из эскиза в CSS**

Взять блок `ou-stepper--choice` из `<style>` эскиза (он написан именно как будущий
DS-код) и положить в секцию `Stepper.css` бандла: размер bullet, пересчёт коннектора под
44px, переносимые подписи в масштабе `--tb-answer-fs`, нейтральная точка у `is-done`,
статус `is-success`, модификатор `ou-stepper--review`, вертикальный режим с bullet 28px.

- [ ] **Step 3: Продублировать правила во вторую копию бандла**

`client/src/styles/vendor/university-rt.css` — та же вставка. Проверить, что копии
совпадают по этому блоку:

```bash
node -e "const a=require('fs').readFileSync('vendor/ui-kit/css/university-rt.css','utf8'),b=require('fs').readFileSync('client/src/styles/vendor/university-rt.css','utf8');const re=/ou-stepper--choice[\s\S]*?ou-stepper--review[^}]*}/;console.log(String(a.match(re))===String(b.match(re))?'копии совпадают':'РАСХОЖДЕНИЕ')"
```

- [ ] **Step 4: Стори режима выбора**

В `Stepper.stories.tsx` — стори `Choice`: шесть градаций, выбрана третья, плюс варианты
«проверка: верно» и «проверка: неверно», плюс вертикальная раскладка.

- [ ] **Step 5: Проверка типов**

```bash
npm run check
```

- [ ] **Step 6: Commit**

```bash
git add vendor/ui-kit client/src/styles/vendor/university-rt.css
git commit -m "feat(ui-kit): режим выбора и статус success у Stepper"
```

---

## Task 2: Тип `scale` в схеме и валидации

**Files:**

- Modify: `shared/schema.ts`
- Modify: `client/src/lib/i18n.ts`

- [ ] **Step 1: Расширить перечисления**

В `shared/schema.ts` добавить `"scale"` во все четыре места, где перечислены типы:
колонка `questions.type`, две схемы валидации (строки около 1025 и 1097) и
`question_measurements.question_type`. Миграция НЕ создаётся: колонки объявлены как
`text NOT NULL` без `CHECK` — проверено по `drizzle/0000_baseline.sql` и всем
последующим миграциям.

- [ ] **Step 2: Строки интерфейса**

В `client/src/lib/i18n.ts` рядом с `singleChoice` добавить `scaleChoice: "Шкала"` и
строки редактора: подпись переключателя «Есть правильный ответ», заголовок списка
градаций, тексты ошибок валидации.

- [ ] **Step 3: Проверка типов — увидеть все точки ветвления**

```bash
npm run check
```

Компилятор укажет все `switch`/`case` по типу вопроса, где новая ветка обязательна. Этот
список — вход для Task 3; выписать его в комментарий к коммиту.

- [ ] **Step 4: Commit**

```bash
git add shared/schema.ts client/src/lib/i18n.ts
git commit -m "feat(prd-26): тип вопроса scale в схеме и строках интерфейса"
```

---

## Task 3: Ревизия точек ветвления по типу вопроса

Задача-страховка против риска R-1: ветвление рассыпано примерно по сорока файлам, и
пропущенная ветка даёт молчаливый сбой, а не ошибку компиляции (много веток написано
через `if (type === '...')` в `.js` рантайма пакета).

**Files:**

- Review only; правки делаются задачами 4–14 по месту.

- [ ] **Step 1: Собрать полный список точек**

```bash
grep -rn "'ranking'\|\"ranking\"" --include=*.ts --include=*.tsx --include=*.js shared server client | grep -v __tests__
```

- [ ] **Step 2: Разметить каждую точку одним из трёх решений**

Для каждой точки записать в рабочую заметку: «шкала ведёт себя как single» (большинство),
«шкале нужна отдельная ветка» (рендер, перемешивание, измерительный режим) или «шкала
не участвует» (например, drag-and-drop). Заметка живёт в
`docs/plans/notes/prd26-type-branch-points.md`.

- [ ] **Step 3: Свести список к задачам**

Убедиться, что каждая точка из заметки закрыта одной из задач 4–14. Точки без задачи —
дополнить план до начала реализации.

---

## Task 4: `renderScale` в общем модуле разметки

**Files:**

- Modify: `shared/template/question-interaction.ts`
- Create: `shared/template/__tests__/question-interaction.scale.test.ts`

- [ ] **Step 1: Подсказка типа и тексты ответов**

В `QUESTION_HINTS` добавить `scale: "Выберите ответ на шкале"`. В `answerTexts` вернуть
для `scale` подписи градаций (`dataJson.options`), чтобы подгонка шрифта учитывала самую
длинную подпись.

- [ ] **Step 2: Реализовать `renderScale`**

Подпись по образцу остальных: `(question, answer, review?)` — `shuffleMapping` шкале не
нужен (порядок фиксирован, FR-04). Порождает разметку `Stepper` в режиме выбора:

- корень `ou-stepper ou-stepper--choice` (+ `ou-stepper--vertical` при числе градаций
  больше семи, + `ou-stepper--review` в режиме проверки), `role="radiogroup"`;
- градация — `button.ou-stepper__step.ou-stepper__step--btn` с `role="radio"`,
  `aria-checked`, `data-action="select:<индекс>"`, `data-index`;
- внутри — пустой `span.ou-stepper__bullet` и
  `span.ou-stepper__label > span.ou-stepper__title` с подписью через `answerHtml`;
- статусы: индексы до выбранного — `is-done`, выбранный — `is-current`; в режиме
  проверки правильный — `is-success`, ошибочно выбранный — `is-error`.

Литеральных размеров не вводить: подпись берёт размер из `--tb-answer-fs` правилами DS.

- [ ] **Step 3: Тесты разметки**

Новый файл тестов: не отвечено, выбрана градация (проверить `is-done` до неё и
`is-current` на ней), проверка «верно», проверка «неверно», вертикальная раскладка при
восьми градациях, экранирование разметки в подписи, отсутствие `is-*` статусов вне
режима проверки.

```bash
npx vitest run shared/template/__tests__/question-interaction.scale.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add shared/template/question-interaction.ts shared/template/__tests__/question-interaction.scale.test.ts
git commit -m "feat(prd-26): общая разметка шкалы renderScale"
```

---

## Task 5: Веб-хост — шкала на экране вопроса

**Files:**

- Modify: `client/src/pages/learner/template-question-screen.tsx`
- Modify: `client/src/components/template-screen.tsx`
- Modify: `client/src/pages/learner/answer-gate.ts`

- [ ] **Step 1: Ветка типа в `interactionHtml`**

Импортировать `renderScale` и добавить ветку `if (question.type === "scale")` ДО
возврата по умолчанию (сейчас функция падает в `renderSingleChoice`).

- [ ] **Step 2: Готовность ответа**

В `answer-gate.ts` добавить `case "scale"` рядом с `case "single"`: ответ дан, когда
выбрана градация (значение — число).

- [ ] **Step 3: Клавиатура**

В обработчике делегированных событий (`template-screen.tsx`) для корня
`.ou-stepper--choice`: стрелки влево/вправо (в вертикальной раскладке вверх/вниз)
переводят выбор на соседнюю градацию, пробел и Enter подтверждают текущую. Обработка не
должна ломать существующую навигацию по экрану.

- [ ] **Step 4: Тесты**

Расширить существующие тесты экрана вопроса (`client/src/pages/learner/__tests__/`):
рендер шкалы, выбор градации кликом, выбор стрелками, разблокировка кнопки «Далее».

```bash
npx vitest run client/src/pages/learner/__tests__
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/learner client/src/components/template-screen.tsx
git commit -m "feat(prd-26): шкала на веб-экране вопроса"
```

---

## Task 6: SCORM-пакет — шкала в рантайме

**Files:**

- Create: `server/scorm/template/app/render/questions/scale.js`
- Modify: `server/scorm/template/app/render/questions/index.js`
- Modify: `server/scorm/template/app/utils/shuffle.js`
- Modify: `server/scorm/template/app/actions/answers.js`
- Modify: `shared/template/runtime-entry.ts`
- Modify: `server/scorm/templates/default/styles/theme.css`

- [ ] **Step 1: Экспортировать `renderScale` в `TBTemplate`**

В `shared/template/runtime-entry.ts` добавить `renderScale` в объект, публикуемый как
глобальный `TBTemplate` (иначе обёртка пакета получит `undefined`).

- [ ] **Step 2: Обёртка рантайма**

`scale.js` — копия структуры `single.js`: берёт `window.TBTemplate.renderScale`,
собственной разметки не содержит. JSDoc-модуль на английском, как у соседей.

- [ ] **Step 3: Диспетчер и перемешивание**

В `render/questions/index.js` добавить ветку `if (q.type === 'scale')`. В
`utils/shuffle.js` — ветка `scale`, возвращающая тождественный порядок (порядок градаций
содержателен, FR-04).

- [ ] **Step 4: Клавиатура в пакете**

В `actions/answers.js` — та же обработка стрелок, что в вебе. Реализация должна быть
эквивалентной по поведению; если логика выбора соседней градации нетривиальна, вынести
её в общий модуль и вызвать из обоих хостов.

- [ ] **Step 5: Порог вертикальной раскладки**

В `theme.css` шаблона — медиазапрос: при ширине колонки ответов до 640px корень
`.ou-stepper--choice` переключается в вертикальную раскладку. Правило живёт в слое сцены
шаблона — единственном общем источнике оформления для обоих хостов.

- [ ] **Step 6: Пересобрать пакет и проверить в плеере**

```bash
npm run scorm:template
npm run scorm:player
```

Пройти шкальный вопрос в локальном плеере на `:5050`; сверить порождённый HTML шкалы с
веб-хостом (требование паритета PRD-12: разметка обоих хостов совпадает).

- [ ] **Step 7: Commit**

```bash
git add server/scorm shared/template/runtime-entry.ts
git commit -m "feat(prd-26): шкала в рантайме SCORM-пакета"
```

---

## Task 7: Проверка и градуированная оценка шкалы

**Files:**

- Modify: `shared/scoring/engine.ts`
- Modify: `server/utils/scoring-excel.ts`
- Modify: `server/scorm/template/app/scoring/engine.js`

- [ ] **Step 1: Проверка в проверяемом режиме**

В `exactCorrect` (`shared/scoring/engine.ts`) ветка `single` расширяется на `scale`:
ответ верен, когда индекс равен `correct.correctIndex`. То же в
`server/scorm/template/app/scoring/engine.js` (ветка `type === 'single'`).

- [ ] **Step 2: Градуированные веса**

В `scoring-excel.ts` тип `ScoringQuestionType` получает `scale`, а три проверки
`type !== "single"` / `type === "single"` (строки около 139, 168, 199) — допускают
`scale`: обе формы (`веса: …` и `%A2B1C1D0`) работают для шкалы так же.

- [ ] **Step 3: Тесты**

Расширить существующие тесты движка: верный и неверный ответ шкалы, градуированные веса
по градациям, максимум вопроса равен наибольшему весу.

```bash
npx vitest run shared/scoring server/utils
```

- [ ] **Step 4: Commit**

```bash
git add shared/scoring server/utils/scoring-excel.ts server/scorm/template/app/scoring/engine.js
git commit -m "feat(prd-26): проверка и градуированная оценка шкалы"
```

---

## Task 8: Измерительный режим в агрегате результата

Самая рискованная задача (риск R-2): ошибка портит процент и зачёт у обычных тестов.

**Files:**

- Modify: `shared/scoring/engine.ts` (или модуль агрегата `aggregateStandardResult`)
- Modify: `server/routes/attempts.ts`
- Modify: `server/services/effective-scoring.ts`
- Modify: `shared/scales/engine.ts`

- [ ] **Step 1: Признак измерительного вопроса**

Ввести чистый помощник `isMeasurementOnly(question)`: тип `scale` и отсутствие
`correctJson.correctIndex`. Помощник живёт в `shared/scoring/` и используется ОБОИМИ
хостами и сервером — дублировать условие по месту запрещено.

- [ ] **Step 2: Исключить из подсчёта**

В агрегате результата измерительный вопрос даёт ноль заработанных и ноль возможных
баллов и не увеличивает ни число вопросов, ни число верных ответов. Найти точку через
`aggregateStandardResult` (используется в `server/routes/attempts.ts`, около строки 1067)
и правило применить ТАМ, а не в вызывающем коде.

- [ ] **Step 3: Раздел и тест без проверяемых вопросов**

Если у раздела все вопросы измерительные, раздел не получает процента и порога (FR-09).
Если таких разделов весь тест — процент и зачёт теста не показываются; статусом
управляет показатель PRD-2.

- [ ] **Step 4: Вклад в шкалы**

В `shared/scales/engine.ts` ветки `qType === "single"` (строки около 81 и 186)
расширяются на `scale`: вклад по варианту читается по индексу выбранной градации.

- [ ] **Step 5: Тесты**

Ключевые случаи: раздел только из измерительных вопросов; смешанный раздел (процент
считается по проверяемым); шкальный вопрос с правильным ответом (участвует как обычный);
вклад в шкалу от измерительного вопроса присутствует.

```bash
npx vitest run shared/scoring shared/scales
```

- [ ] **Step 6: Commit**

```bash
git add shared/scoring shared/scales server/routes/attempts.ts server/services/effective-scoring.ts
git commit -m "feat(prd-26): измерительный режим шкалы в агрегате результата"
```

---

## Task 9: Импорт и экспорт листа «Вопросы»

**Files:**

- Modify: `server/services/questions-import.ts`
- Modify: `server/services/questions-export.ts`

- [ ] **Step 1: Тип в карте импорта**

В `typeFromExcel` добавить `scale: "scale"`. Тип `QuestionType` в этом модуле расширить.

- [ ] **Step 2: Правило колонки правильных ответов**

Для `scale`: пустая колонка — `correctJson = null` (измерительный режим); один номер —
`{ correctIndex: n - 1 }`; несколько номеров — ошибка строки с текстом, объясняющим, что
у шкалы правильная градация одна или её нет вовсе.

- [ ] **Step 3: Игнорировать следование вариантов**

Значение колонки «Следование вариантов ответов» для `scale` не применяется; при значении
`Random` строка попадает в предупреждения импорта (не в ошибки).

- [ ] **Step 4: Экспорт**

В `questions-export.ts` карта `single: "multiple_choice"` дополняется `scale: "scale"`;
проверить круговой обход: экспорт → импорт даёт тот же вопрос, включая измерительный
режим.

- [ ] **Step 5: Тесты**

```bash
npx vitest run server/services/__tests__
```

Случаи: импорт шкалы без правильного ответа, с одним, с двумя (ошибка), предупреждение
на `Random`, круговой обход экспорт-импорт.

- [ ] **Step 6: Commit**

```bash
git add server/services/questions-import.ts server/services/questions-export.ts
git commit -m "feat(prd-26): импорт и экспорт шкальных вопросов"
```

---

## Task 10: Листы «Оценка» и «Вклады вопросов»

**Files:**

- Modify: `server/services/workbook-import.ts`

- [ ] **Step 1: Градуированная цена для шкалы**

Разрешить формы `веса: …` и `%A…` для шкального вопроса (парсер уже расширен в Task 7).
Для вопроса в измерительном режиме заполненные «Балл» и «Цена ответа» дают
предупреждение: значения сохраняются, но в расчёте не участвуют.

- [ ] **Step 2: Вклады по градациям**

Проверить, что лист «Вклады вопросов» принимает `источник = вариант` для шкалы без
правок формата: ключ источника — индекс градации с нуля. Если валидация источника
опирается на тип вопроса, расширить её.

- [ ] **Step 3: Тесты**

```bash
npx vitest run server/services/__tests__
```

- [ ] **Step 4: Commit**

```bash
git add server/services/workbook-import.ts
git commit -m "feat(prd-26): шкала в листах «Оценка» и «Вклады вопросов»"
```

---

## Task 11: Шаблон книги и справка

**Files:**

- Modify: `server/services/workbook-template.ts`
- Modify: `server/routes/questions.ts`

- [ ] **Step 1: Описание типа в справке**

В `workbook-template.ts` в описании колонки «Тип вопроса» добавить `scale (шкала)`; в
описании колонки «Номера правильных ответов» — правило пустой колонки для шкалы; в
описании «Цена ответа» — что `веса` применимы и к шкале.

- [ ] **Step 2: Строка примера**

Добавить в лист «Пример» строку шкального вопроса: шесть градаций через `#`, пустая
колонка правильных ответов, вклад в шкалу в соответствующем листе.

- [ ] **Step 3: Текст справки роута**

В `server/routes/questions.ts` (около строк 504–517) обновить подсказки по колонкам: тип
`scale` и его формат.

- [ ] **Step 4: Скачать шаблон и проверить глазами**

```bash
npm run dev
```

Скачать шаблон книги из интерфейса импорта, открыть, проверить лист-справку и лист
«Пример».

- [ ] **Step 5: Commit**

```bash
git add server/services/workbook-template.ts server/routes/questions.ts
git commit -m "docs(prd-26): шкала в шаблоне книги и справке импорта"
```

---

## Task 12: Редактор шкального вопроса

**Files:**

- Modify: `client/src/features/questions/question-editor-drawer.tsx`

- [ ] **Step 1: Тип в списке и схема формы**

В `questionTypes` добавить `{ value: "scale", label: t.questions.scaleChoice }`; в
`z.enum` формы — `"scale"`.

- [ ] **Step 2: Состояние градаций**

Переиспользовать структуру одиночного выбора: список подписей и индекс правильной
градации. Отдельного набора состояний не заводить, если структура совпадает —
`dataJson` у типов идентичен.

- [ ] **Step 3: Переключатель правильного ответа**

DS `Switch` «Есть правильный ответ», выключен по умолчанию. При выключенном переключателе
выбор правильной градации скрыт, а при сохранении `correctJson` равен `null`. При
выключении ранее выбранная градация забывается.

- [ ] **Step 4: Перенос при смене типа**

В существующей логике переноса (`next === "single"` и соседние ветки) добавить
`single ↔ scale`: подписи и правильная позиция переносятся, переключатель правильного
ответа при переходе на `scale` сам не включается.

- [ ] **Step 5: Валидация**

Не менее двух градаций, все подписи непустые; в проверяемом режиме правильная градация
обязательна. Тексты ошибок — из `i18n`.

- [ ] **Step 6: Тесты**

```bash
npx vitest run client/src/features/questions
```

Случаи: создание измерительной шкалы, включение переключателя и выбор градации,
выключение переключателя (сброс), смена типа с переносом, ошибки валидации.

- [ ] **Step 7: Commit**

```bash
git add client/src/features/questions
git commit -m "feat(prd-26): редактор шкального вопроса"
```

---

## Task 13: Шкала в остальном авторском интерфейсе

**Files:**

- Modify: `client/src/features/content/question-preview.tsx`
- Modify: `client/src/features/content/content-filters.tsx`
- Modify: `client/src/features/content/content-tree.tsx`
- Modify: `client/src/features/tests/editor/sections/question-scoring-modal.tsx`
- Modify: `client/src/features/tests/editor/sections/scoring-builder.tsx`
- Modify: `client/src/features/tests/editor/sections/scoring-section.tsx`
- Modify: `client/src/features/tests/editor/scales-api.ts`

- [ ] **Step 1: Предпросмотр вопроса**

Показать градации в содержательном порядке; в измерительном режиме не рисовать отметку
правильного ответа.

- [ ] **Step 2: Фильтр и дерево**

Новый тип в фильтре по типу и в подписях дерева содержимого.

- [ ] **Step 3: Оценка в редакторе теста**

Конструктор градуированной оценки и модальное окно переопределения принимают шкалу
наравне с одиночным выбором; для измерительной шкалы поля цены неактивны с пояснением.

- [ ] **Step 4: Проверка типов и тесты**

```bash
npm run check
npx vitest run client/src/features
```

- [ ] **Step 5: Commit**

```bash
git add client/src/features
git commit -m "feat(prd-26): шкала в авторском интерфейсе"
```

---

## Task 14: Аналитика, инспектор и предпросмотр шаблона

**Files:**

- Modify: `server/routes/analytics/helpers.ts`
- Modify: `server/routes/analytics/attempts.ts`
- Modify: `client/src/pages/author/analytics.tsx`
- Modify: `server/scorm/debug-player/assets/inspector-compute.js`
- Modify: `shared/template/preview-context.ts`

- [ ] **Step 1: Распределение ответов**

Шкала обрабатывается как одиночный выбор; измерительные вопросы исключаются из
показателей верности, но остаются в распределении ответов по градациям.

- [ ] **Step 2: Инспектор тестового прогона**

Шкальный вопрос виден в протоколе и в выдаче; в измерительном режиме поле верности
пустое, вклад в шкалы виден на вкладке «Шкалы».

- [ ] **Step 3: Предпросмотр шаблона**

В `preview-context.ts` добавить демонстрационный шкальный вопрос, чтобы проверка
работоспособности шаблона в админке показывала новый интерактив.

- [ ] **Step 4: Тесты**

```bash
npx vitest run server/routes/analytics shared/template
```

- [ ] **Step 5: Commit**

```bash
git add server/routes/analytics client/src/pages/author/analytics.tsx server/scorm/debug-player shared/template/preview-context.ts
git commit -m "feat(prd-26): шкала в аналитике, инспекторе и предпросмотре шаблона"
```

---

## Task 15: Приёмочный импорт опросника выгорания

**Files:**

- Modify: `docs/references/workbook_Выгорание_Маслач.xlsx` (рабочая копия в
  `.playwright-mcp/`, референс не трогать)

- [ ] **Step 1: Подготовить книгу**

Сделать рабочую копию референс-книги, в листе «Вопросы» сменить тип 22 строк на `scale` и
очистить колонку «Номера правильных ответов» (там сейчас формальные единицы).

- [ ] **Step 2: Импортировать в тест**

Поднять приложение, создать тест, импортировать книгу. Ожидаемо: 22 шкальных вопроса,
три шкалы, показатель `burnout_level`, ошибок нет.

- [ ] **Step 3: Пройти тест в браузере**

Приёмка фронтенда обязана идти в реальном браузере. Пройти опросник, проверить: шкала
рисуется дорожкой, порядок градаций не перемешивается между вопросами, процент и зачёт
не показываются, показатель «Состояние» вычислен.

- [ ] **Step 4: Выгрузить SCORM и пройти в плеере**

```bash
npm run scorm:player
```

Сверить поведение с вебом: разметка шкалы, значения шкал, показатель.

- [ ] **Step 5: Зафиксировать результат приёмки**

Скриншоты — в `.playwright-mcp/` (git-ignored). Итог приёмки записать в
`docs/reports/`.

---

## Task 16: Финальная проверка

- [ ] **Step 1: Полный прогон проверок**

```bash
npm run check
npm test
```

Порог покрытия 80% не должен упасть. Покрытие поднимать только по коду этой задачи.

- [ ] **Step 2: Интеграционные тесты DAL**

```bash
npm run test:it
```

- [ ] **Step 3: Обновить статус спецификации**

В `docs/specs/prd-26/scale-question-type.md` заменить статус на
`РЕАЛИЗОВАН <дата>`; при расхождениях реализации со спецификацией — сначала правка
спецификации, потом коммит.

- [ ] **Step 4: Commit**

```bash
git add docs/specs/prd-26/scale-question-type.md
git commit -m "docs(prd-26): статус спецификации — реализован"
```
