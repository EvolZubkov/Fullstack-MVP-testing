# PRD-30 (расширение): порядок выдачи на уровне теста

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать тесту собственную настройку порядка выдачи («фиксированный» / «перемешивание» /
«полное перемешивание»), сделать настройку темы переопределением этого умолчания и вернуть
перемешивание вопросов поперёк тем — уже как явный выбор автора, а не как скрытый проход рантайма.

**Architecture:** Порядок определяется один раз, при выдаче, в `shared/draw`. Оба хоста зовут одно
правило: веб — напрямую (`server/routes/attempts.ts`), пакет — через плоский JS-двойник
(`server/scorm/assets/app.js`), паритет закрывается golden-тестом по образцу
`tests/order-questions-port.test.ts`. Настройка теста живёт в новой колонке `tests.question_order`,
настройка темы (`test_sections.question_order`) становится nullable и означает «как в тесте».

**Tech Stack:** TypeScript (Node/Express, Drizzle, Zod), React 19 + `@universityrt/ui-kit`, Vitest
(`npm test`), plain-JS рантайм SCORM, ExcelJS. Спецификация:
[docs/specs/prd-30/question-order.md](../specs/prd-30/question-order.md), раздел 14.

---

## Предыстория (сделано до плана, в рабочей копии)

Снят безусловный второй проход перемешивания в рантайме пакета
(`server/scorm/assets/app.js`, ветка `linear_flat`): он стирал уже выстроенный порядок темы, а веб-хост
такого прохода не имел вовсе — один и тот же тест шёл в двух хостах по-разному. Закреплено
`tests/scorm-question-order-flat.test.ts`. Предупреждение редактора «порядок не сохранится» убрано.
Этот шаг — фундамент плана: перемешивание должно быть в ОДНОМ месте, и `shuffle_all` возвращает
смешивание поперёк тем именно туда, а не вторым проходом.

## Roadmap (этапы спецификации → задачи плана)

| Этап | Задачи |
| --- | --- |
| Э8 — эскиз | Task 1 |
| Э9 — схема и миграция | Task 2 |
| Э10 — движок | Task 3 |
| Э11 — веб | Task 4 |
| Э12 — пакет SCORM | Task 5, Task 6 |
| Э13 — редактор | Task 7 |
| Э14 — книга Excel | Task 8 |
| Э15 — приёмка | Task 9 |

Task 1 — обязательный пререквизит для Task 7 (правило проекта: UI только по утверждённому эскизу).
Task 2 — пререквизит для всех остальных. Task 3 — пререквизит для Task 4, 5, 8.

**Naming contract (единые имена во всех задачах):**

- `TestQuestionOrder = "fixed" | "random" | "shuffle_all"` — значение теста (`tests.question_order`).
- `SectionQuestionOrder = "random" | "fixed" | null` — переопределение темы (`null` = как в тесте).
- `effectiveSectionOrder(test, section): "random" | "fixed"` — действующий режим темы.
- `assembleDelivery(sections, testOrder, flowMode, shuffleFn)` — сборка потока, возвращает плоский
  список вопросов в порядке выдачи.

---

## Task 1: Эскиз (Э8) — ГОТОВО, согласован 2026-08-03

**Files:**

- Created: `docs/wireframes/approved/prd30-test-level-order.html`
- Reference: `docs/wireframes/approved/prd30-question-order.html`, `approved/prd17-test-variants.html`

**Step 1:** Взять состояния темы из утверждённого `prd30-question-order.html` без переделки: контрол
темы получает третью позицию «как в тесте», остальная анатомия строки не меняется.

**Step 2:** Показать контрол теста в трёх состояниях и в двух режимах прохождения (сплошной — три
позиции, секционный — две). Подписи значений вынести на согласование: спека фиксирует смысл, не текст.

**Step 3:** Показать состояние «тема переопределяет тест» — по нему автор должен видеть, что значение
теста на эту тему не действует.

**Verification:**

- [x] Эскиз собран на реальной разметке ДС (`ou-*`/`tb-*`), локальных render-классов нет
- [x] Скриншот снят в браузере (пять состояний, светлая и тёмная темы), гард `check-wireframes-ds.mjs` чист
- [x] Эскиз согласован владельцем и перенесён в `docs/wireframes/approved/`

## Task 2: Схема и миграция (Э9) — ГОТОВО

**Files:**

- Create: `drizzle/0011_prd30_test_level_order.sql`
- Modify: `shared/schema.ts` (таблицы `tests`, `testSections`)
- Test: `tests/schema-prd30.test.ts` (или соседний файл схемы)

**Step 1:** `ALTER TABLE tests ADD COLUMN question_order text DEFAULT 'random' NOT NULL`.

**Step 2:** `ALTER TABLE test_sections ALTER COLUMN question_order DROP NOT NULL`, `DROP DEFAULT`,
затем `UPDATE test_sections SET question_order = NULL WHERE question_order = 'random'` — явные `fixed`
остаются переопределением, поведение существующих тестов не меняется.

**Step 3:** Обновить Zod-типы вставки/обновления; `questionOrder` темы становится `nullable`.

**Verification:**

- [ ] `npm run db:generate` даёт ровно одну миграцию, снапшот согласован
- [ ] Тесты DAL: чтение NULL как «наследует», запись переопределения, запись значения теста

