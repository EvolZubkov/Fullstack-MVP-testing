# Проба ответа (PRD-57, этап Э6): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** дать автору строку пробы в ящике вопроса — вердикт рядом с полем и отметки на
строках правил, — не заводя второго движка сравнения и ничего не сохраняя.

**Architecture:** проба считается тем же `checkRuleSet`, что и попытка; её строка живёт в
состоянии блока правил, мимо черновика, поэтому в `correct_json` попасть не может. Отметки
строятся на `RuleSetOutcome.perRule`, заведённом в Э4 ровно под это.

**Tech Stack:** TypeScript, React 19, `@universityrt/ui-kit`, Vitest.

**Устройство согласовано:**
[docs/specs/2026-09-19-prd57-e6-answer-probe-design.md](../specs/2026-09-19-prd57-e6-answer-probe-design.md).
Требования: [PRD-57](../specs/prd-57/open-response-and-formatting.md) §6.3.
Эскиз: `docs/wireframes/approved/prd57-answer-rule.html`, состояния `k-list`, `k-probe`.

**Границы этапа.** Не делается: панель вставки выражения и замер времени (Э7), проба у
пропусков (Э8), развёрнутый ответ (Э9).

---

## Карта файлов

| Файл | Ответственность |
| --- | --- |
| `client/src/features/questions/answer-rules/answer-rules-block.tsx` | строка пробы, вердикт, отметки, связка между строками |
| `client/src/features/questions/answer-rules/describe-rule.ts` | объяснение вердикта словами |
| `client/src/features/questions/question-editor-drawer.tsx` | состояние черновика в подвале ящика |
| `client/src/styles/tb-components.css` | `.tb-probe`, `.tb-rules__join`, `.tb-dirty` |
| `docs/wireframes/ds/tb-components.css` | зеркальная копия тех же правил |

---

## Task 1: Вердикт и отметки

**Files:**

- Modify: `client/src/features/questions/answer-rules/answer-rules-block.tsx`
- Test: `client/src/features/questions/__tests__/answer-rules-block.test.tsx`

- [x] **Step 1: Падающие тесты**

Пустая проба не даёт ни вердикта, ни отметок; набранный подходящий ответ даёт «Зачтено» и
одну отметку «выполнено»; неподходящий — «Не зачтено» и отметки «не выполнено» на всех
строках; очистка поля убирает и то, и другое; числовая проба разбирает `1/2`.

- [x] **Step 2: Реализация**

Строка `tb-probe`: поле плюс `Tag`. Вердикт и отметки считаются одним вызовом
`checkRuleSet` по сохраняемому набору (`toCorrectJson`), поэтому проба проверяет ровно то,
что уедет в задание.

- [x] **Step 3: Проверка** — `npm test -- client/src/features/questions/__tests__/answer-rules-block.test.tsx`

## Task 2: Объяснение вердикта

**Files:**

- Modify: `client/src/features/questions/answer-rules/describe-rule.ts`
- Test: `tests/answer-rules-describe.test.ts`

- [x] **Step 1: Падающие тесты**

Сработавшее правило названо по заголовку; при связке «все» и одном невыполненном правиле
объяснение называет именно его; при «любом» и полном промахе — «Не выполнено ни одно
правило, а ответ засчитывается, если выполнено любое из них»; строка всегда кончается
словами про то, что проба не сохраняется.

- [x] **Step 2: Реализация**

Функция `describeProbe(set, outcome)`: берёт набор и исход, возвращает одну строку.

- [x] **Step 3: Проверка** — `npm test -- tests/answer-rules-describe.test.ts`

## Task 3: Связка между строками

**Files:**

- Modify: `client/src/features/questions/answer-rules/answer-rules-block.tsx`
- Test: `client/src/features/questions/__tests__/answer-rules-block.test.tsx`

- [x] **Step 1: Падающие тесты**

Между двумя правилами стоит «или» при связке «любое» и «и» при «все»; у набора из одного
правила связки нет; тег «Выполнены должны быть все правила» из блока исчез.

- [x] **Step 2: Реализация** — `tb-rules__join` между строками списка.

- [x] **Step 3: Проверка** — тот же набор.

## Task 4: Состояние черновика в подвале

**Files:**

- Modify: `client/src/features/questions/question-editor-drawer.tsx`
- Test: `client/src/features/questions/__tests__/answer-rules-drawer.test.tsx`

- [x] **Step 1: Падающие тесты**

Пока правила не тронуты, подвал состояния не показывает; после правки появляется
«Изменения не сохранены» и «Вернуть изменения»; возврат восстанавливает набор, каким он был
при открытии ящика, и прячет группу.

- [x] **Step 2: Реализация** — `isDirty` из модели плюс сброс черновика к `initial`.

- [x] **Step 3: Проверка** — `npm test -- client/src/features/questions/__tests__/`

## Task 5: Три класса раскладки

**Files:**

- Modify: `client/src/styles/tb-components.css`, `docs/wireframes/ds/tb-components.css`
- Test: `tests/tb-components-mirror.test.ts` (если гарда нет — проверкой в наборе блока)

- [x] **Step 1:** Перенести `.tb-probe`, `.tb-rules__join`, `.tb-dirty` из эскиза дословно.
- [x] **Step 2:** Сверить зеркальную копию — расхождение копий уже случалось.

## Task 6: Приёмка

- [x] **Step 1:** `npx tsc --noEmit --incremental false` и затронутые наборы.
- [x] **Step 2:** живой прогон: три правила, связка «любое», проба зачтена и не зачтена,
      очистка поля, сохранение вопроса и чтение `correct_json` — пробы там нет.
