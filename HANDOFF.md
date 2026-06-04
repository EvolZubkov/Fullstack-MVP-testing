# HANDOFF: «Цена ответа» (PRD-10) + «Квоты выдачи по тегам» (PRD-11)

Документ для продолжения в новой сессии. Дизайн-фаза обоих треков ЗАКРЫТА; дальше — реализация
после согласования эскизов.

## 1. Назначение и контекст

Два пост-MVP трека под бизнес-запрос «РТК-сертификация руководителей считается внутри SCORM, без
внешнего Excel-постпроцессора» (второй постпроцессор сверх MBI; РТК идёт на платформу сразу после
релиза):

- **PRD-10 «Цена ответа»** — градуированный (частичный) балл за вопрос.
- **PRD-11 «Квоты выдачи по тегам»** — стратифицированная выдача (гарантированное покрытие подтем).

Парный трек **PRD-2 (показатели) + PRD-5 (шкалы) закрыт ранее** (2026-06-03, Этапы A-C; см. ROADMAP
§0.2 и коммиты `a6e3e32`…`a9bbc9a`, golden `tests/mbi-golden.test.ts`). MBI-постпроцессор уже не нужен.

## 2. Статус (2026-06-04): эскиз PRD-10 согласован, Стадия 1 реализована

**Обновление (сессия 2, 2026-06-04):** эскиз PRD-10 доработан (устранён скачок размера модалки —
единый стабильный фрейм `xl` + фиксированная высота, скролл только в body) и **согласован** —
перенесён в `docs/wireframes/approved/prd10-question-scoring.html`. Реализована **Стадия 1 PRD-10**
(схема): миграция `010_prd10_question_scoring.sql` (колонка `questions.scoring_json` + CHECK на
`kind`, применена к dev-БД, идемпотентна); zod `questionScoringSchema` (union exact/weighted/tiered)
и колонка `scoringJson` в `shared/schema.ts`; проброс в `storage.ts` (create/duplicate) и
`server/routes/questions.ts` (create/update) с валидацией (FR-13); тесты
`tests/schema-prd10-scoring.test.ts`. OQ-1/OQ-2/OQ-3 закрыты. Реализована **Стадия 2 PRD-10**
(рантайм SCORM): авторитетный движок `shared/scoring/engine.ts` (`scoreAnswer` →
`{score, sMax, ratio}`: exact/weighted/tiered, счётчики `c,x,T/P/N`, неаддитивная ступенчатая
таблица); JS-порт `server/scorm/template/app/scoring/engine.js` (вшит в `index.ts` перед
`resultsPage.js`); `checkAnswer` в `resultsPage.js` делегирует `ScoringEngine.scoreAnswer(...).ratio`
(guard + fallback на старое 0/1); golden-parity `tests/scoring-engine-port.test.ts` + юниты
`tests/scoring-engine.test.ts`. Реализована **Стадия 3 PRD-10** (экспорт): `buildTestJson`
(`server/scorm/builders/test-json.ts`) переносит `scoring` в рантайм-вопрос пакета — оба блока
(секции + адаптив), УСЛОВНО (только когда задано → пакеты без цены ответа бит-идентичны, FR-02);
так `q.scoring` доходит до `checkAnswer` и градуированный путь активен end-to-end; тесты в
`tests/scorm-builders.test.ts`. `npm run check` чист, `vitest` **1733 зелёных**, `npm run build` ок.
ВАЖНО: серверный `server/utils/check-answer.ts` (веб-попытки) оставлен бинарным — отдельный шаг
(не на пути РТК). FR-12 (per-question `scoreRatio`/«Частично правильно» в CMI/learner-рендер) НЕ
сделан — presentational-слой, балл темы/теста уже градуирован. Уточнение: монолита `assets/app.js`
с `checkAnswer` НЕТ (§7 ниже неточен). Реализована **Стадия 4 PRD-10** (UI): секция «Цена ответа»
в редакторе вопроса — `client/src/pages/author/scoring-builder.tsx` (ScoringBuilder + buildScoringJson)
интегрирована в `questions.tsx` (state/init/reset/save). Режимы: single → exact/weighted (таблица
весов), multiple/matching/ranking → exact/tiered (конструктор ступеней). На **shadcn** (решение:
консистентно с формой, которая НЕ на ui-kit; эскиз = спека раскладки). Playwright: все режимы +
end-to-end save/round-trip (`scoring_json` пишется/читается, токен `T` сохраняется). `check`/`build`
зелёные. Отложено: preview-модалка, drag-reorder ступеней. ВАЖНО про dev: сервер на `tsx` без watch —
**после правок route/storage нужно перезапускать `npm run dev`** (иначе старый код пишет `scoring_json`
= null; ловил это при проверке). Реализована **Стадия 5 PRD-10** (порог + сертификация): `count`-
правило прохождения раздела/теста переведено на `Σ s` (earnedPoints) в рантайме
`checkPassRuleWithPartial` (3 call-site: per-section/per-topic/overall) — решение «Вариант А» (FR-10);
`percent`-правило уже считало на `Σ s`; для `exact`+1 балл регрессии нет (vitest зелёный). Тест
`tests/scoring-pass-rule.test.ts`. Сертификация (FR-11) уже работала: PRD-2 `controls_status`
(success/completion) + DSL `countPassed()==countTopics()` — кода не потребовалось. Реализована
**Стадия 6 PRD-10** (golden РТК): `tests/rtk-golden.test.ts` + фикстура `tests/fixtures/rtk-golden.json`
(генератор `rtk-golden.gen.py`). Движок `shared/scoring/engine` с РТК-стандартными конфигами
воспроизводит **все 63 балла** внешнего pandas-обработчика (`key_NEW_15-08-25.xlsx` +
`report_processed_pandas_*`), **0 расхождений**, по всем 4 типам. Правила взяты из
`docs/references/main/main.py`. `check`/`build` зелёные, `vitest` **1803**.

