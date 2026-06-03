# Пример: MBI Burnout Inventory как PRD-5 + PRD-2 сценарий

**Версия:** 1.2  
**Дата:** 2026-06-02 (v1.1: §2.4 переведён на явную сетку «вариант × шкала» —
`source_type = option`, вклад = `value_json` 0..5; `answer_score` в шкалы не наследуется
([scoring-model.md](../scoring-model.md) §10.3); §2.3 — шесть вариантов)  
**Статус:** Нормативный пример к [PRD-5](./scales-competency-measurements.md) и
[PRD-2](../prd-2/result-variables.md)  
**Источник методики:** Maslach Burnout Inventory General Survey (MBI-GS), 22 вопроса

---

## 1. Зачем этот пример

Документ фиксирует, как полностью покрыть бизнес-сценарий «оценка выгорания через MBI»
средствами PRD-5 (шкалы) и PRD-2 (показатели результата), не прибегая к ручной
постобработке LMS-выгрузки. Сейчас на проекте используется внешний Python-скрипт
(`c:\VMs\Shared\report_build\process_burnout_export.py`), который:

1. читает Excel-выгрузку из WebTutor с ответами на 22 вопроса по каждому респонденту;
2. считает три шкалы (EE, D, AD) суммированием баллов 0..5 по соответствующим вопросам;
3. определяет уровень (`low`/`mid`/`high`) каждой шкалы по фиксированным порогам;
4. определяет итоговую категорию выгорания из таблицы 27 комбинаций уровней;
5. дописывает столбцы с уровнями и категорией в Excel и опционально рассылает результат.

После реализации PRD-5 + PRD-2 этот скрипт становится не нужен: SCORM-пакет в момент
завершения попытки сам пишет уровни и категорию в `cmi.interactions`, и они появляются
в стандартном Excel-экспорте WebTutor как отдельные столбцы.

---

## 2. Состав теста

### 2.1 Шкалы

Тест содержит три шкалы. Шкала AD инверсная: высокий raw означает низкий уровень
обесценивания достижений и низкий вклад в выгорание.

| Ключ | Название | Вопросы | Max raw | `direction` | `aggregation` | `scorm_target` |
| --- | --- | --- | --- | --- | --- | --- |
| `ee` | Эмоциональное истощение | 1, 2, 3, 6, 8, 13, 14, 16, 20 | 45 | `positive` | `sum` | `both` |
| `d` | Отстранённость | 5, 10, 11, 15, 22 | 25 | `positive` | `sum` | `both` |
| `ad` | Обесценивание достижений | 4, 7, 9, 12, 17, 18, 19, 21 | 40 | `inverse` | `sum` | `both` |

### 2.2 Bands

```json
{
  "ee": [
    { "min": 0,  "max": 14, "label": "Низкий",   "level": "low"  },
    { "min": 15, "max": 24, "label": "Средний",  "level": "mid"  },
    { "min": 25, "max": 45, "label": "Высокий",  "level": "high" }
  ],
  "d": [
    { "min": 0,  "max": 4,  "label": "Низкий",   "level": "low"  },
    { "min": 5,  "max": 9,  "label": "Средний",  "level": "mid"  },
    { "min": 10, "max": 25, "label": "Высокий",  "level": "high" }
  ],
  "ad": [
    { "min": 0,  "max": 27, "label": "Высокий",  "level": "high" },
    { "min": 28, "max": 32, "label": "Средний",  "level": "mid"  },
    { "min": 33, "max": 40, "label": "Низкий",   "level": "low"  }
  ]
}
```

Замечания:

- Для AD пороги уровней даны в порядке возрастания `raw`, но семантика `level`
  инверсная — это позволяет одинаково применять `bands` ко всем шкалам, не меняя
  алгоритм Core.
- `scale.ad.percent` благодаря `direction = inverse` будет расти вместе с уровнем
  выгорания, а не вместе с raw. Это удобнее для UI индикаторов.

### 2.3 Вопросы

22 вопроса single-choice с шестью вариантами:

| Ответ | Score |
| --- | --- |
| Никогда | 0 |
| Очень редко | 1 |
| Редко | 2 |
| Иногда | 3 |
| Часто | 4 |
| Постоянно | 5 |

Note: исходная Likert-шкала MBI имеет 6 градаций (включая «Очень редко» как
отдельный уровень). При сохранении тестов авторам показывается готовый набор
вариантов.

