# HANDOFF: PRD-19 «Навигация прохождения» + ревизия оформления/структуры

Дата: 2026-06-29. Ветка: `dev`. Документ для продолжения работы в следующей сессии.

## Обновление 2026-06-29 (сессия 3): блоки E и F ЗАКОММИЧЕНЫ

Весь трек PRD-19 (включая прошлые D5/D6) теперь в git, тремя логическими коммитами поверх `adbc29d`:

- `cfab2b1` — chore: dev-скрипты сборки SCORM (`_build-live-scorm.ts`, `_build-cooldown-scorm.ts`).
- `36026bf` — feat: поэтапное завершение D5/D6 + итоги раздела + строгий режим + блок E
  (неотвеченный=неверный, FR-13/14, включая SCORM-интеракции через `gradedAnswerFor`).
- `75941a6` — feat: блок F — cooldown на `start.html` + снятие гейт-шелла (FR-19/20) + фикс
  латентного бага `ensureTemplate` (пустой `templateLayouts={}` считался загруженным).

`tsc` чист. Полная сюита зелёная: 153 файла, 2820 тестов. Блок F принят на standalone-плеере (:5050):
eligible -> обычный старт без гейт-шелла; cooldown -> карточка на `start.html` (дата ДД.ММ.ГГГГ +
«через N дн.» + disabled-кнопка), Initialize не вызывался (NFR-01/02), LMS-журнал = 0. Скрины в
`.playwright-mcp/f2-0*.png`. Реализуемость (решение пользователя): prior-результат/«Скачать отчёт»
на SCORM cooldown НЕ показываются (до Initialize данных нет), гейтятся по `state.*`; эскиз
`prd19-cooldown-start.html` финализирован и согласован.

## Статус

Закоммичен чистый чекпоинт (2 коммита, без `Co-Authored-By`):

- `186f6ab` — PRD-18 debug-player (доводка прошлой сессии; отдельные файлы, чужой трек).
- `adbc29d` — PRD-19 навигация блоки A–D + ревизия оформления/структуры (Этапы 1–3).

Рабочее дерево чистое. `tsc` чист (`npm run check`). Полная сюита зелёная: 152 файла, 2807 тестов
(`npm test`). Дерево на старте сессии было переплетено (PRD-18 + PRD-19 A/B прошлых сессий + текущие
Этапы 1–3); чистая граница только между PRD-18 и остальным, поэтому PRD-19 A/B и Этапы 1–3 объединены
в один коммит (построчно не разделимы).

## Контекст (зачем)

Пользователь сообщил о проблемах со стандартным шаблоном и редактором теста (оформление/структура).
Проведена полная ревизия (6 зон дефектов) и реализованы исправления + продолжен трек PRD-19
«Навигация прохождения», который ранее был сделан лишь наполовину (блоки A/B). Оба ученических хоста
(web + SCORM-пакет) рендерят из ОДНОГО shared-шаблона (`shared/template/`), паритет PRD-12.

## Сделано (в этом чекпоинте)

### Этап 1 — точечные фиксы редактора/оформления

- Производный dirty-флаг контент-страниц (`use-content-pages.ts`): экспорт `isDirty = dirty &&
  structurallyDirty` (нормализованное сравнение черновика с сервером `canonicalValues`/`stableStringify`).
  Кнопка «Сохранить» больше не активна без реальных изменений.
- Загрузчик изображений в свойствах страницы (`start-pages-section.tsx`, `ImagePlaceholderControl`):
  `case "image"` в `PlaceholderControl`, загрузка через `POST /api/media/upload`, хранит ПЛОСКУЮ
  URL-строку (рендерер делает `String(value)` — envelope дал бы `[object Object]`).
- Проводка `cssVars` (цвета/шрифт) на веб-хост: сервер считает их общим `buildTemplateCssVars`
  (`template-render.ts`), клиент пробрасывает в `TemplateScreen`.

### Этап 2 — логотип и брендинг на обоих хостах

- `design.logoUrl` в `PublicRenderContext` (`context.ts`), извлечение `.url` из envelope, привязка
  в layout-ах (`{{#if design.logoUrl}}`), CSS `.tb-brand`/`.tb-brand__logo` в `base.css`.
