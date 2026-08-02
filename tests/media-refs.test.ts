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
