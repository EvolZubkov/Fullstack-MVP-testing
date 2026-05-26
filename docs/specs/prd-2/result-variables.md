# PRD-2: Пользовательские показатели результата

**Версия:** 2.0  
**Статус:** Backlog (queued, шаг 5 ROADMAP)  
**Дата актуализации:** 2026-05-26  
**Связанные документы:** [BRD](../brd-scorm-enhancements.md),
[PRD-1](../prd-1/templates-content-pages.md),
[Платформа SCORM-шаблонов](../spec-template-platform.md)  
**Этап BRD:** BR-04  
**Зависимость:** результаты Core и runtime шаблона из PRD-1

## Статус реализации (на 2026-05-26)

**Не начато**. Стоит в очереди шагом 5 по [ROADMAP](../../ROADMAP.md). Блокируется PRD-4
(`section.*` namespace) — формулы `result_variables` должны иметь доступ к section-результатам.

---

## 1. Обзор

### 1.1 Контекст

После внедрения шаблонной платформы SCORM-пакет имеет общий runtime, поток страниц, макет
результатов и переменные с пространствами имён. PRD-2 добавляет пользовательские показатели результата:
вычисляемые значения, которые автор задаёт через UI, обучающийся видит на странице результатов,
а LMS получает как машиночитаемые данные.

Показатели остаются отдельной сущностью, но после расчёта публикуются в пространстве имён `result.*`.
Правила курса могут использовать их после события `result:calculated`.

### 1.2 Типовые сценарии

- компетентностные статусы по темам;
- многошкальные опросники по тегам вопросов;
- флаги допуска к сертификации;
- уровни `Expert / Advanced / Beginner`;
- итоговые категории по комбинации нескольких шкал.

### 1.3 Метрики успеха

| Цель | Метрика |
| --- | --- |
| Авторы используют показатели | Доля тестов с пользовательскими показателями >= 20% через 3 месяца |
| LMS получает пользовательские данные | >= 70% завершений тестов с переменными имеют непустой `custom` в `suspend_data` |
| Ошибки формул диагностируются | 100% ошибок формул во время выполнения попадают в диагностику |

---

## 2. Пользователи

### 2.1 Автор теста

Создаёт показатели через визуальный конструктор. Для сложных кейсов использует расширенный DSL
с inline-валидацией.

### 2.2 Разработчик шаблона

Не обязан знать формулы. Макет результатов получает готовые значения через публичный контекст
и/или контролируемый слот `data-slot="result-variables"`.

---

## 3. Функциональные требования

### 3.1 Пользовательский сценарий автора

1. Автор открывает тест и переходит на вкладку **"Показатели"**.
2. Нажимает **"Добавить показатель"**.
3. Заполняет `name`, `label`, `type`, `formula`.
4. Выбирает, показывать ли показатель обучающемуся.
5. Выбирает, куда передавать показатель в LMS.
6. Сохраняет.
7. При экспорте показатели включаются в TEST_DATA.
8. В SCORM runtime показатели вычисляются после стандартной оценки.

### 3.2 Сценарий обучающегося

1. Обучающийся завершает тест.
2. Core рассчитывает стандартный результат.
3. Core рассчитывает пользовательские показатели в порядке `sort_order`.
4. Значения публикуются в `result.*`.
5. Макет результатов отображает показатели, у которых `show_to_learner = true`.
6. Core передаёт значения в LMS согласно `scorm_target`.

### 3.3 Список показателей

Карточка показателя показывает:

- `name`;
- `label`;
- `type`;
- формулу;
- `show_to_learner`;
- `scorm_target`;
- публикацию в пространстве имён `result.{name}`;
- порядок вычисления.

Порядок важен для ссылок `var()`. Drag-and-drop меняет `sort_order`.

### 3.4 Поля показателя

| Поле | Тип | Правила |
| --- | --- | --- |
| `name` | text | `^[a-z][a-z0-9_]{0,63}$`, уникально в тесте |
| `label` | text | До 120 символов |
| `type` | select | `boolean`, `number`, `string` |
| `formula` | builder/DSL | Синтаксически валидна |
| `show_to_learner` | boolean | По умолчанию `false` |
| `scorm_target` | select | `none`, `interaction`, `suspend_data`, `both` |
| `sort_order` | integer | Порядок вычисления |

После вычисления переменная `name = "competency_tech"` публикуется как:

```text
result.competency_tech
```

---

## 4. Конструктор формул

### 4.1 Типы формул MVP

| Тип | Генерируемая формула |
| --- | --- |
| Результат темы | `topicById("topic-id").percent >= 70` |
| Общий результат | `percent >= 75` |
| Уровень | `IF(percent >= 90, "Expert", IF(percent >= 70, "Advanced", "Beginner"))` |
| Агрегат по темам | `countPassed() = countTopics()` |
| Агрегат по тегу | `tag("scale:EE").score` |
| Ссылка на переменную | `var("ee_score")` |
| Взвешенная сумма | `topicById("t1").percent * 0.4 + topicById("t2").percent * 0.6` |

Рекомендация: UI показывает названия тем, но формулы сохраняют ссылки по `topicId`, чтобы
переименование темы не ломало показатель.

### 4.2 Расширенный DSL

DSL остаётся ограниченным и не использует `eval()` / `Function()`.

Поддерживаемые источники:

```text
percent
topicById("id").percent
topicById("id").passed
topicById("id").score
tag("name").percent
tag("name").score
tag("name").maxScore
tag("name").count
var("name")
countPassed()
countTopics()
avgPercent()
countVars(["a","b"], "high")
```

Поддерживаемые операции:

```text
IF(cond, a, b)
AND / OR / NOT
= / != / > / >= / < / <=
+ / - / * / /
()
number
string
true / false
```

Приоритет:

```text
NOT
* /
+ -
comparisons
AND
OR
```

### 4.3 Валидация формулы

Сервер валидирует при сохранении:

- синтаксис;
- соответствие возвращаемого значения `type`;
- ссылки `topicById`;
- `var()` только на переменные с меньшим `sort_order`;
- деление на ноль как безопасный runtime-кейс;
- неизвестные теги как предупреждение, а не блокирующую ошибку.

Inline-валидация выполняется через debounce 400 мс.

---

## 5. Runtime-вычисление

### 5.1 Последовательность

1. Core выполняет стандартный `calculateResults()`.
2. Core строит результаты по темам.
3. Core строит результаты по тегам на основе вопросов и ответов.
4. Core вычисляет пользовательские показатели в порядке `sort_order`.
5. Значения сохраняются в `computedVars`.
6. Каждое значение публикуется в пространстве имён `result.{name}`.
7. Core запускает событие `result:calculated`.
8. Правила курса могут использовать `result.*`.
9. Макет результатов получает публичный контекст с результатами.
10. Core передаёт пользовательские данные в SCORM через поддерживаемую зону ответственности Core.

### 5.2 Ошибки вычисления

Если формула падает в runtime:

- значение переменной становится `null`;
- ошибка добавляется в `formulaErrors`;
- завершение теста и запись стандартных результатов в LMS не прерываются;
- ошибка пишется в диагностику.

Каналы диагностики:

- `console.warn`;
- `suspend_data.custom.formulaErrors`;
- опциональный pseudo-interaction `formula_error_{name}`;
- telemetry finish payload, если telemetry включена.

---

## 6. Отображение в шаблоне

Макет результатов может показывать показатели двумя способами:

1. Через подготовленный публичный контекст, например как экранированные значения.
2. Через контролируемый слот:

```html
<div data-slot="result-variables"></div>
```

Core вставляет туда стандартный блок показателей. Шаблон управляет окружением и стилями.

Форматирование значений:

| Тип | Отображение |
| --- | --- |
| `string` | как есть, с экранированием |
| `number` | до 2 знаков после запятой |
| `boolean` | `Да` / `Нет` |
| `null` | `Не рассчитано` |

---

## 7. Передача в LMS

### 7.1 `suspend_data`

Для `scorm_target = "suspend_data"` или `"both"` Core добавляет:

```json
{
  "custom": {
    "result": {
      "competency_tech": "Освоено",
      "cert_eligible": false,
      "composite_score": 74.5
    },
    "formulaErrors": []
  }
}
```

Пространство имён `result` в `custom` соответствует runtime-пространству `result.*`.

### 7.2 `interactions`

Для `scorm_target = "interaction"` или `"both"` Core создаёт pseudo-interaction:

```text
cmi.interactions[n].id               = "var_{name}"
cmi.interactions[n].type             = "other"
cmi.interactions[n].description      = {label}
cmi.interactions[n].learner_response = {value as string}
cmi.interactions[n].result           = "neutral"
```