- `cssVars`/брендинг считаются из манифеста АКТИВНОГО шаблона (`paramsDir`), даже когда layout берётся
  из fallback-default.
- Картинка логотипа упаковывается в SCORM-zip с относительным путём (через
  `extractEmbeddedMediaIntoAssets`).

### Блок C (PRD-19) — прогресс-пиллы

- Заменён линейный прогресс-бар на кликабельные пиллы (FR-10/11/12), на обоих хостах.
- `CtxState.questionsProgress` (`context.ts`) + чистый builder `question-progress-context.ts`
  (`buildQuestionProgress`): scope через `answer-commit-scope`, фронтир (`clickable` только для выданных),
  read-only в строгом режиме, `scopeTopicId`, review-маркировка FR-10a.
- CSS `.tb-pills`/`.tb-pill` в `base.css` (токены шаблона, framework-free; НЕ DS `ou-quiz`).
- Layout `question.html`: пиллы через `{{#each}}` + `data-action="goto:N"`.
- SCORM `mainRender.js`: build + клик-делегатор `goto` → `goToQuestionIndex`. Web `take-test.tsx` +
  `template-question-screen.tsx`: build + `onNavigateToQuestion`.

### Блок D (частично) — экран обзора + «Вернуться» + модал

- `CtxReview` (`context.ts`) + builder `review-context.ts` (`buildReviewContext`: пиллы `allIssued` +
  список неотвеченных + `finishLabel`).
- Layout `layouts/review.html` (обзор: пиллы + список неотвеченных с «Перейти» + «Завершить»),
  зарегистрирован в `manifest.json` (`layouts.review`); CSS `.tb-unanswered`/`.q-actions`/`.obzor-*` +
  `.tb-modal*` в `base.css`.
- SCORM `mainRender.js`: фаза `review` в диспетчере, `goToReview()`/`hasSkippedInScope()`, кнопка
  «Вернуться» в `buildQuestionNavHtml`, `renderReviewScreen()`, `showFinishConfirm()` (модал FR-09).
- Web `take-test.tsx`: `reviewTpl`+`showReview`, фетч `screen-template/review`, блок рендера обзора,
  «Вернуться» в футере, модал FR-09 через DS `ModalDialog` (`finishConfirm`).
- Route `screen-template` (`tests.ts`): добавлен `review`.

Проверено визуально на SCORM (плеер `:5050`): пиллы, обзор, «Вернуться», переходы, модал — работают,
оформление через шаблон.

## Сделано в сессии 2026-06-29 (продолжение): D5 + D6 РЕАЛИЗОВАНЫ (НЕ закоммичено)

Рабочее дерево грязное (13 M + 2 новых файла + HANDOFF). `tsc` чист. Полная сюита зелёная:
153 файла, 2812 тестов. SCORM-поток верифицирован end-to-end в standalone-плеере (:5050).
Решение по объёму: поэтапное завершение применяется в ГИБКОМ режиме (`allowReturnToUnanswered`
ВКЛ — дефолт новых тестов, источник всех жалоб). СТРОГИЙ режим (ВЫКЛ) сохраняет текущее поведение
(обзор гейтится `allowReturn` по FR-08a; section-results для строгого секционного — отдельный
follow-up).

### D6 — редактор структуры FR-08a — ГОТОВ

- `start-pages-section.tsx`: компонент `ReviewSlotRow` (виртуальная строка «Обзор раздела/теста»,
  слот section-finish/test-finish; обзор — РАНТАЙМ-экран, не content_page, потому строка
  информационная). Размещён в `TopicBlock` между «Вопросами» и «Итоги раздела» (секционные) и в
  плоской зоне «Внутри теста» (один на тест). Гейт `reviewSlot`: `null` при `mode==='adaptive'`
  (FR-22 скрыт), `enabled` при `allowReturnToUnanswered` ВКЛ, иначе `disabled` + строка-комментарий
  «…включите «Возврат к неотвеченным» в «Настройки › Правила прохождения»». CSS
  `.page-row--obzor/.page-row--disabled/.page-comment` в `tb-components.css`. Прокинут через
  `InsideTestZone`. (FR-05a «Итоги раздела» гейт по `summaryForTopic` оставлен как был.)

