/**
 * @module shared/template/content-page
 *
 * Content-page assembly, shared by both learner hosts.
 *
 * A content page is authored as a set of named values against a content TEMPLATE
 * (the design template's `contentTemplates[]` entry, which declares the
 * placeholders). Rendering it is two steps:
 *
 *   1. build a skeleton of `[data-placeholder]` regions from the template — this
 *      module;
 *   2. mount it into the page layout's `page-content` slot and fill the regions —
 *      {@link renderScreenInto} already does that via its `content` input.
 *
 * Step 2 was shared from the start; step 1 existed only inside the SCORM runtime
 * (`server/scorm/template/app/render/contentPage.js`), which is why the web host
 * could not render content pages at all (PRD-12 FR-6). Both hosts now build the
 * same skeleton from the same code, so the two cannot drift.
 *
 * Framework-free and browser-safe: bundled verbatim into the SCORM package.
 */

import type { PlaceholderDef } from "./render-screen";

/** A content template from the design template manifest (subset). */
export interface ContentTemplateDef {
  key: string;
  /** `info` | `intro` | `summary` | `gallery` | … — drives special-cased layouts. */
  kind?: string | null;
  /** Layout file this variant renders into; falls back to the `content` layout. */
  layoutFile?: string | null;
  /** Marks the variant a page of this kind falls back to (PRD-1 §4.3.2). */
  isDefault?: boolean;
  placeholders?: PlaceholderDef[];
}

/** The content page as stored (subset needed to render it). */
export interface RenderableContentPage {
  id?: string;
  kind?: string | null;
  type?: string | null;
  mode?: string | null;
  templateKey?: string | null;
  valuesJson?: { values?: Record<string, unknown>; placeholderStyles?: Record<string, unknown> } | null;
  /** Legacy shape, still read by older packages. */
  values?: Record<string, unknown>;
  placeholderStyles?: Record<string, unknown>;
}

/** Escapes for attribute/text interpolation (matches the renderer's twin). */
function escHtml(s: unknown): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The author-filled values for a page, across both storage shapes. */
export function getPageValues(page: RenderableContentPage | null | undefined): Record<string, unknown> {
  if (!page) return {};
  if (page.valuesJson && page.valuesJson.values) return page.valuesJson.values;
  return page.values || {};
}

/** Per-placeholder style overrides for a page, across both storage shapes. */
export function getPagePlaceholderStyles(
  page: RenderableContentPage | null | undefined,
): Record<string, unknown> {
  if (!page) return {};
  if (page.valuesJson && page.valuesJson.placeholderStyles) return page.valuesJson.placeholderStyles;
  return page.placeholderStyles || {};
}

/** Resolves the content template a page is bound to, or null when unbound. */
export function findContentTemplate(
  page: RenderableContentPage | null | undefined,
  contentTemplates: ContentTemplateDef[] | null | undefined,
): ContentTemplateDef | null {
  if (!page || !contentTemplates) return null;
  const key = page.templateKey;
  if (!key) return null;
  for (const template of contentTemplates) {
    if (template.key === key) return template;
  }
  return null;
}

/**
 * The variant a page of `kind` falls back to: the one marked `isDefault`, else the
 * first declared for that kind (PRD-1 §4.3.2). Null when the template declares
 * none — then there is nothing to render the page through.
 */
export function findDefaultContentTemplate(
  kind: string | null | undefined,
  contentTemplates: ContentTemplateDef[] | null | undefined,
): ContentTemplateDef | null {
  if (!contentTemplates || !kind) return null;
  let first: ContentTemplateDef | null = null;
  for (const template of contentTemplates) {
    if (template.kind !== kind) continue;
    if (template.isDefault) return template;
    if (!first) first = template;
  }
  return first;
}

/**
 * The variant a page actually RENDERS through: the one it is bound to, or — when
 * that variant is not in this template — the kind's default (see
 * {@link findDefaultContentTemplate}).
 *
 * The substitution is a rendering decision only: `templateKey` in the database is
 * never rewritten, so the author's binding survives switching the design template
 * back, and «Структура» keeps flagging the page as needing a mapping. Before this,
 * an unbound page fell all the way through to {@link buildFallbackContentHtml} —
 * an untemplated card that looked nothing like the rest of the test and hid, rather
 * than showed, that a decision was pending.
 * @returns the variant to render through, and whether it is a substitute
 */
