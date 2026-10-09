# PRD-54. Импорт выгрузок отчётов LMS — план работ

> **Для исполнителя:** шаги помечены чекбоксами (`- [ ]`). Порядок задач менять нельзя. Три гейта:
> задача 1 (схема) — гейт для всех серверных задач; **задача 13 (эскизы) — гейт для всего интерфейса,
> это hard-правило проекта**; задача 15 (форма) — гейт для задачи 16 (точки входа).

**Цель:** выгрузку отчёта LMS в формате xlsx можно загрузить из трёх мест, и её строки попадают в
аналитику наравне с телеметрией — обезличенными, с меткой группы и, по желанию, связанными с
пользователем по внешнему ключу.

**Спека:** `docs/specs/prd-54/lms-export-import.md`.

**Архитектура:** разбор книги и кодирование ответов — два чистых модуля в `shared/`, без базы и без
Express. Сервер поверх них делает сопоставление с тестом, псевдонимы, связывание и upsert.
Хранилище общее с телеметрией: те же `scorm_attempts` и `scorm_answers` с колонкой `origin`, поэтому
аналитика получает импорт как второй источник, а не как третий. Клиент — одна форма на три точки
входа.

## Два инкремента

Работа разрезана надвое СОЗНАТЕЛЬНО, и граница проходит там, где начинается интерфейс.

**Инкремент 1 (задачи 1 — 12) — сервер, без единого пикселя.** Заканчивается одноразовым скриптом,
который прогоняет настоящую выгрузку `docs/references/7684237229762827328-1.xlsx` через тот же
`runImport`, что потом позовёт кнопка. Весь конвейер — разбор, псевдонимы, upsert, аналитика —
доказывается на реальных данных, пока рисовать ещё нечего. Если где-то ошибка, она вскрывается здесь,
на самом дешёвом этапе. Скрипт не выбрасывается: пока интерфейса нет, он же инструмент для заливок.

**Инкремент 2 (задачи 13 — 17) — интерфейс.** Начинается с эскизов, потому что в этом проекте UI
пишется только после сверки с ними. Сюда же перенесена колонка внешнего ключа в массовой загрузке
пользователей: доказать работоспособность она не помогает, а свой экран предпросмотра требует.

Инкремент 1 самодостаточен и проверяется точечными тестами плюс одним запуском скрипта. Начинать
инкремент 2 до того, как первый сошёлся на реальном файле, нельзя.

**Стек:** TypeScript, Drizzle ORM, PostgreSQL, Express, exceljs, React 19, Vitest,
DS `@skillum/ui-kit`.

**Прогон тестов:** только `npm test -- <путь>`. Полный `npm test` — НЕ запускать без явного
разрешения владельца (занимает около 8 минут и занимает машину).

**Общая dev-база.** Задача 1 меняет схему, которую делят все worktree: после неё чужие сессии не
поднимутся, пока не выполнят `npm run db:migrate`. Выполнять один раз, осознанно, предупредив.

---

## Инкремент 1 — сервер

---

## Задача 1: схема и миграция

**Файлы:**

- Правка: `shared/schema.ts` (таблицы `users`, `scormAttempts`, `scormAnswers`; новая `lmsImportBatches`)
- Создание: `drizzle/0029_prd54_lms_import.sql` (генерируется, руками не пишется)

- [ ] **Шаг 1: добавить таблицу партий в `shared/schema.ts`**

Рядом с `scormPackages` (около строки 1832):

```ts
/**
 * PRD-54: одна строка на загруженную выгрузку отчёта LMS.
 *
 * Хранит ровно столько, сколько нужно для аудита и отката: сам файл на диск не кладётся, от него
 * остаются имя и sha-256 содержимого. По хешу импорт отвечает «этот файл уже грузили», по
 * `batch_id` в `scorm_attempts` партия откатывается целиком.
 */
export const lmsImportBatches = pgTable("lms_import_batches", {
  id: varchar("id", { length: 36 }).primaryKey(),
  testId: varchar("test_id", { length: 36 }).notNull(),
  groupId: varchar("group_id", { length: 36 }),
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash").notNull(),
  anonymized: boolean("anonymized").notNull(),
  sourceAnonymized: boolean("source_anonymized").notNull(),
  linkUsers: boolean("link_users").notNull(),
  importedBy: varchar("imported_by", { length: 36 }).notNull(),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
  rowsTotal: integer("rows_total").notNull().default(0),
  rowsCreated: integer("rows_created").notNull().default(0),
  rowsUpdated: integer("rows_updated").notNull().default(0),
  rowsSkipped: integer("rows_skipped").notNull().default(0),
  rowsLinked: integer("rows_linked").notNull().default(0),
  warningsJson: jsonb("warnings_json"),
}, (table) => ({
  testIdIdx: index("lms_import_batches_test_id_idx").on(table.testId),
}));
```

- [ ] **Шаг 2: расширить `scormAttempts`**

В определении таблицы: снять `.notNull()` с `packageId` и `sessionId`, добавить колонки.

```ts
export const scormAttempts = pgTable("scorm_attempts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  // PRD-54: у импортированного прохождения пакета и сессии нет.
  packageId: varchar("package_id", { length: 36 }),
  sessionId: varchar("session_id", { length: 64 }),

  // PRD-54: тест прохождения. Backfill из scorm_packages.test_id; остаётся необязательным,
  // потому что у части старых пакетов тест уже удалён.
  testId: varchar("test_id", { length: 36 }),
  origin: text("origin", { enum: ["telemetry", "import"] }).notNull().default("telemetry"),
  batchId: varchar("batch_id", { length: 36 }),
  groupId: varchar("group_id", { length: 36 }),
  participantKey: text("participant_key"),
  userId: varchar("user_id", { length: 36 }),
  scalesJson: jsonb("scales_json"),
  variablesJson: jsonb("variables_json"),

  // ... остальные колонки без изменений ...
}, (table) => ({
  sessionAttemptIdx: uniqueIndex("scorm_attempts_session_attempt_idx")
    .on(table.packageId, table.sessionId, table.attemptNumber)
    .where(sql`${table.packageId} IS NOT NULL`),
  importRowIdx: uniqueIndex("scorm_attempts_import_row_idx")
    .on(table.testId, table.participantKey, table.startedAt)
    .where(sql`${table.origin} = 'import'`),
  testIdIdx: index("scorm_attempts_test_id_idx").on(table.testId),
}));
```

- [ ] **Шаг 3: починить `scormAnswers`**

```ts
  // PRD-54: у измерительного вопроса нет ни эталона, ни баллов, и он не может быть «неверным».
  // `result` — источник истины, `isCorrect` остаётся ради старых читателей.
  result: text("result", { enum: ["correct", "incorrect", "neutral"] }).notNull().default("incorrect"),
  isCorrect: boolean("is_correct"),
  points: integer("points"),
  maxPoints: integer("max_points"),
  correctAnswerJson: jsonb("correct_answer_json"),
```

- [ ] **Шаг 4: добавить внешний ключ пользователю**

В `users`:

```ts
  /** PRD-54: ключ, по которому импорт выгрузки LMS находит этого человека. Задаётся руками. */
  externalKey: text("external_key"),
```

- [ ] **Шаг 5: сгенерировать миграцию**

Выполнить: `npx drizzle-kit generate --name prd54_lms_import`
Ожидается: создан `drizzle/0029_prd54_lms_import.sql`, в `drizzle/meta/_journal.json` появилась запись `idx: 29`.

- [ ] **Шаг 6: дописать в миграцию backfill руками**

Drizzle генерирует только DDL. Открыть `drizzle/0029_prd54_lms_import.sql` и добавить В КОНЕЦ:

```sql
--> statement-breakpoint
UPDATE "scorm_attempts" a
   SET "test_id" = p."test_id"
  FROM "scorm_packages" p
 WHERE p."id" = a."package_id" AND a."test_id" IS NULL;--> statement-breakpoint
UPDATE "scorm_answers" SET "result" = CASE WHEN "is_correct" THEN 'correct' ELSE 'incorrect' END;--> statement-breakpoint
CREATE UNIQUE INDEX "users_external_key_idx" ON "users" (lower("external_key")) WHERE "external_key" IS NOT NULL;
```

Уникальный индекс по `lower()` пишется руками: drizzle-kit выражения в индексах не генерирует.

- [ ] **Шаг 7: применить и проверить**

Выполнить: `npm run db:migrate`
Затем: `npm run check`
Ожидается: миграция применена без ошибок, `tsc` без ошибок.

- [ ] **Шаг 8: коммит**

```bash
git add shared/schema.ts drizzle/0029_prd54_lms_import.sql drizzle/meta/
git commit -m "feat(prd-54): схема импорта выгрузок LMS и починка scorm_answers"
```

---

## Задача 2: параметр конфигурации

**Файлы:**

- Правка: `server/config.ts` (интерфейс около строки 58, сборка около строки 167)
- Правка: `config/development.config.jsonc`, `config/production.config.jsonc`, `config/test.config.jsonc`
- Тест: `server/__tests__/config.test.ts`

- [ ] **Шаг 1: написать падающий тест**

Создать `server/__tests__/config-lms-import.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shape } from "../config";

describe("analytics.lmsImport.anonymizeParticipants", () => {
  it("по умолчанию включено", () => {
    expect(shape({}).analytics.lmsImport.anonymizeParticipants).toBe(true);
  });

  it("выключается значением из файла", () => {
    const raw = { analytics: { lmsImport: { anonymizeParticipants: false } } };
    expect(shape(raw).analytics.lmsImport.anonymizeParticipants).toBe(false);
  });
});
```

- [ ] **Шаг 2: прогнать тест и убедиться, что он падает**

Выполнить: `npm test -- server/__tests__/config-lms-import.test.ts`
Ожидается: FAIL. Функция в коде называется `shape` (а не `normalizeConfig`) и не экспортирована —
экспортировать её, не переименовывая и не меняя поведения.

- [ ] **Шаг 3: добавить секцию в `AppConfig`**

После секции `limits`:

```ts
  /** PRD-54: поведение импорта выгрузок отчётов LMS. */
  analytics: {
    lmsImport: {
      /**
       * Хранить ли человекочитаемые поля участника. При `true` в базу идёт только псевдоним
       * `participant_key`; `lms_user_name`/`lms_user_email`/`lms_user_org` остаются пустыми.
       * Сам псевдоним считается ВСЕГДА — на нём держится ключ идемпотентности.
       */
      anonymizeParticipants: boolean;
    };
  };
```

- [ ] **Шаг 4: собрать значение**

Рядом со строкой `const limits = asRecord(raw.limits);`:

```ts
  const analytics = asRecord(raw.analytics);
  const lmsImport = asRecord(analytics.lmsImport);
```

И в возвращаемый объект:

```ts
    analytics: {
      lmsImport: {
        anonymizeParticipants: asBool(lmsImport.anonymizeParticipants, true),
      },
    },
```

- [ ] **Шаг 5: прогнать тест**

Выполнить: `npm test -- server/__tests__/config-lms-import.test.ts`
Ожидается: PASS, 2 теста.

- [ ] **Шаг 6: прописать параметр в файлы конфигурации**

Во все три файла `config/*.config.jsonc` добавить секцию с комментарием:

```jsonc
  // PRD-54. Импорт выгрузок отчётов LMS.
  "analytics": {
    "lmsImport": {
      // Хранить ли ФИО и организацию участника. true = в базе только псевдоним.
      "anonymizeParticipants": true
    }
  },
```

- [ ] **Шаг 8: прибраться в общей базе**

Откатить свои партии, снять проставленные ключи и остановить свой сервер: dev-база и машина общие.

- [ ] **Шаг 9: коммит**

```bash
git add server/config.ts server/__tests__/config-lms-import.test.ts config/
git commit -m "feat(prd-54): параметр обезличивания импорта в конфигурации"
```

---

## Задача 3: псевдоним участника

**Файлы:**

- Правка: `server/utils/crypto.ts`
- Тест: `server/utils/__tests__/participant-key.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { participantKey } from "../crypto";

describe("participantKey", () => {
  it("устойчив: одни и те же части дают один ключ", () => {
    expect(participantKey("Иванов Иван", "К-1", "ПАО")).toBe(participantKey("Иванов Иван", "К-1", "ПАО"));
  });

  it("не зависит от регистра и краевых пробелов", () => {
    expect(participantKey("  Иванов Иван ", "к-1", "ПАО")).toBe(participantKey("иванов иван", "К-1", "пао"));
  });

  it("разные участники дают разные ключи", () => {
    expect(participantKey("Иванов Иван", "", "ПАО")).not.toBe(participantKey("Петров Пётр", "", "ПАО"));
  });

  it("не содержит исходных данных", () => {
    expect(participantKey("Иванов Иван", "К-1", "ПАО")).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Шаг 2: прогнать и убедиться, что падает**

Выполнить: `npm test -- server/utils/__tests__/participant-key.test.ts`
Ожидается: FAIL, «participantKey is not a function».

- [ ] **Шаг 3: реализовать**

В `server/utils/crypto.ts` (`createHmac` дописать к существующему импорту из `node:crypto`):

```ts
/**
 * Псевдоним участника импортированного прохождения (PRD-54 раздел 4).
 *
 * HMAC под ключом инстанса, а не голый хеш: пространство ФИО мало, и по голому sha-256 участника
 * подбирают перебором за минуты. Метка назначения `prd54:participant` отделяет этот ключ от
 * ключа шифрования почт — один секрет, разные производные, чтобы утечка одного не вскрывала другое.
 *
 * Нормализация до HMAC обязательна: иначе « Иванов » и «иванов» разъедутся в разные ключи, и один
 * человек посчитается двумя.
 *
 * @param name ФИО из колонки «Пользователь»
 * @param code значение колонки «Код» (может быть пустым)
 * @param org значение колонки «Организация» (может быть пустым)
 * @returns 64 шестнадцатеричных знака
 */
