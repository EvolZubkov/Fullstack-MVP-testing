// @vitest-environment node
/**
 * @module tests/storage/content-pages-repository.test
 * @description DAL coverage for {@link module:server/storage/content-pages-repository}
 * against a real (pglite) database, driven THROUGH the `DatabaseStorage` facade so
 * the delegation in `server/storage.ts` is exercised alongside the repository. The
 * repository is a thin data-access layer — mocking drizzle would assert query shape,
 * not behaviour — so these specs run the actual SQL through the in-process Postgres
 * harness. Runs in the `node` environment (per-file override) so pglite works under
 * the otherwise-jsdom unit run, and because it lives under `tests/` (not `tests/it/`)
 * its coverage counts toward the reported total.
 *
 * Harness caveat: pglite does NOT populate `result.rowCount` for a DELETE/UPDATE
 * without RETURNING; the repository's DELETE uses `.returning()`, so the boolean
 * result is reliable here, but reads are still asserted as the observable effect.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createHarness, type Harness } from "../it/db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { DatabaseStorage } from "../../server/storage";
// eslint-disable-next-line import/first
import { tests, topics, type InsertContentPage } from "@shared/schema";

let storage: DatabaseStorage;

beforeAll(async () => {
  h.current = await createHarness();
  storage = new DatabaseStorage();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
});

/** Insert a minimal parent `tests` row directly (content_pages.test_id FK). */
async function insertTest(): Promise<string> {
  const id = randomUUID();
  await h.current!.db.insert(tests).values({
    id,
    title: "T",
    overallPassRuleJson: {},
  } as never);
  return id;
}

/** Insert a minimal parent `topics` row directly (content_pages.topic_id FK). */
async function insertTopic(): Promise<string> {
  const id = randomUUID();
  await h.current!.db.insert(topics).values({ id, name: "Topic" } as never);
  return id;
}

/** Build a minimal content-page insert bound to `testId` (notNull cols only). */
function pageInput(
  testId: string,
  overrides: Partial<InsertContentPage> = {},
): InsertContentPage {
  return {
    testId,
    position: "before",
    type: "intro",
    kind: "intro",
    ...overrides,
  } as InsertContentPage;
}

describe("ContentPagesRepository — create & read", () => {
  it("createContentPage persists a row with schema defaults and returns it", async () => {
    const testId = await insertTest();
    const created = await storage.createContentPage(pageInput(testId));

    // Generated id + audit stamps.
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);
    // Column defaults applied by the DB.
    expect(created.mode).toBe("template");
    expect(created.sortOrder).toBe(0);
    expect(created.valuesJson).toEqual({});
    expect(created.autoAdvance).toBe(false);
    expect(created.topicId).toBeNull();
    // Provided notNull values round-trip.
    expect(created.position).toBe("before");
    expect(created.type).toBe("intro");
    expect(created.kind).toBe("intro");
  });

  it("createContentPage stores explicit non-default values (topic-scoped page)", async () => {
    const testId = await insertTest();
    const topicId = await insertTopic();
    const created = await storage.createContentPage(
      pageInput(testId, {
        topicId,
        position: "before_topic",
        mode: "html",
        kind: "info",
        type: "html",
        templateKey: "tpl-x",
        sortOrder: 7,
        valuesJson: { values: { a: 1 } },
        autoAdvance: true,
        autoAdvanceDelayMs: 1500,
      }),
    );

    expect(created.topicId).toBe(topicId);
    expect(created.mode).toBe("html");
    expect(created.templateKey).toBe("tpl-x");
    expect(created.sortOrder).toBe(7);
    expect(created.valuesJson).toEqual({ values: { a: 1 } });
    expect(created.autoAdvance).toBe(true);
    expect(created.autoAdvanceDelayMs).toBe(1500);
  });

  it("getContentPage returns the stored row by id", async () => {
    const testId = await insertTest();
    const created = await storage.createContentPage(pageInput(testId));
    const fetched = await storage.getContentPage(created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.testId).toBe(testId);
  });

  it("getContentPage returns undefined for an unknown id (empty branch)", async () => {
    expect(await storage.getContentPage(randomUUID())).toBeUndefined();
  });
});

