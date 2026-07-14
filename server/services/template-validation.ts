/**
 * @module server/services/template-validation
 * @description Structural validation of a template ZIP for the PRD-3 admin
 * lifecycle (§4.1 blocking errors / §4.2 warnings). Pure and synchronous: it
 * operates on an already-extracted entry map and never executes template code
 * (NFR-02).
 *
 * The slot/layout contract enforced here is the one the REAL renderer
 * (`shared/template/render-screen.ts` + `server/scorm/template/app/`) requires,
 * NOT the aspirational button markers in spec-template-platform.md §7. The
 * engine mounts page content into `data-slot="page"` and fills question
 * prompt/input into `data-slot="question-text"`/`"question-interaction"`;
 * navigation/action buttons are wired imperatively by the runtime, so their
 * presence is not a structural requirement. Validating against the spec's
 * `data-nav`/`data-action` markers would reject the shipping `default`
 * template, which does not declare them.
 */
import { templateManifestSchema, isSupportedTemplateApiVersion } from "@shared/schema";
// The path-only DSL is a pure `string -> string` compiler with no DOM/Node deps,
// so it is safe to run here (NFR-02 forbids EXECUTING template code; compiling a
// layout neither runs template.js nor touches the DOM). It is the SAME compiler
// both runtime hosts use, so a layout it rejects would throw unhandled in the
// preview/runtime — we reject it at import instead (see the layout-syntax pass).
import { compileTemplate } from "@shared/template/dsl";
import type { TemplateEntries } from "./template-package";

/** Default ZIP size ceiling (PRD-3 §8): 20 MB. */
export const MAX_TEMPLATE_ZIP_BYTES = 20 * 1024 * 1024;

export interface ValidationIssue {
  code: string;
  message: string;
  /** Manifest field path or archive entry the issue refers to, when relevant. */
  ref?: string;
}

export interface TemplateValidationReport {
  /** True when there are no blocking issues — necessary (not sufficient) for activation. */
  ok: boolean;
  blocking: ValidationIssue[];
  warnings: ValidationIssue[];
  /** Parsed manifest when JSON was readable, else null. */
  manifest: Record<string, unknown> | null;
}

export interface ValidateTemplateOptions {
  /** `create` rejects an id that already exists; `update` requires the id to match `expectedId`. */
  mode: "create" | "update";
  /** Ids already present in the registry (for the create-conflict check). */
  existingIds?: Iterable<string>;
  /** For `update`: the id the new package must keep. */
  expectedId?: string;
  /** Raw uploaded ZIP size, checked against `maxSizeBytes`. */
  zipSizeBytes?: number;
  maxSizeBytes?: number;
}

/** Aux files that are allowed in the ZIP without being referenced by the manifest. */
const UNREFERENCED_OK = [
  /^manifest\.json$/,
  /^preview\.html$/,
  /^README(\.md)?$/i,
  /\.md$/i,
  /\.ejs$/i, // legacy server-side build templates shipped alongside layouts
  /^demo\//,
  /(^|\/)\.DS_Store$/,
];

