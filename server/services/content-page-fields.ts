/**
 * @module server/services/content-page-fields
 * @description The normalisation and sanitisation rules for the FIELDS of a test
 * content page — the single place they exist.
 *
 * A page carries two independent field sets, and they obey different rules:
 *
 * - `values_json` — what the author wrote into the variant's placeholders. Plain
 *   fields get the plain author pass, markup fields get the XSS sanitiser plus the
 *   markup-aware pass, a `resultField` is validated against the paths and
 *   renderers its variant allows, and only a placeholder that opted into author
 *   font sizing keeps a `placeholderStyles` entry.
 * - `settings_json` — the variant's `settings[]`, PROPERTIES of the page rather
 *   than content: only declared keys survive, values are coerced to the declared
 *   type, a declared `default` fills an empty value, and a sequence identifier
 *   outlives a variant that no longer declares it (PRD-22 FR-29).
 *
 * Extracted from `server/routes/content-pages.ts` for PRD-48 Э3: the Excel
 * workbook will write page fields too, and a second copy of these rules would
 * make the workbook an entry point past the sanitiser. Nothing here knows about
 * HTTP — a rejected value comes back as {@link ContentPageFieldError}, and the
 * caller decides whether that is a 422 or a workbook row error.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { templates } from "@shared/schema";
import { normalizeAuthorPlain, normalizeAuthorHtml } from "@shared/text";
import {
  sanitizeHtmlWithDiagnostics,
  sanitizeValuesWithDiagnostics,
  placeholderScope,
  type SanitizeDiagnostics,
} from "../utils/html-sanitizer";

/** One `placeholders[]` declaration of a variant: a slot for authored content. */
export type PlaceholderDefinition = {
  key: string;
  type: string;
  textFit?: { allowAuthorFontSize?: boolean };
  allowedPaths?: string[];
  allowedRenderers?: string[];
  defaultPath?: string;
  defaultRenderer?: string;
};

/** One `settings[]` declaration of a variant (PRD-22): a PROPERTY of the page. */
export type SettingDefinition = {
  key: string;
  type: string;
  options?: string[];
  default?: unknown;
  required?: boolean;
};

/** One variant of a design template — the contract a page validates against. */
export type ContentTemplateEntry = {
  key: string;
  label?: string;
  kind?: "questions" | "router" | "summary" | "intro" | "info";
  placeholders?: PlaceholderDefinition[];
  settings?: SettingDefinition[];
};

/** The `values_json` column shape: authored values plus per-placeholder styles. */
export type PageValuesJson = {
  values?: Record<string, unknown>;
  placeholderStyles?: Record<string, unknown>;
};

/** Result of {@link normalizeValuesForTemplate}. */
export type NormalizedPageValues = {
  values: Record<string, unknown>;
  placeholderStyles: Record<string, unknown>;
  sanitizeDiagnostics: SanitizeDiagnostics;
};

/**
 * A field value the variant does not permit. Carries `status = 422` so an Express
 * handler can forward it unchanged, and `field` so the editor can point at the
 * offending input.
 */
export class ContentPageFieldError extends Error {
  readonly status = 422;
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "ContentPageFieldError";
    this.field = field;
  }
}

/**
 * Returns the contentTemplates array a test's content pages validate against.
 *
 * Prefers `overrideTemplateId` — the in-progress «Оформление» DRAFT the editor
 * sends as `?templateId=` — but ONLY when it resolves to an ACTIVE template, so
 * structure edits (add / replace-variant / value validation) work against the
 * chosen template before the design is saved. Otherwise falls back to the test's
 * saved design template, then the built-in "default".
 *
 * @param test The test row, for its `designSettingsJson.templateId`.
 * @param overrideTemplateId Draft template id, if the caller has one.
 * @returns The variants, or `null` when the template cannot be read at all — the
 *   callers treat that as "no contract to validate against" and skip validation.
 */
