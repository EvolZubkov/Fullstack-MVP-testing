# PRD-55. Вес задания по экспозиции при выдаче — план реализации

> **Для исполнителя:** задачи выполняются по одной, сверху вниз, в режиме TDD: сначала падающий тест,
> потом минимальная реализация, потом прогон, потом коммит. Шаги отмечены чекбоксами (`- [ ]`).

**Цель:** снизить вероятность выпадения часто выдававшихся заданий, не нарушив ни квот выдачи
PRD-11, ни сопоставимости форм, и сделать это одинаково на обоих хостах.

**Архитектура:** материализованный счётчик выдач (`question_exposure`, корзина — календарный месяц)
пополняется вебом и телеметрией; чистый модуль `shared/draw/exposure.ts` превращает счётчики в веса
и выбирает задания методом ключей; `drawSection` переходит с инъектируемого `shuffle` на
инъектируемый `pick`, поэтому равномерный отбор становится частным случаем взвешенного. Пакет
автономен и получает вес запечённым в `TEST_DATA`.

**Технологии:** TypeScript, Drizzle ORM, PostgreSQL, Vitest, plain-JS рантайм пакета.

**Спецификация:** [docs/specs/prd-55/item-exposure-weighting.md](../specs/prd-55/item-exposure-weighting.md).
Номера `FR-NN` ниже ссылаются на неё.

## Что нужно знать до начала

- **Vitest запускается ТОЛЬКО через npm:** `npm test -- <путь>`. Прямой `npx vitest run` в этом
  проекте падает.
- **Полный прогон (`npm test` без пути) не запускать** — он занимает около восьми минут и забирает
  машину. Во время работы только точечные прогоны.
- **`npm run check` бывает ложно-зелёным:** кэш `tsc` общий для всех worktree. Если правка типов
  «не видна», удалить `.tsbuildinfo` и повторить.
- **Дев-база общая для всех сессий.** Миграция, применённая здесь, видна всем; destructive-шагов в
  этом плане нет, все изменения аддитивные.
- **Интеграционные тесты идут на pglite:** `npm run test:it`. Схема для них лежит отдельным DDL в
  `tests/it/schema.sql` и НЕ генерируется из модели — новую таблицу туда нужно дописать руками,
  иначе `it`-тесты упадут на «relation does not exist» (прецедент: миграция `0030`, коммит
  `f6fb3811`).
- **Байт-идентичность пакетов.** В `server/scorm/builders/test-json.ts` необязательные поля
  добавляются в `TEST_DATA` условно, чтобы пакеты нетронутых тестов собирались байт-в-байт как
  раньше. Вес экспозиции подчиняется тому же правилу.

---

## Этап Э1. Счётчик выдач

### Задача 1. Таблица `question_exposure`

**Файлы:**

- Изменить: `shared/schema.ts` (объявление таблицы и типов)
- Создать: `drizzle/0031_prd55_question_exposure.sql` (генерируется, не пишется руками)
- Изменить: `tests/it/schema.sql` (DDL для pglite)

- [ ] **Шаг 1. Объявить таблицу в модели**

В `shared/schema.ts`, рядом с прочими таблицами доменa выдачи:

```ts
/**
 * PRD-55: материализованный счётчик выдач задания. Корзина — календарный месяц (FR-05),
 * поэтому скользящее окно считается суммой последних N корзин, а выпавшие из окна строки
 * удаляются уборкой без пересчёта. Разбивка по тесту нужна отчёту автору (FR-06);
 * взвешивание берёт СУММУ по всем тестам.
 */
export const questionExposure = pgTable("question_exposure", {
  questionId: varchar("question_id", { length: 36 }).notNull(),
  testId: varchar("test_id", { length: 36 }).notNull(),
  bucketMonth: date("bucket_month").notNull(),
  deliveredCount: integer("delivered_count").notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.questionId, t.testId, t.bucketMonth] }),
}));

export type QuestionExposure = typeof questionExposure.$inferSelect;
export type InsertQuestionExposure = typeof questionExposure.$inferInsert;
```

Если `date` и `primaryKey` ещё не импортированы в этом файле — добавить их в импорт из
`drizzle-orm/pg-core`.

- [ ] **Шаг 2. Сгенерировать миграцию**

Выполнить: `npx drizzle-kit generate`

Ожидается: создан файл `drizzle/0031_*.sql` с `CREATE TABLE "question_exposure"`. Переименовать
его в `0031_prd55_question_exposure.sql` и поправить имя в `drizzle/meta/_journal.json`, если
генератор дал другое.

- [ ] **Шаг 3. Применить миграцию к дев-базе**

Выполнить: `npm run db:migrate`
Ожидается: `applied 1 migration`, ошибок нет.

- [ ] **Шаг 4. Дописать DDL для pglite**

В `tests/it/schema.sql` добавить:

```sql
CREATE TABLE IF NOT EXISTS question_exposure (
  question_id varchar(36) NOT NULL,
  test_id varchar(36) NOT NULL,
  bucket_month date NOT NULL,
  delivered_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (question_id, test_id, bucket_month)
);
```

- [ ] **Шаг 5. Проверить типы**

Выполнить: `npm run check`
Ожидается: ошибок нет.

- [ ] **Шаг 6. Коммит**

```bash
git add shared/schema.ts drizzle/0031_prd55_question_exposure.sql drizzle/meta tests/it/schema.sql
git commit -m "feat(prd-55): таблица счётчика выдач задания"
```

### Задача 2. Репозиторий счётчика

**Файлы:**

- Создать: `server/storage/exposure-repository.ts`
- Изменить: `server/storage.ts` (методы в `IStorage` и делегирование)
- Создать: `tests/it/exposure-repository.it.test.ts`

- [ ] **Шаг 1. Написать падающий интеграционный тест**

Создать `tests/it/exposure-repository.it.test.ts`. Обвязка — `createHarness` из `./db-harness`,
поднятая через `vi.hoisted` + `vi.mock("../../server/db")`, ровно как в соседнем
`tests/it/lms-import.it.test.ts`: другого способа подменить подключение к базе в этом проекте нет.

```ts
/**
 * @module tests/it/exposure-repository
 *
 * PRD-55 (FR-05, FR-07): счётчик выдач копится по корзинам-месяцам и читается суммой за окно.
 * Круглый рейс на настоящей базе нужен из-за составного первичного ключа и `onConflictDoUpdate`:
 * инкремент существует только в базе, и ошибка в нём не уронит ни одного запроса — она проявится
 * позже, неверными весами выдачи.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { questionExposure } from "@shared/schema";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

let storage: typeof import("../../server/storage").storage;

beforeAll(async () => {
  h.current = await createHarness();
  ({ storage } = await import("../../server/storage"));
});
afterAll(async () => { await h.current?.close?.(); });
beforeEach(async () => { await h.current!.db.delete(questionExposure); });

describe("question_exposure", () => {
  it("складывает выдачи одного месяца в одну корзину", async () => {
    await storage.recordDeliveries(["q1", "q2"], "t1", new Date("2026-09-12"));
    await storage.recordDeliveries(["q1"], "t1", new Date("2026-09-20"));

    const counts = await storage.getDeliveryCounts(["q1", "q2"], new Date("2026-01-01"));
    expect(counts.get("q1")).toBe(2);
    expect(counts.get("q2")).toBe(1);
  });

  it("не берёт корзины старше окна", async () => {
    await storage.recordDeliveries(["q1"], "t1", new Date("2024-01-15"));
    await storage.recordDeliveries(["q1"], "t1", new Date("2026-09-01"));

    const counts = await storage.getDeliveryCounts(["q1"], new Date("2026-01-01"));
    expect(counts.get("q1")).toBe(1);
  });

  it("суммирует выдачи задания по РАЗНЫМ тестам", async () => {
    await storage.recordDeliveries(["q1"], "t1", new Date("2026-09-12"));
    await storage.recordDeliveries(["q1"], "t2", new Date("2026-09-12"));

    const counts = await storage.getDeliveryCounts(["q1"], new Date("2026-01-01"));
    expect(counts.get("q1")).toBe(2);
  });
});
```