export function participantKey(name: string, code: string, org: string): string {
  const norm = (v: string) => String(v ?? "").trim().toLowerCase();
  const secret = (config.encryption.password || "dev-default-key") + "|prd54:participant";
  // Части склеиваются ЧЕРЕЗ РАЗДЕЛИТЕЛЬ, а не встык: встык «Иванов» + «Ивк1» и «ИвановИв» + «к1»
  // дают одну строку и один ключ — два разных человека слились бы в одного молча.
  const material = [norm(name), norm(code), norm(org)].join(PARTICIPANT_KEY_SEPARATOR);
  return createHmac("sha256", secret).update(material).digest("hex");
}
```

- [ ] **Шаг 4: прогнать тест**

Выполнить: `npm test -- server/utils/__tests__/participant-key.test.ts`
Ожидается: PASS, 4 теста.

- [ ] **Шаг 5: коммит**

```bash
git add server/utils/crypto.ts server/utils/__tests__/participant-key.test.ts
git commit -m "feat(prd-54): псевдоним участника импортированного прохождения"
```

---

## Задача 4: кодирование и разбор ответов

**Файлы:**

- Создание: `shared/lms-export/response-codec.ts`
- Тест: `shared/lms-export/__tests__/response-codec.test.ts`

Это зеркало `formatResponse` из `server/scorm/template/app/render/resultsPage.js` (строки 852–882).
Кодировщик здесь нужен не ради использования, а ради теста на парность: две несогласованные копии
этого кода в проекте расходились уже дважды.

- [ ] **Шаг 1: написать падающий тест**

```ts
/**
 * @module shared/lms-export/__tests__/response-codec
 */
import { describe, it, expect } from "vitest";
import { decodeLearnerResponse, encodeLearnerResponse } from "../response-codec";

describe("decodeLearnerResponse", () => {
  it("одиночный выбор приходит 1-based и становится 0-based", () => {
    expect(decodeLearnerResponse("single", "3")).toBe(2);
    expect(decodeLearnerResponse("scale", "1")).toBe(0);
  });

  it("множественный выбор и ранжирование — списки 1-based", () => {
    expect(decodeLearnerResponse("multiple", "1,3,4")).toEqual([0, 2, 3]);
    expect(decodeLearnerResponse("ranking", "2,1,4,3")).toEqual([1, 0, 3, 2]);
  });

  it("сопоставление — пары лево-право, обе стороны 1-based", () => {
    expect(decodeLearnerResponse("matching", "1-2,2-1")).toEqual({ 0: 1, 1: 0 });
  });

  // ГОЧА PRD-54 раздел 7: у распределения баллов индексы 0-based, в отличие от всех остальных
  // типов. Строка взята из реальной выгрузки docs/references/7684237229762827328-1.xlsx.
  it("распределение баллов — индексы 0-based, разделитель [.]", () => {
    expect(decodeLearnerResponse("allocation", "0[.]1,1[.]5,2[.]1,3[.]0")).toEqual({ 0: 1, 1: 5, 2: 1, 3: 0 });
  });

  it("пустая строка — это отсутствие ответа", () => {
    expect(decodeLearnerResponse("single", "")).toBeNull();
    expect(decodeLearnerResponse("allocation", "   ")).toBeNull();
  });

  it("мусор не роняет разбор", () => {
    expect(decodeLearnerResponse("multiple", "a,b")).toBeNull();
  });
});

describe("парность кодирования и разбора", () => {
  const cases: Array<[string, unknown]> = [
    ["single", 2],
    ["scale", 0],
    ["multiple", [0, 2, 3]],
    ["ranking", [1, 0, 3, 2]],
    ["matching", { 0: 1, 1: 0 }],
    ["allocation", { 0: 1, 1: 5, 2: 1, 3: 0 }],
  ];

  it.each(cases)("%s: decode(encode(x)) === x", (type, answer) => {
    expect(decodeLearnerResponse(type, encodeLearnerResponse(type, answer as never))).toEqual(answer);
  });
});
```

- [ ] **Шаг 2: прогнать и убедиться, что падает**

Выполнить: `npm test -- shared/lms-export/__tests__/response-codec.test.ts`
Ожидается: FAIL, модуль не найден.

- [ ] **Шаг 3: реализовать модуль**

```ts
/**
 * @module shared/lms-export/response-codec
 * @description Кодирование и разбор строки `cmi.interactions.n.learner_response` (PRD-54 раздел 7).
 *
 * Зеркало `formatResponse` из пакета (`server/scorm/template/app/render/resultsPage.js`). Обе
 * половины лежат в ОДНОМ модуле и покрыты тестом на парность намеренно: копии этого кода в проекте
 * расходились дважды, и оба раза молча.
 *
 * ГОЧА ИНДЕКСОВ. Выбор, множественный выбор, ранжирование и сопоставление кодируются 1-based;
 * распределение баллов — 0-based. Это расхождение существует в выданных пакетах, поэтому разбор
 * обязан его воспроизводить. Выравнивание — отдельная задача вне PRD-54.
 */
import { distributesBudget, isSingleIndexChoice } from "../questions/question-type";

/** Ответ в той же форме, в какой его держат хосты: индекс, список индексов или карта. */
export type LearnerAnswer = number | number[] | Record<number, number>;

function toInt(raw: string): number | null {
  const n = Number(String(raw).trim());
  return Number.isInteger(n) ? n : null;
}

/**
 * Разобрать строку ответа из выгрузки.
 *
 * @param type тип вопроса
 * @param raw значение колонки «Полученный ответ»
 * @returns ответ в форме хоста либо `null`, если ответа нет или строка неразбираема
 */
export function decodeLearnerResponse(type: string, raw: string): LearnerAnswer | null {
  const s = String(raw ?? "").trim();
  if (s === "") return null;

  if (isSingleIndexChoice(type)) {
    const n = toInt(s);
    return n === null || n < 1 ? null : n - 1;
  }

  if (type === "multiple" || type === "ranking") {
    const parts = s.split(",").map(toInt);
    if (parts.some((n) => n === null || n < 1)) return null;
    return (parts as number[]).map((n) => n - 1);
  }

  if (type === "matching") {
    const out: Record<number, number> = {};
    for (const pair of s.split(",")) {
      const [l, r] = pair.split("-").map(toInt);
      if (l === null || r === null || l < 1 || r < 1) return null;
      out[l - 1] = r - 1;
    }
    return out;
  }

  if (distributesBudget(type)) {
    const out: Record<number, number> = {};
    for (const pair of s.split(",")) {
      const [i, v] = pair.split("[.]").map(toInt);
      if (i === null || v === null || i < 0) return null;
      out[i] = v;
    }
    return out;
  }

  return null;
}

/**
 * Закодировать ответ так же, как это делает пакет. Существует ради теста на парность.
 *
 * @param type тип вопроса
 * @param answer ответ в форме хоста
 * @returns строка `learner_response`
 */
export function encodeLearnerResponse(type: string, answer: LearnerAnswer): string {
  if (answer === null || answer === undefined) return "";

  if (isSingleIndexChoice(type)) return String((answer as number) + 1);

  if (type === "multiple" || type === "ranking") {
    return (answer as number[]).map((i) => i + 1).join(",");
  }

  if (type === "matching") {
    const m = answer as Record<number, number>;
    return Object.keys(m)
      .map(Number)
      .sort((a, b) => a - b)
      .map((k) => `${k + 1}-${m[k] + 1}`)
      .join(",");
  }

  if (distributesBudget(type)) {
    const m = answer as Record<number, number>;
    return Object.keys(m)
      .map(Number)
      .sort((a, b) => a - b)
      .map((i) => `${i}[.]${m[i]}`)
      .join(",");
  }

  return "";
}
```

- [ ] **Шаг 4: прогнать тест**

Выполнить: `npm test -- shared/lms-export/__tests__/response-codec.test.ts`
Ожидается: PASS, 12 тестов (6 разбора + 6 парности).

- [ ] **Шаг 5: коммит**

```bash
git add shared/lms-export/response-codec.ts shared/lms-export/__tests__/response-codec.test.ts
git commit -m "feat(prd-54): кодирование и разбор ответов выгрузки с тестом на парность"
```

---

## Задача 5: разбор книги

**Файлы:**

- Создание: `shared/lms-export/parse.ts`
- Тест: `shared/lms-export/__tests__/parse.test.ts`

Модуль принимает уже прочитанный лист как массив массивов строк и не знает ни про exceljs, ни про
базу. Так его можно проверить без файла.

- [ ] **Шаг 1: написать падающий тест**

```ts
/**
 * @module shared/lms-export/__tests__/parse
 */
import { describe, it, expect } from "vitest";
import { looksLikeLmsExport, parseLmsExport } from "../parse";

/** Шапка и строка по образцу docs/references/7684237229762827328-1.xlsx, урезанные до двух блоков. */
const SHEET: string[][] = [
  [
    "Пользователь", "Код", "Организация", "Подразделение", "Должность",
    "Дата активации курса", "Дата активации модуля", "Статус", "Баллы",
    "q_80a5957f-cdc7-4490-b4c9-bcedcb973c26", "", "", "",
    "scale_cel", "", "", "",
    "var_lead_margin", "", "", "",
  ],
  [
    "", "", "", "", "", "", "", "", "",
    "Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ",
    "Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ",
    "Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ",
  ],
  [
    "Контента Контроль", "", "ПАО \"Ростелеком\"", "", "",
    "2026-09-09T13:35:00.000Z", "2026-09-09T13:39:00.000Z", "Пройден", "0",
    "другое", "", "neutral", "0[.]1,1[.]5,2[.]1,3[.]0",
    "другое", "", "neutral", "29",
    "другое", "", "neutral", "6",
  ],
];

describe("looksLikeLmsExport", () => {
  it("узнаёт выгрузку по четвёрке подколонок и префиксам", () => {
    expect(looksLikeLmsExport(SHEET)).toBe(true);
  });

  it("не принимает книгу теста за выгрузку", () => {
    expect(looksLikeLmsExport([["Текст вопроса", "Тип", "Тема"], ["Что такое X?", "single", "Основы"]])).toBe(false);
  });
});

