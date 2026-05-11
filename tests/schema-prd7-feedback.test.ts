/**
 * @module schema-prd7-feedback
 * @description Tests for PRD-7 feedback Zod schemas: feedbackFormatSchema,
 * feedbackLinkSchema, feedbackAssetSchema, feedbackContentSchema.
 *
 * Covers (decisions.md §3.4, §3.5, §4.3):
 *   - All required fields are enforced.
 *   - `format` enum is restricted to plain | richText | html.
 *   - `links` and `assets` arrays default to `[]` when missing.
 *   - `feedbackAsset.mimeType` is fixed to "application/pdf".
 *   - `feedbackAsset.scormHref` and `feedbackAsset.id` are optional.
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

  it("rejects non-pdf mimeType (FR-37: PDF only)", () => {
    expect(() => feedbackAssetSchema.parse({ ...valid, mimeType: "image/png" })).toThrow();
  });

  it("rejects empty fileName", () => {
    expect(() => feedbackAssetSchema.parse({ ...valid, fileName: "" })).toThrow();
  });
});

// ─── feedbackContentSchema ───────────────────────────────────────────────────

describe("feedbackContentSchema", () => {
  it("accepts the canonical empty default (decisions.md §4.3)", () => {
    const empty = { format: "plain" as const, text: "", links: [], assets: [] };
    expect(feedbackContentSchema.parse(empty)).toEqual(empty);
  });

  it("defaults missing links/assets to empty arrays", () => {
    const result = feedbackContentSchema.parse({ format: "plain", text: "hi" });
    expect(result.links).toEqual([]);
    expect(result.assets).toEqual([]);
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
