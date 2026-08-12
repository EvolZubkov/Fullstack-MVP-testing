/**
 * @module server/services/template-render
 *
 * Assembles the render payload the web template host needs for a screen (PRD-12
 * web-host): the design template's layout HTML, its CSS, and the runtime context.
 * The server owns templates (spec §2.1) — it reads the selected template's files
 * and ships `{ layout, css, context }` to the client, which mounts the unified
 * renderer ({@link module:shared/template/render-screen}). Defensive: any read or
 * build failure yields `null`, so the result endpoint degrades to its legacy
 * (React-markup) rendering rather than erroring.
 *
 * This module is intentionally db-free: it reads files from an already-resolved
 * template DIRECTORY. The caller resolves which directory (built-in or uploaded)
 * via {@link module:server/services/template-dir}, which owns the db lookup. This
 * keeps the pure render-payload assembly testable without a database.
 */

import fs from "node:fs";
import path from "node:path";
import { buildResultContext, buildAdaptiveResultContext, type MeasuresSource } from "./result-context";
import { buildTemplateCssVars, type TemplateParamDef } from "@shared/template/params-css";
import { buildPaletteBridge } from "@shared/template/palette-bridge";
import { baseParams, buildTemplateThemeCss, sceneThemeAttribute } from "@shared/template/theme-css";
import { resolveThemeParams } from "@shared/template/theme-params";
import { supportsThemes } from "@shared/template/themes";
import type { StoredDesignSettings } from "@shared/template/theme-params";
import type { LabelDeclaration } from "@shared/template/labels";
import type { TemplateBlockOrder, ResultsBlockKey } from "@shared/template/results-order";
import type { AttemptResult } from "@shared/schema";
import {
  resolveReportVariant,
  resolveReportValues,
  type ReportKind,
} from "@shared/report/report-variants";
import { reportImageKeys, resolveReportImageValues } from "@shared/report/report-assets";

/**
 * Where the browser reaches ONE template's own files (`GET /api/templates/:id/assets/*`).
 *
 * The web host has no package directory to resolve template-relative paths against, so
 * a report variant's pictures are addressed through that route (PRD-27 FR-05).
 *
 * @param templateId Template whose files back the report page.
 */
function templateAssetBase(templateId: string): string {
  return `/api/templates/${encodeURIComponent(templateId)}/assets/`;
}

/**
 * The test's stored design settings, as the routes read them off the test row.
 * PRD-23 widened this from a bare param map: colours now live per theme.
 */
export type DesignSettingsInput = StoredDesignSettings;

/** What the web host needs to render one screen via the unified renderer. */
export interface ScreenRenderPayload {
  layout: string;
  css: string;
  context: unknown;
  /** Resolved theme tokens so the embedding host can match the template surface. */
  theme: { background: string; foreground: string };
  /**
   * Per-test design-param overrides as CSS custom properties (PRD-7 branding),
   * built from the test's `designSettingsJson.params` + the template manifest via
   * the SHARED {@link module:shared/template/params-css buildTemplateCssVars} —
   * the SAME mapping the SCORM runtime bakes in, so colours/font render identically
   * on both hosts. Applied on the {@link TemplateScreen} shadow host. Omitted when
   * no param resolves a CSS variable.
   */
  cssVars?: Record<string, string>;
  /**
   * PRD-23: the test's per-theme colour overrides as a CSS block, printed by the
   * SHARED {@link module:shared/template/theme-css buildTemplateThemeCss} against
   * the `:host` selector (the web host renders inside a shadow root). Injected
   * AFTER the template stylesheet so the test's palette wins. Omitted for a
   * template that declares no themes — its colours travel in `cssVars` as before.
   */
  themeCss?: string;
  /**
   * PRD-23: the palette the author pinned, put on the scene root as `data-theme`.
   * Omitted for «Авто» — the attribute must be ABSENT for the template's own
   * `prefers-color-scheme` rules to decide.
   */
  dataTheme?: "light" | "dark";
  /**
   * PRD-23: whether the ACTIVE template declares a choice of palettes. Under «Авто»
   * the host needs it to pick the same palette the package picks (see the shared
   * `resolveSceneTheme`): a template without themes ships ONE palette — the dark
   * one for the bundled «Стандартный» — so following the viewer's system setting
   * there would paint a light scene the template has no design for.
   */
  themed?: boolean;
  /**
   * Per-test branding for the render context (`design.*`, PRD-7). The client spreads
   * this into the context it builds for client-built screens (start/question/blocked);
   * for the results screen the context is server-built and already carries it.
   * Omitted when the test has no logo. The logo param is stored as a media envelope
   * `{ url, name, … }`; `.url` is extracted here so the layout binds a plain string.
   *
   * `startImageUrl` is the start screen's illustration. It leaves this builder as the
   * TEST-WIDE branding value; the start-screen route then resolves it per PRD-22 —
   * the page's own property first, and nothing at all for a variant that does not
   * declare one (`startImageForVariant`).
   */
  design?: { logoUrl?: string; startImageUrl?: string };
  /**
   * PRD-29: the test's design params RESOLVED against the ACTIVE template's manifest
   * — the very resolution the CSS variables above are printed from, handed out so a
   * consumer can read the params that carry no CSS variable at all (the level colour
   * scheme, the render kinds of scales and indicators). Resolving the design a
   * SECOND time next to the payload is what this field exists to prevent: the two
   * calculations would drift on the first edit of either.
   *
   * PRD-23 caveat: a themed template keeps its COLOUR params per palette, so the
   * pinned palette's colours are folded in; under «Авто» the palette is only chosen
   * in the browser, so only the palette-independent params travel.
   *
   * Omitted when the test overrides nothing.
   */
  params?: Record<string, unknown>;
}