**PRD-10 ЗАВЕРШЁН (Стадии 0–6).** Градуированная оценка работает end-to-end (UI → экспорт → рантайм
→ `Σ s` → порог раздела на `Σ s` → сертификация), подтверждено golden против РТК. Остаточные
не-ядровые пункты: preview-модалка балла; серверный `check-answer.ts` (веб-попытки) бинарный; CMI
per-question `scoreRatio`/«Частично правильно» (FR-12).

**PRD-11 Стадии 1-3 выполнены** (квоты выдачи, бэкенд end-to-end):

- Стадия 1 (схема): миграция `011` (колонка `test_sections.draw_blueprint_json` + CHECK, применена,
  идемпотентна); zod `drawBlueprintSchema`/`drawStratumSchema` + колонка; проброс storage
  (`_insertSections` + legacy) + `SectionPayload`; валидация `Σ count <= drawCount` (FR-05) в
  `sectionBodySchema`; тест `schema-prd11-blueprint`.
- Стадия 2 (выдача): авторитетный `shared/draw/blueprint.ts` `drawSection` (страты + дедуп `used`
  FR-04 + остаток без `exact`-тегов FR-03a + warning FR-06, `shuffle` инъектируется); JS-порт в
  `server/scorm/assets/app.js` (`drawSection`, в `generateVariant`); сервер `routes/attempts.ts`
  использует TS напрямую. Тесты `draw-blueprint` + golden-parity `draw-blueprint-port`.
- Стадия 3 (экспорт): `buildTestJson` переносит `drawBlueprint` в рантайм-секцию УСЛОВНО (FR-02).

`check`/`build` зелёные, `vitest` **1837**. Прим.: отбор `shuffle(...).slice(0,drawCount)` живёт в
`server/scorm/assets/app.js` `generateVariant` (НЕ resultsPage). **Эскиз квота-редактора СОГЛАСОВАН**
(`docs/wireframes/prd11-draw-quotas.html`): свич + инлайн-блок в реальной строке темы `tb-topic-row`
(ui-kit), режим Ровно/Не менее НА КАЖДЫЙ тег, реальные теги; выверен Playwright light/dark.
**Модель финализирована:** `strata: [{tag, count, mode}]` — mode per-страта, дефолт `exact`; без
`modeGranularity`/топик-mode/тогла «Общий/По тегам». Стадии A1-A3 (схема/движок/тесты) **надо
упростить** под это (выкинуть `modeGranularity` + топик-`mode`; `effMode = s.mode ?? exact`).

