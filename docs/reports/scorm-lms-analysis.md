# Анализ обмена данными SCORM -- LMS

Дата анализа: 2026-02-08

---

## Содержание

- [Архитектура обмена данными](#архитектура-обмена-данными)
- [Пошаговый обмен данными](#пошаговый-обмен-данными)
- [Выявленные проблемы](#выявленные-проблемы)
- [Предлагаемые решения](#предлагаемые-решения)
- [Сценарии потери данных](#сценарии-потери-данных)
- [Положительные аспекты текущей реализации](#положительные-аспекты-текущей-реализации)

---

## Архитектура обмена данными

Генерируемый SCORM-пакет представляет собой автономный набор файлов (HTML, JS, CSS),
который LMS загружает в iframe или popup-окно. Коммуникация осуществляется исключительно
через JavaScript API, предоставляемый LMS. Пакет не выполняет HTTP-запросов к LMS
напрямую --- вся связь идёт через вызовы методов объекта `API_1484_11` (SCORM 2004 4th
Edition).

### Ключевые файлы

| Файл | Роль |
| --- | --- |
| `server/scorm/assets/runtime.js` | SCORM 2004 API-обёртка (поиск API, init/setValue/commit/terminate) |
| `server/scorm/template/app/bootstrap/main.js` | Инициализация приложения, обработчик beforeunload |
| `server/scorm/template/app/state.js` | Глобальное состояние приложения |
| `server/scorm/template/app/actions/answers.js` | Действия при ответах, промежуточное сохранение сессии |
| `server/scorm/template/app/render/resultsPage.js` | Завершение теста, отправка данных в LMS |
| `server/scorm/template/app/utils/scorm/suspendAttempts.js` | Чтение/запись suspend\_data |
| `server/scorm/template/app/telemetry/telemetry.js` | Модуль телеметрии (HTTP-канал) |

### Каналы передачи данных

Система использует два независимых канала:

1. **SCORM API** --- стандартный канал через `API_1484_11` (SetValue/GetValue/Commit/Terminate)
2. **Телеметрия** --- HTTP-запросы к серверу приложения (резервный канал, опционален)

---

## Пошаговый обмен данными

### Фаза 1: Инициализация

Расположение: `runtime.js:6-24`, `main.js:3-5`

1. При загрузке `index.html` LMS предоставляет объект `window.API_1484_11`.
2. Функция `findAPI()` ищет этот объект, поднимаясь по цепочке `window.parent`
   (до 500 итераций), затем проверяет `window.opener`.
3. `SCORM.init()` вызывает `API_1484_11.Initialize("")`.
4. Если API не найден --- пакет переходит в standalone-режим (все операции записи
   молча игнорируются).

Данные, получаемые от LMS:

| CMI-элемент | Назначение |
| --- | --- |
| `cmi.suspend_data` | JSON с историей предыдущих попыток |
| `cmi.learner_id` | Идентификатор пользователя |
| `cmi.learner_name` | Имя пользователя |

### Фаза 2: Прохождение теста

Расположение: `answers.js:264-282`, `suspendAttempts.js:16-25`

При каждом переходе между вопросами (`next()`, `submit()`) вызывается
`saveSessionState()`, который записывает текущий прогресс:

1. Формируется JSON объект с текущим состоянием (`currentIndex`, `answers`, `submitted`).
2. Объект записывается в `cmi.suspend_data` через `SCORM.setValue()`.
3. Сразу вызывается `SCORM.commit()` для фиксации данных.

Структура `cmi.suspend_data`:

```json
{
  "attemptsUsed": 2,
  "attempts": [
    {
      "attemptNumber": 1,
      "percent": 80,
      "passed": true,
      "topicResults": [],
      "answers": {},
      "flatQuestions": []
    }
  ],
  "currentSession": {
    "currentIndex": 5,
    "answers": {},
    "submitted": false
  },
  "lastUpdated": "2026-02-08T12:00:00Z"
}
```

### Фаза 3: Штатное завершение теста

Расположение: `resultsPage.js:3-115`

При нажатии кнопки "Завершить тест" (`finishAndClose()`):

1. Устанавливается guard-флаг `scormFinished = true`.
2. Результат сохраняется в `suspend_data` через `saveAttemptResult()`.
3. Телеметрия отправляется через HTTP (реальный результат попытки).
4. Определяется лучшая попытка через `getBestAttempt()`.
5. Вызывается `SCORM.finish()` с данными лучшей попытки.
6. Вызываются `SCORM.commit()` и `SCORM.terminate()`.
7. Вызывается `window.close()`.

CMI-элементы, записываемые при завершении:

| CMI-элемент | Значение | Описание |
| --- | --- | --- |
| `cmi.score.raw` | earnedPoints | Набранные баллы |
| `cmi.score.min` | 0 | Минимальный балл |
| `cmi.score.max` | possiblePoints | Максимальный балл |
| `cmi.score.scaled` | earnedPoints / possiblePoints | Нормализованная оценка (0..1) |
| `cmi.completion_status` | "completed" | Статус завершения |
| `cmi.success_status` | "passed" / "failed" | Успешность |
| `cmi.progress_measure` | "1" (если passed) | Прогресс |
| `cmi.exit` | "normal" | Тип выхода |
| `cmi.objectives.N.*` | По темам | Objectives по каждой теме |
| `cmi.interactions.N.*` | По вопросам | Ответы на каждый вопрос |

### Фаза 4: Аварийный выход (beforeunload)

Расположение: `main.js:12-44`

Если пользователь закрывает окно без нажатия "Завершить тест":

1. Проверяется флаг `scormFinished`.
2. Ищется лучшая попытка через `getBestAttempt()`.
3. Устанавливаются базовые CMI-значения (score, completion, success).
4. `cmi.exit` устанавливается в `"suspend"` (не `"normal"`).
5. Вызываются `SCORM.commit()` и `SCORM.terminate()`.

---

## Выявленные проблемы

### P1. Ненадежность beforeunload (ВЫСОКИЙ РИСК)

Расположение: `main.js:12-44`

Обработчик `beforeunload` выполняет 7 последовательных вызовов `SetValue`, затем
`Commit` и `Terminate`. Браузеры дают ограниченное время на выполнение кода в этом
обработчике (обычно единицы миллисекунд). Если LMS реализует вызовы асинхронно,
данные будут потеряны.

### P2. Отсутствие проверки ошибок SetValue (СРЕДНИЙ РИСК)

Расположение: `runtime.js:120-151`

Метод `finish()` последовательно вызывает `setScore`, `setCompletion`, `setSuccess`,
objectives и interactions. Возвращаемые значения логируются, но не проверяются. Если
промежуточный `SetValue` вернул `"false"`, метод продолжает работу и вызывает `commit()`,
фиксируя неконсистентное состояние.

### P3. Рост suspend\_data без контроля размера (СРЕДНИЙ РИСК)

Расположение: `suspendAttempts.js:71-97`

Результаты каждой попытки (включая все ответы и полный JSON всех вопросов) сохраняются
в `cmi.suspend_data`. Стандарт SCORM 2004 гарантирует минимум 64000 символов, но
конкретные LMS могут иметь меньшие лимиты. При большом количестве вопросов и нескольких
попытках JSON может превысить лимит. Ошибка перехватывается, но данные молча теряются
без уведомления пользователя.

### P4. Несогласованность формата score (СРЕДНИЙ РИСК)

Расположение: `main.js:24-31` vs `runtime.js:122-123`

При нормальном завершении `cmi.score.raw` получает `earnedPoints`, а `cmi.score.max` ---
`possiblePoints`. При аварийном выходе (beforeunload) `cmi.score.raw` получает
`percentScore` (0--100), а `cmi.score.max` --- 100. LMS может интерпретировать эти
значения по-разному в зависимости от способа выхода.

### P5. Отсутствие retry для SCORM API (СРЕДНИЙ РИСК)

Расположение: `runtime.js:60-65`

Модуль телеметрии имеет retry-буфер с 3 попытками. Но для SCORM API retry полностью
отсутствует. Если `Commit()` вернул `"false"` (например, из-за временной ошибки сети
LMS), попытка не повторяется.

### P6. Тихий standalone-режим (СРЕДНИЙ РИСК)

Расположение: `runtime.js:33-36`

Если `API_1484_11` не найден, все операции тихо "успешны". Пользователь пройдет тест,
увидит результаты, но LMS не получит ни одного значения. Нет никакого визуального
предупреждения.

### P7. Двойное объявление scormFinished (НИЗКИЙ РИСК)

Расположение: `state.js:25` и `resultsPage.js:1`

Переменная `scormFinished` объявлена как глобальная `var` в двух файлах. Обе ---
глобальные, поэтому последняя перезапишет первую. При изменении порядка конкатенации
файлов в `index.ts:172-199` поведение может нарушиться.

### P8. Сессия LMS может протухнуть (СРЕДНИЙ РИСК)

При длительном прохождении теста (особенно с таймером на час и более) сессия LMS может
истечь. В этом случае все вызовы `SetValue` и `Commit` будут отвергнуты, но SCORM API
не генерирует исключений --- возвращается `"false"`, который не проверяется.

---

## Предлагаемые решения

### S1. Надежное сохранение при beforeunload

**Проблема**: P1 (Ненадежность beforeunload)

**Решение**: Минимизировать объем работы в beforeunload, используя стратегию
предварительного сохранения (pre-commit).

Вместо записи всех данных при выходе --- периодически (каждые 30 секунд) и при каждом
ответе предварительно записывать актуальные score-значения в LMS. Тогда beforeunload
нужно будет сделать только `Commit` + `Terminate`.

**Файл**: `runtime.js`, `main.js`

Изменения:

- Добавить функцию `SCORM.preCommitScore(raw, min, max, scaled, completion, success)`
  которая устанавливает все score-значения и вызывает `commit()`.
- В `saveSessionState()` после записи `suspend_data` дополнительно вызывать
  `preCommitScore()` с текущими промежуточными результатами.
- В `beforeunload` оставить только `SCORM.commit()` и `SCORM.terminate()`.
- Добавить периодический авто-коммит (setInterval, 30 секунд).

### S2. Проверка ошибок и retry для SCORM API

**Проблемы**: P2, P5

**Решение**: Обернуть вызовы SetValue/Commit в проверку с возможностью повтора.

**Файл**: `runtime.js`

Изменения:

- `setValue()` --- проверять результат. При `"false"` выполнять retry (до 2 попыток
  с паузой 100 мс).
- `commit()` --- аналогичная проверка с retry.
- Добавить метод `getLastError()` который вызывает `API.GetLastError()` и
  `API.GetErrorString()` для диагностики.
- В `finish()` --- проверять кумулятивный результат всех SetValue. Если хотя бы один
  вернул ошибку, не вызывать commit и выполнить retry всей цепочки.

```javascript
setValue: function(key, value) {
  var api = getAPI();
  if (!api) { /* standalone */ return true; }

  var maxRetries = 2;
  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    var result = api.SetValue(key, String(value));
    if (result === "true" || result === true) return true;

    var errCode = api.GetLastError();
    log('SetValue error ' + key + ': ' + errCode + ' ' + api.GetErrorString(errCode));

    if (attempt < maxRetries) {
      // Синхронная пауза (допустимо для SCORM)
      var start = Date.now();
      while (Date.now() - start < 100) { /* busy wait */ }
    }
  }
  return false;
}
```

### S3. Контроль размера suspend\_data

**Проблема**: P3

**Решение**: Ограничить объем данных, хранимых в suspend\_data. Хранить только
необходимый минимум, а полные данные отправлять через телеметрию.

**Файл**: `suspendAttempts.js`

Изменения:

- Удалить `flatQuestions` из сохраняемого объекта попытки (он не нужен для
  восстановления --- вопросы есть в TEST\_DATA).
- Ограничить количество хранимых попыток --- хранить только лучшую и последнюю.
- Добавить проверку размера перед записью:

```javascript
function writeSuspendObj(obj) {
  try {
    var raw = JSON.stringify(obj || {});

    // SCORM 2004 гарантирует 64000 символов
    if (raw.length > 60000) {
      log('suspend_data слишком велик (' + raw.length + ' символов), обрезаем');
      obj = trimSuspendData(obj);
      raw = JSON.stringify(obj);
    }

    var result = SCORM.setValue('cmi.suspend_data', raw);
    if (!result) {
      log('Ошибка записи suspend_data');
      // Показать пользователю предупреждение
      if (typeof showToast === 'function') {
        showToast('Не удалось сохранить прогресс в LMS', 'warn');
      }
      return false;
    }
    SCORM.commit();
    return true;
  } catch (e) {
    log('Ошибка writeSuspendObj: ' + e);
    return false;
  }
}

function trimSuspendData(obj) {
  // Удаляем flatQuestions из всех попыток
  if (obj.attempts) {
    obj.attempts.forEach(function(a) { delete a.flatQuestions; });
  }
  // Оставляем только лучшую и последнюю попытку
  if (obj.attempts && obj.attempts.length > 2) {
    var best = getBestFromArray(obj.attempts);
    var last = obj.attempts[obj.attempts.length - 1];
    obj.attempts = best === last ? [best] : [best, last];
  }
  // Удаляем currentSession если всё ещё велик
  var raw = JSON.stringify(obj);
  if (raw.length > 60000) {
    delete obj.currentSession;
  }
  return obj;
}
```

### S4. Унификация формата score

**Проблема**: P4

**Решение**: Привести beforeunload к тому же формату, что и штатное завершение.

**Файл**: `main.js`

Изменения:

- В beforeunload использовать `earnedPoints` и `possiblePoints` из лучшей попытки
  (вместо percentScore/100):

```javascript
if (bestAttempt) {
  SCORM.setValue('cmi.score.raw', bestAttempt.earnedPoints);
  SCORM.setValue('cmi.score.min', 0);
  SCORM.setValue('cmi.score.max', bestAttempt.possiblePoints);
  SCORM.setValue('cmi.score.scaled',
    bestAttempt.possiblePoints > 0
      ? bestAttempt.earnedPoints / bestAttempt.possiblePoints
      : 0
  );
}
```

### S5. Предупреждение при standalone-режиме

**Проблема**: P6

**Решение**: Показать визуальное предупреждение, если SCORM API не найден.

**Файл**: `runtime.js`, `main.js`

Изменения:

- Добавить в объект SCORM свойство `isStandalone`.
- В `main.js` после `SCORM.init()` проверять это свойство и показывать предупреждение:

```javascript
SCORM.init();

if (SCORM.isStandalone) {
  showToast('Результаты не будут сохранены в LMS (автономный режим)', 'warn');
}
```

### S6. Устранение двойного объявления scormFinished

**Проблема**: P7

**Решение**: Удалить объявление `var scormFinished = false;` из `state.js:25`.
Оставить единственное объявление в `resultsPage.js:1`, которое выполняется позже
в порядке конкатенации.

**Файл**: `state.js`

### S7. Мониторинг здоровья SCORM-сессии

**Проблема**: P8

**Решение**: Периодически проверять доступность SCORM API и уведомлять пользователя
при потере связи.

**Файл**: `runtime.js`

Изменения:

- Добавить метод `SCORM.healthCheck()`:

```javascript
healthCheck: function() {
  var api = getAPI();
  if (!api) return false;

  // Пробуем прочитать известное значение
  try {
    var status = api.GetValue('cmi.completion_status');
    var err = api.GetLastError();
    return err === "0" || err === 0;
  } catch (e) {
    return false;
  }
}
```

- В `main.js` запускать проверку каждые 60 секунд:

```javascript
setInterval(function() {
  if (!scormFinished && !SCORM.isStandalone && !SCORM.healthCheck()) {
    showToast('Связь с LMS потеряна. Завершите тест как можно скорее.', 'warn');
  }
}, 60000);
```

---

## Сценарии потери данных

| N | Сценарий | Что теряется | Вероятность | Решения |
| --- | --- | --- | --- | --- |
| 1 | Закрытие браузера без "Завершить" | interactions, objectives; score частично | Высокая | S1 |
| 2 | Превышение лимита suspend\_data | История попыток, текущая сессия | Средняя | S3 |
| 3 | LMS с async Commit/Terminate | Данные после последнего успешного commit | Средняя | S1, S2 |
| 4 | Ошибка сети к LMS | Все данные текущей сессии | Низкая | S2, S7 |
| 5 | Cross-origin iframe | Все данные (API не найдётся) | Низкая | S5 |
| 6 | Таймаут сессии LMS | Commit/Terminate отвергаются | Средняя | S7 |
| 7 | Crash/freeze браузера | Данные после последнего commit | Низкая | S1 |
| 8 | Разный формат score при разных выходах | Корректность значения score | Средняя | S4 |

---

## Положительные аспекты текущей реализации

- **Промежуточное сохранение**: `saveSessionState()` вызывается при каждом переходе
  между вопросами, что значительно снижает потери при аварийном выходе.
- **Два канала данных**: телеметрия (HTTP) и SCORM API работают параллельно. Если один
  канал откажет, данные могут сохраниться через другой.
- **Guard-флаг**: `scormFinished` предотвращает повторную отправку данных в LMS.
- **Лучшая попытка**: `getBestAttempt()` обеспечивает отправку лучшего результата в LMS,
  даже если последняя попытка неудачна.
- **Retry в телеметрии**: модуль телеметрии имеет буфер повторных попыток и обработку
  offline-состояния.

---

## Приоритет реализации

| Приоритет | Решение | Обоснование |
| --- | --- | --- |
| 1 (критический) | S1 -- Pre-commit score | Закрывает самый частый сценарий потери данных |
| 2 (высокий) | S4 -- Унификация score | Простое исправление, устраняет несогласованность |
| 3 (высокий) | S3 -- Контроль suspend\_data | Предотвращает тихую потерю всей истории попыток |
| 4 (средний) | S2 -- Retry для SCORM API | Повышает устойчивость ко временным сбоям |
| 5 (средний) | S5 -- Предупреждение standalone | Улучшает диагностику проблем |
| 6 (средний) | S7 -- Health check | Раннее обнаружение потери связи |
| 7 (низкий) | S6 -- Двойное объявление | Чистка кода, устранение хрупкости |