/**
 * Resolve the design `logoUrl` to a plain URL string. The author stores it as a
 * media envelope `{ url, name, … }` (or, for legacy/string values, a bare URL);
 * the layout binds a string, so the envelope is unwrapped here.
 */
function resolveMediaUrl(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (value && typeof value === "object" && typeof (value as { url?: unknown }).url === "string") {
    return (value as { url: string }).url || undefined;
  }
  return undefined;
}

/** Extract a CSS custom property value (e.g. `--background`) from a stylesheet. */
function cssVar(css: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;}]+)`).exec(css);
  return m ? m[1].trim() : "";
}

/**
 * Presence of a design custom property (e.g. `--primary`) in the resolved payload.
 * A colour param lands in the inline `cssVars` for a plain template, or in the
 * `themeCss` block for a PRD-23 themed one — and when the AUTHOR set nothing, the
 * property still exists: the TEMPLATE'S OWN stylesheet declares it. All three count.
 *
 * Why the template's own stylesheet must count: the editor shows an unset colour row
 * as INHERITED from the template (`extractThemeTokens` over this very stylesheet), so
 * the scene has to paint that inherited colour. Keying the bridge on author params
 * alone broke exactly that promise — a template whose brand lives in `theme.css` with
 * `default: null` params (the PRD-23 pattern) rendered the DS purple until the author
 * retyped the colour the editor was already showing them. The `default` template hid
 * it, its `theme.css` primary BEING the DS purple, and the package never had it
 * (`assemblePackageStyles` fires the bridge unconditionally) — so the same test came
 * out orange in the export and purple on the web.
 *
 * Firing on mere presence is safe: the bridge emits `hsl(var(--primary))`, a LIVE
 * reference, so whatever wins the cascade — author param or template default — is what
 * paints. A template that declares no palette at all still gets no bridge and keeps
 * the DS defaults.
 */
function paletteVar(
  name: string,
  cssVars: Record<string, string>,
  themeCss: string,
  templateCss: string,
): string | undefined {
  if (cssVars[name] != null) return cssVars[name];
  return themeCss.includes(`${name}:`) || templateCss.includes(`${name}:`) ? "1" : undefined;
}

function readFileSafe(p: string): string {
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  } catch {
    return "";
  }
}

/**
 * Read a template's manifest `params[]` (the CSS-var definitions) from its dir.
 * Empty on any read/parse failure — branding then simply falls back to theme.css.
 */
function readManifestParams(dir: string): TemplateParamDef[] {
  return readBrandingManifest(dir).params ?? [];
}

/**
 * Read the part of a template's manifest that branding needs: `params[]` (the
 * CSS-var definitions) and `themes[]` (PRD-23, which palettes exist). Empty on any
 * read/parse failure — branding then simply falls back to theme.css.
 */
function readBrandingManifest(dir: string): { params?: TemplateParamDef[]; themes?: unknown } {
  try {
    const raw = readFileSafe(path.join(dir, "manifest.json"));
    if (!raw) return {};
    const manifest = JSON.parse(raw) as { params?: TemplateParamDef[]; themes?: unknown };
    return {
      params: Array.isArray(manifest.params) ? manifest.params : [],
      themes: manifest.themes,
    };
  } catch {
    return {};
  }
}

/**
 * PRD-49 sections of a template manifest: the interface labels the template declares
 * (`labels[]`) and the per-screen composition/order of the results sub-blocks
 * (`resultsBlockOrder`).
 */
export interface ResultsDeclarations {
  /** `manifest.labels[]`; EMPTY for a template that declares none (spec §9). */
  labels: LabelDeclaration[];
  /** `manifest.resultsBlockOrder`; `null` when the template declares nothing. */
  blockOrder: TemplateBlockOrder | ResultsBlockKey[] | null;
}

/**
 * Read the PRD-49 declarations of ONE template from its manifest.
 *
 * Read from the SAME on-disk manifest the report-variant bake reads
 * (`server/scorm/index.ts`), so the web host and the SCORM package resolve the author's
 * wording against the very same declarations — the point of PRD-49 §2.5.
 *
 * Empty on any read/parse failure, and empty is meaningful: a template that declares no
 * labels keeps printing the hard-coded strings of its own layouts, so the caller must not
 * hand an empty map to the context builder (that would replace «no labels key at all»
 * with an empty tree).
 */
export function readResultsDeclarations(dir: string): ResultsDeclarations {
  try {
    const raw = readFileSafe(path.join(dir, "manifest.json"));
    if (!raw) return { labels: [], blockOrder: null };
    const manifest = JSON.parse(raw) as { labels?: unknown; resultsBlockOrder?: unknown };
    return {
      labels: Array.isArray(manifest.labels) ? (manifest.labels as LabelDeclaration[]) : [],
      blockOrder:
        (manifest.resultsBlockOrder as TemplateBlockOrder | ResultsBlockKey[] | undefined) ?? null,
    };
  } catch {
    return { labels: [], blockOrder: null };
  }
}

/**
 * Read a template's manifest `contentTemplates[]` — the per-variant placeholder
 * declarations a content page is authored against.
 *
 * PRD-12 FR-6: the web host needs these to build the SAME page skeleton the SCORM
 * runtime builds (`shared/template/content-page`). In the SCORM package the array
 * ships inside the bundle; on the web it has to travel with the screen assets, or
 * the host can only ever render the untemplated fallback.
 */
export function readManifestContentTemplates(dir: string): unknown[] {
  try {
    const raw = readFileSafe(path.join(dir, "manifest.json"));
    if (!raw) return [];
    const manifest = JSON.parse(raw) as { contentTemplates?: unknown[] };
    return Array.isArray(manifest.contentTemplates) ? manifest.contentTemplates : [];
  } catch {
    return [];
  }
}

/**
 * Read the layout HTML of every variant that names one, keyed by its `layoutFile`
 * path — the key the shared resolver looks a variant-backed layout up by (spec
 * §8.2, `shared/template/content-page`).
 *
 * PRD-12 FR-6 parity: the SCORM package ships all of these, so a variant with its
 * own layout renders through it in the package. The web host was served only the
 * generic `content.html` wrapper, which meant every such variant — the whole PRD-22
 * variant grid — collapsed into one look in the web run. Reading them here is what
 * lets the two hosts render the same page the same way.
 *
 * `layoutFile` comes from a manifest, which for an uploaded template is untrusted
 * input, so a path that escapes the template directory is dropped rather than read.
 * @param dir  Resolved template directory
 * @returns layout HTML keyed by the declared `layoutFile` path (empty on failure)
 */
export function readVariantLayouts(dir: string): Record<string, string> {
  const layouts: Record<string, string> = {};
  const root = path.resolve(dir);
  for (const raw of readManifestContentTemplates(dir)) {
    const rel = (raw as { layoutFile?: unknown })?.layoutFile;
    if (typeof rel !== "string" || !rel || layouts[rel] != null) continue;
    const full = path.resolve(root, rel);
    if (full !== root && !full.startsWith(root + path.sep)) continue;
    const html = readFileSafe(full);
    if (html) layouts[rel] = html;
  }
  return layouts;
}

/**
 * Read a named screen's template ASSETS (layout HTML + css + theme tokens) without
 * building a context — for screens whose context the client assembles itself
 * (e.g. the start screen). Returns null when the layout file is missing.
 *
 * `dir` is an already-resolved template directory (see
 * {@link module:server/services/template-dir resolveTemplateDir}) — a built-in
 * (`server/scorm/templates/<id>`) or uploaded (`uploads/templates/<id>`) path.
 */
export function readScreenTemplate(
  dir: string,
  layoutFile: string,
  /**
   * The test's WHOLE design settings, not just `params`: PRD-23 splits colours
   * across `paramsByTheme` and the pinned `theme` lives beside them.
   */
  design?: DesignSettingsInput | null,
  paramsDir?: string,
): Omit<ScreenRenderPayload, "context"> | null {
  try {
    const layout = readFileSafe(path.join(dir, "layouts", layoutFile));
    if (!layout) return null;
    const css = [
      readFileSafe(path.join(dir, "styles", "base.css")),
      readFileSafe(path.join(dir, "styles", "theme.css")),
    ]
      .filter(Boolean)
      .join("\n");
    // PRD-7 branding: resolve the per-test design params against the ACTIVE
    // template's manifest into CSS-var overrides — the SAME single-source mapping
    // the SCORM runtime uses (`templateCore.buildCssVarDeclarations`), so the web
    // host applies the author's colours/font instead of only theme.css defaults.
    // The manifest comes from `paramsDir` (the active template the params were set
    // against) so a screen whose LAYOUT falls back to `default` still resolves the
    // active template's params — parity with SCORM's global cssVar application.
    //
    // PRD-23: a template with themes paints its colours per palette, so those keys
    // leave `cssVars` (inline, unscopable) and become a CSS block instead. For a
    // template without themes `baseParams` is the whole param set and `themeCss` is
    // empty — the payload is byte-identical to what it was before.
    const manifest = readBrandingManifest(paramsDir || dir);
    const resolved = resolveThemeParams(design, manifest);
    const base = resolved.base;
    const cssVars = buildTemplateCssVars(base, manifest.params);
    const themeCss = buildTemplateThemeCss(design, manifest, { rootSelector: ":host" });
    const dataTheme = sceneThemeAttribute(design, manifest);
    const logoUrl = resolveMediaUrl(base?.logoUrl);
    const startImageUrl = resolveMediaUrl(base?.startImageUrl);
    const design_ = { ...(logoUrl ? { logoUrl } : {}), ...(startImageUrl ? { startImageUrl } : {}) };
    // Ревизия «Стандартный» на ui-kit: подмешать мост палитры DS. Он выводит
    // акцентную рампу --ou-purple-* из --primary теста (и поверхности из
    // --background/--card/--border), поэтому .ou-разметка ученических экранов
    // брендируется палитрой теста. Ссылки на var(--…) — живые, значение
    // подставляет активная тема (cssVars инлайном / themeCss на :host).
    const bridge = buildPaletteBridge({
      primary: paletteVar("--primary", cssVars, themeCss, css),
      background: paletteVar("--background", cssVars, themeCss, css),
      card: paletteVar("--card", cssVars, themeCss, css),
      border: paletteVar("--border", cssVars, themeCss, css),
    });
    // PRD-29: the params Core reads (level scheme, render kinds, custom ramp colours)
    // come from THIS resolution, not from a second one. A pinned palette contributes
    // its colours; under «Авто» there is no server-side answer to which palette the
    // browser will paint, so only the palette-independent params travel.
    const params = { ...base, ...(dataTheme ? resolved.byTheme[dataTheme] ?? {} : {}) };
    return {
      layout,
      css: bridge ? `${css}\n${bridge}` : css,
      theme: { background: cssVar(css, "background"), foreground: cssVar(css, "foreground") },
      ...(Object.keys(cssVars).length > 0 ? { cssVars } : {}),
      ...(themeCss ? { themeCss } : {}),
      ...(dataTheme ? { dataTheme } : {}),
      ...(supportsThemes(manifest) ? { themed: true } : {}),
      ...(Object.keys(params).length ? { params } : {}),
      ...(Object.keys(design_).length ? { design: design_ } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Completes the caller's measures source with what the payload already knows.
 *
 * Two things travel from here rather than from the route. The design params are the
 * ONE resolution {@link readScreenTemplate} did for this very screen, so the ramp and
 * the render kinds can never disagree with the CSS the screen is painted with. The
 * measured VALUES are read off the SAVED {@link AttemptResult} and are never
 * recomputed: grading a finished attempt again against today's configuration would
 * change what the learner already scored.
 *
 * A caller that supplies either of them keeps its own — nothing is overwritten
 * silently.
 *
 * Exported because the ROUTE completes the very same source a second time: the results
 * response carries the measurements on to the browser, which builds the PDF report from
 * them, and that copy has to be the SAME one the screen was painted from. It takes the
 * payload's own `params` (see {@link ScreenRenderPayload.params}), so the completion
 * rule stays in one place instead of being re-derived at the route.
 */
export function completeMeasuresSource(
  measures: MeasuresSource,
  payloadParams: Record<string, unknown> | undefined,
  // The stored result, of EITHER mode: only the two computed namespaces are read off it,
  // and since issue #33 an adaptive result carries them too (`adaptiveAttemptResultSchema`).
  result: Pick<AttemptResult, "scaleResults" | "resultVariables">,
): MeasuresSource {
  return {
    ...measures,
    params: { ...payloadParams, ...measures.params },
    scaleResults:
      measures.scaleResults ?? ((result.scaleResults ?? {}) as NonNullable<MeasuresSource["scaleResults"]>),
    variableValues: measures.variableValues ?? result.resultVariables ?? {},
  };
}

/**
 * Build the render payload for the RESULTS screen of a completed standard attempt.
 * Returns null when the layout is missing or the result is not a standard result
 * (e.g. adaptive), so the caller can fall back to legacy rendering.
 *
 * `measures` carries the material of the results screen: the test's scales and
 * indicators with their block settings (PRD-29) AND the test's own feedback block
 * (PRD-32). It is NOT a statement that the test measures anything — the caller hands it
 * over for every standard attempt, and `buildResultContext` decides what the emptiness
 * of the scale/indicator arrays means. The ADAPTIVE branch takes it as well, but reads
 * ONLY the test's own feedback block out of it — an adaptive result composes its own
 * levels and measures nothing.
 */
export function readResultsRenderPayload(
  dir: string,
  result: AttemptResult | (Record<string, unknown> & { mode?: string }),
  testTitle: string,
  design?: DesignSettingsInput | null,
  paramsDir?: string,
  subtitle?: string,
  measures?: MeasuresSource,
): ScreenRenderPayload | null {
  try {
    const isAdaptive = (result as { mode?: string }).mode === "adaptive";
    const base = readScreenTemplate(
      dir,
      isAdaptive ? "results.adaptive.html" : "results.html",
      design,
      paramsDir,
    );
    if (!base) return null;
    // ONE call, not a fork on `measures`. The fork used to hand the builder two
    // arguments whenever the material was absent, which quietly dropped everything
    // the material carries besides measurements — the test's own feedback block above
    // all. The builder already treats an absent third argument as «nothing to add».
    // BOTH branches complete the material the same way — with the design params of THIS
    // screen and the values stored WITH the attempt. Until issue #33 the adaptive branch
    // took the material raw and read only the test's own feedback out of it, on the
    // reading that «an adaptive result measures nothing»; it measures exactly what the
    // author hung on its questions, and the values were being computed and shipped to the
    // LMS while the screen showed none of them.
    const completed = measures ? completeMeasuresSource(measures, base.params, result as AttemptResult) : undefined;
    const context = isAdaptive
      ? buildAdaptiveResultContext(result, testTitle, completed)
      : buildResultContext(result as AttemptResult, testTitle, completed);
    // Header subtitle «Попытка N из M» (Core-prepared by the caller), same as the
    // other learner screens — merged into the server-built course context.
    if (subtitle) (context as { course: { subtitle?: string } }).course.subtitle = subtitle;
    // The results context is server-built, so merge branding straight in (the
    // client passes `render.context` verbatim to the renderer).
    if (base.design) (context as { design?: { logoUrl?: string } }).design = base.design;
    return { ...base, context };
  } catch {
    return null;
  }
}

/**
 * Render payload for the attempt REPORT (PRD-27 Фаза 2): the chosen variant's layout,
 * its own stylesheet and the design tokens the page may use.
 *
 * Deliberately does NOT include `base.css`/`theme.css`: the report renders outside the
 * scene and must not depend on the scene layer (§6.3). The palette reaches it as CSS
 * variables (`cssVars`) plus the per-theme block (`themeCss`), which the browser applies
 * to the report container.
 *
 * @param dir Template directory the report layout comes from — the active template, or
 *   `default` when the active one declares no variant of this kind (FR-10).
 * @param kind Report kind matching the test's mode.
 * @param authored Выбор автора теста (`tests.report_settings_json`, ветка режима): ключ
 *   варианта и значения его полей. `null` — автор ничего не выбирал.
 * @param design The test's design settings (branding / pinned palette).
 * @param paramsDir Directory whose manifest the design params were set against — the
 *   ACTIVE template, even when the layout falls back to `default`.
 * @param assetTemplateId Template id whose files back this variant's pictures — the id
 *   `GET /api/templates/:id/assets/*` serves (PRD-27 FR-05). It follows the LAYOUT, so
 *   on a fallback it is `default`, not the active template. Omitted (dev/tests) leaves
 *   template-relative paths unresolved rather than pointing them at the wrong template.
 * @returns Payload, or `null` when this directory offers no such variant.
 */
