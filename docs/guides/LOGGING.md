# Логирование

Данный документ определяет конвенции структурированного логирования для всех стеков.
Языкозависимая настройка вынесена в отдельные разделы; принципы применяются везде.

## Содержание

- [Принципы](#принципы)
- [Уровни логирования](#уровни-логирования)
- [Структурированное логирование](#структурированное-логирование)
- [Correlation ID — сквозная трассировка запросов](#correlation-id--сквозная-трассировка-запросов)
- [JavaScript / TypeScript — pino](#javascript--typescript--pino)
- [Матрица принятия решений: pino vs pino-logger-tree](#матрица-принятия-решений-pino-vs-pino-logger-tree)
- [Иерархическое логирование — pino-logger-tree](#иерархическое-логирование--pino-logger-tree)
- [Python — structlog](#python--structlog)
- [Чувствительные данные](#чувствительные-данные)
- [Антипаттерны](#антипаттерны)
- [См. также](#см-также)

---

## Принципы

### Структура вместо строк

Каждая запись лога — машиночитаемый JSON-объект в production. Поле `msg` — короткое
человекочитаемое описание; все переменные данные — в именованных полях.

```text
// Правильно
{ "level": "info", "msg": "Plan created", "planId": "uuid-1", "userId": "uuid-2" }

// Неправильно — переменные встроены в текст, не ищутся как поля
{ "level": "info", "msg": "Plan uuid-1 created by user uuid-2" }
```

### Логировать на границах, а не внутри циклов

Логировать на входе/выходе значимых операций и на границах системы (HTTP-запросы,
вызовы внешних API, запуск/завершение job). Не логировать каждую итерацию цикла —
один суммарный лог после цикла.

### Секреты в логи не попадают

Пароли, токены, API-ключи, ключи шифрования, персональные идентификаторы не должны
попадать в вывод никогда. Редакция настраивается на уровне конфигурации логгера,
а не в каждом отдельном вызове.

### Дисциплина уровней

Использовать минимальный уровень, соответствующий реальной серьёзности события.
Ложные ERROR притупляют реакцию дежурных на настоящие проблемы.

---

## Уровни логирования

| Уровень | Когда использовать | Пример |
| --- | --- | --- |
| `trace` | Глубокий внутренний поток; включается по модулю при отладке | Детали итерации цикла, сырые SQL-параметры |
| `debug` | Полезен при разработке и целевой диагностике в production | Вызов метода сервиса, промежуточное значение |
| `info` | Нормальные бизнес-события, важные в production | Job завершён, план создан, пользователь вошёл |
| `warn` | Неожиданная, но восстановимая ситуация; требует внимания | Отсутствует конфиг-значение, используется fallback |
| `error` | Операция завершилась неудачей; требуется вмешательство человека | Внешний API недоступен, SQL-запрос провалился |
| `fatal` | Приложение не может продолжать работу; требуется перезапуск | Потеря соединения с БД при старте |

### Правила выбора уровня

- **info** — событие важно для понимания работы системы в production.
- **debug** — событие нужно только при диагностике проблем.
- **trace** — событие нужно только для пошаговой отладки.
- **warn** — система восстановилась автоматически, но условие не должно сохраняться.
- **error** — пользовательская операция провалилась или фоновый job требует повторной попытки.
- Не использовать **error** для ожидаемых условий (`user not found`, ошибка валидации).

---

## Структурированное логирование

### Соглашения о полях

Использовать единые имена полей во всех сервисах:

| Поле | Тип | Значение |
| --- | --- | --- |
| `userId` | string (UUID) | Аутентифицированный пользователь, выполняющий действие |
| `requestId` | string | Корреляционный ID на протяжении жизни запроса |
| `jobId` | string | Идентификатор фонового job |
| `duration` | number (мс) | Прошедшее время операции |
| `err` | объект ошибки | Исключение; всегда включать на error/fatal |
| `service` | string | Префикс подсистемы: `rate-worker`, `budget-api` |

### Формат сообщения

Поле `msg` — статическое, без интерполяции. Переменные данные — в именованных полях.

```text
// Правильно
logger.info({ planId, userId }, "Budget plan created")

// Неправильно — переменная встроена в msg, не ищется как поле
logger.info(`Budget plan ${planId} created by ${userId}`)
```

Исключение: уровни `debug` и `trace`, где читаемость важнее агрегации в лог-системах.
Template-литералы там допустимы.

### Логирование ошибок

Всегда передавать объект ошибки в поле `err`, не как строку.

```text
// Правильно — stack trace сохраняется
logger.error({ err: error, jobId }, "Rate sync job failed")

// Неправильно — stack trace теряется
logger.error("Rate sync failed: " + error.message)
```

---

## Correlation ID — сквозная трассировка запросов

Correlation ID (он же Request ID) — уникальный идентификатор, который генерируется при
входе запроса в систему и проходит через все лог-записи, связанные с этим запросом.
Без него невозможно собрать полную картину обработки запроса из логов нескольких сервисов
или слоёв приложения.

### Стандарт заголовка

Входящий HTTP-заголовок: `X-Request-ID`.
Если заголовок отсутствует — генерируется UUID v4 на стороне сервера.
Значение возвращается клиенту в ответе в том же заголовке.

```text
// Входящий запрос
GET /api/v1/budget-plans HTTP/1.1
X-Request-ID: 01J3K8M2P4Q6R8S0T2V4W6X8

// Ответ сервера
HTTP/1.1 200 OK
X-Request-ID: 01J3K8M2P4Q6R8S0T2V4W6X8
```

### Обязательные поля в каждой лог-записи

Каждая запись лога, связанная с обработкой запроса или фоновой задачи, обязана содержать:

| Поле | Тип | Источник |
| --- | --- | --- |
| `requestId` | string | `X-Request-ID` или сгенерированный UUID |
| `userId` | string (UUID) | Декодированный токен аутентификации |
| `service` | string | Имя подсистемы: `budget-api/http`, `rate-worker` |

Для фоновых задач `requestId` заменяется на `jobId`; `userId` присутствует, если задача
запущена в контексте конкретного пользователя.

### TypeScript — middleware

```typescript
// middleware/request-id.ts
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}
```

```typescript
// middleware/request-logger.ts — дочерний логгер с requestId на каждый запрос
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.log = logger.child({
    requestId: req.requestId,
    userId: req.user?.id,
    method: req.method,
    url: req.url,
  });
  req.log.info('request_received');

  res.on('finish', () => {
    req.log.info({ status: res.statusCode, duration: Date.now() - req.startTime }, 'request_completed');
  });

  next();
}
```

```typescript
// Использование в сервисном слое — передавать requestId явно или через AsyncLocalStorage
export async function createPlan(dto: CreatePlanDto, ctx: RequestContext): Promise<Plan> {
  const log = logger.child({ requestId: ctx.requestId, userId: ctx.userId });
  log.debug({ dto }, 'creating_budget_plan');
  const plan = await repo.insert(dto);
  log.info({ planId: plan.id }, 'budget_plan_created');
  return plan;
}
```

### Python — middleware (FastAPI)

structlog поддерживает контекстные переменные (`contextvars`), которые автоматически
включаются во все записи в рамках одного async-контекста.

```python
# middleware/logging.py
import structlog
from uuid import uuid4
from structlog.contextvars import bind_contextvars, clear_contextvars
from fastapi import Request

async def logging_middleware(request: Request, call_next):
    clear_contextvars()
    request_id = request.headers.get("x-request-id", str(uuid4()))

    bind_contextvars(
        request_id=request_id,
        method=request.method,
        path=request.url.path,
    )

    # Возвращаем request_id клиенту
    response = await call_next(request)
    response.headers["x-request-id"] = request_id

    log = structlog.get_logger()
    log.info("request_completed", status=response.status_code)
    return response
```

```python
# После bind_contextvars — request_id автоматически в каждой записи
async def create_plan(input_data: CreatePlanInput, user_id: str) -> Plan:
    log = structlog.get_logger()
    log.info("budget_plan_created", plan_id=str(plan.id))  # request_id добавлен автоматически
```

### Результат в логах

Все записи одного запроса связаны по `requestId` — их можно агрегировать и фильтровать:

```json
{"level":"info","requestId":"01J3K8M2","userId":"user-42","msg":"request_received","method":"POST","url":"/api/v1/budget-plans"}
{"level":"debug","requestId":"01J3K8M2","userId":"user-42","service":"budget-api/domain/plans","msg":"creating_budget_plan"}
{"level":"info","requestId":"01J3K8M2","userId":"user-42","service":"budget-api/domain/plans","planId":"plan-99","msg":"budget_plan_created"}
{"level":"info","requestId":"01J3K8M2","userId":"user-42","status":201,"duration":34,"msg":"request_completed"}
```

---

## JavaScript / TypeScript — pino

[pino](https://getpino.io/) — рекомендованный логгер для Node.js. Пишет
newline-delimited JSON в stdout; в production потребляется агрегаторами логов,
локально форматируется через `pino-pretty`.

### Установка

```bash
pnpm add pino
pnpm add -D pino-pretty
```

### Инициализация логгера

```typescript
import pino from 'pino';

const isDev = process.env['NODE_ENV'] !== 'production';

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? (isDev ? 'debug' : 'info'),
  redact: {
    paths: ['password', 'secret', 'token', 'apiKey', '*.password', '*.token'],
    remove: true,
  },
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
});
```

### Дочерние логгеры

Создавать child-логгер на каждый запрос или job для автоматического добавления
контекста корреляции.

```typescript
export async function handleRequest(req: Request): Promise<void> {
  const log = logger.child({ requestId: req.id, userId: req.user?.id });
  log.info({ method: req.method, url: req.url }, 'Request received');

  try {
    const result = await processRequest(req);
    log.info({ status: 200 }, 'Request completed');
    return result;
  } catch (err) {
    log.error({ err, status: 500 }, 'Request failed');
    throw err;
  }
}
```

### Логгер на уровне модуля

```typescript
const log = logger.child({ service: 'budget-api' });

export async function createPlan(input: CreatePlanInput): Promise<Plan> {
  log.debug({ input }, 'Creating budget plan');
  const plan = await repo.insert(input);
  log.info({ planId: plan.id }, 'Budget plan created');
  return plan;
}
```

### Интеграция с Fastify

```typescript
import Fastify from 'fastify';

const app = Fastify({
  logger: {
    level: process.env['LOG_LEVEL'] ?? 'info',
    redact: ['req.headers.authorization', 'req.body.password'],
    transport: isDev ? { target: 'pino-pretty' } : undefined,
  },
});
// request.log — pino child-логгер с requestId, автоматически привязанный фреймворком
```

### Матрица принятия решений: pino vs pino-logger-tree

Выбирать инструмент по характеристикам системы, а не по привычке.

| Признак системы | Простой pino | pino-logger-tree |
| --- | --- | --- |
| Lambda / CLI / одиночный скрипт | Рекомендуется | Избыточно |
| Один доменный слой, до 4 модулей | Рекомендуется | Необязательно |
| Многослойная архитектура: HTTP → сервис → репозиторий → внешний вызов | Допустимо | **Обязательно** |
| Пять и более независимых подсистем | Сложно поддерживать | **Обязательно** |
| Вложенные фоновые задачи с под-задачами | Сложно поддерживать | **Обязательно** |
| Монорепо: несколько пакетов с общим логгером | Требует ручного согласования | **Обязательно** |
| Независимое управление уровнями по подсистемам | Не поддерживается | **Обязательно** |
| Трассировка вызова через несколько уровней абстракции | Требует ручных полей | **Рекомендуется** |

Если хотя бы один признак с пометкой **Обязательно** применяется к системе — использовать `@vvlad1973/pino-logger-tree`.

---

### Иерархическое логирование — pino-logger-tree

Пакет `@vvlad1973/pino-logger-tree` организует логгеры сервиса в именованное дерево.
Каждый узел — pino child-логгер; путь от корня отражается в поле `service`.
Это позволяет фильтровать логи по подсистеме, управлять уровнями независимо и
видеть контекст вызова в каждой записи.

Применяется обязательно для всех TS/JS сервисов со сложной архитектурой
(критерии — в матрице выше).

#### Установка

```bash
pnpm add @vvlad1973/pino-logger-tree
```

#### Определение дерева логгеров

Дерево определяется один раз в отдельном файле. Каждый узел соответствует
независимой подсистеме.

```typescript
// src/logger.ts
import pino from 'pino';
import { createLoggerTree } from '@vvlad1973/pino-logger-tree';

const isDev = process.env['NODE_ENV'] !== 'production';

const root = pino({
  level: process.env['LOG_LEVEL'] ?? (isDev ? 'debug' : 'info'),
  redact: {
    paths: ['password', 'secret', 'token', 'apiKey', '*.password', '*.token'],
    remove: true,
  },
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
});

export const log = createLoggerTree(root, {
  name: 'budget-api',
  children: {
    http: { name: 'http' },
    domain: {
      name: 'domain',
      children: {
        plans: { name: 'plans' },
        rates: { name: 'rates' },
      },
    },
    db: { name: 'db' },
    jobs: {
      name: 'jobs',
      children: {
        rateSync: { name: 'rate-sync' },
      },
    },
  },
});
```

#### Использование в модулях

Каждый модуль берёт узел дерева, соответствующий его ответственности.

```typescript
// src/http/plans-router.ts
import { log } from '../logger';

export async function handleCreatePlan(req: Request): Promise<Response> {
  const reqLog = log.http.child({ requestId: req.id, userId: req.user?.id });
  reqLog.info({ method: req.method, url: req.url }, 'Request received');
  const plan = await createPlan(req.body);
  reqLog.info({ planId: plan.id, status: 201 }, 'Request completed');
  return new Response(JSON.stringify(plan), { status: 201 });
}
```

```typescript
// src/domain/plans-service.ts
import { log } from '../logger';

export async function createPlan(input: CreatePlanInput): Promise<Plan> {
  log.domain.plans.debug({ input }, 'Creating budget plan');
  const plan = await repo.insert(input);
  log.domain.plans.info({ planId: plan.id }, 'Budget plan created');
  return plan;
}
```

```typescript
// src/jobs/rate-sync-job.ts
import { log } from '../logger';

export async function runRateSyncJob(jobId: string): Promise<void> {
  const jobLog = log.jobs.rateSync.child({ jobId });
  jobLog.info('Job started');
  try {
    const count = await syncRates();
    jobLog.info({ count }, 'Job completed');
  } catch (err) {
    jobLog.error({ err }, 'Job failed');
    throw err;
  }
}
```

В каждой записи лога поле `service` несёт полный путь от корня: `budget-api/http`,
`budget-api/domain/plans`, `budget-api/jobs/rate-sync` — агрегатор может
группировать и фильтровать по нему без дополнительных полей.

---

## Python — structlog

[structlog](https://www.structlog.org/) предоставляет структурированное контекстное
логирование для Python. Оборачивает стандартный модуль `logging`; в production выводит JSON.

### Установка

```bash
pip install structlog
# или
uv add structlog
```

### Конфигурация

Вызывается один раз в точке входа приложения.

```python
import logging
import sys
import structlog


def configure_logging(level: str = "INFO", *, pretty: bool = False) -> None:
    """Configure structlog for the application.

    Args:
        level: Minimum log level (DEBUG, INFO, WARNING, ERROR).
        pretty: Use human-readable output instead of JSON (development only).
    """
    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]

    renderer = structlog.dev.ConsoleRenderer() if pretty else structlog.processors.JSONRenderer()

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelName(level.upper())
        ),
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(structlog.stdlib.ProcessorFormatter(
        processor=renderer,
        foreign_pre_chain=shared_processors,
    ))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
```

Вызов в точке входа:

```python
# main.py
configure_logging(
    level=os.getenv("LOG_LEVEL", "INFO"),
    pretty=os.getenv("ENV", "production") == "development",
)
```

### Использование в модуле

```python
import structlog

log = structlog.get_logger(__name__)


async def create_plan(input_data: CreatePlanInput) -> Plan:
    log.debug("creating_budget_plan", input=input_data.model_dump())
    plan = await repo.insert(input_data)
    log.info("budget_plan_created", plan_id=str(plan.id))
    return plan
```

### Контекст на уровне запроса

Привязать контекст в начале запроса; он автоматически включается во все последующие
вызовы логгера в рамках этого запроса.

```python
import structlog
from structlog.contextvars import bind_contextvars, clear_contextvars
from uuid import uuid4


async def logging_middleware(request: Request, call_next):
    clear_contextvars()
    bind_contextvars(
        request_id=request.headers.get("x-request-id", str(uuid4())),
        method=request.method,
        path=request.url.path,
    )
    log = structlog.get_logger()
    log.info("request_received")
    response = await call_next(request)
    log.info("request_completed", status=response.status_code)
    return response
```

### Логирование ошибок

```python
log = structlog.get_logger(__name__)

try:
    result = await fetch_rates(date)
except httpx.TimeoutException as exc:
    log.error("rate_fetch_timed_out", date=str(date), exc_info=exc)
    raise RateFetchError(date) from exc
```

### Логирование фоновых задач

```python
async def process_rate_sync_job(job_id: str, target_date: date) -> None:
    log = structlog.get_logger().bind(job_id=job_id, job_type="rate-sync")
    log.info("job_started")
    try:
        count = await sync_rates(target_date)
        log.info("job_completed", records_synced=count)
    except Exception as exc:
        log.error("job_failed", exc_info=exc)
        raise
```

---

## Чувствительные данные

Никогда не попадают в логи независимо от уровня:

- Пароли и их хеши
- JWT access- и refresh-токены
- API-ключи и брокерские учётные данные
- Ключи шифрования (`SECRET_KEY`, `ENCRYPTION_KEY`)
- Персональные идентификаторы там, где это регулируется (ИНН, номера паспортов)

Редакцию настраивать на уровне конфигурации логгера.

**TypeScript** — опция `redact` у pino (см. конфигурацию выше).

**Python** — фильтр в цепочке процессоров structlog:

```python
SENSITIVE_KEYS = {"password", "secret", "token", "api_key", "authorization"}


def redact_sensitive(
    logger: object, method: str, event_dict: dict
) -> dict:
    """Remove sensitive keys from log event dict."""
    for key in SENSITIVE_KEYS:
        if key in event_dict:
            event_dict[key] = "***REDACTED***"
    return event_dict


# Добавить в shared_processors перед рендерером
shared_processors = [
    redact_sensitive,
    ...
]
```

---

## Антипаттерны

| Антипаттерн | Последствие |
| --- | --- |
| `print()` / `console.log()` в бизнес-логике | Не попадает в агрегаторы; нет уровня и контекста |
| Конкатенация строк в сообщении | Переменные данные не ищутся как поля |
| Логирование внутри плотных циклов без счётчика | Объём логов пропорционален объёму данных |
| Отсутствие поля `err` в error-логах | Stack trace не сохраняется |
| Уровень `error` для ожидаемых условий | Alert fatigue; реальные ошибки игнорируются |
| Редакция секретов в каждом вызове вместо конфигурации | Один пропущенный вызов раскрывает секрет |
| Перехват и проглатывание исключений без логирования | Тихие сбои; невозможно диагностировать |
| Единый плоский логгер в многослойной TS/JS архитектуре | Невозможно изолировать логи подсистемы; нет независимого управления уровнями |

---

## См. также

- [CODE_STYLE.md](../code/CODE_STYLE.md) — конвенции именования и документирования
- [LINTING.md](../code/LINTING.md) — настройка статического анализа
- [ARTIFACT_STANDARDS.md § 11](../process/ARTIFACT_STANDARDS.md#11-отчёт-security-review) — чувствительные данные в security review