describe("parseLmsExport", () => {
  it("собирает идентификаторы вопросов, шкал и показателей", () => {
    const book = parseLmsExport(SHEET);
    expect(book.questionIds).toEqual(["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]);
    expect(book.scaleKeys).toEqual(["cel"]);
    expect(book.variableNames).toEqual(["lead_margin"]);
  });

  it("читает служебные поля строки", () => {
    const [row] = parseLmsExport(SHEET).rows;
    expect(row.participantName).toBe("Контента Контроль");
    expect(row.org).toBe('ПАО "Ростелеком"');
    expect(row.moduleActivatedAt).toBe("2026-09-09T13:39:00.000Z");
    expect(row.passed).toBe(true);
    expect(row.points).toBe(0);
  });

  it("раскладывает взаимодействия по видам", () => {
    const [row] = parseLmsExport(SHEET).rows;
    expect(row.answers["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]).toBe("0[.]1,1[.]5,2[.]1,3[.]0");
    expect(row.results["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]).toBe("neutral");
    expect(row.scales.cel).toBe(29);
    expect(row.variables.lead_margin).toBe("6");
  });

  it("складывает неопознанные блоки отдельно, не роняя разбор", () => {
    const sheet = SHEET.map((r) => [...r]);
    sheet[0][9] = "topic_abc_level";
    const book = parseLmsExport(sheet);
    expect(book.questionIds).toEqual([]);
    expect(book.unknownColumns).toEqual(["topic_abc_level"]);
  });
});
```

- [ ] **Шаг 2: прогнать и убедиться, что падает**

Выполнить: `npm test -- shared/lms-export/__tests__/parse.test.ts`
Ожидается: FAIL, модуль не найден.

- [ ] **Шаг 3: реализовать модуль**

```ts
/**
 * @module shared/lms-export/parse
 * @description Разбор листа выгрузки отчёта LMS (PRD-54 раздел 3).
 *
 * Вход — лист как массив строк, значения уже приведены к строкам. Модуль не знает ни про exceljs,
 * ни про базу: так он проверяется без файла и одинаково работает на сервере и в браузере.
 *
 * Форма листа: девять служебных колонок, дальше по ЧЕТЫРЕ подколонки на каждое взаимодействие.
 * Идентификатор взаимодействия стоит в первой строке над первой подколонкой блока, во второй
 * строке идут подписи «Тип», «Продолжительность (сек.)», «Результат», «Полученный ответ».
 */

/** Ширина блока одного взаимодействия. */
const BLOCK = 4;
/** Число служебных колонок перед первым блоком. */
const SERVICE = 9;
/** Подписи подколонок блока — по ним лист и опознаётся. */
const SUBHEADERS = ["Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ"];

export interface LmsExportRow {
  participantName: string;
  participantCode: string;
  org: string;
  courseActivatedAt: string;
  moduleActivatedAt: string;
  passed: boolean | null;
  points: number | null;
  /** `q_<uuid>` без префикса -> строка «Полученный ответ». */
  answers: Record<string, string>;
  /** `q_<uuid>` без префикса -> `correct` | `incorrect` | `neutral`. */
  results: Record<string, string>;
  /** Ключ шкалы -> числовое значение. */
  scales: Record<string, number>;
  /** Ключ шкалы -> подпись уровня. */
  scaleLevels: Record<string, string>;
  /** Имя показателя -> значение строкой: показатель бывает и числом, и кодом. */
  variables: Record<string, string>;
}

export interface LmsExportBook {
  questionIds: string[];
  scaleKeys: string[];
  variableNames: string[];
  /** Идентификаторы блоков, которые импорт не разбирает (например, `topic_*`). */
  unknownColumns: string[];
  rows: LmsExportRow[];
}

function cell(row: string[] | undefined, i: number): string {
  return String(row?.[i] ?? "").trim();
}

/**
 * Похож ли лист на выгрузку отчёта LMS.
 *
 * Опознание идёт по ДВУМ признакам сразу: четвёрка подписей во второй строке и хотя бы один блок с
 * нашим префиксом в первой. Одного мало — четвёрка встречается в чужих отчётах, префикс сам по себе
 * может оказаться в произвольной книге.
 */
export function looksLikeLmsExport(sheet: string[][]): boolean {
  const [head = [], sub = []] = sheet;
  if (head.length < SERVICE + BLOCK) return false;
  const firstBlock = SUBHEADERS.every((label, i) => cell(sub, SERVICE + i) === label);
  if (!firstBlock) return false;
  for (let i = SERVICE; i < head.length; i += BLOCK) {
    const id = cell(head, i);
    if (id.startsWith("q_") || id.startsWith("scale_") || id.startsWith("var_")) return true;
  }
  return false;
}

/**
 * Разобрать лист.
 *
 * @param sheet лист как массив строк; первые две строки — шапка, дальше данные
 * @returns состав колонок и разобранные строки
 */
export function parseLmsExport(sheet: string[][]): LmsExportBook {
  const head = sheet[0] ?? [];
  const blocks: Array<{ at: number; id: string }> = [];
  for (let i = SERVICE; i < head.length; i += BLOCK) {
    const id = cell(head, i);
    if (id) blocks.push({ at: i, id });
  }

  const questionIds: string[] = [];
  const scaleKeys: string[] = [];
  const variableNames: string[] = [];
  const unknownColumns: string[] = [];

  for (const b of blocks) {
    if (b.id.startsWith("q_")) questionIds.push(b.id.slice(2));
    else if (b.id.startsWith("scale_")) {
      const key = b.id.slice(6);
      if (!key.endsWith("_level")) scaleKeys.push(key);
    } else if (b.id.startsWith("var_")) variableNames.push(b.id.slice(4));
    else unknownColumns.push(b.id);
  }

  const rows: LmsExportRow[] = [];
  for (let r = 2; r < sheet.length; r += 1) {
    const raw = sheet[r];
    if (!raw || raw.every((v) => String(v ?? "").trim() === "")) continue;

    const row: LmsExportRow = {
      participantName: cell(raw, 0),
      participantCode: cell(raw, 1),
      org: cell(raw, 2),
      courseActivatedAt: cell(raw, 5),
      moduleActivatedAt: cell(raw, 6),
      passed: cell(raw, 7) === "" ? null : cell(raw, 7) === "Пройден",
      points: cell(raw, 8) === "" ? null : Number(cell(raw, 8)),
      answers: {},
      results: {},
      scales: {},
      scaleLevels: {},
      variables: {},
    };

    for (const b of blocks) {
      const result = cell(raw, b.at + 2);
      const value = cell(raw, b.at + 3);
      if (b.id.startsWith("q_")) {
        row.answers[b.id.slice(2)] = value;
        row.results[b.id.slice(2)] = result;
      } else if (b.id.startsWith("scale_")) {
        const key = b.id.slice(6);
        if (key.endsWith("_level")) row.scaleLevels[key.slice(0, -"_level".length)] = value;
        else if (value !== "") row.scales[key] = Number(value);
      } else if (b.id.startsWith("var_")) {
        row.variables[b.id.slice(4)] = value;
      }
    }

    rows.push(row);
  }

  return { questionIds, scaleKeys, variableNames, unknownColumns, rows };
}
```

- [ ] **Шаг 4: прогнать тест**

Выполнить: `npm test -- shared/lms-export/__tests__/parse.test.ts`
Ожидается: PASS, 6 тестов.

- [ ] **Шаг 5: коммит**

```bash
git add shared/lms-export/parse.ts shared/lms-export/__tests__/parse.test.ts
git commit -m "feat(prd-54): разбор листа выгрузки отчёта LMS"
```

---

## Задача 6: хранилище

**Файлы:**

- Правка: `server/storage/scorm-repository.ts`
- Правка: `server/storage.ts` (интерфейс `IStorage` около строки 315, делегаты около строки 1093)
- Тест: `tests/it/lms-import.it.test.ts` (интеграционный, pglite)
- Правка: `tests/it/schema.sql` (перегенерировать — харнесс поднимает базу из него, а не из миграций)

- [ ] **Шаг 1: написать падающий интеграционный тест**

```ts
/**
 * @module tests/it/lms-import.it
 */
import { describe, it, expect, beforeEach } from "vitest";
import { makeTestStorage } from "./helpers";

describe("upsertImportedAttempt", () => {
  let storage: Awaited<ReturnType<typeof makeTestStorage>>;
  beforeEach(async () => { storage = await makeTestStorage(); });

  const base = {
    testId: "11111111-1111-1111-1111-111111111111",
    participantKey: "a".repeat(64),
    startedAt: new Date("2026-09-09T13:39:00Z"),
    finishedAt: new Date("2026-09-09T13:39:00Z"),
    lastActivityAt: new Date("2026-09-09T13:39:00Z"),
    origin: "import" as const,
    batchId: "b1",
    groupId: null,
    userId: null,
    resultPassed: true,
    totalPoints: 0,
    scalesJson: { cel: 29 },
    variablesJson: { lead_margin: "6" },
  };

  it("первая запись создаётся", async () => {
    const r = await storage.upsertImportedAttempt(base);
    expect(r.created).toBe(true);
  });

  it("повторная запись с тем же ключом обновляет, а не дублирует", async () => {
    await storage.upsertImportedAttempt(base);
    const r = await storage.upsertImportedAttempt({ ...base, scalesJson: { cel: 31 } });
    expect(r.created).toBe(false);
    const all = await storage.getAllScormAttempts();
    expect(all.filter((a) => a.origin === "import")).toHaveLength(1);
    expect(all[0].scalesJson).toEqual({ cel: 31 });
  });

  it("другая дата — это другое прохождение", async () => {
    await storage.upsertImportedAttempt(base);
    await storage.upsertImportedAttempt({ ...base, startedAt: new Date("2026-09-10T10:00:00Z") });
    const all = await storage.getAllScormAttempts();
    expect(all.filter((a) => a.origin === "import")).toHaveLength(2);
  });
});
```

- [ ] **Шаг 2: прогнать и убедиться, что падает**

Сначала перегенерировать схему харнесса — он поднимает базу из `tests/it/schema.sql` (экспорт из
`shared/schema.ts`), а НЕ из миграций: `npx drizzle-kit export --sql | grep -v '^DATABASE_URL:' > tests/it/schema.sql`.
Затем: `npm run test:it -- tests/it/lms-import.it.test.ts`. Ожидается FAIL, методов нет. Образец
подготовки харнесса — `tests/it/review-comments-repository.it.test.ts`: `vi.mock("../../server/db")`
на харнесс, репозиторий импортируется ПОСЛЕ мока.

- [ ] **Шаг 3: реализовать в репозитории**

В `server/storage/scorm-repository.ts`:

```ts
  /**
   * Записать импортированное прохождение, обновив существующее с тем же ключом (PRD-54 раздел 8.1).
   *
   * Ключ — `(test_id, participant_key, started_at)`, он же частичный уникальный индекс
   * `scorm_attempts_import_row_idx`. Конфликт разрешается в БАЗЕ, а не проверкой «сначала выбрать,
   * потом вставить»: две параллельные загрузки одного файла иначе создали бы дубли.
   *
   * @param data поля импортированного прохождения
   * @returns признак `created` — строка создана (true) или обновлена (false)
   */
  async upsertImportedAttempt(data: ImportedAttemptInput): Promise<{ id: string; created: boolean }> {
    const id = randomUUID();
    const [row] = await this.db
      .insert(scormAttempts)
      .values({ id, ...data })
      .onConflictDoUpdate({
        target: [scormAttempts.testId, scormAttempts.participantKey, scormAttempts.startedAt],
        targetWhere: sql`${scormAttempts.origin} = 'import'`,
        set: {
          batchId: data.batchId,
          groupId: data.groupId ?? null,
          userId: data.userId ?? null,
          finishedAt: data.finishedAt,
          lastActivityAt: data.lastActivityAt,
          resultPassed: data.resultPassed ?? null,
          totalPoints: data.totalPoints ?? null,
          scalesJson: data.scalesJson ?? null,
          variablesJson: data.variablesJson ?? null,
          lmsUserName: data.lmsUserName ?? null,
          lmsUserOrg: data.lmsUserOrg ?? null,
        },
      })
      .returning({ id: scormAttempts.id });
    return { id: row.id, created: row.id === id };
  }
```

Тип входа объявить там же, над методом:

```ts
/** Поля импортированного прохождения. `origin` фиксирован: телеметрия сюда не ходит. */
export interface ImportedAttemptInput {
  testId: string;
  participantKey: string;
  origin: "import";
  batchId: string | null;
  groupId: string | null;
  userId: string | null;
  lmsUserName: string | null;
  lmsUserOrg: string | null;
  startedAt: Date;
  finishedAt: Date;
  lastActivityAt: Date;
  resultPassed: boolean | null;
  totalPoints: number | null;
  totalQuestions: number | null;
  scalesJson: Record<string, number> | null;
  variablesJson: Record<string, string> | null;
}
```

И ещё четыре метода:

```ts
  /** Завести партию импорта. Счётчики проставляются позже, когда строки записаны. */
  async createLmsImportBatch(batch: InsertLmsImportBatch & { id: string }): Promise<{ id: string }> {
    const [row] = await this.db.insert(lmsImportBatches).values(batch).returning({ id: lmsImportBatches.id });
    return row;
  }

  /** Проставить счётчики и протокол после прогона. */
  async updateLmsImportBatch(id: string, counts: {
    rowsTotal: number; rowsCreated: number; rowsUpdated: number; rowsSkipped: number;
    rowsLinked: number; warnings: string[];
  }): Promise<void> {
    await this.db.update(lmsImportBatches).set({
      rowsTotal: counts.rowsTotal,
      rowsCreated: counts.rowsCreated,
      rowsUpdated: counts.rowsUpdated,
      rowsSkipped: counts.rowsSkipped,
      rowsLinked: counts.rowsLinked,
      warningsJson: counts.warnings,
    }).where(eq(lmsImportBatches.id, id));
  }

  /** Партии теста, новые первыми. */
  async getLmsImportBatches(testId: string): Promise<LmsImportBatch[]> {
    return this.db.select().from(lmsImportBatches)
      .where(eq(lmsImportBatches.testId, testId))
      .orderBy(desc(lmsImportBatches.importedAt));
  }

  /**
   * Откатить партию целиком (PRD-54 раздел 8.6).
   *
   * Одной транзакцией: половина отката хуже, чем его отсутствие — строки без партии осели бы в
   * аналитике навсегда и уже ничем бы не удалялись.
   */
  async deleteLmsImportBatch(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const attempts = await tx.select({ id: scormAttempts.id }).from(scormAttempts)
        .where(eq(scormAttempts.batchId, id));
      const ids = attempts.map((a) => a.id);
      if (ids.length > 0) await tx.delete(scormAnswers).where(inArray(scormAnswers.attemptId, ids));
      await tx.delete(scormAttempts).where(eq(scormAttempts.batchId, id));
      await tx.delete(lmsImportBatches).where(eq(lmsImportBatches.id, id));
    });
  }

  /** Переписать ответы попытки: повторный импорт заменяет их целиком, а не доливает. */
  async replaceImportedAnswers(attemptId: string, answers: InsertScormAnswer[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(scormAnswers).where(eq(scormAnswers.attemptId, attemptId));
      if (answers.length > 0) await tx.insert(scormAnswers).values(answers);
    });
  }
```

И один метод в `server/storage/users-repository.ts` — он нужен уже задаче 8, поэтому заводится здесь,
а не вместе с остальной работой по внешнему ключу:

```ts
  /**
   * Найти пользователя по внешнему ключу (PRD-54 раздел 8.5).
   *
   * Регистр и краевые пробелы не учитываются: ключом чаще всего оказывается hex-хеш или табельный
   * код, где разница в регистре смысла не несёт, а сопоставление ломает молча. Сравнение идёт по
   * тому же выражению, на котором построен уникальный индекс `users_external_key_idx`.
   */
  async getUserByExternalKey(key: string): Promise<User | undefined> {
    const normalized = key.trim().toLowerCase();
    if (normalized === "") return undefined;
    const [row] = await this.db.select().from(users)
      .where(sql`lower(${users.externalKey}) = ${normalized}`)
      .limit(1);
    return row;
  }
```

- [ ] **Шаг 4: пробросить через фасад**

В `server/storage.ts` добавить сигнатуры в `IStorage` и делегаты в класс — ровно так же, как сделано
для `createScormAttempt` на строках 315 и 1093.

- [ ] **Шаг 5: прогнать тест**

Выполнить: `npm run test:it -- tests/it/lms-import.it.test.ts`
Ожидается: PASS, 10 тестов.

- [ ] **Шаг 6: коммит**

```bash
git add server/storage/scorm-repository.ts server/storage.ts tests/it/lms-import.it.test.ts tests/it/schema.sql
git commit -m "feat(prd-54): хранилище импортированных прохождений и партий"
```

---

## Задача 7: определение теста и опознание формата

**Файлы:**

- Создание: `server/services/lms-test-resolver.ts`
- Тест: `server/services/__tests__/lms-test-resolver.test.ts`
- Правка: `server/routes/workbook.ts` (обработчик `/inspect`, строки 73–130)
- Тест: `server/routes/__tests__/workbook-inspect-lms.test.ts`

Определение теста живёт в отдельном модуле, а не внутри сервиса импорта, потому что вызывающих
ДВА: `/inspect` должен назвать тест ещё до того, как человек нажал «Импортировать».

- [ ] **Шаг 1: написать падающий тест определения теста**

```ts
/**
 * @module server/services/__tests__/lms-test-resolver
 */
import { describe, it, expect } from "vitest";
import { resolveTestByQuestionIds } from "../lms-test-resolver";

const store = {
  getQuestionsByIds: async (ids: string[]) =>
    [{ id: "q1", topicId: "t1" }, { id: "q2", topicId: "t1" }].filter((q) => ids.includes(q.id)),
  getTestSectionsByTopicIds: async () => [{ testId: "test-a", topicId: "t1" }],
};

describe("resolveTestByQuestionIds", () => {
  it("однозначный тест находится", async () => {
    expect(await resolveTestByQuestionIds(["q1", "q2"], store as never)).toEqual({ testId: "test-a", foreign: [] });
  });

  it("чужие вопросы возвращаются списком, а не роняют разбор", async () => {
    expect(await resolveTestByQuestionIds(["q1", "zzz"], store as never)).toEqual({ testId: "test-a", foreign: ["zzz"] });
  });

  it("ни одного совпадения — теста нет", async () => {
    expect(await resolveTestByQuestionIds(["zzz"], store as never)).toEqual({ testId: null, foreign: ["zzz"] });
  });

  it("вопросы из двух тестов — теста нет", async () => {
    const two = {
      getQuestionsByIds: async () => [{ id: "q1", topicId: "t1" }, { id: "q3", topicId: "t2" }],
      getTestSectionsByTopicIds: async () => [{ testId: "test-a", topicId: "t1" }, { testId: "test-b", topicId: "t2" }],
    };
    expect((await resolveTestByQuestionIds(["q1", "q3"], two as never)).testId).toBeNull();
  });
});
```

- [ ] **Шаг 2: прогнать и убедиться, что падает**

Выполнить: `npm test -- server/services/__tests__/lms-test-resolver.test.ts`
Ожидается: FAIL, модуль не найден.

- [ ] **Шаг 3: реализовать модуль**

```ts
/**
 * @module server/services/lms-test-resolver
 * @description Определение теста по идентификаторам вопросов из шапки выгрузки (PRD-54 раздел 6.2).
 *
 * Выбирать тест руками нельзя: файл уже содержит ответ, а ручной выбор открыл бы дорогу записи
 * прохождений не в тот тест. Отдельный модуль, а не часть сервиса импорта, потому что `/inspect`
 * обязан назвать тест ДО импорта.
 */
import type { IStorage } from "../storage";

export interface ResolvedTest {
  testId: string | null;
  /** Идентификаторы вопросов, которые найденному тесту НЕ принадлежат. */
  foreign: string[];
}

/**
 * @param questionIds идентификаторы из блоков `q_<uuid>`
 * @param storage слой доступа к данным
 * @returns тест и список чужих вопросов
 */
export async function resolveTestByQuestionIds(questionIds: string[], storage: IStorage): Promise<ResolvedTest> {
  const found = await storage.getQuestionsByIds(questionIds);
  const known = new Set(found.map((q) => q.id));
  const foreign = questionIds.filter((id) => !known.has(id));
  if (found.length === 0) return { testId: null, foreign };

  const topicIds = [...new Set(found.map((q) => q.topicId).filter(Boolean))] as string[];
  const sections = await storage.getTestSectionsByTopicIds(topicIds);
  const testIds = [...new Set(sections.map((s) => s.testId))];
  if (testIds.length !== 1) return { testId: null, foreign };
  return { testId: testIds[0], foreign };
}
```

Методов `getQuestionsByIds` и `getTestSectionsByTopicIds` в `IStorage` может не быть. Проверить
`server/storage.ts`; если их нет — добавить в репозитории и пробросить через фасад:

```ts
  // server/storage/questions-repository.ts
  async getQuestionsByIds(ids: string[]): Promise<Question[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(questions).where(inArray(questions.id, ids));
  }

  // server/storage/tests-repository.ts
  async getTestSectionsByTopicIds(topicIds: string[]): Promise<TestSection[]> {
    if (topicIds.length === 0) return [];
    return this.db.select().from(testSections).where(inArray(testSections.topicId, topicIds));
  }
```

Пустой список проверяется отдельно: `inArray` с пустым массивом в Postgres даёт `IN ()` —
синтаксическую ошибку, а не пустую выборку.

- [ ] **Шаг 4: прогнать тест определения теста**

Выполнить: `npm test -- server/services/__tests__/lms-test-resolver.test.ts`
Ожидается: PASS, 4 теста.

- [ ] **Шаг 5: написать падающий тест опознания формата**

```ts
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { detectLmsExport } from "../workbook";

async function bookWithLmsSheet(): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["Пользователь", "Код", "Организация", "Подразделение", "Должность",
    "Дата активации курса", "Дата активации модуля", "Статус", "Баллы",
    "q_80a5957f-cdc7-4490-b4c9-bcedcb973c26", "", "", ""]);
  ws.addRow(["", "", "", "", "", "", "", "", "",
    "Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ"]);
  return ws;
}

describe("detectLmsExport", () => {
  it("опознаёт выгрузку и возвращает идентификаторы вопросов", async () => {
    const res = detectLmsExport(await bookWithLmsSheet());
    expect(res?.questionIds).toEqual(["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]);
  });

  it("на книге теста возвращает null", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Вопросы");
    ws.addRow(["Текст вопроса", "Тип"]);
    expect(detectLmsExport(ws)).toBeNull();
  });
});
```

- [ ] **Шаг 6: прогнать и убедиться, что падает**

Выполнить: `npm test -- server/routes/__tests__/workbook-inspect-lms.test.ts`
Ожидается: FAIL, `detectLmsExport` не экспортируется.

- [ ] **Шаг 7: реализовать**

В `server/routes/workbook.ts` добавить импорт и функцию:

```ts
import { looksLikeLmsExport, parseLmsExport, type LmsExportBook } from "@shared/lms-export/parse";
import { resolveTestByQuestionIds } from "../services/lms-test-resolver";

/**
 * Лист как массив строк: `parseLmsExport` намеренно не знает про exceljs.
 *
 * ГОЧА ДАТ (найдена при прогоне на реальном файле). Ячейки дат exceljs отдаёт объектами `Date`, и
 * голый `String(date)` даёт ЛОКАЛИЗОВАННУЮ строку вида
 * «Wed Sep 09 2026 16:39:00 GMT+0300 (Москва, стандартное время)». На машине разработчика она
 * разбирается обратно, на хосте с другой локалью — может и не разобраться. Поэтому дата
 * приводится к ISO явно, а не через `String`.
 */
function sheetToMatrix(sheet: ExcelJS.Worksheet): string[][] {
  const out: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const values = (row.values as unknown[]).slice(1);
    out.push(values.map((v) => {
      if (v === null || v === undefined) return "";
      if (v instanceof Date) return v.toISOString();
      return String(v);
    }));
  });
  return out;
}

