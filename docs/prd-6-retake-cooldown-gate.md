# PRD-6: Ограничение повторного прохождения и retake gate

**Версия:** 1.0  
**Статус:** Backlog (queued, шаг 3 ROADMAP)  
**Дата актуализации:** 2026-05-26  
**Связанные документы:** [BRD](brd-scorm-enhancements.md),
[PRD-1](prd-1-templates-content-pages.md), [PRD-4](prd-4-course-flow-sections.md),
[Платформа SCORM-шаблонов](spec-template-platform.md)  
**Этап BRD:** BR-07, Этап 5  
**Зависимости:** стартовая/системная страница из PRD-1, отложенный старт попытки из
PRD-4, SCORM runtime

## Статус реализации (на 2026-05-26)

**Не начато**. Стоит в очереди шагом 3 по [ROADMAP](ROADMAP.md). Блокируется PRD-4
(граница «внутреннего старта попытки», отложенный SCORM `Initialize`). Без PRD-4
возможно только flag-only без реального gate-runtime.

---

## 1. Обзор

### 1.1 Контекст

Для части курсов требуется запретить повторное прохождение ранее чем через заданное количество
дней после последней полноценной попытки. В WebTutor стандартный `suspend_data` сохраняется для
восстановления состояния внутри попытки, но не является надёжным источником между новыми попытками.
При этом WebTutor может отдавать записи курса через внутренние endpoint'ы, где видны даты
использования, прогресс и статус.

PRD-6 вводит `retakePolicy` и ранний `retake gate`: проверку допуска до внутреннего старта курса,
до вызова SCORM `Initialize` и до записи `cmi.*`.

### 1.2 Цель

Добавить управляемое ограничение повторного прохождения:

1. задать период охлаждения в календарных днях в настройках теста;
2. проверить дату последней полноценной попытки до старта SCORM-сессии;
3. показать `block-wall`, если повторное прохождение ещё запрещено;
4. не создавать признаки полноценной попытки при заблокированном запуске;
5. вынести WebTutor-specific логику в администрируемый plugin, который можно быстро править без
   изменения общего Core;
6. сохранить старое поведение для тестов без `retakePolicy`.

### 1.3 Метрики успеха

| Цель | Метрика |
| --- | --- |
| Cooldown применяется | 100% тестов с включённой политикой блокируют старт до `availableDate` |
| Заблокированный запуск не становится попыткой | В blocked-сценарии SCORM `Initialize` не вызывается и `cmi.*` не пишется |
| Провайдер поддерживаем | Администратор может изменить endpoint'ы, параметры и фильтр без релиза Core |
| Ошибки диагностируются | 100% ошибок gate пишутся в runtime diagnostics и доступны в тестовой проверке |

---

## 2. Пользователи

### 2.1 Автор теста

Включает ограничение повторного прохождения, задаёт период охлаждения и выбирает страницу
блокировки. Выбирает нужный eligibility plugin из набора доступных для конкретного теста. Не
редактирует JavaScript plugin.

### 2.2 Администратор / внедренец

Настраивает набор eligibility plugins: WebTutor cooldown, suspend_data cooldown, custom и другие.
Для каждого plugin может создать несколько конфигураций под разные типы курсов. Настраивает
endpoint'ы, параметры запроса, фильтр полноценной попытки, парсинг
даты и политику ошибки. Может выполнить тестовую проверку на выбранном курсе/пользователе.

### 2.3 Обучающийся

Если cooldown активен, видит страницу блокировки с датой доступного повторного прохождения. Если
прохождение разрешено, видит стартовую страницу и запускает попытку внутренней кнопкой **"Начать
курс"**.

### 2.4 Разработчик Core

Обеспечивает ранний bootstrap, отложенный SCORM `Initialize`, контракт eligibility plugin и диагностику.
Не зашивает WebTutor endpoint'ы в общий runtime.

---

## 3. Ключевые понятия

### 3.1 `retakePolicy`

Настройка теста, определяющая ограничение повторного прохождения.

```json
{
  "enabled": true,
  "cooldownPeriodDays": 30,
  "gateMode": "before_internal_start",
  "eligibilityPlugin": {
    "key": "webtutor_cooldown",
    "configId": "webtutor_catalog_default",
    "failPolicy": "failOpen"
  },
  "blockedPageId": "system.blocked",
  "startAttemptTrigger": "start_course_button"
}
```