## Task 3: Движок сборки (Э10) — ГОТОВО

**Files:**

- Modify: `shared/draw/order-questions.ts` (или Create: `shared/draw/assemble-delivery.ts`)
- Test: `tests/order-questions.test.ts`, Create: `tests/assemble-delivery.test.ts`

**Step 1:** `effectiveSectionOrder` — переопределение темы, иначе `fixed` у теста → `fixed`, иначе
`random` (спека 14.4).

**Step 2:** `assembleDelivery`: при `fixed`/`random` — темы блоками в авторском порядке; при
`shuffle_all` — единицы (вопрос темы с действующим `random` = единица, тема с `fixed` = одна неразрывная
единица), перемешивание единиц, разворачивание. `shuffle_all` в секционном режиме исполняется как
`random`.

**Step 3:** Юнит-тесты: наследование, переопределение, блок не рвётся, все темы фиксированы, одна тема,
пустой список, секционный режим гасит `shuffle_all`.

**Verification:**

- [ ] Отбор и квоты PRD-11 не тронуты (FR-06): вход функции — уже отобранные вопросы
- [ ] `npm test -- tests/assemble-delivery.test.ts tests/order-questions.test.ts`

## Task 4: Веб-сборка попытки (Э11) — ГОТОВО

**Files:**

- Modify: `server/routes/attempts.ts` (сборка варианта, ~строки 400-430; адаптивная ветка ~570-590)
- Test: `tests/routes.attempts-question-order.test.ts`

**Step 1:** Прокинуть значение теста в сборку и заменить поштучный `orderQuestions` на `assembleDelivery`.

**Step 2:** Сохранить форму `variant.sections[].questionIds` — от неё зависят экраны разделов, обзор и
итоги; при `shuffle_all` состав секции остаётся прежним, меняется порядок плоского потока.

**Verification:**

- [ ] Тесты маршрута: наследование, переопределение, `shuffle_all` c фиксированной темой
- [ ] Секционные режимы не меняют поведения

## Task 5: Выпечка в пакет (Э12) — ГОТОВО

**Files:**

- Modify: `server/scorm/builders/test-json.ts`
- Test: `tests/scorm-question-order.test.ts`

**Step 1:** Печь `questionOrder` теста и наследование темы; поля опускаются, когда тест не трогал
настройку — пакет остаётся байт-идентичным прежнему (FR-23, приём `shuffleAnswers`).

## Task 6: JS-двойник рантайма (Э12) — ГОТОВО

**Files:**

- Modify: `server/scorm/assets/app.js` (`generateVariant`)
- Test: Create `tests/assemble-delivery-port.test.ts`, Modify `tests/scorm-question-order-flat.test.ts`

**Step 1:** Перенести `effectiveSectionOrder`/`assembleDelivery` в плоский JS рядом с `orderQuestions`.

**Step 2:** Golden-тест паритета: одинаковый вход и одинаковая перестановка дают одинаковый выход у
TS-движка и у двойника.

**Verification:**

- [ ] Второго прохода перемешивания в рантайме не появилось — единственное место сборки

## Task 7: Редактор (Э13) — КОД ГОТОВ, браузерная приёмка впереди

**Files:**

- Modify: `client/src/features/tests/editor/sections/topics-structure-section.tsx`
- Modify: `client/src/features/tests/editor/test-editor.types.ts`, `test-editor.mappers.ts`
- Modify: `server/routes/tests.ts` (Zod-приём), `server/services/test-settings.ts`
- Test: `client/src/features/tests/editor/sections/__tests__/topics-structure-question-order.test.tsx`

**Step 1:** Контрол теста по утверждённому эскизу; в секционных режимах две позиции, при переходе в
секционный режим `shuffle_all` переписывается в `random` (FR-17).

**Step 2:** Контрол темы — три позиции, умолчание «как в тесте».

**Verification:**

- [ ] Приёмка в реальном браузере (Playwright), а не только jsdom
- [ ] `npm run check`

## Task 8: Книга Excel (Э14) — ГОТОВО

**Files:**

- Modify: `server/utils/workbook-sheets.ts`, `server/services/workbook-import.ts`,
  `server/routes/tests-workbook.ts`
- Test: `tests/workbook-question-order.test.ts`, `tests/routes.tests-workbook-question-order.test.ts`

**Step 1:** Лист «Настройки» (параметр/значение) для правила теста; на листе «Структура» пустая ячейка читается как
«как в тесте» (сейчас — как `да`).

**Verification:**

- [ ] Обратимость экспорт → импорт, книга без новых колонок импортируется как раньше

## Task 9: Приёмка (Э15)

**Step 1:** Веб: многотемный сплошной тест при `shuffle_all` с одной фиксированной темой — блок целиком,
место случайное; смена значения теста двигает ненастроенные темы.

**Step 2:** Пакет: тот же тест в локальном плеере (`npm run scorm:template`, `npm run scorm:player`).

**Step 3:** Отладчик PRD-18: та же последовательность из живого состояния.

**Step 4:** Обновить `docs/ROADMAP.md` и спеку (раздел 14 — статус этапов).

**Verification:**

- [ ] Веб и пакет дают одинаковую выдачу при одинаковом входе (FR-21)
- [ ] Тест, не трогавший настройку, выдаётся как раньше (FR-23)
