# PRD-28 «Внешний участник»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Цель:** завести внешнего участника как признак учётной записи без пароля и дать организатору сквозной
сценарий «файл со списком -> предпросмотр -> назначение теста и рассылка ссылок -> отчёт с выгрузкой».

**Устройство:** ограничение доступа переиспользует существующую область magic-link, новых механизмов доступа
не вводится. Признак «внешний» закрывает три пути входа мимо ссылки (пароль, восстановление, приглашение).
Конвейер загрузки списком живёт в отдельном сервисе, роуты остаются тонкими, интерфейс — четвёртая вкладка
существующего диалога назначения теста.

**Основа:** TypeScript, Express 5, Drizzle ORM, PostgreSQL, React 19, `@universityrt/ui-kit`, Vitest,
ExcelJS.

**Спека:** `docs/specs/prd-28/external-participant.md`. Ветка: `feat/bulk-invite`.

---

## Как работать с этим планом

- Тесты запускать ТОЛЬКО через `npm test -- <путь>`. `npx vitest run` в этом проекте падает.
- Полный прогон (`npm test` без пути) не запускать без явного разрешения владельца: в одной рабочей копии
  одновременно работают несколько сессий.
- Коммиты частые, по одному на задачу. Трейлер `Co-Authored-By` не добавлять никогда.
- Все комментарии в коде и JSDoc — по-английски, JSDoc модулей обязателен и включает `@module`.
- В интерфейсе только компоненты дизайн-системы (`@universityrt/ui-kit`), сырой Tailwind запрещён.

## Состав файлов

Создаются:

- `drizzle/0018_prd28_external_participant.sql` — миграция схемы.
- `server/services/participants-invite.ts` — разбор файла, статусы строк, прогон, отчёт.
- `client/src/features/tests/assign/bulk-invite-tab.tsx` — вкладка «Списком из файла».
- `client/src/features/tests/assign/bulk-invite-export.ts` — сборка xlsx со ссылками.
- `docs/wireframes/prd-28/*.html` — эскизы (задача 14).
- Тесты: `tests/services.participants-invite.test.ts`, `tests/routes.participants.test.ts`,
  `tests/routes.auth-external.test.ts`, `tests/storage/users-external.test.ts`,
  `client/src/features/tests/assign/__tests__/bulk-invite-tab.test.tsx`.

Изменяются:

- `shared/schema.ts` — колонка `isExternal`, обнуляемый `passwordHash`.
- `tests/it/schema.sql` — та же правка для харнесса pglite (иначе тесты DAL упадут).
- `server/storage/users-repository.ts` — создание без пароля, отказ входа, перевод в штатные.
- `server/storage.ts` — делегирование новых методов.
- `server/routes/auth.ts` — вход и восстановление доступа.
- `server/routes/users.ts` — создание, приглашение, перевод в штатные, потолок строк из настроек.
- `server/routes/assignments.ts` — два новых эндпоинта.
- `server/services/assignment-link.ts` — возврат выпущенной ссылки.
- `server/email.ts` — письмо без разовой ссылки ведёт на адрес теста.
- `server/config.ts`, `config/*.config.jsonc` — раздел `limits`.
- `client/src/components/assign-test-dialog.tsx` — четвёртая вкладка.
- `client/src/pages/author/users.tsx` — признак в форме, отметка и фильтр, «сделать штатным».

---

## Этап 1. Схема и учётная запись

### Задача 1. Миграция схемы

**Файлы:**

- Изменить: `shared/schema.ts:14` (колонка `passwordHash`), `shared/schema.ts:19` (добавить `isExternal`)
- Создать: `drizzle/0018_prd28_external_participant.sql`
- Изменить: `tests/it/schema.sql` (таблица `users`)

**Грабли нумерации.** В главной рабочей копии лежат ещё не закоммиченные `0016_prd_pass_decision_policy.sql`
и `0017_prd_pass_decision_policy_backfill.sql` из соседней сессии. В этом worktree их не видно, поэтому
`drizzle-kit generate` предложит номер `0016` и при слиянии получится столкновение. Номер и запись в журнале
привести к `0018` вручную.

- [ ] **Шаг 1. Правка схемы**

В `shared/schema.ts`, таблица `users`:

```ts
  passwordHash: text("password_hash"), // scrypt hash (PRD-9); NULL for an external participant (PRD-28)
  name: text("name"), // заполняется при первом входе
  // PRD-28: an external participant is a FLAG on the account, never a role. Such an
  // account has no password at all: password login, recovery and the invite letter
  // are refused, and the only way in is the assignment link.
  isExternal: boolean("is_external").notNull().default(false),
```

- [ ] **Шаг 2. Сгенерировать миграцию**

Выполнить: `npx drizzle-kit generate --name prd28_external_participant`

Ожидаемо: создан файл `drizzle/0016_prd28_external_participant.sql` и добавлена запись в
`drizzle/meta/_journal.json`.

- [ ] **Шаг 3. Перенумеровать в 0018**

Переименовать файл в `drizzle/0018_prd28_external_participant.sql`, снимок — в
`drizzle/meta/0018_snapshot.json`, а в `drizzle/meta/_journal.json` у новой записи выставить `"idx": 18` и
`"tag": "0018_prd28_external_participant"`.

Содержимое SQL должно быть таким:

```sql
ALTER TABLE "users" ADD COLUMN "is_external" boolean DEFAULT false NOT NULL;
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
```

- [ ] **Шаг 4. Повторить правку в схеме харнесса**

В `tests/it/schema.sql`, в определении таблицы `users`: снять `NOT NULL` с `password_hash` и добавить
`is_external boolean NOT NULL DEFAULT false`.

- [ ] **Шаг 5. Применить миграцию и проверить типы**

Выполнить: `npx drizzle-kit migrate` затем `npm run check`

Ожидаемо: миграция применена; `tsc` завершается без ошибок (тип `User.passwordHash` стал
`string | null`, все места, где он читается, компилируются — если нет, довести до компиляции в задаче 2).

- [ ] **Шаг 6. Коммит**

```bash
git add shared/schema.ts drizzle tests/it/schema.sql
git commit -m "feat(prd-28): признак внешнего участника и учётка без пароля в схеме"
```

### Задача 2. Отказ входа по паролю

**Файлы:**

- Изменить: `server/storage/users-repository.ts:54` (`createUser`), `:76` (`validatePassword`)
- Тест: `tests/storage/users-external.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

Создать `tests/storage/users-external.test.ts` по образцу `tests/storage/assignments-repository.test.ts`
(тот же харнесс pglite, та же шапка с `// @vitest-environment node` и `vi.mock("../../server/db", ...)`):

