# HANDOFF: PRD-2 (показатели) + PRD-5 (шкалы)

Документ для продолжения работы в новой сессии. План реализации:
[docs/plans/prd-2-prd-5-implementation-plan.md](docs/plans/prd-2-prd-5-implementation-plan.md).

## 1. Назначение

Парный трек расчётной модели:

- PRD-2 — показатели результата (`result.*`): пользовательские формулы над итогами
  теста, публикуемые в LMS при завершении.
- PRD-5 — шкалы и измерения (`scale.*`): именованные агрегаты явных вкладов вопросов,
  нормализуемые (с инверсией) и разбиваемые на диапазоны (bands).

Спеки: [docs/specs/prd-5/scales-competency-measurements.md](docs/specs/prd-5/scales-competency-measurements.md),
[docs/specs/scoring-model.md](docs/specs/scoring-model.md),
[docs/specs/prd-5/example-mbi.md](docs/specs/prd-5/example-mbi.md).

## 2. Текущий статус

| Этап | Содержание | Статус |
| --- | --- | --- |
| A1-A9 | PRD-2 целиком: схема, DSL, рантайм-расчёт, API, экспорт, вкладка «Показатели» | Готово, визуально приёмлено |
| B0 | Wireframes-гейт | Закрыт утверждённым эскизом (см. ниже) |
| B1 | Миграция 009 + схема `scales`/`question_measurements` + zod | Готово |
| B2 | Storage: scales CRUD/reorder + measurements + реальные scaleKeys в валидаторе PRD-2 | Готово |
| B3 | API `/api/tests/:id/scales` + `/measurements` + 16 route-тестов | Готово |
| B5 core | Движок шкал `shared/scales/engine.ts` + 13 фикстурных тестов | Готово |
| B5 port | Рантайм-порт `engine.js` + golden-паритет + включение в сборку | Готово |
| B5 wiring | Расчёт шкал в `resultsPage.js` + псевдо-интеракции + suspend_data | НЕ начато |
| B5 export/preview | `test.scales[]` в экспорте + endpoint `scales/preview` | НЕ начато |
| B4 | Вкладка «Шкалы» (`scales-section.tsx`: список + матрица «Вклады») | НЕ начато |

Верификация на момент паузы: `npm run check` — 0 ошибок; `vitest run` — 1566 зелёных.

Коммиты: `a6e3e32` (A1) … `ce7467e` (A9), затем `29282ab` (B1) … `923db2b` (B5 port).
Все с префиксом `feat(prd-2)` / `feat(prd-5)`.

## 3. Что готово (опорные файлы)

PRD-2 (Этап A):

- `migrations/008_prd2_result_variables.sql`, `shared/schema.ts` (`resultVariables`).
- `shared/formula/*` (DSL: tokens/parser/evaluator/validate) + `server/scorm/template/app/dsl/formula.js` (порт).
- `server/storage.ts` (result-variable CRUD + `validateResultVariableFormula`).
- `server/routes/result-variables.ts` + монтирование в `server/routes/index.ts`.
- `server/scorm/builders/test-json.ts` (`test.resultVariables[]`); `resultsPage.js`
  (расчёт `result.*` + `var_` интеракции + `controls_status`); `suspendAttempts.js`.
- `client/src/features/tests/editor/`: `test-editor.types.ts`/`mappers.ts`/`validation.ts`,
  `use-test-editor.ts`, `test-editor.tsx`, `sections/result-variables-section.tsx`, `result-variables-api.ts`.

PRD-5 (Этап B, готовая часть):

- `migrations/009_prd5_scales_question_measurements.sql`, `shared/schema.ts` (`scales`, `questionMeasurements`).
- `server/storage.ts` (scales CRUD/reorder + `getQuestionMeasurements`/`getQuestionMeasurementsByQuestion`/`upsertQuestionMeasurements`).
- `server/routes/scales.ts` + монтирование.
- `shared/scales/engine.ts` (движок) + `server/scorm/template/app/scales/engine.js` (порт),
  подключён в `server/scorm/index.ts` перед `resultsPage.js`.

## 4. Что осталось (с указаниями)

### B5 wiring (зеркало A7-обвязки в `resultsPage.js`)

Эталон — как сделан PRD-2 в `server/scorm/template/app/render/resultsPage.js`
(функции `computeTestResultVariables`, `buildResultVarContext`, `buildResultVarInteractions`,
`pushAll`; вызовы в `finishAndClose` и трёх finish-функциях).