### 2.4 Measurements (вклады вопросов)

Каждый вопрос измеряет ровно одну шкалу. Вклады задаются ЯВНО в сетке «вариант × шкала»
(`source_type = "option"`): шесть вариантов ответа дают в шкалу СВОЕГО вопроса числа
0..5 (численно равны баллу по Likert, но вписываются явно — `answer_score` в шкалы не
наследуется, см. [scoring-model.md](../scoring-model.md) §10.3 и
[PRD-5 §9.2](./scales-competency-measurements.md#92-question_measurements)).

Привязка «вопрос -> шкала» (`scaleKey` строк сетки этого вопроса):

| Шкала | Вопросы |
| --- | --- |
| `ee` | 1, 2, 3, 6, 8, 13, 14, 16, 20 |
| `d` | 5, 10, 11, 15, 22 |
| `ad` | 4, 7, 9, 12, 17, 18, 19, 21 |

Сетка вкладов одинакова для всех 22 вопросов — по строке на вариант, `value_json` равен
Likert-значению варианта. Пример строк `question_measurements` для вопроса 1 (шкала `ee`):

```json
[
  { "questionNumber": 1, "scaleKey": "ee", "source_type": "option", "source_key": "opt:Никогда",     "value_json": 0 },
  { "questionNumber": 1, "scaleKey": "ee", "source_type": "option", "source_key": "opt:Очень редко", "value_json": 1 },
  { "questionNumber": 1, "scaleKey": "ee", "source_type": "option", "source_key": "opt:Редко",        "value_json": 2 },
  { "questionNumber": 1, "scaleKey": "ee", "source_type": "option", "source_key": "opt:Иногда",       "value_json": 3 },
  { "questionNumber": 1, "scaleKey": "ee", "source_type": "option", "source_key": "opt:Часто",        "value_json": 4 },
  { "questionNumber": 1, "scaleKey": "ee", "source_type": "option", "source_key": "opt:Постоянно",    "value_json": 5 }
]
```

Остальные 21 вопрос настраиваются так же; отличается только `scaleKey` (по таблице выше).
При одиночном выборе в шкалу попадает `value_json` фактически выбранного варианта (правило
суммы `aggregation = sum`, [scoring-model.md](../scoring-model.md) §10.1). `source_key`
требует стабильных ID вариантов — пререквизит реализации ([scoring-model.md](../scoring-model.md) §10.7).

### 2.5 Result variable: итоговая категория

```yaml
name: burnout_category
label: Категория выгорания
type: string
scorm_target: both
controls_status: none   # MBI не определяет pass/fail курса автоматически
sort_order: 100
formula: |
  IF(countScales(["ee","d","ad"], "high") = 3, "Выгорание",
  IF(countScales(["ee","d","ad"], "high") = 2, "Возрастающее истощение",
  IF(countScales(["ee","d","ad"], "high") = 1
     AND countScales(["ee","d","ad"], "mid") <= 1, "Начинающееся истощение",
  IF(countScales(["ee","d","ad"], "high") = 1
     AND countScales(["ee","d","ad"], "mid") = 2, "Возрастающее истощение",
  IF(countScales(["ee","d","ad"], "high") = 0
     AND countScales(["ee","d","ad"], "mid") = 0, "Вовлечённость",
  "Снижающаяся вовлечённость")))))
```

Логика категорий взята из таблицы 27 комбинаций уровней (внешний TZ, лист «Общий
результат»):

| `count(high)` | `count(mid)` | Категория |
| --- | --- | --- |
| 0 | 0 | Вовлечённость |
| 0 | 1..3 | Снижающаяся вовлечённость |
| 1 | 0..1 | Начинающееся истощение |
| 1 | 2 | Возрастающее истощение |
| 2 | любое | Возрастающее истощение |
| 3 | 0 | Выгорание |

---

## 3. Пайплайн расчёта в Core

Последовательность по [PRD-5 §4.5](./scales-competency-measurements.md#45-расчёт-шкал) и
[PRD-2 §5.1](../prd-2/result-variables.md#51-последовательность):

```text
1. Core собирает ответы пользователя.
2. Core применяет measurement-правила: для каждого ответа берёт score 0..5
   и прибавляет к raw соответствующей шкалы.
3. Core агрегирует raw (sum).
4. Core применяет нормализацию (percent с учётом direction).
5. Core применяет bands → level + label.
6. Core публикует scale.ee.{raw, percent, level, label, hasValue},
   scale.d.{...}, scale.ad.{...}.
7. Core запускает scale:calculated.
8. Core вычисляет result_variables в порядке sort_order:
   - countScales(["ee","d","ad"], "high") читает scale.{ee,d,ad}.level
   - формула вычисляется в строку
   - результат публикуется как result.burnout_category
9. Core запускает result:calculated.
10. Core пишет SCORM-данные через зону ответственности Core.
```

---

## 4. Что попадает в LMS

### 4.1 `cmi.interactions`

Для `scorm_target = "both"` Core создаёт pseudo-interaction на ЗНАЧЕНИЕ каждой шкалы, а для
шкал с диапазонами — ещё одну на УРОВЕНЬ (PRD-5 §8.2), плюс по одной на каждый result_variable:

```text
cmi.interactions[N].id               = "scale_ee"
cmi.interactions[N].type             = "other"
cmi.interactions[N].result           = "neutral"
cmi.interactions[N].learner_response = "30"          // raw-значение
cmi.interactions[N].description      = "Эмоциональное истощение"

cmi.interactions[N+1].id               = "scale_ee_level"
cmi.interactions[N+1].learner_response = "Высокий"   // band.label
cmi.interactions[N+1].description      = "Эмоциональное истощение — уровень"

cmi.interactions[N+2].id               = "scale_d"
cmi.interactions[N+2].learner_response = "7"
cmi.interactions[N+2].description      = "Отстранённость"

cmi.interactions[N+3].id               = "scale_d_level"
cmi.interactions[N+3].learner_response = "Средний"
cmi.interactions[N+3].description      = "Отстранённость — уровень"

cmi.interactions[N+4].id               = "scale_ad"
cmi.interactions[N+4].learner_response = "20"
cmi.interactions[N+4].description      = "Обесценивание достижений"

cmi.interactions[N+5].id               = "scale_ad_level"
cmi.interactions[N+5].learner_response = "Высокий"
cmi.interactions[N+5].description      = "Обесценивание достижений — уровень"

cmi.interactions[N+6].id               = "var_burnout_category"
cmi.interactions[N+6].type             = "other"
cmi.interactions[N+6].result           = "neutral"
cmi.interactions[N+6].learner_response = "Возрастающее истощение"
cmi.interactions[N+6].description      = "Категория выгорания"
```

### 4.2 `suspend_data.custom`

```json
{
  "scale": {
    "ee": { "raw": 32, "normalized": 71, "percent": 71, "level": "high",
            "label": "Высокий" },
    "d":  { "raw": 7,  "normalized": 28, "percent": 28, "level": "mid",
            "label": "Средний" },
    "ad": { "raw": 22, "normalized": 45, "percent": 45, "level": "high",
            "label": "Высокий" }
  },
  "result": {
    "burnout_category": "Возрастающее истощение"
  },
  "formulaErrors": []
}
```

### 4.3 Видимость в Excel WebTutor

В стандартной выгрузке WebTutor каждая pseudo-interaction даёт колонку «Ответ».
Аналитик получает таблицу:

| Пользователь | ... | scale_ee | scale_d | scale_ad | var_burnout_category |
| --- | --- | --- | --- | --- | --- |
| user-001 | ... | Высокий | Средний | Высокий | Возрастающее истощение |
| user-002 | ... | Средний | Низкий | Низкий | Снижающаяся вовлечённость |
| ... | | | | | |

Внешний Python-скрипт `process_burnout_export.py` после этого не нужен: расчёт уже
выполнен пакетом, аналитика идёт по готовым столбцам.

---

## 5. Acceptance-сценарий

Цель — проверить, что внешний постпроцессор полностью замещается SCORM-пакетом.

**Статус (2026-06-03):** реализован сквозной golden-тест `tests/mbi-golden.test.ts` —
строит фикстуру из §2 (3 шкалы, 22 вопроса, `burnout_category`), гоняет авторитетный
пайплайн (`shared/scales/engine` → `shared/formula`) и сверяет уровни шкал и итоговую
категорию с независимой reference-реализацией таблицы §2.5 по всем 27 комбинациям уровней,
числовым проверкам §5.3 (включая `scale.ad.percent = 45` для raw = 22) и регрессионным
точкам §5.4. Проверки #7-#9 (Excel-выгрузка WebTutor) подтверждаются при первом live-LMS
прогоне (§7 п.1) — недоступны локально (память `no-live-webtutor-verify-local`).

### 5.1 Подготовка

1. Сценарий из §2 описан в test-builder: 3 шкалы, 22 вопроса, 1 result_variable.
2. Шкалы и переменная сохранены, валидация прошла без ошибок.

### 5.2 Прохождение

1. Респондент проходит тест с известным набором ответов.
2. SCORM-пакет завершает попытку и записывает `cmi.*`.

### 5.3 Проверки

| # | Что проверяем | Ожидаемый результат |
| --- | --- | --- |
| 1 | `scale.ee.raw` после завершения | Сумма score по 9 вопросам EE |
| 2 | `scale.ad.percent` для raw = 22 | 45 (по формуле inverse) |
| 3 | `scale.ee.level` для raw = 32 | `high` |
| 4 | `scale.ad.level` для raw = 22 | `high` (raw < 28, попадает в band 0..27) |
| 5 | `countScales(["ee","d","ad"], "high")` для уровней `high/mid/high` | 2 |
| 6 | `result.burnout_category` для уровней `high/mid/high` | `Возрастающее истощение` |
| 7 | `cmi.interactions[N].learner_response` для `scale_ee` | `Высокий` |
| 8 | `cmi.interactions[M].learner_response` для `var_burnout_category` | `Возрастающее истощение` |
| 9 | Excel-выгрузка WebTutor содержит столбцы `scale_ee`, `scale_d`, `scale_ad`, `var_burnout_category` | Да, без постобработки |
| 10 | Категория из SCORM совпадает с категорией из `process_burnout_export.py` на одинаковом наборе ответов | Совпадает по всем тест-кейсам |

### 5.4 Регрессионные точки

- Старый тест без шкал и без `result_variables` экспортируется и проходится без
  изменений (см. [PRD-5 §12](./scales-competency-measurements.md#12-совместимость)).
- Сценарий с `scorm_target = "suspend_data"` (без `interaction`) не создаёт колонку
  в Excel, но runtime UI продолжает показывать значения шкал.
- Сценарий с ошибкой в формуле `result_variable` не ломает запись `scale.*` в LMS
  (см. [PRD-2 §5.2](../prd-2/result-variables.md#52-ошибки-вычисления)).

---

## 6. Карта правок относительно spec'ов

Документ опирается на следующие правки PRD-5 v1.1 и PRD-2 v2.1 (зафиксированы
2026-05-29):

| Spec | Правка | Где |
| --- | --- | --- |
| PRD-5 | Поле `direction` (`positive`/`inverse`) в `scales` | §3.1, §4.1, §5.2, §9.1 |
| PRD-5 | Поле `level` в band-объекте | §5.3 |
| PRD-5 | Раздел «Совместимость с LMS-экспортом» с маппингом id pseudo-interactions | §8.3 |
| PRD-2 | Источники DSL `scaleById(...)` и helper `countScales(...)` | §4.2 |
| PRD-2 | Валидация ссылок `scaleById` на существующие шкалы | §4.3 |
| PRD-2 | Поле `controls_status` (`none`/`success`/`completion`) и mapping в `cmi.*_status` | §3.4, §7.3, §8.1 |

В MBI-сценарии `controls_status` не используется (статус курса определяется через
`completion_status = "completed"` стандартным путём по факту прохождения всех
вопросов), но поле остаётся доступным для сценариев, где «pass» зависит от категории.

---

## 7. Open items для реализации

Для финального закрытия сценария «без постобработки» в дополнение к коду PRD-5/PRD-2
нужно подтвердить:

1. **Видимость id pseudo-interactions в Excel WebTutor.** В каких именно колонках
   WebTutor показывает `cmi.interactions[n].id` vs `description` vs
   `learner_response`. Уточняется при первом live-LMS прогоне.
2. **Регистронезависимость parser'а ответов.** Если в импорте/предпросмотре
   используются разные регистры («Никогда» vs «никогда»), нормализация задаётся
   на уровне варианта ответа в test-builder, не на уровне формулы.
3. **Стабильность ключей `scale.key`.** При экспорте `scale_{key}` в interaction id
   ключ шкалы должен оставаться стабильным между версиями теста, иначе колонки
   Excel будут мигрировать. Это уже обеспечено `UNIQUE (test_id, key)` в [PRD-5
   §9.1](./scales-competency-measurements.md#91-scales).