/**
 * Опознать выгрузку отчёта LMS среди листов книги (PRD-54 раздел 6.1).
 *
 * @param sheet лист-кандидат
 * @returns разобранная книга или `null`, если лист выгрузкой не является
 */
export function detectLmsExport(sheet: ExcelJS.Worksheet): LmsExportBook | null {
  const matrix = sheetToMatrix(sheet);
  return looksLikeLmsExport(matrix) ? parseLmsExport(matrix) : null;
}
```

В обработчик `/inspect` добавить ПЕРЕД поиском ролевых листов:

```ts
      const lms = workbook.worksheets.map(detectLmsExport).find(Boolean) ?? null;
      if (lms) {
        const resolved = await resolveTestByQuestionIds(lms.questionIds, storage);
        const test = resolved.testId ? await storage.getTest(resolved.testId) : null;
        return res.json({
          kind: "lmsExport",
          sheets: workbook.worksheets.map((w) => w.name),
          testId: resolved.testId,
          testTitle: test?.title ?? null,
          foreignQuestionIds: resolved.foreign,
          rows: lms.rows.length,
          questionIds: lms.questionIds.length,
          scaleKeys: lms.scaleKeys,
          variableNames: lms.variableNames,
          unknownColumns: lms.unknownColumns,
          looksPersonal: lms.rows.some((r) => /[А-Яа-яЁё]\s/.test(r.participantName)),
        });
      }
```

Существующий ответ дополняется полем `kind: "workbook"`, чтобы клиент ветвился по одному полю.

- [ ] **Шаг 8: прогнать тест**

Выполнить: `npm test -- server/routes/__tests__/workbook-inspect-lms.test.ts`
Ожидается: PASS, 2 теста.

- [ ] **Шаг 9: коммит**

```bash
git add server/services/lms-test-resolver.ts server/services/__tests__/lms-test-resolver.test.ts
git add server/routes/workbook.ts server/routes/__tests__/workbook-inspect-lms.test.ts server/storage.ts
git commit -m "feat(prd-54): определение теста по вопросам и опознание выгрузки в /inspect"
```

---

## Задача 8: сервис импорта

**Файлы:**

- Создание: `server/services/lms-export-import.ts`
- Тест: `server/services/__tests__/lms-export-import.test.ts`

- [ ] **Шаг 1: написать падающий тест плана импорта**

```ts
/**
 * @module server/services/__tests__/lms-export-import
 */
import { describe, it, expect } from "vitest";
import { buildImportPlan } from "../lms-export-import";

const book = {
  questionIds: ["q1"],
  scaleKeys: ["cel"],
  variableNames: ["lead_margin"],
  unknownColumns: [],
  rows: [{
    participantName: "Иванов Иван", participantCode: "", org: "ПАО",
    courseActivatedAt: "", moduleActivatedAt: "2026-09-09T13:39:00.000Z",
    passed: true, points: 0,
    answers: { q1: "0[.]7,1[.]0" }, results: { q1: "neutral" },
    scales: { cel: 29 }, scaleLevels: {}, variables: { lead_margin: "6" },
  }],
};