Точные имена `Harness` (метод закрытия, поле `db`) сверить по `tests/it/db-harness.ts` — интерфейс
объявлен там же, строка 38.

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm run test:it -- tests/it/exposure-repository.it.test.ts`
Ожидается: FAIL — `storage.recordDeliveries is not a function`.

- [ ] **Шаг 3. Написать репозиторий**

Создать `server/storage/exposure-repository.ts`:

```ts
/**
 * @module server/storage/exposure-repository
 * @description PRD-55: доступ к материализованному счётчику выдач `question_exposure`.
 * Пишет ИНКРЕМЕНТОМ в корзину месяца (FR-07), читает сумму за окно (FR-04). Взвешивание берёт
 * сумму по всем тестам, поэтому чтение группирует только по заданию (FR-06). Выставляется через
 * фасад `IStorage`; маршруты этот модуль не импортируют.
 */
import { and, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { questionExposure } from "@shared/schema";

/** Первое число месяца этой даты — ключ корзины. */
function bucketOf(at: Date): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export class ExposureRepository {
  /** Плюс одна выдача каждому заданию в корзине месяца (FR-03: одна попытка — одна единица). */
  async recordDeliveries(questionIds: string[], testId: string, at: Date): Promise<void> {
    if (questionIds.length === 0) return;
    const bucketMonth = bucketOf(at);
    const rows = questionIds.map((questionId) => ({
      questionId, testId, bucketMonth, deliveredCount: 1,
    }));
    await db.insert(questionExposure).values(rows).onConflictDoUpdate({
      target: [questionExposure.questionId, questionExposure.testId, questionExposure.bucketMonth],
      set: { deliveredCount: sql`${questionExposure.deliveredCount} + 1` },
    });
  }

  /** Сумма выдач по каждому заданию начиная с корзины `since` (включительно). */
  async getDeliveryCounts(questionIds: string[], since: Date): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (questionIds.length === 0) return out;
    const rows = await db
      .select({
        questionId: questionExposure.questionId,
        total: sql<number>`sum(${questionExposure.deliveredCount})::int`,
      })
      .from(questionExposure)
      .where(and(
        inArray(questionExposure.questionId, questionIds),
        gte(questionExposure.bucketMonth, bucketOf(since)),
      ))
      .groupBy(questionExposure.questionId);
    for (const r of rows) out.set(r.questionId, Number(r.total));
    return out;
  }
}
```

- [ ] **Шаг 4. Подключить к фасаду**

В `server/storage.ts` добавить в `interface IStorage`:

```ts
  /** PRD-55 (FR-07): плюс одна выдача каждому заданию в корзине месяца. */
  recordDeliveries(questionIds: string[], testId: string, at: Date): Promise<void>;
  /** PRD-55 (FR-04): сумма выдач заданий за окно, по всем тестам. */
  getDeliveryCounts(questionIds: string[], since: Date): Promise<Map<string, number>>;
```

и делегирование в классе-реализации, по образцу соседних доменов:

```ts
  recordDeliveries(questionIds: string[], testId: string, at: Date) {
    return this.exposure.recordDeliveries(questionIds, testId, at);
  }
  getDeliveryCounts(questionIds: string[], since: Date) {
    return this.exposure.getDeliveryCounts(questionIds, since);
  }
```

Поле `private exposure = new ExposureRepository();` объявить там же, где объявлены остальные
репозитории.

- [ ] **Шаг 5. Прогнать тест**

Выполнить: `npm run test:it -- tests/it/exposure-repository.it.test.ts`
Ожидается: PASS, три теста.

- [ ] **Шаг 6. Коммит**

```bash
git add server/storage/exposure-repository.ts server/storage.ts tests/it/exposure-repository.it.test.ts
git commit -m "feat(prd-55): репозиторий счётчика выдач"
```

### Задача 3. Окно наблюдения в конфигурации

**Файлы:**

- Изменить: `config/config.jsonc`
- Изменить: `server/config.ts`
- Создать: `server/__tests__/config-exposure-window.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
/**
 * @module server/__tests__/config-exposure-window
 *
 * PRD-55 (FR-04): окно наблюдения — свойство инстанса, а не теста; отсутствие значения
 * означает 12 месяцев.
 */
import { describe, it, expect } from "vitest";
import { normalizeConfig } from "../config";

describe("delivery.exposureWindowMonths", () => {
  it("по умолчанию 12", () => {
    expect(normalizeConfig({}).delivery.exposureWindowMonths).toBe(12);
  });

  it("берёт значение из конфигурации", () => {
    const cfg = normalizeConfig({ delivery: { exposureWindowMonths: 6 } });
    expect(cfg.delivery.exposureWindowMonths).toBe(6);
  });

  it("отбрасывает бессмысленное значение", () => {
    const cfg = normalizeConfig({ delivery: { exposureWindowMonths: 0 } });
    expect(cfg.delivery.exposureWindowMonths).toBe(12);
  });
});
```

Имя разбирающей функции взять фактическое: открыть `server/config.ts` и посмотреть, как называется
экспортируемая нормализация (в файле она собирает объект из `asRecord`/`asString`). Если она не
экспортируется — экспортировать её именно для теста, не заводя второй копии разбора.

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- server/__tests__/config-exposure-window.test.ts`
Ожидается: FAIL — у конфигурации нет секции `delivery`.

- [ ] **Шаг 3. Добавить секцию в тип и разбор**

В `server/config.ts` — в интерфейс конфигурации:

```ts
  delivery: {
    /**
     * PRD-55 (FR-04): окно наблюдения экспозиции в месяцах. Свойство ЭКСПЛУАТАЦИИ банка, общее
     * для всех тестов инстанса, поэтому живёт здесь, а не в настройках теста.
     */
    exposureWindowMonths: number;
  };
```

и в сборку значения:

```ts
  const delivery = asRecord(raw.delivery);
  // ...
    delivery: {
      exposureWindowMonths: asPositiveInt(delivery.exposureWindowMonths, 12),
    },
```

Если помощника `asPositiveInt` в файле нет — добавить рядом с прочими `asX`:

```ts
function asPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
```

- [ ] **Шаг 4. Прописать значение в конфигурации**

В `config/config.jsonc` добавить секцию рядом с `analytics`:

```jsonc
  "delivery": {
    // PRD-55: за сколько последних месяцев считается экспозиция задания. Старые выдачи выпадают
    // из расчёта сами — «сброса отсчёта» в продукте нет.
    "exposureWindowMonths": 12
  },
```

- [ ] **Шаг 5. Прогнать тест**

Выполнить: `npm test -- server/__tests__/config-exposure-window.test.ts`
Ожидается: PASS, три теста.

- [ ] **Шаг 6. Коммит**

```bash
git add config/config.jsonc server/config.ts server/__tests__/config-exposure-window.test.ts
git commit -m "feat(prd-55): окно наблюдения экспозиции в конфигурации"
```

### Задача 4. Запись выдачи на вебе

**Файлы:**

- Изменить: `server/routes/attempts.ts` (после сборки `variant`, около строки 680)
- Создать: `tests/routes.attempts-exposure.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
/**
 * @module tests/routes.attempts-exposure
 *
 * PRD-55 (FR-01, FR-02): выдачей считается НАЧАТАЯ попытка, и счётчик получает все выданные
 * задания, а не только отвеченные.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const recordDeliveries = vi.fn();

vi.mock("../server/storage", () => ({
  storage: new Proxy({ recordDeliveries }, { get: (t, k) => (t as never)[k] ?? vi.fn() }),
}));

describe("старт попытки пополняет счётчик выдач", () => {
  beforeEach(() => recordDeliveries.mockClear());

  it("передаёт ВСЕ выданные задания и id теста", async () => {
    // Обвязку запроса собрать по образцу соседнего tests/routes.attempts.coverage.test.ts:
    // там уже есть готовая сборка приложения и авторизованного агента.
    // После POST /api/attempts:
    expect(recordDeliveries).toHaveBeenCalledTimes(1);
    const [questionIds, testId] = recordDeliveries.mock.calls[0];
    expect(questionIds).toHaveLength(3);
    expect(testId).toBe("test-1");
  });
});
```

