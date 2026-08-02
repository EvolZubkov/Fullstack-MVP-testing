# План: консолидация текстов обратной связи на итогах и в отчёте

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** тексты обратной связи теста и тем показываются ученику и на экране итогов, и в PDF-отчёте —
одним консолидированным блоком, без повторов, одинаково на обоих хостах и в обоих режимах.

**Architecture:** механизм консолидации уже есть — `collectRecommendations` собирает тексты, курсы,
мероприятия и вложения из списка источников и дедуплицирует их. Работа заводит в этот список тексты
тем и разделов, чинит два разрыва на пути текста (веб не сохраняет его в результат попытки, пакет
читает не то поле и не ту колонку), приводит показ по теме к одному правилу видимости и выдаёт тот
же блок отчёту и адаптивному экрану.

**Tech Stack:** TypeScript, Zod, Express, Vitest, шаблоны `shared/template` + макеты обоих
дизайн-шаблонов, PDF-отчёт `shared/report`.

Предшествующая работа: [PRD-32](2026-08-02-feedback-assets-delivery.md) — вложения того же блока;
её [приёмка](../../reports/prd32-feedback-assets-acceptance.md) и вскрыла этот пробел.

---

## Согласованные решения

| Развилка | Решение |
| --- | --- |
| Источник текста | `feedback_json.text` темы, раздела и теста; легаси `topics.feedback` — запасное чтение для тем, которых не касался нынешний редактор. Откат нужен на ОБОИХ хостах: если его сделать только в пакете, тема со старым текстом покажется в пакете и промолчит в вебе |
| Где показывается текст | ТОЛЬКО в консолидированном блоке; per-topic слот в карточке темы больше не заполняется и уходит из макетов |
| Правило видимости | Обратная связь показывается ВСЕГДА, кроме ЯВНОГО УСПЕХА, и одинаково на двух уровнях: тема (текст, курсы, мероприятия, вложения) молчит при `passed === true`, тест целиком молчит при явно пройденном тесте. Неопределённость («вердикт не выносился» — например, измерительный тест без порога или тема без потемного порога) трактуется в пользу показа: потерять памятку, которую автор повесил, хуже, чем показать её лишний раз |
| Адаптивный режим | В объёме: блок появляется в адаптивных макетах обоих шаблонов |
| Отчёт | Печатает тот же блок из той же функции, а не собственную копию правила |

Известная несогласованность, которую эта работа НЕ трогает: курсы и мероприятия берутся по правилу
«раздел ИЛИ тема» (`vrRecommended`), тогда как тексты и вложения объединяют оба места. Менять
поведение курсов здесь — риск регресса без запроса; вынесено в открытые вопросы.

## Структура файлов

| Файл | Ответственность | Действие |
| --- | --- | --- |
| `shared/schema.ts` | `topicResultSchema` получает текст обратной связи темы | Изменить |
| `server/routes/attempts.ts` | Сохраняет текст темы и раздела вместе с попыткой | Изменить |
| `server/services/result-context.ts` | Прокидывает текст в общий сборщик | Изменить |
| `shared/template/result-context.ts` | Тексты тем — источники консолидированного блока; правило видимости | Изменить |
| `server/scorm/builders/test-json.ts` | Печёт текст из `feedback_json.text`, а не из легаси-колонки | Изменить |
| `server/scorm/template/app/render/viewResults.js` | Единое имя поля, единое правило видимости | Изменить |
| `shared/report/report-context.ts` | Консолидированный блок в контексте отчёта | Изменить |
| `server/scorm/templates/default/layouts/*.html`, `templates/certification/layouts/*.html` | Блок в отчёте и в адаптивных итогах; удаление per-topic слота | Изменить |

**Порядок обязателен:** контракт (1-2) -> хосты (3-4) -> правило видимости (5) -> отчёт и макеты
(6-7) -> прогоны и приёмка (8-9).

**Прогоны только точечные:** `npm test -- <путь>`. Полная сюита и `npm run test:cov` — по явному
разрешению владельца: рабочая копия общая. Прогон из Bash с диском в нижнем регистре ложно падает —
запускать из PowerShell.

---

### Task 1: Текст темы доезжает до сохранённого результата

**Files:**

- Modify: `shared/schema.ts` (`topicResultSchema`)
- Modify: `server/routes/attempts.ts` (сборка `topicResults`)
- Test: `tests/routes.attempts-tests.test.ts`

- [ ] **Step 1: Написать падающий тест**