**ВАЖНО — тегирование вопросов внесено в охват PRD-11** (§3a спеки, под-трек B): поле
`questions.tags` есть, но **задать тег вопросу нельзя** — нет ни UI (chip-инпут), ни проброса в API
(`questions.ts`/`storage` поле `tags` игнорируют). Без тегов квота-Select пуст. План B: API (`tags` в
create/update, как `scoringJson`) → эскиз chip-инпута в редакторе вопроса (shadcn) + согласование →
UI. Порядок дальше: упростить A1-A3 → B-api → эскиз B0b → UI (B-ui, затем A4 квоты). Ниже — исходный
план дизайн-фазы.

Сделано в дизайн-фазе (документы):

| Артефакт | Состояние |
| --- | --- |
| `docs/specs/scoring-model.md` §11 «Цена ответа» | Нормативная модель (v1.9) |
| `docs/specs/prd-10/graded-answer-scoring.md` | План (13 FR, 6 стадий) |
| `docs/wireframes/approved/prd10-question-scoring.html` | Эскиз редактора (9 состояний); согласован 2026-06-04, в `approved/` |
| `docs/specs/prd-11/tag-draw-quotas.md` | План квот выдачи |
| `docs/specs/brd-scorm-enhancements.md` | BR-09 «Цена ответа» + новый BR-10 «Квоты выдачи», Этап 10/11, модель данных |
| `docs/ROADMAP.md` §0.2 | PRD-10/PRD-11 подняты перед релизом РТК; источник PRD-1...PRD-11 |
| Issues `#12`/`#17`/`#23`/`#24`/`#25`/`#26` | Актуализированы (см. §6) |

Коммиты: `db7027c` (scoring §11), `dcb2c34` (PRD-10 + эскиз), `3b3e5e0` (PRD-11), `4b35469`
(BRD/ROADMAP), `3b59488` (эскиз — убран дубль заголовка + пояснительные баннеры). Ветка `dev`
запушена в `origin` (vvlad1973) до `4b35469`; `3b59488` — локальный (не запушен).

## 3. Ключевые решения (не очевидны из кода)

- **Терминология (важно):** «**Цена ответа**» (НЕ «рубрика»). «**Тема**» в прозе (НЕ «секция»);
  поле БД остаётся `test_sections`. «Раздел» — это та же тема в РТК/потоке.
- **Цена ответа по типам:** `single` обычный — точное совпадение (0/1); `single` с весами — балл =
  вес выбранной опции (АДДИТИВНО, ложится на сетку «Вклады вопросов», нового рантайма почти не
  требует); `multiple`/`matching`/`ranking` — СТУПЕНЧАТАЯ таблица «условие → балл» над счётчиками
  `(c, x, T)` — НЕАДДИТИВНА (лишняя неверная опция понижает ступень), это реальный кодовый пробел.
  Дефолт — точное совпадение, `sMax = 1`, старые тесты бит-идентичны. Сейчас `checkAnswer`
  (`resultsPage.js`) БИНАРНЫЙ.
- **Цена ответа — ось ПРАВИЛЬНОСТИ**, отдельная от вкладов в шкалы (PRD-5) и от квот выдачи (доставка).
  Балл темы/теста = `Σ s`; пороги прохождения — на теме/тесте (`topic_pass_rule_json`/
  `overall_pass_rule_json`); сертификация — показатель PRD-2 + `controls_status=success`.
- **Квоты выдачи:** на теме (`test_sections.draw_blueprint_json`): `strata: [{tag, count, mode}]`;
  `mode` = `exact` (ровно `count`) / `min` (не менее); гранулярность `modeGranularity` = `uniform`
  (общий, дефолт) / `per_tag`. Общая выборка `drawCount`; `Σ count <= drawCount`; остаток случайно из
  вопросов БЕЗ `exact`-тегов; нехватка → НЕблокирующий warning; stateless (без retry-логики).