Перед написанием открыть `tests/routes.attempts.coverage.test.ts` и повторить принятую там обвязку
(сборка express-приложения, мок хранилища, авторизация) — второй способ поднимать маршруты в этом
проекте заводить не нужно.

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/routes.attempts-exposure.test.ts`
Ожидается: FAIL — `recordDeliveries` не вызывался.

- [ ] **Шаг 3. Записать выдачу**

В `server/routes/attempts.ts`, сразу после того как собран полный список `allQuestionIds` и до
ответа клиенту:

```ts
    // PRD-55 (FR-01/FR-02): выдачей считается начатая попытка — состав формы уже зафиксирован,
    // и ответы для учёта не нужны. Счётчик не должен ронять старт попытки, поэтому сбой пишем
    // в лог и идём дальше: экспозиция — статистика, а не условие прохождения.
    try {
      await storage.recordDeliveries(allQuestionIds, test.id, new Date());
    } catch (e) {
      log.warn("scorm", `не удалось записать выдачу заданий попытки: ${String(e)}`);
    }
```

Имя и сигнатуру логгера взять фактические — посмотреть, как логирует соседний код в этом файле.

- [ ] **Шаг 4. Прогнать тест**

Выполнить: `npm test -- tests/routes.attempts-exposure.test.ts`
Ожидается: PASS.

- [ ] **Шаг 5. Коммит**

```bash
git add server/routes/attempts.ts tests/routes.attempts-exposure.test.ts
git commit -m "feat(prd-55): старт веб-попытки пополняет счётчик выдач"
```

### Задача 5. Запись выдачи из телеметрии

**Файлы:**

- Изменить: `server/routes/scorm-telemetry.ts` (около строки 107, создание прохождения)
- Создать: `tests/routes.scorm-telemetry-exposure.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
/**
 * @module tests/routes.scorm-telemetry-exposure
 *
 * PRD-55 (FR-07): телеметрия пополняет счётчик в момент СОЗДАНИЯ прохождения — событие
 * однократное, поэтому инкремент безопасен. Повторные отправки того же прохождения счётчик
 * не двигают.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const recordDeliveries = vi.fn();

describe("телеметрия пополняет счётчик выдач", () => {
  beforeEach(() => recordDeliveries.mockClear());

  it("пишет выданные задания один раз на прохождение", async () => {
    // По образцу существующего tests/routes.scorm-telemetry-analytics.test.ts.
    // Первый POST создаёт прохождение:
    expect(recordDeliveries).toHaveBeenCalledTimes(1);
    // Второй POST по тому же sessionId/attemptNumber прохождение НЕ создаёт:
    expect(recordDeliveries).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/routes.scorm-telemetry-exposure.test.ts`
Ожидается: FAIL — вызовов нет.

- [ ] **Шаг 3. Записать выдачу**

В `server/routes/scorm-telemetry.ts`, внутри ветки, где прохождение именно СОЗДАЁТСЯ
(`storage.createScormAttempt`), сразу после создания:

```ts
      // PRD-55 (FR-07): инкремент привязан к СОЗДАНИЮ прохождения — единственному однократному
      // событию телеметрии. Обновления того же прохождения счётчик не трогают.
      const deliveredIds = /* список выданных заданий из тела запроса */;
      if (attempt.testId && deliveredIds.length) {
        try {
          await storage.recordDeliveries(deliveredIds, attempt.testId, new Date());
        } catch (e) {
          log.warn("scorm", `не удалось записать выдачу заданий телеметрии: ${String(e)}`);
        }
      }
```

Откуда взять `deliveredIds`: в теле запроса телеметрии уже передаётся состав прохождения — открыть
обработчик и взять тот же массив, из которого пишутся строки `scorm_answers`. Если состав приходит
позже ответов, а не вместе с созданием прохождения, инкремент перенести в то место, где список
известен впервые, сохранив условие «ровно один раз на прохождение» (проверка по тому же признаку,
по которому код отличает создание от обновления).

- [ ] **Шаг 4. Прогнать тест**

Выполнить: `npm test -- tests/routes.scorm-telemetry-exposure.test.ts`
Ожидается: PASS.

- [ ] **Шаг 5. Коммит**

```bash
git add server/routes/scorm-telemetry.ts tests/routes.scorm-telemetry-exposure.test.ts
git commit -m "feat(prd-55): телеметрия пополняет счётчик выдач"
```

### Задача 6. Служебный пересчёт и уборка

**Файлы:**

- Создать: `scripts/db/rebuild-exposure.ts`
- Изменить: `package.json` (скрипт `exposure:rebuild`)

- [ ] **Шаг 1. Написать скрипт**

Создать `scripts/db/rebuild-exposure.ts` по образцу соседних скриптов каталога `scripts/db`
(они уже умеют подключаться к базе и печатать итог):

```ts
/**
 * @module scripts/db/rebuild-exposure
 * @description PRD-55 (FR-11): пересобирает `question_exposure` из фактов — состава веб-попыток
 * (`attempts.variant_json`) и строк телеметрии. Нужен дважды: разовой засыпкой при внедрении и
 * лечением расхождений. Заодно убирает корзины старше окна (FR-05).
 *
 * Запуск: npm run exposure:rebuild
 */
```

Скрипт обязан: очистить таблицу, пройти все попытки и прохождения, собрать пары
«задание × тест × месяц», записать агрегат пачками, удалить корзины старше окна из конфигурации,
напечатать итог — сколько строк собрано и сколько корзин удалено.

- [ ] **Шаг 2. Прописать команду**

В `package.json`, в `scripts`:

```json
    "exposure:rebuild": "tsx scripts/db/rebuild-exposure.ts",
```

- [ ] **Шаг 3. Прогнать на дев-базе**

Выполнить: `npm run exposure:rebuild`
Ожидается: печатает число собранных строк; повторный запуск даёт то же число (пересчёт
идемпотентен).

- [ ] **Шаг 4. Коммит**

```bash
git add scripts/db/rebuild-exposure.ts package.json
git commit -m "feat(prd-55): пересчёт счётчика выдач из фактов"
```

---

## Этап Э2. Веса и взвешенный отбор

### Задача 7. Расчёт весов

**Файлы:**

- Создать: `shared/draw/exposure.ts`
- Создать: `shared/draw/__tests__/exposure.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
/**
 * @module shared/draw/__tests__/exposure
 *
 * PRD-55 (FR-12 - FR-17): вес сравнителен внутри пула, ограничен пределом R и вырождается в
 * единицу, когда сравнивать нечего.
 */
import { describe, it, expect } from "vitest";
import { computeWeights, EXPOSURE_WEIGHT_RATIO } from "../exposure";

const counts = (pairs: Array<[string, number]>) => new Map(pairs);

