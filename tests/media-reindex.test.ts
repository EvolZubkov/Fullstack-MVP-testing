/**
 * @module tests/media-reindex
 * @description The full re-sync is the safety net under the write-time index: it uses the
 * SAME walker, so a drift shows up as a difference rather than as silently refused access.
 * It also produces the orphan list. Coverage spans every entity the write path indexes —
 * questions, content pages, and test design settings (PRD media-library Task 10b) — because
 * a rebuild that "heals" two entities while dropping the third would itself become a new
 * source of drift.
 *
 * Also covers the non-destructive shape of the rebuild (no more clear-then-repopulate): every
 * live entity is re-synced BEFORE any row is dropped, and the drop is scoped per entity type
 * to exactly the ids NOT re-read at that point — see `reindexAllUsages` in
 * `server/services/media/usage-index.ts` for the full reasoning, including the concurrent-save
 * race a naive "keep the ids collected during the walk" cleanup would reintroduce.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    replaceMediaUsages: vi.fn().mockResolvedValue(undefined),
    deleteMediaUsagesExcept: vi.fn().mockResolvedValue(undefined),
    getMediaAssetByStorageKey: vi.fn().mockResolvedValue(undefined),
    listOrphanMediaAssets: vi.fn(),
    getQuestions: vi.fn(),
    getAllContentPages: vi.fn(),
    getTests: vi.fn(),
    getAllSnapshots: vi.fn(),
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
  storageMock.replaceMediaUsages.mockResolvedValue(undefined);
  storageMock.deleteMediaUsagesExcept.mockResolvedValue(undefined);
  storageMock.getMediaAssetByStorageKey.mockResolvedValue(undefined);
  storageMock.listOrphanMediaAssets.mockResolvedValue([]);
  storageMock.getQuestions.mockResolvedValue([]);
  storageMock.getAllContentPages.mockResolvedValue([]);
  storageMock.getTests.mockResolvedValue([]);
  storageMock.getAllSnapshots.mockResolvedValue([]);
});

describe("POST /api/media/reindex", () => {
  it("rebuilds the index from every question, page, test design and snapshot", async () => {
    storageMock.getQuestions.mockResolvedValue([
      { id: "q1", mediaUrl: "/api/media/11111111-1111-1111-1111-111111111111" },
    ]);
    storageMock.getAllContentPages.mockResolvedValue([
      { id: "p1", settingsJson: { image: "/api/media/22222222-2222-2222-2222-222222222222" } },
    ]);
    storageMock.getTests.mockResolvedValue([
      {
        id: "t1",
        designSettingsJson: { startImageUrl: "/api/media/33333333-3333-3333-3333-333333333333" },
      },
    ]);
    storageMock.getAllSnapshots.mockResolvedValue([
      {
        id: "snap-1",
        contentJson: { cover: "/api/media/44444444-4444-4444-4444-444444444444" },
      },
    ]);

    const res = await request(makeApp()).post("/api/media/reindex");

    expect(res.status).toBe(200);
    expect(res.body.entities).toBe(4);
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("question", "q1", [
      { assetId: "11111111-1111-1111-1111-111111111111", field: "mediaUrl" },
    ]);
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("content_page", "p1", [
      { assetId: "22222222-2222-2222-2222-222222222222", field: "settingsJson.image" },
    ]);
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("test_design", "t1", [
      { assetId: "33333333-3333-3333-3333-333333333333", field: "startImageUrl" },
    ]);
    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("snapshot", "snap-1", [
      { assetId: "44444444-4444-4444-4444-444444444444", field: "cover" },
    ]);
    // Cleanup step: each entity type's stale-row drop keeps exactly the ids that
    // still exist for that type — one call per type, not a global wipe.
    expect(storageMock.deleteMediaUsagesExcept).toHaveBeenCalledWith("question", ["q1"]);
    expect(storageMock.deleteMediaUsagesExcept).toHaveBeenCalledWith("content_page", ["p1"]);
    expect(storageMock.deleteMediaUsagesExcept).toHaveBeenCalledWith("test_design", ["t1"]);
    expect(storageMock.deleteMediaUsagesExcept).toHaveBeenCalledWith("snapshot", ["snap-1"]);
  });

  it("never wipes the index up front — there is no clear-all step in the rebuild", async () => {
    // The old shape called `storage.clearAllMediaUsages()` before repopulating; that
    // method (and the facade delegation to it) is gone. `storageMock` deliberately does
    // NOT stub it, so a stray call would throw and this request would come back 500.
    storageMock.getQuestions.mockResolvedValue([
      { id: "q1", mediaUrl: "/api/media/11111111-1111-1111-1111-111111111111" },
    ]);
    const res = await request(makeApp()).post("/api/media/reindex");
    expect(res.status).toBe(200);
    expect((storageMock as Record<string, unknown>).clearAllMediaUsages).toBeUndefined();
  });

  it("re-syncs every live entity BEFORE dropping any stale row — the index is never emptied mid-rebuild", async () => {
    const calls: string[] = [];
    storageMock.replaceMediaUsages.mockImplementation(async () => {
      calls.push("replaceMediaUsages");
    });
    storageMock.deleteMediaUsagesExcept.mockImplementation(async () => {
      calls.push("deleteMediaUsagesExcept");
    });
    storageMock.getQuestions.mockResolvedValue([
      { id: "q1", mediaUrl: "/api/media/11111111-1111-1111-1111-111111111111" },
    ]);
    storageMock.getAllContentPages.mockResolvedValue([{ id: "p1" }]);

    await request(makeApp()).post("/api/media/reindex");

    // Every replaceMediaUsages call happened before the first deleteMediaUsagesExcept —
    // no window where a live entity's rows have already been dropped but not yet
    // rewritten (which a clear-then-repopulate shape would open for the duration of
    // the whole walk).
    const lastReplace = calls.lastIndexOf("replaceMediaUsages");
    const firstDelete = calls.indexOf("deleteMediaUsagesExcept");
    expect(lastReplace).toBeGreaterThanOrEqual(0);
    expect(firstDelete).toBeGreaterThan(lastReplace);
  });

  it("drops a stale question's rows when the question is gone but keeps a live one's", async () => {
    // Simulates the topic-delete-cascade gap this task closes: `q-gone` still has an
    // index row (the cascade bypassed the write-time cleanup) but no longer exists,
    // while `q-live` is a real, currently-existing question.
    storageMock.getQuestions.mockResolvedValue([
      { id: "q-live", mediaUrl: "/api/media/11111111-1111-1111-1111-111111111111" },
    ]);

    await request(makeApp()).post("/api/media/reindex");

    // `q-gone` is simply absent from the keep list — deleteMediaUsagesExcept (a real
    // repository method, exercised against pglite in tests/it/media-repository.it.test.ts)
    // is what actually drops its rows; here we assert the keep list this call site hands
    // it is exactly the set of entities still known to exist.
    expect(storageMock.deleteMediaUsagesExcept).toHaveBeenCalledWith("question", ["q-live"]);
  });

  it("indexes the design settings object, not the whole test row", async () => {
    // A field that lives on the test row but NOT inside designSettingsJson must not be
    // walked under `test_design` — that would double-count it with whatever entity owns
    // the test row itself and desync from the write path in PUT /:id/design, which indexes
    // `designSettings` only.
    storageMock.getTests.mockResolvedValue([
      {
        id: "t1",
        designSettingsJson: {},
        someUnrelatedMediaUrl: "/api/media/44444444-4444-4444-4444-444444444444",
      },
    ]);

    await request(makeApp()).post("/api/media/reindex");

    expect(storageMock.replaceMediaUsages).toHaveBeenCalledWith("test_design", "t1", []);
  });

  it("reports orphans", async () => {
    storageMock.listOrphanMediaAssets.mockResolvedValue([{ id: "a1", originalName: "unused.png" }]);
    const res = await request(makeApp()).post("/api/media/reindex");
    expect(res.body.orphans).toEqual([{ id: "a1", originalName: "unused.png" }]);
  });

  it("queries orphans only after the index has been repopulated", async () => {
    // The orphan report must reflect the FRESH index, not the moment right after the
    // wipe — otherwise every asset looks orphaned regardless of real usage.
    const calls: string[] = [];
    storageMock.replaceMediaUsages.mockImplementation(async () => {
      calls.push("replaceMediaUsages");
    });
    storageMock.listOrphanMediaAssets.mockImplementation(async () => {
      calls.push("listOrphanMediaAssets");
      return [];
    });
    storageMock.getQuestions.mockResolvedValue([
      { id: "q1", mediaUrl: "/api/media/11111111-1111-1111-1111-111111111111" },
    ]);

    await request(makeApp()).post("/api/media/reindex");

    expect(calls.indexOf("listOrphanMediaAssets")).toBeGreaterThan(calls.indexOf("replaceMediaUsages"));
  });
});
