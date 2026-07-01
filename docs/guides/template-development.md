# Руководство по разработке шаблонов оформления

Практическое руководство для разработчика, который создаёт внешний шаблон
оформления (ZIP) для конструктора SCORM-тестов: что положить в архив, как
устроен манифест и макеты, какой синтаксис понимает движок, какие данные
доступны на каждом экране, как пройти валидацию и проверку работоспособности
и как загрузить шаблон в систему.

**Статус:** актуально; соответствует движку рендера `shared/template/`, эталонному шаблону
`server/scorm/templates/default/` и админ-реестру PRD-3 (`server/routes/admin-templates.ts`).
**Дата актуализации:** 2026-07-01

Связанные документы:

- [Платформа SCORM-шаблонов](../specs/spec-template-platform.md) — формальная
  спецификация формата (источник истины).
- [PRD-3: жизненный цикл шаблонов](../specs/prd-3/external-templates.md) —
  административный процесс загрузки и активации.
- [PRD-12: единый рантайм рендера](../specs/prd-12/web-runtime-parity.md) —
  как один движок обслуживает SCORM и веб.

Эталонный шаблон, на который опираются примеры ниже, лежит в репозитории:
`server/scorm/templates/default/`. Он проходит валидацию и проверку
работоспособности, поэтому его файлы — самый надёжный образец.

## 1. Как это работает

- **Исполнение только в браузере.** Сервер никогда не исполняет HTML/CSS/JS
  шаблона. Он лишь читает файлы пакета, проверяет их структуру и упаковывает в
  SCORM. Любая динамика — это браузерный `template.js` и DSL-разметка.
- **Единый рендерер.** И SCORM-плеер, и веб-предпросмотр рисуют экраны одним и
  тем же движком (`renderScreenInto`). Один и тот же шаблон выглядит одинаково на
  обоих хостах — отдельной разметки «для веба» не существует.
- **Шаблон не знает о внутренних данных.** Макеты читают только публичный контекст
  рендера (`course.*`, `result.*`, `state.*`, ...). Прямого доступа к внутренней
  модели теста у шаблона нет.
- **Никаких внешних ресурсов.** Все стили, скрипты, шрифты и картинки лежат внутри
  ZIP. Ссылки на CDN (`https://...`) запрещены и блокируют активацию.

Конвейер рендера одного экрана (порядок важен):

1. **DSL** — раскрываются `{{ ... }}`, `{{#if}}`, `{{#each}}`, `{{> partial}}`
   (вывод экранируется).
2. **`data-path`** — в элементы с атрибутом `data-path` подставляется текст из
   контекста (через `textContent`, экранированно).
3. **`data-slot`** — в области `data-slot="name"` вставляется управляемый HTML
   (текст вопроса, интерактив, контент страницы) — это делает ядро.
4. **`data-placeholder`** — для контентных страниц заполняются области
   `data-placeholder="key"` по типу поля.

## 2. Структура ZIP

Минимальный пакет:

```text
my-template/
  manifest.json            # обязателен, в корне
  shell.html               # внешняя оболочка плеера
  layouts/
    start.html             # стартовый экран (опционально, но рекомендуется)
    content.html           # контентные страницы (intro/info/summary/...)
    question.html          # экран вопроса
    results.html           # экран результатов
  styles/
    theme.css              # токены оформления (:root)
    base.css               # базовые стили компонентов
  scripts/
    template.js            # браузерный lifecycle-скрипт (опционально)
  preview.svg              # миниатюра для карточки в реестре
  demo/
    course.json            # демонстрационные данные для предпросмотра/проверки
```

Правила упаковки:

- `manifest.json` должен оказаться в корне распакованного дерева. Если весь
  контент завёрнут в одну общую папку верхнего уровня (`my-template/...`), система
  снимет этот префикс автоматически.
- Имена путей внутри архива — относительные, в POSIX-форме (`layouts/start.html`).
  Абсолютные пути и выход за корень (`../`) отклоняются как небезопасные.
