# Развёрнутый ответ (PRD-57, этап Э9): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** тип «Развёрнутый ответ» без автопроверки и вся закладка §5.6, без которой трек
PRD-58 потребовал бы миграции данных.

**Architecture:** тип `long` идёт дорогой неоцениваемого (в баллы и знаменатель не входит),
но помечается ИНАЧЕ — исход `pending` вместо `neutral`. Признак завершённости оценки живёт
в агрегате, в хранимом контракте результата и в контексте шаблона.

**Tech Stack:** TypeScript, Zod, React 19, Vitest.

**Устройство согласовано:**
[docs/specs/2026-09-20-prd57-e9-long-answer-design.md](../specs/2026-09-20-prd57-e9-long-answer-design.md).
Требования: [PRD-57](../specs/prd-57/open-response-and-formatting.md) §5, §5.6.

**Границы этапа.** Не делается: интерфейс проверяющего, очередь работ, право проверки как
уровень гранта — всё это PRD-58.

---

## Task 1: Тип и поле

- [x] **Step 1:** падающие тесты — тип в перечне, признак `isOpenText`, многострочное поле
      с подсказкой и пределом, поле в разборе заперто и без блока «правильный ответ».
- [x] **Step 2:** `renderLongAnswer` в общем рендерере, ветки в обоих хостах, признак в
      зеркале типов пакета.
- [x] **Step 3:** `npm test -- tests/long-answer.test.ts`

## Task 2: Четвёртое состояние исхода

- [x] **Step 1:** падающие тесты — развёрнутый ответ `pending`, измерительный `neutral`,
      попытка с открытым ответом предварительна.
- [x] **Step 2:** `QuestionOutcome.result` и `gradingComplete` в агрегате; ТОТ ЖЕ набор в
      `attemptResultSchema`; на границе аналитики `pending` приводится к нейтральному.
- [x] **Step 3:** наборы исходов и аналитики.

## Task 3: LMS

- [x] **Step 1:** падающие тесты — `long-fill-in` без эталона; `unknown` вместо `failed`.
- [x] **Step 2:** реализация в рантайме пакета и в адаптере SCORM.
- [x] **Step 3:** `npm test -- tests/scorm-interactions.test.ts tests/long-answer-lms.test.ts`

## Task 4: Редактор и контракт

- [x] **Step 1:** тип в списке ящика; подсказка, предел длины, обязательность.
- [x] **Step 2:** контекст шаблона несёт `pendingReview`; контракт поднят до 3.8.0.
- [x] **Step 3:** `npx tsc --noEmit --incremental false` и наборы ящика.

## Task 5: Приёмка

- [x] **Step 1:** затронутые наборы целиком.
- [x] **Step 2:** живой прогон: попытка с развёрнутым ответом — исход, предварительность,
      процент от проверенного максимума; поле в пакете.
