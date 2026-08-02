# Медиатека (ядро): реестр, индекс использования и защищённая раздача

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** Завести реестр медиафайлов с дедупликацией, индексом использования и защищённой раздачей вместо
статической директории `uploads/media`.

**Architecture:** Файл описывается записью `media_assets` и адресуется каноническим `/api/media/<id>`.
Байты лежат за портом `MediaStore` (первая реализация — файловая система). Обратный индекс `media_usages`
пишется одним обходчиком `collectMediaRefs` при сохранении контента и пересобирается административной
операцией. Раздача идёт маршрутом с проверкой прав: владелец, либо общий файл авторской роли, либо связь с
доступным запрашивающему контентом.

**Tech Stack:** TypeScript, Express 5, Drizzle ORM (PostgreSQL), multer, vitest + supertest.

---

## Охват этого плана

План покрывает **ядро** — этапы Э1, Э3 и Э2 спецификации
[2026-08-01-media-library-design.md](../specs/2026-08-01-media-library-design.md). Результат — работающее
ПО: загрузка пишет реестр, дедупликация работает, файлы раздаются с проверкой прав, статика выключена.

Отдельными планами пойдут: Э4 (упаковщик SCORM, отчёт), Э5 (экран медиатеки — требует утверждённого
эскиза), Э6 (вложения обратной связи, PRD-32).

Неизменяемость актива (§4.3 спеки) в этом плане обеспечивается тем, что маршрута замены содержимого
НЕ появляется: загрузка всегда создаёт (или переиспользует) актив, а «заменить картинку» на стороне
автора означает загрузить новый и переставить ссылку. Отдельного кода это не требует — требует не
добавлять такой маршрут в дальнейшем.

## Отступление от порядка этапов в спецификации

Спецификация ставит Э2 (раздача) перед Э3 (индекс). Так реализовать нельзя: правило доступа №3 (§6.1
спеки) читает `media_usages`, поэтому раздача без индекса не пустит учащегося к картинке его собственного
теста. В этом плане порядок такой: реестр -> индекс -> раздача -> выключение статики. Выключение статики
выделено в последнюю задачу, чтобы риск §12 («ломает тихо») наступал в один проверяемый момент.

Обнови §11 спецификации при выполнении Задачи 14.

## Правила прогона тестов в этом репозитории

- **Никогда не запускай полный `npm test` по своей инициативе** — в одной рабочей копии одновременно
  работают несколько сессий. Только точечно: `npm test -- <путь к файлу теста>`.
- **`npx vitest run` не работает** в этом репозитории (падает на `initConfig()`). Всегда `npm test -- ...`.
- `npm run test:cov` не запускай вовсе — он чистит общую директорию покрытия и ломает соседние прогоны.

## Карта файлов

| Файл | Ответственность |
| --- | --- |
| `shared/schema.ts` (правка) | Таблицы `media_assets` и `media_usages` + выводимые типы |
| `drizzle/0009_prd_media_library.sql` (создать через drizzle-kit) | Миграция |
| `shared/access/capabilities.ts`, `shared/access/permissions.ts` (правка) | Право `media.manage` |
| `server/services/media/media-store.ts` (создать) | Порт `MediaStore` + файловая реализация |
| `server/services/media/media-refs.ts` (создать) | Чистые `parseMediaRef` и `collectMediaRefs` |
| `server/services/media/usage-index.ts` (создать) | Запись строк индекса и полная пересборка |
| `server/services/media/asset-access.ts` (создать) | Правило доступа к активу + кеш решения |
| `server/storage/media-repository.ts` (создать) | Запросы к `media_assets` / `media_usages` |
| `server/storage.ts` (правка) | Делегирование в `MediaRepository` через `IStorage` |
| `server/routes/media.ts` (создать) | `POST /upload`, `GET /:id`, `DELETE /:id`, `POST /reindex` |
| `server/routes/index.ts` (правка) | Монтирование роутера `/api/media` |
| `server/routes.ts` (правка) | Удаление инлайновой загрузки и статики `/uploads` |
| `script/backfill-media-registry.ts` (создать) | Разовая индексация существующих файлов |

---

### Task 1: Таблицы реестра и индекса

**Files:**

- Modify: `shared/schema.ts`
- Create: `tests/media-schema.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создай `tests/media-schema.test.ts`:

```ts
/**
 * @module tests/media-schema
 * @description The media registry tables must expose the columns the registry, the dedup
 * rule and the usage index rely on. A schema test is cheap insurance: a renamed column
 * would otherwise surface as a runtime query error deep inside the delivery route.
 */
import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { mediaAssets, mediaUsages } from "../shared/schema";

describe("media registry schema", () => {
  it("media_assets carries the registry columns", () => {
    const names = getTableConfig(mediaAssets).columns.map((c) => c.name).sort();
    expect(names).toEqual([
      "byte_size", "checksum", "created_at", "id", "kind", "mime_type",
      "original_name", "owner_id", "storage_key", "title", "visibility",
    ]);
  });

  it("media_usages is keyed by asset, entity and field", () => {
    const names = getTableConfig(mediaUsages).columns.map((c) => c.name).sort();
    expect(names).toEqual(["asset_id", "entity_id", "entity_type", "field"]);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- tests/media-schema.test.ts`

Expected: FAIL — `mediaAssets` не экспортируется из `shared/schema`.

- [ ] **Step 3: Добавить таблицы в схему**

В `shared/schema.ts` убедись, что `primaryKey` есть в импорте из `drizzle-orm/pg-core`, и добавь в конец
файла:

```ts
/**
 * PRD медиатеки: the registry row for ONE author file. The `id` IS the address —
 * content stores the string `/api/media/<id>`, so the column type of every existing
 * media reference stays `text` and no mass JSON migration is needed.
 *
 * Two layers of dedup, deliberately different: the PHYSICAL file is addressed by
 * `checksum` (re-uploading identical bytes writes no second file), while a REGISTRY
 * ROW is per (content, owner). One row per checksum would leak a private file to
 * anyone who happened to upload the same bytes.
 *
 * `owner_id` is nullable: rows created by the backfill of pre-registry files have no
 * knowable author (the old file name carried none).
 */
export const mediaAssets = pgTable("media_assets", {
  id: varchar("id", { length: 36 }).primaryKey(),
  checksum: varchar("checksum", { length: 64 }).notNull(),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  kind: text("kind", { enum: ["image", "audio", "video", "document"] }).notNull(),
  originalName: text("original_name").notNull(),
  title: text("title"),
  ownerId: varchar("owner_id", { length: 36 }),
  visibility: text("visibility", { enum: ["private", "shared"] }).notNull().default("shared"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  // Dedup lookup on upload: "does THIS owner already have THESE bytes".
  // Not unique: Postgres treats NULL owners as distinct, so a unique index would
  // not constrain backfilled rows anyway — the backfill script dedups explicitly.
  ownerChecksumIdx: index("media_assets_owner_checksum_idx").on(table.ownerId, table.checksum),
  // Reference counting before physically removing a file.
  checksumIdx: index("media_assets_checksum_idx").on(table.checksum),
}));

/**
 * PRD медиатеки: the reverse index "asset -> where it is used". It serves three
 * consumers at once: the delivery rule (may this user receive the file), the
 * «где используется» report, and orphan collection.
 *
 * `field` is the dotted path inside the entity, so the report can say WHERE exactly
 * and a re-sync can replace one entity's rows wholesale.
 */
export const mediaUsages = pgTable("media_usages", {
  assetId: varchar("asset_id", { length: 36 }).notNull(),
  entityType: text("entity_type", {
    enum: ["question", "content_page", "test_design", "test_feedback", "topic_feedback", "scale_feedback", "snapshot"],
  }).notNull(),
  entityId: varchar("entity_id", { length: 36 }).notNull(),
  field: text("field").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.assetId, table.entityType, table.entityId, table.field] }),
  // Re-syncing one entity deletes its rows by this key.
  entityIdx: index("media_usages_entity_idx").on(table.entityType, table.entityId),
  assetIdx: index("media_usages_asset_idx").on(table.assetId),
}));

export type MediaAsset = typeof mediaAssets.$inferSelect;
export type InsertMediaAsset = typeof mediaAssets.$inferInsert;
export type MediaUsage = typeof mediaUsages.$inferSelect;
export type MediaEntityType = MediaUsage["entityType"];
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- tests/media-schema.test.ts`

Expected: PASS (2 теста).

- [ ] **Step 5: Сгенерировать миграцию**

```bash
npx drizzle-kit generate --name prd_media_library
```

Ожидается новый файл `drizzle/0009_prd_media_library.sql` с `CREATE TABLE "media_assets"`,
`CREATE TABLE "media_usages"` и четырьмя `CREATE INDEX`. Открой файл и убедись, что там НЕТ ни одного
`DROP` — если есть, значит журнал миграций разошёлся с базой, и это надо разобрать до применения.

- [ ] **Step 6: Применить миграцию к dev-базе**

```bash
npx drizzle-kit migrate
```

Проверь: `psql "$DATABASE_URL" -c "\d media_assets"` показывает 11 колонок.
Строка подключения берётся из `.env` (dev-база — Docker на `localhost:55432`, не системный PostgreSQL).

- [ ] **Step 7: Коммит**

```bash
git add shared/schema.ts drizzle/0009_prd_media_library.sql drizzle/meta tests/media-schema.test.ts
git commit -m "feat(media): таблицы реестра медиа и индекса использования"
```

---

### Task 2: Право `media.manage`

**Files:**

- Modify: `shared/access/capabilities.ts`
- Modify: `shared/access/permissions.ts`
- Create: `tests/media-permissions.test.ts`

Просмотр файла отдельным правом не описывается: доступ к чтению решает правило §6.1 спеки (владение,
видимость + авторская роль, связь с контентом). Право нужно только на управление реестром — пересборку
индекса и удаление.

- [ ] **Step 1: Написать падающий тест**

Создай `tests/media-permissions.test.ts`:

```ts
/**
 * @module tests/media-permissions
 * @description `media.manage` gates registry management (reindex, delete). Authoring
 * roles hold it because they own the files; a learner never does.
 */
import { describe, it, expect } from "vitest";
import { ROLES, hasPermission } from "@shared/access";