- Все файлы, на которые ссылается манифест, должны присутствовать. Лишние файлы
  допустимы, но дают предупреждение (кроме `demo/`, `preview.html`, `README`,
  `*.md`, `*.ejs` — они разрешены без предупреждений).

## 3. manifest.json

Манифест — единственный обязательный файл и точка входа.

### 3.1 Обязательные поля

| Поле | Тип | Требование |
| --- | --- | --- |
| `id` | string | Уникальный, шаблон `^[a-z0-9-]+$` |
| `name` | string | Отображаемое имя |
| `version` | string | Семантическая версия `\d+.\d+.\d+` (например, `1.0.0`) |
| `templateApiVersion` | string | Версия API платформы; поддерживается `"1.0"` |
| `contentTemplates` | array | Минимум один элемент |
| `layouts` | object | Обязательны ключи `shell`, `question`, `content`, `results` |
| `assets` | object | Обязателен `assets.preview` |
| `preview` | object | Набор демо-данных и маршрутов предпросмотра |
| `params` | array | Список параметров (может быть пустым `[]`) |
| `capabilities` | object | Объявленные возможности шаблона |

### 3.2 Полный пример манифеста

```json
{
  "id": "my-template",
  "name": "Мой шаблон",
  "version": "1.0.0",
  "templateApiVersion": "1.0",
  "description": "Одноколоночный плеер с акцентным заголовком.",
  "params": [
    {
      "key": "primaryColor",
      "type": "color",
      "label": "Основной цвет",
      "default": "217 91% 42%",
      "group": "Цвета",
      "section": "branding"
    },
    {
      "key": "fontFamily",
      "type": "select",
      "label": "Шрифт",
      "default": "Inter",
      "options": ["Inter", "Roboto", "Arial"]
    }
  ],
  "contentTemplates": [
    {
      "key": "start.standard",
      "label": "Старт: стандартный",
      "kind": "start",
      "pageKind": "start",
      "placeholders": []
    },
    {
      "key": "intro.hero",
      "label": "Введение: заголовок и изображение",
      "kind": "intro",
      "pageKind": "content.intro",
      "placeholders": [
        { "key": "title", "type": "text", "label": "Заголовок", "maxLength": 120 },
        { "key": "subtitle", "type": "text", "label": "Подзаголовок", "maxLength": 300 },
        { "key": "heroImage", "type": "image", "label": "Изображение" }
      ]
    },
    {
      "key": "info.text",
      "label": "Информация: текст",
      "kind": "info",
      "pageKind": "content.info",
      "placeholders": [
        { "key": "title", "type": "text", "label": "Заголовок", "maxLength": 120 },
        { "key": "body", "type": "richText", "label": "Текст" }
      ]
    },
    {
      "key": "summary.result",
      "label": "Итог: результат",
      "kind": "summary",
      "pageKind": "content.summary",
      "placeholders": [
        { "key": "title", "type": "text", "label": "Заголовок", "maxLength": 120 },
        {
          "key": "result",
          "type": "resultField",
          "label": "Результат",
          "allowedPaths": ["result.scorePercent"],
          "defaultPath": "result.scorePercent",
          "allowedRenderers": ["core.ringChart", "core.textMetric", "core.progressBar"],
          "defaultRenderer": "core.ringChart"
        }
      ]
    },
    {
      "key": "results.standard",
      "label": "Итоги теста: стандартные",
      "kind": "results",
      "pageKind": "results",
      "placeholders": []
    },
    {
      "key": "router.menu",
      "label": "Меню карточек",
      "kind": "router",
      "pageKind": "content.router",
      "isDefault": true,
      "placeholders": [
        { "key": "title", "type": "text", "label": "Заголовок", "maxLength": 120 }
      ]
    },
    {
      "key": "question.standard",
      "label": "Стандартный макет вопроса",
      "kind": "questions",
      "isDefault": true,
      "placeholders": []
    }
  ],
  "layouts": {
    "shell": "shell.html",
    "start": "layouts/start.html",
    "content": "layouts/content.html",
    "question": "layouts/question.html",
    "results": "layouts/results.html"
  },
  "assets": {
    "styles": ["styles/theme.css", "styles/base.css"],
    "scripts": ["scripts/template.js"],
    "images": [],
    "preview": "preview.svg"
  },
  "capabilities": {
    "navigation": ["linear", "locked"],
    "progress": ["questions", "pages", "hidden"],
    "timer": true,
    "questionTypes": ["single", "multiple", "matching", "ranking"],
    "runtimeApi": "1.0"
  },
  "preview": {
    "demoData": "demo/course.json",
    "defaultRoute": "start",
    "routes": [
      { "route": "start", "label": "Старт" },
      { "route": "content.intro", "templateKey": "intro.hero", "label": "Введение" },
      { "route": "content.info", "templateKey": "info.text", "label": "Учебный материал" },
      { "route": "question.single", "questionId": "demo-single", "label": "Вопрос: один вариант" },
      { "route": "question.multiple", "questionId": "demo-multiple", "label": "Вопрос: несколько" },
      { "route": "question.matching", "questionId": "demo-matching", "label": "Сопоставление" },
      { "route": "question.ranking", "questionId": "demo-ranking", "label": "Ранжирование" },
      { "route": "content.summary", "templateKey": "summary.result", "label": "Итог" },
      { "route": "results", "label": "Результаты" },
      { "route": "system.blocked", "label": "Доступ ограничен" }
    ]
  }
}
```