export async function resolveContentTemplates(
  test: { designSettingsJson: unknown },
  overrideTemplateId?: string,
): Promise<ContentTemplateEntry[] | null> {
  const settings = test.designSettingsJson as { templateId?: string } | null;
  const savedId = settings?.templateId || "default";

  const readTemplates = (id: string, activeOnly: boolean) =>
    db
      .select()
      .from(templates)
      .where(activeOnly ? and(eq(templates.id, id), eq(templates.isActive, true)) : eq(templates.id, id));

  // Draft override wins only when it points to a different, ACTIVE template.
  if (overrideTemplateId && overrideTemplateId !== savedId) {
    const [draftTpl] = await readTemplates(overrideTemplateId, true);
    if (draftTpl) {
      const manifest = draftTpl.manifest as { contentTemplates?: ContentTemplateEntry[] };
      return manifest.contentTemplates ?? null;
    }
  }

  const [template] = await readTemplates(savedId, false);
  if (!template) return null;
  const manifest = template.manifest as { contentTemplates?: ContentTemplateEntry[] };
  return manifest.contentTemplates ?? null;
}

/** Looks a variant up by its key. `undefined` means the template dropped it. */
export function findContentTemplate(
  contentTemplates: ContentTemplateEntry[],
  key: string | null | undefined,
): ContentTemplateEntry | undefined {
  return contentTemplates.find((ct) => ct.key === key);
}

/**
 * Sanitises arbitrary string values without a template manifest (used for
 * mode='custom' / free-form payloads). Aggregates diagnostics so the caller
 * can surface them to the UI alongside the cleaned payload.
 *
 * Author CSS is confined to the region the value renders into
 * ({@link placeholderScope}) — an `html`-mode page renders as a whole into
 * `.content-page--html`, so its `<style>` can no longer restyle the player.
 */
export function sanitizeAllStringValuesWithDiagnostics(
  values: Record<string, unknown> | undefined,
): { values: Record<string, unknown>; diagnostics: SanitizeDiagnostics } {
  const result: Record<string, unknown> = {};
  const diagnostics: SanitizeDiagnostics = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    if (typeof value === "string") {
      const { value: cleaned, removed } = sanitizeHtmlWithDiagnostics(value, {
        scope: placeholderScope(key),
      });
      // An `html`-mode page is markup with no manifest to type its fields, so the
      // markup-aware pass applies: canonical whitespace and typography for the
      // text, nothing for the tags, and no markdown anywhere.
      result[key] = normalizeAuthorHtml(cleaned);
      if (removed.length > 0) diagnostics[key] = removed;
    } else {
      result[key] = value;
    }
  }
  return { values: result, diagnostics };
}

/** Back-compat wrapper - for callers that do not surface diagnostics. */
export function sanitizeAllStringValues(values: Record<string, unknown> | undefined): Record<string, unknown> {
  return sanitizeAllStringValuesWithDiagnostics(values).values;
}

/**
 * Normalises the page's authored VALUES against the variant's `placeholders[]`.
 *
 * A key the variant does not declare passes through untouched: the page may still
 * carry the values of a variant it was switched away from, and dropping them here
 * would destroy content the author can still get back by switching back.
 *
 * @param valuesJson The incoming `values_json` payload.
 * @param placeholders The variant's placeholder declarations.
 * @returns Cleaned values, the surviving placeholder styles, and what the
 *   sanitiser stripped per placeholder.
 * @throws {ContentPageFieldError} When a `resultField` names a path or a renderer
 *   its variant does not allow.
 */