`neutral` используется, чтобы пользовательские показатели не искажали отчёты по правильности.
Если конкретная LMS не поддерживает `neutral`, Core использует совместимый резервный вариант согласно
политике SCORM-адаптера.

### 7.3 Зона ответственности SCORM

Пользовательские показатели не пишут в LMS напрямую. Запись выполняет Core, чтобы избежать
конфликтов с интерактивами вопросов, правилами курса и `template.js`.

---

## 8. Модель данных

### 8.1 `result_variables`

```sql
CREATE TABLE result_variables (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id         uuid NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]*$'),
  label           text NOT NULL,
  type            text NOT NULL CHECK (type IN ('boolean', 'number', 'string')),
  formula         text NOT NULL,
  show_to_learner boolean NOT NULL DEFAULT false,
  scorm_target    text NOT NULL DEFAULT 'both'
                    CHECK (scorm_target IN ('interaction', 'suspend_data', 'both', 'none')),
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now(),
  UNIQUE (test_id, name)
);

CREATE INDEX result_variables_test_id_idx ON result_variables(test_id);
```

### 8.2 `questions.tags`

```sql
ALTER TABLE questions ADD COLUMN tags jsonb NOT NULL DEFAULT '[]';
```

Теги редактируются в карточке вопроса через chip input.

---

## 9. API

```text
GET /api/tests/:id/result-variables
POST /api/tests/:id/result-variables
PUT /api/tests/:id/result-variables/:varId
DELETE /api/tests/:id/result-variables/:varId
PUT /api/tests/:id/result-variables/reorder
POST /api/tests/:id/result-variables/validate-formula
```

`validate-formula` возвращает:

```json
{ "valid": true }
```

или:

```json
{
  "valid": false,
  "error": "Unexpected token",
  "position": 42
}
```

---

## 10. UI автора

Вкладка **"Показатели"** содержит:

- список показателей;
- drag-and-drop порядок;
- кнопки создать/редактировать/удалить;
- визуальный конструктор формул;
- расширенный DSL-редактор;
- readonly/debug предпросмотр результата на демонстрационной попытке;
- предупреждения о зависимостях `var()`.

Расширенный DSL не даёт выполнять JavaScript.

---

## 11. Нефункциональные требования

| ID | Требование |
| --- | --- |
| NFR-01 | DSL parser не использует `eval()` / `Function()` |
| NFR-02 | Серверная валидация формулы <= 100 мс на типовой формуле |
| NFR-03 | Inline validation debounce 400 мс |
| NFR-04 | Ошибка runtime-формулы не прерывает SCORM finish |
| NFR-05 | `result.*` сохраняется только после расчёта результата |
| NFR-06 | Запись в LMS выполняется только через зону ответственности Core по SCORM |
| NFR-07 | Значения в макете результатов экранируются или вставляются через контролируемые слоты |

---

## 12. Критерии приёмки

- [ ] Автор создаёт string-переменную через конструктор "Уровень"
- [ ] Расширенный DSL с ошибкой показывает inline-валидацию и блокирует сохранение
- [ ] `topicById("id").percent` не ломается после переименования темы
- [ ] `tag("scale:EE").score` считает сумму баллов по тегу
- [ ] `var("ee_score")` работает только для переменной выше по `sort_order`
- [ ] Runtime вычисляет переменные и публикует их в `result.*`
- [ ] `result:calculated` запускается после публикации `result.*`
- [ ] Макет результатов показывает только `show_to_learner = true`
- [ ] `scorm_target = "suspend_data"` добавляет данные в `custom.result`
- [ ] `scorm_target = "interaction"` добавляет pseudo-interaction `var_{name}`
- [ ] Ошибка формулы даёт `null`, сохраняет стандартный результат и пишет диагностику
- [ ] Сценарий MBI с score/zone/category вычисляется корректно

---

## 13. Решённые вопросы

| Вопрос | Решение |
| --- | --- |
| Пользовательские показатели объединяются с правилами курса? | Нет, остаются отдельной сущностью |
| Как правила курса получают результат? | Через публикацию значений в `result.*` после `result:calculated` |
| Где отображаются показатели? | В макете результатов, публичном контексте или контролируемом слоте |
| Кто пишет в LMS? | Core, не шаблон и не формула напрямую |
| Что делать с ошибками формулы? | `null` + диагностика, без срыва завершения |