describe("computeWeights", () => {
  it("равные счётчики дают равные веса", () => {
    const w = computeWeights(["a", "b", "c"], counts([["a", 5], ["b", 5], ["c", 5]]));
    expect([...w.values()]).toEqual([1, 1, 1]);
  });

  it("нет данных — все веса единичны", () => {
    const w = computeWeights(["a", "b"], counts([]));
    expect([...w.values()]).toEqual([1, 1]);
  });

  it("самое горячее задание получает 1, самое свежее — R", () => {
    const w = computeWeights(["a", "b"], counts([["a", 10], ["b", 0]]));
    expect(w.get("a")).toBe(1);
    expect(w.get("b")).toBe(EXPOSURE_WEIGHT_RATIO);
  });

  it("промежуточное задание раскладывается линейно", () => {
    const w = computeWeights(["a", "b", "c"], counts([["a", 10], ["b", 5], ["c", 0]]));
    expect(w.get("b")).toBeCloseTo(1 + (EXPOSURE_WEIGHT_RATIO - 1) * 0.5, 10);
  });

  it("отсутствующий в карте счётчик означает ноль выдач", () => {
    const w = computeWeights(["a", "b"], counts([["a", 4]]));
    expect(w.get("b")).toBe(EXPOSURE_WEIGHT_RATIO);
  });

  it("пустой пул даёт пустую карту", () => {
    expect(computeWeights([], counts([])).size).toBe(0);
  });

  it("единственное задание пула весит единицу", () => {
    const w = computeWeights(["a"], counts([["a", 99]]));
    expect(w.get("a")).toBe(1);
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- shared/draw/__tests__/exposure.test.ts`
Ожидается: FAIL — модуль `../exposure` не найден.

- [ ] **Шаг 3. Написать модуль**

Создать `shared/draw/exposure.ts`:

```ts
/**
 * @module shared/draw/exposure
 *
 * PRD-55: вес задания по накопленной экспозиции и взвешенный отбор без возвращения.
 *
 * Шкала СРАВНИТЕЛЬНАЯ и считается внутри пула, из которого идёт отбор (страта квоты PRD-11 либо
 * остаток раздела): она отвечает на вопрос «какое из этих заданий выдавалось реже», а не «много
 * ли это — 300 выдач». Поэтому банк, выданный целиком и равномерно, поправкой не искажается.
 *
 * Предел отношения весов — системная константа, а не настройка: без него вес вида 1/выдачи
 * вырождается в почти детерминированный обход банка, и на месте одной бреши открывается другая
 * (FR-13).
 *
 * Чистый модуль: никакой базы и никакого времени внутри. Плейн-JS двойник живёт в
 * `server/scorm/assets/app.js` и держится в парности golden-тестом
 * `tests/exposure-port.test.ts`.
 */

/** Предельное отношение вероятностей между самым свежим и самым горячим заданием пула (FR-13). */
export const EXPOSURE_WEIGHT_RATIO = 4;

/**
 * Веса заданий пула по счётчикам выдач за окно (FR-12).
 * Отсутствие задания в `counts` означает ноль выдач.
 */
export function computeWeights(
  poolIds: string[],
  counts: Map<string, number>,
): Map<string, number> {
  const weights = new Map<string, number>();
  if (poolIds.length === 0) return weights;

  const values = poolIds.map((id) => counts.get(id) ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);

  if (max === min) {
    for (const id of poolIds) weights.set(id, 1);
    return weights;
  }

  const span = max - min;
  for (let i = 0; i < poolIds.length; i += 1) {
    weights.set(poolIds[i], 1 + (EXPOSURE_WEIGHT_RATIO - 1) * ((max - values[i]) / span));
  }
  return weights;
}
```

- [ ] **Шаг 4. Прогнать тест**

Выполнить: `npm test -- shared/draw/__tests__/exposure.test.ts`
Ожидается: PASS, семь тестов.

- [ ] **Шаг 5. Коммит**

```bash
git add shared/draw/exposure.ts shared/draw/__tests__/exposure.test.ts
git commit -m "feat(prd-55): вес задания по экспозиции"
```

### Задача 8. Взвешенный отбор методом ключей

**Файлы:**

- Изменить: `shared/draw/exposure.ts`
- Изменить: `shared/draw/__tests__/exposure.test.ts`

- [ ] **Шаг 1. Дописать падающие тесты**

```ts
import { weightedPick } from "../exposure";

describe("weightedPick", () => {
  // При одинаковом U ключ U^(1/w) тем больше, чем больше вес: 0.5 < 0.5^(1/2) < 0.5^(1/4).
  const half = () => 0.5;

  it("при равном случайном числе порядок задаёт вес", () => {
    const pool = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const w = new Map([["a", 1], ["b", 4], ["c", 2]]);
    expect(weightedPick(pool, 3, w, half).map((q) => q.id)).toEqual(["b", "c", "a"]);
  });

  it("берёт ровно k заданий", () => {
    const pool = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const w = new Map([["a", 1], ["b", 4], ["c", 2]]);
    expect(weightedPick(pool, 2, w, half).map((q) => q.id)).toEqual(["b", "c"]);
  });

  it("k больше пула — возвращает весь пул", () => {
    const pool = [{ id: "a" }, { id: "b" }];
    const w = new Map([["a", 1], ["b", 1]]);
    expect(weightedPick(pool, 5, w, half)).toHaveLength(2);
  });

  it("пустой пул — пустой результат", () => {
    expect(weightedPick([], 3, new Map(), half)).toEqual([]);
  });

  it("вес по умолчанию — единица", () => {
    const pool = [{ id: "a" }, { id: "b" }];
    expect(weightedPick(pool, 2, new Map(), half)).toHaveLength(2);
  });

  it("при равных весах распределение равномерно", () => {
    const pool = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const w = new Map(pool.map((q) => [q.id, 1] as const));
    const hits: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    let seed = 1;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 4000; i += 1) {
      for (const q of weightedPick(pool, 1, w, rnd)) hits[q.id] += 1;
    }
    for (const id of ["a", "b", "c", "d"]) {
      expect(hits[id]).toBeGreaterThan(700);
      expect(hits[id]).toBeLessThan(1300);
    }
  });

  it("тяжёлое задание выпадает чаще лёгкого", () => {
    const pool = [{ id: "hot" }, { id: "fresh" }];
    const w = new Map([["hot", 1], ["fresh", EXPOSURE_WEIGHT_RATIO]]);
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let freshFirst = 0;
    for (let i = 0; i < 4000; i += 1) {
      if (weightedPick(pool, 1, w, rnd)[0].id === "fresh") freshFirst += 1;
    }
    expect(freshFirst).toBeGreaterThan(2400);
    expect(freshFirst).toBeLessThan(3600);
  });
});
```

- [ ] **Шаг 2. Убедиться, что тесты падают**

Выполнить: `npm test -- shared/draw/__tests__/exposure.test.ts`
Ожидается: FAIL — `weightedPick` не экспортируется.

- [ ] **Шаг 3. Реализовать отбор**

Дописать в `shared/draw/exposure.ts`:

```ts
/** Источник случайности: возвращает число из полуинтервала [0, 1). */
export type RandomFn = () => number;

/** Минимальный контракт отбираемого элемента. */
export interface Identified {
  id: string;
}

/**
 * Взвешенная выборка БЕЗ ВОЗВРАЩЕНИЯ методом ключей (FR-15): ключ элемента — `U^(1/w)`, берутся
 * `k` элементов с наибольшим ключом.
 *
 * При равных весах метод статистически неотличим от равномерного перемешивания — это и есть
 * механизм деградации (FR-16/FR-17): отдельной ветки «поправка выключена» в коде нет.
 */
export function weightedPick<T extends Identified>(
  pool: T[],
  k: number,
  weights: Map<string, number>,
  rnd: RandomFn,
): T[] {
  if (pool.length === 0 || k <= 0) return [];
  const keyed = pool.map((item) => {
    const w = weights.get(item.id) ?? 1;
    // U ровно ноль дало бы нулевой ключ у любого веса — сдвигаем в открытый интервал.
    const u = Math.min(Math.max(rnd(), Number.EPSILON), 1 - Number.EPSILON);
    return { item, key: Math.pow(u, 1 / w) };
  });
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, k).map((x) => x.item);
}
```

- [ ] **Шаг 4. Прогнать тесты**

Выполнить: `npm test -- shared/draw/__tests__/exposure.test.ts`
Ожидается: PASS, четырнадцать тестов.

- [ ] **Шаг 5. Коммит**

```bash
git add shared/draw/exposure.ts shared/draw/__tests__/exposure.test.ts
git commit -m "feat(prd-55): взвешенный отбор методом ключей"
```

### Задача 9. `drawSection` переходит с `shuffle` на `pick`

**Файлы:**

- Изменить: `shared/draw/blueprint.ts:45-107`
- Изменить: `shared/draw/feasibility.ts:142`
- Изменить: `server/routes/attempts.ts:662`
- Изменить: `tests/draw-blueprint-port.test.ts`
- Создать: `shared/draw/__tests__/blueprint-pick.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
/**
 * @module shared/draw/__tests__/blueprint-pick
 *
 * PRD-55 (FR-18): взвешенный отбор применяется в ОБЕИХ точках выдачи — и при наборе страты по
 * квоте, и при добивке остатка.
 */
import { describe, it, expect } from "vitest";
import { drawSection, type PickFn } from "../blueprint";

const q = (id: string, ...tags: string[]) => ({ id, tags });

/** Отбор, который всегда берёт последние k — так видно, что он вызван в обеих точках. */
const takeLast: PickFn = (pool, k) => pool.slice(-k);

describe("drawSection с инъектируемым pick", () => {
  it("зовёт pick при наборе страты", () => {
    const qs = [q("1", "A"), q("2", "A"), q("3")];
    const { selected } = drawSection(qs, 1, { strata: [{ tag: "A", count: 1 }] }, takeLast);
    expect(selected.map((x) => x.id)).toEqual(["2"]);
  });

  it("зовёт pick при добивке остатка", () => {
    const qs = [q("1", "A"), q("2"), q("3")];
    const { selected } = drawSection(qs, 2, { strata: [{ tag: "A", count: 1 }] }, takeLast);
    expect(selected.map((x) => x.id)).toEqual(["1", "3"]);
  });

  it("без чертежа берёт drawCount через pick", () => {
    const qs = [q("1"), q("2"), q("3")];
    const { selected } = drawSection(qs, 2, null, takeLast);
    expect(selected.map((x) => x.id)).toEqual(["2", "3"]);
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- shared/draw/__tests__/blueprint-pick.test.ts`
Ожидается: FAIL — тип `PickFn` не экспортируется.

- [ ] **Шаг 3. Поменять сигнатуру**

В `shared/draw/blueprint.ts` заменить тип и три места вызова:

```ts
/**
 * Отбор `k` заданий из пула. Равномерный отбор — частный случай взвешенного (PRD-55 FR-24),
 * поэтому второй реализации алгоритма выдачи в проекте не заводится.
 */
export type PickFn = <T extends DrawableQuestion>(pool: T[], k: number) => T[];
```

Тело функции: `shuffle(questions.slice()).slice(0, drawCount)` → `pick(questions.slice(), drawCount)`;
`shuffle(pool.slice()).slice(0, stratum.count)` → `pick(pool.slice(), stratum.count)`;
`shuffle(free.slice()).slice(0, remainder)` → `pick(free.slice(), remainder)`.
Параметр переименовать `shuffle: ShuffleFn` → `pick: PickFn`. Тип `ShuffleFn` удалить, если после
этого он больше нигде не используется (проверить: `grep -rn "ShuffleFn" shared server`).

Обновить шапочный комментарий модуля: `shuffle` в нём упомянут как инъектируемая зависимость.

- [ ] **Шаг 4. Обновить вызовы**

`shared/draw/feasibility.ts` — проверка осуществимости должна остаться РАВНОМЕРНОЙ (она отвечает на
вопрос «наберётся ли столько заданий», а не «каких именно»):

```ts
  const { selected, warnings } = drawSection(
    // ...
    (pool, k) => pool.slice(0, k),
  );
```

`server/routes/attempts.ts:662` — временно тот же равномерный отбор, веса подключаются следующей
задачей:

```ts
        const { selected } = drawSection(
          questions,
          section.drawCount,
          section.drawBlueprintJson,
          (pool, k) => shuffleInPlace(pool).slice(0, k),
        );
```

`tests/draw-blueprint-port.test.ts` — сценарии передают `identity`/`reverse` как перемешивания;
обернуть их в отбор:

```ts
const identity: PickFn = (pool, k) => pool.slice(0, k);
const reverse: PickFn = (pool, k) => pool.slice().reverse().slice(0, k);
```

- [ ] **Шаг 5. Найти оставшиеся вызовы**

Выполнить: `npx tsc --noEmit` (или `npm run check`)
Ожидается: компилятор перечислит все места, где ещё передаётся старый `shuffle`. Исправить каждое
по тому же образцу; новых поведенческих решений здесь не принимается.

- [ ] **Шаг 6. Прогнать тесты выдачи**

Выполнить: `npm test -- shared/draw tests/draw-blueprint-port.test.ts`
Ожидается: PASS, включая старые сценарии парности.

- [ ] **Шаг 7. Коммит**

```bash
git add shared/draw server/routes/attempts.ts tests/draw-blueprint-port.test.ts
git commit -m "refactor(prd-55): выдача принимает отбор, а не перемешивание"
```

### Задача 10. Веб считает веса на старте попытки

**Файлы:**

- Изменить: `server/routes/attempts.ts`
- Создать: `tests/routes.attempts-exposure-weights.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
/**
 * @module tests/routes.attempts-exposure-weights
 *
 * PRD-55 (FR-26): веса считаются на старте попытки по счётчикам за окно, одним запросом на все
 * задания разделов теста.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getDeliveryCounts = vi.fn(async () => new Map([["q-hot", 100]]));

describe("старт попытки учитывает экспозицию", () => {
  beforeEach(() => getDeliveryCounts.mockClear());

  it("читает счётчики один раз за попытку", async () => {
    // Обвязка — как в tests/routes.attempts-exposure.test.ts (задача 4).
    expect(getDeliveryCounts).toHaveBeenCalledTimes(1);
  });

  it("горячее задание выпадает реже свежего", async () => {
    // Банк из двух заданий, drawCount = 1, 200 стартов попытки:
    // q-hot (100 выдач) должен выпасть заметно реже q-fresh (0 выдач),
    // но не исчезнуть — предел отношения равен EXPOSURE_WEIGHT_RATIO.
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/routes.attempts-exposure-weights.test.ts`
Ожидается: FAIL — счётчики не читаются.

- [ ] **Шаг 3. Подключить веса**

В `server/routes/attempts.ts`, до цикла по разделам:

```ts
    // PRD-55 (FR-26): один запрос на все задания теста — веса считаются потом, внутри каждого
    // пула отдельно, поэтому нормировка остаётся пулевой (FR-12).
    const windowStart = new Date();
    windowStart.setMonth(windowStart.getMonth() - config.delivery.exposureWindowMonths);
    const exposureCounts = await storage.getDeliveryCounts(
      sections.flatMap((s) => s.questions.map((q) => q.id)),
      windowStart,
    );
```

Выражение, которым собираются все задания разделов, взять фактическое из этого файла — там уже
есть готовый список вопросов по каждому разделу.

И в самом вызове отбора:

```ts
        const { selected } = drawSection(
          questions,
          section.drawCount,
          section.drawBlueprintJson,
          (pool, k) => weightedPick(pool, k, computeWeights(pool.map((q) => q.id), exposureCounts), Math.random),
        );
```

- [ ] **Шаг 4. Прогнать тест**

Выполнить: `npm test -- tests/routes.attempts-exposure-weights.test.ts`
Ожидается: PASS.

- [ ] **Шаг 5. Прогнать смежные тесты выдачи**

Выполнить: `npm test -- tests/routes.attempts.coverage.test.ts tests/routes.attempts.test.ts`
Ожидается: PASS — состав выдачи мог стать другим, но квоты и количества обязаны остаться прежними.
Если тест падал на конкретном ожидаемом наборе заданий, это ожидаемое изменение: заменить проверку
набора проверкой размера и соблюдения квот.

- [ ] **Шаг 6. Коммит**

```bash
git add server/routes/attempts.ts tests/routes.attempts-exposure-weights.test.ts
git commit -m "feat(prd-55): веб-выдача учитывает экспозицию задания"
```

---

## Этап Э3. Паритет пакета

### Задача 11. Плейн-JS двойник весов и отбора

**Файлы:**

- Изменить: `server/scorm/assets/app.js` (рядом с `drawSection`, начало файла)
- Создать: `tests/exposure-port.test.ts`

- [ ] **Шаг 1. Написать падающий golden-тест**

```ts
/**
 * @module tests/exposure-port
 *
 * PRD-55 (FR-25): golden-парность веса и отбора. Рантайм пакета несёт РУЧНОЙ плейн-JS двойник
 * `shared/draw/exposure.ts`; обе реализации гоняются по одним входам, чтобы не разойтись молча.
 * Тот же приём, что в tests/draw-blueprint-port.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeWeights as tsWeights, weightedPick as tsPick } from "../shared/draw/exposure";

const src = readFileSync(resolve(process.cwd(), "server/scorm/assets/app.js"), "utf8");
function extract(name: string) {
  const m = src.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`${name} not found in assets/app.js`);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${m[0]}\n;return ${name};`)();
}
const portWeights = extract("computeExposureWeights") as typeof tsWeights;
const portPick = extract("weightedPick") as typeof tsPick;

const cases: Array<{ name: string; ids: string[]; counts: Array<[string, number]> }> = [
  { name: "равные счётчики", ids: ["a", "b", "c"], counts: [["a", 5], ["b", 5], ["c", 5]] },
  { name: "нет данных", ids: ["a", "b"], counts: [] },
  { name: "крайние значения", ids: ["a", "b"], counts: [["a", 10], ["b", 0]] },
  { name: "промежуточное", ids: ["a", "b", "c"], counts: [["a", 10], ["b", 5], ["c", 0]] },
  { name: "частичная карта", ids: ["a", "b"], counts: [["a", 4]] },
  { name: "один элемент", ids: ["a"], counts: [["a", 99]] },
];

describe("экспозиция — парность TS ↔ JS", () => {
  it.each(cases)("вес: $name", ({ ids, counts }) => {
    const a = tsWeights(ids, new Map(counts));
    const b = portWeights(ids, new Map(counts));
    expect([...b.entries()]).toEqual([...a.entries()]);
  });

  it.each(cases)("отбор: $name", ({ ids, counts }) => {
    const pool = ids.map((id) => ({ id }));
    const w = tsWeights(ids, new Map(counts));
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let seed2 = 42;
    const rnd2 = () => {
      seed2 = (seed2 * 1103515245 + 12345) % 2147483648;
      return seed2 / 2147483648;
    };
    const a = tsPick(pool, 2, w, rnd);
    const b = portPick(pool, 2, w, rnd2);
    expect(b.map((x: { id: string }) => x.id)).toEqual(a.map((x) => x.id));
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/exposure-port.test.ts`
Ожидается: FAIL — `computeExposureWeights not found in assets/app.js`.

- [ ] **Шаг 3. Написать двойник**

В `server/scorm/assets/app.js`, непосредственно перед `drawSection`:

```js
// PRD-55: вес задания по экспозиции — плейн-JS порт shared/draw/exposure.ts. Счётчики в пакет
// не попадают: рантайм получает УЖЕ посчитанный вес запечённым в TEST_DATA (FR-27/FR-28), а эти
// функции нужны, чтобы отбор внутри пула считался ровно так же, как на вебе. Держится в парности
// golden-тестом tests/exposure-port.test.ts.
var EXPOSURE_WEIGHT_RATIO = 4;

function computeExposureWeights(poolIds, counts) {
  var weights = new Map();
  if (poolIds.length === 0) return weights;
  var values = poolIds.map(function (id) {
    var c = counts.get(id);
    return c === undefined ? 0 : c;
  });
  var min = Math.min.apply(null, values);
  var max = Math.max.apply(null, values);
  if (max === min) {
    poolIds.forEach(function (id) { weights.set(id, 1); });
    return weights;
  }
  var span = max - min;
  for (var i = 0; i < poolIds.length; i += 1) {
    weights.set(poolIds[i], 1 + (EXPOSURE_WEIGHT_RATIO - 1) * ((max - values[i]) / span));
  }
  return weights;
}

function weightedPick(pool, k, weights, rnd) {
  if (pool.length === 0 || k <= 0) return [];
  var keyed = pool.map(function (item) {
    var w = weights.get(item.id);
    if (w === undefined) w = 1;
    var u = Math.min(Math.max(rnd(), Number.EPSILON), 1 - Number.EPSILON);
    return { item: item, key: Math.pow(u, 1 / w) };
  });
  keyed.sort(function (a, b) { return b.key - a.key; });
  return keyed.slice(0, k).map(function (x) { return x.item; });
}
```

- [ ] **Шаг 4. Прогнать golden-тест**

Выполнить: `npm test -- tests/exposure-port.test.ts`
Ожидается: PASS, двенадцать проверок.

- [ ] **Шаг 5. Коммит**

```bash
git add server/scorm/assets/app.js tests/exposure-port.test.ts
git commit -m "feat(prd-55): плейн-JS двойник веса и отбора с golden-парностью"
```

### Задача 12. Запекание веса в пакет

**Файлы:**

- Изменить: `server/scorm/builders/test-json.ts:435-470`
- Изменить: `server/scorm/build-export-data.ts` (чтение счётчиков на момент сборки)
- Создать: `tests/scorm-exposure-bake.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
/**
 * @module tests/scorm-exposure-bake
 *
 * PRD-55 (FR-27, FR-29, FR-30): вес уезжает в пакет готовым числом, нормированным в пределах
 * раздела, и добавляется в TEST_DATA ТОЛЬКО когда отличается от единицы — иначе пакеты
 * нетронутых тестов перестали бы быть байт-идентичными.
 */
import { describe, it, expect } from "vitest";
import { buildTestJson } from "../server/scorm/builders/test-json";

describe("вес экспозиции в TEST_DATA", () => {
  it("не появляется, когда счётчики пусты", () => {
    // data без exposureCounts → у вопросов нет поля exposureWeight
  });

  it("появляется числом 1..R при неравных счётчиках", () => {
    // раздел из двух вопросов, счётчики 10 и 0 → веса 1 и 4
  });

  it("нормируется в пределах РАЗДЕЛА, а не всего теста", () => {
    // два раздела с разными диапазонами счётчиков: в каждом свой минимум получает R
  });
});
```

Точное имя сборщика и форму входных данных взять из `server/scorm/builders/test-json.ts` — тест
обязан звать его так же, как это делают существующие тесты сборки пакета.

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/scorm-exposure-bake.test.ts`
Ожидается: FAIL — поля нет.

- [ ] **Шаг 3. Прочитать счётчики при сборке**

В `server/scorm/build-export-data.ts`, там где собирается `ExportData`, добавить чтение счётчиков за
окно по всем заданиям теста и положить их в собираемую структуру (`exposureCounts: Map<string, number>`).
Отладочный плеер PRD-18 использует того же сборщика, поэтому веса он получит автоматически — это
и требуется: отлаживать нужно то, что уезжает.

- [ ] **Шаг 4. Запечь вес**

В `server/scorm/builders/test-json.ts`, в объекте вопроса, рядом с прочими условными полями:

```ts
            // PRD-55 (FR-27): вес по накопленной экспозиции, нормированный В ПРЕДЕЛАХ РАЗДЕЛА на
            // момент сборки. Пакет автономен и счётчика по популяции не имеет, поэтому получает
            // готовое число. Поле добавляется ТОЛЬКО когда вес не равен единице — пакеты
            // нетронутых тестов остаются байт-идентичными (FR-30, то же правило, что у tags и
            // orderIndex выше).
            ...(sectionWeights.get(q.id) !== undefined && sectionWeights.get(q.id) !== 1
              ? { exposureWeight: sectionWeights.get(q.id) }
              : {}),
```

где `sectionWeights` считается один раз на раздел:

```ts
      const sectionWeights = computeWeights(s.questions.map((q) => q.id), data.exposureCounts ?? new Map());
```

- [ ] **Шаг 5. Прогнать тесты**

Выполнить: `npm test -- tests/scorm-exposure-bake.test.ts`
Ожидается: PASS.

- [ ] **Шаг 6. Проверить байт-идентичность**

Выполнить: `npm run scorm:sample`
Ожидается: пакет собирается; у теста без накопленных выдач в `TEST_DATA` НЕТ ни одного
`exposureWeight`.

- [ ] **Шаг 7. Коммит**

```bash
git add server/scorm/builders/test-json.ts server/scorm/build-export-data.ts tests/scorm-exposure-bake.test.ts
git commit -m "feat(prd-55): вес экспозиции запекается в пакет"
```

### Задача 13. Рантайм пакета использует вес

**Файлы:**

- Изменить: `server/scorm/assets/app.js:243` (вызов `drawSection` в `generateVariant`)
- Изменить: `server/scorm/template/app/render/startPage.js` — если вызов выдачи живёт там
- Создать: `tests/scorm-exposure-runtime.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
/**
 * @module tests/scorm-exposure-runtime
 *
 * PRD-55 (FR-28): рантайм берёт запечённый вес и ничего не пересчитывает; отсутствие поля
 * означает единицу, поэтому пакеты, собранные до внедрения, играются как раньше.
 */
```

Тест собирает `TEST_DATA` из двух вопросов (один с `exposureWeight: 4`, другой без поля), гоняет
`generateVariant` с подменённым генератором случайных чисел и проверяет, что задание с бóльшим
весом выпадает чаще. Способ поднять функции рантайма в тесте — тот же, что в
`tests/exposure-port.test.ts`: вырезать функцию из `assets/app.js` и выполнить.

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/scorm-exposure-runtime.test.ts`
Ожидается: FAIL — вес игнорируется, распределение равномерное.

- [ ] **Шаг 3. Подключить вес в рантайме**

В `server/scorm/assets/app.js`, в месте вызова `drawSection` внутри `generateVariant`:

```js
      var drawn = drawSection(available, section.drawCount, section.drawBlueprint, function (pool, k) {
        // PRD-55 (FR-28): счётчиков у пакета нет — вес уже запечён в TEST_DATA. Карта строится
        // из поля вопроса; отсутствие поля означает единицу, то есть прежнее поведение.
        var weights = new Map();
        pool.forEach(function (q) { weights.set(q.id, q.exposureWeight === undefined ? 1 : q.exposureWeight); });
        return weightedPick(pool, k, weights, Math.random);
      });
```

- [ ] **Шаг 4. Прогнать тест**

Выполнить: `npm test -- tests/scorm-exposure-runtime.test.ts`
Ожидается: PASS.

- [ ] **Шаг 5. Проверить в локальном плеере**

Выполнить: `npm run scorm:sample`, затем `npm run scorm:player`
Ожидается: пакет играется, выдача набирается штатно, квоты соблюдены.

- [ ] **Шаг 6. Коммит**

```bash
git add server/scorm/assets/app.js tests/scorm-exposure-runtime.test.ts
git commit -m "feat(prd-55): рантайм пакета учитывает запечённый вес"
```

### Задача 14. Контрольный прогон сопоставимости форм

**Файлы:**

- Создать: `tests/exposure-fairness.test.ts`

- [ ] **Шаг 1. Написать тест-модель**

```ts
/**
 * @module tests/exposure-fairness
 *
 * PRD-55 (FR-21, FR-22): поправка обязана сокращать разброс показов и НЕ обязана смещать
 * трудность выдачи. Требование проверяемое, а не декларативное, — вот его проверка.
 */
import { describe, it, expect } from "vitest";
import { computeWeights, weightedPick } from "../shared/draw/exposure";

/** Банк из 25 заданий, выдача 20, 200 попыток. Счётчик копится по ходу, как в жизни. */
function simulate(weighted: boolean) {
  const bank = Array.from({ length: 25 }, (_, i) => ({
    id: `q${i}`,
    difficulty: (i % 5) * 25, // равномерный разброс трудности по банку
  }));
  const counts = new Map<string, number>();
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const difficulties: number[] = [];
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const weights = weighted
      ? computeWeights(bank.map((q) => q.id), counts)
      : new Map(bank.map((q) => [q.id, 1] as const));
    const form = weightedPick(bank, 20, weights, rnd);
    for (const q of form) counts.set(q.id, (counts.get(q.id) ?? 0) + 1);
    difficulties.push(form.reduce((s, q) => s + q.difficulty, 0) / form.length);
  }
  const shown = bank.map((q) => counts.get(q.id) ?? 0);
  const mean = shown.reduce((a, b) => a + b, 0) / shown.length;
  const spread = Math.sqrt(shown.reduce((a, b) => a + (b - mean) ** 2, 0) / shown.length);
  const avgDifficulty = difficulties.reduce((a, b) => a + b, 0) / difficulties.length;
  return { spread, avgDifficulty };
}

describe("экспозиция: честность поправки", () => {
  it("сокращает разброс числа показов", () => {
    expect(simulate(true).spread).toBeLessThan(simulate(false).spread);
  });

  it("не смещает среднюю трудность выданных форм", () => {
    const w = simulate(true).avgDifficulty;
    const u = simulate(false).avgDifficulty;
    expect(Math.abs(w - u)).toBeLessThan(2);
  });
});
```

- [ ] **Шаг 2. Прогнать**

Выполнить: `npm test -- tests/exposure-fairness.test.ts`
Ожидается: PASS. Если первый тест не проходит — значит предел `R` слишком мал для банка такого
размера; это находка для владельца, а не повод правкой теста замаскировать результат.

- [ ] **Шаг 3. Коммит**

```bash
git add tests/exposure-fairness.test.ts
git commit -m "test(prd-55): контрольный прогон сокращения разброса и сопоставимости форм"
```

### Задача 15. Документация этапов Э1-Э3

**Файлы:**

- Изменить: `docs/specs/prd-55/item-exposure-weighting.md` (шапка статуса)
- Изменить: `docs/ROADMAP.md` (строка трека)
- Изменить: `CLAUDE.md` (таблица `question_exposure` в разделе Database)

- [ ] **Шаг 1. Отметить состояние**

В шапке спецификации заменить «ТРЕБОВАНИЯ НА СОГЛАСОВАНИЕ, реализация не начата» на фактическое
состояние с перечнем закрытых этапов и датой.

- [ ] **Шаг 2. Провести проверки**

Выполнить: `npm run check`
Выполнить: `npm run lint:md`
Ожидается: обе команды чисты.

- [ ] **Шаг 3. Коммит**

```bash
git add docs CLAUDE.md
git commit -m "docs(prd-55): состояние трека после этапов Э1-Э3"
```

---

## Этап Э4. Показ автору

Эскиз [prd55-item-exposure.html](../wireframes/prd55-item-exposure.html) СОГЛАСОВАН 2026-09-12
(восемь состояний, проверен в браузере в обеих темах). Реализация идёт по нему; отступление от
эскиза — повод вернуться к нему, а не править на ходу.

Что показывается, по эскизу и FR-31 - FR-34:

- в карточке задания (аналитика теста → «Вопросы») ДВЕ новые величины рядом с долей верных:
  экспозиция «81% · выдано 46 из 57» и медиана времени «1:24 · по 31 ответу»;
- у задания, выдававшегося и в других тестах, — тег «ещё в N тестах» и строка «всего N показов»;
- пустой счётчик и отсутствие измерений времени дают ПРОЧЕРК, а не ноль;
- в редакторе под «Вопросов в тест» — баннер ожидаемой экспозиции: `warning` при доле ≥ 70%,
  `info` ниже неё; в свёрнутой теме та же величина хвостом сводки;
- в окне экспорта — баннер по худшей теме, экспорт не блокируется.

### Задача 16. Экспозиция и время в ответе аналитики теста

**Файлы:**

- Изменить: `server/routes/analytics/test-details.ts`
- Создать: `tests/routes.analytics-question-exposure.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

Тест поднимает маршрут по образцу `tests/routes.scorm-telemetry-analytics.test.ts` и проверяет, что
каждый элемент `questionStats` несёт:

```ts
expect(q).toMatchObject({
  exposureCount: 46,          // выдач задания в этом тесте за окно
  exposurePercent: 81,        // доля от попыток теста за окно
  globalExposureCount: 318,   // выдач по всем тестам — именно его берёт вес
  otherTestsCount: 2,         // в скольких ДРУГИХ тестах задание выдавалось
  latencyMedianMs: 84000,     // медиана времени
  latencySampleSize: 31,      // СВОЙ объём выборки: веб времени не даёт
});
```

Отдельными случаями: счётчик пуст → `exposureCount: 0`, `exposurePercent: null` (не ноль);
измерений времени нет → `latencyMedianMs: null`, `latencySampleSize: 0`.

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/routes.analytics-question-exposure.test.ts`
Ожидается: FAIL — полей нет.

- [ ] **Шаг 3. Добавить чтение счётчика и медианы**

В `server/routes/analytics/test-details.ts`, рядом со сборкой `questionStats`:

```ts
// PRD-55 (FR-31/FR-31a): экспозиция и время на задание. Счётчик читается ОДНИМ запросом на
// весь тест, медиана — из строк телеметрии и импорта: веб времени не измеряет вовсе, поэтому
// у неё СВОЙ объём выборки, и он уезжает рядом с величиной.
const windowStart = new Date();
windowStart.setMonth(windowStart.getMonth() - config.delivery.exposureWindowMonths);
const questionIds = [...questionStatsMap.keys()];
const exposureByTest = await storage.getDeliveryCountsForTest(questionIds, testId, windowStart);
const exposureGlobal = await storage.getDeliveryCounts(questionIds, windowStart);
const latency = await storage.getLatencyStats(questionIds, testId, windowStart);
```

`getDeliveryCounts` уже есть (Э1). Дописываются два метода репозитория экспозиции:
`getDeliveryCountsForTest` (та же сумма, но с фильтром `test_id`) и `getLatencyStats`
(медиана и число измерений по `scorm_answers.latency_ms`, `percentile_cont(0.5)`).

`exposurePercent` считается от числа попыток теста за окно; при нулевом знаменателе — `null`.
`otherTestsCount` — число РАЗЛИЧНЫХ `test_id` в счётчике задания, кроме текущего.

- [ ] **Шаг 4. Прогнать тест**

Выполнить: `npm test -- tests/routes.analytics-question-exposure.test.ts`
Ожидается: PASS.

- [ ] **Шаг 5. Коммит**

```bash
git add server/routes/analytics/test-details.ts server/storage/exposure-repository.ts server/storage.ts tests/routes.analytics-question-exposure.test.ts
git commit -m "feat(prd-55): аналитика теста отдаёт экспозицию и время задания"
```

### Задача 17. Две величины в карточке задания

**Файлы:**

- Изменить: `client/src/pages/author/test-analytics.tsx` (панель «Вопросы», около строки 936)
- Создать: `client/src/pages/author/__tests__/question-exposure-cell.test.tsx`

- [ ] **Шаг 1. Написать падающий тест**

Тест рендерит панель с фикстурой `questionStats` и проверяет: обе величины показаны, у времени
подписан объём выборки, пустые значения дают «—», тег «ещё в 2 тестах» появляется только при
`otherTestsCount > 0`.

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- client/src/pages/author/__tests__/question-exposure-cell.test.tsx`

- [ ] **Шаг 3. Добавить величины по эскизу**

Правый блок карточки становится `Cluster` из трёх `Stack` — доля верных (как было), экспозиция,
медиана времени. Своего CSS не добавляется: только DS-компоненты `Cluster`/`Stack`/`Text`/`Tag`.
Тон экспозиции: `warning` при `exposurePercent >= 70`, иначе `muted`.

- [ ] **Шаг 4. Прогнать тест**

Ожидается: PASS.

- [ ] **Шаг 5. Коммит**

### Задача 18. Баннер ожидаемой экспозиции в редакторе

**Файлы:**

- Изменить: `client/src/features/tests/editor/sections/topics-structure-section.tsx`
- Создать: `shared/draw/expected-exposure.ts` (+ тесты)

- [ ] **Шаг 1. Написать падающий тест чистой функции**

```ts
import { expectedExposure } from "@shared/draw/expected-exposure";

expect(expectedExposure({ drawCount: 20, poolSize: 25 })).toEqual({ percent: 80, tone: "warning" });
expect(expectedExposure({ drawCount: 10, poolSize: 80 })).toEqual({ percent: 13, tone: "info" });
expect(expectedExposure({ drawCount: 12, poolSize: 12 })).toEqual({ percent: 100, tone: "warning" });
expect(expectedExposure({ drawCount: 5, poolSize: 0 })).toBeNull();
```

Величина НЕ требует накопленных данных — она следует из настроек, поэтому живёт чистой функцией
и одинаково считается в редакторе, в сводке свёрнутой темы и в окне экспорта.

- [ ] **Шаг 2-4. Реализовать и подключить**

Баннер `Banner` ui-kit под строкой «Вопросов в тест», тон из функции; в свёрнутой теме — хвост
сводки «· увидят N%», подкрашенный при `tone === "warning"`.

- [ ] **Шаг 5. Коммит**

### Задача 19. Баннер в окне экспорта

**Файлы:**

- Изменить: место сборки пакета в интерфейсе (кнопка «Экспорт SCORM» в списке тестов)

Худшая тема теста по той же `expectedExposure`; экспорт не блокируется.

### Задача 20. Приёмка в браузере

ОБЯЗАТЕЛЬНА, потому что этап целиком про интерфейс. Проверяется на dev, по согласованному эскизу:
карточка задания с тремя величинами и прочерками, тег «ещё в N тестах», баннеры обоих тонов в
редакторе, хвост сводки у свёрнутой темы, баннер перед сборкой пакета. Отчёт — в `docs/reports/`.

## Этап Э5. Импорт как источник счётчика

**Не начинать до правки разбора выгрузки** (PA-12b BRD психометрики, BR-26-02a): пока импортёр
сводит пустую ячейку и нейтральный исход к одному значению, «задание не выдавалось» неотличимо от
измерительного задания, и счётчик по импортированным строкам считал бы выданным весь пакет целиком.

Состав этапа после той правки: пополнение счётчика ПЕРЕСЧЁТОМ среза партии и вычитание при откате
(FR-08), интеграционный тест «повторная загрузка того же файла не меняет счётчик, откат возвращает
прежнее значение».

---

## Самопроверка плана

Покрытие требований спецификации задачами:

| Требования | Задача |
| --- | --- |
| FR-01, FR-02, FR-03 | 4, 5 |
| FR-04 | 3, 10 |
| FR-05, FR-06 | 1, 2 |
| FR-07 | 4, 5 |
| FR-08, FR-09 | Э5 (заблокирован PA-12b) |
| FR-10 | 1 (каскад по заданию), 6 (пересчёт) |
| FR-11 | 6 |
| FR-12 - FR-14 | 7 |
| FR-15 - FR-17 | 8 |
| FR-18, FR-19, FR-20 | 9 |
| FR-21, FR-22 | 14 |
| FR-23, FR-24 | 7, 8, 9 |
| FR-25 | 11 |
| FR-26 | 10 |
| FR-27, FR-28, FR-29, FR-30 | 12, 13 |
| FR-31 - FR-34 | Э4 (после эскизов) |

Открытых мест, требующих решения по ходу, два, и оба названы в тексте задач: откуда телеметрия
берёт список выданных заданий (задача 5, шаг 3) и фактические имена сборщика `TEST_DATA` и
нормализации конфигурации (задачи 12 и 3) — их следует взять из кода, а не изобретать.