describe("buildImportPlan", () => {
  it("обезличивает: ФИО в план не попадает, псевдоним есть", () => {
    const plan = buildImportPlan(book as never, { anonymize: true, sourceAnonymized: false, linkUsers: false });
    expect(plan.rows[0].participantKey).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.rows[0].lmsUserName).toBeNull();
  });

  it("без обезличивания псевдоним считается ТОТ ЖЕ, но ФИО сохраняется", () => {
    const on = buildImportPlan(book as never, { anonymize: true, sourceAnonymized: false, linkUsers: false });
    const off = buildImportPlan(book as never, { anonymize: false, sourceAnonymized: false, linkUsers: false });
    expect(off.rows[0].participantKey).toBe(on.rows[0].participantKey);
    expect(off.rows[0].lmsUserName).toBe("Иванов Иван");
  });

  it("предобезличенный файл не хешируется повторно", () => {
    const plan = buildImportPlan(book as never, { anonymize: true, sourceAnonymized: true, linkUsers: false });
    expect(plan.rows[0].participantKey).toBe("Иванов Иван");
  });

  it("предупреждает о сочетании обезличивания и связывания", () => {
    const plan = buildImportPlan(book as never, { anonymize: true, sourceAnonymized: false, linkUsers: true });
    expect(plan.warnings).toContain(
      "Обезличивание и связывание включены одновременно: ФИО не сохраняется, но прохождение указывает на конкретного пользователя.",
    );
  });

  it("дата активации модуля идёт и в начало, и в конец попытки", () => {
    const plan = buildImportPlan(book as never, { anonymize: true, sourceAnonymized: false, linkUsers: false });
    expect(plan.rows[0].startedAt.toISOString()).toBe("2026-09-09T13:39:00.000Z");
    expect(plan.rows[0].finishedAt.toISOString()).toBe("2026-09-09T13:39:00.000Z");
  });

  it("строка без даты активации модуля пропускается с предупреждением", () => {
    const noDate = { ...book, rows: [{ ...book.rows[0], moduleActivatedAt: "" }] };
    const plan = buildImportPlan(noDate as never, { anonymize: true, sourceAnonymized: false, linkUsers: false });
    expect(plan.rows).toHaveLength(0);
    expect(plan.warnings.some((w) => w.includes("без даты активации модуля"))).toBe(true);
  });
});
```

- [ ] **Шаг 2: прогнать и убедиться, что падает**

Выполнить: `npm test -- server/services/__tests__/lms-export-import.test.ts`
Ожидается: FAIL, модуль не найден.

- [ ] **Шаг 3: реализовать план импорта**

```ts
/**
 * @module server/services/lms-export-import
 * @description Импорт выгрузки отчёта LMS в общие с телеметрией таблицы (PRD-54).
 *
 * Модуль делится надвое намеренно. `buildImportPlan` — чистая функция без базы и ввода-вывода,
 * поэтому три режима обезличивания проверяются тестом без подготовки хранилища. `runImport`
 * добавляет к плану только запись и связывание.
 */
import { createHash, randomUUID } from "node:crypto";
import { participantKey } from "../utils/crypto";
import { decodeLearnerResponse } from "@shared/lms-export/response-codec";
import type { LmsExportBook } from "@shared/lms-export/parse";
import type { IStorage } from "../storage";

export interface ImportOptions {
  anonymize: boolean;
  sourceAnonymized: boolean;
  linkUsers: boolean;
}

export interface PlannedRow {
  participantKey: string;
  /** Идентификатор для сверки с `users.external_key`; в базу НЕ пишется. */
  lookupKey: string;
  lmsUserName: string | null;
  lmsUserOrg: string | null;
  startedAt: Date;
  finishedAt: Date;
  resultPassed: boolean | null;
  totalPoints: number | null;
  scalesJson: Record<string, number>;
  variablesJson: Record<string, string>;
  answers: Array<{ questionId: string; raw: string; result: string }>;
}

export interface ImportPlan {
  rows: PlannedRow[];
  warnings: string[];
}

/**
 * Превратить разобранную книгу в план записи (PRD-54 разделы 4 и 8).
 *
 * @param book разобранная книга
 * @param opts режимы загрузки
 * @returns строки к записи и предупреждения для протокола
 */
export function buildImportPlan(book: LmsExportBook, opts: ImportOptions): ImportPlan {
  const warnings: string[] = [];

  if (opts.anonymize && opts.linkUsers) {
    warnings.push(
      "Обезличивание и связывание включены одновременно: ФИО не сохраняется, но прохождение указывает на конкретного пользователя.",
    );
  }
  if (book.unknownColumns.length > 0) {
    warnings.push(`Не разобраны колонки: ${book.unknownColumns.join(", ")}.`);
  }

  const rows: PlannedRow[] = [];
  for (const r of book.rows) {
    if (!r.moduleActivatedAt) {
      const who = opts.anonymize ? "скрыто" : r.participantName;
      warnings.push(`Строка участника «${who}» без даты активации модуля пропущена.`);
      continue;
    }
    const at = new Date(r.moduleActivatedAt);
    // Предобезличенный файл уже несёт псевдоним — повторное хеширование разорвало бы связь с
    // идентификаторами того инструмента, которым файл готовили (PRD-54 раздел 4, режим 3).
    const key = opts.sourceAnonymized
      ? r.participantName
      : participantKey(r.participantName, r.participantCode, r.org);

    rows.push({
      participantKey: key,
      lookupKey: r.participantCode || r.participantName,
      lmsUserName: opts.anonymize ? null : r.participantName,
      lmsUserOrg: opts.anonymize ? null : r.org,
      startedAt: at,
      finishedAt: at,
      resultPassed: r.passed,
      totalPoints: r.points,
      scalesJson: r.scales,
      variablesJson: r.variables,
      answers: Object.keys(r.answers).map((questionId) => ({
        questionId,
        raw: r.answers[questionId],
        result: r.results[questionId] || "neutral",
      })),
    });
  }

  return { rows, warnings };
}
```

- [ ] **Шаг 4: прогнать тест**

Выполнить: `npm test -- server/services/__tests__/lms-export-import.test.ts`
Ожидается: PASS, 6 тестов.

- [ ] **Шаг 5: написать падающий тест связывания и записи**

Дописать в тот же файл:

```ts
import { runImport } from "../lms-export-import";

function storageStub(externalKeys: Record<string, string>) {
  const created: unknown[] = [];
  return {
    created,
    getUserByExternalKey: async (key: string) => {
      const id = externalKeys[key.trim().toLowerCase()];
      return id ? { id } : undefined;
    },
    getQuestionsByIds: async () => [{ id: "q1", type: "allocation", prompt: "Вопрос", topicId: "t1" }],
    createLmsImportBatch: async (b: unknown) => { created.push(b); return { id: "batch-1" }; },
    updateLmsImportBatch: async () => undefined,
    upsertImportedAttempt: async () => ({ id: "a1", created: true }),
    replaceImportedAnswers: async () => undefined,
  };
}

const ctx = { testId: "t1", groupId: null, fileName: "f.xlsx", fileBuffer: Buffer.from("x"), userId: "me" };

describe("runImport", () => {
  it("связывает по внешнему ключу, когда флажок включён", async () => {
    const s = storageStub({ "иванов иван": "user-7" });
    const opts = { anonymize: true, sourceAnonymized: false, linkUsers: true };
    expect((await runImport(book as never, opts, ctx, s as never)).rowsLinked).toBe(1);
  });

  it("не связывает, когда флажок выключен", async () => {
    const s = storageStub({ "иванов иван": "user-7" });
    const opts = { anonymize: true, sourceAnonymized: false, linkUsers: false };
    expect((await runImport(book as never, opts, ctx, s as never)).rowsLinked).toBe(0);
  });

  it("несовпадение ключа — не ошибка", async () => {
    const s = storageStub({});
    const opts = { anonymize: true, sourceAnonymized: false, linkUsers: true };
    const res = await runImport(book as never, opts, ctx, s as never);
    expect(res.rowsCreated).toBe(1);
    expect(res.rowsLinked).toBe(0);
  });

  it("сухой прогон считает, но ничего не создаёт", async () => {
    const s = storageStub({});
    const opts = { anonymize: true, sourceAnonymized: false, linkUsers: false };
    const res = await runImport(book as never, opts, { ...ctx, dryRun: true }, s as never);
    expect(res.rowsCreated).toBe(1);
    expect(s.created).toHaveLength(0);
  });
});
```

- [ ] **Шаг 6: прогнать и убедиться, что падает**

Выполнить: `npm test -- server/services/__tests__/lms-export-import.test.ts`
Ожидается: FAIL, `runImport` не определена.

- [ ] **Шаг 7: реализовать запись**

```ts
export interface ImportContext {
  testId: string;
  groupId: string | null;
  fileName: string;
  fileBuffer: Buffer;
  userId: string;
  dryRun?: boolean;
}

export interface ImportResult {
  batchId: string | null;
  rowsTotal: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsLinked: number;
  warnings: string[];
}

/**
 * Выполнить импорт: партия, прохождения, ответы (PRD-54 разделы 8.3 — 8.5).
 *
 * При `dryRun` не создаётся НИЧЕГО, но счётчики считаются теми же ветками кода, что и при
 * настоящей записи, — иначе план обещал бы одно, а импорт делал другое.
 *
 * @param book разобранная книга
 * @param opts режимы загрузки
 * @param ctx тест, группа, файл и автор загрузки
 * @param storage слой доступа к данным
 * @returns счётчики и предупреждения протокола
 */
export async function runImport(
  book: LmsExportBook,
  opts: ImportOptions,
  ctx: ImportContext,
  storage: IStorage,
): Promise<ImportResult> {
  const plan = buildImportPlan(book, opts);
  const warnings = [...plan.warnings];
  const dryRun = ctx.dryRun === true;

  const questions = await storage.getQuestionsByIds(book.questionIds);
  const questionById = new Map(questions.map((q) => [q.id, q]));

  const fileHash = createHash("sha256").update(ctx.fileBuffer).digest("hex");

  let batchId: string | null = null;
  if (!dryRun) {
    const batch = await storage.createLmsImportBatch({
      id: randomUUID(),
      testId: ctx.testId,
      groupId: ctx.groupId,
      fileName: ctx.fileName,
      fileHash,
      anonymized: opts.anonymize,
      sourceAnonymized: opts.sourceAnonymized,
      linkUsers: opts.linkUsers,
      importedBy: ctx.userId,
    });
    batchId = batch.id;
  }

  let rowsCreated = 0;
  let rowsUpdated = 0;
  let rowsLinked = 0;

  for (const row of plan.rows) {
    // Связь ищется по ИСХОДНОМУ идентификатору, но в базу он не попадает: остаются
    // `participant_key` и `user_id` (PRD-54 раздел 8.5).
    let userId: string | null = null;
    if (opts.linkUsers) {
      const user = await storage.getUserByExternalKey(row.lookupKey);
      if (user) { userId = user.id; rowsLinked += 1; }
    }

    if (dryRun) { rowsCreated += 1; continue; }

    const { id, created } = await storage.upsertImportedAttempt({
      testId: ctx.testId,
      participantKey: row.participantKey,
      origin: "import",
      batchId,
      groupId: ctx.groupId,
      userId,
      lmsUserName: row.lmsUserName,
      lmsUserOrg: row.lmsUserOrg,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      lastActivityAt: row.finishedAt,
      resultPassed: row.resultPassed,
      totalPoints: row.totalPoints,
      totalQuestions: row.answers.length,
      scalesJson: row.scalesJson,
      variablesJson: row.variablesJson,
    });
    if (created) rowsCreated += 1; else rowsUpdated += 1;

    await storage.replaceImportedAnswers(
      id,
      row.answers.flatMap((a) => {
        const q = questionById.get(a.questionId);
        if (!q) return [];
        return [{
          id: randomUUID(),
          attemptId: id,
          questionId: a.questionId,
          questionPrompt: q.prompt,
          questionType: q.type,
          topicId: q.topicId,
          userAnswerJson: decodeLearnerResponse(q.type, a.raw),
          // Три состояния вместо булева: измерительный ответ не может быть неверным
          // (PRD-54 раздел 5.3).
          result: a.result === "correct" || a.result === "incorrect" ? a.result : "neutral",
          isCorrect: a.result === "correct" ? true : a.result === "incorrect" ? false : null,
          points: null,
          maxPoints: null,
          correctAnswerJson: null,
        }];
      }),
    );
  }

  const foreign = book.questionIds.filter((id) => !questionById.has(id));
  if (foreign.length > 0) {
    warnings.push(`Вопросы не из этого теста (${foreign.length}): пакет собран под другой версией.`);
  }

  const result: ImportResult = {
    batchId,
    rowsTotal: book.rows.length,
    rowsCreated,
    rowsUpdated,
    rowsSkipped: book.rows.length - plan.rows.length,
    rowsLinked,
    warnings,
  };

  if (!dryRun && batchId) await storage.updateLmsImportBatch(batchId, result);
  return result;
}
```

- [ ] **Шаг 8: прогнать тест**

Выполнить: `npm test -- server/services/__tests__/lms-export-import.test.ts`
Ожидается: PASS, 10 тестов.

- [ ] **Шаг 9: коммит**

```bash
git add server/services/lms-export-import.ts server/services/__tests__/lms-export-import.test.ts
git commit -m "feat(prd-54): сервис импорта — план, связывание по ключу, запись и сухой прогон"
```

## Задача 9: эндпоинты и право

**Файлы:**

- Создание: `server/routes/analytics/lms-import.ts`
- Правка: `server/routes/analytics/index.ts` (регистрация роутера)
- Правка: `shared/access/capabilities.ts`, `shared/access/permissions.ts`
- Тест: `shared/access/__tests__/analytics-import.test.ts`

- [ ] **Шаг 1: написать падающий тест права**

```ts
import { describe, it, expect } from "vitest";
import { ROLE_PERMISSIONS } from "../permissions";
import { ROLES } from "../roles";

