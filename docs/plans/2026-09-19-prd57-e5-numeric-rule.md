# Числовое правило (PRD-57, этап Э5): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** довести числовое правило до требований §6.6 — операторы, допуски, обыкновенные дроби,
расшифровка словами, подсказка формата, ступенчатый балл по точности и гистограмма значений.

**Architecture:** правило остаётся видом правила из набора `shared/answer-check/` (Э4), поэтому
сравнение по-прежнему одно на оба хоста и уезжает в пакет через `runtime-entry.ts`. Новое делится
на три слоя: чистый разбор и сравнение (`shared/answer-check/number.ts`), текст для автора
(`client/.../describe-rule.ts`, в пакет не едет), счётчики и аналитика (существующие
`shared/scoring/engine.ts` и `server/services/analytics/answer-spread.ts`, новых ручек нет).

**Tech Stack:** TypeScript, Zod, React 19, `@universityrt/ui-kit`, Vitest.

**Устройство согласовано:**
[docs/specs/2026-09-19-prd57-e5-numeric-rule-design.md](../specs/2026-09-19-prd57-e5-numeric-rule-design.md).
Требования: [PRD-57](../specs/prd-57/open-response-and-formatting.md) §6.6.
Эскиз: `docs/wireframes/approved/prd57-answer-rule.html`, состояния `k-number`, `k-frac`.

**Границы этапа.** Не делается: регулярные выражения (Э7), проба ответа (Э6), пропуски (Э8),
взаимодействие `numeric` в LMS и конверсия единиц (вне охвата трека и завершающий этап).

---

## Карта файлов

| Файл | Ответственность |
| --- | --- |
| `shared/answer-check/number.ts` | разбор числа (дроби, научная нотация), операторы, допуск |
| `shared/answer-check/rules.ts` | без изменений по смыслу: набор уже отдаёт по-правильные исходы |
| `shared/schema.ts` | `op` в схеме числового правила: шесть операторов вместо одного |
| `shared/scoring/engine.ts` | `countTallies` у текстового ввода считает ВЫПОЛНЕННЫЕ правила |
| `shared/template/question-interaction.ts` | подсказка формата и «ожидается число» у поля |
| `shared/template/short-answer-dom.ts` | переключение подсказки между перерисовками |
| `client/src/features/questions/answer-rules/describe-rule.ts` | расшифровка правила словами |
| `client/src/features/questions/answer-rules/answer-rules-block.tsx` | поля правила: оператор, значение, допуск |
| `client/src/features/tests/editor/sections/scoring-builder.tsx` | ступени для текстового ввода: `c` = правила |
| `server/services/analytics/answer-spread.ts` | гистограмма значений вместо частотной таблицы |
| `server/routes/analytics/test-details.ts` | вид ответа берётся из `correct_json` задания |

---

## Task 1: Разбор числа

**Files:**

- Modify: `shared/answer-check/number.ts`
- Test: `tests/answer-check-number.test.ts`

- [x] **Step 1: Падающие тесты**

Дописать к существующему набору: `1/3` читается как треть; `2 1/2` — два с половиной;
`-2 1/2` — минус два с половиной; `1/2`, `0,5` и `.5` дают одно значение; `3.14e0` и `1E-3`
читаются; `1 500` — полторы тысячи; `1 500/3` — смешанная дробь (одна целая и пятьсот третьих);
`1/0` — `null`; `около трёх` — `null`; неразрывный и узкий неразрывный пробел внутри числа
снимаются; знак минус `−` равен дефису.

- [x] **Step 2: Реализация**

Порядок разбора: смешанная дробь, затем обыкновенная, затем десятичное/научное со схлопыванием
пробелов. Пробелы схлопываются ТОЛЬКО на третьем шаге, иначе `2 1/2` превратится в `21/2`.

- [x] **Step 3: Проверка** — `npm test -- tests/answer-check-number.test.ts`

## Task 2: Операторы и допуск

**Files:**

- Modify: `shared/answer-check/number.ts`, `shared/schema.ts`
- Test: `tests/answer-check-number.test.ts`, `tests/answer-check-schema.test.ts`

- [x] **Step 1: Падающие тесты**

`gt`/`gte`/`lt`/`lte` различают включённую и исключённую границу; `ne` без допуска отвергает
равное значение и принимает остальные; `ne` С допуском отвергает всё окно; допуск в процентах
считается от модуля значения (отрицательный эталон сохраняет положительное окно); допуск у
границы игнорируется; схема принимает шесть операторов и отвергает седьмой.

- [x] **Step 2: Реализация**

`NumericRule.op` — `"eq" | "ne" | "gt" | "gte" | "lt" | "lte"`; `matchNumber` ветвится по
оператору; окно допуска считается одной функцией и используется в `eq` и `ne`.

- [x] **Step 3: Проверка** — оба набора.

## Task 3: Расшифровка словами

**Files:**

- Create: `client/src/features/questions/answer-rules/describe-rule.ts`
- Test: `tests/answer-rules-describe.test.ts`