### section-results — ВЫЧИСЛЯЕМЫЙ экран итогов раздела — ГОТОВ (основа D5)

- Контракт `CtxSectionResult` (`context.ts`) + builder `buildSectionResultContext`
  (`result-context.ts`, reuse ring-геометрии; `hasVerdict=false` при `passed===null`) + юнит-тест
  `section-result-context.test.ts`. Экспортирован в TBTemplate (`runtime-entry.ts`). Layout
  `layouts/section-results.html` (кольцо + summary + вердикт-тег + «Продолжить»; dasharray/offset
  ИНЛАЙНОМ в layout через DSL — кольцо рисуется на обоих хостах без пост-обработки), зарегистрирован
  в `manifest.layouts["section-results"]`, CSS `.section-results*` в `base.css`. Роут screen-template
  `section-results` (`tests.ts`).

### D5 — поэтапное завершение (FR-05/05a/05b) — ГОТОВ (оба хоста)

- SCORM (`contentFlow.js` + `mainRender.js` + `answers.js`): `stageSectionFinishIfBoundary()` в
  `advancePageSequence` перехватывает границу раздела (смена `topicIdForItem`, как таймер/freeze)
  → `goToReview()` (фаза 'review'); `renderReviewScreen` scope-aware (метка «Завершить раздел» vs
  «Завершить тест»); `finishSection()` (модал FR-09 при неотвеченных → заморозка `sectionCommitted`
  → `renderSectionResults` (фаза 'sectionResults') → `advanceAfterSection`); `advanceAfterSection`
  router-aware (router → `returnFromTopic` на хаб; линейный → `skipSectionFromCurrent`; конец → submit).
  Кнопка вопроса в гибком режиме всегда «Далее» (нет завершения на вопросе, FR-16). Плоский гибкий:
  обзор теста в конце. ГОЧА-фикс: `submit()` сбрасывает `state.phase='question'` перед финальным
  render — иначе диспетчер (проверяет review/sectionResults ДО `current>=total`) повторно рисует
  обзор/итоги вместо результатов теста.
- Router (FR-05b): конец чанка темы (гибкий) → обзор «Завершить раздел» → section-results «Продолжить»
  → `returnFromTopic` (хаб). Хаб уже гейтит «Завершить тест» (`isRouterReadyToFinish`, PRD-8).
- Web (`take-test.tsx`): `advanceOrStageFinish` (перехват границы/конца), `finishSectionWeb`
  (заморозка + фетч `/section-result` → section-results экран), `continueAfterSection`,
  `isLastSectionWeb`/`firstIndexAfterSection`; обзор scope-aware; модал FR-09 с `onConfirm`; пиллы и
  `navigateToQuestion` гейтятся `sectionCommitted`. Серверный endpoint
  `POST /api/attempts/:id/section-result` (`attempts.ts`) грейдит ОДИН раздел через общий
  `aggregateStandardResult` + effective-scoring (паритет с SCORM `computeSectionResult`).

ВЕРИФИКАЦИЯ SCORM (плеер :5050, тест «Базовые технологии» 23fe3cd5, 2 раздела по 5 вопросов, без
своих passRule — наследуют общий 80%): пройдено end-to-end — обзор раздела (пиллы scope + список
неотвеченных + «Завершить раздел»), модал «Завершить раздел? Вопросов без ответа: N», заморозка,
итоги раздела (кольцо/summary/вердикт/«Продолжить»), переход в след.раздел, обзор последнего раздела
→ итоги «Завершить тест» → итоги ТЕСТА. Скрины в `.playwright-mcp/d5-0*.png`.

### СТРОГИЙ режим + section-results (FR-05a) — ДОБАВЛЕНО и ВЕРИФИЦИРОВАНО

Дефолт ВСЕХ существующих секционных тестов (миграция 031: `allowReturnToUnanswered`=ВЫКЛ,
`showSectionResults`=ВКЛ). Теперь строгий секционный показывает ВЫЧИСЛЯЕМЫЕ итоги раздела МЕЖДУ
разделами — без обзора/модала/пропуска (строгий не пропускает, всё отвечено). Последний раздел
переходит к итогам теста (там уже разбивка по темам), без отдельного экрана. SCORM:
`stageSectionFinishIfBoundary` ветвится strict → `finishSection(topic,false,0,true)`; web:
`advanceOrStageFinish` strict-ветка → `finishSectionWeb(topic,false)`. ВЕРИФИЦИРОВАНО на :5050
(рантайм-оверрайд `TEST_DATA.allowReturnToUnanswered=false`): section-results 1× между разделами,
обзор/модал/skip = 0, «Продолжить», последний раздел → итоги теста.

