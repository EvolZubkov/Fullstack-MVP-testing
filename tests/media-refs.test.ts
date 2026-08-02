/**
 * @module tests/media-refs
 * @description The ONE walker that finds media references inside an entity. It feeds
 * both the write-time index and the full re-sync, so the two can never disagree. It
 * recognises the canonical address and the legacy one, and reports a dotted path so the
 * «где используется» report can say where exactly.
 */
import { describe, it, expect } from "vitest";
import { parseMediaRef, collectMediaRefs, findMediaRefsInText } from "../server/services/media/media-refs";

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

  it("finds media embedded in an html field", () => {
    const page = {
      title: "Инструкция",
      bodyHtml: '<p>Схема:</p><img src="/uploads/media/scheme.png">',
    };
    expect(collectMediaRefs(page)).toEqual([
      { field: "bodyHtml", ref: { kind: "legacy", storageKey: "media/scheme.png" } },
    ]);
  });
});

describe("findMediaRefsInText", () => {
  it("finds an address inside markup", () => {
    expect(findMediaRefsInText('<p><img src="/uploads/media/pic.png" alt="x"></p>')).toEqual([
      { kind: "legacy", storageKey: "media/pic.png" },
    ]);
  });

  it("returns several references in order of appearance", () => {
    const html =
      '<img src="/api/media/11111111-1111-1111-1111-111111111111">' +
      '<img src="/uploads/media/second.png">';
    expect(findMediaRefsInText(html)).toEqual([
      { kind: "canonical", id: "11111111-1111-1111-1111-111111111111" },
      { kind: "legacy", storageKey: "media/second.png" },
    ]);
  });

  it("reports one reference once even when it repeats", () => {
    const html = '<img src="/uploads/media/same.png"><img src="/uploads/media/same.png">';
    expect(findMediaRefsInText(html)).toHaveLength(1);
  });

  it("finds an address inside an absolute URL to our own host", () => {
    expect(findMediaRefsInText("https://lms.example.com/api/media/22222222-2222-2222-2222-222222222222")).toEqual([
      { kind: "canonical", id: "22222222-2222-2222-2222-222222222222" },
    ]);
  });

  it("stops the legacy key at the quote, not at the end of the markup", () => {
    expect(findMediaRefsInText('<img src="/uploads/media/a.png"><b>tail</b>')).toEqual([
      { kind: "legacy", storageKey: "media/a.png" },
    ]);
  });
});