Шаги:

1. Построить вход движка из `TEST_DATA` + `state`:
   - `scales` (из `TEST_DATA.scales` — появятся после экспорта, см. B5 export),
   - `measurements` (из `TEST_DATA.measurements`; `scaleKey` уже резолвить при экспорте),
   - `answers` (`state.answers` по `questionId`),
   - `questionTypes` (по `state.flatQuestions`).
2. Вызвать `ScaleEngine.computeScales(...)` ДО расчёта показателей.
3. Положить результат в контекст DSL: `context.scales = scaleComputation.values`
   (в `buildResultVarContext` сейчас `scales: {}` — заменить на реальные). Тогда
   `scaleById()`/`countScales()` в формулах показателей дадут значения.
4. Псевдо-интеракции (PRD-5 §8.2): `scale_{key}` (raw value) и, для шкал с bands,
   `scale_{key}_level` (band.label) — во всех трёх finish-функциях, для шкал с
   `scormTarget` = interaction/both. Зеркало `buildResultVarInteractions`.
5. `suspend_data.custom.scale` + `scaleErrors` в `saveAttemptResult`
   (`app/utils/scorm/suspendAttempts.js`) — рядом с `resultValues`/`formulaErrors`.
6. Детерминированный пересчёт при recovery (движок уже детерминирован).

Проверка: `node --check` по JS-файлам + рантайм/scorm-тесты (`runtime.*`, `scorm-*`).

### B5 export + preview

- `server/scorm/builders/test-json.ts`: добавить `test.scales[]` и `test.measurements[]`
  (зеркало блока `resultVariables`, коммит `e046513`). В `measurements` подставить
  `scaleKey` (по `scaleId` -> `scale.key`), чтобы рантайм не знал про uuid.
- `server/scorm-exporter.ts` + storage-загрузка scales/measurements при экспорте.
- `server/routes/tests.ts` `loadFullTest`: добавить `scales` + `measurements` в бандл
  (как `resultVariables` в коммите `26153e2`) — нужно редактору (B4).
- Серверный preview: `POST /api/tests/:id/scales/preview` в `server/routes/scales.ts` —
  принять демо-ответы, импортировать `computeScales` из `shared/scales/engine`
  напрямую (сервер на TS), вернуть `{values, errors}`. Опц.: `.../validate`
  (уникальность ключа уже есть; для композитных шкал — проверка ацикличности, §10.9).

### B4 (вкладка «Шкалы», UI)

- Эскиз — состояния в `docs/wireframes/approved/prd2-prd5-scoring-tabs.html`:
  `s-scales` (список + bands-редактор), `s-contributions` (матрица вариант×шкала),
  `s-scale-advanced` (композит), `s-scale-error`, `s-scales-empty`, `s-preview-calc`.
- Новый `client/src/features/tests/editor/sections/scales-section.tsx`. Эталон
  интеграции — `result-variables-section.tsx` + data-layer A8: модель
  `TestEditorModel.scales` + diff-on-save оркестратор через A5/B3 CRUD; либо
  отдельный hook. Для матрицы measurements — отдельный upsert-по-вопросу (PUT
  `/measurements/:questionId`).
- Зарегистрировать вкладку «Шкалы» (`EditorTabKey`, `TAB_ORDER`, `TAB_LABELS`,
  routing, dirty-diff) — как «metrics» в A8.
- ОБЯЗАТЕЛЬНО: Playwright-сверка с эскизом (правило wireframes-first), как в A8.

## 5. Ключевые решения (не очевидно из кода)

- B0: отдельные файлы `prd5-*.html` НЕ создавать — утверждённый
  `prd2-prd5-scoring-tabs.html` уже покрывает все состояния «Шкалы»/«Вклады»
  (правило «check overlap before rewrite»; так же поступили в A8).
- `source_key` — вариант (а), индексный: `option` -> индекс (`"2"`),
  `matching_pair` -> `"left:right"`, `ranking_position` -> `"item:pos"`,
  `question` -> `null`. Стабильные id опций отложены в будущий PRD: весь пайплайн
  ответов (хранение, `checkAnswer`, SCORM, аналитика) индексный, опции = `string[]`
  без id. Подстраховка для B4: гард на переупорядочивание/удаление опций с
  измерениями в редакторе вопросов (scoring-model §10.7).
