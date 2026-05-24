# PRD-7: Рефакторинг редактора параметров теста

**Версия:** 1.0  
**Статус:** Черновик  
**Связанные документы:** [BRD](brd-scorm-enhancements.md), [PRD-1](prd-1-templates-content-pages.md),
[PRD-4](prd-4-course-flow-sections.md), [PRD-6](prd-6-retake-cooldown-gate.md),
[PRD-8](prd-8-section-router-flow.md)  
**Этап BRD:** BR-08, Этап 9  
**Зависимости:** текущий авторский раздел тестов, API `/api/tests`, шаблоны и content pages из PRD-1

---

## 1. Обзор

### 1.1 Контекст

Параметры теста превратились из простой формы в центр настройки курса. Автор настраивает:

- базовые поля теста;
- режим `standard` или `adaptive`;
- сценарий прохождения/flow: единый блок вопросов, последовательность по темам или смешанный блок;
- темы и количество вопросов из каждой темы;
- проходные критерии теста и темы;
- адаптивные уровни сложности;
- таймер, количество попыток, показ правильных ответов;
- стартовый контент и общую обратную связь как элементы структуры прохождения/результата;
- оформление шаблона;
- content pages;
- экспорт SCORM.

Текущая реализация смешивает эти зоны в одном большом компоненте страницы списка тестов и
добавляет расширенные настройки отдельными кнопками на карточку теста. Это уже проявляется как
плохой UX: карточка становится местом для разнородных действий, а редактирование теста не выглядит
как единый сценарий.

### 1.2 Цель

Создать единый, поддерживаемый редактор параметров теста, который:

1. объединяет основные и расширенные настройки в понятной структуре;
2. отделяет форму редактирования от страницы списка тестов;
3. вводит typed model/DTO/mappers вместо ручной сборки `any` payload;
4. централизует валидацию standard/adaptive настроек;
5. готовит поверхность для будущих `flowPolicy`, `retakePolicy`, шкал и внешних шаблонов.

### 1.3 Не цель

В рамках этого PRD не требуется:

- менять SCORM runtime;
- реализовывать новые `flowPolicy` или `retakePolicy`;
- менять модель вопросов;
- переделывать визуальный дизайн всех авторских страниц;
- добавлять новый функционал сверх реорганизации существующего редактирования теста.

---

## 2. Текущее устройство

### 2.1 Frontend

Основная форма находится в `client/src/pages/author/tests.tsx`.

Текущий компонент `TestsPage` одновременно отвечает за:

- загрузку списка тестов, тем и папок;
- фильтрацию, сортировку, grid/list view;
- создание, редактирование, удаление и перемещение тестов;
- wizard создания/редактирования теста;
- standard/adaptive mode state;
- adaptive difficulty distribution;
- export SCORM dialog;
- design settings dialog;
- content pages dialog.

Форма создания/редактирования построена как wizard из трёх шагов:

| Шаг | Назначение | Основные поля |
| --- | --- | --- |
| 1 | Выбор режима и тем | `testMode`, `selectedSections`, поиск тем |
| 2 | Настройка тем | standard: `drawCount`, `topicPassRule`; adaptive: уровни сложности, пороги, links |
| 3 | Финальные параметры | title, description, timer, attempts, showCorrectAnswers, startPageContent, feedback, overallPassRule, webhook |

Состояние формы разделено между:

- `react-hook-form` для части полей третьего шага;
- `useState` для `selectedSections`;
- `useState` для `testMode`;
- `useState` для `adaptiveTopicConfigs`;
- `useState` для `showDifficultyLevel`;
- локальным cache `distributionCache`;
- отдельными dialog state для export/design/content pages.

### 2.2 Маппинг данных

Открытие редактирования выполняет ручной маппинг API-модели в состояние формы:

- `handleOpenEdit(test)` сбрасывает `react-hook-form`;
- `test.sections` преобразуются в `SectionConfig[]`;
- `test.adaptiveSettings` преобразуются в `AdaptiveTopicConfig[]`;
- `overallPassRuleJson` приводится к `overallPassType/overallPassValue`.

Сохранение выполняется в `onSubmit(formData)`:

- вручную собирается объект `data: any`;
- для standard режима добавляется `sections`;
- для adaptive режима добавляются `sections` с `drawCount: 0` и `adaptiveSettings`;
- create/update выбирается по `editingTest`.

### 2.3 Backend

Основные endpoints:

| Endpoint | Назначение |
| --- | --- |
| `POST /api/tests` | Создание теста и секций |
| `PUT /api/tests/:id` | Обновление теста, секций и адаптивных настроек |
| `GET /api/tests/:id/adaptive-settings` | Дозагрузка адаптивных настроек |
| `GET/PUT /api/tests/:id/design` | Настройки оформления |
| `/api/tests/:id/content-pages*` | Content pages |
| `GET /api/tests/:id/export/scorm` | Экспорт |

Сохранение standard-секций происходит через `storage.updateTest(id, updates, sections)`, где старые
секции удаляются и создаются заново. Адаптивные настройки в route handler удаляются и создаются
заново отдельными вызовами после обновления теста.

### 2.4 Модель данных

Ключевые таблицы:

| Таблица/поле | Назначение |
| --- | --- |
| `tests` | Базовые настройки теста, mode, pass rule, timer, attempts, design settings |
| `test_sections` | Связь теста с темами, draw count, topic pass rule |
| `adaptive_topic_settings` | Настройки адаптивности по теме |
| `adaptive_levels` | Уровни сложности темы |
| `adaptive_level_links` | Рекомендованные ссылки уровня |
| `content_pages` | Content pages PRD-1 |
| `templates` | Шаблоны PRD-1 |

---

## 3. Проблемы текущей реализации

### 3.1 UX

- Расширенные настройки появились как отдельные кнопки на карточке теста: **Оформление**,
  **Страницы**, **Экспорт SCORM**. Это не масштабируется при добавлении flow, retake, шкал и
  внешних шаблонов.
- Создание и редактирование теста спрятаны в wizard, но design/content pages находятся снаружи
  wizard. Для автора это разные точки входа в один объект.
- Шаг 3 содержит базовые, runtime и интеграционные настройки вперемешку.
- Переключатель standard/adaptive расположен до выбора тем и может менять смысл последующих
  настроек без явного объяснения последствий.

### 3.2 Поддерживаемость frontend

- `TestsPage` является page-level god component.
- Форма использует смешанную модель состояния: часть в `react-hook-form`, часть в независимых
  `useState`.
- Payload собирается как `any`, что скрывает ошибки при добавлении новых полей.
- Маппинг API -> form и form -> API не изолирован и не покрыт unit-тестами.
- В компоненте остаются debug `console.log`, которые не являются контролируемой диагностикой.

### 3.3 Данные и API

- Standard-секции и adaptive-settings сохраняются разными путями и не выглядят как единая доменная
  операция "сохранить настройки теста".
- Адаптивные уровни удаляются и создаются заново после обновления теста. Без явной транзакции это
  создаёт риск частично сохранённого состояния.
- Backend почти не валидирует доменные ограничения payload: диапазоны сложности, количество
  вопросов, пороги прохождения, пустые названия уровней, links.
- При переключении adaptive -> standard старые adaptive settings могут остаться в базе, но не
  всегда явно управляются UI.

### 3.4 Тестируемость

- Нет отдельного `TestEditorModel`, который можно тестировать без React.
- Нет unit-тестов для мапперов и правил валидации.
- Основная проверка поведения возможна только через интеграционные тесты страницы.

---

## 4. Целевой пользовательский сценарий

### 4.1 Единый редактор теста

Автор открывает тест и попадает в единый редактор с разделами:

| Раздел | Назначение |
| --- | --- |
| Состав | Выбор тем, количество вопросов, обязательность и feedback темы |
| Настройки | Название, описание, статус, режим `standard/adaptive`, `flowMode`, pass rules, time limits, feedback теста, telemetry, webhook; adaptive-секция показывается только для adaptive-режима |
| Оформление | Выбор шаблона и params из PRD-1; `templateVersion` и `templateApiVersion` отображаются read-only |
| Структура | Визуальная структура по `flowMode`, места показа content/feedback pages, fallback-warning по отсутствующим template elements |

Редактор реализуется как **wide Drawer** с вкладками. Экспорт SCORM не является вкладкой Drawer:
это отдельное действие карточки теста или меню действий.

Layout-требования:

- desktop width: `min(1120px, calc(100vw - 48px))`;
- минимальная ширина для двухпанельной вкладки "Настройки": `960px`;
- при ширине `>= 960px` вкладка "Настройки" использует side nav второго уровня и правую рабочую
  область;
- при ширине `< 960px` вкладка "Настройки" использует селектор секции сверху и одноколоночную
  форму;
- header Drawer и footer действий должны быть стабильными, без зависимости от выбранной секции.
- сохранение выполняется одной кнопкой **"Сохранить"** для всего редактора, без посекционного
  сохранения;
- основные вкладки показывают агрегированное состояние, а секции внутри вкладок показывают
  локальные индикаторы `изменено`, `warning`, `error`;
