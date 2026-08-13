/**
 * @module features/tests/editor/use-design-settings
 * @description React hook for loading and editing a test's design settings.
 *
 * Responsibilities:
 *   - Fetch the test's current design settings (`GET /api/tests/:id/design`).
 *     Empty / missing settings fall back to `{ templateId: "default" }`.
 *   - Fetch the active template record by id (`GET /api/templates/:id`) so the
 *     Branding pane can render a dynamic parameter form keyed by the manifest.
 *   - Own a local `draft` state separate from the main editor draft — design
 *     persists via its own endpoint (`PUT /api/tests/:id/design`) and has its
 *     own dirty flag.
 *   - Provide a `save()` mutation that resolves with the persisted settings
 *     and invalidates the design query.
 *
 * Anti-goals:
 *   - This hook is intentionally scoped to ONE template at a time. The
 *     "Заменить шаблон" gallery flow (FR-30 / FR-31) is deferred to a later
 *     step and is not orchestrated here.
 *   - No local-storage persistence (FR-25j).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { resolveThemeParams } from "@shared/template/theme-params";
import {
  declaredThemes,
  type TemplateThemeDef,
  type TestTheme,
  type ThemeId,
} from "@shared/template/themes";
import type { LabelDeclaration, LabelValues } from "@shared/template/labels";
import type { ResultsBlockKey, TemplateBlockOrder } from "@shared/template/results-order";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DesignParamType =
  | "text"
  | "color"
  | "boolean"
  | "select"
  | "multiselect"
  | "number"
  | "url"
  | "image"
  | "asset"
  | "file"
  | "downloadLink";

/**
 * PRD-7 S12 G1 / FR-31: rail-section the param is rendered under in the
 * «Оформление» tab. `branding` is the default fallback for params without an
 * explicit assignment, mirroring how the design-tab rail keeps three content
 * sections (Брендирование / Макет / Прогресс и шапка) regardless of which
 * sections a template populates.
 */
export type ParamSection = "branding" | "layout" | "progress";

export type TemplateParam = {
  key: string;
  type: DesignParamType;
  label: string;
  /**
   * PRD-22 (plan Э8): what this parameter actually paints, in the template
   * author's own words. A colour label names the token, not the screen element,
   * so without this the test author sets «Акцентный цвет» and has to guess where
   * it will show up. Rendered under the control; absent ⇒ nothing is rendered.
   */
  description?: string;
  default?: unknown;
  /** Visual sub-group label rendered inside a section (e.g. "Цвета"). */
  group?: string;
  /** Rail-section the param belongs to. Defaults to `branding` when absent. */
  section?: ParamSection;
  options?: string[];
  /**
   * Human-readable labels for `options`, keyed by option value. Falls back to
   * the raw value when an option has no entry. Lets the manifest localise enum
   * choices (e.g. progress.mode `questions` → «По вопросам»).
   */
  optionLabels?: Record<string, string>;
  /** PRD-7 S12-G4 media params: client-side validation hint, mime/ext list. */
  accept?: string;
  /** PRD-7 S12-G4 media params: max upload size in kilobytes. */
  maxSizeKb?: number;
  /** PRD-7 S12-G4 number params: validation bounds. */
  min?: number;
  max?: number;
  step?: number;
};

/**
 * PRD-7 S12-G4: persisted value shape for media-typed params (image/asset/
 * file/downloadLink). All four serialise to the same envelope so the
 * design-tab payload stays simple; the runtime template treats them
 * uniformly. `mediaId` is reserved for future medialib integration — for
 * now we only persist the public `url` returned by /api/media/upload.
 */
export type MediaParamValue = {
  url: string;
  name: string;
  mime?: string;
  size?: number;
  /** Reserved for medialib id (future); currently never set by upload. */
  mediaId?: string;
  /** downloadLink only: optional display label shown next to the file. */
  label?: string;
};