```ts
describe("external participant account", () => {
  it("создаётся без пароля и не пускает по паролю", async () => {
    const user = await storage.createUser({
      email: "ext@example.com",
      passwordHash: null,
      name: "Внешний",
      isExternal: true,
    } as InsertUser);

    expect(user.isExternal).toBe(true);
    expect(user.passwordHash).toBeNull();
    expect(await storage.validatePassword("ext@example.com", "любой")).toBeNull();
  });

  it("штатная учётка по-прежнему пускает по паролю", async () => {
    await storage.createUser({
      email: "staff@example.com",
      passwordHash: "Secret!2026",
      name: "Штатный",
    } as InsertUser);

    expect(await storage.validatePassword("staff@example.com", "Secret!2026")).not.toBeNull();
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/storage/users-external.test.ts`

Ожидаемо: FAIL — `hashPassword` получает `null` и падает либо возвращает хеш от строки `"null"`.

- [ ] **Шаг 3. Реализация**

В `server/storage/users-repository.ts`:

```ts
  async createUser(insertUser: InsertUser & { createdBy?: string }): Promise<User> {
    const id = randomUUID();
    // PRD-28: an external participant has no password at all. Storing an
    // unreachable random hash instead would blur "there is no password" into
    // "there is one nobody knows" — a distinction that matters in an incident.
    const hashedPassword = insertUser.passwordHash == null
      ? null
      : await hashPassword(insertUser.passwordHash);
```

в `values({...})` добавить `isExternal: insertUser.isExternal ?? false,` и передавать `hashedPassword`
как есть.

Там же:

```ts
  async validatePassword(email: string, password: string): Promise<User | null> {
    const user = await this.getUserByEmail(email);
    // No password to check: either an external participant (PRD-28) or a legacy
    // row without a hash. Fall through the same dummy verification as the
    // not-found path so the response time does not tell the two apart.
    if (!user || user.isExternal || !user.passwordHash) {
      await dummyVerifyPassword(password);
      return null;
    }
```

- [ ] **Шаг 4. Убедиться, что тест проходит**

Выполнить: `npm test -- tests/storage/users-external.test.ts`

Ожидаемо: PASS, два теста.

- [ ] **Шаг 5. Долги, оставшиеся от задачи 1**

Задача 1 сняла с `passwordHash` тип `string`, и один потребитель об этом не знает:
`scripts/db/bcrypt-residual.ts:39,62` объявляет `password_hash: string` и гонит значение в
`isLegacyBcryptHash`. Регулярное выражение приводит `null` к строке `"null"` и не падает, поэтому
беспарольные учётки молча попадут в графу «переведены на scrypt» и исказят решение по PRD-9 Этап 3.

Поправить: тип `string | null`, пропуск таких строк (`r.password_hash != null`) и отдельная строка отчёта
«без пароля (внешние)»; сигнатуру `isLegacyBcryptHash` в `server/utils/crypto.ts:109` расширить до
`string | null`.

- [ ] **Шаг 6. Коммит**

```bash
git add server/storage/users-repository.ts tests/storage/users-external.test.ts scripts/db/bcrypt-residual.ts server/utils/crypto.ts
git commit -m "feat(prd-28): внешняя учётка заводится без пароля и не пускает по паролю"
```

### Задача 3. Отказ восстановления доступа и приглашения

**Файлы:**