- кнопка сохранения активна только если есть изменения и нет блокирующих ошибок;
- после успешного сохранения Drawer остаётся открытым, данные обновляются, индикаторы изменений
  сбрасываются.

### 4.2 Карточка теста

Карточка теста остаётся компактной:

- открыть/редактировать;
- назначить;
- аналитика;
- меню дополнительных действий.

Расширенные действия должны быть сгруппированы в меню или доступны внутри редактора.

### 4.3 Standard/adaptive

Переключение режима:

- показывает, какие настройки будут активны;
- не удаляет настройки другого режима без подтверждения;
- сохраняет черновик до явного сохранения;
- показывает warning, если настройки несовместимы.

---

## 5. Функциональные требования

### 5.1 Структура редактора

| ID | Требование |
| --- | --- |
| FR-01 | Редактор теста выносится из `TestsPage` в отдельный route или крупный компонент `TestEditor` |
| FR-02 | Список тестов открывает редактор для create/edit и не содержит inline wizard |
| FR-03 | Редактор поддерживает create и edit режимы на одной модели; оба открываются в wide Drawer; modal wizard полностью удаляется из `TestsPage` |
| FR-04 | Редактор показывает статус валидности разделов и блокирует сохранение при критичных ошибках |
| FR-05 | При закрытии с несохранёнными изменениями показывается confirmation dialog с действиями "Сохранить", "Выйти без сохранения", "Отмена" |
| FR-05a | Если есть блокирующие ошибки, кнопка "Сохранить" в confirmation dialog остаётся видимой, но disabled; UI показывает причину и переход к первой ошибочной секции |
| FR-05b | В footer нет постоянной кнопки "Сбросить всё"; отмена всех несохранённых изменений выполняется через закрытие Drawer и "Выйти без сохранения" |

### 5.2 Доменная модель формы

| ID | Требование |
| --- | --- |
| FR-06 | Ввести `TestEditorModel` как нормализованную frontend-модель редактора |
| FR-07 | Ввести typed DTO для API payload: `TestSettingsPayload`, `TestSectionPayload`, `AdaptiveSettingsPayload` |
| FR-08 | Мапперы `apiToEditorModel()` и `editorModelToPayload()` вынести в отдельный модуль |
| FR-09 | Мапперы должны покрывать standard/adaptive режимы и fallback старых тестов |
| FR-10 | В форме не должно быть ручной сборки большого `any` payload внутри React-компонента |

### 5.3 Валидация

| ID | Требование |
| --- | --- |
| FR-11 | `title` обязателен |
| FR-12 | Должна быть выбрана минимум одна тема |
| FR-13 | Для standard режима `drawCount` должен быть от 1 до количества доступных вопросов темы |
| FR-14 | Для percent pass rule значение должно быть от 0 до 100 |
| FR-15 | Для absolute pass rule значение не должно превышать число выбранных вопросов |
| FR-15a | Редактор должен иметь явную `passDecisionPolicy`, которая определяет, как общий проходной балл и правила по темам дают итоговый статус теста |
| FR-15b | Если правила по темам выключены, default policy: `overall_only`; если включено хотя бы одно правило по теме, default policy: `overall_and_required_topics` |
| FR-15c | При `overall_and_required_topics` тест считается пройденным только если выполнено общее правило и пройдены все обязательные темы по индивидуальному или унаследованному правилу |
| FR-15d | Связь теста с темой должна иметь признак `required`, который используется в политиках прохождения по обязательным темам и в router-flow |
| FR-15e | `passDecisionPolicy` должна поддерживать `all_topics_passed`: тест пройден только если пройдена каждая выбранная тема |
| FR-15f | Правило прохождения темы должно иметь источник: `inherit_overall`, `custom` или `none` |
| FR-15g | При выборе `all_topics_passed` каждая тема должна иметь проверяемое правило: `inherit_overall` или `custom`; если общее правило `none`, наследование запрещено |
| FR-16 | Для adaptive уровня `minDifficulty < maxDifficulty`, оба значения от 0 до 100 |
| FR-17 | Для adaptive уровня `questionsCount >= 1` и не должен превышать доступное количество вопросов диапазона без warning |
| FR-18 | `passThreshold` adaptive уровня валидируется по типу: percent 0..100, absolute 0..questionsCount |
| FR-19 | Link сохраняется только если заполнены и title, и URL; неполные links показываются как ошибка или warning до сохранения |
| FR-20 | `webhookUrl` валидируется как URL или пустое значение |
| FR-20a | Валидация работает по комбинированной схеме: поля проверяются после `blur` или значимого изменения, секции получают `warning`/`error`, навигация не блокируется |
| FR-20b | Сохранение блокируется только при `error`; `warning` не запрещает сохранить draft |
| FR-20c | Ошибки и предупреждения показываются у конкретных полей и в сводке секции со ссылками-якорями на проблемные поля |