export function readReportRenderPayload(
  dir: string,
  kind: ReportKind,
  authored: { variantKey?: string | null; values?: Record<string, unknown> | null } | null | undefined,
  design?: DesignSettingsInput | null,
  paramsDir?: string,
  assetTemplateId?: string,
): {
  layout: string;
  css: string;
  variantKey: string;
  values: Record<string, unknown>;
  imageKeys: string[];
  cssVars?: Record<string, string>;
  themeCss?: string;
  design?: Record<string, string>;
} | null {
  try {
    const raw = readFileSafe(path.join(dir, "manifest.json"));
    if (!raw) return null;
    const manifest = JSON.parse(raw) as unknown;
    const variant = resolveReportVariant(manifest, kind, authored?.variantKey ?? null);
    if (!variant?.layoutFile) return null;
    const layout = readFileSafe(path.join(dir, variant.layoutFile));
    if (!layout) return null;
    const css = variant.styleFile ? readFileSafe(path.join(dir, variant.styleFile)) || "" : "";

    const brandingManifest = readBrandingManifest(paramsDir || dir);
    const base = baseParams(design, brandingManifest);
    const cssVars = buildTemplateCssVars(base, brandingManifest.params);
    // Токены отчёта ставятся на КОНТЕЙНЕР, а не на `:host`: сцены здесь нет.
    const themeCss = buildTemplateThemeCss(design, brandingManifest, { rootSelector: ".tb-report" });
    const logoUrl = resolveMediaUrl(base?.logoUrl);
    // FR-05: картинки варианта — файлы шаблона, а браузеру они видны только через
    // роут ассетов. Инлайнит их в data-URL уже клиент: сюда они не кладутся, чтобы
    // ответ с результатом попытки не тащил сотни килобайт base64.
    const imageKeys = reportImageKeys(variant);
    const values = resolveReportValues(variant, authored?.values ?? null);
    return {
      layout,
      css,
      variantKey: variant.key,
      values: assetTemplateId
        ? resolveReportImageValues(values, imageKeys, templateAssetBase(assetTemplateId))
        : values,
      imageKeys,
      ...(Object.keys(cssVars).length > 0 ? { cssVars } : {}),
      ...(themeCss ? { themeCss } : {}),
      ...(logoUrl ? { design: { logoUrl } } : {}),
    };
  } catch {
    return null;
  }
}