describe("media.manage", () => {
  it("is held by author, developer and administrator", () => {
    expect(hasPermission([ROLES.AUTHOR], "media.manage")).toBe(true);
    expect(hasPermission([ROLES.DEVELOPER], "media.manage")).toBe(true);
    expect(hasPermission([ROLES.ADMINISTRATOR], "media.manage")).toBe(true);
  });

  it("is not held by learner or manager", () => {
    expect(hasPermission([ROLES.LEARNER], "media.manage")).toBe(false);
    expect(hasPermission([ROLES.MANAGER], "media.manage")).toBe(false);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- tests/media-permissions.test.ts`

Expected: FAIL — компилятор не знает возможности `media.manage`.

- [ ] **Step 3: Добавить возможность и включить её в роли**

В `shared/access/capabilities.ts` в массив `CAPABILITIES` после строки `"folders.manage",` добавь:

```ts
  // Медиатека: управление реестром (пересборка индекса, удаление актива).
  // Чтение файла отдельной возможностью не описывается — его решает правило
  // доступа к активу (владение / видимость / связь с доступным контентом).
  "media.manage",
```

В `shared/access/permissions.ts` в массив `AUTHOR_CAPABILITIES` после `"folders.manage",` добавь:

```ts
  "media.manage",
```

`developer` и `administrator` получают её автоматически: первый расширяет авторский набор, второй берёт
все возможности кроме суперадминских.

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- tests/media-permissions.test.ts`

Expected: PASS (2 теста).

- [ ] **Step 5: Коммит**

```bash
git add shared/access/capabilities.ts shared/access/permissions.ts tests/media-permissions.test.ts
git commit -m "feat(media): право media.manage для управления реестром"
```

---

### Task 3: Порт `MediaStore` и файловая реализация

**Files:**

- Create: `server/services/media/media-store.ts`
- Create: `tests/media-store.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создай `tests/media-store.test.ts`:

```ts
/**
 * @module tests/media-store
 * @description The storage port hides WHERE bytes live. Two behaviours are load-bearing:
 * putting identical bytes twice yields ONE physical file (dedup), and a ranged read
 * returns exactly the requested slice (audio/video seeking).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFsMediaStore } from "../server/services/media/media-store";

let root: string;
let tmp: string;

/** Writes a scratch source file and returns its path. */
function sourceFile(name: string, content: string): string {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, content);
  return p;
}

/** Drains a readable stream into a string. */
async function read(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "media-store-"));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "media-src-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("createFsMediaStore", () => {
  it("derives the key from the checksum and shards by its prefix", async () => {
    const store = createFsMediaStore(root);
    const stored = await store.putFile(sourceFile("a.png", "hello"), ".png");
    expect(stored.checksum).toHaveLength(64);
    expect(stored.byteSize).toBe(5);
    expect(stored.storageKey).toBe(
      `media/${stored.checksum.slice(0, 2)}/${stored.checksum.slice(2, 4)}/${stored.checksum}.png`,
    );
    expect(fs.existsSync(path.join(root, stored.storageKey))).toBe(true);
  });

  // Equal keys alone would be tautological — the key is a pure function of the checksum
  // and would match even if the second write clobbered the file. What can actually break
  // is the content and the file count, so those are what this asserts.
  it("preserves file content across a duplicate write and keeps exactly one file on disk", async () => {
    const store = createFsMediaStore(root);
    const first = sourceFile("one.png", "same-bytes");
    const second = sourceFile("two.png", "same-bytes");
    const a = await store.putFile(first, ".png");
    const b = await store.putFile(second, ".png");
    expect(b.storageKey).toBe(a.storageKey);
    expect(fs.existsSync(first)).toBe(false);
    expect(fs.existsSync(second)).toBe(false);
    expect(fs.readFileSync(path.join(root, a.storageKey), "utf8")).toBe("same-bytes");
    expect(fs.readdirSync(path.dirname(path.join(root, a.storageKey)))).toHaveLength(1);
  });

  it("propagates ENOENT when the source file is gone", async () => {
    const store = createFsMediaStore(root);
    await expect(store.putFile(path.join(tmp, "ghost.png"), ".png")).rejects.toThrow(/ENOENT/);
  });

  it("reads a byte range", async () => {
    const store = createFsMediaStore(root);
    const stored = await store.putFile(sourceFile("r.txt", "0123456789"), ".txt");
    expect(await read(await store.openRead(stored.storageKey, { start: 2, end: 4 }))).toBe("234");
    expect(await read(await store.openRead(stored.storageKey))).toBe("0123456789");
  });

  it("reports size and removes", async () => {
    const store = createFsMediaStore(root);
    const stored = await store.putFile(sourceFile("s.txt", "abc"), ".txt");
    expect(await store.stat(stored.storageKey)).toEqual({ byteSize: 3 });
    await store.remove(stored.storageKey);
    expect(await store.stat(stored.storageKey)).toBeNull();
  });

  it("refuses a key that escapes the root", async () => {
    const store = createFsMediaStore(root);
    await expect(store.stat("../../etc/passwd")).rejects.toThrow(/outside/i);
  });

  // The guard holds because `path.resolve` returns an absolute path that fails the
  // `startsWith` check — not because anything tests for absoluteness. A later
  // "harmless" tweak (normalising case, stripping a leading slash) could quietly
  // reopen the hole, so the Windows shapes are pinned here.
  it("refuses a Windows absolute or UNC path used as a key", async () => {
    const store = createFsMediaStore(root);
    await expect(store.stat("C:\\Windows\\System32\\drivers\\etc\\hosts")).rejects.toThrow(/outside/i);
    await expect(store.stat("\\\\localhost\\c$\\Windows")).rejects.toThrow(/outside/i);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- tests/media-store.test.ts`

Expected: FAIL — модуль `server/services/media/media-store` не найден.

- [ ] **Step 3: Реализовать порт**

Создай `server/services/media/media-store.ts`:

```ts
/**
 * @module server/services/media/media-store
 *
 * The storage port of the media library. Everything above it — the registry, the
 * permission rule, the usage index, dedup — works with a `storageKey` string and
 * knows nothing about where bytes live. Swapping the filesystem for an S3-compatible
 * store is therefore one module, with no table or route changes.
 *
 * The key is derived from the content checksum (`media/<ab>/<cd>/<sha256><ext>`), which
 * makes writing identical bytes idempotent and gives the two-level shard that keeps a
 * directory from holding tens of thousands of entries. In an object store the shard is
 * unnecessary but harmless, so the key transfers unchanged.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** What a successful write reports back to the registry. */
export interface StoredObject {
  storageKey: string;
  checksum: string;
  byteSize: number;
}

/** Inclusive byte range, as it arrives from an HTTP `Range` header. */
export interface ByteRange {
  start: number;
  end: number;
}

/** The storage port. */
export interface MediaStore {
  /** Moves `sourcePath` into the store. The source is consumed either way. */
  putFile(sourcePath: string, ext: string): Promise<StoredObject>;
  /** Opens the object for reading, optionally a byte range. Rejects if the key does not exist. */
  openRead(storageKey: string, range?: ByteRange): Promise<NodeJS.ReadableStream>;
  /** Object size, or `null` if the key does not exist. */
  stat(storageKey: string): Promise<{ byteSize: number } | null>;
  /** Deletes the object; no error if it is already gone. */
  remove(storageKey: string): Promise<void>;
}

/** `media/<ab>/<cd>/<sha256><ext>`; `ext` includes the dot or is empty. */
export function storageKeyFor(checksum: string, ext: string): string {
  return `media/${checksum.slice(0, 2)}/${checksum.slice(2, 4)}/${checksum}${ext}`;
}

/** Hashes a file without holding it in memory. */
function checksumOf(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** Filesystem-backed store rooted at `root`. */
export function createFsMediaStore(root: string): MediaStore {
  const absRoot = path.resolve(root);

  /** Resolves a key inside the root, refusing anything that escapes it. */
  function resolveKey(storageKey: string): string {
    const abs = path.resolve(absRoot, storageKey);
    const rootWithSep = absRoot.endsWith(path.sep) ? absRoot : absRoot + path.sep;
    if (abs !== absRoot && !abs.startsWith(rootWithSep)) {
      throw new Error(`storage key resolves outside the media root: ${storageKey}`);
    }
    return abs;
  }

  return {
    async putFile(sourcePath, ext) {
      const checksum = await checksumOf(sourcePath);
      const byteSize = fs.statSync(sourcePath).size;
      const storageKey = storageKeyFor(checksum, ext);
      const target = resolveKey(storageKey);
      if (fs.existsSync(target)) {
        // Same bytes already stored: drop the upload's copy rather than rewrite.
        fs.rmSync(sourcePath, { force: true });
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(sourcePath, target);
      }
      return { storageKey, checksum, byteSize };
    },

    async openRead(storageKey, range) {
      const abs = resolveKey(storageKey);
      // Reject a missing key HERE. `createReadStream` would resolve happily and deliver
      // ENOENT asynchronously as an `error` event on the returned stream — and an
      // unhandled `error` on a piped stream takes the process down.
      if (!fs.existsSync(abs)) {
        throw Object.assign(new Error(`no such media object: ${storageKey}`), { code: "ENOENT" });
      }
      return range
        ? fs.createReadStream(abs, { start: range.start, end: range.end })
        : fs.createReadStream(abs);
    },

    async stat(storageKey) {
      const abs = resolveKey(storageKey);
      // `existsSync` + `statSync` would race: a file vanishing between the two calls
      // throws a raw ENOENT where every caller expects `null`.
      try {
        return { byteSize: fs.statSync(abs).size };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },

    async remove(storageKey) {
      fs.rmSync(resolveKey(storageKey), { force: true });
    },
  };
}

/** The application-wide store: the same `uploads` volume the service already mounts. */
export const mediaStore: MediaStore = createFsMediaStore(path.resolve(process.cwd(), "uploads"));
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- tests/media-store.test.ts`

Expected: PASS (7 тестов).

- [ ] **Step 5: Коммит**

```bash
git add server/services/media/media-store.ts tests/media-store.test.ts
git commit -m "feat(media): порт MediaStore и файловая реализация с дедупликацией"
```

---

### Task 4: Репозиторий реестра

**Files:**

- Create: `server/storage/media-repository.ts`
- Modify: `server/storage.ts`
- Create: `tests/it/media-repository.it.test.ts`

Интеграционные тесты слоя доступа к данным идут отдельной конфигурацией на `pglite`
(`npm run test:it`), как и остальные тесты репозиториев.

- [ ] **Step 1: Написать падающий тест**

Создай `tests/it/media-repository.it.test.ts`:

```ts
/**
 * @module tests/it/media-repository
 * @description Registry queries against a real schema: dedup lookup is scoped to the
 * owner (two authors with identical bytes get two rows), and usage rows for one entity
 * are replaced wholesale on re-sync.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MediaRepository } from "../../server/storage/media-repository";
import { db } from "../../server/db";
import { mediaAssets, mediaUsages } from "../../shared/schema";

const repo = new MediaRepository();

/** Minimal insert payload; only the fields a test cares about vary. */
function asset(overrides: Partial<Parameters<MediaRepository["createAsset"]>[0]> = {}) {
  return {
    checksum: "a".repeat(64),
    storageKey: "media/aa/aa/" + "a".repeat(64) + ".png",
    mimeType: "image/png",
    byteSize: 10,
    kind: "image" as const,
    originalName: "pic.png",
    ownerId: "u1",
    visibility: "shared" as const,
    ...overrides,
  };
}

beforeEach(async () => {
  await db.delete(mediaUsages);
  await db.delete(mediaAssets);
});

describe("MediaRepository", () => {
  it("finds an existing asset by owner and checksum", async () => {
    const created = await repo.createAsset(asset());
    const found = await repo.findAssetByOwnerChecksum("u1", "a".repeat(64));
    expect(found?.id).toBe(created.id);
  });

  it("keeps owners apart: identical bytes give two rows", async () => {
    await repo.createAsset(asset({ ownerId: "u1" }));
    await repo.createAsset(asset({ ownerId: "u2" }));
    expect(await repo.findAssetByOwnerChecksum("u2", "a".repeat(64))).toBeDefined();
    expect(await repo.countAssetsByChecksum("a".repeat(64))).toBe(2);
  });

  it("replaces the usage rows of one entity", async () => {
    const a = await repo.createAsset(asset());
    await repo.replaceUsages("question", "q1", [{ assetId: a.id, field: "mediaUrl" }]);
    await repo.replaceUsages("question", "q1", [{ assetId: a.id, field: "data.options.0.image" }]);
    const usages = await repo.getUsagesByAsset(a.id);
    expect(usages).toHaveLength(1);
    expect(usages[0].field).toBe("data.options.0.image");
  });

  it("lists orphan assets", async () => {
    const used = await repo.createAsset(asset({ checksum: "b".repeat(64) }));
    const orphan = await repo.createAsset(asset({ checksum: "c".repeat(64) }));
    await repo.replaceUsages("question", "q1", [{ assetId: used.id, field: "mediaUrl" }]);
    const orphans = await repo.listOrphanAssets();
    expect(orphans.map((o) => o.id)).toEqual([orphan.id]);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm run test:it -- tests/it/media-repository.it.test.ts`

Expected: FAIL — модуль `server/storage/media-repository` не найден.

- [ ] **Step 3: Реализовать репозиторий**

Создай `server/storage/media-repository.ts`:

```ts
/**
 * @module server/storage/media-repository
 * @description Data access for the media registry (`media_assets`) and its reverse
 * usage index (`media_usages`). Dedup lookup is per OWNER, not per checksum: one row
 * per checksum would hand a private file to anyone who uploaded the same bytes.
 * Usage rows are always replaced per entity, so a re-sync of one question cannot leave
 * a stale reference behind. Exposed through the `IStorage` facade, never imported by
 * routes.
 */
import { randomUUID } from "crypto";
import { and, eq, isNull, notExists, sql } from "drizzle-orm";
import { db } from "../db";
import {
  mediaAssets, mediaUsages,
  type MediaAsset, type InsertMediaAsset, type MediaUsage, type MediaEntityType,
} from "@shared/schema";

/** One reference found inside an entity. */
export interface MediaUsageRef {
  assetId: string;
  field: string;
}

/** Repository for `media_assets` and `media_usages`. */
export class MediaRepository {
  async createAsset(asset: Omit<InsertMediaAsset, "id">): Promise<MediaAsset> {
    const [row] = await db.insert(mediaAssets).values({ id: randomUUID(), ...asset }).returning();
    return row;
  }

  async getAsset(id: string): Promise<MediaAsset | undefined> {
    const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id));
    return row || undefined;
  }

  /** Legacy addresses (`/uploads/media/<file>`) resolve through the storage key. */
  async getAssetByStorageKey(storageKey: string): Promise<MediaAsset | undefined> {
    const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.storageKey, storageKey));
    return row || undefined;
  }

  /** Dedup lookup on upload. A null owner matches the backfilled legacy bucket. */
  async findAssetByOwnerChecksum(ownerId: string | null, checksum: string): Promise<MediaAsset | undefined> {
    const [row] = await db
      .select()
      .from(mediaAssets)
      .where(and(
        ownerId === null ? isNull(mediaAssets.ownerId) : eq(mediaAssets.ownerId, ownerId),
        eq(mediaAssets.checksum, checksum),
      ));
    return row || undefined;
  }

  /** Reference count of the PHYSICAL file: 0 means the bytes may be removed. */
  async countAssetsByChecksum(checksum: string): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(mediaAssets)
      .where(eq(mediaAssets.checksum, checksum));
    return row?.n ?? 0;
  }

  async listAssetsByOwner(ownerId: string): Promise<MediaAsset[]> {
    return db.select().from(mediaAssets).where(eq(mediaAssets.ownerId, ownerId));
  }

  async deleteAsset(id: string): Promise<boolean> {
    const rows = await db.delete(mediaAssets).where(eq(mediaAssets.id, id)).returning();
    return rows.length > 0;
  }

  /** Replaces ALL usage rows of one entity in a single transaction. */
  async replaceUsages(entityType: MediaEntityType, entityId: string, refs: MediaUsageRef[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(mediaUsages).where(and(
        eq(mediaUsages.entityType, entityType),
        eq(mediaUsages.entityId, entityId),
      ));
      if (refs.length === 0) return;
      await tx.insert(mediaUsages).values(
        refs.map((r) => ({ assetId: r.assetId, entityType, entityId, field: r.field })),
      ).onConflictDoNothing();
    });
  }

  async getUsagesByAsset(assetId: string): Promise<MediaUsage[]> {
    return db.select().from(mediaUsages).where(eq(mediaUsages.assetId, assetId));
  }

  /**
   * Assets no entity references. Input to orphan collection.
   *
   * An anti-join, NOT "read every used id and pass them as a NOT IN list": the list
   * would carry one bind parameter per used asset, and PostgreSQL caps a prepared
   * statement at 65535 of them. A media library grows without an upper bound.
   */
  async listOrphanAssets(): Promise<MediaAsset[]> {
    return db
      .select()
      .from(mediaAssets)
      .where(
        notExists(
          db.select({ one: sql`1` }).from(mediaUsages).where(eq(mediaUsages.assetId, mediaAssets.id)),
        ),
      );
  }

  /** Drops every usage row. Only the full reindex uses this. */
  async clearAllUsages(): Promise<void> {
    await db.delete(mediaUsages);
  }
}
```

- [ ] **Step 4: Подключить репозиторий к фасаду**

В `server/storage.ts`:

- добавь импорт рядом с остальными репозиториями:

```ts
import { MediaRepository, type MediaUsageRef } from "./storage/media-repository";
```

- добавь реэкспорт типа рядом с `export type { TestUsageRef };`:

```ts
export type { MediaUsageRef };
```

- добавь в интерфейс `IStorage` (рядом с остальными группами методов):

```ts
  // Медиатека
  createMediaAsset(asset: Omit<InsertMediaAsset, "id">): Promise<MediaAsset>;
  getMediaAsset(id: string): Promise<MediaAsset | undefined>;
  getMediaAssetByStorageKey(storageKey: string): Promise<MediaAsset | undefined>;
  findMediaAssetByOwnerChecksum(ownerId: string | null, checksum: string): Promise<MediaAsset | undefined>;
  countMediaAssetsByChecksum(checksum: string): Promise<number>;
  listMediaAssetsByOwner(ownerId: string): Promise<MediaAsset[]>;
  deleteMediaAsset(id: string): Promise<boolean>;
  replaceMediaUsages(entityType: MediaEntityType, entityId: string, refs: MediaUsageRef[]): Promise<void>;
  getMediaUsagesByAsset(assetId: string): Promise<MediaUsage[]>;
  listOrphanMediaAssets(): Promise<MediaAsset[]>;
  clearAllMediaUsages(): Promise<void>;
```

- добавь типы в блок `import type { ... } from "@shared/schema"`:

```ts
  MediaAsset, InsertMediaAsset, MediaUsage, MediaEntityType,
```

- в классе `DatabaseStorage` создай поле рядом с остальными репозиториями и делегируй:

```ts
  private mediaRepo = new MediaRepository();

  createMediaAsset(asset: Omit<InsertMediaAsset, "id">) { return this.mediaRepo.createAsset(asset); }
  getMediaAsset(id: string) { return this.mediaRepo.getAsset(id); }
  getMediaAssetByStorageKey(key: string) { return this.mediaRepo.getAssetByStorageKey(key); }
  findMediaAssetByOwnerChecksum(ownerId: string | null, checksum: string) {
    return this.mediaRepo.findAssetByOwnerChecksum(ownerId, checksum);
  }
  countMediaAssetsByChecksum(checksum: string) { return this.mediaRepo.countAssetsByChecksum(checksum); }
  listMediaAssetsByOwner(ownerId: string) { return this.mediaRepo.listAssetsByOwner(ownerId); }
  deleteMediaAsset(id: string) { return this.mediaRepo.deleteAsset(id); }
  replaceMediaUsages(entityType: MediaEntityType, entityId: string, refs: MediaUsageRef[]) {
    return this.mediaRepo.replaceUsages(entityType, entityId, refs);
  }
  getMediaUsagesByAsset(assetId: string) { return this.mediaRepo.getUsagesByAsset(assetId); }
  listOrphanMediaAssets() { return this.mediaRepo.listOrphanAssets(); }
  clearAllMediaUsages() { return this.mediaRepo.clearAllUsages(); }
```

- [ ] **Step 5: Убедиться, что тесты проходят и типы сходятся**

Run: `npm run test:it -- tests/it/media-repository.it.test.ts`

Expected: PASS (10 тестов — четыре основных плюс шесть добавленных по итогам ревью:
легаси-корзина с нулевым владельцем, удаление, полная очистка индекса, выборка по владельцу,
резолв по ключу хранения, повторная ссылка в одном вызове).

Run: `npm run check`

Expected: без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add server/storage/media-repository.ts server/storage.ts tests/it/media-repository.it.test.ts
git commit -m "feat(media): репозиторий реестра и индекса, подключение к IStorage"
```

---

### Task 5: Чистый разбор ссылок на медиа

**Files:**

- Create: `server/services/media/media-refs.ts`
- Create: `tests/media-refs.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создай `tests/media-refs.test.ts`:

```ts
/**
 * @module tests/media-refs
 * @description The ONE walker that finds media references inside an entity. It feeds
 * both the write-time index and the full re-sync, so the two can never disagree. It
 * recognises the canonical address and the legacy one, and reports a dotted path so the
 * «где используется» report can say where exactly.
 */
import { describe, it, expect } from "vitest";
import { parseMediaRef, collectMediaRefs } from "../server/services/media/media-refs";

describe("parseMediaRef", () => {
  it("recognises the canonical address", () => {
    expect(parseMediaRef("/api/media/3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toEqual({
      kind: "canonical", id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    });
  });

  it("recognises the legacy address", () => {
    expect(parseMediaRef("/uploads/media/1717_abc.png")).toEqual({
      kind: "legacy", storageKey: "media/1717_abc.png",
    });
  });

  it("ignores anything else", () => {
    expect(parseMediaRef("https://example.com/x.png")).toBeNull();
    expect(parseMediaRef("data:image/png;base64,AAA")).toBeNull();
    expect(parseMediaRef("")).toBeNull();
    expect(parseMediaRef(42)).toBeNull();
  });
});

describe("collectMediaRefs", () => {
  it("walks nested objects and arrays and reports dotted paths", () => {
    const entity = {
      mediaUrl: "/api/media/11111111-1111-1111-1111-111111111111",
      data: {
        options: [
          { image: "/uploads/media/old.png" },
          { image: "https://example.com/skip.png" },
        ],
      },
    };
    expect(collectMediaRefs(entity)).toEqual([
      { field: "mediaUrl", ref: { kind: "canonical", id: "11111111-1111-1111-1111-111111111111" } },
      { field: "data.options.0.image", ref: { kind: "legacy", storageKey: "media/old.png" } },
    ]);
  });

  it("returns nothing for an entity without media", () => {
    expect(collectMediaRefs({ prompt: "текст", tags: ["a"] })).toEqual([]);
  });

  it("survives null and non-object input", () => {
    expect(collectMediaRefs(null)).toEqual([]);
    expect(collectMediaRefs("строка")).toEqual([]);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- tests/media-refs.test.ts`

Expected: FAIL — модуль `server/services/media/media-refs` не найден.

- [ ] **Step 3: Реализовать обходчик**

Создай `server/services/media/media-refs.ts`:

```ts
/**
 * @module server/services/media/media-refs
 *
 * The single walker that finds media references inside a content entity. It is used by
 * BOTH the write-time usage index and the full re-sync — one implementation, because two
 * would drift, and they would drift silently in the direction of refusing access.
 *
 * Pure module: no database, no filesystem. Resolving a reference to a registry row is the
 * caller's job ({@link module:server/services/media/usage-index}).
 *
 * Two address shapes are recognised. The canonical `/api/media/<uuid>` is what content
 * stores from now on; the legacy `/uploads/media/<file>` is what pre-registry content
 * still holds and is resolved through the asset's storage key until it is rewritten.
 */

/** The canonical address: the asset id IS the address. */
const CANONICAL = /^\/api\/media\/([0-9a-fA-F-]{36})$/;
/** The pre-registry address served by the old static mount. */
const LEGACY = /^\/uploads\/(media\/[^?#]+)$/;

/** A recognised reference to a stored file. */
export type MediaRef =
  | { kind: "canonical"; id: string }
  | { kind: "legacy"; storageKey: string };

/** One reference together with where inside the entity it was found. */
export interface FoundMediaRef {
  /** Dotted path, e.g. `data.options.0.image`. */
  field: string;
  ref: MediaRef;
}

/** Recognises one value. Returns `null` for anything that is not a stored file. */
export function parseMediaRef(value: unknown): MediaRef | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const canonical = CANONICAL.exec(raw);
  if (canonical) return { kind: "canonical", id: canonical[1] };
  const legacy = LEGACY.exec(raw.replace(/\\/g, "/"));
  if (legacy) return { kind: "legacy", storageKey: legacy[1] };
  return null;
}

/** Walks an entity and returns every media reference it holds, in traversal order. */
export function collectMediaRefs(entity: unknown): FoundMediaRef[] {
  const found: FoundMediaRef[] = [];

  function visit(node: unknown, path: string): void {
    if (typeof node === "string") {
      const ref = parseMediaRef(node);
      if (ref) found.push({ field: path, ref });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, path ? `${path}.${i}` : String(i)));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        visit(value, path ? `${path}.${key}` : key);
      }
    }
  }

  visit(entity, "");
  return found;
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- tests/media-refs.test.ts`

Expected: PASS (6 тестов).

- [ ] **Step 5: Коммит**

```bash
git add server/services/media/media-refs.ts tests/media-refs.test.ts
git commit -m "feat(media): чистый обходчик ссылок на медиа"
```

---

### Task 6: Служба индекса использования

**Files:**

- Create: `server/services/media/usage-index.ts`
- Create: `tests/media-usage-index.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создай `tests/media-usage-index.test.ts`:

```ts
/**
 * @module tests/media-usage-index
 * @description Turning found references into index rows: canonical ids go through as
 * they are, legacy addresses resolve via the storage key, and an unresolvable reference
 * is dropped rather than written as a dangling row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getMediaAssetByStorageKey: vi.fn(),
    replaceMediaUsages: vi.fn(),
  },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

import { syncEntityUsages } from "../server/services/media/usage-index";

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.replaceMediaUsages.mockResolvedValue(undefined);
});

describe("syncEntityUsages", () => {
  it("writes canonical references straight through", async () => {
    await syncEntityUsages("question", "q1", {
      mediaUrl: "/api/media/11111111-1111-1111-1111-111111111111",
    });
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("question", "q1", [
      { assetId: "11111111-1111-1111-1111-111111111111", field: "mediaUrl" },
    ]);
  });

  it("resolves a legacy address through the storage key", async () => {
    storageMock.getMediaAssetByStorageKey.mockResolvedValue({ id: "asset-9" });
    await syncEntityUsages("question", "q2", { mediaUrl: "/uploads/media/old.png" });
    expect(storageMock.getMediaAssetByStorageKey).toHaveBeenCalledWith("media/old.png");
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("question", "q2", [
      { assetId: "asset-9", field: "mediaUrl" },
    ]);
  });

  it("drops an unresolvable legacy address instead of writing a dangling row", async () => {
    storageMock.getMediaAssetByStorageKey.mockResolvedValue(undefined);
    await syncEntityUsages("question", "q3", { mediaUrl: "/uploads/media/gone.png" });
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("question", "q3", []);
  });

  it("clears the rows of an entity that lost its media", async () => {
    await syncEntityUsages("question", "q4", { prompt: "без медиа" });
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("question", "q4", []);
  });

  it("de-duplicates the same asset in the same field path", async () => {
    await syncEntityUsages("content_page", "p1", {
      a: "/api/media/22222222-2222-2222-2222-222222222222",
      b: "/api/media/22222222-2222-2222-2222-222222222222",
    });
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("content_page", "p1", [
      { assetId: "22222222-2222-2222-2222-222222222222", field: "a" },
      { assetId: "22222222-2222-2222-2222-222222222222", field: "b" },
    ]);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- tests/media-usage-index.test.ts`

Expected: FAIL — модуль `server/services/media/usage-index` не найден.

- [ ] **Step 3: Реализовать службу**

Создай `server/services/media/usage-index.ts`:

```ts
/**
 * @module server/services/media/usage-index
 *
 * Keeps `media_usages` in step with content. Called from the save path of every entity
 * that can hold a media reference, and from the full re-sync.
 *
 * A reference that cannot be resolved to a registry row is DROPPED, not written: a
 * dangling row would later be read by the delivery rule, and reading it would grant or
 * refuse access on the strength of a file that does not exist.
 */
import { storage } from "../../storage";
import type { MediaEntityType } from "@shared/schema";
import type { MediaUsageRef } from "../../storage/media-repository";
import { collectMediaRefs } from "./media-refs";

/** Resolves every reference inside `entity` to registry ids. */
export async function resolveEntityUsages(entity: unknown): Promise<MediaUsageRef[]> {
  const found = collectMediaRefs(entity);
  const refs: MediaUsageRef[] = [];
  for (const { field, ref } of found) {
    if (ref.kind === "canonical") {
      refs.push({ assetId: ref.id, field });
      continue;
    }
    const asset = await storage.getMediaAssetByStorageKey(ref.storageKey);
    if (asset) refs.push({ assetId: asset.id, field });
  }
  return refs;
}

/** Replaces the index rows of ONE entity. Safe to call on every save. */
export async function syncEntityUsages(
  entityType: MediaEntityType,
  entityId: string,
  entity: unknown,
): Promise<void> {
  const refs = await resolveEntityUsages(entity);
  await storage.replaceMediaUsages(entityType, entityId, refs);
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- tests/media-usage-index.test.ts`

Expected: PASS (5 тестов).

- [ ] **Step 5: Коммит**

```bash
git add server/services/media/usage-index.ts tests/media-usage-index.test.ts
git commit -m "feat(media): служба индекса использования"
```

---

### Task 7: Правило доступа к активу

**Files:**

- Create: `server/services/media/asset-access.ts`
- Create: `tests/media-asset-access.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создай `tests/media-asset-access.test.ts`:

```ts
/**
 * @module tests/media-asset-access
 * @description The delivery rule (§6.1 of the spec). Three independent grounds: owner or
 * admin, a shared file to an authoring role, and — the only one that lets a LEARNER
 * through — the asset being used in content that learner may reach.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getMediaUsagesByAsset: vi.fn(),
    getQuestion: vi.fn(),
    isTestAssignedToUser: vi.fn(),
    getTestSectionsByTopic: vi.fn(),
  },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

import { ROLES } from "../shared/access";
import { canDeliverAsset, clearAssetAccessCache } from "../server/services/media/asset-access";

const asset = (over: Record<string, unknown> = {}) => ({
  id: "a1", ownerId: "author-1", visibility: "shared", ...over,
} as never);

beforeEach(() => {
  vi.clearAllMocks();
  clearAssetAccessCache();
  storageMock.getMediaUsagesByAsset.mockResolvedValue([]);
});

describe("canDeliverAsset", () => {
  it("lets the owner through", async () => {
    const ok = await canDeliverAsset(asset({ visibility: "private" }), "author-1", [ROLES.AUTHOR]);
    expect(ok).toBe(true);
  });

  it("lets an administrator through", async () => {
    const ok = await canDeliverAsset(asset({ visibility: "private" }), "someone", [ROLES.ADMINISTRATOR]);
    expect(ok).toBe(true);
  });

  it("lets an authoring role read a shared file", async () => {
    const ok = await canDeliverAsset(asset(), "author-2", [ROLES.AUTHOR]);
    expect(ok).toBe(true);
  });

  it("refuses another author a private file", async () => {
    const ok = await canDeliverAsset(asset({ visibility: "private" }), "author-2", [ROLES.AUTHOR]);
    expect(ok).toBe(false);
  });

  it("refuses a learner a file used nowhere", async () => {
    const ok = await canDeliverAsset(asset(), "learner-1", [ROLES.LEARNER]);
    expect(ok).toBe(false);
  });

  it("lets a learner through when the file is used by an assigned test", async () => {
    storageMock.getMediaUsagesByAsset.mockResolvedValue([
      { assetId: "a1", entityType: "content_page", entityId: "page-1", field: "image" },
    ]);
    storageMock.isTestAssignedToUser.mockResolvedValue(true);
    const ok = await canDeliverAsset(asset(), "learner-1", [ROLES.LEARNER], { pageTestId: "t1" });
    expect(ok).toBe(true);
  });

  it("caches the decision for the same asset and user", async () => {
    storageMock.getMediaUsagesByAsset.mockResolvedValue([]);
    await canDeliverAsset(asset(), "learner-1", [ROLES.LEARNER]);
    await canDeliverAsset(asset(), "learner-1", [ROLES.LEARNER]);
    expect(storageMock.getMediaUsagesByAsset).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- tests/media-asset-access.test.ts`

Expected: FAIL — модуль `server/services/media/asset-access` не найден.

- [ ] **Step 3: Реализовать правило**

Создай `server/services/media/asset-access.ts`:

```ts
/**
 * @module server/services/media/asset-access
 *
 * The delivery rule of the media library (spec §6.1). A file goes out when at least one
 * ground holds:
 *
 *  1. the requester owns the asset, or is an administrator/superadmin;
 *  2. the asset is `shared` and the requester holds an authoring role — access "to the
 *     library", for reuse;
 *  3. the asset is used in content the requester may reach. This is the ONLY ground that
 *     lets a learner receive a picture: they hold neither ownership nor an authoring role.
 *
 * Ground 3 costs a query per picture, so the decision is cached in process memory keyed by
 * (asset, user). {@link clearAssetAccessCache} is called whenever the usage index is
 * rewritten — a stale positive would outlive the content that justified it.
 */
import { hasAuthoringRole, type Role } from "@shared/access";
import type { MediaAsset } from "@shared/schema";
import { storage } from "../../storage";
import { isAdminOrSuper } from "../test-access";

/** Resolved decisions, keyed `<assetId>:<userId>`. Cleared on index writes. */
const cache = new Map<string, boolean>();

/** Drops every cached decision. Call after any write to `media_usages`. */
export function clearAssetAccessCache(): void {
  cache.clear();
}

/**
 * Test ids the asset's usages belong to.
 *
 * `content_page`, `test_design` and `test_feedback` name their test directly; the caller
 * supplies it because those tables are read by their own services. A `question` usage
 * reaches tests through its topic's sections.
 */
async function testIdsForUsages(
  assetId: string,
  hints: { pageTestId?: string } = {},
): Promise<string[]> {
  const usages = await storage.getMediaUsagesByAsset(assetId);
  const ids = new Set<string>();
  for (const usage of usages) {
    if (usage.entityType === "question") {
      const question = await storage.getQuestion(usage.entityId);
      if (!question) continue;
      const sections = await storage.getTestSectionsByTopic(question.topicId);
      for (const section of sections) ids.add(section.testId);
      continue;
    }
    // Every other entity type is test-scoped; the hint carries its test id.
    if (hints.pageTestId) ids.add(hints.pageTestId);
  }
  return [...ids];
}

/** Decides whether `userId` may receive `asset`. */
export async function canDeliverAsset(
  asset: MediaAsset,
  userId: string,
  roles: readonly Role[],
  hints: { pageTestId?: string } = {},
): Promise<boolean> {
  if (asset.ownerId && asset.ownerId === userId) return true;
  if (isAdminOrSuper(roles)) return true;
  if (asset.visibility === "shared" && hasAuthoringRole(roles)) return true;

  const key = `${asset.id}:${userId}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let allowed = false;
  for (const testId of await testIdsForUsages(asset.id, hints)) {
    if (await storage.isTestAssignedToUser(testId, userId)) {
      allowed = true;
      break;
    }
  }
  cache.set(key, allowed);
  return allowed;
}
```

- [ ] **Step 4: Проверить типы**

Run: `npm run check`

Expected: без ошибок. Все использованные методы уже есть в `IStorage`:
`getMediaUsagesByAsset` (Задача 4), `getQuestion`, `getTestSectionsByTopic`, `isTestAssignedToUser`.

- [ ] **Step 5: Убедиться, что тест проходит**

Run: `npm test -- tests/media-asset-access.test.ts`

Expected: PASS (7 тестов).

- [ ] **Step 6: Сбрасывать кеш при записи индекса**

В `server/services/media/usage-index.ts` добавь импорт и вызов:

```ts
import { clearAssetAccessCache } from "./asset-access";
```

и в конце `syncEntityUsages`, после `await storage.replaceMediaUsages(...)`:

```ts
  clearAssetAccessCache();
```

- [ ] **Step 7: Убедиться, что оба теста по-прежнему проходят**

Run: `npm test -- tests/media-usage-index.test.ts tests/media-asset-access.test.ts`

Expected: PASS (12 тестов).

- [ ] **Step 8: Коммит**

```bash
git add server/services/media/asset-access.ts server/services/media/usage-index.ts tests/media-asset-access.test.ts
git commit -m "feat(media): правило доступа к активу с кешем решения"
```

---

### Task 8: Загрузка пишет реестр

**Files:**

- Create: `server/routes/media.ts`
- Modify: `server/routes/index.ts`
- Modify: `server/routes.ts:14-34,89-108`
- Modify: `server/middleware/upload.ts`
- Create: `tests/media-upload-route.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создай `tests/media-upload-route.test.ts`:

```ts
/**
 * @module tests/media-upload-route
 * @description Upload now writes a registry row and answers with the CANONICAL address.
 * Re-uploading the same bytes by the same author returns the SAME asset instead of a
 * second row. The response keeps its old field names — the editor reads `url`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { storageMock, storeMock } = vi.hoisted(() => ({
  storageMock: {
    createMediaAsset: vi.fn(),
    findMediaAssetByOwnerChecksum: vi.fn(),
  },
  storeMock: { putFile: vi.fn() },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/media/media-store", () => ({ mediaStore: storeMock }));

import mediaRouter from "../server/routes/media";

/** Mini app with a logged-in session. */
function makeApp(userId: string | undefined = "author-1") {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = userId ? { userId } : {};
    next();
  });
  app.use("/api/media", mediaRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  storeMock.putFile.mockResolvedValue({
    storageKey: "media/ab/cd/" + "a".repeat(64) + ".png",
    checksum: "a".repeat(64),
    byteSize: 5,
  });
});

describe("POST /api/media/upload", () => {
  it("creates a registry row and answers with the canonical address", async () => {
    storageMock.findMediaAssetByOwnerChecksum.mockResolvedValue(undefined);
    storageMock.createMediaAsset.mockResolvedValue({ id: "asset-1", mimeType: "image/png", byteSize: 5 });

    const res = await request(makeApp())
      .post("/api/media/upload")
      .attach("file", Buffer.from("hello"), { filename: "pic.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe("/api/media/asset-1");
    expect(res.body.id).toBe("asset-1");
    expect(res.body.originalName).toBe("pic.png");
    expect(storageMock.createMediaAsset).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "image", ownerId: "author-1", checksum: "a".repeat(64) }),
    );
  });

  it("returns the existing asset when the same author re-uploads the same bytes", async () => {
    storageMock.findMediaAssetByOwnerChecksum.mockResolvedValue({
      id: "asset-old", mimeType: "image/png", byteSize: 5,
    });

    const res = await request(makeApp())
      .post("/api/media/upload")
      .attach("file", Buffer.from("hello"), { filename: "pic.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe("/api/media/asset-old");
    expect(storageMock.createMediaAsset).not.toHaveBeenCalled();
  });

  it("accepts a PDF as a document", async () => {
    storageMock.findMediaAssetByOwnerChecksum.mockResolvedValue(undefined);
    storageMock.createMediaAsset.mockResolvedValue({ id: "asset-2", mimeType: "application/pdf", byteSize: 5 });

    const res = await request(makeApp())
      .post("/api/media/upload")
      .attach("file", Buffer.from("%PDF-"), { filename: "memo.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(200);
    expect(storageMock.createMediaAsset).toHaveBeenCalledWith(expect.objectContaining({ kind: "document" }));
  });

  it("refuses an anonymous upload", async () => {
    const res = await request(makeApp(undefined))
      .post("/api/media/upload")
      .attach("file", Buffer.from("hello"), { filename: "pic.png", contentType: "image/png" });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- tests/media-upload-route.test.ts`

Expected: FAIL — модуль `server/routes/media` не найден.

- [ ] **Step 3: Разрешить PDF в фильтре загрузки**

В `server/middleware/upload.ts` замени тело `fileFilter` у `mediaUpload`:

```ts
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("audio/") ||
      file.mimetype.startsWith("video/") ||
      // PRD-32: PDF-вложения обратной связи живут в том же реестре.
      file.mimetype === "application/pdf";
    cb(ok ? null : (new Error("Unsupported media type") as any), ok);
  },
```

и замени `destination` на временную директорию, потому что окончательное место теперь выбирает
`MediaStore` по контрольной сумме:

```ts
// Uploads land in a scratch directory; `MediaStore.putFile` moves them to their
// checksum-derived final key, so the upload never picks the storage layout itself.
const tmpDir = path.resolve(process.cwd(), "uploads", "tmp");
fs.mkdirSync(tmpDir, { recursive: true });
```

```ts
    destination: (_req, _file, cb) => cb(null, tmpDir),
```

- [ ] **Step 4: Создать роутер медиа**

Создай `server/routes/media.ts`:

```ts
/**
 * @module server/routes/media
 *
 * The media library API.
 *
 * `POST /upload` — accepts a file, moves it into the store under a checksum-derived key
 * and writes (or reuses) a registry row. The answer keeps its historical field names
 * (`url`, `mime`, `originalName`, `size`) because the editor reads them; `url` is now the
 * canonical `/api/media/<id>` instead of a path into a public static mount.
 */
import { Router, type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { storage } from "../storage";
import { mediaUpload } from "../middleware/upload";
import { mediaStore } from "../services/media/media-store";
import { logger } from "../logger";

const router = Router();

/** Rejects an unauthenticated caller. Media is never anonymous, not even to upload. */
function requireAuth(req: Request, res: Response, next: () => void) {
  if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

/** Maps a MIME type onto the registry's coarse kind. */
function kindOf(mime: string): "image" | "audio" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

router.post("/upload", requireAuth, mediaUpload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const ownerId = req.session.userId as string;
  // Busboy decodes the multipart filename as latin1 by default, so a UTF-8
  // (e.g. Cyrillic) original name arrives mojibake — re-decode it to UTF-8.
  const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");

  try {
    const ext = path.extname(originalName).toLowerCase();
    const stored = await mediaStore.putFile(req.file.path, ext);

    // Dedup is per OWNER: identical bytes from another author get their own row.
    let asset = await storage.findMediaAssetByOwnerChecksum(ownerId, stored.checksum);
    if (!asset) {
      asset = await storage.createMediaAsset({
        checksum: stored.checksum,
        storageKey: stored.storageKey,
        mimeType: req.file.mimetype,
        byteSize: stored.byteSize,
        kind: kindOf(req.file.mimetype),
        originalName,
        title: originalName.replace(/\.[^.]+$/, "") || originalName,
        ownerId,
        // Shared by default: a picture used by a question of a SHARED topic must stay
        // reachable when another author picks that topic up. Privacy is an explicit act.
        visibility: "shared",
      });
    }

    res.json({
      id: asset.id,
      url: `/api/media/${asset.id}`,
      mime: asset.mimeType,
      originalName,
      size: asset.byteSize,
    });
  } catch (error) {
    // The scratch file must not survive a failed registration.
    if (req.file?.path) fs.rmSync(req.file.path, { force: true });
    logger.error(`Media upload failed: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to store media" });
  }
});

export default router;
```

- [ ] **Step 5: Смонтировать роутер и убрать инлайновую загрузку**

В `server/routes/index.ts` добавь импорт `import mediaRouter from "./media";`, добавь `mediaRouter` в
блок `export { ... }` и вставь в `routerConfig` **до** общих `{ path: "/api", ... }` записей, рядом с
`/api/home`:

```ts
  // Медиатека: префиксное монтирование до общих "/api", чтобы путь не перехватывался.
  { path: "/api/media", router: mediaRouter },
```

В `server/routes.ts` удали блок `// ========== Media Upload ==========` целиком (строки 89-108) и
конфигурацию multer вверху файла (строки 14-34), а также ставшие ненужными импорты `multer`, `crypto` и
локальную функцию `requireAuth`, если её больше никто не использует. Проверь:

```bash
grep -n "multer\|mediaUpload\|requireAuth\|crypto" server/routes.ts
```

Ожидается пустой вывод.

- [ ] **Step 6: Убедиться, что тест проходит**

Run: `npm test -- tests/media-upload-route.test.ts`

Expected: PASS (4 теста).

Run: `npm run check`

Expected: без ошибок.

- [ ] **Step 7: Коммит**

```bash
git add server/routes/media.ts server/routes/index.ts server/routes.ts server/middleware/upload.ts tests/media-upload-route.test.ts
git commit -m "feat(media): загрузка пишет реестр и отдаёт канонический адрес"
```

---

### Task 9: Индексация существующих файлов

**Files:**

- Create: `script/backfill-media-registry.ts`
- Create: `tests/media-backfill.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создай `tests/media-backfill.test.ts`:

```ts
/**
 * @module tests/media-backfill
 * @description The one-off indexing of pre-registry files. Owner is unknowable (the old
 * file name carried none), so rows land in the legacy bucket with a null owner. Two files
 * with identical bytes must collapse into ONE legacy row, otherwise the null-owner bucket
 * accumulates duplicates the unique index cannot catch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    findMediaAssetByOwnerChecksum: vi.fn(),
    createMediaAsset: vi.fn(),
  },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

import { backfillMediaRegistry } from "../script/backfill-media-registry";

let root: string;

beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-"));
  fs.mkdirSync(path.join(root, "media"), { recursive: true });
  storageMock.findMediaAssetByOwnerChecksum.mockResolvedValue(undefined);
  storageMock.createMediaAsset.mockImplementation(async (a) => ({ id: "new", ...a }));
});

describe("backfillMediaRegistry", () => {
  it("indexes a file into the legacy bucket", async () => {
    fs.writeFileSync(path.join(root, "media", "1717_a.png"), "hello");
    const report = await backfillMediaRegistry(root);
    expect(report.created).toBe(1);
    expect(storageMock.createMediaAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: null,
        visibility: "shared",
        kind: "image",
        originalName: "1717_a.png",
        storageKey: "media/1717_a.png",
      }),
    );
  });

  it("collapses identical bytes into one legacy row", async () => {
    fs.writeFileSync(path.join(root, "media", "one.png"), "same");
    fs.writeFileSync(path.join(root, "media", "two.png"), "same");
    const report = await backfillMediaRegistry(root);
    expect(report.created).toBe(1);
    expect(report.skipped).toBe(1);
  });

  it("skips a file already in the registry", async () => {
    fs.writeFileSync(path.join(root, "media", "known.png"), "hello");
    storageMock.findMediaAssetByOwnerChecksum.mockResolvedValue({ id: "existing" });
    const report = await backfillMediaRegistry(root);
    expect(report.created).toBe(0);
    expect(report.skipped).toBe(1);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- tests/media-backfill.test.ts`

Expected: FAIL — модуль `script/backfill-media-registry` не найден.

- [ ] **Step 3: Реализовать скрипт**

Создай `script/backfill-media-registry.ts`:

```ts
/**
 * @module script/backfill-media-registry
 *
 * One-off indexing of files that predate the registry. The old upload wrote
 * `uploads/media/<timestamp>_<uuid>.<ext>` and recorded nothing, so the author is
 * unknowable: rows land in the legacy bucket (`owner_id = null`, `shared`), which is what
 * lets the existing `/uploads/media/...` strings in content keep resolving.
 *
 * Files are NOT moved. The old flat name becomes the storage key as it stands, so the
 * addresses already stored in content resolve without rewriting a single JSON document.
 * New uploads use the checksum layout; the two coexist.
 *
 * Run: `npx tsx script/backfill-media-registry.ts`
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { storage } from "../server/storage";

/** What one run did. */
export interface BackfillReport {
  created: number;
  skipped: number;
}

/** Maps a file extension onto the registry's coarse kind. */
function kindOf(ext: string): "image" | "audio" | "video" | "document" {
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) return "image";
  if ([".mp3", ".wav", ".ogg", ".m4a"].includes(ext)) return "audio";
  if ([".mp4", ".webm", ".ogv", ".mov"].includes(ext)) return "video";
  return "document";
}

/** Guesses a MIME type from the extension; the old upload stored none. */
function mimeOf(ext: string): string {
  const map: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".wav": "audio/wav",
    ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".mp4": "video/mp4", ".webm": "video/webm",
    ".mov": "video/quicktime", ".pdf": "application/pdf",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Indexes every file directly under `<uploadsRoot>/media`. */
export async function backfillMediaRegistry(uploadsRoot: string): Promise<BackfillReport> {
  const mediaDir = path.join(uploadsRoot, "media");
  if (!fs.existsSync(mediaDir)) return { created: 0, skipped: 0 };

  const report: BackfillReport = { created: 0, skipped: 0 };
  // Postgres treats NULL owners as distinct, so the unique index cannot stop duplicate
  // legacy rows — this run dedups them itself.
  const seen = new Set<string>();

  for (const name of fs.readdirSync(mediaDir).sort()) {
    const abs = path.join(mediaDir, name);
    if (!fs.statSync(abs).isFile()) continue;

    const checksum = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
    if (seen.has(checksum) || await storage.findMediaAssetByOwnerChecksum(null, checksum)) {
      report.skipped += 1;
      continue;
    }
    seen.add(checksum);

    const ext = path.extname(name).toLowerCase();
    await storage.createMediaAsset({
      checksum,
      // The flat legacy name IS the key: content already addresses it this way.
      storageKey: `media/${name}`,
      mimeType: mimeOf(ext),
      byteSize: fs.statSync(abs).size,
      kind: kindOf(ext),
      originalName: name,
      title: name.replace(/\.[^.]+$/, "") || name,
      ownerId: null,
      visibility: "shared",
    });
    report.created += 1;
  }

  return report;
}

// Direct invocation: index the service's own uploads directory.
if (process.argv[1] && process.argv[1].endsWith("backfill-media-registry.ts")) {
  backfillMediaRegistry(path.resolve(process.cwd(), "uploads"))
    .then((r) => {
      console.log(`Индексация завершена: создано ${r.created}, пропущено ${r.skipped}`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- tests/media-backfill.test.ts`

Expected: PASS (3 теста).

- [ ] **Step 5: Прогнать индексацию на dev-базе**

```bash
npx tsx script/backfill-media-registry.ts
```

Expected: строка `Индексация завершена: создано N, пропущено M`, где `N` совпадает с числом уникальных по
содержимому файлов в `uploads/media`. Проверь:

```bash
psql "$DATABASE_URL" -c "select count(*) from media_assets where owner_id is null;"
```

- [ ] **Step 6: Коммит**

```bash
git add script/backfill-media-registry.ts tests/media-backfill.test.ts
git commit -m "feat(media): индексация существующих файлов в реестр"
```

---

### Task 10: Индекс пишется при сохранении вопроса

**Files:**

- Modify: `server/routes/questions.ts`
- Create: `tests/media-usage-on-question-save.test.ts`

- [ ] **Step 1: Найти точки сохранения**

```bash
grep -n "router.post(\"/\"\|router.put(\"/:id\"\|router.delete(\"/:id\"" server/routes/questions.ts
```

Запиши номера строк — они понадобятся на шаге 3.

- [ ] **Step 2: Написать падающий тест**

Создай `tests/media-usage-on-question-save.test.ts`:

```ts
/**
 * @module tests/media-usage-on-question-save
 * @description Saving a question keeps the usage index in step. Without this the delivery
 * rule refuses a learner the picture of the question they were just given.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncEntityUsages } from "../server/services/media/usage-index";

vi.mock("../server/storage", () => ({
  storage: {
    getMediaAssetByStorageKey: vi.fn().mockResolvedValue(undefined),
    replaceMediaUsages: vi.fn().mockResolvedValue(undefined),
  },
}));

import { storage } from "../server/storage";

beforeEach(() => vi.clearAllMocks());

describe("question save -> usage index", () => {
  it("indexes the question's own media and the media inside its data", async () => {
    await syncEntityUsages("question", "q1", {
      id: "q1",
      mediaUrl: "/api/media/11111111-1111-1111-1111-111111111111",
      dataJson: { options: [{ image: "/api/media/22222222-2222-2222-2222-222222222222" }] },
    });
    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("question", "q1", [
      { assetId: "11111111-1111-1111-1111-111111111111", field: "mediaUrl" },
      { assetId: "22222222-2222-2222-2222-222222222222", field: "dataJson.options.0.image" },
    ]);
  });

  it("clears the rows when a question is deleted", async () => {
    await syncEntityUsages("question", "q1", null);
    expect(storage.replaceMediaUsages).toHaveBeenCalledWith("question", "q1", []);
  });
});
```

- [ ] **Step 3: Убедиться, что тест проходит уже сейчас**

Run: `npm test -- tests/media-usage-on-question-save.test.ts`

Expected: PASS (2 теста). Этот тест закрепляет контракт службы; сама привязка к маршруту проверяется
следующим шагом вручную, потому что маршрут вопросов уже покрыт своими тестами.

- [ ] **Step 4: Вызвать синхронизацию из маршрутов вопроса**

В `server/routes/questions.ts` добавь импорт:

```ts
import { syncEntityUsages } from "../services/media/usage-index";
```

В обработчике создания (`POST /`), после того как вопрос создан и переменная с созданной записью
доступна, перед отправкой ответа:

```ts
    // Медиатека: индекс использования обязан догонять контент в тот же момент,
    // иначе правило раздачи откажет ученику в картинке только что выданного вопроса.
    await syncEntityUsages("question", created.id, created);
```

В обработчике обновления (`PUT /:id`), после успешного обновления:

```ts
    await syncEntityUsages("question", updated.id, updated);
```

В обработчике удаления (`DELETE /:id`), после успешного удаления:

```ts
    await syncEntityUsages("question", req.params.id, null);
```

Имена переменных (`created`, `updated`) подставь фактические — посмотри их по номерам строк из шага 1.

- [ ] **Step 5: Проверить, что маршруты вопросов не сломались**

Run: `npm test -- tests/routes.questions-order-index.test.ts`

Expected: PASS. Если тест падает на отсутствующем моке `replaceMediaUsages`, добавь его в мок хранилища
этого файла — служба вызывается из обработчика.

Run: `npm run check`

Expected: без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add server/routes/questions.ts tests/media-usage-on-question-save.test.ts
git commit -m "feat(media): индекс использования обновляется при сохранении вопроса"
```

---

### Task 11: Пересборка индекса и отчёт о сиротах

**Files:**

- Modify: `server/services/media/usage-index.ts`
- Modify: `server/routes/media.ts`
- Create: `tests/media-reindex.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создай `tests/media-reindex.test.ts`:

```ts
/**
 * @module tests/media-reindex
 * @description The full re-sync is the safety net under the write-time index: it uses the
 * SAME walker, so a drift shows up as a difference rather than as silently refused access.
 * It also produces the orphan list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    clearAllMediaUsages: vi.fn().mockResolvedValue(undefined),
    replaceMediaUsages: vi.fn().mockResolvedValue(undefined),
    getMediaAssetByStorageKey: vi.fn().mockResolvedValue(undefined),
    listOrphanMediaAssets: vi.fn(),
    getQuestions: vi.fn(),
    getAllContentPages: vi.fn(),
  },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/middleware/auth", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import mediaRouter from "../server/routes/media";

function makeApp() {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = { userId: "author-1" };
    next();
  });
  app.use("/api/media", mediaRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.clearAllMediaUsages.mockResolvedValue(undefined);
  storageMock.replaceMediaUsages.mockResolvedValue(undefined);
  storageMock.getMediaAssetByStorageKey.mockResolvedValue(undefined);
  storageMock.listOrphanMediaAssets.mockResolvedValue([]);
  storageMock.getQuestions.mockResolvedValue([]);
  storageMock.getAllContentPages.mockResolvedValue([]);
});

describe("POST /api/media/reindex", () => {
  it("rebuilds the index from every question and page", async () => {
    storageMock.getQuestions.mockResolvedValue([
      { id: "q1", mediaUrl: "/api/media/11111111-1111-1111-1111-111111111111" },
    ]);
    storageMock.getAllContentPages.mockResolvedValue([
      { id: "p1", settingsJson: { image: "/api/media/22222222-2222-2222-2222-222222222222" } },
    ]);

    const res = await request(makeApp()).post("/api/media/reindex");

    expect(res.status).toBe(200);
    expect(storageMock.clearAllMediaUsages).toHaveBeenCalled();
    expect(res.body.entities).toBe(2);
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("question", "q1", [
      { assetId: "11111111-1111-1111-1111-111111111111", field: "mediaUrl" },
    ]);
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("content_page", "p1", [
      { assetId: "22222222-2222-2222-2222-222222222222", field: "settingsJson.image" },
    ]);
  });

  it("reports orphans", async () => {
    storageMock.listOrphanMediaAssets.mockResolvedValue([{ id: "a1", originalName: "unused.png" }]);
    const res = await request(makeApp()).post("/api/media/reindex");
    expect(res.body.orphans).toEqual([{ id: "a1", originalName: "unused.png" }]);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- tests/media-reindex.test.ts`

Expected: FAIL — маршрут `/reindex` отсутствует, ответ `404`.

- [ ] **Step 3: Завести чтение всех контентных страниц**

`storage.getQuestions()` без аргументов уже отдаёт все вопросы, а страницы читаются только по тесту
(`getContentPages(testId)`) — для пересборки нужен обзор всей таблицы, как `getAllAssignments` у
назначений.

В `server/storage/content-pages-repository.ts` добавь метод:

```ts
  /**
   * Every content page, for the media re-sync. The other reads are test-scoped; the
   * rebuild needs the whole table, the same way `getAllAssignments` serves the home page.
   */
  async getAllContentPages(): Promise<ContentPage[]> {
    return db.select().from(contentPages);
  }
```

В `server/storage.ts` добавь в `IStorage` рядом с остальными методами контентных страниц:

```ts
  getAllContentPages(): Promise<ContentPage[]>;
```

и делегирование в `DatabaseStorage`:

```ts
  getAllContentPages(): Promise<ContentPage[]> {
    return this.contentPagesRepo.getAllContentPages();
  }
```

- [ ] **Step 4: Реализовать пересборку**

В `server/services/media/usage-index.ts` добавь в конец:

```ts
/** What a full rebuild processed. */
export interface ReindexReport {
  entities: number;
}

/**
 * Rebuilds the whole index with the SAME walker the write path uses. The safety net under
 * a write-time index: any drift (a direct SQL write, a storage point added without wiring
 * the walker in) shows up here rather than as an access refusal nobody can explain.
 */
export async function reindexAllUsages(): Promise<ReindexReport> {
  await storage.clearAllMediaUsages();
  let entities = 0;

  for (const question of await storage.getQuestions()) {
    await syncEntityUsages("question", question.id, question);
    entities += 1;
  }
  for (const page of await storage.getAllContentPages()) {
    await syncEntityUsages("content_page", page.id, page);
    entities += 1;
  }

  clearAssetAccessCache();
  return { entities };
}
```

- [ ] **Step 5: Добавить маршрут**

В `server/routes/media.ts` добавь импорты:

```ts
import { requirePermission } from "../middleware/auth";
import { reindexAllUsages } from "../services/media/usage-index";
```

и маршрут:

```ts
/**
 * POST /reindex — rebuild the usage index from scratch and report orphans. An
 * administrative operation: it reads every content entity, so it is not on any hot path.
 */
router.post("/reindex", requirePermission("media.manage"), async (_req: Request, res: Response) => {
  try {
    const report = await reindexAllUsages();
    const orphans = await storage.listOrphanMediaAssets();
    res.json({ ...report, orphans });
  } catch (error) {
    logger.error(`Media reindex failed: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to reindex media usages" });
  }
});
```

- [ ] **Step 6: Убедиться, что тест проходит**

Run: `npm test -- tests/media-reindex.test.ts`

Expected: PASS (2 теста).

- [ ] **Step 7: Коммит**

```bash
git add server/services/media/usage-index.ts server/routes/media.ts tests/media-reindex.test.ts
git commit -m "feat(media): полная пересборка индекса и отчёт о сиротах"
```

---

### Task 12: Защищённая раздача файла

**Files:**

- Modify: `server/routes/media.ts`
- Create: `tests/media-delivery-route.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создай `tests/media-delivery-route.test.ts`:

```ts
/**
 * @module tests/media-delivery-route
 * @description Delivery replaces the public static mount. Four behaviours carry the
 * design: the permission rule decides, a byte range is honoured (audio/video seeking),
 * a matching ETag answers 304, and the cache is private so a shared proxy cannot hand one
 * learner's file to another.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { Readable } from "node:stream";

const { storageMock, storeMock, accessMock } = vi.hoisted(() => ({
  storageMock: { getMediaAsset: vi.fn(), getUser: vi.fn() },
  storeMock: { openRead: vi.fn(), stat: vi.fn() },
  accessMock: { canDeliverAsset: vi.fn() },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/media/media-store", () => ({ mediaStore: storeMock }));
vi.mock("../server/services/media/asset-access", () => ({
  canDeliverAsset: accessMock.canDeliverAsset,
  clearAssetAccessCache: vi.fn(),
}));
vi.mock("../server/middleware/auth", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../server/services/access", () => ({
  getEffectiveRoles: vi.fn().mockResolvedValue(["learner"]),
}));

import mediaRouter from "../server/routes/media";

const ASSET = {
  id: "a1", checksum: "c".repeat(64), storageKey: "media/aa/bb/x.png",
  mimeType: "image/png", byteSize: 10, kind: "image", originalName: "pic.png",
  ownerId: "author-1", visibility: "shared",
};

function makeApp() {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = { userId: "learner-1" };
    next();
  });
  app.use("/api/media", mediaRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getMediaAsset.mockResolvedValue(ASSET);
  storageMock.getUser.mockResolvedValue({ id: "learner-1", status: "active" });
  storeMock.stat.mockResolvedValue({ byteSize: 10 });
  storeMock.openRead.mockImplementation(async () => Readable.from([Buffer.from("0123456789")]));
  accessMock.canDeliverAsset.mockResolvedValue(true);
});

describe("GET /api/media/:id", () => {
  it("delivers the file with a private cache and an ETag", async () => {
    const res = await request(makeApp()).get("/api/media/a1");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["cache-control"]).toContain("private");
    expect(res.headers["etag"]).toBe(`"${"c".repeat(64)}"`);
  });

  it("refuses when the rule says no", async () => {
    accessMock.canDeliverAsset.mockResolvedValue(false);
    const res = await request(makeApp()).get("/api/media/a1");
    expect(res.status).toBe(403);
  });

  it("answers 404 for an unknown id", async () => {
    storageMock.getMediaAsset.mockResolvedValue(undefined);
    const res = await request(makeApp()).get("/api/media/nope");
    expect(res.status).toBe(404);
  });

  it("refuses an anonymous request", async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as { session: Record<string, unknown> }).session = {};
      next();
    });
    app.use("/api/media", mediaRouter);
    const res = await request(app).get("/api/media/a1");
    expect(res.status).toBe(401);
  });

  it("answers 304 when the ETag matches", async () => {
    const res = await request(makeApp()).get("/api/media/a1").set("If-None-Match", `"${"c".repeat(64)}"`);
    expect(res.status).toBe(304);
  });

  it("honours a byte range", async () => {
    const res = await request(makeApp()).get("/api/media/a1").set("Range", "bytes=2-4");
    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 2-4/10");
    expect(storeMock.openRead).toHaveBeenCalledWith("media/aa/bb/x.png", { start: 2, end: 4 });
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- tests/media-delivery-route.test.ts`

Expected: FAIL — маршрут `GET /:id` отсутствует, ответ `404` вместо `200`.

- [ ] **Step 3: Реализовать раздачу**

В `server/routes/media.ts` добавь импорты:

```ts
import { getEffectiveRoles } from "../services/access";
import { canDeliverAsset } from "../services/media/asset-access";
```

и маршрут (обязательно ПОСЛЕ `/upload` и `/reindex`, иначе `:id` перехватит их):

```ts
/** Parses `bytes=<start>-<end>`; an open end runs to the last byte. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Number(m[2]) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

/**
 * GET /:id — deliver one file.
 *
 * This route is what replaced the public `/uploads` static mount, so everything the mount
 * used to do for free is done here: ranged reads (without them audio and video do not
 * seek, and Safari refuses to start a video at all), an ETag over the checksum, and a
 * PRIVATE cache — the answer depends on who is asking, and a shared cache would hand one
 * learner's file to another.
 */
router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const asset = await storage.getMediaAsset(req.params.id);
    if (!asset) return res.status(404).json({ error: "Not found" });

    const user = await storage.getUser(req.session.userId as string);
    if (!user || user.status === "inactive") return res.status(403).json({ error: "Forbidden" });
    const roles = await getEffectiveRoles(user);
    if (!(await canDeliverAsset(asset, user.id, roles))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const etag = `"${asset.checksum}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Content-Type", asset.mimeType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
    );
    if (req.headers["if-none-match"] === etag) return res.status(304).end();

    const stat = await mediaStore.stat(asset.storageKey);
    if (!stat) return res.status(404).json({ error: "Not found" });

    const range = parseRange(req.headers.range as string | undefined, stat.byteSize);
    if (range) {
      res.status(206);
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${stat.byteSize}`);
      res.setHeader("Content-Length", String(range.end - range.start + 1));
    } else {
      res.setHeader("Content-Length", String(stat.byteSize));
    }

    const stream = await mediaStore.openRead(asset.storageKey, range ?? undefined);
    // The store rejects a missing key up front, but the file can still vanish mid-read.
    // An unhandled `error` event on a piped stream takes the process down, so the socket
    // is closed instead: the headers are already sent, there is no status left to send.
    stream.on("error", (streamError) => {
      logger.error(`Media stream failed for ${asset.id}: ${(streamError as Error).message}`);
      res.destroy();
    });
    stream.pipe(res);
  } catch (error) {
    logger.error(`Media delivery failed: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to deliver media" });
  }
});
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- tests/media-delivery-route.test.ts`

Expected: PASS (6 тестов).

- [ ] **Step 5: Коммит**

```bash
git add server/routes/media.ts tests/media-delivery-route.test.ts
git commit -m "feat(media): защищённая раздача файла с диапазонами и ETag"
```

---

### Task 13: Удаление актива с отчётом «где используется»

**Files:**

- Modify: `server/routes/media.ts`
- Create: `tests/media-delete-route.test.ts`

Учти гонку, вскрытую ревью Задачи 4: между проверкой «использований нет» и самим удалением есть
окно, в котором параллельный запрос успевает записать строку индекса. Тогда `deleteAsset` упрётся в
внешний ключ и Postgres бросит `23503`, а наружу уйдёт `500` вместо ожидаемого `409`. Оберни
удаление так, чтобы нарушение внешнего ключа превращалось в тот же ответ `409`, что и штатная
проверка, — иначе редкий, но воспроизводимый случай будет выглядеть отказом сервера.

- [ ] **Step 1: Написать падающий тест**

Создай `tests/media-delete-route.test.ts`:

```ts
/**
 * @module tests/media-delete-route
 * @description Deleting a used file is refused with 409 and the list of places, mirroring
 * the PRD-15 content-guard. The physical bytes go only when the LAST registry row holding
 * that checksum goes — another author may own a row over the same content.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { storageMock, storeMock } = vi.hoisted(() => ({
  storageMock: {
    getMediaAsset: vi.fn(),
    getMediaUsagesByAsset: vi.fn(),
    deleteMediaAsset: vi.fn(),
    countMediaAssetsByChecksum: vi.fn(),
  },
  storeMock: { remove: vi.fn() },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/media/media-store", () => ({ mediaStore: storeMock }));
vi.mock("../server/middleware/auth", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../server/services/access", () => ({
  getEffectiveRoles: vi.fn().mockResolvedValue(["author"]),
}));

import mediaRouter from "../server/routes/media";

const ASSET = { id: "a1", checksum: "c".repeat(64), storageKey: "media/aa/bb/x.png", ownerId: "author-1" };

function makeApp() {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = { userId: "author-1" };
    next();
  });
  app.use("/api/media", mediaRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getMediaAsset.mockResolvedValue(ASSET);
  storageMock.getMediaUsagesByAsset.mockResolvedValue([]);
  storageMock.deleteMediaAsset.mockResolvedValue(true);
  storageMock.countMediaAssetsByChecksum.mockResolvedValue(0);
});

describe("DELETE /api/media/:id", () => {
  it("deletes an orphan and removes the bytes", async () => {
    const res = await request(makeApp()).delete("/api/media/a1");
    expect(res.status).toBe(200);
    expect(storeMock.remove).toHaveBeenCalledWith("media/aa/bb/x.png");
  });

  it("refuses a used asset with 409 and the list of places", async () => {
    storageMock.getMediaUsagesByAsset.mockResolvedValue([
      { assetId: "a1", entityType: "question", entityId: "q1", field: "mediaUrl" },
    ]);
    const res = await request(makeApp()).delete("/api/media/a1");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("media_in_use");
    expect(res.body.usages).toEqual([
      { entityType: "question", entityId: "q1", field: "mediaUrl" },
    ]);
    expect(storageMock.deleteMediaAsset).not.toHaveBeenCalled();
  });

  it("reports without deleting on a dry run", async () => {
    const res = await request(makeApp()).delete("/api/media/a1?dryRun=true");
    expect(res.status).toBe(200);
    expect(res.body.wouldDelete).toBe(true);
    expect(storageMock.deleteMediaAsset).not.toHaveBeenCalled();
  });

  it("keeps the bytes while another row holds the same checksum", async () => {
    storageMock.countMediaAssetsByChecksum.mockResolvedValue(1);
    const res = await request(makeApp()).delete("/api/media/a1");
    expect(res.status).toBe(200);
    expect(storeMock.remove).not.toHaveBeenCalled();
  });

  it("refuses a stranger", async () => {
    storageMock.getMediaAsset.mockResolvedValue({ ...ASSET, ownerId: "someone-else" });
    const res = await request(makeApp()).delete("/api/media/a1");
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- tests/media-delete-route.test.ts`

Expected: FAIL — маршрут `DELETE /:id` отсутствует, ответ `404`.

- [ ] **Step 3: Реализовать удаление**

В `server/routes/media.ts` добавь импорт:

```ts
import { isAdminOrSuper } from "../services/test-access";
```

и маршрут (до `router.get("/:id", ...)` порядок не важен — методы разные):

```ts
/**
 * DELETE /:id — remove an asset.
 *
 * Refused with `409` while anything uses it, listing where, exactly as the PRD-15
 * content-guard refuses to delete content a test depends on. A published snapshot counts
 * as a usage: an issued version must not lose its picture after the fact.
 *
 * The PHYSICAL file goes only when no other registry row holds the same checksum — dedup
 * means another author may own a row over the same bytes.
 */
router.delete("/:id", requirePermission("media.manage"), async (req: Request, res: Response) => {
  try {
    const asset = await storage.getMediaAsset(req.params.id);
    if (!asset) return res.status(404).json({ error: "Not found" });

    const roles = req.effectiveRoles ?? [];
    const isOwner = !!asset.ownerId && asset.ownerId === req.session.userId;
    if (!isOwner && !isAdminOrSuper(roles)) return res.status(403).json({ error: "Forbidden" });

    const usages = await storage.getMediaUsagesByAsset(asset.id);
    if (usages.length > 0) {
      return res.status(409).json({
        error: "media_in_use",
        message: "Файл используется и не может быть удалён",
        usages: usages.map((u) => ({ entityType: u.entityType, entityId: u.entityId, field: u.field })),
      });
    }

    if (req.query.dryRun === "true") return res.json({ wouldDelete: true, usages: [] });

    await storage.deleteMediaAsset(asset.id);
    // Reference counting on the physical layer: the bytes are shared across owners.
    if ((await storage.countMediaAssetsByChecksum(asset.checksum)) === 0) {
      await mediaStore.remove(asset.storageKey);
    }
    res.json({ deleted: true });
  } catch (error) {
    logger.error(`Media delete failed: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to delete media" });
  }
});
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npm test -- tests/media-delete-route.test.ts`

Expected: PASS (5 тестов).

- [ ] **Step 5: Коммит**

```bash
git add server/routes/media.ts tests/media-delete-route.test.ts
git commit -m "feat(media): удаление актива с отчётом «где используется»"
```

---

### Task 14: Выключение статики и легаси-алиас

**Files:**

- Modify: `server/routes.ts:81`
- Modify: `server/routes/media.ts`
- Create: `tests/media-legacy-alias.test.ts`
- Modify: `docs/superpowers/specs/2026-08-01-media-library-design.md`

Это задача с наибольшим риском: выключение статики ломает тихо — автор увидит битую картинку, а не
ошибку. Поэтому легаси-адрес обслуживается тем же маршрутом, а тест закрепляет это поведение.

- [ ] **Step 1: Написать падающий тест**

Создай `tests/media-legacy-alias.test.ts`:

```ts
/**
 * @module tests/media-legacy-alias
 * @description After the static mount is gone, addresses stored before the registry must
 * still resolve — through the registry, by storage key, with the permission rule applied.
 * Without this the switch-off breaks silently: a broken picture, not an error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { Readable } from "node:stream";

const { storageMock, storeMock, accessMock } = vi.hoisted(() => ({
  storageMock: { getMediaAssetByStorageKey: vi.fn(), getUser: vi.fn() },
  storeMock: { openRead: vi.fn(), stat: vi.fn() },
  accessMock: { canDeliverAsset: vi.fn() },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/media/media-store", () => ({ mediaStore: storeMock }));
vi.mock("../server/services/media/asset-access", () => ({
  canDeliverAsset: accessMock.canDeliverAsset,
  clearAssetAccessCache: vi.fn(),
}));
vi.mock("../server/middleware/auth", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../server/services/access", () => ({
  getEffectiveRoles: vi.fn().mockResolvedValue(["author"]),
}));

import { legacyUploadsAlias } from "../server/routes/media";

const ASSET = {
  id: "a1", checksum: "c".repeat(64), storageKey: "media/1717_old.png",
  mimeType: "image/png", byteSize: 3, originalName: "1717_old.png",
  ownerId: null, visibility: "shared",
};

function makeApp() {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = { userId: "author-1" };
    next();
  });
  app.use("/uploads", legacyUploadsAlias);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getMediaAssetByStorageKey.mockResolvedValue(ASSET);
  storageMock.getUser.mockResolvedValue({ id: "author-1", status: "active" });
  storeMock.stat.mockResolvedValue({ byteSize: 3 });
  storeMock.openRead.mockImplementation(async () => Readable.from([Buffer.from("abc")]));
  accessMock.canDeliverAsset.mockResolvedValue(true);
});

describe("legacy /uploads/media alias", () => {
  it("resolves a pre-registry address through the registry", async () => {
    const res = await request(makeApp()).get("/uploads/media/1717_old.png");
    expect(res.status).toBe(200);
    expect(storageMock.getMediaAssetByStorageKey).toHaveBeenCalledWith("media/1717_old.png");
  });

  it("applies the permission rule to the legacy address too", async () => {
    accessMock.canDeliverAsset.mockResolvedValue(false);
    const res = await request(makeApp()).get("/uploads/media/1717_old.png");
    expect(res.status).toBe(403);
  });

  it("answers 404 for a file that was never indexed", async () => {
    storageMock.getMediaAssetByStorageKey.mockResolvedValue(undefined);
    const res = await request(makeApp()).get("/uploads/media/ghost.png");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- tests/media-legacy-alias.test.ts`

Expected: FAIL — `legacyUploadsAlias` не экспортируется из `server/routes/media`.

- [ ] **Step 3: Вынести отдачу в общую функцию и добавить алиас**

В `server/routes/media.ts` вынеси тело `GET /:id` (всё после разрешения актива) в функцию, чтобы алиас не
дублировал заголовки и работу с диапазонами:

```ts
/** Sends one resolved asset: permission rule, headers, range, body. */
async function deliverAsset(req: Request, res: Response, asset: MediaAsset): Promise<void> {
  const user = await storage.getUser(req.session.userId as string);
  if (!user || user.status === "inactive") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const roles = await getEffectiveRoles(user);
  if (!(await canDeliverAsset(asset, user.id, roles))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const etag = `"${asset.checksum}"`;
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("Content-Type", asset.mimeType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
  );
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }

  const stat = await mediaStore.stat(asset.storageKey);
  if (!stat) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const range = parseRange(req.headers.range as string | undefined, stat.byteSize);
  if (range) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${stat.byteSize}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
  } else {
    res.setHeader("Content-Length", String(stat.byteSize));
  }

  const stream = await mediaStore.openRead(asset.storageKey, range ?? undefined);
  // The store rejects a missing key up front, but the file can still vanish mid-read.
  // An unhandled `error` event on a piped stream takes the process down, so the socket
  // is closed instead: the headers are already sent, there is no status left to send.
  stream.on("error", (streamError) => {
    logger.error(`Media stream failed for ${asset.id}: ${(streamError as Error).message}`);
    res.destroy();
  });
  stream.pipe(res);
}
```

Замени тело `router.get("/:id", ...)` на:

```ts
router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const asset = await storage.getMediaAsset(req.params.id);
    if (!asset) return res.status(404).json({ error: "Not found" });
    await deliverAsset(req, res, asset);
  } catch (error) {
    logger.error(`Media delivery failed: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to deliver media" });
  }
});
```

Добавь импорт типа и экспорт алиаса в конец файла:

```ts
import type { MediaAsset } from "@shared/schema";
```

```ts
/**
 * The compatibility mount for addresses stored before the registry existed. The static
 * `/uploads` mount is gone, so without this the switch-off breaks silently — a broken
 * picture in the editor, not an error anyone would notice. Resolution goes through the
 * storage key the backfill wrote, and the SAME permission rule applies: the legacy shape
 * of an address must not be a way around it.
 */
export const legacyUploadsAlias = Router();

legacyUploadsAlias.get(/^\/media\/.+$/, requireAuth, async (req: Request, res: Response) => {
  try {
    const storageKey = `media/${req.path.replace(/^\/media\//, "")}`;
    const asset = await storage.getMediaAssetByStorageKey(storageKey);
    if (!asset) return res.status(404).json({ error: "Not found" });
    await deliverAsset(req, res, asset);
  } catch (error) {
    logger.error(`Legacy media delivery failed: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to deliver media" });
  }
});
```

- [ ] **Step 4: Выключить статику**

В `server/routes.ts` замени строку 81:

```ts
  app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));
```

на:

```ts
  // Медиатека: раздача идёт маршрутом с проверкой прав, публичной статики больше нет.
  // Адреса, сохранённые до реестра, обслуживает совместимостный алиас.
  app.use("/uploads", legacyUploadsAlias);
```

и добавь импорт вверху файла:

```ts
import { legacyUploadsAlias } from "./routes/media";
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test -- tests/media-legacy-alias.test.ts tests/media-delivery-route.test.ts`

Expected: PASS (9 тестов).

Run: `npm run check`

Expected: без ошибок.

- [ ] **Step 6: Проверить область ссылки-приглашения**

Guard областей полицирует только `/api/*`, поэтому алиас `/uploads/*` под него не попадает и защищён
собственным правилом. Убедись, что существующий тест guard'а по-прежнему зелёный:

Run: `npm test -- tests/magic-scope-guard.test.ts`

Expected: PASS.

- [ ] **Step 7: Ручная проверка в браузере**

Подними второй экземпляр, чтобы не мешать чужой сессии: `PORT=8099 npm run dev`.

Проверь по списку:

1. открой карточку вопроса с картинкой в редакторе — изображение видно;
2. открой то же в приватном окне без входа — запрос `/api/media/<id>` отвечает `401`;
3. пройди тест учеником — картинки вопросов видны;
4. вопрос с аудио — перемотка работает;
5. открой `Инструменты разработчика -> Сеть`, повтори загрузку страницы — второй запрос картинки
   отвечает `304`.

- [ ] **Step 8: Обновить спецификацию**

В `docs/superpowers/specs/2026-08-01-media-library-design.md` в §11 поменяй местами Э2 и Э3 и добавь
строку о выключении статики отдельным шагом, чтобы документ соответствовал реализованному порядку.
Проверь:

Run: `npm run lint:md`

Expected: без замечаний.

- [ ] **Step 9: Коммит**

```bash
git add server/routes.ts server/routes/media.ts tests/media-legacy-alias.test.ts docs/superpowers/specs/2026-08-01-media-library-design.md
git commit -m "feat(media): выключение публичной статики uploads и совместимостный алиас"
```

---

### Task 15: Канонизация легаси-адресов при сохранении

**Files:**

- Modify: `server/services/media/media-refs.ts`
- Modify: `server/services/media/usage-index.ts`
- Modify: `server/routes/questions.ts`
- Create: `tests/media-canonicalize.test.ts`

Закрывает пункт 3 §5 спецификации. Массовой перезаписи JSON не будет: адрес приводится к каноническому
виду тем же обходчиком, который и так вызывается при сохранении. Наследие вымывается по мере
редактирования контента, а не одной рискованной миграцией по чужим структурам.

Задача независима от Задачи 14 и может выполняться сразу после Задачи 9.

- [ ] **Step 1: Написать падающий тест**

Создай `tests/media-canonicalize.test.ts`:

```ts
/**
 * @module tests/media-canonicalize
 * @description Legacy addresses are rewritten to the canonical form on save, so the
 * pre-registry shape drains out of content by editing rather than by one mass migration.
 * An address that resolves to nothing is left ALONE: silently blanking a picture the
 * author still sees in the editor would be worse than leaving a stale string.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: { getMediaAssetByStorageKey: vi.fn() },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

import { rewriteMediaRefs } from "../server/services/media/media-refs";
import { canonicalizeEntityMedia } from "../server/services/media/usage-index";

beforeEach(() => vi.clearAllMocks());

describe("rewriteMediaRefs", () => {
  it("replaces values the mapping resolves and keeps the rest", () => {
    const out = rewriteMediaRefs(
      { a: "/uploads/media/old.png", b: "https://example.com/x.png", c: 42 },
      (ref) => (ref.kind === "legacy" ? "/api/media/new-id" : null),
    );
    expect(out).toEqual({ a: "/api/media/new-id", b: "https://example.com/x.png", c: 42 });
  });

  it("walks arrays and nested objects", () => {
    const out = rewriteMediaRefs(
      { data: { options: [{ image: "/uploads/media/old.png" }] } },
      () => "/api/media/new-id",
    );
    expect(out).toEqual({ data: { options: [{ image: "/api/media/new-id" }] } });
  });
});

describe("canonicalizeEntityMedia", () => {
  it("rewrites a resolvable legacy address", async () => {
    storageMock.getMediaAssetByStorageKey.mockResolvedValue({ id: "asset-7" });
    const out = await canonicalizeEntityMedia({ mediaUrl: "/uploads/media/old.png" });
    expect(out).toEqual({ mediaUrl: "/api/media/asset-7" });
  });

  it("leaves an unresolvable legacy address untouched", async () => {
    storageMock.getMediaAssetByStorageKey.mockResolvedValue(undefined);
    const out = await canonicalizeEntityMedia({ mediaUrl: "/uploads/media/ghost.png" });
    expect(out).toEqual({ mediaUrl: "/uploads/media/ghost.png" });
  });

  it("leaves an already canonical address untouched", async () => {
    const entity = { mediaUrl: "/api/media/11111111-1111-1111-1111-111111111111" };
    expect(await canonicalizeEntityMedia(entity)).toEqual(entity);
    expect(storageMock.getMediaAssetByStorageKey).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -- tests/media-canonicalize.test.ts`

Expected: FAIL — `rewriteMediaRefs` не экспортируется.

- [ ] **Step 3: Добавить чистую перезапись**

В конец `server/services/media/media-refs.ts` добавь:

```ts
/**
 * Returns a copy of `entity` with every recognised media reference replaced by whatever
 * `mapping` returns for it. A `null` from the mapping leaves the value as it stands —
 * blanking an address that resolves to nothing would erase a picture the author still
 * sees, which is worse than carrying a stale string.
 */
export function rewriteMediaRefs(
  entity: unknown,
  mapping: (ref: MediaRef) => string | null,
): unknown {
  if (typeof entity === "string") {
    const ref = parseMediaRef(entity);
    if (!ref) return entity;
    return mapping(ref) ?? entity;
  }
  if (Array.isArray(entity)) return entity.map((item) => rewriteMediaRefs(item, mapping));
  if (entity && typeof entity === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entity as Record<string, unknown>)) {
      out[key] = rewriteMediaRefs(value, mapping);
    }
    return out;
  }
  return entity;
}
```

- [ ] **Step 4: Добавить асинхронную обёртку**

В конец `server/services/media/usage-index.ts` добавь:

```ts
/**
 * Rewrites pre-registry addresses inside an entity to the canonical `/api/media/<id>`
 * (spec §5). Called on the SAVE path, before the entity is persisted: this is what drains
 * the legacy shape out of content gradually, instead of one mass migration across JSON
 * documents the media library does not own.
 */
export async function canonicalizeEntityMedia<T>(entity: T): Promise<T> {
  const legacyKeys = collectMediaRefs(entity)
    .map((f) => f.ref)
    .filter((ref): ref is { kind: "legacy"; storageKey: string } => ref.kind === "legacy")
    .map((ref) => ref.storageKey);
  if (legacyKeys.length === 0) return entity;

  const resolved = new Map<string, string>();
  for (const key of new Set(legacyKeys)) {
    const asset = await storage.getMediaAssetByStorageKey(key);
    if (asset) resolved.set(key, asset.id);
  }
  if (resolved.size === 0) return entity;

  return rewriteMediaRefs(entity, (ref) => {
    if (ref.kind !== "legacy") return null;
    const id = resolved.get(ref.storageKey);
    return id ? `/api/media/${id}` : null;
  }) as T;
}
```

и расширь импорт обходчика:

```ts
import { collectMediaRefs, rewriteMediaRefs } from "./media-refs";
```

- [ ] **Step 5: Убедиться, что тест проходит**

Run: `npm test -- tests/media-canonicalize.test.ts`

Expected: PASS (5 тестов).

- [ ] **Step 6: Вызвать канонизацию перед сохранением вопроса**

В `server/routes/questions.ts` расширь импорт:

```ts
import { syncEntityUsages, canonicalizeEntityMedia } from "../services/media/usage-index";
```

В обработчиках `POST /` и `PUT /:id` пропусти проверенную схемой полезную нагрузку через канонизацию
ДО записи в хранилище (порядок важен: индекс из Задачи 10 пишется уже по каноническому виду):

```ts
    // Медиатека §5: пре-реестровый адрес приводится к каноническому в момент правки —
    // так наследие вымывается редактированием, а не миграцией по чужим JSON.
    const payload = await canonicalizeEntityMedia(validated);
```

и передай `payload` вместо прежней переменной в вызов создания/обновления.

- [ ] **Step 7: Проверить, что маршруты вопросов не сломались**

Run: `npm test -- tests/routes.questions-order-index.test.ts`

Expected: PASS. Если падает на отсутствующем моке `getMediaAssetByStorageKey`, добавь его в мок
хранилища этого файла со значением `undefined`.

Run: `npm run check`

Expected: без ошибок.

- [ ] **Step 8: Коммит**

```bash
git add server/services/media/media-refs.ts server/services/media/usage-index.ts server/routes/questions.ts tests/media-canonicalize.test.ts
git commit -m "feat(media): канонизация легаси-адресов при сохранении контента"
```

---

## Проверка ядра целиком

После Задачи 14 прогони точечно все тесты медиатеки одной командой:

```bash
npm test -- tests/media-schema.test.ts tests/media-permissions.test.ts tests/media-store.test.ts tests/media-refs.test.ts tests/media-usage-index.test.ts tests/media-asset-access.test.ts tests/media-upload-route.test.ts tests/media-backfill.test.ts tests/media-usage-on-question-save.test.ts tests/media-reindex.test.ts tests/media-delivery-route.test.ts tests/media-delete-route.test.ts tests/media-legacy-alias.test.ts tests/media-canonicalize.test.ts
```

Expected: PASS, 57 тестов (в задачах 1 и 3 добавлены кейсы по итогам ревью).

Плюс интеграционный тест репозитория отдельной конфигурацией:

```bash
npm run test:it -- tests/it/media-repository.it.test.ts
```

Expected: PASS, 4 теста.

Полный `npm test` запускай **только по явному разрешению владельца репозитория** — в одной рабочей копии
работают несколько сессий.

## Что остаётся за пределами этого плана

| Этап | Почему отдельным планом |
| --- | --- |
| Э4 — упаковщик SCORM, отчёт, неизменяемость актива | Требует пройденной Задачи 14: упаковщик резолвит идентификатор через реестр |
| Э5 — экран медиатеки | Правило проекта: эскиз в `docs/wireframes/approved/` до React |
| Э6 — вложения обратной связи (PRD-32) | Своя предметная область: дескрипторы вложений, `scormHref`, снимки |