### 5.4 Сохранение

| ID | Требование |
| --- | --- |
| FR-21 | Сохранение standard теста обновляет базовые поля и секции атомарно |
| FR-22 | Сохранение adaptive теста обновляет базовые поля, секции и adaptive settings атомарно |
| FR-23 | При ошибке сохранения UI показывает область ошибки и не закрывает редактор |
| FR-24 | После успешного сохранения invalidation React Query обновляет список тестов и данные редактора |
| FR-25 | Версия теста увеличивается только при изменениях, влияющих на прохождение/экспорт |
| FR-25a | Редактор имеет единую кнопку "Сохранить" для всей draft-модели, без посекционного сохранения |
| FR-25b | Основные вкладки показывают агрегированное состояние, а секции внутри вкладок показывают локальные индикаторы `изменено`, `warning`, `error` |
| FR-25c | Перед сохранением нет обязательного preview-step; footer показывает строку изменённых областей и опциональное действие "Показать изменения" |
| FR-25c1 | В первом релизе "Показать изменения" отображает grouped summary по вкладкам/секциям, а не полный field-level diff |
| FR-25c2 | Действие "Показать изменения" отображается только в dirty-состоянии редактора |
| FR-25d | Переключение `standard/adaptive` или `flowMode` применяется к draft сразу; несовместимые настройки скрываются с inline warning и не удаляются автоматически |
| FR-25e | Переключение критичных режимов не требует modal confirmation, если данные не удаляются; предупреждение показывается inline |
| FR-25f | Несовместимые с текущим режимом настройки скрываются и не визуализируются как поля; секция показывает только компактный warning-блок с раскрываемым списком скрытых групп/настроек |
| FR-25g | Редактор не предоставляет отдельное действие ручной очистки скрытых несовместимых настроек; при возврате режима настройки снова отображаются |
| FR-25h | API payload содержит только данные, применимые к текущему режиму, плюс системные метаданные режима; скрытые draft-настройки не попадают в runtime/SCORM; `required` темы берётся исключительно из `sections[].required` |
| FR-25i | Скрытые несовместимые настройки живут только в текущей открытой draft-сессии; после сохранения и повторного открытия редактора они не восстанавливаются |
| FR-25j | В первом релизе draft не автосохраняется в `localStorage` или `sessionStorage`; потеря изменений предотвращается guard при закрытии Drawer/страницы |
| FR-25k | В первом релизе используется optimistic flow с проверкой версии при сохранении; при конфликте (включая внешнюю смену статуса через меню карточки) показывается dialog "Обновить данные" / "Сохранить поверх" |

### 5.5 Интеграция PRD-1

| ID | Требование |
| --- | --- |
| FR-26 | Оформление теста доступно как раздел редактора или вложенный dialog внутри редактора, а не как отдельная кнопка, разрывающая сценарий |
| FR-27 | Content pages доступны из вкладки "Структура" |
| FR-28 | Экспорт SCORM доступен как действие карточки теста или пункт меню действий, но не как вкладка Drawer редактора |
| FR-29 | Вкладка "Структура" должна учитывать режим прохождения: для `linear_by_topics` показывать темы со страницами до/после внутри каждой темы, для `router_by_topics` — страницу-маршрутизатор и карточки разделов, для `linear_flat` — единый блок вопросов и зоны "До теста" / "После теста" для авторских страниц (без группировки по темам) |
| FR-30 | Удаление теста выполняется только из меню действий через confirmation dialog с вводом точного названия теста |
| FR-31 | Тесты в статусе "В архиве" не показываются в общем списке/поиске, недоступны для назначения и доступны только в отдельном разделе "Архив" |
| FR-32 | Параметр `showDifficultyLevel` должен находиться в adaptive-секции и отображаться только при выбранном adaptive-режиме |
| FR-33 | Редактор должен иметь явный параметр `flowMode`, определяющий сценарий прохождения: `linear_flat`, `linear_by_topics` или `router_by_topics` |
| FR-34 | Для темы можно задать индивидуальный лимит времени или наследовать общий лимит теста |
| FR-35 | Telemetry включается отдельным параметром `telemetryEnabled`, независимо от `webhookUrl` |
| FR-36 | Обратная связь поддерживается на уровнях теста, темы и adaptive-уровня; содержание feedback редактируется не во вкладке "Структура" |
| FR-37 | Feedback может содержать PDF-документы, которые упаковываются в SCORM и выводятся через download links на страницах структуры |
| FR-38 | Adaptive-настройки должны иметь уровень теста и уровень темы; вся adaptive-секция скрыта в standard-режиме |
| FR-39 | Если выбранный шаблон не содержит нужный template/system element, runtime использует fallback из `default`, а "Структура" показывает warning |
| FR-40 | При смене `flowMode` содержимое Состава (темы, draw-count / max для adaptive, feedback) и Структуры (авторские страницы в зонах «До теста» / «После теста», порядок) **не меняется**. Меняется только вид выдачи (рендер) под новый режим. Системные элементы режима (router-page с её параметрами `completionPolicy` / `sectionUnlockRules`) при переходе в несовместимый режим сохраняются в draft до закрытия редактора и восстанавливаются при возврате к router в той же сессии; после сохранения теста в режиме linear* параметры маршрутизатора очищаются |
| FR-41 | `templateVersion` и `templateApiVersion` являются read-only системными параметрами, а не редактируемыми настройками оформления |
| FR-42 | UI параметров шаблона поддерживает типы `multiselect`, `url`, `file`, `downloadLink` |
| FR-43 | Редактор теста использует wide Drawer; вкладка "Настройки" имеет второй уровень навигации: side nav на desktop и selector на narrow viewport |
| FR-44 | `tests.start_page_content` мигрирует в `content_pages` как запись `type=intro` без `topic_id`; поле deprecated и не используется новым кодом |
| FR-45 | `required` темы хранится только в `sections[].required`; `passRules.byTopic` не содержит дублирующего поля `required`; маппер проецирует значение в payload политик |

