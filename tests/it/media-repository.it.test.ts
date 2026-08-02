/**
 * @module tests/it/media-repository
 * @description Registry queries against a real schema: dedup lookup is scoped to the
 * owner (two authors with identical bytes get two rows), and usage rows for one entity
 * are replaced wholesale on re-sync.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { MediaRepository } from "../../server/storage/media-repository";

let repo: MediaRepository;

beforeAll(async () => {
  h.current = await createHarness();
  repo = new MediaRepository();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
});

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
