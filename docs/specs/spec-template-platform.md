# Техническая спецификация: платформа SCORM-шаблонов

**Статус:** контракт формата шаблонов — источник истины для внутренних и внешних SCORM-шаблонов.
Описывает действующее устройство: браузерный рендер `shell` и макетов, единый манифест, path-only
DSL, `resultField` с рендерерами `core.*`, подгонку текста `textFit`, структурную валидацию и
браузерную smoke-проверку, системные узлы раздела (`review`, `section-results`) и варианты
стартового экрана (`kind: "start"` со своим `layoutFile` и свойством страницы `image`).
За рамками формата — логика прохождения (задаётся сценарием теста, `flowPolicy`) и вычисляемые
результаты (шкалы и показатели, публикуются в контекст рендера): см. §13 и §14. Ещё не
действующие возможности вынесены в §3.  
**Версия:** 1.0.0 (см. [«История версий»](#история-версий))  
**Дата актуализации:** 2026-07-28  

## История версий

Версия документа отражает состояние КОНТРАКТА формата шаблонов и версионируется
семантически (`MAJOR.MINOR.PATCH`) — **отдельно** от `templateApiVersion` в манифесте
(это версия рантайм-API шаблона, сейчас `1.0`, §5). Правила бампа:

- **MAJOR** — несовместимое изменение формата: ранее валидные шаблоны требуют правок
  (удалено/переименовано поле манифеста, изменён контракт слота, убран тип поля).
- **MINOR** — обратно-совместимое расширение: новый тип экрана, поля, параметра или
  настройки; прежние шаблоны продолжают работать без изменений.
- **PATCH** — уточнения формулировок, примеры, исправления опечаток без изменения
  контракта.

| Версия | Дата | Изменения |
| --- | --- | --- |
| 1.0.0 | 2026-07-28 | Первая версионированная редакция. Зафиксировано текущее состояние контракта: манифест и обязательные поля (§5), path-only DSL (§9), `resultField` с рендерерами `core.*` и `textFit` (§8.2.1.x), разделение `placeholders[]` / `settings[]` (§8.2.1), системные узлы раздела `review` / `section-results` (§8.2), две палитры и `themes[]` (§6), варианты стартового экрана (`kind: "start"` со своим `layoutFile`) и параметр иллюстрации `startImageUrl` (§8.2). |

## 1. Назначение

Этот документ определяет общий технический контракт для внутренних и внешних SCORM-шаблонов.
Он является источником истины для формата шаблонов: прочие документы опираются на него, а не
переопределяют механику шаблонов независимо.

Платформа поддерживает:

- единую механику для встроенных и загружаемых шаблонов;
- исполнение шаблона только в браузере внутри сгенерированного SCORM-пакета;
- полную настройку макетов страниц, а не только цветов и шрифтов;
- контролируемую ответственность Core за оценку, состояние навигации, SCORM-состояние и стандартные интерактивы вопросов;
- расширение через `template.js` и Runtime API.

## 2. Базовые принципы

### 2.1 Исполнение только в браузере

Шаблоны исполняются только в браузере обучающегося внутри SCORM-пакета.

Сервер не выполняет HTML или JavaScript шаблона во время экспорта. Сервер только:

- валидирует ZIP загруженного шаблона;
- хранит метаданные шаблона;
- копирует выбранный шаблон в сгенерированный SCORM ZIP;
- добавляет в пакет данные теста и ресурсы Core runtime.

### 2.2 Единая механика внутренних и внешних шаблонов

Встроенные и внешние шаблоны используют одинаковые:

- структуру `manifest.json`;
- структуру ZIP/файлов;
- браузерный рендерер;
- контракт макетов;
- Runtime API;
- процесс валидации и smoke-проверки.

Физическое хранение может отличаться, но runtime-поведение одинаково.

### 2.3 Ответственность Core и шаблона

Core владеет:

- состоянием теста;
- состоянием навигации;
- состоянием ответов;
- оценкой;
- состоянием обратной связи;
- восстановлением сессии;
- интеграцией с SCORM API;
- telemetry;
- рендерерами стандартных интерактивов вопросов;
- финальными защитами для критичных действий.

Шаблон владеет:

- макетом оболочки;
- макетами страниц;
- визуальным представлением;
- опциональным клиентским поведением через `template.js`.

## 3. Перспективные изменения

Раздел собирает возможности, которые ещё не входят в действующий формат: пока шаблон на них
полагаться не может. При внедрении такая возможность переходит в основные разделы, а формат
получает новую версию (см. «История версий»).

### 3.1 Расширенные интерактивы вопросов

Переопределение механики стандартных интерактивов средствами `template.js`. Предполагаемая
регистрация рендерера:

```js
TestBuilder.template.registerInteractionRenderer("single", renderer);
TestBuilder.template.registerInteractionRenderer("multiple", renderer);
TestBuilder.template.registerInteractionRenderer("matching", renderer);
TestBuilder.template.registerInteractionRenderer("ranking", renderer);
```

Контракт рендерера:

```js
{
  render(ctx),
  mount(root, ctx),
  getAnswer(root),
  setAnswer(root, answer),
  clearAnswer(root),
  setLocked(root, locked),
  showCorrectState(root, ctx),
  destroy(root)
}
```

Форматы ответов совпадают с теми, что принимает Core:

```js
single: 2
multiple: [0, 3]
matching: { "0": 2, "1": 0 }
ranking: [2, 0, 1, 3]
```

### 3.2 Закрепление файловых версий шаблона

Выбранная версия шаблона (`templateVersion`) сохраняется для диагностики и миграций; хранение
каждой прежней файловой версии не требуется. Возможное развитие — закрепление теста за точной
файловой версией шаблона.

### 3.3 Система renderer-плагинов

Расширяемый реестр рендереров показателей результата помимо встроенных `core.*` (описан в
§8.2.1.3 как перспективный).

## 4. Структура ZIP шаблона

Рекомендуемая структура:

```text
template-id/
  manifest.json
  shell.html
  preview.png
  demo/
    course.json

  layouts/
    start.html
    question.html
    content.html
    results.html
    question-single.html
    system-locked.html

  partials/
    topic-nav.html
    progress.html
    header.html
    footer-actions.html

  styles/
    base.css
    theme.css

  scripts/
    template.js

  assets/
    fonts/
    images/
    icons/
```

`manifest.json` является источником истины. Дополнительные файлы разрешены, но все файлы,
на которые есть ссылки, должны существовать внутри ZIP.

Внешние URL запрещены. Все CSS, JS, шрифты, изображения, иконки и другие ресурсы должны быть
локальными файлами внутри SCORM ZIP.

Сгенерированный SCORM-пакет включает выбранный шаблон, а не полную библиотеку шаблонов. Кроме
него в пакет попадают резервные макеты и стили стандартного шаблона — но только для системных
экранов, которые выбранный шаблон не объявляет.

## 5. Манифест

### 5.1 Базовая структура

```json
{
  "id": "corporate",
  "name": "Corporate",
  "version": "1.0.0",
  "templateApiVersion": "1.0",
  "description": "",

  "layouts": {
    "shell": "shell.html",
    "question": "layouts/question.html",
    "content": "layouts/content.html",
    "results": "layouts/results.html",
    "start": "layouts/start.html",
    "review": "layouts/review.html",
    "section-results": "layouts/section-results.html",
    "system.blocked": "layouts/system-blocked.html"
  },

  "contentTemplates": [
    {
      "key": "intro.hero",
      "label": "Введение: крупный заголовок и изображение",
      "kind": "intro",
      "pageKind": "content.intro",
      "layoutFile": "layouts/content-intro.html",
      "placeholders": [
        {
          "key": "title",
          "type": "text",
          "label": "Заголовок",
          "required": true,
          "maxLength": 120,
          "textFit": {
            "mode": "autoFitFont",
            "defaultFontSize": 36,
            "minFontSize": 24,
            "maxFontSize": 36,
            "allowAuthorFontSize": false,
            "overflow": "warn"
          }
        },
        {
          "key": "subtitle",
          "type": "text",
          "label": "Подзаголовок",
          "required": false,
          "maxLength": 500,
          "textFit": {
            "mode": "fixed",
            "defaultFontSize": 20,
            "allowAuthorFontSize": true,
            "allowedFontSizes": [16, 18, 20, 22],
            "overflow": "warn"
          }
        },
        {
          "key": "heroImage",
          "type": "image",
          "label": "Изображение",
          "required": false
        }
      ]
    },
    {
      "key": "info.textWithImage",
      "label": "Информация: текст и изображение",
      "kind": "info",
      "pageKind": "content.info",
      "layoutFile": "layouts/content-info.html",
      "placeholders": [
        { "key": "title", "type": "text", "label": "Заголовок", "required": true },
        { "key": "lead", "type": "text", "label": "Вводный текст", "required": false },
        { "key": "body", "type": "richText", "label": "Основной текст", "required": true },
        { "key": "image", "type": "image", "label": "Изображение", "required": false }
      ]
    },
    {
      "key": "summary.progressRing",
      "label": "Итог: кольцевая диаграмма прогресса",
      "kind": "summary",
      "pageKind": "content.summary",
      "layoutFile": "layouts/content-summary.html",
      "placeholders": [
        { "key": "title", "type": "text", "label": "Заголовок", "required": true },
        {
          "key": "progressChart",
          "type": "resultField",
          "label": "Показатель прогресса",
          "required": true,
          "allowedPaths": [
            "progress.active.percent",
            "progress.question.percent",
            "progress.page.percent",
            "result.scorePercent",
            "sectionResult.percent"
          ],
          "defaultPath": "progress.active.percent",
          "allowedRenderers": ["core.ringChart", "core.progressBar", "core.textMetric"],
          "defaultRenderer": "core.ringChart"
        }
      ]
    }
  ],

  "rendererPlugins": [
    {
      "key": "core",
      "version": "1.0.0",
      "source": "core",
      "renderers": ["textMetric", "badge", "progressBar", "ringChart", "segmentedProgress"]
    }
  ],

  "systemPages": [
    {
      "id": "system.locked",
      "layout": "layouts/system-locked.html",
      "purpose": "blocking",
      "countInProgress": false,
      "allowNavBack": false
    }
  ],

  "partials": {
    "topicNav": "partials/topic-nav.html",
    "progress": "partials/progress.html",
    "header": "partials/header.html",
    "footerActions": "partials/footer-actions.html"
  },

  "assets": {
    "styles": ["styles/base.css", "styles/theme.css"],
    "scripts": ["scripts/template.js"],
    "fonts": ["assets/fonts/Inter.woff2"],
    "images": ["assets/images/logo.svg"],
    "preview": "preview.png"
  },

  "preview": {
    "demoData": "demo/course.json",
    "defaultRoute": "start",
    "routes": [
      "start",
      "content.intro",
      "content.info",
      "question.single",
      "question.multiple",
      "question.matching",
      "question.ranking",
      "content.summary",
      "results",
      "system.locked"
    ],
    "viewports": ["desktop", "mobile"]
  },

  "params": [
    {
      "key": "brand.primaryColor",
      "type": "color",
      "label": "Основной цвет",
      "default": "#0066cc",
      "group": "Бренд",
      "cssVar": "--tb-brand-primary",
      "validation": {
        "required": true
      }
    }
  ],

  "capabilities": {
    "navigation": ["linear", "free", "locked"],
    "sidebar": true,
    "progress": ["questions", "pages"],
    "timer": true,
    "contentPages": ["start", "intro", "info", "summary", "html"],
    "questionTypes": ["single", "multiple", "matching", "ranking"],
    "customInteractions": false,
    "runtimeApi": "1.0"
  }
}
```

### 5.2 Обязательные поля манифеста

Обязательные:

- `id`
- `name`
- `version`
- `templateApiVersion`
- `contentTemplates` (непустой массив, минимум один элемент — требует схема манифеста)
- `layouts.shell`
- `layouts.question`
- `layouts.content`
- `layouts.results`
- `assets`
- `assets.preview`
- `preview`
- `params`
- `capabilities`

Опциональные:

- `description`
- `layouts.start`
- детализированные макеты вопросов, например `question.single`
- детализированные макеты контентных страниц, например `content.info`
- `rendererPlugins`
- `partials`
- `systemPages`

### 5.3 Резервный выбор макетов

Core выбирает макет сначала по самому специфичному ключу, затем откатывается к общему ключу.

Примеры:

```text
question.single   -> question
question.multiple -> question
content.intro     -> content
content.info      -> content
content.summary   -> content
content.html      -> content
start             -> content
system.blocked    -> system page layout -> content
```

Обязательный минимум:

```json
{
  "layouts": {
    "shell": "shell.html",
    "question": "layouts/question.html",
    "content": "layouts/content.html",
    "results": "layouts/results.html"
  }
}
```

### 5.4 Системные страницы

Шаблоны могут объявлять системные страницы для неучебных экранов: блокировки, предупреждения,
промежуточные экраны, сертификаты или экраны после результата.

Поддерживаемые значения `purpose`:

```text
blocking
warning
interstitial
postResult
certificate
custom
```

Системные страницы не влияют на оценку. `countInProgress` и `allowNavBack` определяют поведение
прогресса и навигации.

> **Реализация.** Встроенный `default` объявляет системные экраны не массивом `systemPages[]`, а
> ключами в `layouts`: `system.blocked`, `system.transition` (адаптивный переход), а
> также узлы раздела `review`, `section-results`, `section-intro`. Полный массив
> `systemPages[]` с `purpose`/`countInProgress`/`allowNavBack` схемно не валидируется, хотя входит в контракт.

### 5.5 Контракт предпросмотра и демонстрационного набора данных

Предпросмотр является частью контракта шаблона, а не произвольной страницей шаблона. Он нужен для
галереи, проверки загружаемых ZIP и ручной оценки поведения шаблона до активации.

Шаблон обязан объявить:

- статический предпросмотр в `assets.preview`;
- живой предпросмотр в `preview`;
- демонстрационный набор данных в `preview.demoData`.

`assets.preview` - локальный путь внутри ZIP к `png`, `jpg`, `jpeg`, `webp` или `svg`. Файл
используется в галерее и списке шаблонов. Внешние URL запрещены.

`preview` описывает Core-owned live preview. Шаблон не должен полагаться на отдельный
`preview.html` как на контрактный entrypoint: такой файл может существовать как вспомогательный
стенд разработчика, но админский UI и smoke-проверка запускают шаблон через `shell.html`,
манифест, layouts, ресурсы и демонстрационный набор.

```ts
type TemplatePreviewContract = {
  demoData: string;
  defaultRoute?: PreviewRoute;
  routes?: PreviewTarget[];
  viewports?: Array<"desktop" | "tablet" | "mobile">;
};

type PreviewTarget =
  | PreviewRoute
  | {
      route: PreviewRoute;
      label?: string;
      pageId?: string;
      templateKey?: string;
    };

type PreviewRoute =
  | "start"
  | "content.intro"
  | "content.info"
  | "content.summary"
  | "content.html"
  | "question.single"
  | "question.multiple"
  | "question.matching"
  | "question.ranking"
  | "review"
  | "section-results"
  | "results"
  | `system.${string}`;
```

Требования к `preview`:

- `demoData` указывает на локальный JSON-файл внутри ZIP;
- `defaultRoute` определяет первый экран живого предпросмотра, по умолчанию `start`;
- `routes` перечисляет экраны, которые UI и smoke-проверка должны открыть; если поле не задано,
  Core строит список из обязательных возможностей манифеста;
- если в пакете несколько `contentTemplates[]` одного `pageKind`, `routes[]` должен различать их
  через `templateKey` или `pageId`;
- `viewports` задаёт контрольные размеры предпросмотра; если поле не задано, Core проверяет
  `desktop` и `mobile`;
- все маршруты должны соответствовать объявленным layouts, `contentTemplates`, `systemPages` и
  `capabilities`;
- live preview работает без SCORM API, LMS, сетевых запросов и внешних ресурсов.

Демонстрационный набор данных - это стабильный JSON, совместимый с публичным runtime context. Он
должен покрывать все маршруты из `preview.routes`, все заявленные типы вопросов, динамические
`resultField` placeholders, progress, результаты и системные страницы.

Минимальный формат:

```ts
type PreviewDemoDataset = {
  schemaVersion: "1.0";
  locale?: string;
  params?: Record<string, unknown>;
  course: {
    title: string;
    mode?: "standard" | "adaptive";
    navigation?: "linear" | "free" | "locked";
    topics: PreviewTopic[];
    contentPages: PreviewContentPage[];
    questions: PreviewQuestion[];
  };
  runtime: {
    route: PreviewRoute;
    progress: {
      active: PreviewProgress;
      question: PreviewProgress;
      page: PreviewProgress;
    };
    result: PreviewResult;
    sectionResult?: PreviewResult;
    state?: Record<string, unknown>;
  };
};

type PreviewTopic = {
  id: string;
  title: string;
  status?: "locked" | "available" | "completed";
};

type PreviewContentPage = {
  id: string;
  type: "start" | "intro" | "info" | "summary" | "html";
  route?: PreviewRoute;
  templateKey?: string;
  topicId?: string;
  values: Record<string, unknown>;
};

type PreviewQuestion = {
  id: string;
  topicId?: string;
  type: "single" | "multiple" | "matching" | "ranking";
  prompt: string;
  options?: Array<{ id: string; text: string; correct?: boolean }>;
  pairs?: Array<{ id: string; left: string; right: string }>;
  order?: string[];
  feedback?: {
    text?: string;
    correctAnswerPublic?: Record<string, unknown>;
  };
};

type PreviewProgress = {
  current: number;
  total: number;
  percent: number;
};

type PreviewResult = {
  score: number;
  maxScore: number;
  scorePercent: number;
  status: "notStarted" | "inProgress" | "passed" | "failed" | "partial";
};
```

Требования к значениям:

- `schemaVersion` обязателен; несовместимая версия блокирует активацию шаблона;
- `params` переопределяет значения по умолчанию из `manifest.params` только для preview;
- для каждого `manifest.contentTemplates[]` должна быть хотя бы одна демонстрационная
  `contentPages[]` с тем же `templateKey`;
- `contentPages[].values` должен соответствовать `placeholders[]` выбранного `templateKey`;
- значения `resultField` должны использовать только `allowedPaths`, `allowedRenderers` и
  валидные `rendererOptions`;
- `questions[]` должен содержать по одному примеру для каждого типа из `capabilities.questionTypes`;
- `progress.*.percent`, `result.scorePercent` и `sectionResult.scorePercent` должны находиться в
  диапазоне `0..100`;
- демонстрационные данные не должны содержать персональные данные реальных пользователей,
  production ID, токены, LMS-поля или сетевые URL;
- Core может использовать один и тот же demo dataset для авторского preview и smoke-проверки.

При запуске live preview Core:

1. загружает `manifest.json`;
2. валидирует `assets.preview`, `preview` и `preview.demoData`;
3. строит публичный runtime context из `PreviewDemoDataset`;
4. рендерит `defaultRoute` через обычный runtime pipeline;
5. даёт UI возможность переключать маршруты из `preview.routes`;
6. логирует diagnostics с route, viewport, renderer key и ошибкой, если rendering/fallback был
   задействован.

Ошибки контракта preview делятся так:

- отсутствующий `assets.preview`, `preview` или `preview.demoData` - блокирующая ошибка;
- невалидный JSON demo dataset - блокирующая ошибка;
- route, для которого нет layout/template/capability, - блокирующая ошибка;
- отсутствие покрытия необязательного route - предупреждение;
- fallback renderer в preview - предупреждение, если страница осталась работоспособной;
- необработанная ошибка runtime в preview - блокирующая ошибка.

## 6. Параметры шаблона

Шаблоны определяют параметры через расширенный `params[]` с dot-keys, группами, значениями по
умолчанию и валидацией.

Поддерживаемые типы:

```text
color
text
number
boolean
select
image
font
asset
```

Пример:

```json
{
  "key": "progress.mode",
  "type": "select",
  "label": "Прогресс",
  "options": ["questions", "pages", "hidden"],
  "default": "questions",
  "group": "Навигация"
}
```

### Семантика progress.mode

Параметр `progress.mode` управляет тем, что считается единицей прогресса в runtime.

| Режим | Единица прогресса | Знаменатель |
| --- | --- | --- |
| `questions` | Каждый вопрос, на который дан ответ | Общее число вопросов в тесте |
| `pages` | Каждый переход навигации (`Core.next()`) | Число navigable-экранов, фиксируется при загрузке |
| `hidden` | Не отображается | — |

**Правила подсчёта для `pages`:**

- Знаменатель фиксируется при инициализации flow и не меняется в процессе прохождения.
- Каждый вызов `Core.next()`, приводящий к переходу на новый экран, увеличивает числитель на 1.
- Страницы `start` и `results` включены в подсчёт — они являются частью навигационного flow.
- Каждый вопрос считается отдельной единицей, а не весь блок вопросов темы: это обеспечивает плавный
  рост прогресса без скачков.
- Страница `system.blocked` исключена: её показ не изменяет счётчик прогресса. Blocked-состояние
  не является частью нормального flow.
- В режиме `pages` `progress.active.*` совпадает с `progress.page.*`; в режиме `questions` —
  с `progress.question.*`.

Core передаёт параметры в контекст макета, а также генерирует CSS-переменные
(CSS custom properties) в браузере
для параметров с `cssVar`.

Пример:

```json
{
  "key": "brand.primaryColor",
  "type": "color",
  "default": "#0066cc",
  "cssVar": "--tb-brand-primary"
}
```

CSS, сгенерированный в браузере:

```html
<style id="tb-template-vars">
  :root {
    --tb-brand-primary: #0066cc;
  }
</style>
```

### 6.1 Темы шаблона

Шаблон может поставлять несколько палитр. Стилями это выражается блоками `theme.css`
(`:root`, `@media (prefers-color-scheme: dark)`, `:root[data-theme="dark"]`), но платформе
этого НЕ достаточно: палитры объявляются в манифесте.

```json
"themes": [
  { "id": "light", "label": "Светлая" },
  { "id": "dark",  "label": "Тёмная" }
]
```

| Поле | Обязательность | Смысл |
| --- | --- | --- |
| `themes` | нет | Палитры шаблона. Нет поля или меньше двух записей — платформа считает, что тем нет |
| `themes[].id` | да | Идентификатор из закрытого перечня платформы: `light`, `dark` |
| `themes[].label` | да | Подпись пункта переключателя и колонки в таблице цветов |

Перечень закрыт так же, как реестр типов полей (§8.2.1): идентификатор вне перечня — ошибка
шаблона, а не молча пропущенная запись. Проверка выполняется при загрузке И при активации; при загрузке дополнительно сверяется, что у каждой объявленной темы есть
хотя бы один свой токен в стилях.

Что делает Core:

- **Выбор вида теста.** Автор фиксирует палитру (`light`/`dark`) или отдаёт её системной
  настройке участника (`auto`). Значение хранится у теста, а не у шаблона.
- **Значение цвета на каждую палитру.** Цветовые параметры хранятся отдельно по темам;
  нецветовые — одним значением, они от палитры не зависят.
- **Постановка темы на сцену.** Закреплённая палитра ставится атрибутом `data-theme` на корень
  сцены: `<html>` в SCORM-пакете, shadow-host на веб-хосте. При `auto` атрибут НЕ ставится —
  иначе медиа-запрос шаблона не получит своей очереди.
- **Печать переопределений.** Правила той же структуры, что и в `theme.css`, добавляются ПОСЛЕ
  стилей шаблона: специфичность равна, побеждает порядок.

На веб-хосте условие обязано идти функциональной формой — `:host([data-theme="dark"])`,
`:host(:not([data-theme="light"]))`. Суффиксная форма `:host[data-theme="dark"]` невалидна, и
браузер отбрасывает правило целиком: тема молча перестаёт применяться. По той же причине при
переносе стилей шаблона в теневой корень условие переносится ВНУТРЬ скобок.

### 6.2 Миграция параметров при обновлении шаблона

Правило:

- тот же `key` и тот же `type` -> сохранить значение;
- старый ключ отсутствует -> игнорировать/удалить;
- новый ключ с `default` -> использовать `default`;
- новый ключ без `default` -> автор должен заполнить значение.

UI должен показывать отчёт:

```text
2 параметра сохранены, 1 параметр больше не используется, 1 новый параметр требует значения.
```

Будущее расширение: явные `paramMigrations` в манифесте для сложных enterprise-шаблонов.

## 7. Контракт оболочки

`shell.html` определяет внешний макет плеера.

Обязательные элементы оболочки:

```html
<div data-slot="page"></div>

<button data-nav="next"></button>
<button data-action="answer-submit"></button>
<button data-action="test-finish"></button>
```

> **Реализация.** Структурный валидатор и
> браузерная проверка работоспособности требуют от оболочки только
> `data-slot="page"` (код ошибки `SHELL_CONTRACT`). Маркеры `data-nav`/`data-action`
> привязываются Core, когда присутствуют, но **не являются** обязательными для
> прохождения валидации/проверки: встроенный `default` их в `shell.html` не
> объявляет, а действия Core навешивает делегированием по `[data-action]` поверх
> экранов, отрисованных `renderScreenInto`. Жёсткая проверка привязки `next/
> answer-submit/test-finish` относится к перспективным расширенным интерактивам (§3).

Опциональные элементы оболочки:

```html
<button data-nav="prev"></button>
<div data-slot="progress"></div>
<div data-slot="topic-nav"></div>
<div data-slot="feedback"></div>
<div data-slot="timer"></div>
<div data-slot="breadcrumb"></div>
```

Оболочка может предоставлять резервные кнопки действий. Макеты страниц также могут объявлять
локальные кнопки. Если для страницы существуют локальные действия, Core может скрыть или
отключить резервные кнопки оболочки на этой странице.

### 7.1 Монтирование оболочки (`mountShell`)

По умолчанию Core монтирует экраны в собственный базовый контейнер, а `shell.html` служит только
внешним каркасом. Флаг манифеста `"mountShell": true` включает ПРЯМОЕ монтирование оболочки: Core
подставляет `shell.html` целиком и рендерит каждый экран внутрь её `#app`
(`data-slot="page"`), заменяя базовый контейнер.

Флаг обязателен для шаблонов с ФИКС-СЦЕНОЙ — когда CSS шаблона привязан к структуре оболочки
(например `.tb-frame > .tb-stage > #app`, сцена фиксированного размера или на container-query
единицах `cqh`/`cqw`). Без `mountShell` такой шаблон рендерится вне своей сцены, и его оформление
не применяется. То же монтирование выполняет и веб-хост в предпросмотре: оба хоста читают
`mountShell` из манифеста, поэтому автор видит фикс-сцену одинаково в SCORM и в превью. Шаблон без
фикс-сцены (как встроенный `default`) флаг не объявляет.

Пример локального действия:

```html
<button data-nav="next" data-local-action="true">
  <span>{{ nav.nextLabel }}</span>
</button>
```

Core привязывает обработчики и обновляет состояние. Он не должен перезаписывать пользовательский
HTML кнопки, если кнопка не пустая.

Core управляет состоянием кнопок навигации/действий через:

- `hidden`
- `disabled`
- `aria-disabled`
- `data-state`
- `data-visible`
- классы состояния, например `is-hidden` и `is-disabled`

## 8. Контракт макетов страниц

### 8.1 Макеты вопросов

Обязательные слоты:

```html
<div data-slot="question-text"></div>
<div data-slot="question-interaction"></div>
```

> **Реализация.** Текст вопроса монтируется в
> `data-slot="question-text"` — это и есть имя слота, которое проверяет валидатор
> (код `QUESTION_CONTRACT`) и заполняет рендерер (`question-text` + `question-interaction`,
> см. `server/scorm/templates/default/layouts/question.html`). Имя `question-prompt`
> из ранних черновиков спецификации устарело; источник истины — `question-text`.

Опциональные слоты:

```html
<div data-slot="question-media"></div>
<div data-slot="question-feedback"></div>
<div data-slot="question-hint"></div>
<div data-slot="question-counter"></div>
<div data-slot="question-topic"></div>
<div data-slot="question-difficulty"></div>
```

Core вставляет:

- формулировку вопроса в `question-text`;
- стандартный рендерер интерактива в `question-interaction`;
- медиа в `question-media` и обратную связь в `question-feedback`, если эти слоты присутствуют.

> **Реализация.** Из опциональных слотов рантайм реально заполняет только `question-media` и
> `question-feedback`. Слоты `question-hint` / `question-counter` / `question-topic` /
> `question-difficulty` управляемыми НЕ являются: подсказка приходит внутри
> `question-interaction` (элемент с классом `question-hint`), а счётчик выводится через
> `data-path` (`state.questionCounterLabel`).

### 8.2 Макеты и шаблоны контентных страниц

Контентные страницы работают по модели PowerPoint slide layouts:

- **тип страницы** определяет смысл страницы в flow: `intro`, `info`, `summary`, `html`, `blocked`;
- **content template** в SCORM-шаблоне определяет скелет данных страницы: placeholders, их типы,
  обязательность, ограничения и layout;
- **экземпляр страницы в тесте** хранит значения placeholders, которые заполнил автор;
- **layout** отображает эти значения, но не является источником содержимого.

Это означает, что автор не заливает произвольную вёрстку в шаблонную страницу. Автор выбирает
подходящий скелет страницы и заполняет его структурированные поля. Свободный HTML остаётся отдельным
типом `content.html` для технических сценариев и не является основным способом создания страниц.

Поддерживаемые режимы определения страницы:

| Mode | Назначение | Когда использовать |
| --- | --- | --- |
| `template` | Страница создаётся по `manifest.contentTemplates[]`; автор заполняет placeholders | Основной режим для стандартизированных корпоративных страниц |
| `standard` | Страница использует каноническую схему Core для `intro/info/summary` и fallback layout | Для переносимых страниц, не завязанных на конкретный шаблон |
| `html` | Страница содержит санитизированный HTML и отображается через `content.html` | Только как escape hatch для технических авторов |

Поддерживаемые kinds контентных страниц:

Откуда экран берёт макет — зависит от его класса (см. классы ниже таблицы). Системные экраны
резолвятся по фиксированным ключам `layouts[]`; прочие контентные страницы — по `layoutFile`
варианта, иначе по общему `layouts["content"]`. Когда шаблон не объявляет нужный системный
экран, применяется fallback на стандартный шаблон с предупреждением в UI — колонка «Fallback» ниже.

> Отдельного вида страницы «галерея» больше нет: галерея — обычный вариант
> информационной страницы (`kind: "info"`) со своим `layoutFile`, и отдельного правила
> резолвинга для неё не существует. Индикатор навигации по подряд идущим страницам макет
> рисует из вычисленного контекста `page.*` (§10), а не из значений, введённых автором.
> Свойства страницы (подпись кнопки `nextLabel`, фон `backgroundImage`, идентификатор
> последовательности `sequenceId`) объявляются отдельным блоком `settings[]` варианта — по
> природе они не содержимое. Когда вариант, к которому привязана страница, в выбранном шаблоне
> отсутствует, страница рендерится вариантом по умолчанию своего `kind` (см. §8.2.2), а
> `templateKey` в базе не переписывается: замену подтверждает автор через диалог сопоставления.
> Оба поставляемых шаблона несут сетку из шести раскладок контентной страницы в двух семействах
> (обычная и галерейная) — двенадцать вариантов; их перечень — эталонный, но не нормативный.

Резолвинг макета делится на три класса (по фактическому рантайму
`server/scorm/template/app/render/`).

- **Системные экраны** (`results`, `question`, `review`, `section-results`,
  «Введение раздела», `system.blocked`) резолвятся по ФИКСИРОВАННОМУ ключу `layouts[<key>]`.
  Вариант в `contentTemplates[]` для них не задаёт макет — он нужен лишь для привязки страницы и
  для определения fallback (объявлен ли `kind`). В частности «Введение раздела» рендерится по
  ключу `layouts["section-intro"]`, а НЕ по `layoutFile` варианта `intro`; если этого ключа нет,
  экран падает в общий контентный рендер.
- **Стартовый экран** (`start`) резолвится по `layoutFile` ВЫБРАННОГО варианта старта, иначе по
  фиксированному `layouts["start"]`. Шаблон может объявить несколько `contentTemplates[]` с
  `kind: "start"`, каждый со своим `layoutFile` (напр. `start.image-right` — колонка-иллюстрация
  справа); базовый помечается `isDefault: true`. Автор выбирает раскладку через «Сменить вариант»
  на строке «Старт», и ОБА хоста рендерят выбранный макет (SCORM-рантайм
  `startPage.resolveStartLayout`, веб-хост `GET /screen-template/start`). Отсутствие выбранного
  варианта или его файла — fallback на `layouts["start"]` (и далее на стандартный шаблон). Контекст
  строит общий `buildStartState` независимо от раскладки; иллюстрацию несёт СВОЙСТВО СТРАНИЦЫ
  `image` того варианта, который его объявил (`settings[]`), — вариант без свойства иллюстрации
  не получает. Значение попадает в контекст как `design.startImageUrl` через общий
  `startImageForVariant`.
- **Прочие контентные страницы** (`info` / `summary` / `router` / `html`) резолвятся по
  `layoutFile` варианта, иначе по общему `layouts["content"]`. Галерея — частный случай `info`
  и отдельного правила не имеет.

| Page kind | Назначение | Откуда макет | Fallback на стандартный шаблон |
| --- | --- | --- | --- |
| `start` | Стартовый экран теста (лендинг) — тест-уровневый, всегда | `layoutFile` выбранного варианта старта, иначе `layouts["start"]` | Да |
| `question` | Экран вопроса | `layouts["question"]` | Да |
| `results` | «Итоги теста» — итоговый результат всего теста, тест-уровневый, всегда | `layouts["results"]` | Да |
| `review` | «Обзор раздела/теста» перед завершением — системный узел | `layouts["review"]` | Да |
| `section-results` | Вычисляемые «Итоги раздела» — системный узел | `layouts["section-results"]` | Да |
| `content.intro` | «Введение раздела» (`before_topic`) — по одной на тему | `layouts["section-intro"]`, иначе общий контентный рендер | Да |
| `system.blocked` | Системная страница блокировки | `systemPages[].layout` / `layouts["system.blocked"]` | Да (файловый) |
| `content.info` | Информационная/учебная страница; сюда же относится слайд галереи — вариант со своим `layoutFile` | `layoutFile` варианта, иначе `layouts["content"]` | Нет: недоступный вариант подменяется вариантом по умолчанию `kind`, замену подтверждает автор (§8.2.2) |
| `content.summary` | «Итог раздела» (`after_topic`) — по одной на тему; показывает результат РАЗДЕЛА | `layoutFile` варианта, иначе `layouts["content"]` | Нет: вариант по умолчанию `kind` (§8.2.2) |
| `content.router` | Меню тем (`router_by_topics`) | `layoutFile` варианта, иначе `layouts["content"]` | Нет: вариант по умолчанию `kind` (§8.2.2) |
| `content.html` | Санитизированный HTML-блок | `layouts["content"]` | Нет: общий контентный рендер |

Fallback на стандартный шаблон применяется только к экранам с ВЫДЕЛЕННЫМ макетом
(`start`, `results`, `question`, `intro`, `review`, `section-results`, `system.blocked`). Экраны,
которые рендерятся общим `layouts["content"]` (`info` / `summary` / `router` / `html`),
подменять нечем — их «резервом» служит сам общий контентный макет.

`start` и `results` — тест-уровневые системные экраны (по одному на тест, в любом режиме).
`review` и `section-results` — системные узлы раздела: «Обзор» перед завершением и
вычисляемые «Итоги раздела» после него; они рендерятся своими рантайм-фазами и исключены из
потока контентных страниц. `content.intro` — «Введение раздела» перед его вопросами (по одной
на тему, только в режимах по темам). `content.summary` — устаревшая per-topic закладка «Итог
раздела»: остаётся валидной для обратной совместимости, но её роль выполняет вычисляемый
`section-results`.

### 8.2.1 `contentTemplates[]`

`manifest.contentTemplates[]` объявляет скелеты страниц, доступные автору при выбранном шаблоне.
Один SCORM-шаблонный пакет может содержать несколько content templates. Это штатный механизм для
вариантов страниц: например несколько `content.info`, несколько `content.summary`, разные варианты
стартового экрана (`start`) или итогов теста (`results`). Стандартный (`default`) шаблон обязан
объявить хотя бы по одному варианту каждого системного `kind`: `start`, `results`, `router`,
`questions`, `intro`, `review`, `section-results` (он — системный fallback; `review` и `section-results` — узлы раздела; `summary` остаётся
валидным `kind` для обратной совместимости, но в обязательный набор уже не входит).

Множественность работает так:

- `contentTemplates[]` - массив, а не одиночный объект;
- `contentTemplates[].key` уникален внутри `manifest.contentTemplates[]`;
- каждый `contentTemplates[]` элемент обязан иметь человекочитаемое `label`;
- несколько templates могут иметь одинаковый `pageKind`, если у них разные `key`;
- несколько templates могут использовать один и тот же layout, если их placeholders совместимы с
  этим layout;
- авторский UI при добавлении страницы показывает все доступные templates текущего пакета и может
  группировать их по `pageKind`;
- авторский UI показывает автору `label`, а не технический `key`;
- `templateKey` экземпляра страницы всегда указывает на конкретный `contentTemplates[].key`, а не
  только на `pageKind` или layout.

Минимальная структура:

```json
{
  "key": "info.textWithImage",
  "label": "Информация: текст и изображение",
  "kind": "info",
  "pageKind": "content.info",
  "layoutFile": "layouts/content-info.html",
  "description": "Страница с заголовком, основным текстом и иллюстрацией",
  "placeholders": [
    {
      "key": "title",
      "type": "text",
      "label": "Заголовок",
      "required": true,
      "maxLength": 120,
      "textFit": {
        "mode": "fixed",
        "defaultFontSize": 32,
        "allowAuthorFontSize": false,
        "overflow": "error"
      }
    },
    {
      "key": "body",
      "type": "richText",
      "label": "Основной текст",
      "required": true,
      "textFit": {
        "mode": "autoFitFont",
        "defaultFontSize": 20,
        "minFontSize": 14,
        "maxFontSize": 20,
        "allowAuthorFontSize": false
      },
    },
    {
      "key": "image",
      "type": "image",
      "label": "Изображение",
      "required": false,
      "constraints": {
        "aspectRatio": "16:9"
      }
    }
  ]
}
```

> **Реализация.** Схема манифеста (`contentTemplateEntrySchema`) требует у элемента `key`,
> `label` и `kind` (виды из §8.2); `pageKind` и `placeholders[]` опциональны. Путь к
> макету указывается полем `layoutFile` — относительным путём к файлу, напр.
> `"layouts/content-info.html"`. Ключа `layout` в контракте нет. `layoutFile` читается рантаймом
> только для НЕсистемных контентных страниц (`info` / `summary` / `router` / `html`); системные
> экраны и «Введение раздела» резолвятся по фиксированным ключам `layouts[]` (см. таблицу выше).
> См. эталонный `server/scorm/templates/default/manifest.json`.

Типы placeholders — ЗАКРЫТЫЙ перечень. Placeholder описывает СОДЕРЖИМОЕ, вставляемое в макет:

```text
text
textarea
richText
html
image
resultField
```

> Перечень приведён к фактически поддерживаемому и объявлен однократно в общем коде
> (`shared/template/field-types.ts`): он питает и контрол редактирования, и правило отрисовки
> значения, а привязка «тип — контрол» задаётся полным отображением, поэтому пропуск контрола
> становится ошибкой сборки, а не молчаливой деградацией поля в однострочный ввод. Из прежнего
> списка `number`, `boolean` и `select` переезжают в `settings[]` (см. ниже) — по природе это
> настройки страницы, а не её содержимое; `video`, `file` и `actionLabel` не поддерживаются и
> из контракта исключены. Неизвестный тип — ошибка валидации (§17.1).

#### `settings[]` — свойства страницы

Кроме содержимого вариант может объявить СВОЙСТВА страницы — то, что управляет её поведением и
оформлением, но не вставляется в макет как контент. Раздел необязателен: его отсутствие означает,
что у страниц этого варианта настраиваемых свойств нет.

```json
{
  "key": "gallery.card",
  "label": "Галерея: карточка",
  "kind": "info",
  "layoutFile": "layouts/gallery.html",
  "placeholders": [
    { "key": "header", "type": "text", "label": "Заголовок" },
    { "key": "cardText", "type": "richText", "label": "Текст карточки" }
  ],
  "settings": [
    { "key": "sequenceId", "type": "sequence", "label": "Идентификатор последовательности" },
    { "key": "nextLabel", "type": "text", "label": "Подпись кнопки", "default": "Далее" },
    { "key": "backgroundImage", "type": "image", "label": "Фон страницы" }
  ]
}
```

Типы настроек — закрытый перечень: `number`, `boolean`, `select`, `text`, `image`, `sequence`.

Правила:

- настройка может объявлять значение по умолчанию (`default`) и обязательность (`required`);
  значение по умолчанию подставляется при создании страницы, а незаполненная обязательная
  настройка блокирует сохранение так же, как незаполненный обязательный placeholder;
- редактор структуры не имеет собственных полей: форма страницы состоит ИСКЛЮЧИТЕЛЬНО из
  объявленных `placeholders[]` и `settings[]`;
- `sequence` — идентификатор последовательности страниц. Подряд идущие страницы одного участка
  структуры с одинаковым непустым значением образуют последовательность; ядро само вычисляет
  число точек индикатора и текущую позицию и передаёт их макету через `page.*` (§10). Вариант,
  не объявивший `sequence`, поля не показывает и точек не получает;
- значения настроек хранятся отдельно от содержимого страницы и вместе с ним попадают в
  SCORM-пакет и в снапшот публикации;
- добавление раздела обратно совместимо: `templateApiVersion` не повышается.

Вариант может пометить себя `isDefault: true` — это делает его вариантом по умолчанию для своего
`kind` (см. §8.2.2). Если пометки нет ни на одном варианте `kind`, по умолчанию считается ПЕРВЫЙ
объявленный вариант этого `kind`.

### 8.2.2 Недоступный вариант: подмена вариантом по умолчанию

Автор привязывает страницу к варианту (`templateKey`). Сменив шаблон оформления теста, автор может
получить страницы, чей вариант новый шаблон не объявляет. Такая страница не ломается и не исчезает:
она рендерится ВАРИАНТОМ ПО УМОЛЧАНИЮ своего `kind` (см. выше). Правило едино для всех трёх мест,
где страница превращается в экран, — SCORM-рантайм, веб-хост и предпросмотр — и живёт в общем коде
(`shared/template/content-page.ts → resolveContentTemplate`).

Подмена — решение ОТРИСОВКИ, а не правки данных:

- `templateKey` в базе не переписывается. Поэтому привязка переживает возврат прежнего шаблона, а
  «Структура» продолжает помечать страницу как требующую сопоставления;
- окончательную замену подтверждает автор через диалог «Сменить вариант», который показывает
  теряемые при переходе значения. До подтверждения — только подмена при отрисовке;
- если шаблон не объявляет НИ ОДНОГО варианта нужного `kind`, подменять нечем — страница
  деградирует до простого контентного макета (заголовок и текст), как и раньше;
- список тестов помечает жёлтым знаком тест, в котором есть хотя бы одна страница с недоступным
  вариантом (число — в подсказке, по клику — переход в «Структуру»). Признак считается на сервере
  за один запрос на всю видимую страницу списка, а не по запросу на тест.

### 8.2.1.1 Политика размера текста

Для placeholders типов `text`, `textarea` и `richText` шаблон должен явно определить поведение
текста при переполнении блока. Модель следует логике PowerPoint text box:

> **Реализация.** Подгонку размера текста (`autoFitFont`, `growBox`, `overflow`) реально
> применяет только SCORM-рантайм (`applyTextFit` в `templateCore.js`, покрыто тестами).
> Веб-хост (единый рендерер `renderScreenInto`) `textFit` пока НЕ применяет — там это только
> метаданные плейсхолдера. Значение `allowAuthorFontSize`/ручной размер сохраняются на сервере
> независимо от хоста.

| `textFit.mode` | Поведение | Когда использовать |
| --- | --- | --- |
| `fixed` | Размер шрифта и размер блока фиксированы; переполнение диагностируется/обрезается согласно `overflow` | Для строгих брендовых слайдов |
| `autoFitFont` | Core уменьшает размер шрифта в пределах `minFontSize`/`maxFontSize`, чтобы текст поместился | Для заголовков и коротких блоков |
| `growBox` | Размер шрифта фиксирован, а блок увеличивается по вертикали под текст в рамках layout constraints | Для длинных информационных блоков |

Пример:

```json
{
  "key": "title",
  "type": "text",
  "label": "Заголовок",
  "required": true,
  "maxLength": 120,
  "textFit": {
    "mode": "autoFitFont",
    "defaultFontSize": 36,
    "minFontSize": 24,
    "maxFontSize": 36,
    "allowAuthorFontSize": false,
    "overflow": "warn"
  }
}
```

Поля `textFit`:

| Поле | Назначение |
| --- | --- |
| `mode` | `fixed`, `autoFitFont`, `growBox` |
| `defaultFontSize` | Размер шрифта по умолчанию из шаблона |
| `minFontSize` | Минимальный размер для `autoFitFont` |
| `maxFontSize` | Максимальный размер для `autoFitFont` и ручного ввода |
| `allowAuthorFontSize` | Разрешает автору вручную менять размер шрифта для этого placeholder |
| `allowedFontSizes` | Допустимые значения ручного размера, если нужен список вместо диапазона |
| `overflow` | `warn`, `clip`, `scroll`, `error` |
| `maxHeight` | Максимальная высота блока для `growBox`, если layout допускает ограничение |

Требования к `textFit`:

- если `allowAuthorFontSize = false`, UI не показывает управление размером шрифта для этого
  placeholder;
- если `allowAuthorFontSize = true`, UI ограничивает размер шрифта диапазоном
  `minFontSize`/`maxFontSize` или отдельным `allowedFontSizes`;
- ручной размер шрифта сохраняется как override конкретной страницы, а не как изменение layout
  шаблона;
- `autoFitFont` выполняется Core/runtime, а не произвольным кодом шаблона;
- при `fixed` и переполнении Core должен применить `overflow` и записать диагностику;
- при `growBox` Core может увеличивать вертикальный размер блока только в пределах ограничений
  layout, чтобы не ломать соседние элементы.

Ручной размер шрифта хранится отдельно от текстового значения:

```json
{
  "templateKey": "intro.hero",
  "values": {
    "title": "Перед началом раздела",
    "subtitle": "Короткое описание"
  },
  "placeholderStyles": {
    "subtitle": {
      "fontSize": 18
    }
  }
}
```

`placeholderStyles[placeholderKey].fontSize` валиден только если соответствующий placeholder имеет
`allowAuthorFontSize = true`. Для `richText` ручной размер применяется к контейнеру placeholder;
произвольные inline font-size внутри richText не поддерживаются.

Общие требования к `contentTemplates[]`:

- `contentTemplates[].key` уникален внутри `manifest.contentTemplates[]`;
- `contentTemplates[].label` обязателен, не пустой, человекочитаемый и пригоден для отображения в
  UI выбора страницы, preview и диагностике;
- `contentTemplates[].label` не должен быть техническим идентификатором, path или повторением
  `key`; если нужно пояснение, используется опциональный `description`;
- `placeholders[].key` уникален внутри конкретного `contentTemplate`;
- `placeholders[].label` обязателен для каждого поля, которое показывается автору в форме;
- `type`, `required`, `maxLength`, `options`, `constraints` используются UI для формы заполнения;
- для `text`/`textarea`/`richText` задана `textFit`-политика; если не задана, Core использует
  `fixed` и пишет предупреждение в валидации шаблона;
- `richText` хранится как структурированный документ или ограниченный HTML, прошедший санитизацию;
- `image/video/file` ссылаются на локальные assets, которые упаковываются в SCORM ZIP;
- layout не должен ожидать значения, не объявленные в `placeholders`.

#### Объём допустимого HTML в значениях автора

Разметку принимают только типы `richText` и `html`; значения прочих типов экранируются при
отрисовке. Санитизация СЕРВЕРНАЯ и выполняется дважды: при сохранении страницы (автор получает
список удалённого) и повторно при сборке SCORM-пакета; рендерер вставляет очищенное значение без
дополнительной обработки.

Модель — чёрный список. Удаляются: `<script>`, `<iframe>`, `<svg>`, `<object>`, `<embed>`,
`<link>`, `<meta>` (вместе с содержимым), все атрибуты-обработчики `on*`, `javascript:` в
`href`/`src` (значение заменяется на `#`) и `src`/`href` на внешний `http(s)://` (атрибут
удаляется целиком — пакет обязан быть автономным, поэтому ссылка на внешний сайт в тексте не
сохраняется). Остальная разметка проходит: форматирование, структура, таблицы, контейнеры,
атрибуты `class`/`id`/`style`, внутренние ссылки и изображения из `/uploads/`.

Ограничения, которые обязан учитывать шаблон: тег вне списка запрещённых пройдёт (включая
`<style>`, `<form>`, `<input>`), `data:`-URI не блокируются, разбор ведётся регулярными
выражениями без DOM. Поэтому макет и его CSS рассчитаны на чужую разметку: оформление изолируется классами
компонентов и не опирается на глобальные селекторы.

> Объём допустимого HTML не меняется — он равен
> описанному выше; дополнительные перечни разрешённых или запрещённых тегов не вводятся.
> Меняется ввод: у текстового поля появляется переключатель режимов (простой текст /
> форматированный текст / HTML), где ТИП поля задаёт потолок (`html` — все три режима,
> `richText` — первые два, `text`/`textarea` — только простой). В режиме форматированного
> текста работает единая для всех шаблонов панель (полужирный, курсив, зачёркнутый, списки,
> ссылка, очистка), а вставка из внешнего источника нормализуется; в режиме HTML запрещённая
> конструкция НЕ сохраняется — выдаётся ошибка со списком найденного. Объявления
> `allowedMarks` / `allowedBlocks` из контракта исключены. Ресурсы шаблона (изображения, стили)
> адресуются относительным путём (`images/logo.png`); базовый путь подставляет ядро на каждом
> хосте, внешние `http(s)`-ссылки остаются запрещёнными.

### 8.2.1.2 Динамические placeholders и визуализация показателей

Динамический контент страницы отображается через placeholder типа `resultField`. Шаблон объявляет,
какие runtime-пути и какие контролируемые renderers допустимы, а автор выбирает источник данных и
подпись. Шаблон не вычисляет результат и не получает произвольный JavaScript для диаграмм.

Пример декларации:

```json
{
  "key": "progressChart",
  "type": "resultField",
  "label": "Показатель прогресса",
  "required": true,
  "allowedPaths": [
    "progress.active.percent",
    "progress.question.percent",
    "progress.page.percent",
    "result.scorePercent",
    "sectionResult.percent"
  ],
  "defaultPath": "progress.active.percent",
  "allowedRenderers": ["ringChart", "progressBar", "segmentedProgress", "textMetric"],
  "defaultRenderer": "ringChart",
  "format": {
    "type": "percent",
    "decimals": 0
  }
}
```

Экземпляр страницы хранит выбор автора:

```json
{
  "templateKey": "summary.progressRing",
  "values": {
    "title": "Ваш прогресс",
    "progressChart": {
      "path": "progress.active.percent",
      "renderer": "ringChart",
      "label": "Пройдено"
    }
  }
}
```

Layout размещает только placeholder:

```html
<h1>{{ page.values.title }}</h1>
<div data-placeholder="progressChart"></div>
```

Core выполняет безопасный pipeline:

1. валидирует `path` по `allowedPaths`;
2. читает значение из публичного runtime context;
3. нормализует значение по `format`;
4. валидирует `renderer` по `allowedRenderers` и registry renderer plugins;
5. вызывает renderer через контролируемый runtime API;
6. вставляет результат в `data-placeholder`.

Стандартные runtime-пути:

| Path | Назначение |
| --- | --- |
| `progress.active.current` / `progress.active.total` / `progress.active.percent` | Активный прогресс согласно `progress.mode` |
| `progress.question.current` / `progress.question.total` / `progress.question.percent` | Прогресс только по вопросам |
| `progress.page.current` / `progress.page.total` / `progress.page.percent` | Прогресс по всем страницам flow |
| `result.scoreRaw` / `result.scoreMax` / `result.scorePercent` | Итоговый результат теста |
| `result.status` | Итоговый статус, например `passed`/`failed` |
| `sectionResult.scoreRaw` / `sectionResult.scoreMax` / `sectionResult.percent` | Результат текущего раздела для `content.summary` |
| `sectionResult.status` | Статус текущего раздела |
| `result.{name}` | Пользовательские показатели результата |
| `retake.availableDate` | Дата доступного повторного прохождения для `system.blocked` |
| `retake.effectiveToday` | Нормализованное «сегодня», от которого считаются производные величины; равно `todayDate`, если часы не пришлось нормализовать |

Стандартные renderers поставляются как plugin `core` и используются по полным ключам
`core.textMetric`, `core.ringChart` и т.д.

| Renderer | Назначение | Рекомендация UI/UX |
| --- | --- | --- |
| `core.textMetric` | Крупное число/значение с подписью | Для точного результата, статуса, даты |
| `core.badge` | Компактный статус | Для `passed`/`failed`, уровня, зоны риска |
| `core.progressBar` | Линейная полоса прогресса | Лучший default для процесса прохождения |
| `core.ringChart` | Кольцевая диаграмма одного процента | Для одного hero-показателя, не использовать пачками |
| `core.segmentedProgress` | Полоса из сегментов по количеству шагов/вопросов | Для небольшого числа вопросов или разделов |
| `core.questionTiles` | Строка/сетка кубиков: каждый кубик = вопрос | Для диагностического прогресса, когда `total <= 40`; при большем числе нужна агрегация |
| `core.sectionList` | Список разделов со статусами/процентами | Для тестов с явными разделами |
| `core.scaleBars` | Несколько горизонтальных шкал | Для компетенций и многошкальных результатов |

> **Реализация.** Реально зарегистрированы пять рендереров: `core.textMetric`, `core.badge`,
> `core.progressBar`, `core.ringChart`, `core.segmentedProgress` (`shared/template/renderers.ts`).
> `core.questionTiles`, `core.sectionList`, `core.scaleBars` в действующий набор не входят (перспективные, §3).
> Реестр устойчив к ошибкам: рендерер не из `allowedRenderers`, неизвестный или упавший
> откатывается к `core.textMetric`; `path` не из `allowedPaths` даёт пустое значение.

Рекомендации:

- для обычного текущего прогресса использовать `progressBar`;
- для стартовой/итоговой страницы с одним главным числом использовать `ringChart` + текстовый процент;
- для тестов до 40 вопросов можно использовать `questionTiles`; для больших тестов использовать
  `segmentedProgress` с группировкой или `progressBar`;
- цвет не должен быть единственным носителем смысла: renderer обязан выводить текст/label или
  доступный `aria-label`;
- thresholds цветов задаются шаблоном/rendererOptions, а не произвольной логикой автора;
- динамические renderers не влияют на результат, SCORM-статусы и навигацию.

### 8.2.1.3 Renderer plugins

Renderer plugin - расширение, которое добавляет один или несколько контролируемых renderers для
`resultField`. Он отвечает только за визуальное представление уже рассчитанных данных. Plugin не
может менять ответы, результат, SCORM-статусы, навигацию, `TEST_DATA` или runtime state.

> Полноценная система плагинов ниже относится к перспективным изменениям (§3) и пока не
> действует: доступны только встроенные `core.*` (см. §8.2.1.2). SCORM-рантайм содержит
> рудиментарный загрузчик `manifest.rendererPlugins` (инжект `<script>` по `plugin.path`/`src`)
> и хук регистрации `TestBuilder.renderers.register(id, fn)`, где рендерер — чистая функция
> `(value, options) => string`, а не `mount()`-инстанс из контракта ниже. Реестр/`source`
> (`core`/`template`/`registry`), проверка `version`, валидация `optionsSchema` и тип
> `RendererRegistry`/`DynamicRenderer` НЕ реализованы. Веб-хост (единый рендерер) загрузки
> плагинов не имеет вовсе — там доступны только пять `core.*`. Эталон объявляет
> `"rendererPlugins": []`.

Источники renderer plugins:

| Source | Назначение |
| --- | --- |
| `core` | Встроенные renderers платформы, доступны всегда |
| `template` | Renderer plugin, поставляемый внутри конкретного SCORM-шаблона |
| `registry` | Администрируемый plugin из общего registry, копируется в SCORM ZIP при экспорте |

Манифест шаблона или экспортированного пакета объявляет используемые plugins:

```json
{
  "rendererPlugins": [
    {
      "key": "core",
      "version": "1.0.0",
      "source": "core",
      "renderers": ["textMetric", "badge", "progressBar", "ringChart"]
    },
    {
      "key": "rtk.progress",
      "version": "1.2.0",
      "source": "template",
      "entry": "renderers/progress/index.js",
      "styles": ["renderers/progress/style.css"],
      "renderers": [
        {
          "key": "questionTiles",
          "label": "Кубики вопросов",
          "valueTypes": ["progress"],
          "optionsSchema": {
            "type": "object",
            "properties": {
              "maxTiles": { "type": "number", "default": 40 },
              "shape": { "type": "string", "enum": ["square", "rounded"] }
            }
          }
        }
      ]
    }
  ]
}
```

Полный ключ renderer строится как `{pluginKey}.{rendererKey}`. Например:

```json
{
  "allowedRenderers": ["core.progressBar", "core.ringChart", "rtk.progress.questionTiles"],
  "defaultRenderer": "core.progressBar"
}
```

Runtime API plugin:

```ts
type DynamicRendererPlugin = {
  key: string;
  version: string;
  register(registry: RendererRegistry): void;
};

type RendererRegistry = {
  register(renderer: DynamicRenderer): void;
};

type DynamicRenderer = {
  key: string;
  label: string;
  valueTypes: Array<"number" | "percent" | "string" | "boolean" | "date" | "progress" | "list">;
  optionsSchema?: JsonSchema;
  mount(root: HTMLElement, input: RendererInput): RendererInstance | void;
};

type RendererInput = {
  value: unknown;
  rawValue: unknown;
  path: string;
  label?: string;
  format?: Record<string, unknown>;
  options?: Record<string, unknown>;
  context: PublicRuntimeContext;
  theme: RuntimeTheme;
};

type RendererInstance = {
  update?(input: RendererInput): void;
  destroy?(): void;
};
```

Ограничения безопасности и совместимости:

- renderer plugin загружается только из SCORM ZIP, внешние URL запрещены без отдельной политики;
- `eval`, `Function`, inline script injection и запись в глобальные объекты Core запрещены;
- plugin не имеет доступа к SCORM API напрямую;
- plugin получает только публичный runtime context и не должен читать приватные данные;
- plugin обязан обрабатывать пустое/`null` значение и показывать fallback;
- ошибка plugin не должна ломать страницу: Core заменяет renderer на fallback `core.textMetric` или
  показывает диагностику placeholder;
- `options` автора валидируются по `optionsSchema` до сохранения и перед runtime;
- renderer обязан поддерживать доступность: текстовая подпись, `aria-label`, отсутствие зависимости
  только от цвета;
- если plugin не найден или версия несовместима, страница остаётся открываемой с fallback renderer и
  диагностикой.

UI автора для `resultField` должен:

1. показать только renderers, перечисленные в `allowedRenderers` и доступные в registry;
2. после выбора renderer построить форму `rendererOptions` по `optionsSchema`;
3. показывать preview на демонстрационных данных;
4. сохранять выбор в значении placeholder:

```json
{
  "path": "progress.question.percent",
  "renderer": "rtk.progress.questionTiles",
  "label": "Вопросы",
  "rendererOptions": {
    "maxTiles": 30,
    "shape": "square"
  }
}
```

### 8.2.2 Как автор определяет страницу

Основной сценарий:

1. Автор нажимает **"Добавить страницу"**.
2. Выбирает место в flow.
3. Выбирает режим:
   - **по шаблону** (`template`);
   - **стандартная страница** (`standard`);
   - **HTML-страница** (`html`).
4. Для режима `template` выбирает один из `manifest.contentTemplates[]` текущего SCORM-шаблона.
5. UI строит форму по `placeholders[]`.
6. Автор заполняет значения placeholders.
7. Предпросмотр показывает страницу через layout выбранного шаблона.
8. При сохранении в тест записываются `templateKey`, `pageKind`, `values`, позиция и служебные
   настройки.

Пример экземпляра страницы:

```json
{
  "id": "page-1",
  "mode": "template",
  "templateKey": "info.textWithImage",
  "pageKind": "content.info",
  "topicId": "topic-1",
  "position": "before_topic",
  "values": {
    "title": "Перед началом раздела",
    "body": {
      "format": "richText",
      "document": {}
    },
    "image": {
      "assetId": "asset-123",
      "src": "assets/content/page-1.png"
    }
  },
  "autoAdvance": false
}
```

Runtime page получает значения в `page.values`:

```json
{
  "id": "page-1",
  "kind": "content.info",
  "layoutKey": "content.info",
  "templateKey": "info.textWithImage",
  "values": {
    "title": "Перед началом раздела",
    "body": {},
    "image": {
      "src": "assets/content/page-1.png"
    }
  }
}
```

Layout использует значения как обычные path-only переменные:

```html
<h1>{{ page.values.title }}</h1>
<div data-placeholder="body"></div>
<img data-placeholder="image">
```

Core заполняет `data-placeholder` согласно типу placeholder. Для `richText` Core вставляет только
санитизированный результат. Для `image` Core выставляет локальный `src` и alt-текст.

**Поведение необязательных placeholders (required: false):**

- Если placeholder не заполнен автором, Core **не вставляет содержимое** в соответствующий
  `data-placeholder` и при необходимости скрывает обёртку через атрибут `data-placeholder-hide`
  (шаблон обязан поддерживать этот атрибут для всех `required: false` блоков).
- Шаблон не должен рассчитывать на наличие значения в необязательном placeholder — верстка должна
  корректно отображаться при пустом блоке без видимых артефактов (пустые рамки, зазоры).
- Валидация и сохранение формы блокируются только при незаполненных **обязательных** полях
  (`required: true`). Незаполненные необязательные поля не блокируют сохранение.
- UI формы редактирования страницы показывает под необязательными полями hint:
  "Необязательно — если не заполнено, блок не отображается."

### 8.2.3 Совместимость при смене шаблона

Если страница создана в режиме `standard`, смена шаблона сохраняет содержимое и меняет только
отображение.

Если страница создана в режиме `template`, она привязана к `templateKey` и схеме placeholders.
При смене шаблона Core должен:

1. найти в новом шаблоне `contentTemplates[].key` с тем же `templateKey`;
2. если найден, применить новый layout к сохранённым values;
3. если не найден, показать автору состояние **"требуется сопоставление шаблона страницы"**;
4. позволить выбрать новый `contentTemplate` и вручную сопоставить совместимые placeholders;
5. не удалять старые values автоматически.

### 8.2.4 Стандартные и HTML-страницы

Режим `standard` использует канонические placeholders Core для переносимых страниц:

```text
title
subtitle
media
body
primaryActionLabel
summaryFields
```

Режим `html` предназначен только для технических сценариев. HTML проходит санитизацию и
отображается через `content.html` или `layouts.content`. Использование `html` должно быть явно
видно в UI, потому что такая страница слабее стандартизирована, чем `template`/`standard`.

`content.intro` и `content.summary` — симметричные «закладки» раздела: `content.intro`
рендерится перед вопросами раздела (`before_topic`), `content.summary` — после расчёта результата
раздела (`after_topic`). Для `content.summary` Core дополнительно добавляет в публичный контекст
готовый результат темы/раздела (`result.*` = результат РАЗДЕЛА, не всего теста — итог теста
показывает макет `results`, §8.3). Шаблон может показать эти значения через placeholders типа
`resultField`, но не рассчитывает их самостоятельно.

### 8.3 Макеты результатов

Макеты результатов могут использовать экранированные переменные и опциональные контролируемые
слоты.

Опциональные слоты:

```html
<div data-slot="results-summary"></div>
<div data-slot="result-variables"></div>
```

Пользовательские показатели результата остаются отдельной продуктовой функцией, но после
вычисления публикуют значения в пространстве имён `result.*`.

## 9. DSL браузерного рендерера шаблонов

Браузерный рендерер поддерживает минимальный path-only DSL.

Поддерживается:

```html
{{ path }}

{{#if path}}
  ...
{{/if}}

{{#unless path}}
  ...
{{/unless}}

{{#each path}}
  ...
{{/each}}

{{> partialName }}
```

Не поддерживается:

- JavaScript;
- helper-функции;
- выражения внутри `if`;
- сырая HTML-интерполяция;
- `{{{ path }}}`.

Весь вывод `{{ path }}` экранируется как текст.

HTML/rich content может вставляться только через контролируемые placeholders/слоты, например:

```html
data-placeholder="body"
data-slot="content-body"
data-slot="question-text"
data-slot="question-interaction"
data-slot="question-feedback"
```

Для контентных страниц предпочтителен `data-placeholder`, потому что он связан со схемой
`contentTemplates[].placeholders[]`. `data-slot="content-body"` остаётся допустимым fallback для
режима `html` и старых общих content layouts.

### 9.1 Контекст `each`

Внутри `each` текущий элемент становится текущим контекстом:

```html
{{#each sections}}
  <button>{{ title }}</button>
{{/each}}
```

Корневой контекст доступен как:

```html
{{ @root.test.title }}
```

Мета-переменные цикла:

```text
@index   индекс с нуля
@number  индекс с единицы
@first   boolean
@last    boolean
```

### 9.2 Частичные шаблоны

Частичные шаблоны объявляются в `manifest.partials`:

```json
{
  "partials": {
    "topicNav": "partials/topic-nav.html",
    "progress": "partials/progress.html"
  }
}
```

Использование:

```html
{{> topicNav }}
```

Частичные шаблоны получают тот же публичный контекст, что и текущий макет.

Если частичный шаблон `topicNav` отсутствует, Core может использовать стандартный рендерер навигации по
темам как резервный вариант.

## 10. Публичный контекст рендера

Все макеты получают общий публичный контекст.

> Типизированный контракт контекста рендера — `PublicRenderContext` с неймспейсами `course`, `state`, `result`, `retake`,
> `transition`, `design`, `review`, `sectionResult`, `sectionIntro`. Именно против него
> резолвятся `{{ path }}` и `data-path` в макетах (`data-path="course.title"`,
> `{{ result.scorePercent }}`, `{{#if state.canResume}}`). Перечень полей каждого неймспейса — в
> §7 и в разделах ниже. Пути `progress.*` доступны
> `resultField`-плейсхолдерам только в SCORM-рантайме (резолв против внутреннего `TEST_DATA`);
> на веб-хосте `resultField` резолвится против `PublicRenderContext`, где `progress.*` как
> топ-уровневого пути нет (есть `result.*` и `sectionResult.*`).
>
> Контентная страница дополнительно получает неймспейс `page.*`, вычисленный ядром
> из структуры теста:
> `page.dots` — точки индикатора последовательности (по одной на страницу отрезка, у текущей
> выставлен признак активной), `page.dotIndex` и `page.dotsTotal` — позиция и размер отрезка,
> `page.canGoBack` — доступен ли возврат на предыдущий экран в текущем режиме прохождения,
> `page.nextLabel` — подпись кнопки «вперёд» (настройка `nextLabel` страницы, по умолчанию
> «Далее»). Страница вне последовательности получает пустой набор точек, поэтому макет с
> индикатором деградирует до простой страницы. Рисовать индикатор и кнопку возврата — решение
> МАКЕТА; данные ядро отдаёт всегда. `page.dots/dotIndex/dotsTotal/canGoBack` автор не вводит;
> `page.nextLabel` он задаёт настройкой варианта. Все три хоста (SCORM-пакет, веб-хост,
> предпросмотр) читают `page.*` из одного общего ядра (`shared/template/page-sequences.ts`), так
> что считают одинаково.

Пример ранней (нереализованной) формы контекста:

```json
{
  "test": {
    "id": "test-1",
    "title": "Сертификация",
    "description": "",
    "navigationPolicy": "linear"
  },
  "page": {
    "id": "q-1",
    "type": "question",
    "kind": "question.single",
    "title": "Вопрос 1",
    "question": {
      "id": "q-1",
      "type": "single",
      "media": null
    },
    "answerState": {
      "hasAnswer": false,
      "locked": false,
      "feedbackVisible": false
    },
    "feedback": null
  },
  "sections": [
    {
      "id": "topic-1",
      "title": "Тема 1",
      "isActive": true,
      "isPassed": false,
      "className": "is-active"
    }
  ],
  "progress": {
    "active": {
      "current": 3,
      "total": 20,
      "percent": 15
    },
    "question": {
      "current": 3,
      "total": 20,
      "percent": 15
    },
    "page": {
      "current": 6,
      "total": 28,
      "percent": 21
    }
  },
  "nav": {
    "mode": "linear",
    "canPrev": true,
    "canNext": false,
    "canSubmitAnswer": true,
    "canFinish": false,
    "nextLabel": "Далее",
    "submitAnswerLabel": "Принять ответ",
    "finishLabel": "Завершить тест",
    "nextClassName": "is-disabled"
  },
  "params": {
    "brand.primaryColor": "#0066cc",
    "progress.mode": "questions"
  },
  "assets": {},
  "runtime": {
    "templateApiVersion": "1.0"
  }
}
```

Core подготавливает готовые классы состояния (например `passClass`, `statusLabel`); DSL шаблона
классы через выражения не вычисляет.

### 10.1 Обратная связь и правильные ответы

Core раскрывает данные правильных ответов в публичном контексте только тогда, когда текущее
состояние Core и настройки теста это разрешают.

До обратной связи:

```json
{
  "answerState": {
    "hasAnswer": false,
    "locked": false,
    "feedbackVisible": false
  },
  "feedback": null
}
```

После отправки ответа, если правильные ответы можно показывать:

```json
{
  "answerState": {
    "locked": true,
    "feedbackVisible": true,
    "scoreRatio": 0.5,
    "status": "partial"
  },
  "feedback": {
    "text": "Частично правильно",
    "correctAnswerPublic": {}
  }
}
```

Шаблоны не получают поддерживаемого прямого доступа к внутреннему `TEST_DATA`.

## 11. Навигация

Поддерживаемые режимы навигации:

```text
linear
free
locked
```

Шаблон объявляет поддерживаемые режимы в `manifest.capabilities.navigation`.

Бизнес-политикой навигации владеет тест. Возможности шаблона только ограничивают доступные
режимы.

Эффективный режим навигации:

```text
effective mode = test navigationPolicy, ограниченная возможностями шаблона
```

Параметры шаблона могут управлять представлением навигации, но не должны ослаблять политику
теста.

Пример:

```json
{
  "test": {
    "navigationPolicy": "linear"
  },
  "params": {
    "navigation.presentation": "sidebar"
  }
}
```

## 12. Runtime API для `template.js`

`template.js` опционален и исполняется в браузере обучающегося.

Реализованный API:

```js
TestBuilder.template.on(event, handler);   // события жизненного цикла
TestBuilder.template.emit(event, data);
TestBuilder.context.get();                 // { params } — эффективные значения параметров
TestBuilder.scorm.commit();                // фиксация SCORM-состояния
TestBuilder.ui.toast(message);             // заглушки: только console.warn
TestBuilder.ui.modal(options);
TestBuilder.renderers.register(id, fn);    // рендерер для resultField
TestBuilder.renderers.render(field, context, allowed);
```

Реально эмитируется одно событие — `page:enter` (на контентных страницах).

Вне охвата (логика теста задаётся сценарием, см. §14): `vars.*` (переменные времени
прохождения), `nav.*` (программная навигация), `timer.*`, `ui.setState`, а также
`scorm.setSuspendData` / `scorm.addInteraction`.

Прямой доступ к `window.API_1484_11` не входит в поддерживаемый контракт. Поддерживаемые
SCORM-операции идут через `TestBuilder.scorm`.

## 13. Переменные времени прохождения — вне формата

Изменяемые переменные времени прохождения и их сохранение в `suspend_data` в формат шаблона не
входят. Тест не оперирует произвольным мутабельным состоянием: логика прохождения задаётся
декларативным сценарием (`flowPolicy`, см. §14), а вычисляемые результаты — это шкалы (`scale.*`)
и показатели (`result.*`), которые Core публикует сам после расчёта результата. Шаблону в контексте
рендера доступно пространство `result.*` с показателями (§10); собственного мутабельного состояния
у шаблона нет.

## 14. Логика прохождения — вне формата

Логика прохождения теста задаётся декларативным сценарием, а не шаблоном и не универсальным
движком правил. Ветвление и завершение выражаются структурными настройками сценария — `flowPolicy`
(`flowMode`, `completionPolicy`, `sectionUnlockRules`, `passDecisionPolicy`), а условия по
результату — показателями и адаптивными уровнями. Шаблон на эту логику не влияет: он отрисовывает
экраны, которые ему передаёт Core.

## 15. Реестр шаблонов

Для встроенных и загруженных шаблонов используется один API реестра.

Концептуальные записи:

```json
{
  "id": "corporate",
  "sourceType": "builtin",
  "sourcePath": "server/scorm/templates/corporate"
}
```

```json
{
  "id": "rtk-custom",
  "sourceType": "uploaded",
  "sourcePath": "uploads/templates/rtk-custom"
}
```

Core использует:

```text
TemplateRegistry.getTemplate(id)
```

и получает одну и ту же нормализованную файловую структуру независимо от физического источника.

## 16. Настройки дизайна теста

Рекомендуемая форма хранения:

```json
{
  "templateId": "corporate",
  "templateVersion": "1.2.0",
  "templateApiVersion": "1.0",
  "params": {
    "brand.primaryColor": "#0066cc",
    "progress.mode": "questions"
  }
}
```

Строгое закрепление файловой версии не требуется. Сохранённые версии используются для
диагностики, проверки совместимости и сообщений о миграции параметров.

## 17. Валидация

### 17.1 Структурная валидация

Блокирующие ошибки:

Блокируют только нарушения целостности пакета и безопасности — то, при чём шаблон нечитаем или
небезопасен и подставить вместо него нечего:

- невалидный ZIP;
- отсутствующий или невалидный `manifest.json`;
- отсутствующие обязательные поля манифеста;
- неподдерживаемый `templateApiVersion`;
- отсутствующие файлы, на которые ссылается манифест;
- отсутствующий или невалидный `assets.preview`;
- отсутствующий или невалидный `preview`;
- отсутствующий, невалидный или несовместимый `preview.demoData`;
- внешние URL в ресурсах/макетах/скриптах/стилях, на которые ссылается манифест;
- невалидный DSL в макете (незакрытый блок, `{{{ }}}`, выражение) — код `LAYOUT_TEMPLATE_SYNTAX`;
- невалидные `contentTemplates[]`: отсутствует `key`, `label` или `kind` (по схеме манифеста);
- неизвестный тип поля в `placeholders[]` или `settings[]`, а также несовместимые атрибуты типа
  (например `select` без списка вариантов);
- невалидные возможности (`capabilities`).

Предупреждения:

- неиспользуемые параметры;
- неиспользуемые ресурсы;
- отсутствующий макет — экран рендерится из стандартного шаблона (§8.2);
- отсутствующий слот, включая слоты вопросов и `page-content`;
- отсутствующие хуки/действия `shell.html`;
- route в `preview.routes`, для которого нет layout/template/capability;
- предупреждения консоли в браузерной smoke-проверке;
- fallback renderer в live preview, если страница осталась работоспособной;
- отсутствующее покрытие необязательного route в demo dataset;
- возможность объявлена, но опциональный partial отсутствует там, где существует резервный рендерер Core.

> **Реализация.** Фактические блокирующие коды структурного валидатора
> (`server/services/template-validation.ts`): `ZIP_TOO_LARGE`, `MANIFEST_MISSING`,
> `MANIFEST_INVALID_JSON`, `MANIFEST_SCHEMA`, `ID_PATTERN`, `API_VERSION_UNSUPPORTED`,
> `ID_EXISTS`, `ID_MISMATCH`, `REQUIRED_FIELD_MISSING` (только `assets.preview` / `preview` /
> `params` / `capabilities`), `FILE_MISSING`, `LAYOUT_TEMPLATE_SYNTAX`, `EXTERNAL_URL`,
> `DEMODATA_INVALID_JSON`.
> Предупреждения: `SHELL_CONTRACT`, `QUESTION_CONTRACT`, `CONTENT_CONTRACT` (нет
> `data-slot="page-content"`), `OPTIONAL_LAYOUT_MISSING` (не объявлен макет экрана),
> `UNUSED_FILE`. Определения `params` и объявления `systemPages` схемно НЕ валидируются
> (проходят через `passthrough`); их наличие в списках выше — часть контракта.
>
> Проверка типов полей выполняется при ЗАГРУЗКЕ и
> при АКТИВАЦИИ шаблона: невалидный шаблон не принимается и не активируется, сообщение содержит
> ключ варианта и ключ поля. Ранее установленные шаблоны продолжают работать, но помечаются
> невалидными с указанием причины, а страница с полем неизвестного типа показывает в редакторе
> явную диагностику вместо подмены контрола.

### 17.2 Валидация макетов

Слоты, которые проверяет структурный валидатор (согласовано с §7 и §8.1). **Ни один из них не
блокирует активацию**: их отсутствие даёт предупреждение и fallback экрана на стандартный шаблон
(§17.1). Объявлять их всё равно следует — иначе шаблон отдаёт свой экран
стандартному и теряет оформление.

Оболочка `shell.html` — область страницы (иначе `SHELL_CONTRACT`):

```html
<div data-slot="page"></div>
```

Макет вопроса — два слота (иначе `QUESTION_CONTRACT`):

```html
<div data-slot="question-text"></div>
<div data-slot="question-interaction"></div>
```

Контентная страница — слот `page-content` (иначе `CONTENT_CONTRACT`):

```html
<div data-slot="page-content"></div>
```

Кнопки `data-nav="next"` / `data-action="answer-submit"` / `data-action="test-finish"`
валидатор в оболочке **не требует** (Core привязывает их делегированием, когда они есть) —
это относится к перспективным расширенным интерактивам (§3). Дополнительно валидатор компилирует
каждый макет: невалидный DSL (незакрытый блок, `{{{ }}}`, выражение) даёт блокирующую
ошибку `LAYOUT_TEMPLATE_SYNTAX` — это единственная блокирующая проверка макета.

### 17.3 Браузерная smoke-проверка

После структурной валидации запускается браузерная smoke-проверка на `preview.demoData`. Набор
маршрутов берётся из `preview.routes` или строится Core из возможностей манифеста и должен
покрывать:

```text
стартовая страница
content.intro
content.info
question.single
question.multiple
question.matching
question.ranking
content.summary
results
system.locked, если объявлен
topicNav, если объявлен
progress.active
кнопки навигации/действий
загрузка template.js
```

Критерии успешного прохождения:

```text
нет необработанных ошибок
next/answer-submit/test-finish привязаны
ответы сохранены в состояние Core
страница результатов открывается
```

Незаполненный слот критерием прохождения не является: он даёт предупреждение и fallback экрана
на стандартный шаблон (§17.1).

> **Реализация.** Фактическая smoke-проверка рендерит каждый маршрут из `preview.routes` на
> демо-данных общим рендерером и помечает экран проваленным при исключении рендера, пустом
> результате или `console.error` (`console.warn` — предупреждение). Отсутствующий слот и
> необъявленный макет дают предупреждение: если хосту передан вход `fallbackLayouts`, экран
> рендерится из стандартного шаблона. Дополнительно компилируется `template.js`. Привязка
> `next/answer-submit/test-finish` критерием прохождения не является (относится к перспективным
> расширенным интерактивам, §3).

Загрузка/обновление шаблона также должны предоставлять:

- статический предпросмотр из `assets.preview`;
- живой предпросмотр на `preview.demoData` в админском UI.

Авторский UI может показывать статический предпросмотр в галерее и живой предпросмотр в деталях.

## 18. Обработка runtime-ошибок

SCORM-пакет включает минимальный экран ошибки Core, независимый от выбранного шаблона.

Если рендеринг шаблона или runtime шаблона падает после экспорта, Core показывает аварийный
экран:

```text
Не удалось отобразить страницу курса.
Код ошибки: TEMPLATE_RENDER_ERROR
Попробуйте обновить страницу или обратитесь к администратору.
```

Core должен логировать детали в:

- консоль браузера;
- диагностику `suspend_data`, где возможно;
- telemetry, если включена.

Пакет не включает стандартный шаблон целиком: в него добавляются только резервные макеты и стили
стандартного шаблона для системных экранов, не объявленных выбранным шаблоном.

## 19. Зона ответственности SCORM

Поддерживаемые SCORM-операции шаблона идут через `TestBuilder.scorm`.

Core владеет:

- стандартными полями score;
- completion/success status;
- стандартными интерактивами вопросов;
- публикацией пользовательских показателей результата;
- слиянием `suspend_data`;
- telemetry payload при завершении.

Шаблонный код (`template.js`) может запрашивать поддерживаемую SCORM-операцию:

```js
TestBuilder.scorm.commit();
```