Если `retakePolicy.enabled !== true` или `retakePolicy.eligibilityPlugin` не задан, Core работает
как раньше и считает `allowed = true`.

Разные тесты могут использовать разные eligibility plugins или разные конфигурации одного plugin.
Выбор plugin хранится в настройках конкретного теста, а не в глобальной настройке runtime.

### 3.2 Retake gate

Ранняя проверка допуска. В режиме `before_internal_start` она выполняется после загрузки SCO, но
до:

- показа активной кнопки **"Начать курс"**;
- вызова `API_1484_11.Initialize("")`;
- записи `cmi.completion_status`, `cmi.success_status`, `cmi.suspend_data`, `cmi.session_time`.

### 3.3 Полноценная попытка

Запись LMS, которая считается завершённым прохождением для целей cooldown. Для WebTutor это не факт
открытия курса, а строка, прошедшая настраиваемый фильтр.

Пример фильтра:

```json
{
  "stateIn": ["Завершен", "Завершён", "Пройден"],
  "progressCompletePattern": "^100\\b",
  "excludeStateIn": ["Не начат"],
  "dateField": "last_usage_date",
  "dateFormat": "dd.MM.yyyy"
}
```

Фильтр должен быть настраиваемым, потому что WebTutor может по-разному отображать статусы
`completed`, `passed`, `failed` и `unknown`.

### 3.4 Eligibility plugin

Eligibility plugin - явная функция допуска к старту попытки. Core не знает, как именно plugin
получает данные и считает ограничение. Core знает только контракт:

```ts
type EligibilityPlugin = {
  key: string;
  version: string;
  evaluate(context: EligibilityContext): Promise<boolean | EligibilityResult>;
};

type EligibilityResult = {
  allowed: boolean;
  reason?: string;
  source?: string;
  availableDate?: string | null;
  data?: Record<string, string | number | boolean | null>;
};
```

`availableDate` - нормализованная календарная дата, начиная с которой прохождение снова доступно
пользователю. Формат MVP: `YYYY-MM-DD` в timezone из `context.runtime.timezone`. Для cooldown plugin
это обязательное поле при `allowed = false`, если дату можно вычислить. Если plugin не может
вычислить дату, он возвращает `availableDate: null` и диагностическую причину в `reason`/`data`.

Если plugin возвращает `boolean`, Core нормализует его:

```json
{ "allowed": true }
```

Если plugin не определён, не найден или отключён на уровне теста, базовое решение Core:

```json
{ "allowed": true, "reason": "plugin_not_defined", "source": "core_default" }
```

Plugin получает минимальный контекст:

```json
{
  "test": {
    "id": "test-1",
    "title": "Нейрошлюз: осваиваем ИИ-инструменты"
  },
  "retakePolicy": {
    "cooldownPeriodDays": 30
  },
  "runtime": {
    "todayDate": "2026-05-08",
    "timezone": "Europe/Moscow",
    "launchUrl": "..."
  },
  "lms": {
    "scormVersion": "2004",
    "sessionId": "..."
  }
}
```

Core принимает решение только по `allowed`. `availableDate` и остальные поля используются для
`block-wall`, диагностики и предпросмотра. При `allowed = false` Core обязан нормализовать
`availableDate` в runtime state `retake.availableDate`; если plugin вернул только legacy
`data.nextAllowedDate`, Core может использовать его как fallback.

### 3.5 Plugin registry

Plugin registry - общий список доступных eligibility plugins. Каждый plugin имеет ключ, версию,
описание, схему конфигурации и набор сохранённых конфигураций. Тест выбирает один plugin и одну
конфигурацию.

Пример:

```json
[
  {
    "key": "webtutor_cooldown",
    "version": "1.0.0",
    "name": "WebTutor: период охлаждения",
    "configSchema": "webtutorCooldownConfig",
    "configs": [
      { "id": "webtutor_catalog_default", "name": "Основной каталог" },
      { "id": "webtutor_catalog_certification", "name": "Сертификации" }
    ]
  },
  {
    "key": "suspend_data_cooldown",
    "version": "1.0.0",
    "name": "SCORM suspend_data best-effort"
  },
  {
    "key": "custom",
    "version": "1.0.0",
    "name": "Пользовательский plugin"
  }
]
```