export type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  version: string;
  templateApiVersion: string;
  isBuiltin: boolean;
  isActive: boolean;
  manifest: {
    id: string;
    name: string;
    version: string;
    description?: string;
    templateApiVersion: string;
    params?: TemplateParam[];
    /**
     * Package assets. `preview` is the template's own thumbnail, rendered by
     * {@link module:features/tests/editor/sections/template-thumb} and served via
     * `/api/templates/:id/assets/*`.
     */
    assets?: { preview?: string | null } | null;
    /** PRD-23: palettes the template ships. Absent/short = no choice of theme. */
    themes?: TemplateThemeDef[];
    /**
     * PRD-49 §4.1: the interface labels of the results screens this template declares.
     * Absent (or empty) = the template prints its own hard-coded strings and the
     * «Итоги» pane is not offered — there is nothing for the author to reword.
     */
    labels?: LabelDeclaration[];
    /** PRD-49 §3: composition and order of the results sub-blocks, per screen. */
    resultsBlockOrder?: TemplateBlockOrder | ResultsBlockKey[];
  };
  /**
   * NOT the thumbnail: the `templates.preview_path` column is never populated by
   * any code path and is null for every row. The thumbnail lives in
   * `manifest.assets.preview`.
   */
  previewPath: string | null;
  /**
   * PRD-49: which of the declared labels the REPORT prints. NOT part of the manifest —
   * the route computes it from the report layouts of this template (or of «Стандартный»,
   * when this one declares no report variant), because only a layout knows what it
   * prints. The «Отчёт» pane offers exactly these rows; absent (an older server, a
   * template that could not be read) means «offer them all», the behaviour before this
   * field existed.
   */
  reportLabelKeys?: string[];
};

export type DesignSettings = {
  templateId: string;
  templateVersion?: string;
  templateApiVersion?: string;
  params?: Record<string, unknown>;
  /** PRD-23: palette pinned by the author; absent reads as «Авто». */
  theme?: TestTheme;
  /** PRD-23: colour overrides per palette. Only for a template with themes. */
  paramsByTheme?: Partial<Record<ThemeId, Record<string, unknown>>>;
  /**
   * PRD-49 §4.2: the test's own wording of the labels the template declares — only the
   * DEVIATIONS. A key that is absent means «the template's text stands», so the settings
   * of a test nobody reworded keep exactly the shape they had before the PRD.
   */
  labels?: LabelValues;
  /** PRD-49 §3: the author's order of the four sub-blocks under the results umbrella. */
  resultsBlockOrder?: ResultsBlockKey[];
};

