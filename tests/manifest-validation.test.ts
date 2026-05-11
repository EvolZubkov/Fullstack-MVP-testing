/**
 * @module tests/manifest-validation
 * @description Structural validation of built-in template manifests against
 * the spec-template-platform.md contract.
 *
 * Validates: id, name, version, templateApiVersion, params[], contentTemplates[],
 * placeholder structure, preview.demoData.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { isSupportedTemplateApiVersion } from "../server/template-registry";

const TEMPLATES_DIR = path.resolve(process.cwd(), "server", "scorm", "templates");
const BUILTIN_IDS = ["default", "corporate", "minimal"] as const;

function loadManifest(id: string): Record<string, unknown> {
  const p = path.join(TEMPLATES_DIR, id, "manifest.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

// ─── Per-manifest structural tests ────────────────────────────────────────────

for (const templateId of BUILTIN_IDS) {
  describe(`manifest: ${templateId}`, () => {
    const m = loadManifest(templateId);

    it("has string id matching directory name", () => {
      expect(typeof m.id).toBe("string");
      expect(m.id).toBe(templateId);
    });

    it("has non-empty string name", () => {
      expect(typeof m.name).toBe("string");
      expect((m.name as string).length).toBeGreaterThan(0);
    });

    it("has semver-compatible version", () => {
      expect(typeof m.version).toBe("string");
      expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("has supported templateApiVersion", () => {
      expect(typeof m.templateApiVersion).toBe("string");
      expect(isSupportedTemplateApiVersion(m.templateApiVersion as string)).toBe(true);
    });

    it("has non-empty params array", () => {
      expect(Array.isArray(m.params)).toBe(true);
      expect((m.params as unknown[]).length).toBeGreaterThan(0);
    });

    it("every param has key, type, label, default", () => {
      for (const p of m.params as Record<string, unknown>[]) {
        expect(typeof p.key,   `param.key in ${templateId}`).toBe("string");
        expect(typeof p.type,  `param.type in ${templateId}`).toBe("string");
        expect(typeof p.label, `param.label in ${templateId}`).toBe("string");
        expect("default" in p, `param.default in ${templateId}`).toBe(true);
      }
    });

    it("has non-empty contentTemplates array", () => {
      expect(Array.isArray(m.contentTemplates)).toBe(true);
      expect((m.contentTemplates as unknown[]).length).toBeGreaterThan(0);
    });

    it("every contentTemplate has key, label, pageKind, placeholders", () => {
      for (const ct of m.contentTemplates as Record<string, unknown>[]) {
        expect(typeof ct.key,      `ct.key in ${templateId}`).toBe("string");
        expect(typeof ct.label,    `ct.label in ${templateId}`).toBe("string");
        expect(typeof ct.pageKind, `ct.pageKind in ${templateId}`).toBe("string");
        expect(Array.isArray(ct.placeholders), `ct.placeholders in ${templateId}`).toBe(true);
      }
    });

    it("contentTemplate labels are human-readable (not raw keys)", () => {
      for (const ct of m.contentTemplates as Record<string, unknown>[]) {
        const label = ct.label as string;
        // label must not be the same as key — it should be human-readable
        expect(label).not.toBe(ct.key);
        // label must contain at least one space or Cyrillic character (i.e. a real phrase)
        expect(label).toMatch(/[\sЀ-ӿ]/);
      }
    });

    it("every placeholder has key, type, label, required", () => {
      for (const ct of m.contentTemplates as Record<string, unknown>[]) {
        for (const ph of ct.placeholders as Record<string, unknown>[]) {
          expect(typeof ph.key,      `ph.key in ${templateId}`).toBe("string");
          expect(typeof ph.type,     `ph.type in ${templateId}`).toBe("string");
          expect(typeof ph.label,    `ph.label in ${templateId}`).toBe("string");
          expect(typeof ph.required, `ph.required in ${templateId}`).toBe("boolean");
        }
      }
    });

    it("placeholder types are from the allowed set", () => {
      const allowed = new Set(["text", "textarea", "richText", "image", "number", "boolean", "resultField", "asset", "font", "color", "select"]);
      for (const ct of m.contentTemplates as Record<string, unknown>[]) {
        for (const ph of ct.placeholders as Record<string, unknown>[]) {
          expect(allowed.has(ph.type as string), `unknown type "${ph.type}" in ${templateId}`).toBe(true);
        }
      }
    });

    it("has preview object with demoData string", () => {
      const preview = m.preview as Record<string, unknown> | undefined;
      expect(typeof preview).toBe("object");
      expect(typeof preview!.demoData).toBe("string");
      expect((preview!.demoData as string).length).toBeGreaterThan(0);
    });

    it("has preview.routes as non-empty array", () => {
      const preview = m.preview as Record<string, unknown>;
      expect(Array.isArray(preview.routes)).toBe(true);
      expect((preview.routes as unknown[]).length).toBeGreaterThan(0);
    });
  });
}