export function normalizeValuesForTemplate(
  valuesJson: PageValuesJson | undefined,
  placeholders: PlaceholderDefinition[],
): NormalizedPageValues {
  const { values, diagnostics: sanitizeDiagnostics } = sanitizeValuesWithDiagnostics(
    valuesJson?.values ?? {},
    placeholders,
  );
  const placeholderStyles: Record<string, unknown> = {};

  for (const ph of placeholders) {
    const style = valuesJson?.placeholderStyles?.[ph.key] as { fontSize?: unknown } | undefined;
    if (ph.textFit?.allowAuthorFontSize && typeof style?.fontSize === "number" && Number.isFinite(style.fontSize)) {
      placeholderStyles[ph.key] = { fontSize: style.fontSize };
    }

    // Author text is stored canonically whatever field it sits in. Plain fields
    // take the plain pass; `richText`/`html` take the markup-aware one, which
    // applies the same whitespace and typography rules to the TEXT only and never
    // touches a tag, an attribute, a style block or preformatted content.
    // Markdown is never interpreted in a markup field — there the author writes
    // HTML, and `*` is a character.
    const value = values[ph.key];
    if (typeof value === "string") {
      if (ph.type === "text" || ph.type === "textarea") {
        values[ph.key] = normalizeAuthorPlain(value);
      } else if (ph.type === "richText" || ph.type === "html") {
        values[ph.key] = normalizeAuthorHtml(value);
      }
    }

    if (ph.type === "resultField") {
      const raw = values[ph.key] as { path?: unknown; renderer?: unknown; rendererOptions?: unknown; label?: unknown } | undefined;
      if (!raw || typeof raw !== "object") continue;

      const path = typeof raw.path === "string" ? raw.path : ph.defaultPath;
      if (path && ph.allowedPaths && !ph.allowedPaths.includes(path)) {
        throw new ContentPageFieldError("path is not allowed for resultField", `valuesJson.values.${ph.key}.path`);
      }

      const renderer = typeof raw.renderer === "string" ? raw.renderer : ph.defaultRenderer;
      if (renderer && ph.allowedRenderers && !ph.allowedRenderers.includes(renderer)) {
        throw new ContentPageFieldError("renderer is not allowed for resultField", `valuesJson.values.${ph.key}.renderer`);
      }

      values[ph.key] = {
        ...raw,
        path: path ?? raw.path,
        renderer: renderer ?? raw.renderer,
        rendererOptions:
          raw.rendererOptions && typeof raw.rendererOptions === "object" && !Array.isArray(raw.rendererOptions)
            ? raw.rendererOptions
            : {},
      };
    }
  }

  return { values, placeholderStyles, sanitizeDiagnostics };
}

/**
 * Normalises the page's SETTINGS against the variant's `settings[]` (PRD-22).
 *
 * Kept apart from {@link normalizeValuesForTemplate} because settings obey their
 * own rules: only declared keys are stored, values are coerced to the declared
 * type, a declared `default` fills an absent value, and `text` settings are
 * sanitised (they reach the layout as a caption, e.g. the «Далее» button).
 *
 * `sequence` values survive a variant that no longer declares the setting
 * (FR-29): the caller passes the previously stored settings as `existing`, and
 * an undeclared sequence identifier is carried over rather than dropped — an
 * author who switches a page to another variant and back keeps its place in the
 * sequence.
 *
 * Rejections are SILENT by design of the settings model: a `select` outside its
 * options and a `number` that is not numeric are dropped without an error, and so
 * is every key the variant does not declare.
 *
 * @param incoming Settings from the request; `undefined` re-normalises `existing`.
 * @param declared The variant's `settings[]`, if it has any.
 * @param existing The settings currently stored on the page.
 */
export function normalizeSettingsForTemplate(
  incoming: Record<string, unknown> | undefined,
  declared: SettingDefinition[] | undefined,
  existing?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const source = incoming ?? existing ?? {};

  for (const def of declared ?? []) {
    const raw = source[def.key];
    let value: unknown = raw;

    if (raw === undefined || raw === null || raw === "") {
      if (def.default === undefined) continue;
      value = def.default;
    } else if (def.type === "number") {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) continue;
      value = n;
    } else if (def.type === "boolean") {
      value = raw === true || raw === "true";
    } else if (def.type === "select") {
      // A value outside the declared choices is dropped, not stored blindly.
      if (Array.isArray(def.options) && !def.options.includes(String(raw))) continue;
      value = String(raw);
    } else if (def.type === "text" || def.type === "sequence") {
      value = sanitizeHtmlWithDiagnostics(String(raw)).value;
    }

    out[def.key] = value;
  }

  // FR-29: keep a stored sequence identifier the current variant does not declare.
  const declaredKeys = new Set((declared ?? []).map((d) => d.key));
  for (const [key, value] of Object.entries(existing ?? {})) {
    if (!declaredKeys.has(key) && !(key in out) && isSequenceKey(key)) out[key] = value;
  }

  return out;
}

/**
 * Keys that carry a sequence identifier and therefore survive undeclared. The
 * setting is identified by its stored key: the variant that declared it is gone,
 * so its type declaration is unavailable at this point.
 */
function isSequenceKey(key: string): boolean {
  return key === "sequenceId";
}