describe("analytics.import", () => {
  it("есть у всех, у кого есть analytics.export", () => {
    for (const role of Object.values(ROLES)) {
      if (ROLE_PERMISSIONS[role].has("analytics.export")) {
        expect(ROLE_PERMISSIONS[role].has("analytics.import")).toBe(true);
      }
    }
  });

  it("нет у ученика", () => {
    expect(ROLE_PERMISSIONS[ROLES.LEARNER].has("analytics.import")).toBe(false);
  });
});
```

- [ ] **Шаг 2: прогнать и убедиться, что падает**

Выполнить: `npm test -- shared/access/__tests__/analytics-import.test.ts`
Ожидается: FAIL, `analytics.import` не входит в тип `Capability`.

- [ ] **Шаг 3: добавить право**

В `shared/access/capabilities.ts` — в список после `"analytics.export"` добавить `"analytics.import"`.
В `shared/access/permissions.ts` — добавить `"analytics.import"` в `AUTHOR_CAPABILITIES` (строка 68) и
в `MANAGER_CAPABILITIES` (строка 101), рядом с `"analytics.export"` в обоих.

- [ ] **Шаг 4: прогнать тест**

Выполнить: `npm test -- shared/access/__tests__/analytics-import.test.ts`
Ожидается: PASS, 2 теста.

- [ ] **Шаг 5: написать роутер**

`server/routes/analytics/lms-import.ts`:

```ts
/**
 * @module server/routes/analytics/lms-import
 * @description Загрузка выгрузки отчёта LMS и партии импорта (PRD-54 раздел 9).
 */
import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { config } from "../../config";
import { requirePermission } from "../../middleware/auth";
import { requireTestScope } from "../../middleware/test-scope";
import { respondWorkbookReadError, workbookUploadSingle } from "../../middleware/upload";
import { readWorkbookFromBuffer } from "../../utils/excel";
import { detectLmsExport } from "../workbook";
import { resolveTestByQuestionIds } from "../../services/lms-test-resolver";
import { runImport } from "../../services/lms-export-import";

const router = Router();

/**
 * Общий путь загрузки: разобрать, определить тест, свериться с `fixedTestId`, прогнать импорт.
 *
 * Сухой прогон и запись идут ОДНИМ обработчиком: разведи их по двум — и план начнёт расходиться с
 * тем, что импорт делает на самом деле.
 */
async function handleUpload(req: Request, res: Response, dryRun: boolean) {
  if (!req.file) return res.status(400).json({ error: "File required" });

  const workbook = await readWorkbookFromBuffer(req.file.buffer);
  const book = workbook.worksheets.map(detectLmsExport).find(Boolean) ?? null;
  if (!book) return res.status(422).json({ error: "Файл не похож на выгрузку отчёта LMS." });

  const resolved = await resolveTestByQuestionIds(book.questionIds, storage);
  if (!resolved.testId) {
    return res.status(422).json({
      error: "Не удалось однозначно определить тест по вопросам из файла.",
      foreignQuestionIds: resolved.foreign,
    });
  }

  const fixedTestId = String(req.body?.fixedTestId ?? "").trim();
  if (fixedTestId && fixedTestId !== resolved.testId) {
    const [expected, actual] = await Promise.all([
      storage.getTest(fixedTestId),
      storage.getTest(resolved.testId),
    ]);
    return res.status(422).json({
      error: `Это выгрузка другого теста: «${actual?.title ?? resolved.testId}». Открыта аналитика теста «${expected?.title ?? fixedTestId}».`,
    });
  }

  // Новая группа заводится ДО импорта: строки должны лечь уже с меткой, иначе при отказе
  // на полпути часть партии осталась бы без группы.
  let groupId: string | null = String(req.body?.groupId ?? "").trim() || null;
  const newGroupName = String(req.body?.newGroupName ?? "").trim();
  if (!groupId && newGroupName && !dryRun) {
    const group = await storage.createGroup({ id: randomUUID(), name: newGroupName, createdBy: req.session.userId! });
    groupId = group.id;
  }

  const result = await runImport(
    book,
    {
      anonymize: config.analytics.lmsImport.anonymizeParticipants,
      sourceAnonymized: req.body?.sourceAnonymized === "true" || req.body?.sourceAnonymized === true,
      linkUsers: req.body?.linkUsers === "true" || req.body?.linkUsers === true,
    },
    {
      testId: resolved.testId,
      groupId,
      fileName: req.file.originalname,
      fileBuffer: req.file.buffer,
      userId: req.session.userId!,
      dryRun,
    },
    storage,
  );

  res.json({ testId: resolved.testId, ...result });
}

router.post(
  "/lms-import",
  requirePermission("analytics.import"),
  workbookUploadSingle("file"),
  async (req: Request, res: Response) => {
    try {
      const dryRun = String(req.query.dryRun ?? "").toLowerCase() === "true";
      await handleUpload(req, res, dryRun);
    } catch (error) {
      logger.error("LMS import error: " + (error as Error).message, "analytics");
      if (respondWorkbookReadError(res, error)) return;
      res.status(400).json({ error: "Не удалось прочитать файл" });
    }
  },
);

router.get(
  "/lms-import/batches",
  requirePermission("analytics.import"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    res.json(await storage.getLmsImportBatches(String(req.query.testId)));
  },
);

router.delete(
  "/lms-import/batches/:id",
  requirePermission("analytics.import"),
  async (req: Request, res: Response) => {
    await storage.deleteLmsImportBatch(req.params.id);
    res.json({ ok: true });
  },
);

export default router;
```

Проверка области теста у `POST` идёт ВНУТРИ обработчика, а не мидлварью: тест становится известен
только после разбора файла, и повесить `requireTestScope` заранее не на что. Дополнить `handleUpload`
вызовом той же проверки по `resolved.testId` сразу после его определения.

- [ ] **Шаг 6: зарегистрировать роутер**

В `server/routes/analytics/index.ts` добавить в массив тем же способом, каким там зарегистрированы
`combined` и `export`.

- [ ] **Шаг 7: проверить сборку**

Выполнить: `npm run check`
Ожидается: без ошибок.

- [ ] **Шаг 8: коммит**

```bash
git add shared/access/ server/routes/analytics/
git commit -m "feat(prd-54): право analytics.import и эндпоинты загрузки выгрузки"
```

---

## Задача 10: внешний ключ пользователя — серверная часть

**Файлы:**

- Правка: `server/routes/users.ts` (белый список изменяемых полей, обработка конфликта)
- Тест: `server/routes/__tests__/users-external-key.test.ts`

Только API. Поле в карточке и колонка в массовой загрузке — задача 14, второй инкремент: чтобы
доказать связывание, интерфейс не нужен, ключ можно проставить тем же `PUT /api/users/:id`.

- [ ] **Шаг 1: написать падающий тест**

```ts
/**
 * @module server/routes/__tests__/users-external-key
 */
import { describe, it, expect } from "vitest";
import { normalizeExternalKey } from "../users";

describe("normalizeExternalKey", () => {
  it("обрезает пробелы, регистр сохраняет", () => {
    expect(normalizeExternalKey("  AB-12 ")).toBe("AB-12");
  });

  it("пустая строка — это отсутствие ключа", () => {
    expect(normalizeExternalKey("   ")).toBeNull();
    expect(normalizeExternalKey(undefined)).toBeNull();
  });
});
```

- [ ] **Шаг 2: прогнать и убедиться, что падает**

Выполнить: `npm test -- server/routes/__tests__/users-external-key.test.ts`
Ожидается: FAIL, `normalizeExternalKey` не определена.

- [ ] **Шаг 3: реализовать**

```ts
/**
 * Привести внешний ключ к хранимому виду (PRD-54 раздел 5.4).
 *
 * Регистр СОХРАНЯЕТСЯ: ключ показывают человеку в том виде, в каком он его ввёл. Нечувствительность
 * при сверке обеспечивают уникальный индекс по `lower(external_key)` и `getUserByExternalKey`.
 *
 * @param raw значение из формы или книги
 * @returns ключ или `null`, если поле пустое
 */
export function normalizeExternalKey(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s === "" ? null : s;
}
```

Добавить `externalKey` в белый список изменяемых полей пользователя (защита от mass assignment там
уже есть — дописать поле, а не обойти список) и перехватить нарушение уникального индекса:

```ts
    try {
      updated = await storage.updateUser(id, data);
    } catch (error) {
      // 23505 — нарушение уникальности. Отвечать 500 нельзя: это не сбой, а занятый ключ, и
      // человеку нужно имя того, кто его держит, иначе исправить нечего.
      if ((error as { code?: string }).code === "23505" && data.externalKey) {
        const owner = await storage.getUserByExternalKey(data.externalKey);
        return res.status(409).json({ error: `Ключ «${data.externalKey}» уже у пользователя ${owner?.name ?? "—"}` });
      }
      throw error;
    }
```

- [ ] **Шаг 4: прогнать тест**

Выполнить: `npm test -- server/routes/__tests__/users-external-key.test.ts`
Ожидается: PASS, 2 теста.

- [ ] **Шаг 5: коммит**

```bash
git add server/routes/users.ts server/routes/__tests__/users-external-key.test.ts
git commit -m "feat(prd-54): внешний ключ пользователя в API"
```

## Задача 11: правки аналитики

**Файлы:**

- Правка: `server/routes/analytics/combined.ts` (строки 65–115, 175–210, 286–334)
- Правка: `server/routes/analytics/export.ts` (строки 361–402, 930–975)
- Тест: `server/routes/analytics/__tests__/attempt-source.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { attemptTestId, attemptParticipant } from "../helpers";

describe("attemptTestId", () => {
  it("у импорта тест берётся из самой попытки", () => {
    expect(attemptTestId({ testId: "t1", packageId: null } as never, new Map())).toBe("t1");
  });

  it("у старой телеметрии без test_id — из пакета", () => {
    const pkgs = new Map([["p1", { testId: "t2" }]]);
    expect(attemptTestId({ testId: null, packageId: "p1" } as never, pkgs as never)).toBe("t2");
  });
});

describe("attemptParticipant", () => {
  it("связанная строка подписывается именем пользователя", () => {
    const a = { userId: "u1", participantKey: "abc123", lmsUserName: null };
    expect(attemptParticipant(a as never, new Map([["u1", { name: "Иванов" }]]) as never)).toBe("Иванов");
  });

  it("несвязанная обезличенная — псевдонимом", () => {
    const a = { userId: null, participantKey: "abc123def", lmsUserName: null };
    expect(attemptParticipant(a as never, new Map())).toBe("Участник abc123");
  });

  it("телеметрия — именем из LMS", () => {
    const a = { userId: null, participantKey: null, lmsUserName: "Петров" };
    expect(attemptParticipant(a as never, new Map())).toBe("Петров");
  });
});
```

- [ ] **Шаг 2: прогнать и убедиться, что падает**

Выполнить: `npm test -- server/routes/analytics/__tests__/attempt-source.test.ts`
Ожидается: FAIL, функции не определены.

- [ ] **Шаг 3: реализовать помощники**

В `server/routes/analytics/helpers.ts`:

```ts
/**
 * Тест LMS-прохождения (PRD-54 раздел 12).
 *
 * `scorm_attempts.test_id` — источник истины; пакет остаётся запасным путём только для строк,
 * которым backfill теста не нашёл.
 */
export function attemptTestId(
  attempt: { testId: string | null; packageId: string | null },
  packages: Map<string, { testId: string | null }>,
): string | null {
  return attempt.testId ?? (attempt.packageId ? packages.get(attempt.packageId)?.testId ?? null : null);
}

/**
 * Подпись участника LMS-прохождения.
 *
 * Порядок именно такой: связь с пользователем ЗАВОДИЛАСЬ ради того, чтобы видеть человека, поэтому
 * она перебивает псевдоним. Псевдоним показывается префиксом: полные 64 знака в таблице нечитаемы,
 * а шести хватает, чтобы отличить участников друг от друга глазами.
 */