- **Подтема = тег** (`questions.tags`); иерархии тем НЕТ; per-tag порогов прохождения НЕТ.
- **WebTutor НЕ поддерживает `adl.data`** (проверено зондом, `GetValue("adl.data._count")` → err 401;
  память `reference_webtutor_scorm_runtime`). Cross-attempt стора у автономного пакета НЕТ →
  «свежесть на retry» / фиксированные формы / anti-repeat в пакете НЕРЕАЛИЗУЕМЫ; сняты (РТК не требует
  как обязательное; при необходимости — на уровне назначения LMS). Квоты stateless — работают.

## 4. Эталон РТК и проверка

`docs/references/Обновление сертификации для руководителей/.../Обработка серт теста/`:
`key_NEW_15-08-25.xlsx` (208 вопросов, ключ) + `report_processed_pandas_*.xlsx` (пример обработки).
Подтверждено: коэффициенты выравнивания убраны (балл против абсолютного порога раздела); два
тематических уровня — «Раздел» + «Тема» (порог только на разделе); per-question баллы 0/1/2/3
ступенчатые для multiple/matching, веса опций для single. Это golden-фикстура для PRD-10 Стадии 6
(парсинг xlsx — `openpyxl` через `python`; кириллица в путях ломает bash — читать через PowerShell
LiteralPath или python).

## 5. Что дальше — gate и стадии

**GATE (NFR-14):** эскиз PRD-10 — на согласовании; код Стадии 1+ НЕ начинать до явного «ок».
Для PRD-11 — отдельный эскиз квота-редактора (Стадия 0b) + согласование. UI без согласованных
эскизов запрещён (память `feedback_wireframes_first_ui`).

**PRD-10:** 1) схема `question.scoring` (`kind: exact|weighted|tiered`) + миграция, durable id единиц
(оценка) → 2) рантайм: градуированный `checkAnswer` + оценщик ступенчатой таблицы + `Σ s` по теме
(парити TS↔JS-порт) → 3) экспорт `scoring` в `test-json` → 4) UI редактора цены ответа → 5) порог
раздела (pass-rule) + показатель-сертификация (источник темы в DSL при нехватке) → 6) golden vs
`key_NEW`.

**PRD-11:** 1) схема `test_sections.draw_blueprint_json` + миграция + zod → 2) логика выдачи
(`app.js` + парный рантайм) с дедупликацией + warning при нехватке → 3) экспорт блюпринта → 4) UI
квота-редактора в теме → 5) тесты (квоты/дедуп/нехватка/обратная совместимость).