---

## 6. Технические требования

### 6.1 Frontend-модули

Предлагаемая структура:

```text
client/src/features/tests/editor/
  test-editor.tsx
  test-editor.types.ts
  test-editor.schema.ts
  test-editor.mappers.ts
  test-editor.validation.ts
  use-test-editor.ts
  sections/
    basic-settings-section.tsx
    topics-structure-section.tsx
    pass-rules-section.tsx
    adaptive-settings-section.tsx
    start-pages-section.tsx
    design-section.tsx
```

### 6.2 Модель редактора

Минимальный shape:

```ts
type FeedbackAsset = {
  id?: string;
  title: string;
  fileName: string;
  mimeType: "application/pdf";
  scormHref?: string;
};

type FeedbackContent = {
  format: "plain" | "richText" | "html";
  text: string;
};

type AdaptiveTestSettings = {
  showDifficultyLevel: boolean;
  strategy?: string;
  globalDefaults?: unknown;
};

type TestEditorModel = {
  id?: string;
  mode: "standard" | "adaptive";
  flowMode: "linear_flat" | "linear_by_topics" | "router_by_topics";
  flowSettings: {
    linear?: Record<string, never>;
    router?: {
      completionPolicy: "all_required_completed" | "all_required_passed";
      sectionUnlockRules: Record<
        string,
        | { mode: "always_available" }
        | { mode: "after_sections_completed"; sectionIds: string[] }
        | { mode: "after_sections_passed"; sectionIds: string[] }
      >;
    };
  };
  basic: {
    title: string;
    description: string;
    status: "draft" | "published" | "archived";
    feedback: FeedbackContent;
    feedbackLinks: Array<{ title: string; url: string }>;
    feedbackAssets: Array<FeedbackAsset>;
    webhookUrl: string;
    telemetryEnabled: boolean;
  };
  runtime: {
    timeLimitMinutes: number | null;
    maxAttempts: number | null;
    showCorrectAnswers: boolean;
  };
  passRules: {
    decisionPolicy:
      | "overall_only"
      | "overall_and_required_topics"
      | "required_topics_only"
      | "all_topics_passed";
    overall: { type: "percent" | "absolute" | "none"; value: number };
    byTopic: Record<
      string,
      | { source: "inherit_overall" }
      | { source: "custom"; type: "percent" | "absolute"; value: number }
      | { source: "none" }
    >;
  };
  sections: Array<{
    topicId: string;
    topicName: string;
    maxQuestions: number;
    drawCount: number;
    required: boolean;
    timeLimit:
      | { source: "inherit_test" }
      | { source: "custom"; minutes: number }
      | { source: "none" };
    feedback: FeedbackContent;
    feedbackLinks: Array<{ title: string; url: string }>;
    feedbackAssets: Array<FeedbackAsset>;
  }>;
  adaptive: {
    showDifficultyLevel: boolean;
    testSettings: AdaptiveTestSettings;
    topics: Array<AdaptiveTopicConfig & { enabled: boolean }>;
  };
};
```

### 6.3 DTO API payload