export function attemptParticipant(
  attempt: { userId: string | null; participantKey: string | null; lmsUserName: string | null },
  users: Map<string, { name: string }>,
): string {
  if (attempt.userId) {
    const u = users.get(attempt.userId);
    if (u) return u.name;
  }
  if (attempt.lmsUserName) return attempt.lmsUserName;
  if (attempt.participantKey) return `Участник ${attempt.participantKey.slice(0, 6)}`;
  return "Неизвестный участник";
}
```

- [ ] **Шаг 4: прогнать тест**

Выполнить: `npm test -- server/routes/analytics/__tests__/attempt-source.test.ts`
Ожидается: PASS, 5 тестов.

- [ ] **Шаг 5: заменить разрешение через пакет во всех восьми местах**

В `combined.ts` (строки 71, 74, 77, 181, 184, 292, 295, 298) и `export.ts` (строки 373, 970) заменить
`packageMap.get(a.packageId)?.testId` на `attemptTestId(a, packageMap)`. Подпись участника и
`uniqueLmsUsers` (строки 115, 189, 334) перевести на `attemptParticipant` и на
`a.participantKey ?? a.lmsUserId`. Добавить в отдаваемую строку поле `origin` и `groupId`.

- [ ] **Шаг 6: проверить сборку и прогнать соседние тесты аналитики**

Выполнить: `npm run check`
Затем: `npm test -- server/routes/analytics`
Ожидается: без ошибок, существующие тесты аналитики зелёные.

- [ ] **Шаг 7: коммит**

```bash
git add server/routes/analytics/
git commit -m "feat(prd-54): аналитика видит импортированные прохождения наравне с телеметрией"
```

---

## Задача 12: скрипт импорта и прогон на реальной выгрузке

**Файлы:**

- Создание: `scripts/db/import-lms-export.ts`

Здесь инкремент 1 доказывает себя целиком. Скрипт зовёт ТОТ ЖЕ `runImport`, который потом позовёт
кнопка, поэтому прогон проверяет настоящий конвейер, а не его подобие. Пока интерфейса нет, скрипт
остаётся рабочим инструментом для заливок — выбрасывать его не нужно.

- [ ] **Шаг 1: написать скрипт**

```ts
/**
 * @module scripts/db/import-lms-export
 * @description Загрузка выгрузки отчёта LMS из файла, без интерфейса (PRD-54, инкремент 1).
 *
 * Зовёт тот же `runImport`, что и HTTP-эндпоинт: у скрипта нет своей копии логики, иначе прогон
 * доказывал бы работоспособность скрипта, а не продукта.
 *
 * Запуск:
 *   npx tsx scripts/db/import-lms-export.ts <файл.xlsx> --user <userId> [--group <groupId>]
 *     [--link-users] [--source-anonymized] [--dry-run]
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import ExcelJS from "exceljs";
import { config } from "../../server/config";
import { storage } from "../../server/storage";
import { looksLikeLmsExport, parseLmsExport } from "../../shared/lms-export/parse";
import { resolveTestByQuestionIds } from "../../server/services/lms-test-resolver";
import { runImport } from "../../server/services/lms-export-import";

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function opt(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Укажите путь к файлу выгрузки");
  const userId = opt("user");
  if (!userId) throw new Error("Укажите --user <userId>: партия импорта хранит автора загрузки");

  const buffer = readFileSync(file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  // Та же гоча дат, что в задаче 7: `String(Date)` даёт локализованную строку.
  const matrix = (sheet: ExcelJS.Worksheet) => {
    const out: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      out.push((row.values as unknown[]).slice(1).map((v) => {
        if (v == null) return "";
        if (v instanceof Date) return v.toISOString();
        return String(v);
      }));
    });
    return out;
  };

  const sheet = wb.worksheets.map(matrix).find(looksLikeLmsExport);
  if (!sheet) throw new Error("Файл не похож на выгрузку отчёта LMS");
  const book = parseLmsExport(sheet);

  const resolved = await resolveTestByQuestionIds(book.questionIds, storage);
  if (!resolved.testId) throw new Error("Тест по вопросам файла не определён однозначно");
  console.log("тест:", resolved.testId, "| строк:", book.rows.length, "| чужих вопросов:", resolved.foreign.length);

  const result = await runImport(
    book,
    {
      anonymize: config.analytics.lmsImport.anonymizeParticipants,
      sourceAnonymized: flag("source-anonymized"),
      linkUsers: flag("link-users"),
    },
    {
      testId: resolved.testId,
      groupId: opt("group"),
      fileName: basename(file),
      fileBuffer: buffer,
      userId,
      dryRun: flag("dry-run"),
    },
    storage,
  );

  console.log(JSON.stringify(result, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Шаг 2: подготовить файл под тест, который ЕСТЬ в базе**

ГОЧА, вскрытая прогоном. Приложенная выгрузка `docs/references/7684237229762827328-1.xlsx` собрана
на ПРОДЕ, и её четырнадцати вопросов в dev-базе нет — скрипт честно отказывает: «Тест по вопросам
файла не определён однозначно, из них неизвестных базе: 14». Это правильная ветка отказа, её стоит
увидеть, но сквозной прогон на ней не сделать.

Для записи нужен файл той же формы под тест, который в dev есть (годятся копии ЧИЛ, например
`1ac820b0-9260-445f-8111-34722c9fc49f`): те же девять служебных колонок, те же четвёрки подколонок,
идентификаторы `q_<uuid>` живых вопросов, `scale_<key>` и `var_<name>` этого теста.

- [ ] **Шаг 3: сухой прогон**

Взять идентификатор любого автора из dev-базы и выполнить:

```bash
npx tsx scripts/db/import-lms-export.ts docs/references/7684237229762827328-1.xlsx --user <userId> --dry-run
```

Ожидается: напечатан тест «Определение ведущего стиля человекоцентричного лидерства»,
`rowsCreated: 1`, `rowsUpdated: 0`, в базе ничего не создано.

- [ ] **Шаг 4: настоящий прогон**

Выполнить ту же команду без `--dry-run`.
Ожидается: `rowsCreated: 1`, появилась партия и одно прохождение.

- [ ] **Шаг 5: проверить идемпотентность**

Выполнить ту же команду ещё раз.
Ожидается: `rowsCreated: 0`, `rowsUpdated: 1`. Второго прохождения НЕ появилось.

- [ ] **Шаг 6: проверить, что аналитика его видит**

ГОЧА ПОРТА. Порты 8093 — 8099 разбирают параллельные сессии, и `npm run dev` на занятом порту
падает с `EADDRINUSE`, ОСТАВЛЯЯ чужой сервер отвечать на запросы. Ответ при этом приходит от чужого
кода и выглядит как дефект твоих правок. Перед запуском выбрать свободный порт
(`netstat -ano | grep LISTENING`) и после проверки убедиться, что в логе нет `EADDRINUSE`.

```bash
curl -s --cookie "connect.sid=<сессия>" "http://localhost:8099/api/analytics/combined?source=lms" | head -c 2000
```

Ожидается: в выдаче есть строка с `source: "lms"`, `origin: "import"`, подписью участника
«Участник …» и заполненными шкалами.

- [ ] **Шаг 7: проверить связывание**

Проставить пользователю внешний ключ через API, затем повторить прогон с `--link-users`.
Ожидается: `rowsLinked: 1`, `rowsCreated: 0` — связь появилась, дубля нет.

- [ ] **Шаг 7: коммит**

```bash
git add scripts/db/import-lms-export.ts
git commit -m "feat(prd-54): скрипт импорта выгрузки и прогон на реальном файле"
```

**ГЕЙТ ИНКРЕМЕНТА 1.** Пока шаги 2 — 6 не сошлись на реальном файле, к инкременту 2 не переходить.

---

## Инкремент 2 — интерфейс

---

## Задача 13: эскизы (ГЕЙТ, блокирует задачи 14 — 16)

**Файлы:**

- Создание: `docs/wireframes/prd54-lms-import.html`

В этом проекте UI пишется ТОЛЬКО после сверки с эскизом — жёсткое правило, нарушение которого
означает переписывание готового экрана. Перед рисованием прочитать руководство по дизайн-системе:
эскиз собирается из существующих компонентов ДС, а не из произвольной разметки.

- [ ] **Шаг 1: прочитать руководство ДС**

Открыть документацию дизайн-системы и найти готовые компоненты под форму: выпадающий список,
флажок, баннер, таблица, модальное окно, загрузчик файла. Ничего своего не рисовать.

- [ ] **Шаг 2: собрать эскиз**

`docs/wireframes/prd54-lms-import.html` — состояния формы: пустая, после сухого прогона с планом,
с предупреждениями, отказ по чужому тесту, список партий. В холсте только реальный UI; пояснения —
в заметках рядом, не поверх макета. Эскизный фрейм — единственная рамка.

- [ ] **Шаг 3: посмотреть в браузере в обеих темах**

```bash
python -m http.server 8010 --directory .
```

Открыть `http://localhost:8010/docs/wireframes/prd54-lms-import.html`, проверить светлую и тёмную
темы. Сетка 4px: 1x между родственными элементами, 4x между разными, 6x от краёв.

- [ ] **Шаг 4: прогнать гейт соответствия ДС**

Выполнить: `npm run check:wireframes:ds`
Ожидается: без нарушений.

- [ ] **Шаг 5: согласовать эскиз с владельцем**

Показать и ДОЖДАТЬСЯ подтверждения. Без него задачи 14 — 16 не начинать.

- [ ] **Шаг 6: коммит**

```bash
git add docs/wireframes/prd54-lms-import.html
git commit -m "docs(prd-54): эскизы формы загрузки выгрузки LMS"
```

---

## Задача 14: ключ пользователя в интерфейсе

**Файлы:**

- Правка: `server/routes/users.ts` (`/bulk-preview` строка 605, `/bulk-import` строка 664)
- Правка: `client/src/pages/author/users.tsx` (форма пользователя и экран массовой загрузки)
- Тест: `server/routes/__tests__/users-external-key.test.ts` (дописать)

- [ ] **Шаг 1: добавить поле в форму пользователя**

`Input` с подписью «Внешний ключ» и подсказкой «По нему импорт выгрузок LMS находит этого человека».
Ошибку `409` показать текстом от сервера.

- [ ] **Шаг 2: написать падающий тест колонки**

Поля в карточке хватает на десяток человек, на сотни — нет (спека раздел 11.4).

```ts
import { readExternalKeyColumn } from "../users";

describe("readExternalKeyColumn", () => {
  it("читает колонку по любому из псевдонимов", () => {
    expect(readExternalKeyColumn({ external_key: "AB-1" })).toBe("AB-1");
    expect(readExternalKeyColumn({ "Внешний ключ": "AB-2" })).toBe("AB-2");
    expect(readExternalKeyColumn({ "ключ": "AB-3" })).toBe("AB-3");
  });

  it("пустая колонка — это отсутствие ключа, а не пустой ключ", () => {
    expect(readExternalKeyColumn({ external_key: "   " })).toBeNull();
    expect(readExternalKeyColumn({})).toBeNull();
  });
});
```

- [ ] **Шаг 3: прогнать и убедиться, что падает**

Выполнить: `npm test -- server/routes/__tests__/users-external-key.test.ts`
Ожидается: FAIL, `readExternalKeyColumn` не определена.

- [ ] **Шаг 4: реализовать колонку**

```ts
/**
 * Внешний ключ из строки книги массовой загрузки (PRD-54 раздел 11.4).
 *
 * Псевдонимы те же по духу, что у `email`/`ФИО`/`роль`/`группа` рядом: книгу заполняет человек, а не
 * выгружает система, и требовать одно точное написание заголовка — способ получить молчаливо
 * пропущенную колонку.
 *
 * @param row строка книги
 * @returns ключ или `null`, если колонки нет или она пуста
 */
export function readExternalKeyColumn(row: Record<string, unknown>): string | null {
  const raw = row["external_key"] ?? row["Внешний ключ"] ?? row["внешний ключ"] ?? row["ключ"] ?? "";
  const s = String(raw).trim();
  return s === "" ? null : s;
}
```

В `/bulk-preview` прочитать ключ каждой строки и добавить в предпросмотр:

```ts
      const externalKey = readExternalKeyColumn(row);
      // Ключ, занятый ДРУГИМ пользователем, — ошибка строки, а не повод перезаписать: на
      // уникальности ключа держится связывание, и тихая перезапись порвала бы готовые связи.
      const keyOwner = externalKey ? await storage.getUserByExternalKey(externalKey) : undefined;
      if (externalKey && keyOwner && keyOwner.id !== existing?.id) {
        return { idx, email, name, role, groupName, groupId, groupFound, externalKey,
          status: "error", error: `Ключ «${externalKey}» уже у пользователя ${keyOwner.name}` };
      }
```

Состояние строки: существующий email с НЕПУСТЫМ ключом получает не `duplicate`, а `keyUpdate` —
такая строка не пропускается, а проставляет ключ уже заведённому пользователю:

```ts
        status: existing ? (externalKey ? "keyUpdate" : "duplicate") : "new",
```

В `/bulk-import` для `new` записать `externalKey` вместе с остальными полями, для `keyUpdate` —
вызвать `storage.updateUser(existingId, { externalKey })` и не создавать ничего.

- [ ] **Шаг 5: прогнать тест**

Выполнить: `npm test -- server/routes/__tests__/users-external-key.test.ts`
Ожидается: PASS, 4 теста.

- [ ] **Шаг 6: показать состояние в предпросмотре**

В экране массовой загрузки добавить колонку «Внешний ключ» и подпись для состояния `keyUpdate` —
«ключ будет обновлён». Ошибку занятого ключа показать текстом от сервера.

- [ ] **Шаг 7: коммит**

```bash
git add server/routes/users.ts client/src/pages/author/users.tsx server/routes/__tests__/users-external-key.test.ts
git commit -m "feat(prd-54): ключ пользователя в карточке и колонкой в массовой загрузке"
```

---

## Задача 15: форма импорта (гейт для задачи 16)

**Файлы:**

- Создание: `client/src/features/analytics/lms-import/lms-import-form.tsx`
- Создание: `client/src/features/analytics/lms-import/use-lms-import.ts`
- Тест: `client/src/features/analytics/lms-import/__tests__/lms-import-form.test.tsx`

- [ ] **Шаг 1: написать падающий тест**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LmsImportForm } from "../lms-import-form";

describe("LmsImportForm", () => {
  it("без fixedTestId показывает тест, определённый из файла", async () => {
    render(<LmsImportForm inspect={{ kind: "lmsExport", testId: "t1", testTitle: "ЧИЛ", rows: 3 }} onDone={vi.fn()} />);
    expect(await screen.findByText(/ЧИЛ/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Целевой тест")).not.toBeInTheDocument();
  });

  it("с fixedTestId и чужим файлом показывает отказ и не даёт импортировать", async () => {
    render(
      <LmsImportForm
        fixedTestId="t2"
        inspect={{ kind: "lmsExport", testId: "t1", testTitle: "ЧИЛ", rows: 3 }}
        onDone={vi.fn()}
      />,
    );
    expect(await screen.findByText(/выгрузка другого теста/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /импортировать/i })).toBeDisabled();
  });

  it("предлагает создать новую группу и не привязывать к группе", async () => {
    render(<LmsImportForm inspect={{ kind: "lmsExport", testId: "t1", testTitle: "ЧИЛ", rows: 3 }} onDone={vi.fn()} />);
    expect(await screen.findByText("Без группы")).toBeInTheDocument();
    expect(screen.getByText("＋ Создать новую группу")).toBeInTheDocument();
  });
});
```