Открытые вопросы к Стадии 1: durable id единиц `matching`/`ranking` (сейчас индексные source_key,
scoring-model §10.7 #2); есть ли в DSL PRD-2 доступ к баллу/прохождению темы для показателя-
сертификации (PRD-10 OQ-2 — проверить, при нехватке добавить `topicScore`/`topicPassed`).

## 6. Статус issues (GitHub `vvlad1973/Fullstack-MVP-testing`)

ВСЕГДА `--repo vvlad1973/Fullstack-MVP-testing`, не upstream EvolZubkov (память `reference_github_repo`).
Открыты (scoring-трек):

- `#17` — «Цена ответа» в рантайме = РЕАЛИЗАЦИЯ PRD-10; спека+эскиз готовы.
- `#12` — доспека: закрыто по «Цене ответа» (§11/PRD-10); остаток — композиция шкал + пересчёт-формула
  (будущий scales-PRD).
- `#23` — РТК-слой: фикс-формы/retry СНЯТЫ (WebTutor); остаток — пороги/композиты/сертификация
  (PRD-2/PRD-10) + квоты (PRD-11).
- `#25` — в основном закрыто (inverse/band/КР-референс); остаток — learner-рендер (→ #24).
- `#24` — C2-фастфоллоу (learner-рендер, конструктор формул, окно попыток — пересекается с PRD-6).
- `#26` — эпик (ядро доставлено; блок «Новые спеки трека» = PRD-10/PRD-11).

## 7. Технические паттерны (повторять при реализации)

- **Parity-паттерн:** авторитетная TS-реализация (`shared/...`) + рукописный JS-порт
  (`server/scorm/template/app/...`) + golden-тест через `new Function(portSrc + ';return X;')`. Так
  сделаны DSL и движок шкал; так же делать оценщик ступенчатой таблицы (Стадия 2). Рантайм смешанный:
  модульные `app/render/*.js` + монолитный `server/scorm/assets/app.js` (там `checkAnswer`,
  `calculateResults`, отбор вопросов `shuffle(...).slice(0, drawCount)`), всё конкатенируется при экспорте.
- **Миграции** `migrations/00N_*.sql`: шапка-комментарий, `BEGIN; … COMMIT;`, идемпотентно
  (`IF NOT EXISTS`), enum/regex CHECK в SQL.
- **Секция редактора:** пропсы `{ model, updateModel }`; запись в `TestEditorModel`; diff-on-save
  оркестратор; стабильный React-key через `clientKey` (не из редактируемых полей).
- **Route-тест:** `vi.hoisted` storageMock + `vi.mock("../server/storage")` + РЕАЛЬНЫЙ
  `requireAuth`/`requireAuthor` + supertest. Расширение `loadFullTest`/экспорта новым storage-методом
  требует добавить метод в моки (`tests/routes.tests.test.ts`, `tests/scorm-export.test.ts`).
- **UI — только `@universityrt/ui-kit`** (NumberInput/Select/Combobox/SegmentedControl/Switch/...);
  не писать руками `.ou-*` и не оборачивать нативные `<select>`/`<input>` (память
  `feedback_ds_native_controls_to_components`). Эскиз — только DS `ou-*`/`tb-components.css` (DS-handbook
  в `C:\Repositories\ENGINERING_HANDBOOK\handbook\design-system\`).

## 8. Dev-окружение и проверки

- **БД:** контейнер `test-builder-postgres` (Docker, `localhost:55432`, см. `.env` в корне; НЕ системный
  PG на 5432). `docker start test-builder-postgres`; миграции 008/009 применены; `npx drizzle-kit
  push --force` при расхождении. Память `reference_database`.
- **Сервер:** `npm run dev` (порт из `.env`, `PORT=8081`). Логин автора `admin@test.com` / `admin123`
  (форма предзаполняет неработающие `admin@local.test`).
- **Проверки:** `npm run check` (tsc), `npx vitest run`, `npm run build`. Coverage-гейт 50% был
  красным ДО трека (клиентский UI без unit-тестов) — не регрессия.
- **SCORM-инструменты:** `npm run scorm:sample`/`scorm:template`/`scorm:player` (плеер с инспектором
  шкал/показателей/LMS-трафика); `tests/scorm-package-acceptance.test.ts`. Память
  `reference_scorm_acceptance_tooling`. Поведение WebTutor проверять зондом на реальных выгрузках
  (память `feedback_no_live_webtutor_verify_local`).
- **markdownlint:** `npx markdownlint-cli2 <файл>` — MD013 (120) включён для прозы (таблицы/код игнорит);
  строки-метаданные в шапке не должны превышать 120.

## 9. Подводные камни

- `id` тестов/вопросов — `varchar(36)`, НЕ uuid (новые PK — uuid `defaultRandom`). drizzle-zod: `uuid`
  строгий `.uuid()`; `numeric` → string; `jsonb.$type<T>()` может расходиться с zod (уточнять `.extend`).
- В эскизах: эскизные классы (`wf-list-head` и т. п.) НЕ существуют в CSS приложения — в React Tailwind/
  `tb-*`/`ou-*`. Кнопки ui-kit: иконка через `leadingIcon`/`icon`, не children.
- НИКОГДА не объявлять визуальный успех UI без Playwright-сверки с эскизом (память
  `feedback_screenshot_review`, `feedback_wireframes_first_ui`). Скриншоты — в `.playwright-mcp/`, не в
  корне (память `feedback_no_temp_files_in_root`).
- `git push` — ТОЛЬКО в `origin` (vvlad1973), НИКОГДА в `upstream` (EvolZubkov); push явно по имени
  remote (память `reference_github_repo`).