- Изменить: `server/routes/auth.ts:207` (после `getUserByEmail`), `server/routes/users.ts:300` (invite)
- Тест: `tests/routes.auth-external.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

Создать `tests/routes.auth-external.test.ts` по образцу `tests/routes.tests.test.ts` (мок `storage`,
`supertest`, express-приложение с сессией):

```ts
describe("внешний участник и пути восстановления", () => {
  it("forgot-password не выпускает токен и отвечает нейтрально", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ id: "u1", email: "ext@example.com", isExternal: true });

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "ext@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("If this email exists, a reset link has been sent");
    expect(res.body.hint).toBeUndefined();
    expect(storageMock.createPasswordResetToken).not.toHaveBeenCalled();
  });

  it("приглашение задать пароль внешней учётке отклоняется", async () => {
    storageMock.getUser.mockResolvedValue({ id: "u1", status: "pending", isExternal: true });

    const res = await request(app).post("/api/users/u1/invite").send({});

    expect(res.status).toBe(400);
    expect(storageMock.createPasswordResetToken).not.toHaveBeenCalled();
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/routes.auth-external.test.ts`

Ожидаемо: FAIL — токен выпускается в обоих случаях.

- [ ] **Шаг 3. Реализация**

В `server/routes/auth.ts`, сразу после `const user = await storage.getUserByEmail(email);` и проверки
`if (!user)`:

```ts
    // PRD-28: an external participant has no password to reset. The answer is the
    // same neutral one the unknown-address branch gives, so the reply does not
    // disclose that the address exists as an external account.
    if (user.isExternal) {
      logger.info("Password reset refused for an external participant", "auth");
      return res.json({
        success: true,
        message: "If this email exists, a reset link has been sent",
      });
    }
```

В `server/routes/users.ts`, в обработчике `POST /:id/invite`, сразу после проверки существования:

```ts
    // PRD-28: the invitation letter carries a password-setup link, and an external
    // participant must never get one — their only way in is the assignment link.
    if (user.isExternal) {
      return res.status(400).json({ error: "An external participant cannot be invited to set a password" });
    }
```

- [ ] **Шаг 4. Убедиться, что тесты проходят**

Выполнить: `npm test -- tests/routes.auth-external.test.ts`

Ожидаемо: PASS, два теста.

- [ ] **Шаг 5. Коммит**

```bash
git add server/routes/auth.ts server/routes/users.ts tests/routes.auth-external.test.ts
git commit -m "feat(prd-28): внешней учётке отказано в восстановлении пароля и приглашении"
```

### Задача 4. Заведение поштучно и перевод в штатные

**Файлы:**

- Изменить: `server/routes/users.ts:79` (`POST /`), добавить `POST /:id/promote`
- Изменить: `server/storage/users-repository.ts`, `server/storage.ts` (метод `promoteExternalUser`)
- Тест: `tests/routes.users-external.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
describe("заведение внешнего участника и перевод в штатные", () => {
  it("создаёт внешнего без пароля и только с ролью learner", async () => {
    storageMock.getUserByEmail.mockResolvedValue(null);
    storageMock.createUser.mockResolvedValue({ id: "u9", email: "e@x.ru", isExternal: true });

    const res = await request(app).post("/api/users").send({ email: "e@x.ru", name: "Внешний", isExternal: true });

    expect(res.status).toBe(201);
    expect(storageMock.createUser).toHaveBeenCalledWith(expect.objectContaining({ passwordHash: null, isExternal: true }));
    expect(storageMock.setUserRoles).toHaveBeenCalledWith("u9", ["learner"], expect.anything());
  });

  it("перевод в штатные снимает признак и шлёт приглашение", async () => {
    storageMock.getUser.mockResolvedValue({ id: "u9", email: "e@x.ru", isExternal: true, status: "pending" });

    const res = await request(app).post("/api/users/u9/promote").send({});

    expect(res.status).toBe(200);
    expect(storageMock.promoteExternalUser).toHaveBeenCalledWith("u9");
    expect(storageMock.createPasswordResetToken).toHaveBeenCalled();
  });

  it("обратный перевод недоступен: признак нельзя выставить существующей штатной учётке", async () => {
    storageMock.getUser.mockResolvedValue({ id: "u1", isExternal: false });

    const res = await request(app).put("/api/users/u1").send({ isExternal: true });

    expect(res.status).toBe(200);
    expect(storageMock.updateUser).toHaveBeenCalledWith("u1", expect.not.objectContaining({ isExternal: true }));
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/routes.users-external.test.ts`

Ожидаемо: FAIL — маршрута `promote` нет, признак не поддержан.

- [ ] **Шаг 3. Реализация: создание**

В `server/routes/users.ts`, обработчик `POST /`, заменить начало на:

```ts
    const { email, password, name, role, roles, groupIds, sendInvite, isExternal } = req.body;

    // PRD-28: an external participant has no password and no invitation letter;
    // the role set is fixed to `learner`, so the caller cannot widen it.
    if (isExternal) {
      if (!email) return res.status(400).json({ error: "Email required" });
    } else if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const requestedRoles: string[] = isExternal
      ? ["learner"]
      : Array.isArray(roles) && roles.length > 0
        ? roles.map((r: unknown) => String(r))
        : [String(role || "learner")];
```

в вызове `storage.createUser` передавать `passwordHash: isExternal ? null : password` и
`isExternal: Boolean(isExternal)`, а блок `if (sendInvite)` обернуть в `if (sendInvite && !isExternal)`.

- [ ] **Шаг 4. Реализация: перевод в штатные**

В `server/storage/users-repository.ts`:

```ts
  /**
   * PRD-28: turn an external participant into an ordinary account. Only this
   * direction exists — the reverse would strip an active employee of their
   * password and cabinet, which is a block dressed up as a kind change.
   */
  async promoteExternalUser(userId: string): Promise<User | undefined> {
    const [user] = await db.update(users)
      .set({ isExternal: false, mustChangePassword: true })
      .where(eq(users.id, userId))
      .returning();
    return user ? { ...user, email: await decryptEmail(user.email) } : undefined;
  }
```

Прокинуть метод через `IStorage` и фасад `server/storage.ts` рядом с прочими методами пользователей.

В `server/routes/users.ts` добавить маршрут (до `/:id/invite`, порядок в файле не важен, важно право):

```ts
// POST /api/users/:id/promote — сделать внешнего участника штатным (PRD-28 FR-05)
router.post("/:id/promote", requirePermission("users.manage"), async (req, res) => {
  try {
    const user = await storage.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.isExternal) {
      return res.status(400).json({ error: "Account is not an external participant" });
    }

    await storage.promoteExternalUser(user.id);

    // The account now needs a password of its own: same letter the ordinary
    // invite path sends, same token kind, same lifetime.
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await storage.createPasswordResetToken(user.id, tokenHash, "promote", INVITE_TTL_MS);
    const sent = await sendInviteEmail({
      to: user.email,
      userName: user.name || undefined,
      inviteLink: `${appBaseUrl()}/reset-password?token=${rawToken}`,
    });

    audit.userInvite(user.id);
    res.json({ success: true, sent });
  } catch (error) {
    logger.error("Promote external user error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to promote user" });
  }
});
```

В обработчике `PUT /:id` признак не читать вовсе — он не входит в набор изменяемых полей, поэтому
обратный перевод недостижим по построению.

- [ ] **Шаг 5. Убедиться, что тесты проходят**

Выполнить: `npm test -- tests/routes.users-external.test.ts`

Ожидаемо: PASS, три теста.

- [ ] **Шаг 6. Коммит**

```bash
git add server/routes/users.ts server/storage.ts server/storage/users-repository.ts tests/routes.users-external.test.ts
git commit -m "feat(prd-28): заведение внешнего участника поштучно и перевод в штатные"
```

---

## Этап 2. Настройки системы

### Задача 5. Раздел `limits`

**Файлы:**

- Изменить: `server/config.ts` (интерфейс `AppConfig`, функция `shape`)
- Изменить: `config/config.jsonc`, `config/development.config.jsonc`, `config/production.config.jsonc`,
  `config/test.config.jsonc`
- Изменить: `server/routes/users.ts:473` (потолок строк), `server/routes/users.ts:316` и
  `server/routes/auth.ts:218` (почасовой предел)
- Тест: `tests/config.limits.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
import { config } from "../server/config";

describe("limits в конфигурации", () => {
  it("значения по умолчанию сохраняют нынешнее поведение", () => {
    expect(config.limits.participantsImportMaxRows).toBe(500);
    expect(config.limits.passwordEmailsPerHour).toBe(3);
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/config.limits.test.ts`

Ожидаемо: FAIL — свойства `limits` в типе нет.

- [ ] **Шаг 3. Реализация**

В `server/config.ts` в интерфейс `AppConfig` добавить:

```ts
  /** Operational ceilings that an installation may tune without a code change. */
  limits: {
    /** Maximum rows accepted from one uploaded workbook (participants and users import). */
    participantsImportMaxRows: number;
    /** Password-setup letters per person per hour, shared by recovery and invitation. */
    passwordEmailsPerHour: number;
  };
```

в функции `shape`:

```ts
  const limits = asRecord(raw.limits);
```

и в возвращаемый объект:

```ts
    limits: {
      participantsImportMaxRows: asNumber(limits.participantsImportMaxRows, 500),
      passwordEmailsPerHour: asNumber(limits.passwordEmailsPerHour, 3),
    },
```

В `config/config.jsonc` добавить раздел:

```jsonc
  "limits": {
    "participantsImportMaxRows": 500,
    "passwordEmailsPerHour": 3
  },
```

- [ ] **Шаг 4. Применить настройку в трёх местах**

`server/routes/users.ts`, `bulk-preview`:

```ts
    const maxRows = config.limits.participantsImportMaxRows;
    if (rows.length > maxRows) {
      return res.status(400).json({ error: `Maximum ${maxRows} rows per upload` });
    }
```

`server/routes/users.ts` (invite) и `server/routes/auth.ts` (forgot-password) — заменить `>= 3` на
`>= config.limits.passwordEmailsPerHour`, не забыв импорт `config`.

- [ ] **Шаг 5. Убедиться, что тест проходит**

Выполнить: `npm test -- tests/config.limits.test.ts` и `npm run check`

Ожидаемо: PASS; `tsc` без ошибок.

- [ ] **Шаг 6. Коммит**

```bash
git add server/config.ts config server/routes/users.ts server/routes/auth.ts tests/config.limits.test.ts
git commit -m "feat(prd-28): потолок строк и почасовой предел писем вынесены в настройки"
```

---

## Этап 3. Конвейер участников

### Задача 6. Ссылка возвращается вызывающему

**Файлы:**

- Изменить: `server/services/assignment-link.ts:51` (тип результата), `:107` (возврат)
- Тест: `tests/services.assignment-link.test.ts` (создать, если нет)

- [ ] **Шаг 1. Написать падающий тест**

```ts
it("возвращает выпущенную ссылку вызывающему", async () => {
  const result = await deliverAssignmentLink({
    user: { id: "u1", name: "Ученик", emailHash: "h" },
    email: "u1@example.com",
    assignmentId: "a1", testId: "t1", testTitle: "Тест",
    expiresAt: new Date("2026-09-01T00:00:00Z"),
  });

  expect(result.issued).toBe(true);
  expect(result.magicLink).toMatch(/\/access\/[0-9a-f]{64}$/);
});

it("для привилегированного получателя ссылки нет", async () => {
  // mayReceiveAssignmentLink -> false
  const result = await deliverAssignmentLink({ /* тот же вызов, получатель с ролью author */ });
  expect(result.issued).toBe(false);
  expect(result.magicLink).toBeUndefined();
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/services.assignment-link.test.ts`

Ожидаемо: FAIL — свойства `magicLink` в результате нет.

- [ ] **Шаг 3. Реализация**

```ts
export interface DeliverAssignmentLinkResult {
  /** `true` when a token was minted and the letter carries a magic link; `false` when withheld. */
  issued: boolean;
  /**
   * The freshly minted link, present only when `issued` is true. Returned so a
   * bulk run can offer the operator a one-time export (PRD-28 раздел 7) — the
   * raw token is never stored, so this is the only moment it exists.
   */
  magicLink?: string;
  /** Whether the notification letter was actually accepted by the transport. */
  delivered: boolean;
}
```

В теле: ветка withheld возвращает `{ issued: false, delivered }`, основная —
`{ issued: true, magicLink, delivered }`, где `delivered` — результат `sendAssignmentEmail`.

- [ ] **Шаг 4. Убедиться, что тесты проходят**

Выполнить: `npm test -- tests/services.assignment-link.test.ts`

Ожидаемо: PASS.

- [ ] **Шаг 5. Коммит**

```bash
git add server/services/assignment-link.ts tests/services.assignment-link.test.ts
git commit -m "feat(prd-28): выдача ссылки возвращает её и исход отправки вызывающему"
```

### Задача 7. Письмо без разовой ссылки ведёт на тест

**Файлы:**

- Изменить: `server/email.ts:181` (`sendAssignmentEmail`, ветка без `magicLink`)
- Изменить: `server/services/assignment-link.ts` (передать `testId`)
- Тест: `tests/email.assignment.test.ts` (создать, если нет)

- [ ] **Шаг 1. Написать падающий тест**

```ts
it("письмо без разовой ссылки ведёт на адрес теста", async () => {
  await sendAssignmentEmail({ to: "a@x.ru", testTitle: "Тест", testId: "t1" });

  const html = transportMock.sendMail.mock.calls[0][0].html;
  expect(html).toContain("/learner/test/t1");
  expect(html).not.toContain("/access/");
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/email.assignment.test.ts`

Ожидаемо: FAIL — письмо ведёт на страницу входа.

- [ ] **Шаг 3. Реализация**

В `sendAssignmentEmail` добавить обязательное поле `testId: string` и в ветке без `magicLink` формировать
адрес `${appBaseUrl()}/learner/test/${opts.testId}` вместо ссылки на страницу входа. Текст письма не
объясняет, почему быстрой ссылки нет: письмо пересылают, раскрывать устройство защиты незачем.

- [ ] **Шаг 4. Убедиться, что тест проходит**

Выполнить: `npm test -- tests/email.assignment.test.ts` и `npm run check`

Ожидаемо: PASS; компилятор укажет все места вызова, куда надо добавить `testId` — их четыре в
`assignment-link.ts` и роутах.

- [ ] **Шаг 5. Коммит**

```bash
git add server/email.ts server/services/assignment-link.ts tests/email.assignment.test.ts
git commit -m "feat(prd-28): письмо без разовой ссылки ведёт на адрес теста"
```

### Задача 8. Разбор файла и статусы строк

**Файлы:**

- Создать: `server/services/participants-invite.ts`
- Тест: `tests/services.participants-invite.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
import { parseParticipantsWorkbook, type ParticipantRow } from "../server/services/participants-invite";

describe("разбор книги участников", () => {
  it("читает email и name, игнорирует прочие колонки", async () => {
    const buf = await workbookWith([
      ["email", "name", "role", "group"],
      ["a@x.ru", "Анна", "administrator", "Отдел"],
    ]);

    const rows = await parseParticipantsWorkbook(buf, { maxRows: 500 });

    expect(rows).toEqual([{ index: 0, email: "a@x.ru", name: "Анна" }]);
  });

  it("схлопывает повтор адреса", async () => {
    const buf = await workbookWith([["email", "name"], ["a@x.ru", "Анна"], ["A@X.ru", "Анна вторая"]]);
    const rows = await parseParticipantsWorkbook(buf, { maxRows: 500 });
    expect(rows).toHaveLength(1);
  });

  it("отклоняет книгу сверх потолка", async () => {
    const buf = await workbookWith([["email", "name"], ["a@x.ru", "А"], ["b@x.ru", "Б"]]);
    await expect(parseParticipantsWorkbook(buf, { maxRows: 1 })).rejects.toThrow(/Maximum 1 rows/);
  });
});
```

Вспомогательная `workbookWith` собирает буфер через `addAoaSheet` + `workbookToBuffer` из
`server/utils/excel`.

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/services.participants-invite.test.ts`

Ожидаемо: FAIL — модуля нет.

- [ ] **Шаг 3. Реализация**

Создать `server/services/participants-invite.ts` с JSDoc модуля и функцией:

```ts
/**
 * @module server/services/participants-invite
 *
 * The bulk-participant pipeline of PRD-28: turn an uploaded workbook into rows,
 * classify each row against the current state of the system, and run the chosen
 * rows through account creation, assignment and delivery, collecting one report.
 *
 * Routes stay thin: `server/routes/assignments.ts` only resolves permissions and
 * hands the buffer (or the chosen rows) over.
 */
export interface ParticipantRow {
  /** Zero-based position in the uploaded sheet, used to keep preview and run aligned. */
  index: number;
  email: string;
  name: string | null;
}

export async function parseParticipantsWorkbook(
  buf: Buffer,
  opts: { maxRows: number },
): Promise<ParticipantRow[]> {
  const wb = await readWorkbookFromBuffer(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("File is empty");

  const raw = sheetToObjects(ws, { defval: "" });
  if (raw.length === 0) throw new Error("File is empty");
  if (raw.length > opts.maxRows) throw new Error(`Maximum ${opts.maxRows} rows per upload`);

  const seen = new Set<string>();
  const rows: ParticipantRow[] = [];
  raw.forEach((row: Record<string, unknown>, index) => {
    const email = String(row.email ?? row.Email ?? row.EMAIL ?? "").trim();
    const name = String(row.name ?? row.Name ?? row["ФИО"] ?? row["имя"] ?? "").trim();
    const key = email.toLowerCase();
    // A repeated address is one participant, not two: the first occurrence wins
    // and later ones are dropped before anything is created.
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    rows.push({ index, email, name: name || null });
  });
  return rows;
}
```

- [ ] **Шаг 4. Убедиться, что тесты проходят**

Выполнить: `npm test -- tests/services.participants-invite.test.ts`

Ожидаемо: PASS, три теста.

- [ ] **Шаг 5. Коммит**

```bash
git add server/services/participants-invite.ts tests/services.participants-invite.test.ts
git commit -m "feat(prd-28): разбор книги участников со схлопыванием повторов"
```

### Задача 9. Классификация строк

**Файлы:**

- Изменить: `server/services/participants-invite.ts`
- Тест: `tests/services.participants-invite.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
describe("классификация строк", () => {
  it("раздаёт статусы по состоянию системы", async () => {
    const preview = await classifyParticipants(rows, { testId: "t1", storage: storageMock });

    expect(preview.map(p => p.status)).toEqual([
      "new",             // адреса нет
      "external",        // внешний участник
      "learner",         // штатный учащийся
      "privileged",      // роль с правами: письмо без разовой ссылки
      "error",           // деактивирован
      "assigned",        // тест уже назначен
      "error",           // адрес без «собаки»
    ]);
    expect(preview[4].error).toBe("Учётная запись деактивирована");
    expect(preview[6].error).toBe("Некорректный адрес");
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/services.participants-invite.test.ts`

Ожидаемо: FAIL — функции `classifyParticipants` нет.

- [ ] **Шаг 3. Реализация**

```ts
/** Statuses a preview row can carry; `error` rows are never selectable. */
export type ParticipantStatus = "new" | "external" | "learner" | "privileged" | "assigned" | "error";

export interface ParticipantPreviewRow extends ParticipantRow {
  status: ParticipantStatus;
  userId: string | null;
  /** Present only for `status: "error"`; shown verbatim in the preview table. */
  error?: string;
}

export async function classifyParticipants(
  rows: readonly ParticipantRow[],
  ctx: { testId: string; storage: IStorage },
): Promise<ParticipantPreviewRow[]> {
  const assignments = await ctx.storage.getTestAssignments(ctx.testId);
  const assignedUserIds = new Set(assignments.map(a => a.userId).filter(Boolean) as string[]);

  return Promise.all(rows.map(async (row) => {
    if (!row.email || !row.email.includes("@")) {
      return { ...row, status: "error" as const, userId: null, error: "Некорректный адрес" };
    }

    const user = await ctx.storage.getUserByEmail(row.email);
    if (!user) return { ...row, status: "new" as const, userId: null };
    if (user.status === "inactive") {
      return { ...row, status: "error" as const, userId: user.id, error: "Учётная запись деактивирована" };
    }
    if (assignedUserIds.has(user.id)) return { ...row, status: "assigned" as const, userId: user.id };

    const roles = await ctx.storage.getUserRoles(user.id);
    // Anything beyond `learner` is a privileged recipient: PRD-28 раздел 6 —
    // назначение делается, но разовая ссылка не выдаётся (правило D-3).
    const privileged = roles.some(r => r !== "learner");
    if (privileged) return { ...row, status: "privileged" as const, userId: user.id };
    return { ...row, status: user.isExternal ? "external" as const : "learner" as const, userId: user.id };
  }));
}
```

- [ ] **Шаг 4. Убедиться, что тесты проходят**

Выполнить: `npm test -- tests/services.participants-invite.test.ts`

Ожидаемо: PASS.

- [ ] **Шаг 5. Коммит**

```bash
git add server/services/participants-invite.ts tests/services.participants-invite.test.ts
git commit -m "feat(prd-28): классификация строк предпросмотра по состоянию системы"
```

### Задача 10. Прогон и отчёт

**Файлы:**

- Изменить: `server/services/participants-invite.ts`
- Тест: `tests/services.participants-invite.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
describe("прогон", () => {
  it("создаёт внешних без пароля, назначает и собирает отчёт", async () => {
    const report = await runParticipantsInvite({
      testId: "t1", rows: preview, actorId: "op1",
      dueDate: null, linkExpiresAt: null, groupName: null, storage: storageMock,
    });

    expect(storageMock.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: null, isExternal: true }),
    );
    expect(storageMock.createPasswordResetToken).not.toHaveBeenCalled();
    expect(report.created).toBe(1);
    expect(report.results[0]).toMatchObject({ email: "a@x.ru", delivered: true });
    expect(report.results[0].magicLink).toMatch(/\/access\//);
  });

  it("создаёт группу и одно назначение на неё", async () => {
    const report = await runParticipantsInvite({ /* ... */ groupName: "Набор апреля" });

    expect(storageMock.createGroup).toHaveBeenCalledWith(expect.objectContaining({ name: "Набор апреля" }));
    expect(storageMock.createTestAssignment).toHaveBeenCalledTimes(1);
    expect(report.groupId).toBeTruthy();
  });

  it("занятое имя группы отклоняется до любых изменений", async () => {
    storageMock.getGroups.mockResolvedValue([{ id: "g1", name: "Набор апреля" }]);

    await expect(runParticipantsInvite({ /* ... */ groupName: "набор апреля" }))
      .rejects.toThrow(/группа с таким именем/i);
    expect(storageMock.createUser).not.toHaveBeenCalled();
  });

  it("сбой на строке не прерывает прогон", async () => {
    storageMock.createUser.mockRejectedValueOnce(new Error("boom"));

    const report = await runParticipantsInvite({ /* две строки */ });

    expect(report.created).toBe(1);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].reason).toBe("boom");
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/services.participants-invite.test.ts`

Ожидаемо: FAIL — функции `runParticipantsInvite` нет.

- [ ] **Шаг 3. Реализация**

```ts
export interface ParticipantResult {
  email: string;
  name: string | null;
  status: ParticipantStatus;
  /** Present only when a one-time link was minted for this recipient. */
  magicLink?: string;
  /** Whether the letter was accepted by the transport. */
  delivered: boolean;
}

export interface ParticipantsReport {
  created: number;
  reused: number;
  assigned: number;
  groupId: string | null;
  results: ParticipantResult[];
  failed: { email: string; reason: string }[];
}

export async function runParticipantsInvite(opts: {
  testId: string;
  rows: readonly ParticipantPreviewRow[];
  actorId: string;
  dueDate: Date | null;
  linkExpiresAt: Date | null;
  groupName: string | null;
  storage: IStorage;
}): Promise<ParticipantsReport>;
```

Тело функции собирается в этом же шаге в следующем порядке:

1. если задано `groupName` — проверить занятость имени по `getGroups()` без учёта регистра и бросить
   ошибку ДО любых изменений, иначе создать группу;
2. по каждой строке (`status !== "error"`): найти или создать учётную запись
   (`passwordHash: null, isExternal: true, status: "pending"`, роль `learner` через `setUserRoles`),
   имя ставить только если у найденной записи его нет; штатному учащемуся признак НЕ навешивать;
3. если создана группа — добавить участника в неё (`addUserToGroup`);
4. назначение: при группе — одно `createTestAssignment({ groupId })` после цикла; без группы — по одному
   `createTestAssignment({ userId })`; для строки `assigned` нового назначения не создавать, а взять
   существующее;
5. выдача: `deliverAssignmentLink({ ..., revokeExisting: true })`, результат (`issued`, `magicLink`,
   `delivered`) сложить в `results`;
6. ошибку на строке ловить и складывать в `failed`, продолжая цикл.

- [ ] **Шаг 4. Убедиться, что тесты проходят**

Выполнить: `npm test -- tests/services.participants-invite.test.ts`

Ожидаемо: PASS, все тесты задач 8-10.

- [ ] **Шаг 5. Коммит**

```bash
git add server/services/participants-invite.ts tests/services.participants-invite.test.ts
git commit -m "feat(prd-28): прогон рассылки участников с отчётом по каждому адресу"
```

### Задача 11. Эндпоинты

**Файлы:**

- Изменить: `server/routes/assignments.ts` (два маршрута), `server/middleware/upload.ts` (переиспользовать)
- Тест: `tests/routes.participants.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
describe("POST /api/tests/:id/participants/preview", () => {
  it("требует прав и области теста", async () => {
    const res = await requestAs("learner").post("/api/tests/t1/participants/preview").attach("file", buf, "list.xlsx");
    expect(res.status).toBe(403);
  });

  it("возвращает строки со статусами", async () => {
    const res = await requestAs("manager").post("/api/tests/t1/participants/preview").attach("file", buf, "list.xlsx");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ email: "a@x.ru", status: "new" });
  });

  it("отклоняет файл сверх потолка", async () => {
    const res = await requestAs("manager").post("/api/tests/t1/participants/preview").attach("file", bigBuf, "list.xlsx");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Maximum/);
  });
});

describe("POST /api/tests/:id/participants/invite", () => {
  it("возвращает отчёт", async () => {
    const res = await requestAs("manager").post("/api/tests/t1/participants/invite").send({ rows, groupName: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 1, assigned: 1 });
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/routes.participants.test.ts`

Ожидаемо: FAIL — маршрутов нет, ответ 404.

- [ ] **Шаг 3. Реализация**

В `server/routes/assignments.ts`:

```ts
// ─── POST /api/tests/:id/participants/preview — разбор файла (PRD-28 FR-11) ───
router.post(
  "/tests/:id/participants/preview",
  requirePermission("assignments.manage"),
  requirePermission("users.create"),
  requireTestScope("assign"),
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "File required" });
      const rows = await parseParticipantsWorkbook(req.file.buffer, {
        maxRows: config.limits.participantsImportMaxRows,
      });
      res.json(await classifyParticipants(rows, { testId: req.params.id, storage }));
    } catch (error) {
      logger.error("Participants preview error: " + (error as Error).message);
      if (respondWorkbookReadError(res, error)) return;
      res.status(400).json({ error: (error as Error).message });
    }
  },
);
```

и симметричный `POST /tests/:id/participants/invite`, который принимает `{ rows, dueDate, linkExpiresAt,
groupName }`, вызывает `runParticipantsInvite`, пишет в журнал строку о прогоне и отдаёт отчёт.

- [ ] **Шаг 3а. Шаблон файла (FR-10)**

Там же добавить маршрут шаблона — он отличается от шаблона импорта пользователей
(`server/routes/users.ts:50`) тем, что колонок только две: лишние в этом сценарии игнорируются, и
предлагать их в шаблоне значит обещать поведение, которого нет.

```ts
// ─── GET /api/tests/:id/participants/template — шаблон книги (PRD-28 FR-10) ───
router.get(
  "/tests/:id/participants/template",
  requirePermission("assignments.manage"),
  requireTestScope("assign"),
  async (_req, res) => {
    const wb = new ExcelJS.Workbook();
    addAoaSheet(wb, "Участники", [
      ["email", "name"],
      ["ivanov@example.com", "Иван Иванов"],
      ["petrova@example.com", "Анна Петрова"],
    ]);
    const buf = await workbookToBuffer(wb);
    res.setHeader("Content-Disposition", "attachment; filename=participants-template.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);
  },
);
```

Тест: `GET` от менеджера отдаёт 200 и заголовок `Content-Disposition` с именем
`participants-template.xlsx`; от учащегося — 403.

- [ ] **Шаг 4. Убедиться, что тесты проходят**

Выполнить: `npm test -- tests/routes.participants.test.ts`

Ожидаемо: PASS, четыре теста.

- [ ] **Шаг 5. Коммит**

```bash
git add server/routes/assignments.ts tests/routes.participants.test.ts
git commit -m "feat(prd-28): эндпоинты предпросмотра и прогона рассылки участников"
```

### Задача 12. Аудит

**Файлы:**

- Изменить: `server/logger.ts` (пара событий в `audit`), `server/routes/assignments.ts`
- Тест: `tests/routes.participants.test.ts` (дописать)

- [ ] **Шаг 1. Написать падающий тест**

```ts
it("прогон и выгрузка попадают в аудит без сырых ссылок", async () => {
  await requestAs("manager").post("/api/tests/t1/participants/invite").send({ rows });
  await requestAs("manager").post("/api/tests/t1/participants/links-exported").send({ count: 3 });

  const lines = auditMock.mock.calls.flat().map(String);
  expect(lines.join("\n")).toContain("participants invite");
  expect(lines.join("\n")).toContain("links exported");
  expect(lines.join("\n")).not.toContain("/access/");
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- tests/routes.participants.test.ts`

Ожидаемо: FAIL — событий нет, маршрута отметки выгрузки нет.

- [ ] **Шаг 3. Реализация**

Добавить в `audit` два события по образцу существующих (`userInvite`, `bulkImport`):
`participantsInvite(testId, created, assigned)` и `participantLinksExported(testId, count)`. Второе
вызывается маршрутом `POST /tests/:id/participants/links-exported`, который только пишет отметку и ничего
не возвращает: сами ссылки на сервер не отправляются.

- [ ] **Шаг 4. Убедиться, что тест проходит**

Выполнить: `npm test -- tests/routes.participants.test.ts`

Ожидаемо: PASS.

- [ ] **Шаг 5. Коммит**

```bash
git add server/logger.ts server/routes/assignments.ts tests/routes.participants.test.ts
git commit -m "feat(prd-28): аудит прогона рассылки и выгрузки ссылок"
```

---

## Этап 4. Интерфейс

### Задача 13. Эскизы

**Файлы:**

- Создать: `docs/wireframes/prd-28/bulk-invite-upload.html`, `-preview.html`, `-report.html`,
  `users-external.html`

- [ ] **Шаг 1. Собрать эскизы**

Четыре состояния вкладки и правки списка пользователей. В холсте только реальный интерфейс из
дизайн-системы, пояснения — вне холста. Скелет эскиза брать из существующих файлов
`docs/wireframes/`, чтобы проверка `npm run check:wireframes:ds` проходила.

- [ ] **Шаг 2. Проверить эскизы**

Выполнить: `npm run check:wireframes:ds`

Ожидаемо: проверка проходит, несуществующих классов дизайн-системы нет.

- [ ] **Шаг 3. Согласовать с владельцем продукта**

Показать эскизы и дождаться явного согласия. React до согласования не писать — это жёсткое правило
проекта.

- [ ] **Шаг 4. Коммит**

```bash
git add docs/wireframes/prd-28
git commit -m "docs(prd-28): эскизы вкладки рассылки участников"
```

### Задача 14. Вкладка «Списком из файла»

**Файлы:**

- Создать: `client/src/features/tests/assign/bulk-invite-tab.tsx`
- Изменить: `client/src/components/assign-test-dialog.tsx:71` (тип вкладки), `:650` (список вкладок)
- Тест: `client/src/features/tests/assign/__tests__/bulk-invite-tab.test.tsx`

- [ ] **Шаг 1. Написать падающий тест**

```tsx
it("после разбора файла показывает строки и запрещает выбор ошибочных", async () => {
  server.use(previewHandler([
    { index: 0, email: "a@x.ru", name: "Анна", status: "new", userId: null },
    { index: 1, email: "нет", name: null, status: "error", userId: null, error: "Некорректный адрес" },
  ]));

  render(<BulkInviteTab testId="t1" testTitle="Тест" />);
  await userEvent.upload(screen.getByLabelText("Файл со списком"), file);

  expect(await screen.findByText("a@x.ru")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /a@x.ru/ })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /нет/ })).toBeDisabled();
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- client/src/features/tests/assign/__tests__/bulk-invite-tab.test.tsx`

Ожидаемо: FAIL — компонента нет.

- [ ] **Шаг 3. Реализация**

Компонент с состоянием `"upload" | "preview" | "running" | "report"`, ровно как в разделе 5 спеки.
Только примитивы дизайн-системы. Поля: файл, «срок сдачи», «срок действия ссылки» (связка как в
`assign-test-dialog.tsx:203`), «Создать группу из списка». Таблица предпросмотра с колонками адрес, имя,
статус, причина. Кнопка «Пригласить (N)» отправляет выбранные строки на `/participants/invite`.

- [ ] **Шаг 4. Подключить вкладку**

В `assign-test-dialog.tsx` расширить тип: `type AssignTab = "current" | "users" | "groups" | "bulk";` и
добавить вкладку с меткой «Списком из файла», рендерящую `<BulkInviteTab />`.

- [ ] **Шаг 5. Убедиться, что тест проходит**

Выполнить: `npm test -- client/src/features/tests/assign/__tests__/bulk-invite-tab.test.tsx`

Ожидаемо: PASS.

- [ ] **Шаг 6. Коммит**

```bash
git add client/src/features/tests/assign client/src/components/assign-test-dialog.tsx
git commit -m "feat(prd-28): вкладка приглашения участников списком"
```

### Задача 15. Отчёт и выгрузка ссылок

**Файлы:**

- Создать: `client/src/features/tests/assign/bulk-invite-export.ts`
- Изменить: `client/src/features/tests/assign/bulk-invite-tab.tsx`
- Тест: `client/src/features/tests/assign/__tests__/bulk-invite-export.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

```ts
it("собирает книгу со ссылками из отчёта", async () => {
  const buf = await buildLinksWorkbook({
    testTitle: "Тест",
    results: [{ email: "a@x.ru", name: "Анна", status: "new", magicLink: "https://host/access/abc", delivered: false }],
    expiresAt: "2026-09-01T00:00:00.000Z",
  });

  const rows = await readSheetRows(buf);
  expect(rows[0]).toEqual(["Адрес", "Имя", "Статус", "Ссылка", "Действует до"]);
  expect(rows[1][3]).toBe("https://host/access/abc");
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- client/src/features/tests/assign/__tests__/bulk-invite-export.test.ts`

Ожидаемо: FAIL — модуля нет.

- [ ] **Шаг 3. Реализация**

`buildLinksWorkbook` собирает книгу из уже полученного отчёта (второго обращения к серверу нет), вкладка
отдаёт файл через `Blob` и сразу шлёт отметку `POST /tests/:id/participants/links-exported`. Рядом с
кнопкой — предупреждение, что файл содержит действующие ключи доступа.

- [ ] **Шаг 4. Убедиться, что тест проходит**

Выполнить: `npm test -- client/src/features/tests/assign/__tests__/bulk-invite-export.test.ts`

Ожидаемо: PASS.

- [ ] **Шаг 5. Коммит**

```bash
git add client/src/features/tests/assign
git commit -m "feat(prd-28): отчёт прогона и выгрузка ссылок книгой"
```

### Задача 16. Список пользователей

**Файлы:**

- Изменить: `client/src/pages/author/users.tsx` (форма создания, отметка, фильтр, действие)
- Тест: `client/src/pages/author/__tests__/users.external.test.tsx`

- [ ] **Шаг 1. Написать падающий тест**

```tsx
it("признак «внешний» прячет пароль и приглашение", async () => {
  render(<UsersPage />);
  await userEvent.click(screen.getByRole("button", { name: "Создать пользователя" }));
  await userEvent.click(screen.getByLabelText("Внешний участник"));

  expect(screen.queryByLabelText("Пароль")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Отправить приглашение")).not.toBeInTheDocument();
});

it("внешний участник помечен в списке и переводится в штатные", async () => {
  render(<UsersPage />);

  expect(await screen.findByText("Внешний")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Сделать штатным" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/users/u9/promote", expect.anything()));
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Выполнить: `npm test -- client/src/pages/author/__tests__/users.external.test.tsx`

Ожидаемо: FAIL — признака и действия нет.

- [ ] **Шаг 3. Реализация**

Признак в форме создания (при включении скрывает пароль и приглашение), отметка в строке списка, фильтр
по признаку и пункт «Сделать штатным» в меню строки — только для внешних. Обратного действия нет.

Аналитика и выгрузки по требованию FR-07 не правятся вовсе: внешний участник — обычная строка в `users`,
и все сводки включают его сами собой. Отдельно проверить это в приёмке (пункт 7 задачи 17), чтобы
отсутствие правок было осознанным, а не пропущенным.

- [ ] **Шаг 4. Убедиться, что тест проходит**

Выполнить: `npm test -- client/src/pages/author/__tests__/users.external.test.tsx`

Ожидаемо: PASS.

- [ ] **Шаг 5. Коммит**

```bash
git add client/src/pages/author/users.tsx client/src/pages/author/__tests__/users.external.test.tsx
git commit -m "feat(prd-28): внешний участник в списке пользователей и перевод в штатные"
```

---

## Этап 5. Приёмка

### Задача 17. Приёмка в браузере

**Файлы:** правок кода нет; при находках — точечные исправления с тестом.

- [ ] **Шаг 1. Проверить типы и затронутые тесты**

Выполнить: `npm run check`, затем `npm test -- tests/routes.participants.test.ts tests/services.participants-invite.test.ts`

Ожидаемо: без ошибок.

- [ ] **Шаг 2. Поднять отдельный экземпляр**

Выполнить: `PORT=8099 npm run dev` — серверные правки не подхватываются уже работающим dev-сервером.

- [ ] **Шаг 3. Пройти сценарий приёмки**

По разделу 11 спеки, пункты 1-10. Файл собрать на адресах приёмки, НЕ на реальных: dev-контур шлёт
настоящие письма, отключить это переменной окружения нельзя.

- [ ] **Шаг 4. Записать результат**

Отчёт о приёмке с указанием каждого пункта раздела 11 и снимками экрана. Расхождения — в отдельные
задачи, а не «поправлю по ходу».

---

## Порядок и зависимости

1. Этап 1 первым: без признака и запретов остальное строится на песке.
2. Этап 2 независим, но нужен задаче 11 (потолок из настроек).
3. Этап 3 опирается на задачи 1-6.
4. Этап 4 начинается только после согласования эскизов (задача 13).
5. Этап 5 — после всего.

## Обязательный шаг при слиянии ветки

`drizzle/meta/0018_snapshot.json` отпочкован от снимка `0015`: незакоммиченных `0016`/`0017` соседней
сессии в этой ветке нет. Когда они попадут в ствол, последней записью журнала останется `0018`, чей снимок
не знает про их колонки, и следующий `drizzle-kit generate` предложит добавить их повторно — `migrate` на
развёртывании упадёт на «column already exists».

Перед слиянием: перегенерировать снимок `0018` поверх объединённой схемы (SQL-файл миграции при этом не
меняется), затем прогнать `npx drizzle-kit generate` вхолостую и убедиться, что он отвечает «No changes».

CHECK-ограничение вида «пароль есть ИЛИ учётка внешняя» рассматривалось и ОТКЛОНЕНО: оно запрещает
законное промежуточное состояние — учётку, только что переведённую в штатные (признак уже снят, пароль ещё
не задан, задача 4).

## Известные грабли

- Номер миграции: в главной копии лежат незакоммиченные `0016` и `0017` из другой сессии (задача 1).
- `npm run check` в этой ветке КРАСНЫЙ и до нашей работы: четыре ошибки в `analytics.tsx`,
  `test-analytics.tsx`, `server/routes/attempts.ts` и `server/scorm/builders/test-json.ts`, из них две — от
  тех же незакоммиченных правок соседней сессии. Ориентир для задач: число ошибок не растёт и ни одна не
  указывает на изменённые нами файлы. Красноту саму по себе за свой брак не принимать.
- `tests/it/schema.sql` — вторая копия схемы для харнесса; забыть её значит уронить тесты DAL.
- `npm run test:cov` запускать только в одиночку: покрытие чистит общий каталог.
- Индекс git в этой рабочей копии общий с другими сессиями: перед коммитом сверять `git diff --cached`.
- Dev-SMTP шлёт настоящие письма всегда.