### 3.3 Дополнительные опциональные макеты

Кроме обязательных четырёх, можно объявить опциональные макеты-ключи:

| Ключ | Экран |
| --- | --- |
| `start` | Стартовая страница (если нет — используется `content`) |
| `results.adaptive` | Результаты адаптивного теста (уровни вместо баллов) |
| `system.blocked` | Экран блокировки повторного прохождения (PRD-6) |
| `system.transition` | Межуровневый переход в адаптивном тесте |

## 4. Макеты и слоты

Макет — это фрагмент HTML (не целый документ: без `<html>`/`<head>`/`<body>`).

### 4.1 Оболочка (shell.html)

Единственное обязательное требование к оболочке — наличие области страницы
`data-slot="page"`, в которую ядро монтирует текущий экран:

```html
<div class="tb-player" data-template="my-template">
  <div class="tb-progress-wrap">
    <div class="tb-progress-bar" id="tb-progress-fill"></div>
  </div>
  <main id="app" class="tb-content" data-slot="page" tabindex="-1"></main>
</div>
```

Кнопки навигации (`data-nav="next"`, `data-action="..."`) ядро привязывает само,
когда они присутствуют. Текущий валидатор и проверка работоспособности их наличие
в оболочке **не требуют** (встроенный `default` объявляет их в макетах страниц, а
не в `shell.html`).

### 4.2 Экран вопроса (question.html)

Обязательны два слота: текст вопроса и зона интерактива (варианты ответа). Их
заполняет ядро по типу вопроса:

```html
<div class="layout-question-wrap">
  <div class="q-header">
    <h1 class="q-title" data-path="course.title"></h1>
  </div>
  <div class="question-card">
    <div class="question-meta" data-path="state.questionCounterLabel"></div>
    <div class="question-text" data-slot="question-text"></div>
    <div data-slot="question-media"></div>
    <div data-slot="question-interaction"></div>
    <div data-slot="question-feedback"></div>
  </div>
</div>
```

Обязательные слоты вопроса: `question-text`, `question-interaction`. Опциональные:
`question-media`, `question-feedback`, `question-hint`, `question-counter`.

### 4.3 Контентная страница (content.html)

Контентная страница (introduction / info / summary / router) рендерится в слот
`page-content`. Ядро вставляет туда области `data-placeholder` по описанию
выбранного `contentTemplate` и заполняет их значениями автора:

```html
<div class="layout-content-wrap">
  <div data-slot="page-content"></div>
  <div class="navigation">
    <button type="button" class="btn" data-nav="next">Далее</button>
  </div>
</div>
```

Слот `page-content` не обязателен формально (без него движок отрисует контент во
весь контейнер), но его отсутствие даёт предупреждение — лучше объявить.

### 4.4 Стартовая страница и результаты

