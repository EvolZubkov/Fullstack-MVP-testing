/**
 * @module schema-prd1
 * Tests for PRD-1 schema additions: designSettingsSchema, contentPageValuesSchema,
 * insertTemplateSchema, insertContentPageSchema.
 *
 * Covers:
 * - Zod constraint equivalents (required fields, enum values, numeric ranges)
 * - JSON serialization/deserialization round-trips for design_settings_json and values_json
 */
import { describe, it, expect } from "vitest";
import {
  designSettingsSchema,
  contentPageValuesSchema,
  insertTemplateSchema,
  insertContentPageSchema,
} from "../shared/schema";

// ─── designSettingsSchema ─────────────────────────────────────────────────────

describe("designSettingsSchema", () => {
  const valid = {
    templateId: "corporate",
    templateVersion: "1.0.0",
    templateApiVersion: "1.0",
    params: { "brand.primaryColor": "#0066cc", "progress.mode": "questions" },
  };

  it("accepts a fully populated object", () => {
    expect(() => designSettingsSchema.parse(valid)).not.toThrow();
  });

  it("accepts empty params object", () => {
    expect(() => designSettingsSchema.parse({ ...valid, params: {} })).not.toThrow();
  });

  it("rejects missing templateId", () => {
    const { templateId: _, ...rest } = valid;
    expect(() => designSettingsSchema.parse(rest)).toThrow();
  });

  it("rejects missing templateVersion", () => {
    const { templateVersion: _, ...rest } = valid;
    expect(() => designSettingsSchema.parse(rest)).toThrow();
  });

  it("rejects missing templateApiVersion", () => {
    const { templateApiVersion: _, ...rest } = valid;
    expect(() => designSettingsSchema.parse(rest)).toThrow();
  });

  it("rejects missing params", () => {
    const { params: _, ...rest } = valid;
    expect(() => designSettingsSchema.parse(rest)).toThrow();
  });

  it("round-trips through JSON serialization", () => {
    const serialized = JSON.stringify(valid);
    const parsed = designSettingsSchema.parse(JSON.parse(serialized));
    expect(parsed).toEqual(valid);
  });

  it("params preserves arbitrary nested values after round-trip", () => {
    const input = { ...valid, params: { nested: { a: 1, b: [true, "x"] } } };
    const parsed = designSettingsSchema.parse(JSON.parse(JSON.stringify(input)));
    expect(parsed.params).toEqual(input.params);
  });
});

// ─── contentPageValuesSchema ──────────────────────────────────────────────────

describe("contentPageValuesSchema", () => {
  const valid = {
    values: { title: "Введение", subtitle: "Добро пожаловать" },
    placeholderStyles: { subtitle: { fontSize: 18 } },
  };

  it("accepts a fully populated object", () => {
    expect(() => contentPageValuesSchema.parse(valid)).not.toThrow();
  });

  it("accepts object without placeholderStyles", () => {
    expect(() => contentPageValuesSchema.parse({ values: valid.values })).not.toThrow();
  });

  it("accepts empty values object", () => {
    expect(() => contentPageValuesSchema.parse({ values: {} })).not.toThrow();
  });

  it("applies default empty values when values is omitted", () => {
    const result = contentPageValuesSchema.parse({});
    expect(result.values).toEqual({});
  });

  it("rejects placeholderStyles with non-numeric fontSize", () => {
    expect(() =>
      contentPageValuesSchema.parse({
        values: {},
        placeholderStyles: { title: { fontSize: "large" as any } },
      })
    ).toThrow();
  });

  it("round-trips through JSON serialization", () => {
    const serialized = JSON.stringify(valid);
    const parsed = contentPageValuesSchema.parse(JSON.parse(serialized));
    expect(parsed).toEqual(valid);
  });

  it("values preserves arbitrary types (richText, arrays) after round-trip", () => {
    const input = { values: { body: "<p>Text</p>", tags: ["a", "b"], count: 3 } };
    const parsed = contentPageValuesSchema.parse(JSON.parse(JSON.stringify(input)));
    expect(parsed.values).toEqual(input.values);
  });
});

