/**
 * @module tests/manifest-variant-kind
 * @description Unit tests for the PRD-1 §4.3 `variant.kind` contract:
 * VariantKind enum, contentTemplate entry shape, and the default-template
 * refinement that requires at least one `kind: "questions"` variant.
 *
 * Covers both the zod schema (shared/schema.ts) and the server-side gatekeeper
 * `validateManifest()` used by syncBuiltinTemplates() in template-registry.ts.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  variantKindSchema,
  contentTemplateEntrySchema,
  templateManifestSchema,
  defaultTemplateManifestSchema,
} from "../shared/schema";
import { validateManifest } from "../server/template-registry";

const TEMPLATES_DIR = path.resolve(process.cwd(), "server", "scorm", "templates");
const BUILTIN_IDS = ["default", "corporate", "minimal"] as const;

function loadManifest(id: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, id, "manifest.json"), "utf-8"));
}

// ─── VariantKind enum ─────────────────────────────────────────────────────────

describe("variantKindSchema", () => {
  it.each(["questions", "router", "summary", "intro", "info"] as const)(
    "accepts %s",
    (kind) => {
      expect(variantKindSchema.safeParse(kind).success).toBe(true);
    },
  );

  it.each(["content.intro", "html", "", "QUESTIONS", null, undefined])(
    "rejects %s",
    (bad) => {
      expect(variantKindSchema.safeParse(bad).success).toBe(false);
    },
  );
});

// ─── contentTemplateEntrySchema ───────────────────────────────────────────────

describe("contentTemplateEntrySchema", () => {
  it("accepts a minimal entry with kind", () => {
    expect(contentTemplateEntrySchema.safeParse({
      key: "intro.simple",
      label: "Введение",
      kind: "intro",
    }).success).toBe(true);
  });

  it("preserves legacy fields via passthrough (pageKind, placeholders, isDefault)", () => {
    const parsed = contentTemplateEntrySchema.parse({
      key: "info.text",
      label: "Информация",
      kind: "info",
      pageKind: "content.info",
      isDefault: true,
      placeholders: [{ key: "title", type: "text" }],
      somethingExtra: "kept",
    });
    expect(parsed.pageKind).toBe("content.info");
    expect(parsed.isDefault).toBe(true);
    expect((parsed as Record<string, unknown>).somethingExtra).toBe("kept");
  });

  it("rejects entry without kind", () => {
    expect(contentTemplateEntrySchema.safeParse({
      key: "x",
      label: "X",
    }).success).toBe(false);
  });

  it("rejects entry with unknown kind", () => {
    expect(contentTemplateEntrySchema.safeParse({
      key: "x",
      label: "X",
      kind: "metric",
    }).success).toBe(false);
  });

  it("rejects empty key or label", () => {
    expect(contentTemplateEntrySchema.safeParse({
      key: "",
      label: "X",
      kind: "info",
    }).success).toBe(false);
    expect(contentTemplateEntrySchema.safeParse({
      key: "x",
      label: "",
      kind: "info",
    }).success).toBe(false);
  });
});

// ─── templateManifestSchema (any built-in) ────────────────────────────────────

describe("templateManifestSchema", () => {
  it("accepts a manifest with at least one valid contentTemplate", () => {
    expect(templateManifestSchema.safeParse({
      id: "minimal-fake",
      name: "Fake",
      version: "1.0.0",
      templateApiVersion: "1.0",
      contentTemplates: [{ key: "intro.x", label: "Intro", kind: "intro" }],
    }).success).toBe(true);
  });

  it("rejects manifest with empty contentTemplates", () => {
    expect(templateManifestSchema.safeParse({
      id: "fake",
      name: "Fake",
      version: "1.0.0",
      templateApiVersion: "1.0",
      contentTemplates: [],
    }).success).toBe(false);
  });

  it("rejects bad version format", () => {
    expect(templateManifestSchema.safeParse({
      id: "fake",
      name: "Fake",
      version: "1.x",
      templateApiVersion: "1.0",
      contentTemplates: [{ key: "x", label: "X", kind: "info" }],
    }).success).toBe(false);
  });
});

// ─── defaultTemplateManifestSchema refinement ────────────────────────────────

describe("defaultTemplateManifestSchema", () => {
  const baseDefault = {
    id: "default",
    name: "Стандартный",
    version: "1.0.0",
    templateApiVersion: "1.0",
  };

  it("accepts manifest with kind:questions variant present", () => {
    expect(defaultTemplateManifestSchema.safeParse({
      ...baseDefault,
      contentTemplates: [
        { key: "question.standard", label: "Q", kind: "questions" },
        { key: "intro.simple", label: "Intro", kind: "intro" },
      ],
    }).success).toBe(true);
  });

  it("rejects manifest without any kind:questions variant", () => {
    const result = defaultTemplateManifestSchema.safeParse({
      ...baseDefault,
      contentTemplates: [
        { key: "intro.simple", label: "Intro", kind: "intro" },
        { key: "info.text", label: "Info", kind: "info" },
        { key: "summary.text", label: "Summary", kind: "summary" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" ");
      expect(messages).toMatch(/kind: "questions"/);
    }
  });
});

// ─── validateManifest gatekeeper ──────────────────────────────────────────────

describe("validateManifest", () => {
  it("returns null for a valid default-template manifest with questions variant", () => {
    expect(validateManifest(
      {
        id: "default",
        name: "Default",
        version: "1.0.0",
        templateApiVersion: "1.0",
        contentTemplates: [
          { key: "q.s", label: "Q", kind: "questions" },
          { key: "i.s", label: "I", kind: "intro" },
        ],
      },
      "default",
    )).toBeNull();
  });

  it("rejects default-template manifest without questions variant", () => {
    const reason = validateManifest(
      {
        id: "default",
        name: "Default",
        version: "1.0.0",
        templateApiVersion: "1.0",
        contentTemplates: [{ key: "i", label: "I", kind: "intro" }],
      },
      "default",
    );
    expect(reason).not.toBeNull();
    expect(reason!).toMatch(/kind: "questions"/);
  });

  it("allows non-default templates to omit the questions variant", () => {
    expect(validateManifest(
      {
        id: "minimal",
        name: "Min",
        version: "1.0.0",
        templateApiVersion: "1.0",
        contentTemplates: [{ key: "i", label: "I", kind: "intro" }],
      },
      "minimal",
    )).toBeNull();
  });

  it("rejects manifest with malformed kind regardless of template id", () => {
    expect(validateManifest(
      {
        id: "minimal",
        name: "Min",
        version: "1.0.0",
        templateApiVersion: "1.0",
        contentTemplates: [{ key: "x", label: "X", kind: "qstn" }],
      },
      "minimal",
    )).not.toBeNull();
  });
});

// ─── Real built-in manifests parse and validate ───────────────────────────────

describe("built-in manifests parse and validate", () => {
  for (const id of BUILTIN_IDS) {
    it(`${id} passes validateManifest()`, () => {
      const m = loadManifest(id);
      expect(validateManifest(m, id)).toBeNull();
    });

    it(`${id} declares kind on every contentTemplate entry`, () => {
      const m = loadManifest(id);
      const cts = m.contentTemplates as Record<string, unknown>[];
      for (const ct of cts) {
        expect(typeof ct.kind, `kind in ${id} → ${ct.key}`).toBe("string");
        expect(["questions", "router", "summary", "intro", "info"]).toContain(ct.kind);
      }
    });
  }

  it("default manifest contains at least one kind:questions variant", () => {
    const m = loadManifest("default");
    const cts = m.contentTemplates as Array<{ kind: string }>;
    expect(cts.some((ct) => ct.kind === "questions")).toBe(true);
  });
});