Кейс на маршрут завершения попытки: у темы задан `feedback_json.text`, у раздела теста — свой текст;
в сохранённом `topicResults` появляется поле с обоими текстами (или объединённой строкой — форму
выбери в Step 3 и зафиксируй в тесте). Обвязку моков возьми из соседних кейсов файла: там уже
проверяется, что `recommendedAssets` доезжают.

- [ ] **Step 2: Прогнать и убедиться в падении**

Run: `npm test -- tests/routes.attempts-tests.test.ts`
Expected: FAIL — поля нет ни в схеме, ни в сборке.

- [ ] **Step 3: Расширить контракт**

В `topicResultSchema` (`shared/schema.ts`) добавь поле рядом с `recommendedAssets`:

```ts
  // Тексты обратной связи темы (`topics.feedback_json.text`) и раздела этого теста над
  // ней (`test_sections.feedback_json.text`), сохранённые вместе с попыткой — экран
  // итогов рисуется из сохранённого результата, а перечитывание живого контента отдало
  // бы прошлой попытке сегодняшний текст. `.default([])` держит валидными попытки,
  // посчитанные до этой работы.
  feedbackTexts: z.array(z.string()).default([]),
```

Массив, а не строка: тема и раздел — два независимых источника, склеивать их в одну строку значит
терять границу и мешать дедупликации.

В `server/routes/attempts.ts` заполняй его там же, где собираются `recommendedAssets`, из тех же
двух блоков. Пустые и повторяющиеся строки не клади.

- [ ] **Step 4: Прогнать тест**

Run: `npm test -- tests/routes.attempts-tests.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add shared/schema.ts server/routes/attempts.ts tests/routes.attempts-tests.test.ts
git commit -m "feat(results): текст обратной связи темы сохраняется вместе с попыткой"
```

---

### Task 2: Тексты тем становятся источником консолидированного блока

**Files:**

- Modify: `shared/template/result-context.ts`
- Modify: `server/services/result-context.ts`
- Test: `shared/template/__tests__/result-context-feedback-assets.test.ts`

- [ ] **Step 1: Написать падающий тест**

Кейсы: текст темы попадает в `result.recommendations.texts`; текст раздела тоже; одинаковый текст в
теме и разделе даёт ОДНУ строку; текст, совпадающий с текстом обратной связи теста, не повторяется
(дедуп оставляет первое вхождение — копию теста).

- [ ] **Step 2: Прогнать и убедиться в падении**

Run: `npm test -- shared/template/__tests__/result-context-feedback-assets.test.ts`
Expected: FAIL.

- [ ] **Step 3: Завести источники**

В `shared/template/result-context.ts` там, где сейчас в `recommendationSources` кладутся вложения
темы (блок с комментарием «PRD-32: the attachments of the topics…»), добавляй в тот же источник и
тексты: источник темы становится `{ text, links: [], events: [], assets }`. Порядок прежний —
темы последними, дедуп оставляет общий (тестовый) экземпляр.

Тип `TopicInput` уже несёт `feedback?: string | null` — используй его; веб-адаптер
(`server/services/result-context.ts`, `toTopicInput`) заполняет его из нового поля результата.

- [ ] **Step 4: Прогнать тесты**

Run: `npm test -- shared/template/__tests__/result-context-feedback-assets.test.ts tests/result-context-parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add shared/template/result-context.ts server/services/result-context.ts \
  shared/template/__tests__/result-context-feedback-assets.test.ts
git commit -m "feat(results): тексты тем и разделов вливаются в консолидированный блок"
```

---

### Task 3: Пакет берёт текст из того же места и под тем же именем

**Files:**

- Modify: `server/scorm/builders/test-json.ts` (около строки 247)
- Modify: `server/scorm/template/app/render/viewResults.js` (около строк 268 и 351)
- Test: `server/scorm/__tests__/test-json-prd29.test.ts`, `tests/results-feedback-assets-scorm.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Кейсы: в `TEST_DATA` секция несёт текст из `feedback_json.text` темы и раздела; рантайм пакета
отдаёт эти тексты в `recommendations.texts`; тема, у которой заполнена только легаси-колонка
`topics.feedback`, тоже показывается (запасное чтение).

- [ ] **Step 2: Прогнать и убедиться в падении**

Run: `npm test -- server/scorm/__tests__/test-json-prd29.test.ts tests/results-feedback-assets-scorm.test.ts`
Expected: FAIL.

- [ ] **Step 3: Починить источник и имя**

`test-json.ts` сейчас печёт `topicFeedback: s.topic.feedback || null` — легаси-колонку, которую
действующий редактор темы не пишет (он шлёт только `feedbackJson`). Читай `feedback_json.text`, с
откатом на легаси-колонку, и добавь текст РАЗДЕЛА (`s.feedbackJson`).

`viewResults.js` кладёт значение под именем `topicFeedback`, а общий сборщик читает `feedback` —
приведи к одному имени. Проверь ОБА места (экран итогов и финишный экран).

- [ ] **Step 4: Прогнать тесты**

Run: `npm test -- server/scorm/__tests__/test-json-prd29.test.ts tests/results-feedback-assets-scorm.test.ts tests/scorm-builders.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add server/scorm/builders/test-json.ts server/scorm/template/app/render/viewResults.js \
  server/scorm/__tests__/test-json-prd29.test.ts tests/results-feedback-assets-scorm.test.ts
