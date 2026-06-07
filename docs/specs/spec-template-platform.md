# Техническая спецификация: платформа SCORM-шаблонов

**Статус:** актуально (контракт реализованной платформы шаблонов)  
**Дата актуализации:** 2026-06-06  
**Связанные документы:** [BRD](brd-scorm-enhancements.md),
[PRD-1](prd-1/templates-content-pages.md),
[PRD-2](prd-2/result-variables.md),
[PRD-3](prd-3/external-templates.md)

## 1. Назначение

Этот документ определяет общий технический контракт для внутренних и внешних SCORM-шаблонов.
Он является источником истины для шаблонной платформы. Продуктовые PRD должны ссылаться на
этот документ, а не переопределять механику шаблонов независимо.

> Практическое пошаговое руководство для разработчика шаблона (структура ZIP,
> манифест, макеты, DSL, контекст, проверка, примеры) —
> [docs/guides/template-development.md](../guides/template-development.md).

Платформа должна поддерживать:

- единую механику для встроенных и загружаемых шаблонов;
- исполнение шаблона только в браузере внутри сгенерированного SCORM-пакета;
- полную настройку макетов страниц, а не только цветов и шрифтов;
- контролируемую ответственность Core за оценку, состояние навигации, SCORM-состояние и стандартные интерактивы вопросов;
- расширение через `template.js`, Runtime API и правила курса.

## 2. Базовые принципы

### 2.1 Исполнение только в браузере

Шаблоны исполняются только в браузере обучающегося внутри SCORM-пакета.

Сервер не должен выполнять HTML или JavaScript шаблона во время экспорта. Сервер только:

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

Физическое хранение может отличаться, но runtime-поведение должно быть одинаковым.

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
- опциональным клиентским поведением через `template.js`;
- опциональными декларативными правилами шаблона для технического/визуального поведения.

## 3. Фазы поставки

### Фаза 1: платформа макетов шаблонов

Объём MVP:

- браузерный рендеринг `shell.html` и макетов страниц;
- единый манифест;
- слоты, хуки и действия макетов;
- минимальный path-only DSL шаблонов;
- ресурсы шаблона из манифеста;
- Runtime API MVP;
- практичный MVP правил курса;
- renderer registry для динамических placeholders;
- структурная валидация и браузерная smoke-проверка;
- стандартные интерактивы вопросов под управлением Core.

### Фаза 2: расширенные шаблонные интерактивы

Шаблоны смогут переопределять механику стандартных интерактивов вопросов через `template.js`.

Планируемый API:

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

Форматы ответов должны оставаться совместимыми с Core:

```js
single: 2
multiple: [0, 3]
matching: { "0": 2, "1": 0 }
ranking: [2, 0, 1, 3]
```

### Будущее: enterprise-фиксация версий шаблонов

MVP сохраняет выбранный `templateVersion` для диагностики и миграций, но не требует хранить
каждую старую файловую версию шаблона.

Будущий enterprise-режим может закреплять тесты за точными файловыми версиями шаблонов.

### Будущее: оценка расширенного движка правил

Нужно создать отдельный оценочный документ для Storyline-подобных расширенных возможностей:

- layers;
- timeline;
- object states;
- shape clicks;
- hotspots;
- drag triggers;
- random variables;
- complex triggers;
- object intersection;
- media timeline events;
- animation events;
- conditional branching by UI object state.

Цель документа - решить, должны ли эти возможности стать полноценным авторским движком или
оставаться покрытыми через `template.js` и кастомные интерактивы.

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

  rules/
    template-rules.json

  assets/
    fonts/
    images/
    icons/