## Осталось / follow-up

- ВЕБ-хост визуально НЕ проверен (нет dev-логина) — верифицирован tsc + полной сюитой + симметрией
  с верифицированным SCORM. При наличии кред прогнать `/learner/test/:id`.
- ROUTER визуально НЕ проверен на router-пакете (нужен `router_by_topics`-тест; в dev-БД такого нет) —
  реализован через ту же машинерию, что верифицирована на линейном; код-ревью + tsc. Собрать
  router-тест и прогнать.
- Блок E (FR-13/14) — ГОТОВ/ЗАКОММИЧЕН (`36026bf`). FR-15 (timeout-авто-завершение) уже работает:
  test-таймер зовёт `submit(true)`, грейд через `gradedAnswerFor` (неотвеченные = неверные).
- Блок F (FR-19/20) — ГОТОВ/ЗАКОММИЧЕН. Cooldown-старт + снятие гейт-шелла (`75941a6`); SCORM
  eligible-повтор «повтор: можно» — prior-результат + «Мой результат» + «Скачать отчёт» на старте
  после Initialize (`4075a20`, приёмка на плеере: PDF лучшей попытки скачивается). Остаток блока F:
  ВЕБ-паритет cooldown (серверный `retake-gate.ts` + ученический старт через тот же шаблон) — на вебе
  визуально не проверить без dev-логина.
- Блок G (статусы пропуска/возврата в отладчике PRD-18, FR-24) — отдельная подзадача трека.

## Архитектурные решения (согласованы с пользователем)

- ИНКРЕМЕНТАЛЬНО на текущей модели `kind`+`position`+`topicId`. БЕЗ slot-tree рефактора (целевая модель
  контракта — отдельный крупный трек). БЕЗ миграции. БЕЗ новых `kind`/reconcile.
- `section-finish`/`test-finish` = РАНТАЙМ-layouts шаблона (как `transition`/`blocked`), НЕ content_pages.
- `section-results` = ВЫЧИСЛЯЕМЫЙ экран (кольцо-балл/вердикт из движка результатов), НЕ авторский
  `summary` content_page.
- ОФОРМЛЕНИЕ — ТОЛЬКО ШАБЛОНОМ (жёсткое правило). FR-16 «завершение — структура, не шаблон» = гарантия
  НАЛИЧИЯ узла формой `flowMode`, НЕ рендер вне шаблона. Экраны рендерятся через `renderScreenInto`.
- Модал завершения (FR-09) — единственное host-chrome исключение (СОГЛАСОВАНО): web — DS `ModalDialog`,
  SCORM — framework-free HTML-оверлей `.tb-modal*` на токенах шаблона.

## D5 — с чего начать

Строить на СУЩЕСТВУЮЩЕЙ машинерии PRD-4 в `server/scorm/template/app/contentFlow.js`:

- `maybeExposeSectionResult(item)` — уже вычисляет/замораживает результат раздела на входе в первую
  `after_topic` страницу (`TEST_DATA.section.current.result.*`).
- `maybeFreezeSectionOnExit(item)` + `state.sectionCommitted[topicId]` — заморозка раздела.
- `pageSequence` (`rebuildPageSequence`/`currentPageItem`/`goToPageSequenceIndex`) — последовательность
  content/question/adaptive items; `syncPhaseToCurrentPage` ставит `state.phase`.

Подход: на ГРАНИЦЕ раздела (последний вопрос темы → следующий item другой темы) вместо авто-advance
показывать обзор раздела (`state.phase='review'` уже есть, builder `buildReviewContext` готов);
«Завершить раздел» → модал → заморозка → section-results layout (новый, вычисляемый, reuse
`result-context`) → продолжить. На вебе — аналогично в `take-test.tsx` (flow + showReview + section
progression). Краевые случаи: таймеры секций, адаптив (`adaptive-session` — пропуск/возврат запрещены,
FR-22), router (`routerFlow.js`).