Эти макеты целиком на DSL и `data-path` (управляемых слотов нет). Фрагмент старта:

```html
<div class="start-page">
  <h1 class="start-title" data-path="course.title">Тест</h1>
  <p class="start-description" data-path="course.description"></p>

  <div class="start-info-grid">
    <div class="info-row">
      <div class="info-row-label">Количество вопросов</div>
      <div class="info-row-value" data-path="course.questionCount"></div>
    </div>
    {{#if course.timeLimitMinutes}}
    <div class="info-row">
      <div class="info-row-label">Ограничение времени</div>
      <div class="info-row-value"><span data-path="course.timeLimitMinutes"></span> мин</div>
    </div>
    {{/if}}
  </div>

  <div class="start-actions">
    {{#if state.canResume}}<button class="btn" data-action="resume">{{state.resumeLabel}}</button>{{/if}}
    {{#if state.canStart}}<button class="btn" data-action="start-test">{{state.startLabel}}</button>{{/if}}
  </div>
</div>
```

## 5. DSL рендерера

Движок понимает подмножество синтаксиса в стиле mustache. Поддерживается:

| Конструкция | Назначение |
| --- | --- |
| `{{ path }}` | Экранированная подстановка текста |
| `{{#if path}}...{{/if}}` | Блок при истинном `path` (пустой массив = ложь) |
| `{{#unless path}}...{{/unless}}` | Блок при ложном `path` |
| `{{#each path}}...{{/each}}` | Перебор массива |
| `{{> name}}` | Подключение частичного шаблона (partial) |

Внутри `{{#each}}` доступны: текущий элемент как контекст, `{{@index}}`,
`{{@number}}` (индекс + 1), `{{@first}}`, `{{@last}}`, а также `{{@root}}` для
корневого контекста.

```html
{{#each result.topicResults}}
<div class="topic-card">
  <div class="topic-name">{{@number}}. {{topicName}}</div>
  <div class="results-pill {{passClass}}">{{statusLabel}}</div>
  <div class="val">{{correct}} / {{total}}</div>
</div>
{{/each}}
```

**Что НЕ поддерживается (по дизайну):**

- JavaScript, хелперы и выражения внутри `{{ ... }}` (только путь, без пробелов).
- Сырой/неэкранированный вывод `{{{ ... }}}` — выбрасывает ошибку.
- Любой `{{ ... }}` экранируется как текст. Богатый HTML вставляется только через
  управляемые `data-slot` / `data-placeholder`, не через DSL.

Невалидный шаблон (незакрытый блок, `{{{ }}}`, выражение с пробелом) выбрасывает
ошибку на этапе компиляции — экран будет помечен проваленным в проверке
работоспособности.

## 6. Привязка данных: четыре механизма

| Механизм | Где | Что делает | Источник |
| --- | --- | --- | --- |
| `{{ path }}` | В HTML макета | Экранированный текст + управление потоком | Контекст рендера |
| `data-path="x.y"` | Атрибут элемента | `textContent` элемента из пути (экранированно) | Контекст рендера |
| `data-slot="name"` | Атрибут контейнера | `innerHTML` управляемого HTML | Ядро (вопросы, контент) |
| `data-placeholder="key"` | Атрибут контейнера | Значение поля контентной страницы по типу | Значения автора |

`{{ path }}` и `data-path` читают одно и то же — выбирайте по удобству:
`data-path` удобен, когда нужно оставить «заглушку» в статической вёрстке;
`{{ }}` — когда значение встроено в текст или внутри условия/цикла.

## 7. Публичный контекст рендера

Макеты читают только эти пространства имён. Каждое присутствует лишь на тех
экранах, где применимо.

### 7.1 `course.*` (старт, вопрос, результаты)

| Поле | Тип | Описание |
| --- | --- | --- |
| `title` | string | Название теста |
| `description` | string | Описание |
| `questionCount` | number | Число вопросов |
| `passPercent` | number\|null | Проходной балл, % |
| `timeLimitMinutes` | number\|null | Лимит времени |
| `maxAttempts` | number\|null | Разрешено попыток |

