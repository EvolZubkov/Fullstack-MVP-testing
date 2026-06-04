# HANDOFF: Ограничение повторного прохождения (PRD-6 retake gate)

> **СТАТУС 2026-06-04: PRD-6 PHASE 1 ЗАВЕРШЁН.** Retake gate end-to-end: ядро (схема `retakePolicy` +
> eligibility-движок/плагины/реестр с TS↔JS-парити), рантайм-гейт до SCORM `Initialize` (NFR-01/02),
> блок-экран из системной страницы шаблона `system.blocked`, боевой источник `webtutor_cooldown` через
> ClientBridge `get_metadata` (вскрыт на живом портале RT), авторский пейн «Повторное прохождение».
> Эскиз `docs/wireframes/prd6-retake-policy.html` согласован. Отложено в Phase 2: администрируемый
> реестр конфигов, UI-выбор конфигурации, диагностика плагина. Этот документ — handoff закрытого трека.
>
> Предыдущий трек (PRD-10 «Цена ответа» + PRD-11 «Квоты выдачи») закрыт 2026-06-04 и запушен; его
> детальный handoff — в истории git (этот файл до коммита PRD-6-closeout).

## 1. Что сделано (PRD-6 Phase 1)

- **Схема** (`shared/schema.ts`): `retakePolicySchema` (enabled, cooldownPeriodDays 1–3650 с нормализацией
  legacy `cooldownDays`, gateMode, eligibilityPlugin{key, configId, failPolicy}, blockedPageId); колонка
  `tests.retake_policy_json` (миграция `013_prd6_retake_policy.sql`, применена к dev-БД).
- **Eligibility-ядро** (`shared/eligibility/`): `types.ts`, `engine.ts` (cooldownDecision / normalizeVerdict /
  applyFailPolicy / buildRetakeState / evaluateEligibility), `plugins.ts` (webtutor / suspend + ClientBridge-
  парсинг: extractSecid / extractCourseCompletionDate), `registry.ts` (read-only, сидируется в коде).
  Парити: JS-порт `server/scorm/template/app/eligibility/{engine,plugins}.js` + golden
  `tests/eligibility-engine-port.test.ts`.
- **Рантайм-гейт** (`server/scorm/template/app/eligibility/gate.js`): запускается в `bootstrap/main.js` ДО
  `SCORM.init()` (NFR-01/02). Заблокирован → блок-экран (0 SCORM-вызовов); разрешён → «Начать курс» →
  `runCourse()`. failPolicy (failOpen/failClosed) + таймаут 5с.
- **Блок-экран из шаблона** (§4.4): гейт грузит layout `system.blocked` (default/corporate/minimal — ветки
  `data-retake-branch` cooldown/error/default), заполняет `retake.*` через path-DSL; встроенный экран —
  фолбэк. jsdom-тест `tests/eligibility-gate-blockwall.test.ts`.
- **webtutor_cooldown — боевой источник** (вскрыт на живом портале RT, см. §3): дата прохождения курса
  берётся из ClientBridge `get_metadata` SOAP (НЕ каталог-грид, НЕ adl.data).
- **Экспорт** (`server/scorm/builders/test-json.ts`): `test.retakePolicy` + резолвленный `test.retakePlugin`
  (runtimeEntry + config из реестра) УСЛОВНО при enabled (FR-02 byte-identical). Acceptance
  `tests/scorm-retake-acceptance.test.ts`.
- **Авторский UI** (`client/src/features/tests/editor/sections/basic-settings-section.tsx`): rail-пейн
  «Повторное прохождение» — Switch enabled → период / Select плагина (из
  `/api/tests/:id/available-eligibility-plugins`) / SegmentedControl failPolicy / best-effort warning для
  suspend. Маппер `retakePolicy` ↔ `retake_policy_json` (`test-editor.mappers.ts`, экспортирован
  `defaultRetakePolicy()`); dirty-tracking в `use-test-editor.ts`. Тесты: round-trip маппера + UI пейна.
  Верифицировано вживую (off/webtutor/suspend = эскиз; save round-trip PUT→БД→reload).
- **Локальный тулинг:** WebTutor-мок в `scripts/scorm-player.mjs` (ClientBridge get_metadata + форма даты
  последней попытки) — проверка гейта без живого WT.
- **completionReportMode УДАЛЁН** — это конструктор тестов, тест обязан оставлять статус passed/failed;
  нейтральный режим не бизнес-требование, конфликтовал с cooldown и в рантайме не был реализован.

`npm run check` чист, `vitest` **1918 зелёных**, DS-чек эскиза clean.

## 2. Отложено в Phase 2

- Администрируемый реестр eligibility-конфигов (сейчас read-only, в коде) + UI редактирования
  endpoint/фильтров/regex (NFR-03).