## Карта ключевых файлов

| Область | Файлы |
| --- | --- |
| Контракт контекста | `shared/template/context.ts` (`CtxState.questionsProgress`, `CtxReview`, `CtxDesign`) |
| Builder'ы | `shared/template/question-progress-context.ts`, `review-context.ts` (+ `.test.ts`) |
| Scope-резолвер | `shared/flow/answer-commit-scope.ts` |
| Рендерер/DSL | `shared/template/render-screen.ts`, `dsl.ts`, экспорт — `runtime-entry.ts` |
| Шаблон default | `server/scorm/templates/default/{manifest.json, styles/base.css, layouts/*.html}` |
| SCORM рантайм | `server/scorm/template/app/render/mainRender.js`, `actions/answers.js`, `contentFlow.js`, `render/{startPage,viewResults,adaptiveRender}.js`, `assets/app.js` |
| Web ученик | `client/src/pages/learner/{take-test,template-question-screen,result}.tsx`, `components/template-screen.tsx` |
| Сервер | `server/services/template-render.ts`, `server/routes/{tests,attempts}.ts` |
| Редактор | `client/src/features/tests/editor/{use-content-pages.ts, sections/start-pages-section.tsx}` |

## Гочи (важно)

- Устаревший предсобранный `dist/scorm/assets/shared-runtime.js` (артефакт `npm run build`, НЕ в git)
  перекрывает свежий бандл TBTemplate (`getSharedRuntimeBundle` предпочитает `readAsset`). Если новый
  экспорт из `runtime-entry.ts` «не виден» в пакете — удалить этот файл (dev бандлит из TS свежим).
- Бэкенд на `tsx` БЕЗ watch (vite 8): после серверных правок ПЕРЕЗАПУСКАТЬ `npm run dev` (:8081). HMR
  ловит только клиент. Порт из `.env` (`PORT=8081`, не 5000).
- В SCORM-пакете `TEST_DATA` инжектится BASE64 (`__TEST_JSON_B64__`) — plaintext-grep не находит;
  декодировать из `app.js`. Пакетный `runtime.js` — это SCORM RTE (НЕ бандл TBTemplate).
- SCORM render/*.js бандлятся в один package `app.js` (не отдельные файлы) — проверять упакованный
  `app.js` grep-ом.
- `layouts/review.html` есть только в default-шаблоне; для загруженных шаблонов без него обзор на вебе
  не отрендерится (fallback) — учесть при валидации контракта.
- DS-CSS в двух копиях (`vendor/ui-kit/css/university-rt.css` + `client/src/styles/vendor/...`).

## Верификация (команды)

```bash
npm run check                 # tsc
npm test                      # полная сюита (пороги покрытия 50%)
npm run scorm:sample          # собрать sample-пакет в out/
npm run scorm:player          # standalone-плеер на :5050 (грузит out/*.zip) — БЕЗ авторизации
```

Сборка пакета из ЖИВОГО теста для визуала (tsx-скрипт во временной папке, не в корне):
`buildScormExportData(testId,{source:"debug"})` → `generateScormPackage` → запись в `out/`. Тест для
прогона навигации: «Базовые технологии» `23fe3cd5-04f1-4f3c-bf19-494fe5b4262f` (sectional
`linear_by_topics`, `allowReturn=true`). dev-БД — Docker на `localhost:55432` (см. `.env`). dev-сервер
на `:8081`. Веб-хост требует авторизации (dev-логина нет — визуал делался на SCORM-плеере).

## Ссылки

- План: `~/.claude/plans/sunny-snuggling-nest.md` (декомпозиция C/D, обновление 2026-06-29).
- Спека: `docs/specs/prd-19/skip-return-navigation.md` (FR-01..FR-24).
- Контракт структуры: `docs/specs/prd-19/test-structure-contract.md` (целевая slot-tree, черновик).
- Эскизы (эталон UI): `docs/wireframes/prd19-navigation-flow.html`, `prd19-learner-real.html`
  (framework-free разметка на токенах шаблона), `prd19-structure-obzor.html` (FR-08a),
  `prd19-results.html`.
- Память: `project_template_editor_revision_track`, `project_prd19_skip_return_track`.