- [x] **Step 1: Падающие тесты**

«равно −25 с допуском 2 в единицах» → «Засчитывается ответ от −27 до −23 °C»; «равно 1500,
допуск 2 %» → «от 1470 до 1530»; «больше или равно 0,5» → «Засчитывается ответ не меньше 0,5»;
«не равно 0» → «Засчитывается любой ответ, кроме 0»; правило без единицы не печатает пустого
хвоста; числа печатаются с запятой.

- [x] **Step 2: Реализация**

Модуль отдаёт две строки: заголовок свёрнутой строки правила (`равно −25 °C`) и расшифровку под
условием. Форматирование числа — своя функция: запятая, минус, без хвостовых нулей.

- [x] **Step 3: Проверка** — `npm test -- tests/answer-rules-describe.test.ts`

## Task 4: Поля правила в ящике вопроса

**Files:**

- Modify: `client/src/features/questions/answer-rules/answer-rules-block.tsx`
- Test: `tests/answer-rules-block.test.tsx`

- [x] **Step 1: Падающие тесты**

Список операторов открыт и содержит шесть пунктов в порядке эскиза; выбор `больше` убирает поле
допуска; значение принимает `1/3` и `-25` и сохраняется в правиле числом; под условием стоит
расшифровка; свёрнутая строка называет оператор, а не только «равно».

- [x] **Step 2: Реализация**

`Select` оператора перестаёт быть `disabled`; поле значения хранит СТРОКУ пока автор печатает и
отдаёт число при разборе (иначе `1/` посреди набора обнулит правило); поле допуска показывается
только для `eq` и `ne`.

- [x] **Step 3: Проверка** — `npm test -- tests/answer-rules-block.test.tsx`

## Task 5: Подсказка формата у поля участника

**Files:**

- Modify: `shared/template/question-interaction.ts`, `shared/template/short-answer-dom.ts`
- Test: `tests/answer-check-render.test.ts`, `tests/short-answer-dom.test.ts`

- [x] **Step 1: Падающие тесты**

Числовое поле несёт `data-answer-kind="number"` и подпись «Введите число»; при ответе, который не
разбирается, печатается сообщение «Ожидается число»; при разбираемом — не печатается; текстовое
поле не получает ни того, ни другого; привязка переключает сообщение на вводе, не перерисовывая
экран; блокированное поле сообщения не меняет.

- [x] **Step 2: Реализация**

`renderShortAnswer` печатает сообщение по текущему ответу; `attachShortAnswer` читает
`data-answer-kind` у поля и переключает узел сообщения. Границы правила не называются нигде
(FR-28aa5).

- [x] **Step 3: Проверка** — оба набора.

## Task 6: Ступенчатый балл по точности

**Files:**

- Modify: `shared/scoring/engine.ts`, `client/src/features/tests/editor/sections/scoring-builder.tsx`
- Test: `tests/answer-check-scoring.test.ts`, `tests/scoring-builder.test.tsx`

- [x] **Step 1: Падающие тесты**

У текстового ввода `c` равно числу выполненных правил, `total` — числу правил в наборе; `x`
равен единице, когда ответ непустой и не выполнено ничего; таблица «`c` ≥ 2 → 2; `c` ≥ 1 → 1»
даёт 2 балла за точное попадание и 1 за попадание в допуск; набор из одного правила даёт прежние
числа; конструктор ступеней подписывает `c` для текстового ввода как «сколько правил выполнено».

- [x] **Step 2: Реализация**

Ветка текстового ввода в `countTallies` считает `checkRuleSet(...).perRule`; конструктор ступеней
получает свой токен и подпись.

- [x] **Step 3: Проверка** — оба набора плюс `tests/scoring-engine-port.test.ts` (паритет с
      ES5-двойником пакета).

## Task 7: Гистограмма значений

**Files:**

- Modify: `server/services/analytics/answer-spread.ts`, `server/routes/analytics/test-details.ts`
- Test: `server/services/analytics/__tests__/answer-spread.test.ts`

- [x] **Step 1: Падающие тесты**

Числовой набор раскладывается по корзинам; корзин не больше десяти; одинаковые значения дают одну
корзину; неразбираемые ответы образуют строку «не число»; доли считаются от числа ответивших;
текстовый набор по-прежнему сворачивается по написаниям.

- [x] **Step 2: Реализация**

`answerSpread` получает вид ответа; границы корзин округляются до шага 1, 2 или 5 на порядок.

- [x] **Step 3: Проверка** — `npm test -- server/services/analytics/__tests__/answer-spread.test.ts`

## Task 8: Приёмка

- [x] **Step 1:** `npx tsc --noEmit --incremental false` и затронутые наборы целиком.
- [x] **Step 2:** живой прогон в браузере: числовое правило с допуском, диапазон двумя правилами,
      ответ дробью, «ожидается число», ступенчатый балл, разбор попытки, гистограмма на вкладке
      «Вопросы».
- [x] **Step 3:** пакет: `npm run scorm:template`, локальный плеер, то же задание.