```

`manifest.json` является источником истины. Дополнительные файлы разрешены, но все файлы,
на которые есть ссылки, должны существовать внутри ZIP.

Внешние URL запрещены. Все CSS, JS, шрифты, изображения, иконки и другие ресурсы должны быть
локальными файлами внутри SCORM ZIP.

Сгенерированный SCORM-пакет включает только выбранный шаблон, а не полную библиотеку шаблонов
и не резервный default-шаблон.

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
    "content.intro": "layouts/content-intro.html",
    "content.info": "layouts/content-info.html",
    "content.summary": "layouts/content-summary.html",
    "content.html": "layouts/content-html.html",
    "question.single": "layouts/question-single.html"
  },

  "contentTemplates": [
    {
      "key": "intro.hero",
      "label": "Введение: крупный заголовок и изображение",
      "pageKind": "content.intro",
      "layout": "content.intro",
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
      "pageKind": "content.info",
      "layout": "content.info",
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
      "pageKind": "content.summary",
      "layout": "content.summary",
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
  },

  "rules": {
    "template": "rules/template-rules.json"
  }
}
```

### 5.2 Обязательные поля манифеста

Обязательные:

- `id`
- `name`
- `version`
- `templateApiVersion`
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
- `contentTemplates`
- `rendererPlugins`
- `partials`
- `systemPages`
- `rules.template`

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

Поддерживаемые типы MVP:

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

### 6.1 Миграция параметров при обновлении шаблона

Правило MVP:

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

> **Реализация (PRD-3 валидатор / PRD-12 рантайм).** Структурный валидатор и
> браузерная проверка работоспособности требуют от оболочки только
> `data-slot="page"` (код ошибки `SHELL_CONTRACT`). Маркеры `data-nav`/`data-action`
> привязываются Core, когда присутствуют, но **не являются** обязательными для
> прохождения валидации/проверки: встроенный `default` их в `shell.html` не
> объявляет, а действия Core навешивает делегированием по `[data-action]` поверх
> экранов, отрисованных `renderScreenInto`. Жёсткая проверка привязки `next/
> answer-submit/test-finish` — целевой контракт фазы расширенных интерактивов.

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

> **Реализация (PRD-3 валидатор / PRD-12 рантайм).** Текст вопроса монтируется в
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

- формулировку вопроса в `question-prompt`;
- стандартный рендерер интерактива в `question-interaction`;
- медиа, обратную связь, подсказки, счётчики и метаданные только если опциональные слоты существуют.

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

| Page kind | Назначение | Специфичный layout | Fallback |
| --- | --- | --- | --- |
| `start` | Стартовая страница теста | `layouts.start` | `layouts.content` |
| `content.intro` | Введение перед темой/разделом | `layouts["content.intro"]` | `layouts.content` |
| `content.info` | Информационная/учебная страница | `layouts["content.info"]` | `layouts.content` |
| `content.summary` | Итог темы/раздела | `layouts["content.summary"]` | `layouts.content` |
| `content.html` | Санитизированный HTML-блок | `layouts["content.html"]` | `layouts.content` |
| `system.blocked` | Системная страница блокировки | `systemPages[].layout` | `layouts.content` |

### 8.2.1 `contentTemplates[]`

`manifest.contentTemplates[]` объявляет скелеты страниц, доступные автору при выбранном шаблоне.
Один SCORM-шаблонный пакет может содержать несколько content templates. Это штатный механизм для
вариантов страниц: например несколько `content.info`, несколько `content.summary` или разные
варианты стартовой страницы.

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
  "pageKind": "content.info",
  "layout": "content.info",
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
      "allowedMarks": ["bold", "italic", "link"],
      "allowedBlocks": ["paragraph", "bulletedList", "numberedList"]
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

Поддерживаемые типы placeholders MVP:

```text
text
textarea
richText
image
video
file
number
boolean
select
resultField
actionLabel
```

### 8.2.1.1 Политика размера текста

Для placeholders типов `text`, `textarea` и `richText` шаблон должен явно определить поведение
текста при переполнении блока. Модель следует логике PowerPoint text box:

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
произвольные inline font-size внутри richText не входят в MVP.

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

Стандартные runtime-пути MVP:

| Path | Назначение |
| --- | --- |
| `progress.active.current` / `progress.active.total` / `progress.active.percent` | Активный прогресс согласно `progress.mode` |
| `progress.question.current` / `progress.question.total` / `progress.question.percent` | Прогресс только по вопросам |
| `progress.page.current` / `progress.page.total` / `progress.page.percent` | Прогресс по всем страницам flow |
| `result.scoreRaw` / `result.scoreMax` / `result.scorePercent` | Итоговый результат теста |
| `result.status` | Итоговый статус, например `passed`/`failed` |
| `sectionResult.scoreRaw` / `sectionResult.scoreMax` / `sectionResult.percent` | Результат текущего раздела для `content.summary` |
| `sectionResult.status` | Статус текущего раздела |
| `result.{name}` | Пользовательские показатели из PRD-2 |
| `retake.availableDate` | Дата доступного повторного прохождения для `system.blocked` |

Стандартные renderers MVP поставляются как plugin `core` и используются по полным ключам
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

Для `content.summary` Core дополнительно добавляет в публичный контекст готовый результат
темы/раздела. Шаблон может показать эти значения через placeholders типа `resultField`, но не
рассчитывает их самостоятельно.

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

Все макеты получают общий публичный контекст с типизированным `page`.

Пример:

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

Core подготавливает классы состояния, например `className`, `nextClassName` и другие поля
состояния. DSL шаблона не вычисляет классы через выражения.

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

API MVP:

```js
TestBuilder.template.on(event, handler);

TestBuilder.context.get();

TestBuilder.vars.get(name);
TestBuilder.vars.set(name, value, options);
TestBuilder.vars.increment(name, by);

TestBuilder.nav.next();
TestBuilder.nav.prev();
TestBuilder.nav.goToPage(pageId);
TestBuilder.nav.goToTopic(topicId);
TestBuilder.nav.lock(reason);
TestBuilder.nav.unlock(reason);

TestBuilder.ui.setState(key, value);
TestBuilder.ui.toast(message, options);
TestBuilder.ui.modal(options);

TestBuilder.timer.start(id, options);
TestBuilder.timer.stop(id);
TestBuilder.timer.reset(id);

TestBuilder.scorm.commit();
TestBuilder.scorm.setSuspendData(namespace, value);
TestBuilder.scorm.addInteraction(payload);
```

Прямой доступ к `window.API_1484_11` не входит в поддерживаемый контракт. Все поддерживаемые
SCORM-операции идут через `TestBuilder.scorm`.

## 13. Переменные

Пространства имён:

```text
template.*
test.*
result.*
system.*
learner.*
```

Типизация MVP:

- переменные `test.*` явно типизируются в конфигурации теста;
- переменные `result.*` типизируются через определения пользовательских показателей результата;
- `template.*`, `system.*` и `learner.*` могут быть динамическими, если не указано иное.

Пользовательские показатели результата остаются отдельной сущностью, но после `result:calculated`
вычисленные значения публикуются в `result.*`.

### 13.1 Сохранение

В SCORM `suspend_data` сохраняются только persistent-переменные.

Политика по умолчанию:

```text
template.*  не сохраняется по умолчанию
test.*      сохраняется
result.*    сохраняется после result:calculated
system.*    не сохраняется
learner.*   сохраняется или доступно только для чтения, где применимо
```

Код шаблона может запросить сохранение для конкретных переменных шаблона:

```js
TestBuilder.vars.set("template.sidebarCollapsed", true, { persist: true });
```

## 14. Правила курса

Платформа поддерживает гибридную модель логики:

- декларативные правила курса для настраиваемой автором no-code логики;
- `template.js` для расширенного поведения в коде.

### 14.1 Источники правил

Правила шаблона:

- находятся в `rules/template-rules.json`;
- указываются через `manifest.rules.template`;
- ограничены техническим/визуальным поведением.

Правила теста:

- хранятся в таблице БД `course_rules`;
- представляют бизнес-логику курса/теста;
- экспортируются в SCORM-пакет как единый массив правил.

### 14.2 Порядок исполнения

Глобальный конвейер событий:

```text
1. Core обновляет базовое состояние события
2. template.js получает событие beforeRules
3. Выполняются правила шаблона
4. Выполняются правила теста
5. template.js получает событие afterRules
6. Core применяет финальные защиты и фиксирует состояние
```

Правила шаблона выполняются до правил теста. Бизнес-правила теста имеют приоритет над значениями
шаблона по умолчанию.

### 14.3 Области разрешений

Правила шаблона могут выполнять только технические/визуальные действия, например:

```text
ui.setState
ui.toast
timer.start/stop/reset
nav.lock/unlock с причиной от шаблона
nav.next только для страниц с автопереходом
vars.set только внутри template.*
```

Правила теста могут выполнять бизнес-действия:

```text
vars.set test.*
vars.set result.* там, где разрешено
nav.goToPage
nav.goToTopic
scorm.setSuspendData
scorm.addInteraction
result.calculate
test.complete
```

### 14.4 Практичные события MVP

```text
course:start
course:resume
page:enter
page:leave
question:answerChanged
question:submitted
topic:started
topic:completed
timer:expired
test:completed
result:calculated
```

### 14.5 Отменяемые события действий

Отменяемые события разрешены только для закрытого списка:

```text
nav:beforeNext
nav:beforePrev
nav:beforeGoToPage
question:beforeSubmit
test:beforeFinish
```

Конвейер отложенного действия:

```text
1. Core создаёт отложенное действие
2. template.js action:beforeRules может отменить действие, задать поведение по умолчанию или установить переменные
3. Выполняются правила шаблона
4. Выполняются правила теста
5. template.js action:afterRules может отменить действие или отреагировать
6. Финальные защиты Core могут отменить действие
7. Core фиксирует действие
8. Если произошла навигация, запускается page lifecycle pipeline
```

Пример:

```js
TestBuilder.template.on("nav:beforeNext:beforeRules", (ctx) => {
  if (ctx.vars.get("template.blockNext")) {
    ctx.preventDefault("template.blockNext");
    ctx.ui.modal({ message: "Переход временно недоступен" });
  }
});
```

### 14.6 Формат условий правил

Канонический формат хранения - JSON-дерево выражений.

Пример:

```json
{
  "and": [
    { "gte": [{ "var": "test.Blocks_Done" }, 6] },
    { "eq": [{ "var": "result.Result_Tech" }, true] }
  ]
}
```

Операторы MVP:

```text
eq / neq
gt / gte / lt / lte
and / or / not
exists / empty
includes
```

### 14.7 Формат действий правил

Канонический формат действий - JSON-объекты действий.

Пример:

```json
{
  "actions": [
    {
      "type": "vars.set",
      "name": "test.Blocks_Done",
      "value": {
        "add": [{ "var": "test.Blocks_Done" }, 1]
      }
    },
    {
      "type": "nav.goToTopic",
      "topicId": "finance"
    }
  ]
}
```

Значения действий могут быть деревом выражений. Сокращённые действия вроде `vars.increment` остаются
поддержанными для удобства UI.

Действия MVP:

```text
vars.set
vars.increment
vars.append
nav.next
nav.goToPage
nav.goToTopic
nav.lock
nav.unlock
ui.modal
ui.toast
ui.setState
timer.start
timer.stop
timer.reset
scorm.commit
scorm.setSuspendData
scorm.addInteraction
```

### 14.8 UI правил

MVP:

- визуальный конструктор правил;
- readonly-предпросмотр JSON.

Будущее:

- расширенный JSON-редактор с валидацией.

### 14.9 Хранение правил

Test rules хранятся в `course_rules`.

Рекомендуемая таблица MVP:

```sql
CREATE TABLE course_rules (
  id             uuid PRIMARY KEY,
  test_id        uuid NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  name           text NOT NULL,
  description    text,
  event          text NOT NULL,
  condition_json jsonb,
  actions_json   jsonb NOT NULL,
  enabled        boolean NOT NULL DEFAULT true,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);
```

В MVP нет колонки `scope`. Таблица хранит только правила теста.

Разрешение конфликтов:

