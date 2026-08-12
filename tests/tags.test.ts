/**
 * @module tests/tags
 * @description Unit tests for the PRD-11 §3a tag normalization helpers
 * (shared/tags.ts): the free-form-label-with-normalization naming rules —
 * spaces allowed, trim/collapse on save, case-insensitive dedup/match, 50-char
 * cap.
 */
import { describe, it, expect } from "vitest";
import { normalizeTag, normalizeTags, tagKey, TAG_MAX_LENGTH } from "../shared/tags";

describe("normalizeTag", () => {
  it("trims ends and collapses internal whitespace runs to one space", () => {
    expect(normalizeTag("  Анализ   рисков ")).toBe("Анализ рисков");
    expect(normalizeTag("a\t\nb")).toBe("a b");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeTag("   ")).toBe("");
  });

  it("preserves casing", () => {
    expect(normalizeTag("Финансы")).toBe("Финансы");
  });
});

describe("tagKey", () => {
  it("is the normalized form lower-cased (case-insensitive match key)", () => {
    expect(tagKey("Финансы")).toBe(tagKey(" финансы "));
    expect(tagKey("Базовые Понятия")).toBe("базовые понятия");
  });
});

describe("normalizeTags", () => {
  it("drops empties and dedups case-insensitively, first form wins", () => {
    expect(normalizeTags(["Финансы", " финансы ", "", "  ", "Прочее"])).toEqual([
      "Финансы",
      "Прочее",
    ]);
  });

  it("collapses internal whitespace per tag", () => {
    expect(normalizeTags(["Анализ   рисков"])).toEqual(["Анализ рисков"]);
  });

  it("caps each tag at TAG_MAX_LENGTH", () => {
    const long = "x".repeat(TAG_MAX_LENGTH + 10);
    const [out] = normalizeTags([long]);
    expect(out.length).toBe(TAG_MAX_LENGTH);
  });

  it("ignores non-string entries defensively", () => {
    expect(normalizeTags(["ok", 42 as unknown as string, null as unknown as string])).toEqual(["ok"]);
  });
});