### 7.2 `state.*` (старт, вопрос)

| Поле | Описание |
| --- | --- |
| `questionCounterLabel` | Подпись счётчика, напр. «Вопрос 1 из 10» |
| `canStart` / `startLabel` | Показать кнопку старта и её подпись |
| `canResume` / `resumeLabel` / `resumeNote` | Возобновление попытки |
| `canRestart` / `canViewResults` | Перезапуск / просмотр сохранённого результата |
| `exhausted` | Попытки закончились |

### 7.3 `result.*` (результаты)

| Поле | Описание |
| --- | --- |
| `passed` | Тест пройден (boolean) |
| `passClass` | Готовый класс `is-pass` / `is-fail` |
| `statusLabel` | Готовая подпись статуса |
| `scorePercent` | Процент результата |
| `ringDashoffset` | Готовое смещение для SVG-кольца |
| `totalQuestions` / `correct` / `earnedPoints` | Сводка |
| `topicResults[]` | Результаты по темам (`topicName`, `correct`, `total`, `percent`, `passClass`, `statusLabel`) |

Важно: классы и подписи (`passClass`, `statusLabel`, `ringDashoffset`) уже
вычислены ядром. DSL не считает их сам — просто подставляйте готовые значения.

### 7.4 `retake.*` (экран блокировки) и `transition.*` (адаптивный переход)

`retake`: `cooldownPeriodDays`, `availableDateHuman`, `reason`.
`transition`: `isCorrect`, `iconClass`, `title`, `level.{class,message,...}`,
`topic.toTopic`, `showContinue`.

## 8. Контентные шаблоны и placeholders

`contentTemplates[]` описывает «типы» контентных страниц. Каждый элемент:

- `key` — уникальный ключ варианта (`intro.hero`);
- `kind` — функциональный вид страницы;
- `placeholders[]` — поля, которые заполняет автор.

Виды (`kind`, PRD-1 §4.3):

| `kind` | Назначение | Гранулярность |
| --- | --- | --- |
| `start` | Стартовый экран теста (лендинг) | Одна на тест, всегда |
| `intro` | «Введение раздела» (`before_topic`) | По одной на тему (только в режимах по темам) |
| `info` | Учебная/информационная страница, любой контент | Сколько угодно |
| `questions` | Макет страницы вопроса | Одна в плоском режиме / по одной на тему |
| `router` | Страница-маршрутизатор (меню тем) | Одна, только `router_by_topics` |
| `summary` | «Итог раздела» (`after_topic`); показывает **результат раздела** (Core кладёт его в `result.*`) | По одной на тему (только в режимах по темам) |
| `results` | «Итоги теста» — итоговый результат всего теста | Одна на тест, всегда |

`start` и `results` — тест-уровневые системные экраны (лендинг и итоги теста); они
присутствуют всегда и рисуются собственными рантайм-экранами (в поток контентных
страниц не входят). `intro` и `summary` — симметричные «закладки» раздела (одна перед
вопросами раздела, другая после его результата) и существуют **только** при делении на
темы; в плоском тесте (`linear_flat`) их нет, а их роль на уровне теста выполняют `start`
и `results`. Стандартный шаблон обязан объявить по одному варианту каждого системного
`kind` (`start`/`intro`/`summary`/`results`/`router`/`questions`). Несколько вариантов
одного `kind` (напр. два варианта `start`) — допустимы; автор выбирает нужный.

Типы placeholders и как они отрисовываются в `data-placeholder`:

| `type` | Отрисовка |
| --- | --- |
| `text`, `textarea` | Экранированный текст, переносы строк → `<br>` |
| `richText`, `html` | HTML как есть (доверенный богатый контент) |
| `number` | Экранированное число |
| `image` | `<img src="...">` (вписывается в контейнер) |
| `boolean` | Галочка или пусто |
| `resultField` | Показатель результата через реестр рендереров (см. ниже) |

Встроенные рендереры `resultField` (`shared/template/renderers.ts`): `core.textMetric`,
`core.badge`, `core.progressBar`, `core.ringChart` (кольцевая диаграмма),
`core.segmentedProgress`. Шаблон ограничивает выбор через `allowedRenderers` плейсхолдера.