- детерминированное исполнение по `sort_order`;
- последнее применённое состояние побеждает;
- будущий UI может предупреждать о вероятных конфликтах.

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

MVP не требует строгого закрепления файловой версии. Сохранённые версии используются для
диагностики, проверки совместимости и сообщений о миграции параметров.

## 17. Валидация

### 17.1 Структурная валидация

Блокирующие ошибки:

- невалидный ZIP;
- отсутствующий или невалидный `manifest.json`;
- отсутствующие обязательные поля манифеста;
- неподдерживаемый `templateApiVersion`;
- отсутствующие обязательные макеты;
- отсутствующие обязательные хуки/действия `shell.html`;
- отсутствующие обязательные слоты вопросов;
- отсутствующие файлы, на которые ссылается манифест;
- отсутствующий или невалидный `assets.preview`;
- отсутствующий или невалидный `preview`;
- отсутствующий, невалидный или несовместимый `preview.demoData`;
- route в `preview.routes`, для которого нет layout/template/capability;
- внешние URL в ресурсах/макетах/скриптах/стилях, на которые ссылается манифест;
- невалидный `template-rules.json`;
- невалидные определения параметров;
- невалидные `contentTemplates[]`: отсутствует `key`, `label`, `pageKind`, `layout` или
  `placeholders[]`;
- невалидные возможности (`capabilities`);
- невалидные объявления системных страниц.

Предупреждения:

- неиспользуемые параметры;
- неиспользуемые ресурсы;
- отсутствующие опциональные макеты;
- отсутствующие опциональные слоты;
- предупреждения консоли в браузерной smoke-проверке;
- fallback renderer в live preview, если страница осталась работоспособной;
- отсутствующее покрытие необязательного route в demo dataset;
- возможность объявлена, но опциональный partial отсутствует там, где существует резервный рендерер Core.

### 17.2 Валидация макетов

Обязательные элементы `shell.html`:

```html
<div data-slot="page"></div>
<button data-nav="next"></button>
<button data-action="answer-submit"></button>
<button data-action="test-finish"></button>
```

Обязательные элементы макетов вопросов:

```html
<div data-slot="question-prompt"></div>
<div data-slot="question-interaction"></div>
```

Слоты контентных страниц и результатов опциональны, если будущие возможности (`capabilities`) не потребуют
обратного.

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
парсинг/исполнение правил шаблона
загрузка template.js
```

Критерии успешного прохождения:

```text
нет необработанных ошибок
обязательные слоты заполнены
next/answer-submit/test-finish привязаны
ответы сохранены в состояние Core
страница результатов открывается
```

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

Пакет не включает резервный default-шаблон в MVP.

## 19. Зона ответственности SCORM

Поддерживаемые SCORM-операции шаблона идут через `TestBuilder.scorm`.

Core владеет:

- стандартными полями score;
- completion/success status;
- стандартными интерактивами вопросов;
- публикацией пользовательских показателей результата;
- слиянием `suspend_data`;
- telemetry payload при завершении.

Правила шаблона/теста могут запрашивать поддерживаемые операции:

```js
TestBuilder.scorm.commit();
TestBuilder.scorm.setSuspendData("template.someNamespace", value);
TestBuilder.scorm.addInteraction(payload);
```

Core должен предотвращать конфликты пространств имён и индексов interactions.

## 20. Согласование PRD/BRD

Продуктовые документы должны оставаться согласованными со следующими базовыми решениями:

- шаблон исполняется только в браузере;
- для внутренних и внешних шаблонов используется одна общая механика;
- этот манифест и структура ZIP являются источником истины;
- используется контракт слотов оболочки/страниц вместо устаревшего DOM-контракта;
- правила курса являются отдельной продуктовой и технической возможностью;
- расширенные шаблонные интерактивы и расширенный движок правил остаются будущими фазами;
- внешние URL в ресурсах SCORM-шаблона запрещены;
- выбранный SCORM ZIP включает только один выбранный шаблон;
- `result_variables` публикуются в `result.*`.
