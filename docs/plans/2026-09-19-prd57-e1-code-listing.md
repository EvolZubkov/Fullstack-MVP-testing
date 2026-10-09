# Листинг кода (PRD-57, этап Э1): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** листинг кода в тексте задания — с подсветкой, которая считается на сервере, и с
макетами, где блочный узел валиден.

**Architecture:** два узла грамматики в `shared/text/markdown.ts`; подсветка —
серверный модуль на `highlight.js`, вызываемый на ДВУХ путях выдачи (вопросы попытки и
выпечка `test.json`); слот текста задания перестаёт быть заголовком во всех трёх шаблонах,
контракт платформы поднимается до 3.7.0.

**Tech Stack:** TypeScript, highlight.js 11.12.0 (BSD-3-Clause, санкция владельца
2026-09-18), Vitest.

**Устройство согласовано:**
[docs/specs/2026-09-19-prd57-e1-code-listing-design.md](../specs/2026-09-19-prd57-e1-code-listing-design.md).
Требования: [PRD-57](../specs/prd-57/open-response-and-formatting.md) §4.1.

**Границы этапа.** Не делается: три режима ввода текста задания (§4.3), формулы (Э2),
языки сверх трёх обязательных.

---

## Карта файлов

| Файл | Ответственность |
| --- | --- |
| `shared/text/markdown.ts` | инлайн-код и блок кода, маскирование до типографики |
| `server/services/code-highlight.ts` | подсветка и перевод классов в пять ролей |
| `server/services/prompt-html.ts` | готовая разметка текста задания для хостов |
| `server/routes/attempts.ts` | разметка едет с вопросами попытки |
| `server/scorm/builders/test-json.ts` | та же разметка печётся в пакет |
| `client/src/pages/learner/template-question-screen.tsx` | хост берёт готовую разметку |
| `server/scorm/template/app/render/mainRender.js` | то же в рантайме пакета |
| `layouts/question.html` ×3, `styles/theme.css` ×3 | слот без `h2`, оформление листинга |
| `docs/specs/spec-template-platform.md`, `docs/guides/template-development.md` | контракт 3.7.0 |

---

## Task 1: Грамматика

- Modify: `shared/text/markdown.ts`; Test: `tests/code-listing-grammar.test.ts`
- [x] **Step 1:** падающие тесты — инлайн-код и блок; типографика внутри кода не работает,
      снаружи работает; ведущие пробелы и переносы сохраняются; язык из первой строки;
      блок в инлайновом тексте блоком не становится.
- [x] **Step 2:** реализация: маскирование кода ДО типографики, блоки вырезаются до
      разбора абзацев.
- [x] **Step 3:** `npm test -- tests/code-listing-grammar.test.ts`

## Task 2: Подсветка на сервере

- Create: `server/services/code-highlight.ts`; Test: `tests/code-highlight.test.ts`
- [x] **Step 1:** падающие тесты — три обязательных языка; классы свои, палитры библиотеки
      нет; текст кода не меняется; неизвестный язык блок не ломает.
- [x] **Step 2:** реализация: ядро плюс три грамматики, перевод в пять ролей.
- [x] **Step 3:** `npm test -- tests/code-highlight.test.ts`

## Task 3: Разметка едет хостам

- Create: `server/services/prompt-html.ts`; Modify: маршрут попытки и выпечка пакета
- [x] **Step 1:** разметка считается на обоих путях выдачи и только там.
- [x] **Step 2:** хосты берут готовую разметку, а без неё рисуют как раньше.
- [x] **Step 3:** `npx tsc --noEmit --incremental false`

## Task 4: Макеты и контракт

- Modify: три шаблона, спека контракта, руководство; Test: `tests/code-listing-templates.test.ts`
- [x] **Step 1:** падающие тесты — слот не `h2` во всех трёх; блок прокручивается сам;
      шрифт из шаблона; пять ролей одеты токенами.
- [x] **Step 2:** замена тега, стили листинга, версии шаблонов, контракт 3.7.0.
- [x] **Step 3:** гарды шаблонов.

## Task 5: Приёмка

- [x] **Step 1:** `npx tsc --noEmit --incremental false` и затронутые наборы.
- [x] **Step 2:** живой прогон: задание с листингом — веб-хост и отладочный плеер; длинная
      строка прокручивается внутри блока.
