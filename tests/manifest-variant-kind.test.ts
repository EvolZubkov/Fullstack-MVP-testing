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
// Validate whatever built-in templates actually ship (derived from disk) so adding
// or retiring a template does not require editing this list.
const BUILTIN_IDS = fs
  .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(TEMPLATES_DIR, d.name, "manifest.json")))
  .map((d) => d.name);

function loadManifest(id: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, id, "manifest.json"), "utf-8"));
}

// ─── VariantKind enum ─────────────────────────────────────────────────────────

describe("variantKindSchema", () => {
  it.each(["start", "questions", "router", "summary", "results", "intro", "info", "review", "section-results"] as const)(
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

  // The default template is the system-wide fallback for every REQUIRED system
  // kind (PRD-1 §4.3.2 / PRD-19 §3.2). It must declare start/results/router/
  // questions/review/section-results; otherwise bindSystemVariant() silently
  // returns null and reconcile drops the row (G48 2026-05-28). Legacy intro/summary
  // are valid kinds but no longer required (the section boundary is review +
  // section-results; section intro/summary content is authored as `info` pages).
  const allSystemKinds = [
    { key: "start.simple", label: "Start", kind: "start" },
    { key: "results.simple", label: "Results", kind: "results" },
    { key: "router.menu", label: "Router", kind: "router" },
    { key: "question.standard", label: "Q", kind: "questions" },
    { key: "intro.standard", label: "Intro", kind: "intro" },
    { key: "review.standard", label: "Review", kind: "review" },
    { key: "section-results.standard", label: "SR", kind: "section-results" },
  ];

  it("accepts manifest declaring all system kinds", () => {
    expect(defaultTemplateManifestSchema.safeParse({
      ...baseDefault,
      contentTemplates: allSystemKinds,
    }).success).toBe(true);
  });

  it.each(["start", "results", "router", "questions", "intro", "review", "section-results"] as const)(
    "rejects manifest missing kind:%s variant",
    (missing) => {
      const result = defaultTemplateManifestSchema.safeParse({
        ...baseDefault,
        contentTemplates: allSystemKinds.filter((ct) => ct.kind !== missing),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join(" ");
        expect(messages).toMatch(new RegExp(`kind: "${missing}"`));
      }
    },
  );
});

// ─── validateManifest gatekeeper ──────────────────────────────────────────────

describe("validateManifest", () => {
  it("returns null for a valid default-template manifest with all system kinds", () => {
    expect(validateManifest(
      {
        id: "default",
        name: "Default",
        version: "1.0.0",
        templateApiVersion: "1.0",
        contentTemplates: [
          { key: "st.s", label: "St", kind: "start" },
          { key: "res.s", label: "Res", kind: "results" },
          { key: "r.s", label: "R", kind: "router" },
          { key: "q.s", label: "Q", kind: "questions" },
          { key: "in.s", label: "In", kind: "intro" },
          { key: "rv.s", label: "Rv", kind: "review" },
          { key: "sr.s", label: "Sr", kind: "section-results" },
        ],
      },
      "default",
    )).toBeNull();
  });

  it.each(["start", "results", "router", "questions", "intro", "review", "section-results"] as const)(
    "rejects default-template manifest missing kind:%s variant",
    (missing) => {
      const allEntries = [
        { key: "st.s", label: "St", kind: "start" },
        { key: "res.s", label: "Res", kind: "results" },
        { key: "r.s", label: "R", kind: "router" },
        { key: "q.s", label: "Q", kind: "questions" },
        { key: "in.s", label: "In", kind: "intro" },
        { key: "rv.s", label: "Rv", kind: "review" },
        { key: "sr.s", label: "Sr", kind: "section-results" },
      ];
      const reason = validateManifest(
        {
          id: "default",
          name: "Default",
          version: "1.0.0",
          templateApiVersion: "1.0",
          contentTemplates: allEntries.filter((ct) => ct.kind !== missing),
        },
        "default",
      );
      expect(reason).not.toBeNull();
      expect(reason!).toMatch(new RegExp(`kind: "${missing}"`));
    },
  );

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
        // Список берётся из СХЕМЫ, а не дублируется: дубль разошёлся, когда PRD-27
        // добавил виды отчёта, и тест упал на поставляемом манифесте.
        expect(variantKindSchema.options).toContain(ct.kind);
      }
    });
  }

  it.each(["start", "results", "router", "questions", "intro", "review", "section-results"] as const)(
    "default manifest declares at least one kind:%s variant",
    (kind) => {
      const m = loadManifest("default");
      const cts = m.contentTemplates as Array<{ kind: string }>;
      expect(cts.some((ct) => ct.kind === kind)).toBe(true);
    },
  );
});
