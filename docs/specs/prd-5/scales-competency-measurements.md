# PRD-5: Шкалы, компетенции и многомерные измерения результатов

**Версия:** 1.1  
**Статус:** Backlog — post-MVP (ROADMAP §0.2); парный трек с PRD-2  
**Дата актуализации:** 2026-05-29 (v1.1: добавлены `direction` инверсной шкалы,
раздел §8.3 «Совместимость с LMS-экспортом», пример MBI в §16)  
**Связанные документы:** [BRD](../brd-scorm-enhancements.md),
[PRD-2](../prd-2/result-variables.md), [PRD-4](../prd-4/course-flow-sections.md),
[Платформа SCORM-шаблонов](../spec-template-platform.md),
[Пример: MBI](./example-mbi.md)  
**Этап BRD:** BR-06, Этап 6  
**Зависимости:** стандартная оценка Core, результаты разделов из PRD-4,
пользовательские показатели из PRD-2

## Статус реализации (на 2026-05-29)

**Не начато**. Идёт парным треком с PRD-2 (см. [ROADMAP §0.2](../../ROADMAP.md)): расширение
DSL `result_variables` источниками `scaleById(...)` обязательно до начала реализации
PRD-5, иначе формулы итоговых категорий (например, MBI burnout category) не имеют доступа
к `scale.*`. Самая тяжёлая авторская UI; делается после стабилизации редактора и flow.

---

## 1. Обзор

### 1.1 Контекст

Текущая модель результата строится вокруг правильности ответа, баллов, результатов тем и
пользовательских показателей. Для корпоративных оценок этого недостаточно: один вопрос может быть
инструментом измерения одной шкалы или сразу нескольких компетенций. При этом измерительный вклад
не всегда равен правильности ответа.

PRD-5 вводит отдельную модель шкал и компетенций. Она рассчитывается Core, публикуется в
пространстве `scale.*`, может использоваться пользовательскими показателями `result.*` и
передаваться в LMS.

### 1.2 Цель

Добавить многомерные измерения:

1. создать сущности шкал/компетенций;
2. разрешить вопросу и варианту ответа давать вклад в одну или несколько шкал;
3. рассчитывать шкалы отдельно от стандартного балла;
4. публиковать значения в `scale.*`;
5. дать авторам UI для настройки и проверки вкладов;
6. сохранить совместимость старых тестов без шкал.

### 1.3 Метрики успеха

| Цель | Метрика |
| --- | --- |
| Авторы используют шкалы | Доля тестов с минимум одной шкалой >= 15% через 3 месяца |
| Ошибки настройки диагностируются | 100% невалидных measurement-правил блокируются при сохранении |
| Результаты доступны формулам | 100% рассчитанных шкал доступны в `scale.*` до расчёта `result.*` |
| Старые тесты совместимы | Тесты без шкал не меняют стандартный результат |

---

## 2. Пользователи

### 2.1 Автор теста

Создаёт шкалы, назначает вклад вопросов и вариантов ответа, проверяет расчёт на предпросмотре.

### 2.2 Методолог

Определяет компетенции, диапазоны интерпретации и правила агрегации.

### 2.3 Разработчик шаблона

Может отобразить готовые значения шкал через публичный контекст или стандартный слот. Не обязан
знать формулы расчёта.

---

## 3. Ключевые понятия

### 3.1 Шкала

Шкала или компетенция - измеряемая величина, которая получает вклад от вопросов.

Пример прямой (positive) шкалы:

```json
{
  "id": "leadership",
  "label": "Лидерство",
  "type": "number",
  "aggregation": "weighted_avg",
  "normalization": "percent",
  "direction": "positive",
  "bands": [
    { "min": 0, "max": 49, "label": "Низкий" },
    { "min": 50, "max": 79, "label": "Средний" },
    { "min": 80, "max": 100, "label": "Высокий" }
  ]
}
```

Пример инверсной (inverse) шкалы. Сценарий: «обесценивание достижений» в опроснике
выгорания MBI — высокий raw-балл означает низкий уровень обесценивания и низкий вклад
в выгорание (см. [example-mbi.md](./example-mbi.md)).