Если для теста plugin не выбран, registry не вызывается и Core возвращает `allowed = true`.

### 3.6 WebTutor cooldown plugin

Плагин `webtutor_cooldown` получает данные из WebTutor, выбирает последнюю полноценную попытку и
возвращает нормализованное решение:

```json
{
  "allowed": false,
  "reason": "cooldown_active",
  "source": "webtutor_cooldown",
  "availableDate": "2026-06-07",
  "data": {
    "lastAttemptDate": "2026-05-08",
    "todayDate": "2026-05-08",
    "nextAllowedDate": "2026-06-07",
    "cooldownPeriodDays": 30
  }
}
```

`data.nextAllowedDate` допускается как совместимый alias для старых шаблонов и диагностических
экранов. Новая интеграция должна читать `availableDate`.

---

## 4. Функциональные требования

### 4.1 Настройка политики в тесте

В настройках теста добавляется блок **"Повторное прохождение"**:

| Поле | Правила |
| --- | --- |
| `enabled` | Включает/выключает retake gate |
| `cooldownPeriodDays` | Целое число 1-3650 |
| `eligibilityPlugin.key` | `webtutor_cooldown`, `suspend_data_cooldown`, `custom` или пусто |
| `eligibilityPlugin.configId` | ID администрируемой конфигурации выбранного plugin |
| `eligibilityPlugin.failPolicy` | `failOpen` или `failClosed` |
| `gateMode` | MVP: `before_internal_start` |
| `blockedPageId` | Системная/контентная страница блокировки |
| `completionReportMode` | `scored` или `completed_neutral` |

Если `eligibilityPlugin.key` пустой, Core не выполняет проверку и возвращает `allowed = true`.
Это поведение обязательно для обратной совместимости и для тестов, где ограничение не настроено.

UI выбора plugin должен показывать только активные plugins из registry. После выбора plugin автор
или администратор выбирает одну из активных конфигураций этого plugin. Один тест может использовать
`webtutor_cooldown`, другой - `suspend_data_cooldown`, третий - не использовать plugin вообще.

WebTutor plugin получает дату последней попытки без времени. Поэтому Core не измеряет часы и не
пытается восстановить время прохождения. Решение принимается по календарным датам:

```text
allowed = (todayDate - lastAttemptDate) >= cooldownPeriodDays
```

UI должен показывать пример расчёта, чтобы администратор не считал дату вручную:

```text
Период охлаждения: 30 календарных дней
Последняя полноценная попытка: 08.05.2026
Повторное прохождение доступно с: 07.06.2026
```

Для совместимости импорт старого поля `cooldownDays` допускается, но при сохранении оно
нормализуется в `cooldownPeriodDays`.

`completionReportMode` определяет, как Core завершает полноценную попытку:

| Режим | SCORM запись при завершении |
| --- | --- |
| `scored` | `completion_status=completed`, `success_status=passed/failed`, score |
| `completed_neutral` | `completion_status=completed`, `success_status=unknown`, `progress_measure=1` |