Типизированные payload-объекты, которые `editorModelToPayload()` возвращает для API-запросов.
Структура DTO является контрактом между фронтом и бэком и не должна собираться произвольно.

```ts
type TestSettingsPayload = {
  title: string;
  description: string;
  status: "draft" | "published" | "archived";
  mode: "standard" | "adaptive";
  flowMode: "linear_flat" | "linear_by_topics" | "router_by_topics";
  flowPolicyJson?: FlowPolicyPayload;
  overallPassRuleJson: { type: "percent" | "absolute" | "none"; value: number };
  passDecisionPolicy: PassDecisionPolicy;
  timeLimitMinutes: number | null;
  maxAttempts: number | null;
  showCorrectAnswers: boolean;
  feedback: { format: string; text: string };
  feedbackLinks: Array<{ title: string; url: string }>;
  webhookUrl: string | null;
  telemetryEnabled: boolean;
};

type TestSectionPayload = {
  topicId: string;
  drawCount: number;
  required: boolean;
  topicPassRuleJson: TopicPassRule;
  timeLimitMinutes: number | null;
  feedbackJson: { format: string; text: string };
  feedbackLinks: Array<{ title: string; url: string }>;
};

type AdaptiveSettingsPayload = {
  showDifficultyLevel: boolean;
  testSettings: AdaptiveTestSettings;
  topics: Array<AdaptiveTopicConfig>;
};
```

`required` в `TestSectionPayload` берётся из `sections[].required` (source of truth в модели).
В `TestSettingsPayload` нет поля `published` — только `status`.

### 6.4 Backend

Минимальные изменения:

- добавить request validation schema для create/update теста;
- обернуть сохранение теста, секций и adaptive settings в transaction;
- вынести orchestration сохранения из route handler в сервис, например `TestSettingsService`;
- сохранить backward compatibility текущих endpoints `POST /api/tests` и `PUT /api/tests/:id`;
- возвращать структурированные ошибки валидации с `field`, `code`, `message`.

Пример ошибки:

```json
{
  "error": "Validation failed",
  "fields": [
    {
      "field": "adaptive.topics[0].levels[1].minDifficulty",
      "code": "range_overlap",
      "message": "Минимальная сложность должна быть меньше максимальной"
    }
  ]
}
```

### 6.5 Нефункциональные требования редактора

| ID | Категория | Требование |
| --- | --- | --- |
| NFR-17 | Производительность | Drawer открывается с данными за не более 1.5 с на типичном тесте (до 20 тем) |
| NFR-18 | Производительность | Валидация полей debounced: не чаще одного раза за 300 мс при вводе |
| NFR-19 | Accessibility | При открытии Drawer фокус переходит на первый интерактивный элемент |
| NFR-20 | Accessibility | Вкладки и секции side nav доступны с клавиатуры; Tab/Shift-Tab работают без ловушки фокуса вне Drawer |
| NFR-21 | Accessibility | Индикаторы статуса (изменено/warning/error) имеют `aria-label`, не только цвет |

---

## 7. UX и wireframes

До frontend-разработки должны быть подготовлены wireframes:

- список тестов с компактными actions;
- редактор create standard (в Drawer, пустая форма, активна вкладка "Состав");
- редактор edit standard;
- редактор create adaptive (в Drawer, пустая форма);
- редактор edit adaptive;
- большой список тем;
- тема без вопросов;
- ошибка загрузки difficulty distribution;
- ошибка сохранения;
- unsaved changes;
- mobile/narrow viewport.
- confirmation dialog удаления теста с вводом названия.
- отдельный раздел "Архив" и восстановление теста из архива.
- стартовая страница как content page типа `intro` без topic во вкладке "Структура".

Wireframes должны явно показать, где находятся:

- оформление;
- content pages;
- экспорт;
- future slots для flow/retake/scales.

Отдельная корректировка wireframes нужна для вкладки **"Структура"**:

- в последовательном/секционном режиме структура показывает темы и страницы до/после каждой темы;
- в router-режиме структура показывает страницу-маршрутизатор, карточки разделов, статусы разделов
  и политику доступности итогового результата;
- router-режим визуализируется как сценарная карта `Router -> Раздел -> Возврат на Router -> Итог`,
  а не как линейный список страниц;
- в плоском режиме `linear_flat`, где все вопросы идут единым потоком, структура не
  показывает темы как отдельные блоки прохождения;
- для `linear_flat` структура показывает зоны **«До теста»** и **«После теста»**
  для авторских страниц; между ними — единый блок вопросов из всех выбранных тем.

Блокер перед frontend-реализацией: обновить `docs/wireframes/pages-tab.html` и повторно
согласовать состояния вкладки **"Структура"** для всех режимов `flowMode`.