export type UseDesignSettingsResult = {
  /** Whether either of the underlying queries is still loading. */
  isLoading: boolean;
  /** First error (design or template) if any of the queries failed. */
  error: Error | null;
  /** Current template definition (with manifest.params for the form). */
  template: TemplateRow | null;
  /** The mutable draft — params bound to the form inputs. */
  draft: DesignSettings;
  /** True when the draft differs from the persisted settings. */
  isDirty: boolean;
  /**
   * PRD-7 S12-G6 / wf-template-incompatible: design loaded, but the
   * persisted `templateId` cannot be resolved (404). The incompatible
   * banner replaces the template card and disables the other panes.
   */
  templateMissing: boolean;
  /**
   * PRD-3: the current draft records a `templateVersion` that differs from the
   * template's CURRENT version — the template's content was replaced under the
   * same id (re-upload / delete+reupload). The render uses the new files but the
   * saved `params` snapshot belongs to the old version. A banner offers a
   * one-click {@link refreshTemplateVersion} to re-stamp the version and drop
   * params that no longer exist in the new manifest; clicking it clears this flag
   * immediately (it follows the draft), then the author saves.
   */
  templateOutdated: boolean;
  /** Patch a single param key in the draft. */
  setParam: (key: string, value: unknown) => void;
  /** Remove an override so the template's own value applies again. */
  clearParam: (key: string) => void;
  /**
   * PRD-23: palettes the current template declares, in manifest order. Empty when
   * the template offers no choice — then the colour section stays a flat list.
   */
  themes: TemplateThemeDef[];
  /** The author's choice; `auto` when nothing is pinned. */
  theme: TestTheme;
  /** Pin the test to a palette, or hand it back to the viewer's setting. */
  setTheme: (theme: TestTheme) => void;
  /**
   * Colour overrides per palette, WITH the FR-17 read rule applied: a colour saved
   * flat before PRD-23 shows up as the value of every palette, so the author sees
   * what the learner sees instead of an empty cell.
   */
  themeParams: Partial<Record<ThemeId, Record<string, unknown>>>;
  /** Set one colour of one palette. */
  setThemeParam: (theme: ThemeId, key: string, value: unknown) => void;
  /** Drop one colour of one palette; the other palettes keep theirs. */
  clearThemeParam: (theme: ThemeId, key: string) => void;
  /**
   * PRD-49: replace the whole label layer of the draft. Whole layer, not one key: the
   * «Итоги» pane owns the map and decides when a key is dropped back to the template's
   * text, and a per-key setter would put that rule in two places.
   */
  setLabels: (labels: LabelValues) => void;
  /** PRD-49: the author's order of the results sub-blocks. */
  setResultsBlockOrder: (order: ResultsBlockKey[]) => void;
  /** Reset the draft to the manifest's defaults (clearing all params). */
  resetToDefaults: () => void;
  /**
   * PRD-7 S12-G3 / FR-33: switch the draft to an arbitrary template id,
   * clearing all params (semantically equivalent to `resetToDefaults` for
   * the new template). Used by `TemplateGalleryModal`.
   */
  setTemplate: (templateId: string) => void;
  /**
   * PRD-7 S12-G6: switch the draft to the built-in `default` template,
   * clearing all params. Used by the «Применить «Стандартный»» action in
   * the wf-template-incompatible banner.
   */
  applyDefaultTemplate: () => void;
  /**
   * PRD-3: reconcile the draft with the current template version — re-stamp
   * `templateVersion`/`templateApiVersion` to the loaded template and keep only
   * the params whose keys still exist in its manifest. Used by the
   * "template-outdated" banner. Marks the draft dirty; the author saves to
   * persist.
   */
  refreshTemplateVersion: () => void;
  /** Discard pending edits, reverting to the saved snapshot. */
  revert: () => void;
  /** Persist the draft via PUT. */
  save: () => Promise<DesignSettings>;
  isSaving: boolean;
  saveError: Error | null;
};

// ─── Network helpers ──────────────────────────────────────────────────────────

async function fetchDesign(testId: string): Promise<DesignSettings> {
  const res = await fetch(`/api/tests/${testId}/design`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to load design settings: ${res.status}`);
  }
  return res.json();
}

async function fetchTemplate(templateId: string): Promise<TemplateRow> {
  const res = await fetch(`/api/templates/${templateId}`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to load template ${templateId}: ${res.status}`);
  }
  return res.json();
}

