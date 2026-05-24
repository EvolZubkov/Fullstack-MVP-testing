/**
 * @module tests/services/variant-binding
 * @description Unit tests for PRD-1 §4.3.2 / PRD-7 §1.4 silent variant binding.
 * Covers: 1-variant silent bind, N-variant default selection (isDefault priority
 * then first-in-list), 0-variant fallback to the default template, and the
 * hard-failure case where even the default template lacks the requested kind.
 */
import { describe, it, expect } from "vitest";
import type { TemplateManifest, VariantKind } from "../../shared/schema";
import {
  findVariantsByKind,
  selectDefaultVariant,
  bindSystemVariant,
} from "../../server/services/variant-binding";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function manifest(
  id: string,
  contentTemplates: Array<{ key: string; kind: VariantKind; isDefault?: boolean; label?: string }>,
): TemplateManifest {
  return {
    id,
    name: `Template ${id}`,
    version: "1.0.0",
    templateApiVersion: "1.0",
    contentTemplates: contentTemplates.map((ct) => ({
      label: ct.label ?? `Label ${ct.key}`,
      ...ct,
    })),
  } as unknown as TemplateManifest;
}

// ─── findVariantsByKind ───────────────────────────────────────────────────────

describe("findVariantsByKind", () => {
  it("returns entries of the requested kind in declared order", () => {
    const m = manifest("t", [
      { key: "intro.a", kind: "intro" },
      { key: "info.x",  kind: "info" },
      { key: "intro.b", kind: "intro" },
    ]);
    expect(findVariantsByKind(m, "intro").map((v) => v.key)).toEqual(["intro.a", "intro.b"]);
  });

  it("returns empty array when no entry of the kind exists", () => {
    const m = manifest("t", [{ key: "intro.a", kind: "intro" }]);
    expect(findVariantsByKind(m, "router")).toEqual([]);
  });
});

// ─── selectDefaultVariant ─────────────────────────────────────────────────────

describe("selectDefaultVariant", () => {
  it("returns the entry with isDefault: true when present", () => {
    const picked = selectDefaultVariant([
      { key: "a", label: "A", kind: "intro" },
      { key: "b", label: "B", kind: "intro", isDefault: true },
      { key: "c", label: "C", kind: "intro" },
    ]);
    expect(picked?.key).toBe("b");
  });

  it("returns the first entry when no isDefault is set", () => {
    const picked = selectDefaultVariant([
      { key: "a", label: "A", kind: "intro" },
      { key: "b", label: "B", kind: "intro" },
    ]);
    expect(picked?.key).toBe("a");
  });

  it("returns null on empty input", () => {
    expect(selectDefaultVariant([])).toBeNull();
  });

  it("ignores isDefault: false", () => {
    const picked = selectDefaultVariant([
      { key: "a", label: "A", kind: "intro", isDefault: false },
      { key: "b", label: "B", kind: "intro" },
    ]);
    expect(picked?.key).toBe("a");
  });
});

// ─── bindSystemVariant ────────────────────────────────────────────────────────

describe("bindSystemVariant", () => {
  const defaultMan = manifest("default", [
    { key: "question.standard", kind: "questions", isDefault: true },
    { key: "intro.simple",      kind: "intro" },
    { key: "info.text",         kind: "info" },
    { key: "summary.text",      kind: "summary" },
    // intentionally no `router` variant in default
  ]);

  it("1 variant in template → silent bind, source=template, no hint flags", () => {
    const t = manifest("t", [{ key: "intro.only", kind: "intro" }]);
    expect(bindSystemVariant(t, defaultMan, "intro")).toEqual({
      variantKey: "intro.only",
      source: "template",
      hasMultipleChoices: false,
      fallbackUsed: false,
    });
  });

  it("N variants in template → bind isDefault, hasMultipleChoices=true", () => {
    const t = manifest("t", [
      { key: "intro.a", kind: "intro" },
      { key: "intro.b", kind: "intro", isDefault: true },
      { key: "intro.c", kind: "intro" },
    ]);
    expect(bindSystemVariant(t, defaultMan, "intro")).toEqual({
      variantKey: "intro.b",
      source: "template",
      hasMultipleChoices: true,
      fallbackUsed: false,
    });
  });

  it("N variants without isDefault → bind first, hasMultipleChoices=true", () => {
    const t = manifest("t", [
      { key: "intro.a", kind: "intro" },
      { key: "intro.b", kind: "intro" },
    ]);
    const r = bindSystemVariant(t, defaultMan, "intro");
    expect(r?.variantKey).toBe("intro.a");
    expect(r?.hasMultipleChoices).toBe(true);
    expect(r?.fallbackUsed).toBe(false);
    expect(r?.source).toBe("template");
  });

  it("0 variants in template → fallback to default template, fallbackUsed=true", () => {
    const t = manifest("t", [{ key: "intro.simple", kind: "intro" }]); // no `summary`
    expect(bindSystemVariant(t, defaultMan, "summary")).toEqual({
      variantKey: "summary.text",
      source: "default-fallback",
      hasMultipleChoices: false,
      fallbackUsed: true,
    });
  });

  it("0 in template AND 0 in default → null (hard config error)", () => {
    const t = manifest("t", [{ key: "intro.x", kind: "intro" }]);
    // default also lacks `router`
    expect(bindSystemVariant(t, defaultMan, "router")).toBeNull();
  });

  it("fallback path is never marked hasMultipleChoices, even if default has N", () => {
    const defaultManMultiSummary = manifest("default", [
      { key: "question.standard", kind: "questions" },
      { key: "summary.a", kind: "summary", isDefault: true },
      { key: "summary.b", kind: "summary" },
    ]);
    const t = manifest("t", [{ key: "intro.x", kind: "intro" }]); // no summary
    const r = bindSystemVariant(t, defaultManMultiSummary, "summary");
    // Fallback picks isDefault from default's variants, but does NOT expose
    // hasMultipleChoices: the author of the test cannot pick between fallback
    // variants without changing the template anyway.
    expect(r?.variantKey).toBe("summary.a");
    expect(r?.source).toBe("default-fallback");
    expect(r?.hasMultipleChoices).toBe(false);
    expect(r?.fallbackUsed).toBe(true);
  });

  it("works for `questions` kind (system variant, no page-row UI)", () => {
    const t = manifest("t", [{ key: "q.x", kind: "questions" }]);
    expect(bindSystemVariant(t, defaultMan, "questions")?.variantKey).toBe("q.x");
  });
});