- Порядок: B5 (рантайм) сделан до B4 (UI) — ядро тестируется фикстурами, без
  визуального цикла; разблокирует preview; завершает резолв `scaleById` в DSL.
- `tests.id` и `questions.id` — `varchar(36)`, НЕ uuid. FK в миграциях — `varchar(36)`
  (PRD-2 §8.1 и PRD-5 §9 ошибочно говорят uuid). Новые PK (`result_variables.id`,
  `scales.id`, `question_measurements.id`) — uuid `defaultRandom`.
- `question_measurements.weight` — `real` (число-множитель), не `numeric` (давал
  string + ломал zod-инсерт).
- `scale_id` в measurements валидируется как uuid (drizzle-zod `.uuid()` строгий по
  версии/варианту — в тестах использовать валидный UUID v4).

## 6. Технические паттерны (повторять)

- Parity-паттерн: авторитетная TS-реализация (`shared/...`) + рукописный JS-порт
  (`server/scorm/template/app/...`) + golden-тест через `new Function(portSrc + ';return X;')`.
  Так сделаны DSL и движок шкал.
- Миграции `migrations/00N_*.sql`: шапка-комментарий, `BEGIN; … COMMIT;`,
  идемпотентно (`IF NOT EXISTS`), enum/regex CHECK живут в SQL.
- Секция редактора: пропсы `{ model, updateModel }`; запись в `TestEditorModel`;
  diff-on-save оркестратор (delete -> create/update по индексу = sortOrder), refetch
  для свежих id. Стабильный React-key через `clientKey` (не из редактируемых полей).
- Route-тест: `vi.hoisted` storageMock + `vi.mock("../server/storage")` +
  РЕАЛЬНЫЙ `requireAuth`/`requireAuthor` (через `req.session.userId` + мок
  `getUser`) + supertest. Эталоны: `tests/routes.result-variables.test.ts`,
  `tests/routes.scales.test.ts`.
- DSL-эвалюатор уже читает `context.scales` (форма `ScaleResult` =
  `{raw, normalized, percent, level, label, hasValue}`); B5-wiring только заполняет его.

## 7. Dev-окружение и запуск

- БД: контейнер `test-builder-postgres` (Docker, `localhost:55432`).
  `docker start test-builder-postgres`; ждать `pg_isready -U test_builder`.
  Миграции 008 и 009 уже применены к этой БД; `weight` уже `real`.
  Если схема устарела — `npx drizzle-kit push --force` (читает `.env`).
- Логин автора: `admin@test.com` / `admin123` (seed). ВНИМАНИЕ: форма входа
  предзаполняет `admin@local.test` / `Admin1234!`, которые НЕ работают (401).
- Сервер: `npm run dev`, порт из `.env` (`PORT=8081`).
- Проверки: `npm run check` (tsc), `npx vitest run` (1566 тестов), `npm run build`.
- Подробности БД — память `reference_database`.

## 8. Подводные камни

- Расширение `loadFullTest` (GET/POST/PUT `/api/tests`) и экспорта вызовом нового
  storage-метода ломает route-тесты с неполным storage-моком (loadFullTest бросает).
  При добавлении `getScales`/`getQuestionMeasurements` в `loadFullTest`/экспорт —
  добавить эти методы в моки: `tests/routes.tests.test.ts`,
  `tests/routes.attempts-tests.test.ts`, `tests/scorm-export.test.ts` (так было с
  `getResultVariables`, коммиты `f2382a6`, `008b629`).
- drizzle-zod: `uuid` -> строгий `.uuid()`; `numeric` -> string + required;
  `jsonb.$type<T>()` может расходиться с zod `Json` (в инсерте). Уточнять поля через
  `.extend(...)` (см. `insertQuestionMeasurementSchema`).
- Эскизные классы `wf-list-head`/`wf-grid-2` НЕ существуют в CSS приложения (только
  в HTML-эскизе). В React использовать Tailwind-утилиты (`flex`, `grid grid-cols-2`)
  или реальные `tb-*`/`ou-*`. `wf-sep` — существует.
- Кнопки ui-kit: иконка через проп `leadingIcon`/`icon`, не как children.
- НИКОГДА не объявлять визуальный успех UI без Playwright-сверки с эскизом
  (память `feedback_screenshot_review`, `feedback_wireframes_first_ui`).
