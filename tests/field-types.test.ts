/**
 * @module tests/field-types
 * @description PRD-22: the closed registry of field types a template may declare
 * (`shared/template/field-types`) and its enforcement by the structural validator
 * (`collectFieldTypeIssues`). Pure: no DB, no template execution.
 *
 * The defect these tests lock down: before the registry, a placeholder type was
 * `z.unknown()` in the manifest schema, so a typo (`richtext`) passed validation
 * and silently degraded to a single-line input, with no diagnostic anywhere.
 */
import { describe, it, expect } from "vitest";
import {
  PLACEHOLDER_TYPES,
  SETTING_TYPES,
  isPlaceholderType,
  isSettingType,
  inputModesFor,
  validateVariantFields,
} from "@shared/template/field-types";
import { collectFieldTypeIssues } from "../server/services/template-validation";
import { contentTemplateEntrySchema } from "@shared/schema";

describe("field-type registry", () => {
  it("content types cover exactly what the renderer can draw", () => {
    expect([...PLACEHOLDER_TYPES]).toEqual([
      "text",
      "textarea",
      "richText",
      "html",
      "image",
      "resultField",
    ]);
  });

  it("setting types carry the page properties, including the sequence identifier", () => {
    expect([...SETTING_TYPES]).toEqual(["number", "boolean", "select", "text", "image", "sequence"]);
  });

  it("a type is recognised only in its own list", () => {
    expect(isPlaceholderType("richText")).toBe(true);
    // `number` moved to settings — it is a property, not content.
    expect(isPlaceholderType("number")).toBe(false);
    expect(isSettingType("number")).toBe(true);
    expect(isSettingType("resultField")).toBe(false);
  });

  it("rejects the casing typo that used to pass silently", () => {
    expect(isPlaceholderType("richtext")).toBe(false);
  });
});

describe("input modes — the declared type is the ceiling (FR-32)", () => {
  it("html offers all three modes, richText two, plain types one", () => {
    expect([...inputModesFor("html")]).toEqual(["plain", "rich", "html"]);
    expect([...inputModesFor("richText")]).toEqual(["plain", "rich"]);
    expect([...inputModesFor("text")]).toEqual(["plain"]);
    expect([...inputModesFor("textarea")]).toEqual(["plain"]);
  });

  it("types that take no free-form author input offer no modes", () => {
    expect([...inputModesFor("image")]).toEqual([]);
    expect([...inputModesFor("resultField")]).toEqual([]);
  });
});

describe("validateVariantFields", () => {
  it("accepts a variant declaring both lists correctly", () => {
    expect(
      validateVariantFields({
        placeholders: [{ key: "body", type: "richText" }],
        settings: [{ key: "sequenceId", type: "sequence" }],
      }),
    ).toEqual([]);
  });

  it("names the offending field and its list", () => {
    const issues = validateVariantFields({
      placeholders: [{ key: "subheader", type: "richtext" }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].list).toBe("placeholders");
    expect(issues[0].field).toBe("subheader");
    expect(issues[0].message).toContain("richtext");
  });

  it("falls back to a positional label when the declaration has no key", () => {
    const issues = validateVariantFields({ placeholders: [{ type: "nope" }] });
    expect(issues[0].field).toBe("#1");
  });

  it("rejects select without choices — the case that rendered an empty dropdown", () => {
    const issues = validateVariantFields({ settings: [{ key: "align", type: "select" }] });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("options");

    expect(
      validateVariantFields({ settings: [{ key: "align", type: "select", options: ["left"] }] }),
    ).toEqual([]);
  });

  it("absent lists are valid — both are optional", () => {
    expect(validateVariantFields({})).toEqual([]);
  });

  it("a non-array list is reported rather than ignored", () => {
    const issues = validateVariantFields({ placeholders: { key: "body" } });
    expect(issues).toHaveLength(1);
    expect(issues[0].list).toBe("placeholders");
  });
});

describe("manifest schema", () => {
  const variant = { key: "info.text", label: "Информация", kind: "info" as const };

  it("passes template-specific attributes through untouched", () => {
    const parsed = contentTemplateEntrySchema.safeParse({
      ...variant,
      placeholders: [{ key: "body", type: "richText", textFit: { mode: "growBox" } }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown placeholder type at schema level", () => {
    const parsed = contentTemplateEntrySchema.safeParse({
      ...variant,
      placeholders: [{ key: "body", type: "richtext" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts settings with a default value and required flag", () => {
    const parsed = contentTemplateEntrySchema.safeParse({
      ...variant,
      settings: [
        { key: "nextLabel", type: "text", label: "Подпись кнопки", default: "Далее" },
        { key: "backgroundImage", type: "image", required: true },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("collectFieldTypeIssues — manifest level (FR-12)", () => {
  it("reports variant key and field key so the author can find it", () => {
    const issues = collectFieldTypeIssues({
      contentTemplates: [
        { key: "gallery.card", placeholders: [{ key: "subheader", type: "richtext" }] },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("FIELD_TYPE_UNKNOWN");
    expect(issues[0].message).toContain("gallery.card");
    expect(issues[0].message).toContain("subheader");
    expect(issues[0].ref).toBe("contentTemplates.gallery.card.placeholders.subheader");
  });

  it("labels a keyless variant by position", () => {
    const issues = collectFieldTypeIssues({
      contentTemplates: [{ placeholders: [{ key: "body", type: "nope" }] }],
    });
    expect(issues[0].message).toContain("#1");
  });

  it("a manifest without contentTemplates yields no issues", () => {
    expect(collectFieldTypeIssues({})).toEqual([]);
    expect(collectFieldTypeIssues({ contentTemplates: "nope" })).toEqual([]);
  });

  it("clean manifests pass", () => {
    expect(
      collectFieldTypeIssues({
        contentTemplates: [
          {
            key: "info.text",
            placeholders: [{ key: "title", type: "text" }],
            settings: [{ key: "sequenceId", type: "sequence" }],
          },
        ],
      }),
    ).toEqual([]);
  });
});