describe("ContentPagesRepository — getContentPages", () => {
  it("returns an empty list for a test with no pages", async () => {
    const testId = await insertTest();
    expect(await storage.getContentPages(testId)).toEqual([]);
  });

  it("returns only the test's own pages, ordered by (topicId, position, sortOrder)", async () => {
    const testId = await insertTest();
    const otherId = await insertTest();

    // Same test, all topic-less: order by position ("after" < "before"), then sortOrder.
    const pA = await storage.createContentPage(pageInput(testId, { position: "before", sortOrder: 2 }));
    const pB = await storage.createContentPage(pageInput(testId, { position: "before", sortOrder: 1 }));
    const pC = await storage.createContentPage(pageInput(testId, { position: "after", sortOrder: 5 }));
    // Belongs to a different test — must be excluded.
    await storage.createContentPage(pageInput(otherId, { position: "before" }));

    const pages = await storage.getContentPages(testId);
    expect(pages.map((p) => p.id)).toEqual([pC.id, pB.id, pA.id]);
  });
});

describe("ContentPagesRepository — update", () => {
  it("updateContentPage applies changes, stamps updatedAt and returns the row", async () => {
    const testId = await insertTest();
    const created = await storage.createContentPage(pageInput(testId, { sortOrder: 1 }));

    const updated = await storage.updateContentPage(created.id, {
      sortOrder: 9,
      templateKey: "changed",
      valuesJson: { values: { b: 2 } },
    });

    expect(updated).toBeDefined();
    expect(updated!.sortOrder).toBe(9);
    expect(updated!.templateKey).toBe("changed");
    expect(updated!.valuesJson).toEqual({ values: { b: 2 } });
    // updatedAt is re-stamped by the repository (`new Date()`); assert its type
    // only — pglite stores timestamps without tz, so a numeric comparison against
    // the DB-side createdAt (now()) is skewed by the offset and not meaningful.
    expect(updated!.updatedAt).toBeInstanceOf(Date);

    // Persisted, not just returned.
    const reread = await storage.getContentPage(created.id);
    expect(reread!.sortOrder).toBe(9);
    expect(reread!.templateKey).toBe("changed");
  });

  it("updateContentPage returns undefined for an unknown id (no-row branch)", async () => {
    expect(
      await storage.updateContentPage(randomUUID(), { sortOrder: 3 }),
    ).toBeUndefined();
  });
});

describe("ContentPagesRepository — delete", () => {
  it("deleteContentPage removes the row and returns true", async () => {
    const testId = await insertTest();
    const created = await storage.createContentPage(pageInput(testId));

    expect(await storage.deleteContentPage(created.id)).toBe(true);
    expect(await storage.getContentPage(created.id)).toBeUndefined();
  });

  it("deleteContentPage returns false for an unknown id (empty returning branch)", async () => {
    expect(await storage.deleteContentPage(randomUUID())).toBe(false);
  });
});

describe("ContentPagesRepository — reorderContentPages", () => {
  it("renumbers a batch of pages in one transaction", async () => {
    const testId = await insertTest();
    const p1 = await storage.createContentPage(pageInput(testId, { sortOrder: 0 }));
    const p2 = await storage.createContentPage(pageInput(testId, { sortOrder: 0 }));
    const p3 = await storage.createContentPage(pageInput(testId, { sortOrder: 0 }));

    await storage.reorderContentPages([
      { id: p1.id, sortOrder: 30 },
      { id: p2.id, sortOrder: 10 },
      { id: p3.id, sortOrder: 20 },
    ]);

    expect((await storage.getContentPage(p1.id))!.sortOrder).toBe(30);
    expect((await storage.getContentPage(p2.id))!.sortOrder).toBe(10);
    expect((await storage.getContentPage(p3.id))!.sortOrder).toBe(20);
    // Renumber is observable through the ordered read as well.
    const ordered = await storage.getContentPages(testId);
    expect(ordered.map((p) => p.id)).toEqual([p2.id, p3.id, p1.id]);
  });

  it("with an empty batch is a no-op (loop-skipped transaction)", async () => {
    const testId = await insertTest();
    const created = await storage.createContentPage(pageInput(testId, { sortOrder: 4 }));

    await expect(storage.reorderContentPages([])).resolves.toBeUndefined();
    expect((await storage.getContentPage(created.id))!.sortOrder).toBe(4);
  });
});
