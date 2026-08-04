# PRD-6: Ограничение повторного прохождения и retake gate

**Версия:** 1.1  
**Статус:** ЗАКРЫТ 2026-07-05 (Phase 1 реализована 2026-06-04); администрируемый реестр
eligibility-плагинов (бывшая Phase 2) вынесен в [PRD-21](../prd-21/eligibility-plugin-registry.md)  
**Дата актуализации:** 2026-07-05  
**Связанные документы:** [BRD](../brd-scorm-enhancements.md),
[PRD-1](../prd-1/templates-content-pages.md), [PRD-4](../prd-4/course-flow-sections.md),
[Платформа SCORM-шаблонов](../spec-template-platform.md)  
**Этап BRD:** BR-07, Этап 5  
**Зависимости:** стартовая/системная страница из PRD-1, отложенный старт попытки из
PRD-4, SCORM runtime

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

В PRD-6 реестр read-only и сидируется в коде (одна активная конфигурация на plugin).
Администрируемое редактирование реестра/конфигураций, выбор из >= 2 конфигураций в UI и тестовая
проверка плагина — в [PRD-21](../prd-21/eligibility-plugin-registry.md).

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
    "key": "custom",
    "version": "1.0.0",
    "name": "Пользовательский plugin"
  }
]
```

> Начиная с [PRD-40](../prd-40/cooldown-by-outcome.md) (2026-08-04) `suspend_data_cooldown` удалён
> из реестра: в проде им не пользовался ни один тест, и добавлять ему разделение кулдауна по
> исходу означало бы поддерживать код, которым никто не пользуется. `webtutor_cooldown` — теперь
> единственный сидированный плагин.

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
| `eligibilityPlugin.key` | `webtutor_cooldown`, `custom` или пусто |
| `eligibilityPlugin.configId` | ID администрируемой конфигурации выбранного plugin |
| `eligibilityPlugin.failPolicy` | `failOpen` или `failClosed` |
| `gateMode` | MVP: `before_internal_start` |
| `blockedPageId` | Системная/контентная страница блокировки |

Если `eligibilityPlugin.key` пустой, Core не выполняет проверку и возвращает `allowed = true`.
Это поведение обязательно для обратной совместимости и для тестов, где ограничение не настроено.

UI выбора plugin должен показывать только активные plugins из registry. После выбора plugin автор
или администратор выбирает одну из активных конфигураций этого plugin. Один тест может использовать
`webtutor_cooldown`, другой - не использовать plugin вообще.

WebTutor plugin получает дату последней попытки без времени. Поэтому Core не измеряет часы и не
пытается восстановить время прохождения. Решение принимается по календарным датам:

```text
allowed = (todayDate - lastAttemptDate) >= cooldownPeriodDays
```

Эта формула — рантайм-правило гейта. Авторский UI не показывает превью даты следующего
доступа: «дата последней попытки» — это значение на конкретного учащегося, которое гейт
получает из WebTutor перед стартом курса, и на этапе настройки теста его не существует.
Поэтому автор задаёт только `cooldownPeriodDays`, а `availableDate` вычисляется в рантайме.

Для совместимости импорт старого поля `cooldownDays` допускается, но при сохранении оно
нормализуется в `cooldownPeriodDays`.

Завершение полноценной попытки всегда репортится как `scored`
(`completion_status=completed`, `success_status=passed/failed`, score): это конструктор
**тестов**, тест обязан оставлять вердикт о прохождении. Нейтральный режим завершения
(`completed_neutral`) исключён из scope — он относится к информационным модулям без оценки,
не к ретейк-гейту, и к тому же обнуляет cooldown (WebTutor не ставит отметку «Пройден», по
которой работает гейт §4.2).

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

Порядок шагов 7-9 уточнён поправкой §9.1: чтобы отличить новое назначение от повторного входа по текущему,
Core открывает сессию и читает `suspend_data` ДО вынесения вердикта, а при блокировке немедленно закрывает её
`Terminate`, не записав ни одного `cmi.*`.

### 4.4 Страница блокировки

Страница блокировки может быть системной страницей шаблона или контентной страницей теста.

Макету доступны переменные:

```text
retake.allowed
retake.blocked
retake.lastAttemptDate
retake.todayDate
retake.effectiveToday
retake.availableDate
retake.nextAllowedDate
retake.cooldownPeriodDays
retake.reason
retake.source
```

`retake.availableDate` - каноническое поле для UI. `retake.nextAllowedDate` остаётся alias для
совместимости и должен заполняться тем же значением, если plugin вернул `availableDate`.

`retake.effectiveToday` - нормализованное «сегодня», от которого считаются производные величины
(`availableDate`, обратный отсчёт); равно `todayDate`, если часы не пришлось нормализовать.

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

### 4.6 `suspend_data` как источник (удалено)

Плагин `suspend_data_cooldown`, ранее описанный здесь как best-effort источник даты внутри одной
SCORM registration, удалён [PRD-40](../prd-40/cooldown-by-outcome.md) (2026-08-04) — в проде им не
пользовался ни один тест. Best-effort различение внутри одной регистрации по-прежнему покрыто
`alreadyPlayedThisRegistration` (§9.1) — оно не зависело от этого плагина.

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
  "blockedPageId": "system.blocked"
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
    "effectiveToday": "2026-05-08",
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
- выбор страницы блокировки;
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
| NFR-01 | Заблокированный запуск не становится полноценной попыткой. Формулировка уточнена 2026-08-01, см. §9.1 |
| NFR-02 | Заблокированный запуск не пишет `cmi.*` |
| NFR-03 | WebTutor endpoint'ы и фильтры попыток конфигурируются вне Core |
| NFR-04 | Runtime не падает при ошибке plugin; применяется `failPolicy` |
| NFR-05 | Диагностика содержит plugin key, config id, версию, итоговое решение, причину и техническую ошибку без лишних персональных данных |
| NFR-06 | Проверка допуска завершается за 5 секунд P95; при превышении таймаута применяется `failPolicy` |
| NFR-07 | Внешние URL для runtime-plugin запрещены, если они не разрешены отдельной политикой безопасности |
| NFR-08 | Разные тесты могут ссылаться на разные eligibility plugins и разные конфигурации одного plugin |

### 9.1 Поправка NFR-01 от 2026-08-01 (PRD-31)

Исходная формулировка требовала, чтобы gate не вызывал `Initialize` до разрешения старта. Она оказалась
не реализуемой вместе с [PRD-31](../prd-31/attempt-interval.md): до `Initialize` пакет не может прочитать
`suspend_data` (`GetValue` в этом состоянии возвращает ошибку 122), а без него он не отличает первый вход по
новому назначению от повторного входа по текущему. Подтверждено пробниками 2026-07-16 и 2026-08-01: связки
«запуск -> запись грида» на портале нет, а запись становится завершённой сразу после первой попытки, поэтому
gate блокировал повторный вход в собственное назначение с неисчерпанными попытками.

Новая формулировка сохраняет смысл требования, но задаёт его через результат, а не через порядок вызовов:

- заблокированный запуск не пишет ни один `cmi.*` (это по-прежнему NFR-02);
- сессия, открытая ради чтения `suspend_data`, немедленно закрывается `Terminate`;
- полноценной попыткой такой запуск не становится: фильтр §3.3 считает только записи в состоянии
  «Пройден»/«Не пройден», которые пара `Initialize`/`Terminate` без записей не создаёт.

Осознанное следствие: при заблокированном входе статус записи в портале может сместиться в «Начат». На отбор
полноценных попыток это не влияет.

---

## 10. Критерии приёмки

Phase 1 (реализовано):

- [x] Автор может включить `retakePolicy` и задать период охлаждения в календарных днях.
- [x] Автор может выбрать eligibility plugin из активного registry.
- [x] Два разных теста могут использовать разные plugins (одна активная конфигурация на plugin
      в Phase 1).
- [x] Если plugin не выбран, Core возвращает `allowed = true`.
- [x] В тесте без `retakePolicy` старт и SCORM lifecycle остаются прежними (FR-02, byte-identical export).
- [x] В тесте без включённого ограничения рантайм cooldown-плагина (`EligibilityEngine`,
      `EligibilityPlugins`, `RetakeGate`) в пакет не запекается: он собирается только при
      `retakePolicy.enabled` с разрешённым plugin — том же условии, при котором в `TEST_DATA`
      попадают `retakePolicy` и `retakePlugin`.
- [x] В gated-тесте SCORM `Initialize` вызывается только после разрешения gate и клика **"Начать курс"** (NFR-01).
      Пункт отражает приёмку Phase 1; с 2026-08-01 требование действует в редакции §9.1.
- [x] При активном cooldown показывается `block-wall` (системная страница шаблона `system.blocked`).
- [x] В blocked-сценарии `cmi.completion_status`, `cmi.success_status`, `cmi.suspend_data`
      и `cmi.session_time` не записываются (NFR-02).
- [x] WebTutor plugin получает дату прохождения курса через ClientBridge `get_metadata`
      и применяет cooldown.
- [x] Plugin возвращает `availableDate` в результате проверки, если `allowed = false` и дату можно вычислить.
- [x] `availableDate` рассчитывается из даты последней полноценной попытки и `cooldownPeriodDays`.
- [x] `nextAllowedDate` заполняется тем же значением как совместимый alias для старых шаблонов/диагностики.
- [x] `failOpen` разрешает старт при ошибке plugin и пишет предупреждение.
- [x] `failClosed` показывает блокировку при ошибке plugin.

Администрируемый реестр (бывшая Phase 2) вынесен в отдельный
[PRD-21 «Администрируемый реестр eligibility-плагинов»](../prd-21/eligibility-plugin-registry.md):
редактирование endpoint'ов/параметров/фильтров без изменения Core, выбор из >= 2 конфигураций в UI,
тестовая проверка плагина. В PRD-6 реестр read-only и сидируется в коде; рантайм cooldown этим
не ограничен.

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
| Остаётся ли `suspend_data_cooldown` после PRD-40? | Нет, удалён целиком (реестр, рантайм, панель автора) — не использовался ни одним тестом в проде |
