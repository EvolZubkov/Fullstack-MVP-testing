# PRD-26: ревизия точек ветвления по типу вопроса

Рабочая заметка к [плану](../PLAN_PRD26_SCALE_QUESTION.md), Task 3. Закрывает риск R-1:
ветвление по типу вопроса рассыпано по кодовой базе и НЕ является исчерпывающим —
это цепочки `if (type === '...')` с падением в ветку по умолчанию. `npm run check`
после добавления типа `scale` в схему прошёл без единой ошибки, то есть компилятор
пропущенные ветки не покажет.

## Механизм вместо размножения условий

Вводятся два зеркальных модуля предикатов; ветвиться нужно по ПРИЗНАКУ, не по литералу:

- `shared/questions/question-type.ts` — источник истины (TypeScript, чистый);
- `server/scorm/template/app/utils/qtype.js` — зеркало для рантайма пакета (ES5,
  глобальный `TBQType`), подключено в `server/scorm/index.ts` перед всеми частями,
  которые ветвятся по типу.

Предикаты: `isSingleIndexChoice` (ответ — один индекс: `single` и `scale`),
`hasOptionList` (`dataJson.options`: `single`, `multiple`, `scale`),
`hasFixedOptionOrder` (порядок содержателен, перемешивать нельзя: `scale`),
`isMeasurementOnly` (шкала без правильной градации).

## Разметка точек

Решения: **как single** — заменить сравнение на `isSingleIndexChoice`;
**отдельная ветка** — шкале нужно своё поведение; **не участвует** — тип к этой точке
отношения не имеет.

| Файл | Точек | Решение | Задача |
| --- | --- | --- | --- |
| `shared/schema.ts` | 4 | перечисления | Task 2 (сделано) |
| `shared/scoring/engine.ts` | 3 | как single | Task 7 |
| `shared/scales/engine.ts` | 2 | как single | Task 8 |
| `shared/template/question-interaction.ts` | 1 | отдельная ветка (рендер) | Task 4 |
| `shared/template/preview-context.ts` | 2 | отдельная ветка (демо-вопрос) | Task 14 |
| `server/utils/scoring-excel.ts` | 3 | как single | Task 7 |
| `server/services/questions-import.ts` | 3 | отдельная ветка (правило пустого ключа) | Task 9 |
| `server/services/questions-export.ts` | 2 | как single + карта типов | Task 9 |
| `server/services/workbook-import.ts` | 1 | как single | Task 10 |
| `server/services/workbook-template.ts` | 1 | справка и пример | Task 11 |
| `server/routes/questions.ts` | 1 | справка по колонкам | Task 11 |
| `server/routes/attempts.ts` | 1 | отдельная ветка (измерительный режим) | Task 8 |
| `server/routes/analytics/helpers.ts` | 3 | как single | Task 14 |
| `server/routes/analytics/attempts.ts` | 1 | как single | Task 14 |
| `server/types/express.d.ts` | 1 | перечисление | Task 5 |
| `server/scorm/template/app/render/questions/index.js` | 1 | отдельная ветка (диспетчер) | Task 6 |
| `server/scorm/template/app/utils/shuffle.js` | 1 | отдельная ветка (тождественный порядок) | Task 6 |
| `server/scorm/template/app/actions/answers.js` | 2 | как single + клавиатура | Task 6 |
| `server/scorm/template/app/scoring/engine.js` | 2 | как single | Task 7 |
| `server/scorm/template/app/scales/engine.js` | 2 | как single | Task 8 |
| `server/scorm/template/app/feedback/feedback.js` | 3 | как single | Task 6 |
| `server/scorm/template/app/render/resultsPage.js` | 7 | как single (interaction `choice`) | Task 6 |
| `server/scorm/template/app/adaptive/adaptive.js` | 1 | как single | Task 6 |
| `server/scorm/template/app/render/adaptiveRender.js` | 1 | не участвует (предзаполнение ranking) | — |
| `server/scorm/template/app/dnd/ranking.js` | 1 | не участвует (drag-and-drop) | — |
| `server/scorm/template/app/render/questions/ranking.js` | 1 | не участвует | — |
| `server/scorm/assets/app.js` | 1 | не участвует (предзаполнение ranking) | — |
| `server/scorm/debug-player/assets/inspector-compute.js` | 5 | как single + подпись типа | Task 14 |
| `client/src/pages/learner/template-question-screen.tsx` | 2 | отдельная ветка (рендер) | Task 5 |
| `client/src/pages/learner/answer-gate.ts` | 2 | как single | Task 5 |
| `client/src/pages/learner/take-test.tsx` | 5 | как single | Task 5 |
| `client/src/features/questions/question-editor-drawer.tsx` | 9 | отдельная ветка (редактор) | Task 12 |
| `client/src/features/content/question-preview.tsx` | 2 | как single (без отметки в измерительном) | Task 13 |
| `client/src/features/content/content-filters.tsx` | 2 | перечисление фильтра | Task 13 |
| `client/src/features/content/content-tree.tsx` | 1 | подпись типа | Task 13 |
| `client/src/features/tests/editor/scales-api.ts` | 3 | как single | Task 13 |
| `client/src/features/tests/editor/sections/scales-section.tsx` | 1 | как single | Task 13 |
| `client/src/features/tests/editor/sections/scoring-builder.tsx` | 6 | как single | Task 13 |
| `client/src/features/tests/editor/sections/scoring-section.tsx` | 1 | как single | Task 13 |
| `client/src/features/tests/editor/sections/question-scoring-modal.tsx` | 1 | как single | Task 13 |
| `client/src/features/tests/debug-player/debug-player-page.tsx` | 1 | иконка типа | Task 14 |
| `client/src/pages/author/analytics.tsx` | 3 | как single | Task 14 |

Точек без задачи, кроме помеченных «не участвует», нет.

## Дополнение к плану

Задача 5 получает ещё один файл — `server/types/express.d.ts` (объединение типов вопроса
в декларации). Задача 13 — `scales-section.tsx`, задача 14 — `debug-player-page.tsx`;
в исходном списке файлов плана их не было.
