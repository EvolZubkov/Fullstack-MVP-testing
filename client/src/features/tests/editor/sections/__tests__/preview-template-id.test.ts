/**
 * @module features/tests/editor/sections/__tests__/preview-template-id.test
 * @description Unit tests for `previewTemplateId` — the page-preview must render
 * from `default` exactly when the active template declares no contentTemplate of
 * the page's kind (PRD-7 G21), so the preview matches the «Из стандартного
 * шаблона» badge in «Структура».
 */
import { describe, it, expect } from "vitest";
import { previewTemplateId } from "../start-pages-section";

const cp = (kinds: string[]) => ({ contentTemplates: kinds.map((kind) => ({ kind })) });

describe("previewTemplateId", () => {
  it("returns the active template id when it owns a variant of the kind", () => {
    expect(previewTemplateId(cp(["start", "intro"]), "my-template", { kind: "start" })).toBe(
      "my-template",
    );
  });

  it("falls back to `default` when the active template declares no variant of the kind", () => {
    // my-template ships a start LAYOUT but no `kind:"start"` contentTemplate →
    // variant-binding bound start to default → preview must use default too.
    expect(previewTemplateId(cp(["intro", "questions"]), "my-template", { kind: "start" })).toBe(
      "default",
    );
  });

  it("falls back to `default` for a page with no kind", () => {
    expect(previewTemplateId(cp(["start"]), "my-template", { kind: null })).toBe("default");
    expect(previewTemplateId(cp(["start"]), "my-template", {})).toBe("default");
  });

  it("returns the (undefined) active id when it owns the kind but no draft id is set", () => {
    expect(previewTemplateId(cp(["start"]), undefined, { kind: "start" })).toBeUndefined();
  });
});
