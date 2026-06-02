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
| B5 wiring | Расчёт шкал в `resultsPage.js` + псевдо-интеракции + suspend_data | Готово (`fbb496a`) |
| B5 export/preview | `test.scales[]`/`test.measurements[]` в экспорте + endpoint `scales/preview` | Готово (`fbb496a`) |
| B4a | Вкладка «Шкалы»: список шкал + bands + LMS-таргет + show + preview | Готово, визуально приёмлено (`4044eb0`) |
| B4b | Под-раздел «Вклады вопросов»: матрица «вариант × шкала» | НЕ начато |

Верификация на момент паузы: `npm run check` — 0 ошибок; `vitest run` — 1597 зелёных
(тесты проходят; глобальный coverage-гейт 50% был красным ещё ДО трека — клиентский
UI массово без unit-тестов, отсюда дисциплина wireframes/Playwright-first для UI).
`npm run build` — зелёный.

Коммиты: `a6e3e32` (A1) … `ce7467e` (A9), затем `29282ab` (B1) … `923db2b` (B5 port),
`fbb496a` (B5 wiring+export+preview), `4044eb0` (B4a). Все с префиксом
`feat(prd-2)` / `feat(prd-5)`.

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

Готово в этой сессии (`fbb496a`, `4044eb0`): B5 wiring (расчёт `scale.*` до
`result.*` в `resultsPage.js`, псевдо-интеракции `scale_{key}`/`_level` во всех
трёх finish-функциях, `scaleValues`/`scaleErrors` в `suspendAttempts.js`), B5
export (`test.scales[]`/`test.measurements[]` в `test-json.ts`, загрузка в
`loadFullTest` и экспорте, `scaleKey`-резолв), B5 preview
(`POST /api/tests/:id/scales/preview`), B4a (вкладка «Шкалы»: список шкал, bands,
LMS-таргет, show-to-learner, preview-модалка).

### B4b (под-раздел «Вклады вопросов», UI) — единственное оставшееся

Самая тяжёлая часть. Рейл уже есть (`scales-section.tsx`, под-вкладка
`contributions` — сейчас placeholder). Эскиз — `s-contributions` в
`docs/wireframes/approved/prd2-prd5-scoring-tabs.html`.

- Карточка на вопрос (как в `s-contributions`): свёрнута/раскрыта, статус-dot
  (ok/warn «не привязан»), подзаголовок с чипами шкал; верх — баннер про
  непокрытые вопросы.
- Матрица «единица ответа × шкала» в раскрытой карточке (`tb-table`, НЕ `wf-num-grid`):
  строки зависят от типа вопроса (option-индексы / направленные пары matching
  `left:right` / размещения ranking `item:pos`), столбцы = шкалы теста, ячейка =
  числовой вклад (пусто = нет строки measurement; допустимы 0 и отрицательные);
  подсветка верных вариантов (есть `wf-row-correct` только в эскизе — в React своя).
- Данные: нужны вопросы теста с вариантами. Грузить через `GET /api/questions`
  (фильтровать по темам теста) или новый endpoint. Сохранение — per-вопрос
  `PUT /api/tests/:id/measurements/:questionId` (массив строк); diff в отдельном
  оркестраторе или в общем save (как `saveScales`). `model.measurements` в
  редактор пока НЕ добавлен — добавить в `TestEditorModel` + mappers + use-test-editor.
- Связать с B4a: подзаголовок шкалы «N вопросов»/«M без вклада» (сейчас
  `agg · recalc · bands`), статус-dot шкалы по покрытию; полный preview demo-ответа
  для matching/ranking (B4a поддерживает только single/multiple — см.
  `loadScalePreviewContext`/`ScalePreviewModal` в `scales-api.ts`/`scales-section.tsx`).
- Гард (scoring-model §10.7): переупорядочивание/удаление опций вопроса с
  измерениями ломает индексные `source_key` — предупреждать в редакторе вопросов.
- ОБЯЗАТЕЛЬНО: Playwright-сверка с эскизом (правило wireframes-first).

Композит (`s-scale-advanced`, источник «Другие шкалы») движок не считает —
отдельный будущий слой; в B4a опция показана `disabled`.

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