async function putDesign(
  testId: string,
  body: DesignSettings,
): Promise<DesignSettings> {
  const res = await fetch(`/api/tests/${testId}/design`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to save design settings: ${res.status} ${text}`);
  }
  return res.json();
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDesignSettings(testId: string | undefined): UseDesignSettingsResult {
  const queryClient = useQueryClient();

  const designQuery = useQuery({
    queryKey: ["tests", testId, "design"],
    queryFn: () => fetchDesign(testId!),
    enabled: typeof testId === "string" && testId.length > 0,
  });

  const persisted: DesignSettings | undefined = designQuery.data;

  const [draft, setDraft] = useState<DesignSettings>({ templateId: "default" });

  // Sync the draft from the persisted settings as soon as they (re)load. Done
  // during render (React's "adjust state when a prop changes" pattern) rather than
  // in an effect, so `draft.templateId` follows the saved template within the SAME
  // commit. This is also what makes the gallery switch work: «Заменить шаблон»
  // mutates the draft, which re-points the manifest query below — updating the
  // template card and Branding form immediately, without waiting for a save.
  const [syncedFrom, setSyncedFrom] = useState<DesignSettings | undefined>(undefined);
  if (persisted && persisted !== syncedFrom) {
    setSyncedFrom(persisted);
    setDraft({ ...persisted, params: { ...(persisted.params ?? {}) } });
  }

  // The manifest follows the DRAFT template (not the persisted one), so switching
  // templates loads the new template's params/card right away.
  const templateQuery = useQuery({
    queryKey: ["templates", draft.templateId],
    queryFn: () => fetchTemplate(draft.templateId),
    enabled: Boolean(persisted) && Boolean(draft.templateId),
  });

  const isDirty = useMemo(() => {
    if (!persisted) return false;
    const norm = (s: DesignSettings) =>
      JSON.stringify({ ...s, params: s.params ?? {} });
    return norm(persisted) !== norm(draft);
  }, [draft, persisted]);

  const setParam = (key: string, value: unknown) => {
    setDraft((d) => ({ ...d, params: { ...(d.params ?? {}), [key]: value } }));
  };

  /**
   * Drops an override so the template's own value applies again. The key is
   * REMOVED rather than set to null: «унаследовано» is the absence of a value
   * everywhere else in the pipeline (`buildTemplateCssVars` skips a param it
   * cannot resolve), and a lingering `null` would show up as a saved change.
   */
  const clearParam = (key: string) => {
    setDraft((d) => {
      const params = { ...(d.params ?? {}) };
      delete params[key];
      return { ...d, params };
    });
  };

  /**
   * PRD-49. An EMPTY map is stored as `undefined`: the save route drops an empty
   * `labels` object anyway, and keeping `{}` in the draft would leave the tab dirty
   * after the author undid their last rewording.
   */
  const setLabels = (labels: LabelValues) => {
    setDraft((d) => ({ ...d, labels: Object.keys(labels).length > 0 ? labels : undefined }));
  };

  const setResultsBlockOrder = (order: ResultsBlockKey[]) => {
    setDraft((d) => ({ ...d, resultsBlockOrder: order.length > 0 ? order : undefined }));
  };

  const resetToDefaults = () => {
    setDraft((d) => ({ ...d, params: {}, paramsByTheme: undefined }));
  };

  const setTemplate = (templateId: string) => {
    // S12-G3: clears params on switch (new template's defaults apply via the
    // manifest hydration). Drops templateVersion/templateApiVersion so the
    // server re-stamps them from the chosen template during PUT.
    setDraft(() => ({ templateId, params: {} }));
  };

  // ─── PRD-23: themes ─────────────────────────────────────────────────────────

  const manifest = templateQuery.data?.manifest;
  const themes = useMemo(() => declaredThemes(manifest), [manifest]);
  const resolvedThemes = useMemo(
    () => resolveThemeParams(draft, manifest),
    [draft, manifest],
  );

  const setTheme = (theme: TestTheme) => {
    setDraft((d) => ({ ...d, theme }));
  };

  /**
   * Moves a colour saved FLAT (pre-PRD-23) onto every palette, then drops the flat
   * key. Called before any per-palette edit: leaving the flat value behind would
   * keep feeding the palettes the author is not editing from two places at once.
   * Purely a shape change — {@link resolveThemeParams} already reads it this way,
   * so what the learner sees does not move.
   */
  const materialiseFlatColour = (d: DesignSettings, key: string): DesignSettings => {
    const flat = d.params?.[key];
    if (flat === undefined) return d;
    const params = { ...(d.params ?? {}) };
    delete params[key];
    const byTheme: Partial<Record<ThemeId, Record<string, unknown>>> = { ...(d.paramsByTheme ?? {}) };
    for (const t of themes) {
      const cur = byTheme[t.id] ?? {};
      if (cur[key] === undefined) byTheme[t.id] = { ...cur, [key]: flat };
    }
    return { ...d, params, paramsByTheme: byTheme };
  };

  const setThemeParam = (theme: ThemeId, key: string, value: unknown) => {
    setDraft((d0) => {
      const d = materialiseFlatColour(d0, key);
      const byTheme = { ...(d.paramsByTheme ?? {}) };
      byTheme[theme] = { ...(byTheme[theme] ?? {}), [key]: value };
      return { ...d, paramsByTheme: byTheme };
    });
  };

  const clearThemeParam = (theme: ThemeId, key: string) => {
    setDraft((d0) => {
      const d = materialiseFlatColour(d0, key);
      const byTheme = { ...(d.paramsByTheme ?? {}) };
      const values = { ...(byTheme[theme] ?? {}) };
      delete values[key];
      byTheme[theme] = values;
      return { ...d, paramsByTheme: byTheme };
    });
  };

  const applyDefaultTemplate = () => {
    // S12-G6: thin wrapper over setTemplate for the wf-template-incompatible
    // banner's «Применить «Стандартный»» action.
    setTemplate("default");
  };

  const refreshTemplateVersion = () => {
    const tpl = templateQuery.data;
    if (!tpl) return;
    // Keep only params whose keys still exist in the new manifest; drop the rest.
    const allowed = new Set((tpl.manifest.params ?? []).map((p) => p.key));
    setDraft((d) => {
      const prevParams = d.params ?? {};
      const kept: Record<string, unknown> = {};
      for (const key of Object.keys(prevParams)) {
        if (allowed.has(key)) kept[key] = prevParams[key];
      }
      return {
        templateId: tpl.id,
        templateVersion: tpl.version,
        templateApiVersion: tpl.templateApiVersion,
        params: kept,
        // PRD-49: the author's wording survives a re-upload of the same template.
        // Unlike params, a label the new manifest no longer declares costs nothing —
        // `resolveLabels` drops unknown keys — so nothing has to be filtered here.
        labels: d.labels,
        resultsBlockOrder: d.resultsBlockOrder,
      };
    });
  };

  const revert = () => {
    if (persisted) {
      setDraft({ ...persisted, params: { ...(persisted.params ?? {}) } });
    }
  };

  const saveMutation = useMutation({
    mutationFn: () => putDesign(testId!, draft),
    onSuccess: (saved) => {
      queryClient.setQueryData(["tests", testId, "design"], saved);
    },
  });

  // S12-G6: differentiate "template lookup 404" from "design fetch errored".
  // Design loaded successfully, template query has settled (not loading), but
  // produced no data → the persisted templateId no longer maps to anything.
  const templateMissing =
    !designQuery.isLoading &&
    designQuery.data !== undefined &&
    !templateQuery.isLoading &&
    !templateQuery.data &&
    Boolean(persisted?.templateId);

  // PRD-3: the current design selection records a version that drifted from the
  // template's current version (content replaced under the same id). Computed
  // from the DRAFT (not the persisted snapshot) so the «Обновить оформление»
  // action gives immediate feedback — the banner disappears the moment the draft
  // is reconciled, before the author saves. Only meaningful once the template
  // resolved (active) and the draft actually recorded a version.
  const templateOutdated =
    Boolean(draft.templateVersion) &&
    Boolean(templateQuery.data) &&
    draft.templateVersion !== templateQuery.data!.version;

  return {
    isLoading: designQuery.isLoading || templateQuery.isLoading,
    error: (designQuery.error as Error | null) ?? (templateQuery.error as Error | null),
    template: templateQuery.data ?? null,
    draft,
    isDirty,
    templateMissing,
    templateOutdated,
    setParam,
    clearParam,
    themes,
    theme: resolvedThemes.theme,
    setTheme,
    themeParams: resolvedThemes.byTheme,
    setThemeParam,
    clearThemeParam,
    setLabels,
    setResultsBlockOrder,
    resetToDefaults,
    setTemplate,
    applyDefaultTemplate,
    refreshTemplateVersion,
    revert,
    save: () => saveMutation.mutateAsync(),
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error as Error | null,
  };
}