```json
{
  "id": "ad",
  "label": "Обесценивание достижений",
  "type": "number",
  "aggregation": "sum",
  "normalization": "percent",
  "direction": "inverse",
  "bands": [
    { "min": 0, "max": 27, "label": "Высокий", "level": "high" },
    { "min": 28, "max": 32, "label": "Средний", "level": "mid" },
    { "min": 33, "max": 40, "label": "Низкий", "level": "low" }
  ]
}
```

В обоих примерах `bands` применяются к `raw` буквально, в порядке возрастания
интервалов. Поле `direction` управляет только нормализацией `percent` и подсказками
авторского UI (направление шкалы, градиент, предупреждения о монотонности bands).

### 3.2 Измерительный вклад

Вклад описывает, как вопрос или конкретный ответ влияет на шкалу.

```json
{
  "scaleId": "leadership",
  "value": 2,
  "weight": 1,
  "condition": {
    "answerOptionId": "option-a"
  }
}
```

### 3.3 Разделение оценки и измерения

Правильность ответа и вклад в шкалы являются разными слоями.

| Тип вопроса | Стандартный балл | Шкалы |
| --- | --- | --- |
| Экзаменационный | Да | Нет или опционально |
| Измерительный | Нет | Да |
| Смешанный | Да | Да |

---

## 4. Функциональные требования

### 4.1 Создание шкал

Автор может создать шкалу:

| Поле | Правила |
| --- | --- |
| `key` | `^[a-z][a-z0-9_]{0,63}$`, уникально в тесте |
| `label` | До 120 символов |
| `description` | Необязательно |
| `type` | `number`, `boolean`, `category`, `level` |
| `aggregation` | `sum`, `avg`, `weighted_avg`, `max`, `min`, `threshold`, `formula` |
| `normalization` | `none`, `percent`, `z_score`, `custom` |
| `direction` | `positive`, `inverse`; по умолчанию `positive`. Влияет на формулу `percent` и подсказки UI; не меняет применение `bands` к `raw` |
| `show_to_learner` | По умолчанию `false` |
| `scorm_target` | `none`, `suspend_data`, `interaction`, `both` |

### 4.2 Настройка вкладов вопроса

В карточке вопроса автор видит блок **"Измерения"**:

- список шкал, на которые влияет вопрос;
- значение вклада;
- вес;
- условие применения;
- предпросмотр расчёта для вариантов ответа.

Вопрос может иметь несколько вкладов:

```json
[
  { "scaleId": "leadership", "value": 2, "weight": 1 },
  { "scaleId": "risk_management", "value": 1, "weight": 0.5 }
]
```

### 4.3 Вклад вариантов ответа

Для `single` и `multiple` вклад может задаваться на уровне варианта ответа.

Пример:

```json
{
  "optionId": "delegate",
  "measurements": [
    { "scaleId": "leadership", "value": 2 },
    { "scaleId": "communication", "value": 1 }
  ]
}
```

Для `matching` вклад может задаваться на пару или на правильность пары. Для `ranking` вклад может
зависеть от позиции элемента.

### 4.4 Условные measurement-правила

MVP поддерживает ограниченный набор условий:

```text
answer.equals(optionId)
answer.includes(optionId)
answer.matchingPair(leftId, rightId)
answer.rankingPosition(itemId) <= N
answer.isCorrect
answer.scoreRatio >= N
```

Условия не используют `eval()` / `Function()`.

### 4.5 Расчёт шкал

Последовательность:

1. Core проверяет ответы.
2. Core рассчитывает стандартные баллы.
3. Core рассчитывает результаты разделов, если flow секционный.
4. Core применяет measurement-правила вопросов.
5. Core агрегирует значения по шкалам.
6. Core нормализует значения.
7. Core применяет интерпретационные диапазоны.
8. Core публикует `scale.*`.
9. Core запускает событие `scale:calculated`.
10. Core рассчитывает пользовательские показатели `result.*`.

### 4.6 Пространство `scale.*`

Для шкалы `leadership` публикуются:

```text
scale.leadership.raw
scale.leadership.normalized
scale.leadership.percent
scale.leadership.level
scale.leadership.label
scale.leadership.hasValue
```

`result_variables` из PRD-2 могут использовать эти значения:

```text
scaleById("leadership").percent >= 80
scale.leadership.percent
```

---

## 5. Агрегация