---

## 8. Миграция

### 8.1 Совместимость данных

Существующие тесты продолжают открываться:

- отсутствие `mode` трактуется как `standard`;
- отсутствие `showDifficultyLevel` трактуется как `true`;
- отсутствие `designSettingsJson` трактуется как default template;
- отсутствие adaptive settings не ломает standard тесты;
- `tests.published = false` маппится в `status = 'draft'`;
- `tests.published = true` маппится в `status = 'published'`;
- при сохранении через новый редактор пишется `status`; `published` синхронизируется из `status`
  обратным маппером на переходный период до удаления колонки;
- `tests.start_page_content != NULL` при открытии legacy-теста в редакторе создаёт
  запись в `content_pages` типа `intro` без `topic_id`; поле deprecated и не используется
  новым кодом после миграции;
- feedback без поля `format` трактуется как `format = 'plain'`.

### 8.2 Пошаговая реализация

1. SQL-миграция: добавить колонку `tests.status enum('draft','published','archived')`,
   заполнить из `tests.published`; для непустых `tests.start_page_content` создать записи
   в `content_pages` типа `intro`.
2. Вынести типы, мапперы и validation без изменения UI.
3. Покрыть мапперы unit-тестами.
4. Вынести wizard в `TestEditor` без изменения поведения.
5. Разделить `TestEditor` на доменные секции.
6. Перенести design и content pages в редактор, а экспорт оставить в слое действий теста.
7. Добавить backend validation и transaction.
8. Удалить старый inline wizard из `TestsPage`.

---

## 9. Тестирование

### 9.1 Unit

- `apiToEditorModel()` для standard теста.
- `apiToEditorModel()` для adaptive теста.
- `apiToEditorModel()` для legacy-теста: `published=true` → `status='published'`.
- `apiToEditorModel()` для legacy-теста: `published=false` → `status='draft'`.
- `apiToEditorModel()` для теста с `start_page_content`: создаётся `content_pages` intro-запись.
- `editorModelToPayload()` для create standard.
- `editorModelToPayload()` для update adaptive.
- `editorModelToPayload()` проверяет: `required` берётся из `sections[]`, не из `passRules.byTopic`.
- validation pass/fail для draw count, pass rule, adaptive levels, webhook URL.

### 9.2 Component

- create standard happy path.
- edit standard с existing sections.
- create adaptive с загрузкой difficulty distribution.
- edit adaptive с сохранёнными levels/links.
- переключение standard/adaptive с предупреждением.
- unsaved changes guard.
- API error остаётся в редакторе.

### 9.3 API

- `POST /api/tests` standard создаёт test + sections.
- `PUT /api/tests/:id` standard атомарно обновляет sections.
- `POST /api/tests` adaptive создаёт test + adaptive settings.
- `PUT /api/tests/:id` adaptive откатывает изменения при ошибке уровня/link.
- validation errors возвращают field-level payload.

---

## 10. Acceptance Criteria

- [ ] `TestsPage` больше не содержит inline реализацию полного wizard редактирования теста.
- [ ] Создание и редактирование standard теста проходят через `TestEditor`.
- [ ] Создание и редактирование adaptive теста проходят через `TestEditor`.
- [ ] `TestEditorModel`, DTO, mappers и validation вынесены в отдельные модули.
- [ ] В React-компонентах нет сборки create/update payload через `any`.
- [ ] Редактор сохраняется одной кнопкой "Сохранить"; вкладки показывают агрегированные статусы,
  секции показывают локальные статусы `изменено`, `warning`, `error`.
- [ ] Перед сохранением нет обязательного preview-step; доступна только опциональная сводка изменений.
- [ ] "Показать изменения" в первом релизе отображает grouped summary по вкладкам/секциям без полного field-level diff.
- [ ] "Показать изменения" отображается только если есть несохранённые изменения.
- [ ] При переключении `standard/adaptive` или `flowMode` несовместимые настройки сохраняются
  в скрытой части draft и восстанавливаются при возврате режима.
- [ ] Переключение критичных режимов не показывает modal confirmation, если действие не удаляет данные.
- [ ] Несовместимые настройки скрываются и не визуализируются как поля текущего режима; доступен только warning-блок секции.
- [ ] Ручной очистки скрытых несовместимых настроек нет; при возврате режима они снова показываются.
- [ ] API payload не содержит скрытые несовместимые draft-настройки;
  сохраняется только применимая конфигурация текущего режима.
- [ ] Скрытые несовместимые настройки живут только в текущей открытой draft-сессии
  и не восстанавливаются после сохранения и повторного открытия редактора.