git commit -m "fix(scorm): пакет читает текст обратной связи темы из действующего источника"
```

---

### Task 4: Одно правило видимости

> Правило уточнено владельцем по ходу работы. Первая редакция («показывать только при явном
> провале») отвергнута: в стандартном тесте пороги по темам задаются не всегда, и тема без порога
> молча теряла бы материалы. Действующая редакция — в таблице решений выше; здесь текст сохранён
> как история решения.

**Files:**

- Modify: `shared/template/result-context.ts`
- Modify: `server/scorm/template/app/render/viewResults.js`
- Test: `shared/template/__tests__/result-context-feedback-assets.test.ts`, `tests/results-feedback-assets-scorm.test.ts`

Сегодня курсы и мероприятия темы показываются только при `passed === false` (`vrRecommended`), а
вложения — всем. После консолидации это станет видно на экране: три ресурса одной темы по двум
правилам. Решение владельца: всё по теме показывается только при непройденной теме.

- [ ] **Step 1: Написать падающий тест**

Кейсы: у ПРОЙДЕННОЙ темы ни текст, ни вложения в блок не попадают; у непройденной попадают оба.
Кейс на обоих хостах.

- [ ] **Step 2: Прогнать и убедиться в падении**

Expected: FAIL — сейчас вложения пройденной темы показываются.

- [ ] **Step 3: Сузить источник**

В общем сборщике источник темы добавляется только при `topic.passed === false`. Тот же фильтр в
рантайме пакета (`vrTopicAssets` сейчас намеренно НЕ загейчен — комментарий там надо переписать,
а не удалить: он объясняет прежнее решение, которое отменено).

- [ ] **Step 4: Прогнать тесты**

```bash
npm test -- shared/template/__tests__/result-context-feedback-assets.test.ts \
  tests/results-feedback-assets-scorm.test.ts tests/result-context-parity.test.ts
```

Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git commit -m "fix(results): обратная связь темы показывается по одному правилу"
```

---

### Task 5: Отчёт получает тот же блок

**Files:**

- Modify: `shared/report/report-context.ts` (около строки 228)
- Modify: `server/scorm/templates/default/layouts/report.html`, `report.adaptive.html`
- Modify: `templates/certification/layouts/report.html`, `report.adaptive.html`
- Test: `shared/report/__tests__/` (файл контекста отчёта), `tests/report-layout-parity.test.ts`

- [ ] **Step 1: Написать падающий тест**

Кейсы: контекст отчёта несёт тот же список текстов, что и экран (сравнение с результатом общего
сборщика на одном входе); тексты не дублируются; отчёт по попытке без обратной связи блока не
рисует.

- [ ] **Step 2: Прогнать и убедиться в падении**

Run: `npm test -- shared/report/__tests__ tests/report-layout-parity.test.ts`
Expected: FAIL.

- [ ] **Step 3: Собрать блок из общей функции**

`report-context.ts` собирает курсы и мероприятия своей функцией и печатает per-topic `showFeedback`
только по проваленной теме. Заведи тексты из ТОЙ ЖЕ функции консолидации, что использует экран, —
второй копии правила быть не должно.

- [ ] **Step 4: Добавить блок в макеты**

В `report.html` и `report.adaptive.html` обоих шаблонов добавь секцию текстов рядом с курсами и
мероприятиями. Разметку бери дословно по образцу соседних секций отчёта — это перенос, а не новая
вёрстка.

- [ ] **Step 5: Прогнать тесты**

Expected: PASS, включая гард паритета макетов.

- [ ] **Step 6: Коммит**

```bash
git commit -m "feat(report): отчёт печатает консолидированные тексты обратной связи"
```

---

### Task 6: Блок рекомендаций появляется на адаптивном экране

**Files:**

- Modify: `server/scorm/templates/default/layouts/results.adaptive.html`
- Modify: `templates/certification/layouts/results.adaptive.html`
- Test: `tests/results-template-gating.test.ts` либо соседний набор рендера итогов

Сегодня блока в адаптивных макетах нет вовсе — в адаптивном режиме не показываются ни тексты, ни
курсы, ни вложения ни у одной темы.