/** External-resource patterns that are forbidden in template assets (PRD-3 §8). */
const EXTERNAL_CSS_URL = /(?:url\(\s*['"]?|@import\s+(?:url\(\s*)?['"])\s*(?:https?:)?\/\//i;
const EXTERNAL_HTML_RES = /<(?:script|img|source|video|audio|iframe|link)\b[^>]*\b(?:src|href)\s*=\s*['"]\s*(?:https?:)?\/\//i;
const EXTERNAL_JS_IMPORT = /(?:\bfrom\b|\bimport\b|\brequire\s*\(|\bfetch\s*\(|\.src\s*=)\s*['"]\s*(?:https?:)?\/\/[a-z0-9.-]+/i;
/** A manifest-referenced asset path that is itself an external URL. */
const EXTERNAL_REF = /^(?:https?:)?\/\//i;

function text(entries: TemplateEntries, p: string): string | null {
  const buf = entries.get(p);
  return buf ? buf.toString("utf8") : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Collects every archive path referenced by the manifest (layouts, partials,
 * assets, preview demo data, rules, system-page layouts, renderer plugins).
 */
function collectReferences(manifest: Record<string, unknown>): Array<{ ref: string; field: string }> {
  const refs: Array<{ ref: string; field: string }> = [];
  const push = (v: unknown, field: string) => {
    const s = asString(v);
    if (s) refs.push({ ref: s, field });
  };

  const layouts = manifest.layouts as Record<string, unknown> | undefined;
  if (layouts) for (const [k, v] of Object.entries(layouts)) push(v, `layouts.${k}`);

  const partials = manifest.partials as Record<string, unknown> | undefined;
  if (partials) for (const [k, v] of Object.entries(partials)) push(v, `partials.${k}`);

  const assets = manifest.assets as Record<string, unknown> | undefined;
  if (assets) {
    for (const group of ["styles", "scripts", "fonts", "images"]) {
      const arr = assets[group];
      if (Array.isArray(arr)) arr.forEach((v, i) => push(v, `assets.${group}[${i}]`));
    }
    push(assets.preview, "assets.preview");
  }

  const preview = manifest.preview as Record<string, unknown> | undefined;
  if (preview) push(preview.demoData, "preview.demoData");

  const rules = manifest.rules as Record<string, unknown> | undefined;
  if (rules) push(rules.template, "rules.template");

  const systemPages = manifest.systemPages;
  if (Array.isArray(systemPages)) {
    systemPages.forEach((sp, i) => {
      if (sp && typeof sp === "object") push((sp as Record<string, unknown>).layout, `systemPages[${i}].layout`);
    });
  }

  const plugins = manifest.rendererPlugins;
  if (Array.isArray(plugins)) {
    plugins.forEach((pl, i) => {
      if (pl && typeof pl === "object") {
        const p = pl as Record<string, unknown>;
        push(p.entry, `rendererPlugins[${i}].entry`);
        if (Array.isArray(p.styles)) p.styles.forEach((s, j) => push(s, `rendererPlugins[${i}].styles[${j}]`));
      }
    });
  }

  return refs;
}

/**
 * Collects archive paths whose CONTENT the runtime renders through the path-only
 * DSL ({@link module:shared/template/dsl}): every declared layout, partial,
 * system-page layout and content-template `layoutFile`. These must compile.
 * Non-DSL referenced files (CSS/JS/JSON/images, and the `*.ejs` build templates)
 * are intentionally excluded — they are never fed to the mustache compiler.
 */
function collectTemplateSources(manifest: Record<string, unknown>): Array<{ ref: string; field: string }> {
  const out: Array<{ ref: string; field: string }> = [];
  const push = (v: unknown, field: string) => {
    const s = asString(v);
    if (s) out.push({ ref: s, field });
  };

  const layouts = manifest.layouts as Record<string, unknown> | undefined;
  if (layouts) for (const [k, v] of Object.entries(layouts)) push(v, `layouts.${k}`);

  const partials = manifest.partials as Record<string, unknown> | undefined;
  if (partials) for (const [k, v] of Object.entries(partials)) push(v, `partials.${k}`);

  const systemPages = manifest.systemPages;
  if (Array.isArray(systemPages)) {
    systemPages.forEach((sp, i) => {
      if (sp && typeof sp === "object") push((sp as Record<string, unknown>).layout, `systemPages[${i}].layout`);
    });
  }

  const contentTemplates = manifest.contentTemplates;
  if (Array.isArray(contentTemplates)) {
    contentTemplates.forEach((ct, i) => {
      if (ct && typeof ct === "object") {
        const c = ct as Record<string, unknown>;
        push(c.layoutFile, `contentTemplates[${i}].layoutFile (${asString(c.key) ?? i})`);
      }
    });
  }

  return out;
}

/**
 * Validates an extracted template package. Returns a structured report; the
 * caller persists it as `validation_json` and gates activation on `ok`.
 */
export function validateTemplatePackage(
  entries: TemplateEntries,
  options: ValidateTemplateOptions,
): TemplateValidationReport {
  const blocking: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const maxSize = options.maxSizeBytes ?? MAX_TEMPLATE_ZIP_BYTES;

  if (options.zipSizeBytes != null && options.zipSizeBytes > maxSize) {
    blocking.push({
      code: "ZIP_TOO_LARGE",
      message: `ZIP размер ${options.zipSizeBytes} Б превышает лимит ${maxSize} Б`,
    });
  }

  // ── manifest.json presence + JSON parse ──────────────────────────────────
  const manifestText = text(entries, "manifest.json");
  if (manifestText === null) {
    blocking.push({ code: "MANIFEST_MISSING", message: "Отсутствует manifest.json в корне пакета" });
    return { ok: false, blocking, warnings, manifest: null };
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    blocking.push({ code: "MANIFEST_INVALID_JSON", message: "manifest.json не является валидным JSON" });
    return { ok: false, blocking, warnings, manifest: null };
  }

  // ── manifest schema (id/name/version/templateApiVersion/contentTemplates) ──
  const parsed = templateManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      blocking.push({
        code: "MANIFEST_SCHEMA",
        message: issue.message,
        ref: issue.path.join(".") || "<root>",
      });
    }
  }

  const id = asString(manifest.id);
  if (id && !/^[a-z0-9-]+$/.test(id)) {
    blocking.push({ code: "ID_PATTERN", message: `id "${id}" не соответствует ^[a-z0-9-]+$`, ref: "id" });
  }

  const apiVersion = asString(manifest.templateApiVersion);
  if (apiVersion && !isSupportedTemplateApiVersion(apiVersion)) {
    blocking.push({
      code: "API_VERSION_UNSUPPORTED",
      message: `templateApiVersion "${apiVersion}" не поддерживается`,
      ref: "templateApiVersion",
    });
  }

  if (id) {
    if (options.mode === "create") {
      const existing = new Set(options.existingIds ?? []);
      if (existing.has(id)) {
        blocking.push({ code: "ID_EXISTS", message: `Шаблон с id "${id}" уже существует`, ref: "id" });
      }
    } else if (options.mode === "update" && options.expectedId && id !== options.expectedId) {
      blocking.push({
        code: "ID_MISMATCH",
        message: `id обновления "${id}" не совпадает с "${options.expectedId}"`,
        ref: "id",
      });
    }
  }

  // ── required manifest fields (spec-template-platform §5.2) ────────────────
  const layouts = (manifest.layouts as Record<string, unknown> | undefined) ?? {};
  for (const key of ["shell", "question", "content", "results"]) {
    if (!asString(layouts[key])) {
      blocking.push({ code: "REQUIRED_FIELD_MISSING", message: `Отсутствует обязательный layout "${key}"`, ref: `layouts.${key}` });
    }
  }
  const assets = manifest.assets as Record<string, unknown> | undefined;
  if (!assets || typeof assets !== "object") {
    blocking.push({ code: "REQUIRED_FIELD_MISSING", message: "Отсутствует assets", ref: "assets" });
  } else if (!asString(assets.preview)) {
    blocking.push({ code: "REQUIRED_FIELD_MISSING", message: "Отсутствует assets.preview", ref: "assets.preview" });
  }
  if (!manifest.preview || typeof manifest.preview !== "object") {
    blocking.push({ code: "REQUIRED_FIELD_MISSING", message: "Отсутствует preview", ref: "preview" });
  }
  if (!Array.isArray(manifest.params)) {
    blocking.push({ code: "REQUIRED_FIELD_MISSING", message: "Отсутствует params", ref: "params" });
  }
  if (!manifest.capabilities || typeof manifest.capabilities !== "object") {
    blocking.push({ code: "REQUIRED_FIELD_MISSING", message: "Отсутствует capabilities", ref: "capabilities" });
  }

  // ── referenced files exist + external-URL ban on referenced paths ─────────
  const references = collectReferences(manifest);
  const referencedPaths = new Set<string>();
  for (const { ref, field } of references) {
    if (EXTERNAL_REF.test(ref)) {
      blocking.push({ code: "EXTERNAL_URL", message: `Внешний URL в "${field}": ${ref}`, ref: field });
      continue;
    }
    referencedPaths.add(ref);
    if (!entries.has(ref)) {
      blocking.push({ code: "FILE_MISSING", message: `Referenced file отсутствует: ${ref}`, ref: field });
    }
  }

  // ── layout DSL compiles (catch malformed mustache before the runtime does) ─
  // The runtime renders every layout through the SAME compiler; a layout it
  // rejects (empty `{{}}`, `{{{ }}}`, an unclosed/mismatched block, an unknown
  // helper) throws at compile time. Without this gate such a package validates,
  // is stored as a draft, and only blows up as an unhandled error in the admin's
  // preview/runtime (dsl §8.2.1.3). Compile each unique DSL source so the import
  // is rejected here with a precise, per-file message instead.
  const compiledSources = new Set<string>();
  for (const { ref, field } of collectTemplateSources(manifest)) {
    if (EXTERNAL_REF.test(ref) || compiledSources.has(ref) || !entries.has(ref)) continue;
    compiledSources.add(ref);
    const src = text(entries, ref);
    if (src === null) continue;
    try {
      compileTemplate(src);
    } catch (e) {
      blocking.push({
        code: "LAYOUT_TEMPLATE_SYNTAX",
        message: `Макет «${field}» содержит недопустимый синтаксис шаблона: ${(e as Error).message}`,
        ref: `${field} (${ref})`,
      });
    }
  }

  // ── shell / question layout contract (real engine contract) ───────────────
  const shellPath = asString(layouts.shell);
  if (shellPath) {
    const shell = text(entries, shellPath);
    if (shell && !/data-slot\s*=\s*["']page["']/.test(shell)) {
      blocking.push({
        code: "SHELL_CONTRACT",
        message: 'shell не содержит обязательный data-slot="page"',
        ref: `layouts.shell (${shellPath})`,
      });
    }
  }
  const questionPath = asString(layouts.question);
  if (questionPath) {
    const q = text(entries, questionPath);
    if (q) {
      for (const slot of ["question-text", "question-interaction"]) {
        if (!new RegExp(`data-slot\\s*=\\s*["']${slot}["']`).test(q)) {
          blocking.push({
            code: "QUESTION_CONTRACT",
            message: `question layout не содержит обязательный data-slot="${slot}"`,
            ref: `layouts.question (${questionPath})`,
          });
        }
      }
    }
  }

  // ── external resources inside CSS / JS / HTML entries (CDN ban) ───────────
  for (const [p, buf] of entries) {
    const lower = p.toLowerCase();
    const content = buf.toString("utf8");
    let hit = false;
    if (lower.endsWith(".css") && EXTERNAL_CSS_URL.test(content)) hit = true;
    else if (lower.endsWith(".html") && EXTERNAL_HTML_RES.test(content)) hit = true;
    else if (lower.endsWith(".js") && EXTERNAL_JS_IMPORT.test(content)) hit = true;
    if (hit) {
      blocking.push({ code: "EXTERNAL_URL", message: `Внешний ресурс/CDN в ${p}`, ref: p });
    }
  }

  // ── referenced JSON files must parse (rules, demo data) ───────────────────
  const rulesRef = asString((manifest.rules as Record<string, unknown> | undefined)?.template);
  if (rulesRef && entries.has(rulesRef)) {
    try {
      JSON.parse(text(entries, rulesRef)!);
    } catch {
      blocking.push({ code: "RULES_INVALID_JSON", message: `template-rules невалидный JSON: ${rulesRef}`, ref: "rules.template" });
    }
  }
  const demoRef = asString((manifest.preview as Record<string, unknown> | undefined)?.demoData);
  if (demoRef && entries.has(demoRef)) {
    try {
      JSON.parse(text(entries, demoRef)!);
    } catch {
      blocking.push({ code: "DEMODATA_INVALID_JSON", message: `preview.demoData невалидный JSON: ${demoRef}`, ref: "preview.demoData" });
    }
  }

  // ── warnings ──────────────────────────────────────────────────────────────
  const contentPath = asString(layouts.content);
  if (contentPath) {
    const c = text(entries, contentPath);
    if (c && !/data-slot\s*=\s*["']page-content["']/.test(c)) {
      warnings.push({
        code: "CONTENT_CONTRACT",
        message: 'content layout не содержит data-slot="page-content" (движок отрендерит во весь контейнер)',
        ref: `layouts.content (${contentPath})`,
      });
    }
  }
  if (!asString(layouts.start)) {
    warnings.push({ code: "OPTIONAL_LAYOUT_MISSING", message: 'Не объявлен layout "start" (будет использован "content")', ref: "layouts.start" });
  }
  for (const [p] of entries) {
    if (referencedPaths.has(p)) continue;
    if (UNREFERENCED_OK.some((re) => re.test(p))) continue;
    warnings.push({ code: "UNUSED_FILE", message: `Файл не используется манифестом: ${p}`, ref: p });
  }

  return { ok: blocking.length === 0, blocking, warnings, manifest };
}