// ─── insertTemplateSchema ─────────────────────────────────────────────────────

describe("insertTemplateSchema", () => {
  const valid = {
    id: "corporate",
    name: "Корпоративный",
    version: "1.0.0",
    templateApiVersion: "1.0",
    isBuiltin: true,
    isActive: true,
    manifest: { params: [], contentTemplates: [] },
  };

  it("accepts a valid template record", () => {
    expect(() => insertTemplateSchema.parse(valid)).not.toThrow();
  });

  it("accepts optional description and previewPath as undefined", () => {
    expect(() =>
      insertTemplateSchema.parse({ ...valid, description: undefined, previewPath: undefined })
    ).not.toThrow();
  });

  it("rejects missing id", () => {
    const { id: _, ...rest } = valid;
    expect(() => insertTemplateSchema.parse(rest)).toThrow();
  });

  it("rejects missing name", () => {
    const { name: _, ...rest } = valid;
    expect(() => insertTemplateSchema.parse(rest)).toThrow();
  });

  it("rejects missing version", () => {
    const { version: _, ...rest } = valid;
    expect(() => insertTemplateSchema.parse(rest)).toThrow();
  });

  it("rejects missing manifest", () => {
    const { manifest: _, ...rest } = valid;
    expect(() => insertTemplateSchema.parse(rest)).toThrow();
  });
});

// ─── insertContentPageSchema ──────────────────────────────────────────────────

describe("insertContentPageSchema", () => {
  const valid = {
    testId: "test-uuid-1234",
    topicId: "topic-uuid-5678",
    position: "before_topic" as const,
    mode: "template" as const,
    type: "intro" as const,
    sortOrder: 0,
    valuesJson: { values: { title: "Intro" } },
    autoAdvance: false,
  };

  it("accepts a valid content page record", () => {
    expect(() => insertContentPageSchema.parse(valid)).not.toThrow();
  });

  it("rejects invalid position value", () => {
    expect(() =>
      insertContentPageSchema.parse({ ...valid, position: "inside_topic" as any })
    ).toThrow();
  });

  it("rejects invalid mode value", () => {
    expect(() =>
      insertContentPageSchema.parse({ ...valid, mode: "custom" as any })
    ).toThrow();
  });

  it("rejects invalid type value", () => {
    expect(() =>
      insertContentPageSchema.parse({ ...valid, type: "video" as any })
    ).toThrow();
  });

  it("rejects missing testId", () => {
    const { testId: _, ...rest } = valid;
    expect(() => insertContentPageSchema.parse(rest)).toThrow();
  });

  it("accepts missing topicId (PRD-7 §4.2: nullable for test-scope start pages)", () => {
    const { topicId: _, ...rest } = valid;
    expect(() => insertContentPageSchema.parse(rest)).not.toThrow();
  });

  it("accepts all valid position values", () => {
    for (const pos of ["before_topic", "after_topic"] as const) {
      expect(() => insertContentPageSchema.parse({ ...valid, position: pos })).not.toThrow();
    }
  });

  it("accepts all valid mode values", () => {
    for (const mode of ["template", "standard", "html"] as const) {
      expect(() => insertContentPageSchema.parse({ ...valid, mode })).not.toThrow();
    }
  });

  it("accepts all valid type values", () => {
    for (const type of ["intro", "info", "summary", "html"] as const) {
      expect(() => insertContentPageSchema.parse({ ...valid, type })).not.toThrow();
    }
  });

  it("autoAdvanceDelayMs accepts value within 3000-120000 range", () => {
    expect(() =>
      insertContentPageSchema.parse({ ...valid, autoAdvance: true, autoAdvanceDelayMs: 5000 })
    ).not.toThrow();
  });
});