- [ ] **Шаг 2: прогнать и убедиться, что падает**

Выполнить: `npm test -- client/src/features/analytics/lms-import`
Ожидается: FAIL, модуль не найден.

- [ ] **Шаг 3: реализовать форму**

```tsx
/**
 * @module features/analytics/lms-import/lms-import-form
 * @description Форма загрузки выгрузки отчёта LMS (PRD-54 раздел 11).
 *
 * ОДНА на три точки входа: экран «Импорт» встраивает её в страницу, обе страницы аналитики —
 * в `ModalDialog`. Копии разошлись бы поведением сухого прогона и предупреждений.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Banner, Button, Checkbox, Combobox, Stack, Table, Text, type ComboboxOption } from "@skillum/ui-kit";
import { queryClient } from "@/lib/queryClient";

/** Сентинелы списка групп — по образцу `NEW_TEST = "__new__"` из `pages/author/import.tsx`. */
const NO_GROUP = "__none__";
const NEW_GROUP = "__new__";

export interface LmsInspectResult {
  kind: "lmsExport";
  testId: string | null;
  testTitle: string | null;
  rows: number;
  looksPersonal?: boolean;
}

export interface LmsImportFormProps {
  inspect: LmsInspectResult;
  file?: File;
  /** Задан на странице аналитики КОНКРЕТНОГО теста: файл чужого теста будет отвергнут. */
  fixedTestId?: string;
  onDone: () => void;
}

export function LmsImportForm({ inspect, file, fixedTestId, onDone }: LmsImportFormProps) {
  const [group, setGroup] = useState(NO_GROUP);
  const [newGroupName, setNewGroupName] = useState("");
  const [sourceAnonymized, setSourceAnonymized] = useState(false);
  const [linkUsers, setLinkUsers] = useState(false);
  const [plan, setPlan] = useState<null | { rowsCreated: number; rowsUpdated: number; rowsSkipped: number; rowsLinked: number; warnings: string[] }>(null);

  const groups = useQuery<Array<{ id: string; name: string }>>({ queryKey: ["/api/groups"] });

  const mismatch = !!fixedTestId && !!inspect.testId && fixedTestId !== inspect.testId;

  const send = (dryRun: boolean) => {
    const body = new FormData();
    if (file) body.append("file", file);
    if (fixedTestId) body.append("fixedTestId", fixedTestId);
    if (group !== NO_GROUP && group !== NEW_GROUP) body.append("groupId", group);
    if (group === NEW_GROUP) body.append("newGroupName", newGroupName);
    body.append("sourceAnonymized", String(sourceAnonymized));
    body.append("linkUsers", String(linkUsers));
    return fetch(`/api/analytics/lms-import?dryRun=${dryRun}`, { method: "POST", body, credentials: "include" })
      .then(async (r) => { if (!r.ok) throw new Error((await r.json()).error); return r.json(); });
  };

  const dry = useMutation({ mutationFn: () => send(true), onSuccess: setPlan });
  const run = useMutation({
    mutationFn: () => send(false),
    onSuccess: () => {
      // Цифры на странице, с которой форму открыли, должны обновиться без перезагрузки.
      queryClient.invalidateQueries({ queryKey: ["/api/analytics"] });
      onDone();
    },
  });

  const options: ComboboxOption[] = [
    { value: NO_GROUP, label: "Без группы" },
    { value: NEW_GROUP, label: "＋ Создать новую группу" },
    ...(groups.data ?? []).map((g) => ({ value: g.id, label: g.name })),
  ];

  return (
    <Stack gap="m">
      {mismatch ? (
        <Banner variant="error">
          Это выгрузка другого теста: «{inspect.testTitle}». Откройте аналитику этого теста или выберите другой файл.
        </Banner>
      ) : (
        <Text>Тест: {inspect.testTitle ?? "не определён"}. Строк в файле: {inspect.rows}.</Text>
      )}

      <Combobox label="Группа" value={group} onChange={setGroup} options={options} />
      {group === NEW_GROUP && (
        <Input label="Название новой группы" value={newGroupName} onChange={setNewGroupName} />
      )}

      <Checkbox checked={sourceAnonymized} onChange={setSourceAnonymized} label="Данные уже обезличены" />
      {sourceAnonymized && inspect.looksPersonal && (
        <Banner variant="warning">
          Отмечено «уже обезличены», но колонка участника похожа на ФИО. Проверьте файл.
        </Banner>
      )}

      <Checkbox checked={linkUsers} onChange={setLinkUsers} label="Связать с пользователями по ключу" />

      <Button variant="secondary" onClick={() => dry.mutate()} disabled={mismatch || dry.isPending}>
        Проверить
      </Button>

      {plan && (
        <Stack gap="s">
          <Table
            columns={[{ key: "k", title: "" }, { key: "v", title: "" }]}
            rows={[
              { k: "Добавится", v: plan.rowsCreated },
              { k: "Обновится", v: plan.rowsUpdated },
              { k: "Пропущено", v: plan.rowsSkipped },
              { k: "Свяжется с пользователями", v: plan.rowsLinked },
            ]}
          />
          {plan.warnings.map((w) => <Banner key={w} variant="warning">{w}</Banner>)}
        </Stack>
      )}

      <Button onClick={() => run.mutate()} disabled={mismatch || !plan || run.isPending}>
        Импортировать
      </Button>
      {run.isError && <Banner variant="error">{(run.error as Error).message}</Banner>}
    </Stack>
  );
}
```

Только DS-примитивы из `@skillum/ui-kit`. Голых `div` с классами не добавлять. Если какого-то
примитива в наборе нет (`Checkbox`, `Table` с такой сигнатурой) — сверить имена по
`vendor/ui-kit/src/index.ts` и взять существующий, а не писать свой.

- [ ] **Шаг 4: прогнать тест**

Выполнить: `npm test -- client/src/features/analytics/lms-import`
Ожидается: PASS, 3 теста.

- [ ] **Шаг 5: коммит**

```bash
git add client/src/features/analytics/lms-import/
git commit -m "feat(prd-54): форма загрузки выгрузки LMS"
```

---

## Задача 16: три точки входа

**Файлы:**

- Правка: `client/src/pages/author/import.tsx` (ветка по `kind`)
- Правка: `client/src/pages/author/analytics.tsx` (кнопка в слоте действий)
- Правка: `client/src/pages/author/test-analytics.tsx` (кнопка рядом с «Экспорт в Excel», строка 1058)

- [ ] **Шаг 1: ветка на экране импорта**

В `import.tsx`, в месте, где сейчас разбирается ответ `inspect`, добавить ветку ПЕРЕД существующей
логикой ролевых листов:

```tsx
{inspectResult?.kind === "lmsExport" ? (
  <LmsImportForm
    inspect={inspectResult}
    file={selectedFile ?? undefined}
    onDone={() => { setInspectResult(null); setSelectedFile(null); }}
  />
) : (
  /* существующий путь книги теста — без изменений */
)}
```

- [ ] **Шаг 2: кнопка в общей аналитике**

В `analytics.tsx` рядом с существующей кнопкой действий (около строки 423):

```tsx
const [importOpen, setImportOpen] = useState(false);
const [importFile, setImportFile] = useState<File | null>(null);
const [importInspect, setImportInspect] = useState<LmsInspectResult | null>(null);

<Button variant="secondary" leadingIcon={<Upload size={16} />} onClick={() => setImportOpen(true)}>
  Загрузить выгрузку LMS
</Button>

<ModalDialog open={importOpen} onClose={() => setImportOpen(false)} title="Загрузка выгрузки LMS">
  <DialogContent>
    <FileUploader accept=".xlsx" onSelect={async (f) => {
      setImportFile(f);
      const body = new FormData();
      body.append("file", f);
      const r = await fetch("/api/workbook/inspect", { method: "POST", body, credentials: "include" });
      setImportInspect(await r.json());
    }} />
    {importInspect?.kind === "lmsExport" && (
      <LmsImportForm inspect={importInspect} file={importFile ?? undefined} onDone={() => setImportOpen(false)} />
    )}
  </DialogContent>
</ModalDialog>
```

- [ ] **Шаг 3: кнопка в аналитике теста**

В `test-analytics.tsx` рядом с «Экспорт в Excel» (строка 1058) — тот же блок, но с `fixedTestId`:

```tsx
<Button variant="secondary" leadingIcon={<Upload size={16} />} onClick={() => setImportOpen(true)}>
  Загрузить выгрузку LMS
</Button>

<ModalDialog open={importOpen} onClose={() => setImportOpen(false)} title="Загрузка выгрузки LMS">
  <DialogContent>
    <FileUploader accept=".xlsx" onSelect={async (f) => {
      setImportFile(f);
      const body = new FormData();
      body.append("file", f);
      const r = await fetch("/api/workbook/inspect", { method: "POST", body, credentials: "include" });
      setImportInspect(await r.json());
    }} />
    {importInspect?.kind === "lmsExport" && (
      <LmsImportForm
        inspect={importInspect}
        file={importFile ?? undefined}
        fixedTestId={testId}
        onDone={() => setImportOpen(false)}
      />
    )}
  </DialogContent>
</ModalDialog>
```

Образец модального окна в этом файле — `AttemptDetailModal` (строка 389): взять оттуда способ
открытия и закрытия, а не изобретать свой.

- [ ] **Шаг 4: проверить сборку**

Выполнить: `npm run check`
Ожидается: без ошибок.

- [ ] **Шаг 5: коммит**

```bash
git add client/src/pages/author/
git commit -m "feat(prd-54): вызов импорта из трёх точек входа"
```

---

## Задача 17: приёмка в браузере

Правило проекта: фронтенд принимается в браузере, а не по зелёным тестам.

**Файлы:**

- Создание: `docs/reports/prd54-lms-import-acceptance.md`

- [ ] **Шаг 1: поднять dev**

Выполнить: `npm run dev`
Войти учёткой приёмки `acceptance@local.test` / `Acceptance!2026`.

- [ ] **Шаг 2: убрать следы инкремента 1**

Партия, залитая скриптом задачи 12, уже лежит в базе, и без отката сухой прогон покажет не
«добавится 1», а «обновится 1» — приёмка начнёт проверять не тот сценарий. Откатить её:

```bash
npx tsx -e "import('./server/storage').then(async ({storage}) => { const b = await storage.getLmsImportBatches('<testId>'); for (const x of b) await storage.deleteLmsImportBatch(x.id); console.log('откачено', b.length); })"
```

- [ ] **Шаг 3: пройти сценарий на экране «Импорт»**

Загрузить `docs/references/7684237229762827328-1.xlsx`. Убедиться: формат опознан, тест определён как
«Определение ведущего стиля человекоцентричного лидерства», сухой прогон показывает 1 строку к
добавлению, импорт проходит, строка видна в аналитике теста.

- [ ] **Шаг 4: повторить тот же файл**

Ожидается: «добавлено 0, обновлено 1», второй строки не появилось.

- [ ] **Шаг 5: пройти сценарий из общей аналитики и из аналитики теста**

В аналитике теста дополнительно проверить отказ: открыть аналитику ДРУГОГО теста и загрузить тот же
файл — ожидается отказ с названиями обоих тестов.

- [ ] **Шаг 6: проверить связывание**

Проставить пользователю внешний ключ, равный значению колонки «Пользователь», загрузить файл повторно
с включённым флажком связывания — в аналитике вместо псевдонима появляется имя пользователя.

- [ ] **Шаг 7: проверить откат**

Откатить партию, убедиться, что строки исчезли, а телеметрия других тестов не задета.

- [ ] **Шаг 8: снять скриншоты и записать отчёт**

Записать `docs/reports/prd54-lms-import-acceptance.md`: по пункту на каждый шаг, со скриншотами.

- [ ] **Шаг 9: коммит**

```bash
git add docs/reports/prd54-lms-import-acceptance.md
git commit -m "docs(prd-54): отчёт о приёмке импорта выгрузок LMS"
```