Пример `resultField` в наборе данных автора (значение `values.result`) — кольцо:

```json
{
  "path": "result.scorePercent",
  "renderer": "core.ringChart",
  "rendererOptions": { "showValue": true, "decimals": 0, "size": 150, "strokeWidth": 14 },
  "label": ""
}
```

На странице `summary` («Итог раздела») `result.scorePercent` — это результат **раздела**
(Core подаёт его в `result.*`, §8.2 платформенной спеки).

## 9. Параметры (params)

Параметры — это настройки оформления, которые автор теста меняет во вкладке
«Оформление». Типы: `color`, `select`, `boolean`, `number`, `image`, `text`,
`url` и др. Значения автора пробрасываются:

- в CSS — как переменные (цвета хранятся как HSL-компоненты, см. ниже);
- в `template.js` — через `window.TestBuilder.context.get().params`.

Пример описания параметра:

```json
{
  "key": "primaryColor",
  "type": "color",
  "label": "Основной цвет",
  "default": "217 91% 42%",
  "group": "Цвета",
  "section": "branding"
}
```

## 10. Темизация: theme.css и base.css

Токены оформления объявляются в `theme.css` на `:root`. **Цвета хранятся как
HSL-компоненты** (без `hsl(...)`), чтобы их можно было переопределять параметрами
и собирать в `hsl(var(--token))`:

```css
:root {
  --background: 225 7% 7%;
  --foreground: 0 0% 98%;
  --primary: 217 91% 42%;
  --card: 225 14% 14%;
  --border: 0 0% 22%;
  --font-sans: Inter, -apple-system, 'Segoe UI', sans-serif;
  --radius: 12px;
}
```

В `base.css` используйте токены через `hsl(...)`:

```css
.start-title {
  color: hsl(var(--foreground));
  font-family: var(--font-sans);
}
.btn {
  background: hsl(var(--primary));
  border-radius: var(--radius);
}
```

Изоляция: в веб-предпросмотре шаблон монтируется в Shadow DOM, а селекторы
`:root`/`body` отображаются на корень тени. Не полагайтесь на глобальные стили
страницы-хоста — всё нужное объявляйте в своих CSS.

## 11. Браузерный скрипт template.js

Опциональный lifecycle-скрипт. Доступен глобальный объект `window.TestBuilder`:

| API | Назначение |
| --- | --- |
| `TestBuilder.template.on(event, cb)` | Подписка на событие жизненного цикла |
| `TestBuilder.template.emit(event, data)` | Отправка события |
| `TestBuilder.context.get()` | `{ params }` — эффективные значения параметров |
| `TestBuilder.scorm.commit()` | Принудительная фиксация SCORM-состояния |
| `TestBuilder.ui.toast(msg)` / `ui.modal(opts)` | UI-хелперы |

Главное событие — `page:enter` (вход на новый экран). Минимальный скрипт,
обновляющий полосу прогресса:

```javascript
/**
 * @module template
 * @description Updates the progress fill on page transitions.
 */
(function () {
  "use strict";
  var tb = window.TestBuilder;
  if (!tb) return;

  function updateProgress() {
    var fill = document.getElementById("tb-progress-fill");
    if (!fill) return;
    try {
      fill.style.width = (TEST_DATA.progress.question.percent || 0) + "%";
    } catch (_) {}
  }

  tb.template.on("page:enter", function () {
    updateProgress();
  });

  document.addEventListener("DOMContentLoaded", updateProgress);
})();
```

Ограничения скрипта:

- Только браузерный код. Никаких `import`/`require`/`fetch` с внешних адресов —
  это блокирует активацию.
- Скрипт проверяется только компиляцией (синтаксис), но не исполняется на сервере.
  Ошибка времени выполнения проявится при рендере экрана в проверке.

## 12. Демонстрационный набор данных (demo/course.json)