export function resolveContentTemplate(
  page: RenderableContentPage | null | undefined,
  contentTemplates: ContentTemplateDef[] | null | undefined,
): { template: ContentTemplateDef | null; substituted: boolean } {
  const bound = findContentTemplate(page, contentTemplates);
  if (bound) return { template: bound, substituted: false };
  const fallback = findDefaultContentTemplate(page?.kind ?? page?.type, contentTemplates);
  return { template: fallback, substituted: fallback !== null };
}

/**
 * Last-resort markup for a page with no usable content template — an author page
 * still renders its title and body rather than showing a blank screen with just
 * «Далее». `html`-mode pages pass their authored markup through.
 */
export function buildFallbackContentHtml(page: RenderableContentPage): string {
  const typeLabel = page.type || "content";
  const values = getPageValues(page);
  if (page.mode === "html" && values.__html) {
    return '<div class="content-page content-page--html">' + String(values.__html) + "</div>";
  }
  const title = values.title || values.heading || typeLabel;
  const body = values.body || values.text || values.subtitle || "";
  return (
    '<div class="content-page content-page--fallback" data-page-type="' +
    escHtml(typeLabel) +
    '">' +
    '<div class="card">' +
    "<h1>" +
    escHtml(String(title)) +
    "</h1>" +
    (body ? '<div style="color:hsl(var(--muted-foreground));">' + String(body) + "</div>" : "") +
    "</div>" +
    "</div>"
  );
}

/**
 * Builds the page skeleton: one `[data-placeholder]` region per placeholder the
 * content template declares, in declaration order. `renderScreenInto` fills these
 * from the page's values (by placeholder type, resultField через the renderer
 * registry), so the skeleton carries structure only — never author content.
 */
export function buildContentPageSkeleton(
  page: RenderableContentPage,
  contentTemplate: ContentTemplateDef | null | undefined,
): string {
  if (!contentTemplate || !contentTemplate.placeholders) {
    return buildFallbackContentHtml(page);
  }
  let html =
    '<div class="content-page content-page--' +
    escHtml(page.type || "info") +
    '" data-template-key="' +
    escHtml(contentTemplate.key) +
    '">';
  for (const phDef of contentTemplate.placeholders) {
    html +=
      '<div class="content-placeholder content-placeholder--' +
      escHtml(phDef.key) +
      '" data-placeholder="' +
      escHtml(phDef.key) +
      '"></div>';
  }
  html += "</div>";
  return html;
}

/**
 * Everything a host needs to render one content page through
 * {@link renderScreenInto}: which layout to use, the slot HTML, and the
 * placeholder data.
 *
 * Layout choice mirrors the SCORM runtime (spec §8.2): the variant's OWN
 * `layoutFile` wins — a template may ship one layout per page, and resolving
 * everything through the single `content` key would render them all as whichever
 * page that key happens to point at. Falls back to the generic `content` layout.
 */
export function buildContentPageRender(
  page: RenderableContentPage,
  contentTemplates: ContentTemplateDef[] | null | undefined,
): {
  layoutKey: string;
  skeleton: string;
  content: { template: { placeholders?: PlaceholderDef[] }; values: Record<string, unknown> };
  placeholderStyles: Record<string, unknown>;
  contentTemplate: ContentTemplateDef | null;
  /** True when the page's own variant is unavailable and a default stood in. */
  substituted: boolean;
} {
  const { template: contentTemplate, substituted } = resolveContentTemplate(page, contentTemplates);
  return {
    layoutKey: (contentTemplate && contentTemplate.layoutFile) || "content",
    skeleton: buildContentPageSkeleton(page, contentTemplate),
    content: {
      template: { placeholders: contentTemplate?.placeholders },
      values: getPageValues(page),
    },
    placeholderStyles: getPagePlaceholderStyles(page),
    contentTemplate,
    substituted,
  };
}
