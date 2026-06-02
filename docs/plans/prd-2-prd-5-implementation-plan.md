# План реализации парного трека PRD-2 + PRD-5

**Статус:** Согласован 2026-06-02 (реализация не начата)
**Дата:** 2026-05-31
**Источник:** [ROADMAP §0.2](../ROADMAP.md), [PRD-2](../specs/prd-2/result-variables.md),
[PRD-5](../specs/prd-5/scales-competency-measurements.md),
[Пример MBI](../specs/prd-5/example-mbi.md)

---

## 1. Контекст

ROADMAP §0.2 поднял пару PRD-2 + PRD-5 в верх post-MVP backlog по бизнес-запросу:
итоговые шкалы и категория результата должны передаваться в LMS (WebTutor) без ручной
постобработки Excel-выгрузки. Сейчас этот расчёт делает внешний Python-скрипт
`process_burnout_export.py` (MBI burnout). Цель трека — чтобы SCORM-пакет сам считал
шкалы и итоговую категорию в момент завершения попытки и писал их в `cmi.interactions`,
после чего внешний постпроцессор становится не нужен.

Пара ведётся одним треком, потому что DSL пользовательских показателей (PRD-2) обязан
знать источники `scaleById(...)` / `countScales(...)` (PRD-5) до того, как Core начнёт
публиковать `scale.*`. Иначе формула итоговой категории по шкалам нереализуема.

---

## 2. Зафиксированные решения этой сессии

1. **Поставка поэтапная A -> B -> C.** Каждый этап — отдельный согласуемый инкремент,
   закрывается зелёным `npm run check` и `vitest run`.
2. **Шкалы и измерения — test-scoped** (как в PRD-5 §9). Глобальная привязка
   «вопрос -> шкала» как дефолт и override под конкретный тест **выносятся в отдельный
   будущий PRD** («Глобальная библиотека шкал»). В текущем дизайне БД ключ шкалы
   (`scales.key`) держим стабильным и уникальным в пределах теста, чтобы будущая
   миграция в глобальную библиотеку была чистой.
3. **Матрица «Измерения» живёт в редакторе теста, во вкладке «Шкалы»** (не в глобальной
   карточке вопроса), потому что шкалы и `question_measurements` привязаны к тесту, а
   вопросы — глобальные и переиспользуемые.
4. **Каждый UI-кусок проходит этап wireframes c согласованием ДО реализации React.**
   Правила обязательны: сперва читаем
   `C:\Repositories\ENGINERING_HANDBOOK\handbook\design-system\{AI-AGENT,DESIGN_SYSTEM_RT,DESIGN_SYSTEM_RT_API}.md`;
   эскиз — только skeleton-фрейм (`wf-nav`/`wf-state`/sprite) на DS-компонентах
   (`ou-*` или `tb-components.css`), без локальных render-классов; `npm run
   check:wireframes:ds` зелёный; визуальная проверка на 1440px; перенос в
   `docs/wireframes/approved/` после явного согласования.
5. **Ничего не реализуется без согласования каждого этапа** (включая отдельное
   согласование эскизов и согласование плана этого документа).

---

## 3. Сквозные архитектурные решения

### 3.1 DSL формул (без eval)

Runtime-файлы пакета шиппятся как сырой plain-JS: `server/scorm/index.ts` читает их
через `readAsset()` и конкатенирует (`joinJsParts`) без бандлера/транспиляции. Поэтому:

- **Авторитетная реализация** парсера/эвалюатора/валидатора — на TypeScript в
  `shared/formula/` (ESM, типизирована). Её использует серверная валидация
  (`validate-formula`) и unit-тесты.
- **Runtime-порт** — самодостаточный plain-JS `server/scorm/template/app/dsl/formula.js`
  (IIFE, объявляет глобал `FormulaDSL`, без `import`/`export`, без `eval()`/`Function()`
  по NFR-01). Подключается в `joinJsParts` (server/scorm/index.ts) **до**
  `resultsPage.js`.
- **Паритет двух реализаций** страхуется общим golden-корпусом тест-кейсов
  (`tests/fixtures/formula-cases.json`), который прогоняется против TS-реализации
  (импортом) и против runtime-порта (загрузка конкатенированного скрипта в sandbox
  внутри vitest — допустимо, NFR-01 запрещает eval в шиппинге, а не в тестах).
  Корпус включает формулу категории MBI.

