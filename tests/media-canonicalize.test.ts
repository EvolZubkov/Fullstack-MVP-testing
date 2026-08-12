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