### 5.1 Поддерживаемые типы

| Тип | Описание |
| --- | --- |
| `sum` | Сумма вкладов |
| `avg` | Среднее значение вкладов |
| `weighted_avg` | Средневзвешенное значение |
| `max` | Максимальный вклад |
| `min` | Минимальный вклад |
| `threshold` | Boolean или level по порогу |
| `formula` | Ограниченная формула без произвольного JS |

### 5.2 Нормализация

Для `percent` Core рассчитывает значение с учётом `direction`:

```text
direction = positive: percent = (raw - minPossible) / (maxPossible - minPossible) * 100
direction = inverse:  percent = (maxPossible - raw) / (maxPossible - minPossible) * 100
```

Семантика обоих случаев: `percent` растёт вместе с уровнем измеряемого качества. Для
inverse-шкалы «высокий raw означает низкий уровень качества» (например, высокий балл
«обесценивания достижений» в MBI означает низкое выгорание по этой шкале), поэтому
percent инвертируется относительно raw.

`bands` всегда применяются к `raw` буквально. Поле `level` в band-объекте определяет
символьное имя уровня для `scale.{key}.level` и не зависит от `direction`. Это позволяет
автору описывать пороги в естественных единицах шкалы и одновременно получать UI-friendly
`percent`.

Если диапазон невозможен или равен нулю, значение становится `null`, а ошибка пишется в
диагностику.

### 5.3 Интерпретационные диапазоны

Диапазоны применяются к `raw`. Опциональное поле `level` band-объекта определяет
символьное имя уровня (`scale.{key}.level`); если поле опущено, Core генерирует
`level` из индекса band (`band_0`, `band_1`, ...).

Прямая шкала (`direction = positive`):

```json
[
  { "min": 0, "max": 49, "label": "Низкий", "level": "low" },
  { "min": 50, "max": 79, "label": "Средний", "level": "mid" },
  { "min": 80, "max": 100, "label": "Высокий", "level": "high" }
]
```

Инверсная шкала (`direction = inverse`) на примере шкалы AD из MBI: высокий raw означает
низкий уровень выгорания. Порядок интервалов по `raw` остаётся возрастающим, но `level`
для верхнего интервала становится `low`.

```json
[
  { "min": 0, "max": 27, "label": "Высокий", "level": "high" },
  { "min": 28, "max": 32, "label": "Средний", "level": "mid" },
  { "min": 33, "max": 40, "label": "Низкий", "level": "low" }
]
```

Диапазоны не должны пересекаться. Непокрытые значения разрешены, но показываются как
`Без интерпретации`.

---

## 6. UI автора

### 6.1 Вкладка "Шкалы"

Содержит:

- список шкал;
- тип и агрегацию;
- покрытие вопросами;
- предупреждения о шкалах без вкладов;
- предпросмотр диапазонов интерпретации.

### 6.2 Блок "Измерения" в вопросе

Содержит матрицу вкладов:

```text
Вариант ответа | Лидерство | Риски | Коммуникация
```

Для сложных типов вопросов UI показывает специализированную форму:

- `matching`: вклад пары;
- `ranking`: вклад позиции;
- `multiple`: вклад выбранного варианта и комбинаций.

### 6.3 Предпросмотр расчёта

Автор может выбрать демо-ответ и увидеть:

- стандартный балл;
- вклад в каждую шкалу;
- итоговое значение шкалы;
- будущие значения `scale.*`;
- предупреждения о конфликтующих или недостижимых правилах.

---

## 7. Runtime и отображение

### 7.1 Публичный контекст

Макеты результатов получают:

```json
{
  "scaleResults": [
    {
      "key": "leadership",
      "label": "Лидерство",
      "raw": 12,
      "percent": 80,
      "level": "high",
      "displayLabel": "Высокий"
    }
  ]
}
```

### 7.2 Слоты шаблона

Опциональный слот:

```html
<div data-slot="scale-results"></div>
```

Если слот есть, Core может вставить стандартный блок шкал, разрешённых для обучающегося.

### 7.3 Форматирование

| Тип | Отображение |
| --- | --- |
| `number` | До 2 знаков после запятой |
| `boolean` | Да / Нет |
| `category` | Текстовая категория |
| `level` | Название уровня |
| `null` | Не рассчитано |

