/**
 * @module tests/template-validation
 * @description Unit tests for the PRD-3 structural validator
 * (server/services/template-validation). Pure: no DB, no template execution.
 * Covers blocking errors (§4.1), warnings (§4.2), and a guard that the shipping
 * `default` built-in passes its own validator (export-as-starter round trip).
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  validateTemplatePackage,
  MAX_TEMPLATE_ZIP_BYTES,
} from "../server/services/template-validation";
import { readDirEntries, type TemplateEntries } from "../server/services/template-package";

/** Builds an entry map from a path -> text record. */
function entriesOf(record: Record<string, string>): TemplateEntries {
  const m: TemplateEntries = new Map();
  for (const [k, v] of Object.entries(record)) m.set(k, Buffer.from(v, "utf8"));
  return m;
}

const baseManifest = {
  id: "acme",
  name: "ACME",
  version: "1.0.0",
  templateApiVersion: "1.0",
  layouts: {
    shell: "shell.html",
    question: "layouts/question.html",
    content: "layouts/content.html",
    results: "layouts/results.html",
  },
  assets: { preview: "preview.svg", styles: ["styles/base.css"], scripts: [] },
  preview: { demoData: "demo/course.json", routes: ["start"] },
  params: [],
  capabilities: { questionTypes: ["single"] },
  contentTemplates: [{ key: "q.std", label: "Стандартный вопрос", kind: "questions", placeholders: [] }],
};

/** A package with no blocking issues. */
function validPackage(overrides: { manifest?: Record<string, unknown>; files?: Record<string, string> } = {}) {
  const manifest = { ...baseManifest, ...(overrides.manifest ?? {}) };
  const files: Record<string, string> = {
    "manifest.json": JSON.stringify(manifest),
    "shell.html": '<main data-slot="page"></main>',
    "layouts/question.html": '<div data-slot="question-text"></div><div data-slot="question-interaction"></div>',
    "layouts/content.html": '<div data-slot="page-content"></div>',
    "layouts/results.html": "<div></div>",
    "styles/base.css": "body{color:#000}",
    "preview.svg": "<svg/>",
    "demo/course.json": "{}",
    ...(overrides.files ?? {}),
  };
  return entriesOf(files);
}

describe("validateTemplatePackage — happy path", () => {
  it("a well-formed package has no blocking issues", () => {
    const r = validateTemplatePackage(validPackage(), { mode: "create" });
    expect(r.ok).toBe(true);
    expect(r.blocking).toEqual([]);
    expect(r.manifest?.id).toBe("acme");
  });
});