- [ ] Draft не автосохраняется в `localStorage`/`sessionStorage` в первом релизе; работает guard при закрытии Drawer/страницы.
- [ ] При сохранении проверяется серверная версия теста; при конфликте (включая внешнюю смену
  статуса) пользователь выбирает обновить данные или сохранить поверх.
- [ ] При закрытии Drawer с несохранёнными изменениями показывается confirmation dialog;
  при блокирующих ошибках кнопка "Сохранить" disabled.
- [ ] В footer нет постоянной кнопки "Сбросить всё"; отмена всех изменений выполняется через "Выйти без сохранения".
- [ ] Валидация комбинированная: локальная проверка полей, свободная навигация, блокировка сохранения только при `error`.
- [ ] Ошибки и warning отображаются на двух уровнях: у поля и в сводке секции с переходами к полям.
- [ ] Некорректные draw count, pass rules, adaptive ranges и links блокируются до API.
- [ ] Topic pass rule поддерживает `inherit_overall`, `custom`, `none`.
- [ ] Тема поддерживает собственный time limit или наследование общего лимита теста.
- [ ] При одновременном лимите теста и темы runtime показывает подписанные таймеры "Тест" и "Тема";
  ближайшее ограничение получает визуальный приоритет.
- [ ] Feedback теста/темы/adaptive-уровня поддерживает ссылки и PDF-assets, которые попадают в SCORM.
- [ ] Telemetry включается отдельным параметром, независимо от webhook URL.
- [ ] В standard-режиме adaptive-секция скрыта.
- [ ] При отсутствии template/system element используется fallback из `default`, а "Структура" показывает warning.
- [ ] При смене `flowMode` default-структура пересобирается без удаления несовместимых пользовательских элементов.
- [ ] Backend create/update использует структурированную валидацию.
- [ ] Backend сохранение test + sections + adaptive settings атомарно.
- [ ] Карточка теста не показывает длинный ряд расширенных кнопок; действия сгруппированы.
- [ ] Оформление и content pages доступны из Drawer редактора; экспорт доступен как действие карточки или пункт меню действий.
- [ ] Drawer редактора соответствует wide-layout требованиям: desktop `min(1120px, calc(100vw - 48px))`,
  двухпанельные настройки от `960px`, selector секции ниже `960px`.
- [ ] Удаление теста доступно только через меню действий и требует ввода точного названия теста.
- [ ] Архивные тесты скрыты из общего списка и поиска, не доступны для назначения и видны только в разделе "Архив".
- [ ] Unit/component/API tests покрывают standard/adaptive create/edit.
- [ ] Wireframes согласованы до frontend-реализации.
- [ ] Create-режим открывается в том же wide Drawer, что и edit; modal wizard удалён из `TestsPage`.
- [ ] `TestEditorModel.basic` содержит `status: 'draft' | 'published' | 'archived'`;
  поле `published: boolean` отсутствует.
- [ ] `passRules.byTopic` не содержит поля `required`; `required` хранится только в `sections[]`.
- [ ] `TestEditorModel` не содержит `structure.startPageContent`;
  стартовая страница управляется через `content_pages` типа `intro`.
- [ ] `FeedbackContent` имеет поле `format: 'plain' | 'richText' | 'html'`;
  редактор feedback поддерживает базовое форматирование (bold, italic, ссылки, списки).
- [ ] Feedback без поля `format` при открытии legacy-теста трактуется как `format = 'plain'`.
- [ ] SQL-миграция переносит `tests.published` в `tests.status`; существующие тесты открываются корректно.
- [ ] `apiToEditorModel()` покрывает backward compat: legacy `published=true` → `status='published'`.
- [ ] Drawer открывается с данными менее чем за 1.5 с на тесте с 20 темами.
- [ ] Валидация полей debounced: повторный запуск не чаще раза за 300 мс при вводе.
- [ ] При открытии Drawer фокус переходит на первый интерактивный элемент.
- [ ] Индикаторы `изменено`/`warning`/`error` имеют `aria-label`.

---

## 11. Риски

| Риск | Митигация |
| --- | --- |
| Рефакторинг сломает существующее создание тестов | Пошаговый вынос мапперов и test coverage до изменения UI |
| Редактор станет слишком большим | Доменная декомпозиция секций и lazy loading тяжёлых блоков |
| Adaptive режим потеряет настройки при переключении | Черновик обоих режимов хранится в `TestEditorModel`, удаление только по подтверждению |
| Backend transaction потребует изменения storage API | Ввести сервисный слой, сохранив текущие endpoints |
| PRD-1 кнопки снова разрастутся на карточке | Зафиксировать правило: карточка показывает компактные actions, расширенные настройки живут в редакторе |