---

## 8. Передача в LMS

### 8.1 `suspend_data`

Для шкал с `scorm_target = "suspend_data"` или `"both"` Core добавляет:

```json
{
  "custom": {
    "scale": {
      "leadership": {
        "raw": 12,
        "percent": 80,
        "level": "high",
        "label": "Высокий"
      }
    }
  }
}
```

### 8.2 `interactions`

Для `interaction` или `both` Core может создать pseudo-interaction:

```text
cmi.interactions[n].id               = "scale_leadership"
cmi.interactions[n].type             = "other"
cmi.interactions[n].result           = "neutral"
cmi.interactions[n].learner_response = "Высокий"
cmi.interactions[n].description      = "Лидерство"
```

`learner_response` несёт отображаемый `label` из band — именно это поле попадает в Excel
отчёт WebTutor (см. §8.3). `description` несёт `label` шкалы.

Стандартный балл SCORM не заменяется шкалами.

### 8.3 Совместимость с LMS-экспортом (WebTutor)

LMS WebTutor выгружает результаты курса в Excel со столбцами по `cmi.interactions[n]`,
где значение `learner_response` отображается как столбец «Ответ». Содержимое
`suspend_data.custom.*` в стандартный Excel-экспорт **не попадает**: оно доступно
только runtime'у пакета и при ручной декодировке записи попытки.

Чтобы итог шкалы или пользовательского показателя был доступен аналитику в стандартной
выгрузке WebTutor, шкала должна передаваться через pseudo-interactions, то есть иметь
`scorm_target = "interaction"` или `"both"`.

Рекомендуемые настройки для сценариев, где WebTutor-аналитик должен видеть итоги без
постобработки:

| Сущность | `scorm_target` | Эффект |
| --- | --- | --- |
| Шкала с `show_to_learner = false`, нужна только аналитику | `interaction` | Pseudo-interaction `scale_{key}`, label попадает в Excel |
| Шкала, отображаемая обучающемуся и аналитику | `both` | Pseudo-interaction + полный объект в `suspend_data.custom.scale.{key}` для runtime UI |
| Итоговая категория (`result_variable` в PRD-2) | `both` | Pseudo-interaction `var_{name}`, дублируется в `suspend_data.custom.result.{name}` |

Стабильные id pseudo-interactions, на которые администратор WebTutor может биндить
колонки отчёта:

| Источник | Id pseudo-interaction |
| --- | --- |
| Шкала | `scale_{key}` |
| Пользовательский показатель (PRD-2) | `var_{name}` |
| Раздел теста (PRD-4) | `section_{key}` |

Эта схема позволяет заменить постобработку Excel внешним скриптом: после сдачи PRD-5 +
PRD-2 LMS-выгрузка уже содержит столбцы с уровнями шкал и итоговой категорией. См.
end-to-end сценарий MBI в [example-mbi.md](./example-mbi.md).

---

## 9. Модель данных

### 9.1 `scales`

```sql
CREATE TABLE scales (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id            uuid NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  key                text NOT NULL,
  label              text NOT NULL,
  description        text,
  type               text NOT NULL,
  aggregation        text NOT NULL,
  normalization      text NOT NULL DEFAULT 'none',
  direction          text NOT NULL DEFAULT 'positive'
                       CHECK (direction IN ('positive', 'inverse')),
  config_json        jsonb NOT NULL DEFAULT '{}',
  show_to_learner    boolean NOT NULL DEFAULT false,
  scorm_target       text NOT NULL DEFAULT 'none',
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now(),
  UNIQUE(test_id, key)
);
```

### 9.2 `question_measurements`

```sql
CREATE TABLE question_measurements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id          uuid NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  question_id      uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  scale_id         uuid NOT NULL REFERENCES scales(id) ON DELETE CASCADE,
  source_type      text NOT NULL,
  source_key       text,
  value_json       jsonb NOT NULL,
  weight           numeric NOT NULL DEFAULT 1,
  condition_json   jsonb,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamp NOT NULL DEFAULT now(),
  updated_at       timestamp NOT NULL DEFAULT now()
);
```

`source_type`:

```text
question
option
matching_pair
ranking_position
answer_score
```

### 9.3 Runtime `scale_results`