`completed_neutral` нужен для LMS-конфигураций, где требуется получить нейтральный статус вроде
**"Завершен"**, а не **"Пройден"**/**"Не пройден"**. Core не пишет русские статусы напрямую:
финальное отображение выполняет WebTutor.

### 4.2 WebTutor cooldown plugin

MVP-plugin `webtutor_cooldown` должен поддерживать конфигурацию:

```json
{
  "id": "webtutor_catalog_default",
  "version": "1.0.0",
  "sessionIdSource": "url.search.session_id",
  "structureEndpoint": "/oapi/course_player_library/GetCourseLearningStructure",
  "secidSource": {
    "endpoint": "/",
    "pattern": "[A-F0-9]{32}"
  },
  "collectionEndpoint": "/pp/Ext5/extjs_json_collection_data.html",
  "collectionCode": "rostelecom_catalog_data_grid",
  "parametersTemplate": "cur_person_id={{personId}};sSearchWord=;sRoles=all;iCount=;sCatalogName=learning",
  "courseSearchName": "{{test.title}}",
  "limit": 500,
  "attemptFilter": {
    "stateIn": ["Завершен", "Завершён", "Пройден"],
    "progressCompletePattern": "^100\\b",
    "dateField": "last_usage_date",
    "dateFormat": "dd.MM.yyyy"
  }
}
```

Требования:

- endpoint'ы и шаблоны параметров не зашиваются в Core;
- конфигурация хранится отдельно от общего runtime и имеет версию;
- администратор может изменить конфигурацию без изменения кода Core;
- plugin использует `credentials: include`;
- plugin не сохраняет персональные данные в `TEST_DATA`;
- plugin возвращает сырые диагностические данные только в debug-режиме.

### 4.3 Runtime-последовательность

В тесте с включённым `retakePolicy`:

1. SCO загружает минимальный bootstrap.
2. Bootstrap загружает `TEST_DATA` и настройки `retakePolicy`.
3. Core показывает состояние проверки или нейтральную стартовую оболочку без активной кнопки
   **"Начать курс"**.
4. Если `eligibilityPlugin` не задан, Core устанавливает `allowed = true`.
5. Если `eligibilityPlugin` задан, Core вызывает `evaluate(context)` и нормализует результат до
   `{ allowed: boolean, reason, source, data }`.
6. Plugin `webtutor_cooldown` получает записи курса, выбирает последнюю полноценную попытку и
   рассчитывает решение по календарным датам:

```text
availableDate = lastAttemptDate + cooldownPeriodDays
allowed = (todayDate - lastAttemptDate) >= cooldownPeriodDays
blocked = !allowed
```

7. Если `allowed = false`, Core показывает `blockedPageId`, передаёт туда `availableDate` и не
   запускает SCORM.
8. Если `allowed = true`, Core показывает стартовую страницу с активной кнопкой **"Начать курс"**.
9. Только после клика **"Начать курс"** Core вызывает SCORM `Initialize` и начинает обычный flow.

Для тестов без `retakePolicy` старое поведение старта сохраняется.

### 4.4 Страница блокировки

Страница блокировки может быть системной страницей шаблона или контентной страницей теста.

Макету доступны переменные:

```text
retake.allowed
retake.blocked
retake.lastAttemptDate
retake.todayDate
retake.availableDate
retake.nextAllowedDate
retake.cooldownPeriodDays
retake.reason
retake.source
```

`retake.availableDate` - каноническое поле для UI. `retake.nextAllowedDate` остаётся alias для
совместимости и должен заполняться тем же значением, если plugin вернул `availableDate`.

Минимальный текст страницы должен объяснять:

- что повторное прохождение временно недоступно;
- с какой даты доступен повторный запуск;
- что делать при ошибке доступа, если `failClosed`.

### 4.5 Ошибки plugin

Политики:

| `failPolicy` | Поведение |
| --- | --- |
| `failOpen` | Показать предупреждение в диагностике и вернуть `allowed = true` |
| `failClosed` | Показать страницу блокировки с причиной ошибки и вернуть `allowed = false` |

Ошибка plugin не должна приводить к белому экрану.

### 4.6 `suspend_data` как источник

Plugin `suspend_data_cooldown` допускается только как best-effort:

- для восстановления или ограничения внутри той же SCORM registration;
- для локальных/тестовых сценариев;
- не как строгий источник последней попытки между retake-запусками.

UI должен предупреждать администратора, что строгий cooldown между новыми попытками требует
WebTutor/LMS-specific или внешнего источника.

### 4.7 Тестовая проверка plugin

В административном UI доступно действие **"Проверить plugin"**:

1. администратор выбирает тест/курс и пользователя или запускает проверку из предпросмотра;
2. система выполняет `eligibilityPlugin.evaluate(context)` с текущей конфигурацией;
3. показывает найденные записи, применённый фильтр, выбранную последнюю полноценную попытку,
   `availableDate`, совместимый alias `nextAllowedDate`, итоговое решение `allowed`;
4. показывает ошибки endpoint'ов, парсинга даты, фильтра и нормализации результата.

---

## 5. Модель данных

### 5.1 `tests.retake_policy_json`

```json
{
  "enabled": true,
  "cooldownPeriodDays": 30,
  "gateMode": "before_internal_start",
  "eligibilityPlugin": {
    "key": "webtutor_cooldown",
    "configId": "webtutor_catalog_default",
    "failPolicy": "failOpen"
  },
  "blockedPageId": "system.blocked",
  "completionReportMode": "completed_neutral"
}
```

### 5.2 `eligibility_plugins`

Реестр доступных plugins:

```text
key
name
version
description
is_active
config_schema_json
runtime_entry
created_at
updated_at
```

`runtime_entry` указывает, какой runtime-адаптер попадёт в SCORM ZIP или будет доступен Core.
Неактивные plugins нельзя выбрать для новых тестов, но существующие тесты должны показывать
предупреждение, а не терять настройку.

### 5.3 `eligibility_plugin_configs`

Рекомендуемая сущность:

```text
id
plugin_key
name
version
is_active
config_json
created_at
updated_at
updated_by
```

`config_json` содержит endpoint'ы, параметры, фильтр попыток и правила парсинга даты.
Один plugin может иметь несколько активных конфигураций. Тест хранит ссылку на конкретную
конфигурацию через `tests.retake_policy_json.eligibilityPlugin.configId`.

### 5.4 Runtime state

Результат проверки хранится в runtime memory и diagnostic state. В `suspend_data` он может
дублироваться только для диагностики и восстановления страницы блокировки, но не является
источником истины для следующей попытки.

```json
{
  "retake": {
    "checked": true,
    "allowed": false,
    "lastAttemptDate": "2026-05-08",
    "todayDate": "2026-05-08",
    "availableDate": "2026-06-07",
    "nextAllowedDate": "2026-06-07",
    "cooldownPeriodDays": 30,
    "source": "webtutor_cooldown",
    "reason": "cooldown_active"
  }
}
```

---

## 6. API

### 6.1 Настройки теста

```text
GET /api/tests/:id/retake-policy
PUT /api/tests/:id/retake-policy
POST /api/tests/:id/retake-policy/validate
```

### 6.2 Реестр plugins и конфигурации

```text
GET /api/admin/eligibility-plugins
GET /api/admin/eligibility-plugins/:pluginKey
GET /api/admin/eligibility-plugins/:pluginKey/configs
POST /api/admin/eligibility-plugins/:pluginKey/configs
GET /api/admin/eligibility-plugin-configs/:configId
PUT /api/admin/eligibility-plugin-configs/:configId
POST /api/admin/eligibility-plugin-configs/:configId/test
```

Для UI автора нужен read-only список активных plugins и конфигураций:

```text
GET /api/tests/:id/available-eligibility-plugins
```

В MVP runtime-plugin WebTutor может выполняться в браузере SCO, потому что использует текущую
WebTutor-сессию и same-origin cookies. Серверный test endpoint нужен для валидации конфигурации и
административной диагностики, если окружение позволяет выполнить запрос.

---

## 7. UI

### 7.1 UI автора

В настройках теста:

- переключатель **"Ограничить повторное прохождение"**;
- поле **"Период охлаждения, календарных дней"**;
- выбор eligibility plugin из активного registry;
- выбор конфигурации выбранного plugin;
- автоматический предпросмотр даты следующего доступного прохождения;
- выбор страницы блокировки;
- выбор режима завершения попытки: `scored` / `completed_neutral`;
- предупреждение, если выбран `suspend_data_cooldown`;
- readonly-информация о выбранном plugin и версии его конфигурации.

### 7.2 UI администратора

В административном разделе:

- список eligibility plugins;
- список конфигураций выбранного plugin;
- версия и статус конфигурации;
- редактор endpoint'ов и параметров;
- редактор фильтра полноценной попытки;
- тестовая проверка;
- история последних ошибок проверки.

Редактор plugin config должен быть рассчитан на оперативную правку внедренцем: изменение endpoint'а,
регулярного выражения, имени поля даты или списка статусов не должно требовать релиза Core.

---

## 8. Совместимость и миграция

- Тесты без `retakePolicy` не меняют поведение.
- Тесты с `retakePolicy`, но без `eligibilityPlugin.key`, получают `allowed = true`.
- Если `retakePolicy.enabled = false`, экспорт может включать настройки, но runtime их игнорирует.
- Старые попытки читаются только через выбранный plugin; миграция `suspend_data` не требуется.
- Если WebTutor отдаёт несколько записей одного курса, plugin сортирует только записи,
  прошедшие фильтр полноценной попытки.
- Если WebTutor отдаёт только агрегированную запись, UI администратора должен показать
  предупреждение о сниженной надёжности cooldown.

---

## 9. Нефункциональные требования

| ID | Требование |
| --- | --- |
| NFR-01 | Retake gate не вызывает SCORM `Initialize` до разрешения старта и клика **"Начать курс"** |
| NFR-02 | Заблокированный запуск не пишет `cmi.*` |
| NFR-03 | WebTutor endpoint'ы и фильтры попыток конфигурируются вне Core |
| NFR-04 | Runtime не падает при ошибке plugin; применяется `failPolicy` |
| NFR-05 | Диагностика содержит plugin key, config id, версию, итоговое решение, причину и техническую ошибку без лишних персональных данных |
| NFR-06 | Проверка допуска завершается за 5 секунд P95; при превышении таймаута применяется `failPolicy` |
| NFR-07 | Внешние URL для runtime-plugin запрещены, если они не разрешены отдельной политикой безопасности |
| NFR-08 | Разные тесты могут ссылаться на разные eligibility plugins и разные конфигурации одного plugin |

---

## 10. Критерии приёмки

- [ ] Автор может включить `retakePolicy` и задать период охлаждения в календарных днях.
- [ ] Автор может выбрать eligibility plugin из активного registry.
- [ ] Два разных теста могут использовать разные plugins или разные конфигурации одного plugin.
- [ ] Если plugin не выбран, Core возвращает `allowed = true`.
- [ ] UI показывает дату следующего доступного прохождения без ручного расчёта.
- [ ] В тесте без `retakePolicy` старт и SCORM lifecycle остаются прежними.
- [ ] В gated-тесте SCORM `Initialize` вызывается только после разрешения gate и клика **"Начать курс"**.
- [ ] При активном cooldown показывается `block-wall`.
- [ ] В blocked-сценарии `cmi.completion_status`, `cmi.success_status`, `cmi.suspend_data` и `cmi.session_time` не записываются.
- [ ] WebTutor plugin получает список записей курса и выбирает последнюю полноценную попытку по конфигурируемому фильтру.
- [ ] Plugin возвращает `availableDate` в результате проверки, если `allowed = false` и дату можно вычислить.
- [ ] `availableDate` рассчитывается из даты последней полноценной попытки и `cooldownPeriodDays`.
- [ ] `nextAllowedDate` заполняется тем же значением как совместимый alias для старых шаблонов/диагностики.
- [ ] `failOpen` разрешает старт при ошибке plugin и пишет предупреждение.
- [ ] `failClosed` показывает блокировку при ошибке plugin.
- [ ] Администратор может изменить endpoint, параметры, фильтр статусов, regex прогресса и поле даты без изменения Core.
- [ ] Тестовая проверка plugin показывает сырые записи, отфильтрованные записи, выбранную попытку и итоговое решение.
- [ ] `completed_neutral` пишет стандартные SCORM-значения `completed`/`unknown`, не русский статус напрямую.

---

## 11. Решённые вопросы

| Вопрос | Решение |
| --- | --- |
| Можно ли полагаться только на `suspend_data`? | Нет. Только best-effort внутри той же SCORM registration |
| Где выполнять gate? | До внутренней кнопки старта курса и до SCORM `Initialize` |
| Что происходит, если plugin не выбран? | Core не выполняет внешнюю проверку и возвращает `allowed = true` |
| Может ли каждый тест выбрать свой plugin? | Да. Выбор `eligibilityPlugin.key` и `configId` хранится в настройках конкретного теста |
| Можно ли получить статус "Завершен" прямой записью в SCORM? | Нет. Core пишет стандартные SCORM-статусы, WebTutor сам мапит их в UI-статус |
| Почему WebTutor-логику нельзя зашивать в Core? | Endpoint'ы и формат данных хрупкие и могут меняться без изменения продукта |
| Что считать полноценной попыткой? | Запись LMS, прошедшую конфигурируемый фильтр статуса/прогресса/даты |