describe("validateTemplatePackage — blocking errors (§4.1)", () => {
  const codes = (r: ReturnType<typeof validateTemplatePackage>) => r.blocking.map((i) => i.code);

  it("rejects a ZIP without manifest.json", () => {
    const e = validPackage();
    e.delete("manifest.json");
    const r = validateTemplatePackage(e, { mode: "create" });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("MANIFEST_MISSING");
  });

  it("rejects a malformed manifest.json", () => {
    const e = validPackage();
    e.set("manifest.json", Buffer.from("{not json", "utf8"));
    const r = validateTemplatePackage(e, { mode: "create" });
    expect(codes(r)).toContain("MANIFEST_INVALID_JSON");
  });

  it("rejects an id not matching ^[a-z0-9-]+$", () => {
    const r = validateTemplatePackage(validPackage({ manifest: { id: "ACME!" } }), { mode: "create" });
    expect(codes(r)).toContain("ID_PATTERN");
  });

  it("rejects an unsupported templateApiVersion", () => {
    const r = validateTemplatePackage(validPackage({ manifest: { templateApiVersion: "2.0" } }), { mode: "create" });
    expect(codes(r)).toContain("API_VERSION_UNSUPPORTED");
  });

  it("rejects a duplicate id on create", () => {
    const r = validateTemplatePackage(validPackage(), { mode: "create", existingIds: ["acme", "default"] });
    expect(codes(r)).toContain("ID_EXISTS");
  });

  it("rejects an id mismatch on update", () => {
    const r = validateTemplatePackage(validPackage(), { mode: "update", expectedId: "other" });
    expect(codes(r)).toContain("ID_MISMATCH");
  });

  it("rejects a missing required layout", () => {
    const r = validateTemplatePackage(
      validPackage({ manifest: { layouts: { shell: "shell.html", question: "layouts/question.html", content: "layouts/content.html" } } }),
      { mode: "create" },
    );
    expect(codes(r)).toContain("REQUIRED_FIELD_MISSING");
  });

  it("rejects a referenced file that is absent", () => {
    const e = validPackage();
    e.delete("styles/base.css");
    const r = validateTemplatePackage(e, { mode: "create" });
    expect(codes(r)).toContain("FILE_MISSING");
  });

  it("rejects an external URL in a manifest asset reference", () => {
    const r = validateTemplatePackage(
      validPackage({ manifest: { assets: { preview: "preview.svg", styles: ["https://cdn.example.com/x.css"] } } }),
      { mode: "create" },
    );
    expect(codes(r)).toContain("EXTERNAL_URL");
  });

  it("rejects a CDN @import inside a CSS asset", () => {
    const r = validateTemplatePackage(
      validPackage({ files: { "styles/base.css": "@import url(https://cdn.example.com/x.css);" } }),
      { mode: "create" },
    );
    expect(codes(r)).toContain("EXTERNAL_URL");
  });

  it("rejects a CDN <link> inside an HTML layout", () => {
    const r = validateTemplatePackage(
      validPackage({ files: { "shell.html": '<link href="https://cdn.example.com/x.css"><main data-slot="page"></main>' } }),
      { mode: "create" },
    );
    expect(codes(r)).toContain("EXTERNAL_URL");
  });

  it("rejects a shell without data-slot=\"page\"", () => {
    const r = validateTemplatePackage(
      validPackage({ files: { "shell.html": "<main></main>" } }),
      { mode: "create" },
    );
    expect(codes(r)).toContain("SHELL_CONTRACT");
  });

  it("rejects a question layout missing a required slot", () => {
    const r = validateTemplatePackage(
      validPackage({ files: { "layouts/question.html": '<div data-slot="question-text"></div>' } }),
      { mode: "create" },
    );
    expect(codes(r)).toContain("QUESTION_CONTRACT");
  });

  it("rejects a layout whose mustache does not compile (empty {{}})", () => {
    const r = validateTemplatePackage(
      validPackage({ files: { "layouts/results.html": '<button>{{}}</button>' } }),
      { mode: "create" },
    );
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("LAYOUT_TEMPLATE_SYNTAX");
    expect(r.blocking.find((i) => i.code === "LAYOUT_TEMPLATE_SYNTAX")?.ref).toContain("layouts/results.html");
  });

  it("rejects a layout with an unclosed block ({{#if}})", () => {
    const r = validateTemplatePackage(
      validPackage({ files: { "layouts/results.html": '<div>{{#if x}}no close</div>' } }),
      { mode: "create" },
    );
    expect(codes(r)).toContain("LAYOUT_TEMPLATE_SYNTAX");
  });

  it("rejects a malformed content-template layoutFile (compiled too)", () => {
    const r = validateTemplatePackage(
      validPackage({
        manifest: {
          contentTemplates: [
            { key: "intro.x", label: "Введение", kind: "intro", layoutFile: "layouts/intro.html", placeholders: [] },
          ],
        },
        files: { "layouts/intro.html": '<h1>{{ }}</h1>' },
      }),
      { mode: "create" },
    );
    expect(codes(r)).toContain("LAYOUT_TEMPLATE_SYNTAX");
  });

  it("rejects invalid JSON in preview.demoData", () => {
    const r = validateTemplatePackage(
      validPackage({ files: { "demo/course.json": "{bad" } }),
      { mode: "create" },
    );
    expect(codes(r)).toContain("DEMODATA_INVALID_JSON");
  });

  it("rejects a ZIP over the size limit", () => {
    const r = validateTemplatePackage(validPackage(), {
      mode: "create",
      zipSizeBytes: MAX_TEMPLATE_ZIP_BYTES + 1,
    });
    expect(codes(r)).toContain("ZIP_TOO_LARGE");
  });
});

describe("validateTemplatePackage — warnings (§4.2)", () => {
  it("warns about an unused file and a missing optional start layout", () => {
    const r = validateTemplatePackage(
      validPackage({ files: { "extra/orphan.css": "x" } }),
      { mode: "create" },
    );
    expect(r.ok).toBe(true);
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain("UNUSED_FILE");
    expect(codes).toContain("OPTIONAL_LAYOUT_MISSING");
  });
});

describe("the shipping `default` built-in passes its own validator", () => {
  it("validates with no blocking issues (export-as-starter contract)", async () => {
    const dir = path.resolve(process.cwd(), "server", "scorm", "templates", "default");
    const entries = await readDirEntries(dir);
    const r = validateTemplatePackage(entries, { mode: "create" });
    if (!r.ok) {
      // Surface the offending issues in the failure message.
      throw new Error("default template failed validation: " + JSON.stringify(r.blocking, null, 2));
    }
    expect(r.ok).toBe(true);
  });
});