- UI-выбор одной из ≥2 конфигураций плагина (сейчас одна активная подставляется неявно).
- Диагностика «тестовая проверка плагина» (сырые/отфильтрованные записи, выбранная попытка, решение).
- (Опц.) Семантика completed/failed для маркера WebTutor — сейчас ловится только «пройден» (passed).

## 3. Ключевые решения и боевые находки (не очевидны из кода)

- **WebTutor дата прохождения — ТОЛЬКО через ClientBridge `get_metadata`** (вскрыто на живом портале
  university.rt.ru через DevTools на запущенном SCO, ≥2 модуля): same-origin POST
  `/services/ClientBridgeService`, SOAPAction `…datex-soft.com/get_metadata`, нужен per-page SECID (32-hex),
  скрейпится с course-card. Ответ — XAML course-card; дата в блоке `best_learn_step_success` («Курс был
  пройден ДД.ММ.ГГГГ»). `adl.data` НЕ поддерживается (err 401), cross-attempt стора нет. Маркер
  RT-тема-специфичен (admin-config). object_id резолвится из launch-контекста (location/referrer/top/parent,
  same-origin); паттерны конфигурируемы.
- **Гейт ДО Initialize** (NFR-01/02): при блокировке `cmi.*` не трогается — проверено в scorm-player
  (0 SCORM-вызовов). Блок-экран = системная страница шаблона (§4.4), не встроенный HTML.
- **Эскиз — что убрали по обсуждению:** превью даты (на этапе авторинга «последней попытки» не существует —
  это рантайм-значение на конкретного учащегося); completionReportMode (см. §1).

## 4. Dev-окружение и проверки

- **БД:** контейнер `test-builder-postgres` (Docker, `localhost:55432`, см. `.env` в корне; НЕ системный PG
  на 5432). Память `reference_database`.
- **Сервер:** `npm run dev` (PORT=8081 из `.env`; tsx БЕЗ watch — после правок server/route/storage
  перезапускать). Логин автора `admin@test.com` / `admin123` (сид `storage.ts`).
- **Проверки:** `npm run check` (tsc), `npx vitest run`, `npm run build`. Coverage-гейт 50% краснеет на
  запусках подмножества (клиентский UI без unit-покрытия) — не регрессия.
- **SCORM-тулинг:** `npm run scorm:sample`/`scorm:template`/`scorm:player` (плеер + WebTutor-мок для retake);
  acceptance-тесты. Поведение WebTutor — зондом на реальном SCO (память `feedback_no_live_webtutor_verify_local`).
- **markdownlint:** `npx markdownlint-cli2 <файл>` — MD013 (120) для прозы (таблицы/код игнорятся).

## 5. Технические паттерны

- **Parity-паттерн:** авторитетная TS (`shared/…`) + рукописный JS-порт (`server/scorm/template/app/…`) +
  golden через `new Function(portSrc + ';return X;')`. Так сделаны eligibility-движок и плагины.
- **Рантайм-гейт:** сайд-эффекты (fetch / render / suspend-read) — в `gate.js`; чистая логика — в
  engine/plugins; гейт грузит шаблон сам (`ensureTemplate`), т.к. до `runCourse` шаблон не загружен.
- **Секция редактора:** пропсы `{model, updateModel}`; запись в `TestEditorModel`; маппер api↔model;
  dirty-tracking в `use-test-editor.ts`. testId доступен как `model.id`.
- **UI — только `@universityrt/ui-kit`** (Switch/NumberInput/Select/SegmentedControl/Banner/…); эскиз — DS
  `ou-*`/`tb-components.css` + каркас `wf-*`; DS-handbook в `C:\Repositories\ENGINERING_HANDBOOK`.
- **Push — ТОЛЬКО `origin` (vvlad1973)**, НИКОГДА upstream (EvolZubkov); по имени remote (память
  `reference_github_repo`).

## 6. Подводные камни

- WebTutor-интеграция: дату даёт ТОЛЬКО ClientBridge get_metadata — не уходить в архаику каталога-грид
  (legacy-функции selectLastAttemptDate/webtutorCooldownDecide в `plugins.ts` оставлены, но рантайм идёт по
  ClientBridge).
- Урок `q.tags` (PRD-11): поле может не доезжать в рантайм-`TEST_DATA` — проверять экспорт. Аналогично для
  retake проверять, что `test-json` кладёт `retakePolicy` + резолвленный `retakePlugin`.
- НИКОГДА не объявлять визуальный успех UI без Playwright-сверки с эскизом (память
  `feedback_screenshot_review`, `feedback_wireframes_first_ui`); скриншоты — в `.playwright-mcp/`, не в корне.
