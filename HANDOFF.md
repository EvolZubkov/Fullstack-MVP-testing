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
| B4b | Под-раздел «Вклады вопросов»: матрица «единица × шкала» | Готово, визуально приёмлено (`a9bbc9a`) |
| C | E2E MBI golden — `tests/mbi-golden.test.ts` + актуализация спек | Готово |

**Весь трек PRD-2 + PRD-5 (Этапы A-C) завершён.** Остались только отложенные точечные
пункты (см. §4) — ни один не блокирует.

Верификация на момент паузы: `npm run check` — 0 ошибок; `vitest run` — 1651 зелёный
(тесты проходят; глобальный coverage-гейт 50% был красным ещё ДО трека — клиентский
UI массово без unit-тестов, отсюда дисциплина wireframes/Playwright-first для UI).
`npm run build` — зелёный.

Коммиты: `a6e3e32` (A1) … `ce7467e` (A9), затем `29282ab` (B1) … `923db2b` (B5 port),
`fbb496a` (B5 wiring+export+preview), `4044eb0` (B4a), `a9bbc9a` (B4b), Этап C
(`tests/mbi-golden.test.ts` + актуализация спек). Все с префиксом `feat(prd-2)` /
`feat(prd-5)` / `test(prd-5)`.

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

PRD-5 (Этап B, UI — B4a/B4b, эта сессия):

- `client/src/features/tests/editor/`: `test-editor.types.ts` (`ScaleModel`,
  `ScaleBandModel`, `QuestionMeasurementModel`, поля `scales`/`measurements`),
  `test-editor.mappers.ts` (`buildScalesFromApi`/`buildMeasurementsFromApi`,
  scaleId→key), `test-editor.validation.ts` (`validateScales`), `use-test-editor.ts`
  (вкладка `scales`, diff/reconcile `saveScales`+`saveMeasurements`, `resolveScaleKeyToId`),
  `scales-api.ts` (save-оркестраторы, `previewScales`, `loadScalePreviewContext`,
  `loadContributionQuestions`), `sections/scales-section.tsx` (список шкал + bands +
  preview-модалка + матрица «Вклады вопросов»), `__tests__/scales.test.ts` (32 теста).

## 4. Что осталось (с указаниями)

Весь трек PRD-2 + PRD-5 (Этапы A-C) завершён в этой сессии (`fbb496a` B5
wiring/export/preview, `4044eb0` B4a, `a9bbc9a` B4b, Этап C `tests/mbi-golden.test.ts`).
Остались только отложенные точечные пункты — ни один не блокирует.

### Этап C — выполнено

- `tests/mbi-golden.test.ts`: фикстура MBI (3 шкалы EE/D/AD, AD инверсная, 22 вопроса,
  `burnout_category`) -> пайплайн `shared/scales/engine` -> `shared/formula`; сверка
  уровней и категории с независимой reference-реализацией таблицы 27 комбинаций
  (логика отсутствующего в репо `process_burnout_export.py` закодирована из спеки
  example-mbi §2.5), числовые проверки §5.3, регрессия §5.4. 43 теста.
- Player-приёмка псевдо-интеракций `scale_{*}[_level]` + `var_*` и `suspend_data.custom`
  покрыта рантайм-обвязкой B5 (resultsPage.js/suspendAttempts.js) + export-тестами;
  Excel-видимость WebTutor (acceptance §5.3 #7-#9) — только live-LMS (память
  `no-live-webtutor-verify-local`).
- Инструмент приёмки (`6a6aa77`): `scripts/scorm-player.mjs` расширен инспектором —
  панели «Шкалы»/«Показатели» (живой пересчёт по ходу попытки через same-origin глобали
  iframe) + «SCORM ↔ LMS» (журнал вызовов RTE с ответами/кодами ошибок, таблица
  `cmi.interactions.*`, `suspend_data.custom`). `npm run scorm:sample` несёт фикстуру
  скоринга (2 шкалы + measurements + 3 показателя). Память `reference_scorm_acceptance_tooling`.

### Статус issues (GitHub `vvlad1973/Fullstack-MVP-testing`)

Актуализировано 2026-06-03 (ВСЕГДА `--repo vvlad1973/...`, не upstream-форк). Трек [scoring]:
закрыто 10 — `#11`,`#13`,`#14`,`#15`,`#16`,`#18`,`#19`,`#20`,`#21`,`#22` (с ссылками на
коммиты, чек-боксы в теле эпика проставлены). Открыты со статусом 6: доспека/решения
(`#12`,`#25`), градуированный checkAnswer (`#17`), RTK-слой (`#23`), C2-фастфоллоу (`#24`),
эпик `#26` (ядро доставлено, остаток отложен).

### Отложенные точечные пункты (не блокируют)

- Гард опций (scoring-model §10.7): переупорядочивание/удаление опций вопроса с
  измерениями ломает индексные `source_key` — предупреждать в РЕДАКТОРЕ ВОПРОСОВ
  (`client/src/pages/author/questions.tsx`, отдельная поверхность, не редактор теста).
- Полный preview demo-ответа для matching/ranking в B4a-модалке (сейчас
  single/multiple; см. `loadScalePreviewContext`/`ScalePreviewModal`).
- Композит (`s-scale-advanced`, источник «Другие шкалы») — движок не считает
  scale-of-scales; в B4a опция `disabled`; отдельный будущий слой.
- Глобальная (test-unscoped) библиотека шкал — будущий PRD (зафиксировано в ROADMAP §0.2).

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