- [ ] **Step 1: Написать падающий тест**

Кейс: рендер адаптивных итогов на контексте с рекомендациями даёт блок с текстами и материалами.

- [ ] **Step 2: Перенести разметку**

Возьми блок `{{#if result.recommendations.hasAny}}…` из `results.html` соответствующего шаблона
ДОСЛОВНО и вставь в `results.adaptive.html` того же шаблона. Никакой новой вёрстки: блок уже
утверждён, задача — паритет режимов.

- [ ] **Step 3: Прогнать тесты и проверить оба шаблона**

Expected: PASS; гард паритета раскладок не краснеет.

- [ ] **Step 4: Коммит**

```bash
git commit -m "feat(results): адаптивный экран итогов показывает блок рекомендаций"
```

---

### Task 7: Убрать двойной показ

**Files:**

- Modify: `server/scorm/templates/default/layouts/results.html`, `report.html` (+ адаптивные)
- Modify: `templates/certification/layouts/*` (те же четыре макета)
- Modify: `shared/template/result-context.ts` (`buildTopicFeedbackView`), `shared/report/report-context.ts` (`showFeedback`)

- [ ] **Step 1: Убедиться, что текст уже виден в консолидированном блоке**

Прогони кейсы Task 2 и Task 5 — до удаления слота они должны быть зелёными.

- [ ] **Step 2: Снять per-topic слот**

Удали из макетов ветку `{{#if hasFeedback}}` карточки темы и печать `{{ feedback }}` в отчёте, а из
кода — вычисление флагов, которое перестало кому-либо служить. Проверь, что `hasRecommendations` в
карточке темы (курсы) при этом не пострадал.

- [ ] **Step 3: Прогнать наборы рендера итогов и отчёта**

Expected: PASS. Гард паритета макетов обязателен: слот снимается в ЧЕТЫРЁХ макетах на шаблон.

- [ ] **Step 4: Коммит**

```bash
git commit -m "refactor(results): текст обратной связи живёт только в консолидированном блоке"
```

---

### Task 8: Прогоны, превью, сборка

- [ ] **Step 1: Точечные прогоны затронутого**

```bash
npm test -- shared/template/__tests__/result-context-feedback-assets.test.ts \
  shared/template/__tests__/result-context-measures.test.ts \
  tests/result-context-parity.test.ts tests/results-render-measures.test.ts \
  tests/results-feedback-assets-scorm.test.ts tests/results-template-gating.test.ts \
  tests/report-layout-parity.test.ts tests/routes.attempts-tests.test.ts \
  server/scorm/__tests__/test-json-prd29.test.ts
```

Expected: PASS. Запускать из PowerShell.

- [ ] **Step 2: Перегенерировать превью**

Run: `npm run scorm:previews` — превью содержат скомпилированную копию сборщика; закоммитить
отдельно.

- [ ] **Step 3: Типы и сборка**

Run: `npm run check`, затем `npm run build`
Expected: без ошибок.

---

### Task 9: Приёмка в браузере и плеере

Проверяется на живом стенде, юнит-тестов недостаточно — все три дефекта PRD-32 прошли мимо зелёных
тестов.

- [ ] **Step 1: Стандартный тест, веб**

Тема с текстом обратной связи, раздел со своим текстом, тест со своим. Непройденная тема: в блоке
все тексты, без повторов, порядок «тест раньше темы». Пройденная тема: её текст и вложения не
показываются.

- [ ] **Step 2: Тот же тест, пакет**

Собрать SCORM, пройти в локальном плеере: тот же состав блока, что в вебе.

- [ ] **Step 3: Адаптивный тест**

Блок появился на адаптивном экране итогов, состав соответствует правилу видимости.

- [ ] **Step 4: Отчёт**

Выгрузить PDF по попытке в вебе и из пакета: тексты те же, что на экране; карточка темы не
дублирует текст.

- [ ] **Step 5: Оба шаблона**

Повторить ключевой шаг на шаблоне «Сертификация» — паритет держится вручную.

- [ ] **Step 6: Записать отчёт приёмки и обновить дорожную карту**

---

## Открытые вопросы

| Вопрос | Почему не решён здесь |
| --- | --- |
| Курсы и мероприятия темы берутся по правилу «раздел ИЛИ тема», тексты и вложения — «раздел И тема» | Приведение к общему правилу меняет состав курсов на уже работающих тестах; отдельное решение владельца |
| Легаси-колонка `topics.feedback` | Остаётся запасным чтением. Вычистить её можно только после того, как станет ясно, есть ли темы, где она расходится с `feedback_json` |