Грамматика — строго по [PRD-2 §4.2](../specs/prd-2/result-variables.md): источники
(`percent`, `topicById`, `tag`, `scaleById`, `sectionById`, `var`, `countPassed`,
`countTopics`, `avgPercent`, `countVars`, `countScales`), операции (`IF`, `AND/OR/NOT`,
сравнения, арифметика, скобки, литералы), приоритеты `NOT > * / > + - > сравнения >
AND > OR`. Парсер на приоритетах (Pratt/recursive-descent), без `eval`.

### 3.2 Порядок расчёта в runtime (итоговая картина после Этапа B)

`scale.*` публикуются до `result.*`; `result.*` — до события `result:calculated`.
Псевдо-интеракции: `scale_{key}` и `var_{name}` (стабильные id, см. PRD-5 §8.3).
`suspend_data.custom` получает `{ scale, result, formulaErrors, scaleErrors }`.
`result_variable` типа boolean с `controls_status` переопределяет
`cmi.success_status`/`cmi.completion_status` (PRD-2 §7.3); при `null` — откат на
стандартный путь по `passing_score`.

### 3.3 Конвенции handbook

REST — конверт ответа по
[decisions/0002](file:///C:/Repositories/ENGINERING_HANDBOOK/decisions/0002-rest-api-envelope-standard.md);
БД — по `handbook/architecture/DB_CONVENTIONS.md`; покрытие — gate 80%
([decisions/0005](file:///C:/Repositories/ENGINERING_HANDBOOK/decisions/0005-80-percent-coverage-gate.md));
стратегию удаления (soft vs hard) сверить с
[decisions/0003](file:///C:/Repositories/ENGINERING_HANDBOOK/decisions/0003-soft-deletes-strategy.md)
и существующим прецедентом test-scoped дочерних строк (`test_sections`,
`content_pages` — hard delete + cascade).

---

## 4. Этап A — PRD-2 (пользовательские показатели результата)

Детальный, исполняется первым (после согласования плана и эскизов).

### A0. Wireframes вкладки «Показатели» (gate)

Состояния эскиза: список показателей с DnD-порядком; форма показателя
(`name`/`label`/`type`/`formula`/`show_to_learner`/`scorm_target`/`controls_status`);
визуальный конструктор формул + расширенный DSL-редактор с inline-валидацией (debounce
400 мс); debug-предпросмотр на демо-попытке; предупреждения зависимостей `var()`;
состояния loading/error/readonly/dirty/validation. Файл —
`docs/wireframes/prd2-result-variables-tab.html`. Handbook-first, DS-линтер, согласование,
перенос в `approved/`.

### A1. БД и схема

- Миграция `migrations/008_prd2_result_variables.sql`: таблица `result_variables`
  (PRD-2 §8.1) + два partial unique index (`one_success_per_test`,
  `one_completion_per_test`) + `result_variables_test_id_idx`; колонка
  `questions.tags jsonb NOT NULL DEFAULT '[]'` (PRD-2 §8.2). Идемпотентно
  (`IF NOT EXISTS`), формат — как `migrations/007_*`.
- `shared/schema.ts`: `pgTable("result_variables", ...)`, `insertResultVariableSchema`
  (`createInsertSchema(...).omit(...)`), zod-схемы полей/enum'ов, типы.

### A2. Shared DSL (TS)

`shared/formula/` — `tokens.ts`, `parser.ts` (AST), `evaluator.ts` (eval по контексту
`{ percent, topics, tags, scales, sections, vars }`), `validate.ts` (синтаксис; тип
возврата vs `type`; ссылки `topicById`/`scaleById`/`sectionById`; `var()` только на
меньший `sort_order`; `countScales` второй аргумент в наборе band-level; деление на ноль
как безопасный runtime; неизвестные теги — warning). На Этапе A `scaleById`/`countScales`
**парсятся**, но валидация ссылок резолвится к пустому набору шкал -> warning (полноценно
заработает на Этапе B). Unit-тесты на грамматику и приоритеты.

### A3. Runtime-порт DSL

`server/scorm/template/app/dsl/formula.js` (IIFE -> `FormulaDSL`). Подключить в
`server/scorm/index.ts` (`readOneOf([...])` + позиция в `joinJsParts` до
`resultsPageJs`). Golden-тест паритета (TS vs порт) на `tests/fixtures/formula-cases.json`.

### A4. Storage

`server/storage.ts`: `getResultVariables(testId)`, `createResultVariable`,
`updateResultVariable`, `deleteResultVariable`, `reorderResultVariables` — по образцу
`getAdaptiveLevels` / `reorderContentPages`. `validateFormula` использует shared DSL.

### A5. API

`server/routes/result-variables.ts`: `GET/POST/PUT/DELETE
/api/tests/:id/result-variables`, `PUT .../reorder`, `POST
.../validate-formula` (PRD-2 §9). `requireAuthor` на запись, zod-валидация,
конверт ответа по handbook 0002, монтирование в общий роутер.

### A6. Экспорт

`server/scorm/builders/test-json.ts`: добавить `test.resultVariables[]`; расширить
`ExportData`. `server/scorm-exporter.ts` + storage-загрузка набора при экспорте.

### A7. Runtime-расчёт

`server/scorm/template/app/render/resultsPage.js`: после `calculateResults()` считать
показатели в порядке `sort_order` через `FormulaDSL.evaluate`, публиковать `result.*`
(в `state.resultValues`), копить `formulaErrors`; добавить псевдо-интеракции `var_{name}`
в `finishScorm` / `finishScormLmsOnly` / `finishScormAdaptive`; в
`app/utils/scorm/suspendAttempts.js` добавить `suspend_data.custom.result` +
`formulaErrors` в запись попытки; `controls_status` -> переопределение `passedForLms` /
completion. Детерминированный пересчёт при recovery (NFR-04). Расширить
`Telemetry.finish` payload (опционально, под флаг телеметрии).

### A8. Редактор (UI)

- `client/src/features/tests/editor/test-editor.types.ts` — `resultVariables` в
  `TestEditorModel`.
- `...mappers.ts` / `...validation.ts` — сериализация и проверки
  (имя по regex, уникальность, тип vs формула, правила `controls_status`).
- `test-editor.tsx` — регистрация вкладки «Показатели» (`TAB_ORDER`, `TAB_LABELS`,
  `tabForField`, рендер-блок).
- Новый `sections/result-variables-section.tsx` на `@universityrt/ui-kit`
  (NumberInput/Select/Switch/Tag/Banner/DnD `@dnd-kit`), inline-валидация через
  `validate-formula`. Строго по согласованному эскизу A0.

### A9. Тесты Этапа A

DSL unit + golden-паритет; API (`tests/routes.result-variables.test.ts`); mapper/
validation unit; покрытие >= 80%. `npm run check` 0 ошибок, `vitest run` зелёный.

---

## 5. Этап B — PRD-5 (шкалы и измерения) — контур

### B0. Wireframes (gate)

- `docs/wireframes/prd5-scales-tab.html` — вкладка «Шкалы»: список шкал, конфигурация
  (`type`/`aggregation`/`normalization`/`direction`/`bands`/`show_to_learner`/
  `scorm_target`), покрытие вопросами, предупреждения о шкалах без вкладов,
  предпросмотр диапазонов; bands с `level`.
- `docs/wireframes/prd5-measurements-matrix.html` — под-раздел «Вклады вопросов» внутри
  вкладки «Шкалы»: сетка «вариант × шкала» (строки = варианты/пары/позиции для
  `single/multiple/matching/ranking`, ячейка = явный `value_json`; пусто = нет вклада,
  допустимы 0 и отрицательные); корректность — read-only из раздела «Вопросы»;
  предпросмотр расчёта. Условия (`condition_json`) на первом этапе отложены
  (`docs/specs/scoring-model.md` §10.5; PRD-5 §4.4) — многошкальность выражается
  отдельными per-option строками. Содержательная основа — эскиз
  `docs/wireframes/approved/prd2-prd5-scoring-tabs.html`.

Handbook-first, DS-линтер, согласование, `approved/`.

### B1-B5 (контур)

- Миграция `009_prd5_scales_question_measurements.sql` (`scales`,
  `question_measurements` — PRD-5 §9) + схема/zod.
- Storage + API: scales CRUD/reorder; `GET/PUT /api/questions/:id/measurements`
  (test-scoped через тело/контекст теста); `POST /api/tests/:id/scales/preview`,
  `.../validate` (PRD-5 §10-§11).
- Экспорт `test.scales[]` + measurements; runtime-движок шкал
  (`server/scorm/template/app/scales/` новый модуль): применить measurement-правила ->
  агрегировать -> нормализовать с учётом `direction` -> применить bands -> `level/label`
  -> публиковать `scale.*` **до** `result.*`; событие `scale:calculated`; псевдо-
  интеракции `scale_{key}`; `suspend_data.custom.scale` + `scaleErrors`; контекст в
  `templateCore.js` + слот `data-slot="scale-results"`.
- Редактор: вкладка «Шкалы» (под-разделы «Список шкал» + «Вклады вопросов»); теперь
  `scaleById`/`countScales` в валидаторе PRD-2 резолвятся к реальным шкалам.
- Тесты: inverse-нормализация (`percent`), границы bands, измерения по типам вопросов,
  совместимость старых тестов без шкал.

---

## 6. Этап C — E2E MBI + golden — контур

- Фикстура MBI: 3 шкалы (EE/D/AD, AD инверсная), 22 вопроса, `burnout_category`.
- Golden-тест: категория совпадает с `process_burnout_export.py` по таблице 27
  комбинаций / наборам ответов (PRD-2 §12, example-mbi §5.3 пункт 10).
- SCORM-экспорт -> player-приёмка (см. память
  [reference_scorm_acceptance_tooling]): псевдо-интеракции `scale_ee/d/ad` +
  `var_burnout_category`; содержимое `suspend_data.custom`.
- Регрессия: старый тест без шкал/показателей экспортируется и проходится без изменений.
- Актуализация: ROADMAP §0.2, статусы PRD-2/PRD-5, example-mbi acceptance; зафиксировать
  «Глобальная библиотека шкал» как будущий PRD.

---

## 7. Критические файлы

```text
migrations/008_prd2_result_variables.sql            (новый, Этап A)
migrations/009_prd5_scales_question_measurements.sql (новый, Этап B)
shared/schema.ts                                     (таблицы + zod)
shared/formula/*                                     (новый DSL, TS)
server/scorm/template/app/dsl/formula.js             (новый runtime-порт)
server/scorm/index.ts                                (подключение formula.js)
server/storage.ts                                    (CRUD методы)
server/routes/result-variables.ts                   (новый, Этап A)
server/routes/scales.ts                              (новый, Этап B)
server/scorm/builders/test-json.ts                   (экспорт scales/result vars)
server/scorm/template/app/render/resultsPage.js      (расчёт + псевдо-интеракции)
server/scorm/template/app/utils/scorm/suspendAttempts.js (suspend_data.custom)
server/scorm/template/app/scales/*                   (новый движок шкал, Этап B)
client/src/features/tests/editor/test-editor.{tsx,types.ts,mappers.ts,validation.ts}
client/src/features/tests/editor/sections/result-variables-section.tsx (новый)
client/src/features/tests/editor/sections/scales-section.tsx           (новый, Этап B)
docs/wireframes/prd2-result-variables-tab.html       (новый эскиз)
docs/wireframes/prd5-scales-tab.html                 (новый эскиз)
docs/wireframes/prd5-measurements-matrix.html        (новый эскиз)
tests/fixtures/formula-cases.json                    (golden-корпус)
```

---

## 8. Верификация

- `npm run check` (0 ошибок TypeScript) и `vitest run` (зелёный) на каждом этапе;
  покрытие >= 80%.
- DSL: unit-тесты грамматики + golden-паритет TS-реализации и runtime-порта.
- Wireframes: `npm run check:wireframes:ds` зелёный; визуальная проверка Playwright на
  1440px; согласование пользователем перед реализацией React.
- E2E: `npm run scorm:sample` / `scorm:template` / `scorm:player` + acceptance-тест.
- MBI: golden-сравнение категории с `process_burnout_export.py`.

---

## 9. Риски и открытые вопросы

- **Пререквизиты до scale-стороны (перед Этапом B):** (1) градуированный `checkAnswer` —
  сейчас возвращает строго 0/1, нужна рубрика по типам вопросов с дефолтом = текущее
  бинарное поведение (старые тесты бит-идентичны); (2) durable ID единиц ответа —
  варианты/пары/позиции адресуются индексом массива, нужны стабильные `source_key` или
  index-remap миграция до под-вопросной маршрутизации. См. `docs/specs/scoring-model.md`
  §10.7 и PRD-5 §9.2. Оба не блокируют Этап A (показатели), но обязательны до вкладов шкал.
- **Детерминизм recovery (NFR-04):** шкалы и показатели пересчитываются из сохранённых
  ответов при восстановлении попытки; значения дублируются в записи попытки.
- **Рендер test-scope блоков:** известный gap — runtime сейчас играет только
  topic-scoped контент; отображение блоков `scale-results` / `result-variables` на
  итоговой странице теста может потребовать доработки в духе PRD-1 §1.9. Проверяется на
  Этапе C; если блокирует — выносится отдельным пунктом.
- **Глобальная библиотека шкал — будущий PRD.** Текущая test-scoped модель не должна
  мешать миграции: держим `scales.key` стабильным.
- **Дублирование DSL (TS + JS-порт):** смягчается обязательным golden-корпусом паритета.
- **Видимость id псевдо-интеракций в Excel WebTutor** (example-mbi §7) — уточняется на
  первом live-LMS прогоне Этапа C.