Физическая таблица для runtime не обязательна в MVP. Значения сохраняются в `suspend_data` и
telemetry payload. Серверные attempt-таблицы могут хранить `scale_results_json` для аналитики.

---

## 10. API

```text
GET /api/tests/:id/scales
POST /api/tests/:id/scales
PUT /api/tests/:id/scales/:scaleId
DELETE /api/tests/:id/scales/:scaleId
PUT /api/tests/:id/scales/reorder
```

```text
GET /api/questions/:id/measurements
PUT /api/questions/:id/measurements
POST /api/tests/:id/scales/preview
POST /api/tests/:id/scales/validate
```

---

## 11. Валидация

Блокирующие ошибки:

- дублирующийся `scale.key`;
- неизвестная шкала в measurement-правиле;
- неизвестный вариант ответа, пара или item;
- невалидный тип значения для шкалы;
- пересекающиеся диапазоны интерпретации;
- формула агрегации с неизвестной ссылкой;
- циклическая зависимость формульных шкал.

Предупреждения:

- шкала не имеет вкладов;
- вопрос имеет measurement-правило, но не используется в тесте;
- шкала не показывается обучающемуся и не передаётся в LMS;
- нормализация `percent` не может вычислить полный диапазон до runtime.

---

## 12. Совместимость

- Тесты без шкал не меняют стандартный балл.
- Вопросы без measurement-правил работают как сейчас.
- `result_variables` продолжают работать без `scale.*`.
- При удалении шкалы UI показывает, какие вопросы и показатели результата зависят от неё.

---

## 13. Нефункциональные требования

| ID | Требование |
| --- | --- |
| NFR-01 | Расчёт шкал не использует `eval()` / `Function()` |
| NFR-02 | Ошибка расчёта одной шкалы не прерывает стандартное завершение теста |
| NFR-03 | Все ошибки шкал сохраняются в diagnostics и `suspend_data.custom.scaleErrors`, если возможно |
| NFR-04 | Расчёт шкал выполняется детерминированно для восстановленной попытки |
| NFR-05 | Значения `scale.*` публикуются до расчёта `result.*` |

---

## 14. Критерии приёмки

- [ ] Автор создаёт шкалу `leadership` с агрегацией `weighted_avg`.
- [ ] Один вопрос даёт вклад минимум в две шкалы.
- [ ] Вклад шкалы может зависеть от выбранного варианта ответа.
- [ ] Смешанный вопрос одновременно даёт стандартный балл и вклад в шкалы.
- [ ] Core рассчитывает `scale.leadership.percent` до `result:calculated`.
- [ ] Пользовательский показатель использует `scaleById("leadership").percent`.
- [ ] Макет результатов показывает шкалы с `show_to_learner = true`.
- [ ] LMS получает шкалы через `suspend_data.custom.scale`.
- [ ] Ошибка measurement-правила не ломает стандартный результат.
- [ ] Старый тест без шкал проходит без изменений результата.

---

## 15. Решённые вопросы

| Вопрос | Решение |
| --- | --- |
| Заменяют ли шкалы стандартный балл? | Нет. Это отдельный слой результата |
| Может ли вопрос измерять несколько шкал? | Да |
| Может ли вклад зависеть от варианта ответа? | Да |
| Где публикуются шкалы? | В `scale.*` |
| Как шкалы связаны с PRD-2? | `result_variables` могут использовать `scale.*` как источник через `scaleById(...)` (см. [PRD-2 §4.2](../prd-2/result-variables.md#42-расширенный-dsl)) |
| Может ли шкала быть инверсной (высокий raw означает низкое качество)? | Да. Поле `direction` принимает `positive` (по умолчанию) и `inverse`. См. §3.1, §5.2 |
| Как итог шкалы попадает в WebTutor Excel? | Через `scorm_target = "interaction"` или `"both"`. См. §8.3 |
| Где описан полный сценарий MBI? | [example-mbi.md](./example-mbi.md) |

---

## 16. Связанные примеры

- [example-mbi.md](./example-mbi.md) — Maslach Burnout Inventory: 3 шкалы (EE/D/AD,
  одна инверсная), 22 вопроса, `result_variable` итоговой категории, ожидаемое
  содержимое `cmi.interactions` и `suspend_data` для замены внешнего постпроцессора.
