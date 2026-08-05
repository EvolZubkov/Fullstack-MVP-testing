/**
 * @module schema-prd7-feedback
 * @description Tests for PRD-7 feedback Zod schemas: feedbackFormatSchema,
 * feedbackLinkSchema, feedbackAssetSchema, feedbackContentSchema.
 *
 * Covers (decisions.md §3.4, §3.5, §4.3; PRD-42 §4):
 *   - All required fields are enforced.
 *   - `format` enum is restricted to plain | richText | html.
 *   - `links` and `assets` arrays default to `[]` when missing.
 *   - `feedbackAsset.mimeType`, when present, is fixed to "application/pdf".
 *   - `feedbackAsset.id`, `fileName`, `mimeType` and `scormHref` are all optional
 *     (PRD-42: a material is title + URL; the rest is legacy-only).
 */
import { describe, it, expect } from "vitest";
import {
  feedbackFormatSchema,
  feedbackLinkSchema,
  feedbackAssetSchema,
  feedbackContentSchema,
} from "../shared/schema";

// ─── feedbackFormatSchema ────────────────────────────────────────────────────

describe("feedbackFormatSchema", () => {
  it.each(["plain", "richText", "html"] as const)("accepts %s", (value) => {
    expect(() => feedbackFormatSchema.parse(value)).not.toThrow();
  });

  it("rejects unknown values", () => {
    expect(() => feedbackFormatSchema.parse("markdown")).toThrow();
  });
});

// ─── feedbackLinkSchema ──────────────────────────────────────────────────────

describe("feedbackLinkSchema", () => {
  it("accepts a valid link", () => {
    expect(() =>
      feedbackLinkSchema.parse({ title: "Docs", url: "https://example.com/docs" }),
    ).not.toThrow();
  });

  it("rejects empty title", () => {
    expect(() => feedbackLinkSchema.parse({ title: "", url: "https://example.com" })).toThrow();
  });

  it("rejects malformed URL", () => {
    expect(() => feedbackLinkSchema.parse({ title: "T", url: "not a url" })).toThrow();
  });
});

// ─── feedbackAssetSchema ─────────────────────────────────────────────────────

describe("feedbackAssetSchema", () => {
  const valid = {
    id: "asset-1",
    title: "Cert",
    fileName: "cert.pdf",
    mimeType: "application/pdf" as const,
    scormHref: "feedback/cert.pdf",
  };

  it("accepts a fully populated asset", () => {
    expect(() => feedbackAssetSchema.parse(valid)).not.toThrow();
  });

  it("accepts asset without id and scormHref (frontend draft)", () => {
    const { id: _id, scormHref: _scormHref, ...rest } = valid;
    expect(() => feedbackAssetSchema.parse(rest)).not.toThrow();
  });

  it("rejects non-pdf mimeType when mimeType is present (FR-37: PDF only)", () => {
    expect(() => feedbackAssetSchema.parse({ ...valid, mimeType: "image/png" })).toThrow();
  });

  it("accepts a material with only title and url — no file at all (PRD-42)", () => {
    expect(() =>
      feedbackAssetSchema.parse({ title: "Чек-лист", url: "https://example.com/checklist" }),
    ).not.toThrow();
  });

  it("accepts a legacy descriptor whose url is the relative media-library address (PRD-42 §7)", () => {
    const legacy = feedbackAssetSchema.parse({ title: "Памятка", url: "/api/media/asset-1" });
    expect(legacy.url).toBe("/api/media/asset-1");
  });
});

// ─── feedbackContentSchema ───────────────────────────────────────────────────

describe("feedbackContentSchema", () => {
  it("accepts the canonical empty default (decisions.md §4.3)", () => {
    const empty = { format: "plain" as const, text: "", links: [], assets: [], events: [] };
    expect(feedbackContentSchema.parse(empty)).toEqual(empty);
  });

  it("defaults missing links/assets/events to empty arrays", () => {
    const result = feedbackContentSchema.parse({ format: "plain", text: "hi" });
    expect(result.links).toEqual([]);
    expect(result.assets).toEqual([]);
    expect(result.events).toEqual([]);
  });

  // TD-02: recommended events — URL is OPTIONAL (unlike course links).
  it("accepts an event with a URL, without a URL, and with an empty URL", () => {
    const r = feedbackContentSchema.parse({
      format: "plain",
      text: "",
      events: [
        { title: "Вебинар", url: "https://example.com/webinar" },
        { title: "Очная встреча" },
        { title: "День открытых дверей", url: "" },
      ],
    });
    expect(r.events).toHaveLength(3);
    expect(r.events[1].url).toBeUndefined();
    expect(r.events[2].url).toBe("");
  });

  it("rejects an event with a non-empty invalid URL", () => {
    expect(() =>
      feedbackContentSchema.parse({
        format: "plain",
        text: "",
        events: [{ title: "X", url: "not-a-url" }],
      }),
    ).toThrow();
  });

  it("accepts full structure with nested links and assets", () => {
    const value = {
      format: "richText" as const,
      text: "Well done",
      links: [{ title: "Next", url: "https://example.com/next" }],
      assets: [{ title: "Cert", fileName: "cert.pdf", mimeType: "application/pdf" as const }],
    };
    expect(() => feedbackContentSchema.parse(value)).not.toThrow();
  });

  it("rejects missing format", () => {
    expect(() => feedbackContentSchema.parse({ text: "x" })).toThrow();
  });

  it("rejects unknown format", () => {
    expect(() => feedbackContentSchema.parse({ format: "markdown", text: "" })).toThrow();
  });
});
