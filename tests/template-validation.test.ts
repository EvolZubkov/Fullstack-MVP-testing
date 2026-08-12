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
import { declaredThemes, supportsThemes } from "@shared/template/themes";

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

  // A missing layout does NOT block (spec §17.1, PRD-1 §4.3.2, PRD-3 NFR-06): the
  // screen renders from the standard template. Covered as a warning below.
  it("does not reject a missing layout — it warns and falls back", () => {
    const r = validateTemplatePackage(
      validPackage({ manifest: { layouts: { shell: "shell.html", question: "layouts/question.html", content: "layouts/content.html" } } }),
      { mode: "create" },
    );
    expect(codes(r)).not.toContain("REQUIRED_FIELD_MISSING");
    expect(r.ok).toBe(true);
    const w = r.warnings.filter((i) => i.code === "OPTIONAL_LAYOUT_MISSING");
    expect(w.map((i) => i.ref)).toContain("layouts.results");
    expect(w.map((i) => i.message).join(" ")).toContain("стандартного шаблона");
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

  // Slot contracts are warnings, not blockers: the renderer skips an absent slot
  // rather than throwing, and the hosts render such a screen from the standard
  // template (spec §17.2, PRD-3 §4.2).
  it("warns — does not reject — a shell without data-slot=\"page\"", () => {
    const r = validateTemplatePackage(
      validPackage({ files: { "shell.html": "<main></main>" } }),
      { mode: "create" },
    );
    expect(codes(r)).not.toContain("SHELL_CONTRACT");
    expect(r.ok).toBe(true);
    expect(r.warnings.map((i) => i.code)).toContain("SHELL_CONTRACT");
  });

  it("warns — does not reject — a question layout missing a slot", () => {
    const r = validateTemplatePackage(
      validPackage({ files: { "layouts/question.html": '<div data-slot="question-text"></div>' } }),
      { mode: "create" },
    );
    expect(codes(r)).not.toContain("QUESTION_CONTRACT");
    expect(r.ok).toBe(true);
    const w = r.warnings.filter((i) => i.code === "QUESTION_CONTRACT");
    expect(w.map((i) => i.message).join(" ")).toContain("question-interaction");
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

  // A page-variant layout is declared ONLY as `contentTemplates[].layoutFile`
  // (PRD-22: the page fields come from the manifest). Those paths were absent from
  // the reference set, so every variant layout was reported as an unused file and
  // the card carried a permanent «Комплектность: Предупреждения» badge for a package
  // with nothing wrong with it.
  it("layout из contentTemplates[].layoutFile не считается неиспользуемым", () => {
    const r = validateTemplatePackage(
      validPackage({
        manifest: {
          contentTemplates: [
            { key: "q.std", label: "Стандартный вопрос", kind: "questions", placeholders: [] },
            {
              key: "info.text",
              label: "Текст",
              kind: "info",
              pageKind: "content.info",
              layoutFile: "layouts/content.text.html",
              placeholders: [],
            },
          ],
        },
        files: { "layouts/content.text.html": '<div data-slot="page-content"></div>' },
      }),
      { mode: "create" },
    );
    expect(r.ok).toBe(true);
    expect(r.warnings.filter((w) => w.code === "UNUSED_FILE")).toEqual([]);
  });

  it("отсутствующий layout из contentTemplates[].layoutFile блокирует импорт", () => {
    const r = validateTemplatePackage(
      validPackage({
        manifest: {
          contentTemplates: [
            {
              key: "info.text",
              label: "Текст",
              kind: "info",
              pageKind: "content.info",
              layoutFile: "layouts/content.text.html",
              placeholders: [],
            },
          ],
        },
      }),
      { mode: "create" },
    );
    expect(r.ok).toBe(false);
    expect(r.blocking.map((b) => b.code)).toContain("FILE_MISSING");
  });
});

describe("validateTemplatePackage — theme declaration (PRD-23)", () => {
  /** Stylesheet with a light base and a dark palette, as `certification` ships. */
  const CSS_BOTH =
    ':root{--background:240 4% 93%}\n' +
    '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--background:240 10% 10%}}\n' +
    ':root[data-theme="dark"]{--background:240 10% 10%}';
  const BOTH = [
    { id: "light", label: "Светлая" },
    { id: "dark", label: "Тёмная" },
  ];

  it("accepts a declaration backed by the template's own stylesheet", () => {
    const r = validateTemplatePackage(
      validPackage({ manifest: { themes: BOTH }, files: { "styles/base.css": CSS_BOTH } }),
      { mode: "create" },
    );
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code)).not.toContain("THEME_ADVISORY");
  });

  it("blocks a theme the stylesheet does not back with tokens", () => {
    // The default fixture ships a stylesheet with no palette at all.
    const r = validateTemplatePackage(validPackage({ manifest: { themes: BOTH } }), {
      mode: "create",
    });
    expect(r.ok).toBe(false);
    const themeIssue = r.blocking.find((b) => b.code === "THEME_INVALID");
    expect(themeIssue?.ref).toBe("themes.light");
  });

  it("blocks an id outside the closed registry", () => {
    const r = validateTemplatePackage(
      validPackage({
        manifest: { themes: [...BOTH, { id: "sepia", label: "Сепия" }] },
        files: { "styles/base.css": CSS_BOTH },
      }),
      { mode: "create" },
    );
    expect(r.ok).toBe(false);
    expect(r.blocking.find((b) => b.code === "THEME_INVALID")?.message).toContain("sepia");
  });

  it("warns when a second palette ships without a declaration", () => {
    const r = validateTemplatePackage(validPackage({ files: { "styles/base.css": CSS_BOTH } }), {
      mode: "create",
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain("THEME_ADVISORY");
  });

  it("stays silent for a single-palette template that declares nothing", () => {
    const r = validateTemplatePackage(validPackage(), { mode: "create" });
    expect(r.warnings.map((w) => w.code)).not.toContain("THEME_ADVISORY");
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

describe("the in-repo `certification` template passes the validator", () => {
  it("validates with no blocking issues", async () => {
    const dir = path.resolve(process.cwd(), "templates", "certification");
    const entries = await readDirEntries(dir);
    const r = validateTemplatePackage(entries, { mode: "create" });
    if (!r.ok) {
      throw new Error("certification failed validation: " + JSON.stringify(r.blocking, null, 2));
    }
    expect(r.ok).toBe(true);
  });

  // PRD-23 Э7: the template ships both palettes AND declares them, so the author
  // can pick a theme and colour each one. The advisory that fired before Э7 (a
  // dark palette nobody declared) must be gone.
  it("declares both palettes and draws no theme advisory", async () => {
    const dir = path.resolve(process.cwd(), "templates", "certification");
    const entries = await readDirEntries(dir);
    const r = validateTemplatePackage(entries, { mode: "create" });
    expect(r.warnings.map((w) => w.code)).not.toContain("THEME_ADVISORY");

    const manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8")) as unknown;
    expect(declaredThemes(manifest).map((t) => t.id)).toEqual(["light", "dark"]);
    expect(supportsThemes(manifest)).toBe(true);
  });
});