`preview.demoData` указывает на JSON с данными, на которых строятся живой
предпросмотр и проверка работоспособности. Каждый маршрут из `preview.routes`
должен иметь соответствующие данные. Структура:

```json
{
  "schemaVersion": "1.0",
  "locale": "ru-RU",
  "params": { "primaryColor": "217 91% 42%", "fontFamily": "Inter" },
  "course": {
    "title": "Основы информационной безопасности",
    "description": "Демонстрационный тест",
    "passPercent": 70,
    "timeLimitMinutes": 30,
    "maxAttempts": 3,
    "questionCount": 4,
    "topics": [
      { "id": "topic-1", "title": "Базовые угрозы", "status": "available" }
    ],
    "contentPages": [
      {
        "id": "demo-intro", "type": "intro", "route": "content.intro",
        "templateKey": "intro.hero",
        "values": { "title": "Введение", "subtitle": "Читайте внимательно", "heroImage": null }
      }
    ],
    "questions": [
      {
        "id": "demo-single", "type": "single",
        "prompt": "Какой пароль самый надёжный?",
        "options": [
          { "id": "s1", "text": "qwerty123" },
          { "id": "s2", "text": "Длинная случайная фраза", "correct": true }
        ]
      },
      {
        "id": "demo-matching", "type": "matching", "prompt": "Сопоставьте угрозу и описание.",
        "pairs": [ { "id": "p1", "left": "Фишинг", "right": "Поддельное письмо" } ]
      },
      {
        "id": "demo-ranking", "type": "ranking", "prompt": "Расставьте шаги по порядку.",
        "options": [ { "id": "r1", "text": "Обнаружить" }, { "id": "r2", "text": "Сообщить" } ],
        "order": ["r1", "r2"]
      }
    ]
  },
  "runtime": {
    "result": {
      "scorePercent": 86, "passed": true, "status": "passed",
      "totalQuestions": 4, "correct": 3, "earnedPoints": "8.6",
      "passClass": "is-pass", "statusLabel": "Пройден", "ringDashoffset": "55.42",
      "topicResults": [
        { "topicId": "topic-1", "topicName": "Базовые угрозы",
          "percent": 75, "passed": true, "total": 4, "correct": 3,
          "passClass": "is-pass", "statusLabel": "Пройден" }
      ]
    },
    "sectionResult": { "scorePercent": 75, "status": "passed" }
  }
}
```

Соответствие маршрут → данные:

- `start`, `results` — берут `course.*` и `runtime.result` (итог всего теста);
- `content.summary` («Итог раздела») — берёт `runtime.sectionResult` (результат
  раздела) в `result.*`;
- `question.<type>` — ищут вопрос по `questionId` из маршрута, иначе первый
  вопрос подходящего типа;
- `content.<kind>` — берут страницу по `templateKey`/`route` из `contentPages`.

## 13. Валидация и проверка работоспособности

Активация шаблона возможна только после двух проверок (NFR-01).

### 13.1 Структурная валидация (сервер)

Выполняется при загрузке. Блокирующие ошибки (нельзя активировать):

| Код | Причина |
| --- | --- |
| `MANIFEST_MISSING` | Нет `manifest.json` в корне |
| `MANIFEST_INVALID_JSON` | Манифест не парсится |
| `MANIFEST_SCHEMA` | Нарушена схема (нет `id`/`name`/`version`/`contentTemplates` и т.д.) |
| `ID_PATTERN` | `id` не соответствует `^[a-z0-9-]+$` |
| `API_VERSION_UNSUPPORTED` | `templateApiVersion` не из поддерживаемых (`1.0`) |
| `ID_EXISTS` / `ID_MISMATCH` | Конфликт id при создании / несовпадение при обновлении |
| `REQUIRED_FIELD_MISSING` | Нет обязательного `layouts.{shell,question,content,results}`, `assets.preview`, `preview`, `params` или `capabilities` |
| `FILE_MISSING` | Файл, на который ссылается манифест, отсутствует |
| `SHELL_CONTRACT` | В оболочке нет `data-slot="page"` |
| `QUESTION_CONTRACT` | В макете вопроса нет `question-text` или `question-interaction` |
| `EXTERNAL_URL` | Внешняя ссылка/CDN в ресурсах, CSS, HTML или JS |
| `RULES_INVALID_JSON` / `DEMODATA_INVALID_JSON` | Невалидный JSON правил / демо-данных |
| `ZIP_TOO_LARGE` | Архив больше лимита (по умолчанию 20 МБ) |

Предупреждения (не блокируют): нет `data-slot="page-content"` в контенте, не
объявлен `layouts.start`, файлы, не используемые манифестом.

### 13.2 Проверка работоспособности (браузер)

Запускается из окна предпросмотра. Движок рендерит каждый экран из
`preview.routes` на демо-данных через общий рендерер. Экран помечается
проваленным при: исключении рендера, пустом результате, незаполненном
обязательном слоте, `console.error` во время рендера. `console.warn` даёт
неблокирующее предупреждение. Дополнительно проверяются `template.js`
(компиляция) и файл правил (`JSON.parse`).

## 14. Жизненный цикл в системе

Реестр шаблонов — страница `/author/templates` (роль «автор»):

1. **Загрузить шаблон** — выбрать ZIP. Идёт структурная валидация; при успехе
   создаётся черновик.
2. **Предпросмотр и проверка** — открыть карточку, осмотреть экраны слева,
   нажать «Проверить работоспособность». При успехе разблокируется активация.
3. **Активировать** — шаблон появляется у авторов во вкладке «Оформление».
4. **Деактивировать** — шаблон скрывается; зависимые тесты переключаются на
   «Стандартный» (совместимые параметры сохраняются).
5. **Обновить** — загрузить новую версию (id должен совпадать); требуется
   повторная проверка.
6. **Экспорт ZIP** — скачать любой шаблон (в т.ч. встроенный) как стартовую
   заготовку.
7. **Удалить** — только загруженный, неактивный и не используемый тестами.

## 15. Чек-лист перед загрузкой

- [ ] `manifest.json` в корне, валидный JSON.
- [ ] `id` в нижнем регистре (`^[a-z0-9-]+$`), `version` вида `1.0.0`,
  `templateApiVersion: "1.0"`.
- [ ] Объявлены `layouts.shell/question/content/results`; все referenced-файлы
  на месте.
- [ ] В `shell.html` есть `data-slot="page"`.
- [ ] В `question.html` есть `data-slot="question-text"` и
  `data-slot="question-interaction"`.
- [ ] `assets.preview` указывает на существующую миниатюру.
- [ ] `contentTemplates` содержит минимум один элемент.
- [ ] Нет внешних ссылок/CDN в CSS, HTML, JS и в путях манифеста.
- [ ] `preview.demoData` валиден и покрывает все `preview.routes`.
- [ ] DSL без `{{{ }}}` и выражений; все блоки закрыты.
- [ ] Архив меньше 20 МБ.

## 16. Типичные ошибки

| Симптом | Причина и решение |
| --- | --- |
| `SHELL_CONTRACT` | В оболочке забыт `data-slot="page"`. Добавьте контейнер страницы. |
| `QUESTION_CONTRACT` | В макете вопроса нет одного из обязательных слотов. Сверьтесь с разделом 4.2. |
| `EXTERNAL_URL` | Где-то осталась ссылка на CDN (шрифт, скрипт, картинка). Вендорьте ресурс в ZIP. |
| Экран «отрисован пустым» в проверке | Макет ничего не вывел или DSL-условие скрыло весь контент. Проверьте имена путей контекста. |
| «Ошибка отрисовки» в проверке | Невалидный DSL: незакрытый `{{#if}}`/`{{#each}}`, `{{{ }}}` или выражение с пробелом. |
| Не заполнен слот в проверке | Имя `data-slot` не совпадает с ожидаемым (`question-text`, `question-interaction`, `page-content`). |
| Цвета «не подхватываются» | Токен задан как `hsl(...)` вместо HSL-компонентов; используйте `--token: H S% L%` и `hsl(var(--token))`. |
| Превью недоступно | Нет `assets.preview` или файл отсутствует в архиве. |
