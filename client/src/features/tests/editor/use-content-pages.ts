/**
 * @module features/tests/editor/use-content-pages
 * @description React hook for loading and mutating a test's content_pages plus
 * the variant catalogue of the active design template.
 *
 * Responsibilities:
 *   - Fetch all `content_pages` for a test via
 *     `GET /api/tests/:id/content-pages`.
 *   - Resolve the active template and expose its `manifest.contentTemplates`
 *     variant catalogue. The template id follows the in-progress «Оформление»
 *     DRAFT when the caller passes `draftTemplateId` (so changing the template
 *     there updates «Структура» variants before save), else the persisted design
 *     (`GET /api/tests/:id/design`), else `default` — then
 *     `GET /api/templates/:templateId`. Author pages pick a variant with
 *     `kind === "info"` (PRD-1 §4.3).
 *   - Provide create / update / reorder / delete mutations that invalidate the
 *     list. Used by the «Структура» editor (PRD-7 closeout of PRD-1 §4).
 *
 * The design / template queries reuse the same React Query keys as
 * {@link useDesignSettings} so the two hooks share one network round-trip.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContentPagePosition = "before" | "after" | "before_topic" | "after_topic";
export type ContentPageKind = "start" | "questions" | "router" | "summary" | "results" | "intro" | "info";
export type ContentPageMode = "template" | "standard" | "html";
export type ContentPageType = "intro" | "info" | "summary" | "html";

export type ContentPage = {
  id: string;
  testId: string;
  topicId: string | null;
  position: ContentPagePosition;
  mode: ContentPageMode;
  type: ContentPageType;
  kind: ContentPageKind;
  templateKey: string | null;
  sortOrder: number;
  valuesJson: {
    values?: Record<string, unknown>;
    placeholderStyles?: Record<string, unknown>;
  };
  autoAdvance: boolean;
  autoAdvanceDelayMs: number | null;
  createdAt: string;
  updatedAt: string;
  /** Server-side flag: true when the saved templateKey no longer exists in the active template. */
  templateKeyMissing?: boolean;
};

/** A placeholder definition from a template's `contentTemplates[].placeholders`. */
export type ContentTemplatePlaceholder = {
  key: string;
  type: string;
  label: string;
  required?: boolean;
  maxLength?: number;
  options?: string[];
  allowedRenderers?: string[];
  allowedPaths?: string[];
  defaultRenderer?: string;
  defaultPath?: string;
  optionsSchema?: Record<string, unknown>;
  textFit?: {
    mode: string;
    defaultFontSize?: number;
    minFontSize?: number;
    maxFontSize?: number;
    allowAuthorFontSize?: boolean;
    allowedFontSizes?: number[];
    overflow?: string;
  };
};

/** A content-page variant declared in `manifest.contentTemplates[]`. */
export type ContentTemplateVariant = {
  key: string;
  label: string;
  /** PRD-1 §4.3 variant kind. Built-in manifests declare it; older ones may not. */
  kind?: ContentPageKind;
  description?: string;
  placeholders: ContentTemplatePlaceholder[];
};

/** Payload for creating a content page (POST). */
export type ContentPageInput = {
  topicId?: string | null;
  position: ContentPagePosition;
  mode: ContentPageMode;
  type: ContentPageType;
  templateKey?: string | null;
  valuesJson?: {
    values?: Record<string, unknown>;
    placeholderStyles?: Record<string, unknown>;
  };
  autoAdvance?: boolean;
  autoAdvanceDelayMs?: number | null;
  sortOrder?: number;
};

// ─── Network helpers ──────────────────────────────────────────────────────────

/**
 * Appends the in-progress «Оформление» DRAFT template id so the SERVER validates
 * structure edits (list flags / add / value-validation / replace-variant) against
 * the chosen template — making variant changes work BEFORE the design is saved.
 */
function tplQuery(draftTemplateId?: string): string {
  return draftTemplateId ? `?templateId=${encodeURIComponent(draftTemplateId)}` : "";
}

async function fetchContentPages(testId: string, draftTemplateId?: string): Promise<ContentPage[]> {
  const res = await fetch(`/api/tests/${testId}/content-pages${tplQuery(draftTemplateId)}`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to load content pages: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetches the test's design settings. Returns the full object (not just the id)
 * so this query can safely share the `["tests", id, "design"]` cache key with
 * {@link useDesignSettings} — both queryFns must yield the same shape.
 */
async function fetchDesignSettings(testId: string): Promise<{ templateId?: string }> {
  const res = await fetch(`/api/tests/${testId}/design`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to load design settings: ${res.status}`);
  }
  return res.json();
}

async function fetchTemplateVariants(templateId: string): Promise<ContentTemplateVariant[]> {
  const res = await fetch(`/api/templates/${templateId}`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to load template ${templateId}: ${res.status}`);
  }
  const data = (await res.json()) as {
    manifest?: { contentTemplates?: ContentTemplateVariant[] };
  };
  return data.manifest?.contentTemplates ?? [];
}

async function postContentPage(
  testId: string,
  input: ContentPageInput,
  draftTemplateId?: string,
): Promise<ContentPage> {
  const res = await fetch(`/api/tests/${testId}/content-pages${tplQuery(draftTemplateId)}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create content page: ${res.status} ${text}`);
  }
  return res.json();
}

async function putContentPage(
  testId: string,
  pageId: string,
  input: Partial<ContentPageInput>,
  draftTemplateId?: string,
): Promise<ContentPage & { sanitizeDiagnostics?: SanitizeDiagnostics }> {
  const res = await fetch(`/api/tests/${testId}/content-pages/${pageId}${tplQuery(draftTemplateId)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update content page: ${res.status} ${text}`);
  }
  return res.json();
}

async function putReorder(
  testId: string,
  updates: Array<{ id: string; sortOrder: number }>,
): Promise<void> {
  const res = await fetch(`/api/tests/${testId}/content-pages/reorder`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to reorder content pages: ${res.status} ${text}`);
  }
}

async function deleteContentPage(testId: string, pageId: string): Promise<void> {
  const res = await fetch(`/api/tests/${testId}/content-pages/${pageId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to delete content page: ${res.status} ${text}`);
  }
}

// ─── Draft helpers ──────────────────────────────────────────────────────────

/** Prefix for the client-only id of a page added in the draft but not yet committed. */
const DRAFT_ID_PREFIX = "draft-";
function isDraftId(id: string): boolean {
  return id.startsWith(DRAFT_ID_PREFIX);
}

/** Reduce a (draft) page to the create/update payload sent at commit time. */
function pageToInput(page: ContentPage): ContentPageInput {
  return {
    topicId: page.topicId,
    position: page.position,
    mode: page.mode,
    type: page.type,
    templateKey: page.templateKey,
    valuesJson: page.valuesJson,
    autoAdvance: page.autoAdvance,
    autoAdvanceDelayMs: page.autoAdvanceDelayMs,
    sortOrder: page.sortOrder,
  };
}

/** Stable JSON stringify with sorted keys — order-insensitive value comparison. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const obj = v as Record<string, unknown>;
  return (
    "{" +
    Object.keys(obj)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}

/**
 * Canonical form of a page's `valuesJson` for change detection: missing/empty
 * `values` and `placeholderStyles` both collapse to `{}` and keys sort, so a
 * `placeholderStyles: undefined → {}` rewrite (the inline form seeds an empty
 * styles object) or a differing key order never reads as a real change.
 */
export function canonicalValues(vj: ContentPage["valuesJson"] | undefined): string {
  return stableStringify({
    values: vj?.values ?? {},
    placeholderStyles: vj?.placeholderStyles ?? {},
  });
}

/** True when two pages differ in any committed field (order is handled by reorder). */
function pageChanged(a: ContentPage, b: ContentPage): boolean {
  return (
    a.templateKey !== b.templateKey ||
    a.position !== b.position ||
    a.topicId !== b.topicId ||
    a.mode !== b.mode ||
    a.type !== b.type ||
    a.autoAdvance !== b.autoAdvance ||
    a.autoAdvanceDelayMs !== b.autoAdvanceDelayMs ||
    canonicalValues(a.valuesJson) !== canonicalValues(b.valuesJson)
  );
}

/**
 * True when the local draft differs from the persisted server list in any way
 * the unified «Сохранить» would push: a not-yet-created page, an add/delete, a
 * reorder, or a changed committed field. Normalised (see {@link canonicalValues})
 * so a no-op edit never counts. This is the REAL dirty signal for the Save gate;
 * the sticky `dirty` flag only means "the draft was touched" (it guards the
 * server re-sync from clobbering in-progress edits).
 */
function listDirty(draft: ContentPage[], server: ContentPage[]): boolean {
  if (draft.some((p) => isDraftId(p.id))) return true; // a not-yet-created page
  if (draft.length !== server.length) return true; // an add or a delete
  const ds = [...draft].sort((a, b) => a.sortOrder - b.sortOrder);
  const ss = [...server].sort((a, b) => a.sortOrder - b.sortOrder);
  for (let i = 0; i < ds.length; i++) {
    if (ds[i].id !== ss[i].id) return true; // reordered or different membership
    if (pageChanged(ss[i], ds[i])) return true;
  }
  return false;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Server-side sanitiser diagnostics from the last successful PUT for a page.
 * PRD-7 S13.4-G18 / FR-25 sanitize: lets the edit form show the author exactly
 * which tags / attributes / URIs the server stripped from each placeholder.
 */
export type SanitizeRemoval = {
  kind: "tag" | "attribute" | "uri";
  /** Display label, e.g. `<script>`, `onclick`, `javascript:`. */
  label: string;
  count: number;
};
export type SanitizeDiagnostics = Record<string, SanitizeRemoval[]>;

export type UseContentPagesResult = {
  pages: ContentPage[];
  /** Variant catalogue of the active template (`manifest.contentTemplates`). */
  contentTemplates: ContentTemplateVariant[];
  /** Author-selectable variants — those whose `kind` is `info`. */
  infoVariants: ContentTemplateVariant[];
  isLoading: boolean;
  error: Error | null;
  create: (input: ContentPageInput) => Promise<ContentPage>;
  isCreating: boolean;
  update: (pageId: string, input: Partial<ContentPageInput>) => Promise<ContentPage>;
  isUpdating: boolean;
  /**
   * Most recent sanitiser diagnostics, keyed by page id. Set on a successful
   * update that stripped at least one placeholder; cleared by the next update
   * to that page (so a clean re-save dismisses the banner). Read by
   * `PageEditForm` to render the `s-sanitize` warning banner.
   */
  sanitizeDiagnostics: Record<string, SanitizeDiagnostics>;
  /** Clears the diagnostics entry for a single page (banner dismiss). */
  dismissSanitizeDiagnostics: (pageId: string) => void;
  reorder: (updates: Array<{ id: string; sortOrder: number }>) => Promise<void>;
  isReordering: boolean;
  /** Switch a (system or author) page to another variant of the same `kind` (FR-46). */
  replaceVariant: (pageId: string, newTemplateKey: string) => Promise<void>;
  isReplacingVariant: boolean;
  remove: (pageId: string) => Promise<void>;
  isRemoving: boolean;
  /** Error from the last {@link commit} (replay to the server), if any. */
  mutationError: Error | null;
  /**
   * True when the local «Структура» draft differs from the saved server state.
   * Drives the «Сохранить» button alongside the test-settings / design drafts.
   */
  isDirty: boolean;
  /**
   * Replays the buffered draft (add / edit / reorder / variant / delete) to the
   * server. Called by the Drawer's unified «Сохранить». Resolves with the
   * server-side sanitiser diagnostics produced during the commit (keyed by page
   * id) and refetches so the draft re-syncs to the persisted state.
   */
  commit: () => Promise<Record<string, SanitizeDiagnostics>>;
  /** Discards all buffered draft edits, resetting to the saved server state (Drawer «Отмена»). */
  discard: () => void;
};

/** True when a placeholder value counts as unfilled for required-field checks. */
function isPlaceholderEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/**
 * Aggregate **error** signal for the «Структура» tab: true when any author
 * (`kind: "info"`) page leaves a `required: true` placeholder unfilled.
 * Required-empty is the author's responsibility — Save must be blocked
 * (PRD-1 §4.3.6, FR-20c). templateKeyMissing is a separate warning.
 */
export function hasStructureErrors(
  pages: ContentPage[],
  contentTemplates: ContentTemplateVariant[],
): boolean {
  return pages.some((p) => {
    // Any kind with a bound variant counts (system pages have required fields
    // too — e.g. router title/instruction; PRD-7 G27 / 2026-05-28).
    const variant = contentTemplates.find((v) => v.key === p.templateKey);
    if (!variant) return false;
    const values = p.valuesJson?.values ?? {};
    return variant.placeholders.some((ph) => ph.required && isPlaceholderEmpty(values[ph.key]));
  });
}

/**
 * Aggregate **warning** signal for the «Структура» tab: true when any author
 * page's saved templateKey is no longer present in the active template
 * (variant catalog drift). Surfaced as a yellow tag — does NOT block Save;
 * the page still exports as the persisted variant or falls back at runtime.
 */
export function hasStructureWarnings(
  pages: ContentPage[],
): boolean {
  return pages.some((p) => p.kind === "info" && p.templateKeyMissing === true);
}

export function useContentPages(
  testId: string | undefined,
  draftTemplateId?: string,
): UseContentPagesResult {
  const queryClient = useQueryClient();
  const enabled = typeof testId === "string" && testId.length > 0;

  // Include the draft template id so switching the template in «Оформление»
  // refetches the list — its `templateKeyMissing` flags are recomputed against
  // the chosen template (server-side, mirroring the catalogue). Invalidation by
  // the `["tests", testId, "content-pages"]` prefix still matches this key.
  const pagesQuery = useQuery({
    queryKey: ["tests", testId, "content-pages", draftTemplateId ?? null],
    queryFn: () => fetchContentPages(testId!, draftTemplateId),
    enabled,
  });

  const designQuery = useQuery({
    queryKey: ["tests", testId, "design"],
    queryFn: () => fetchDesignSettings(testId!),
    enabled,
  });
  // The variant catalogue follows the IN-PROGRESS «Оформление» draft when the
  // caller supplies one (`draftTemplateId`), so switching the template there
  // updates «Структура» variants — the «Сменить вариант» control and the add-page
  // options — IMMEDIATELY, before save. Falls back to the persisted design, then
  // `default`. The pages themselves still come from the saved content-pages API.
  const templateId = enabled
    ? draftTemplateId || designQuery.data?.templateId || "default"
    : undefined;

  const templateQuery = useQuery({
    queryKey: ["templates", templateId, "content-templates"],
    queryFn: () => fetchTemplateVariants(templateId!),
    enabled: Boolean(templateId),
  });

  const contentTemplates = templateQuery.data ?? [];
  const infoVariants = useMemo(
    () => contentTemplates.filter((v) => v.kind === "info"),
    [contentTemplates],
  );

  // ── Local draft of the page list (unified cancel) ─────────────────────────
  // «Структура» edits are buffered here and committed only on the drawer's
  // «Сохранить» (alongside the test-settings / design drafts), so «Отмена» rolls
  // ALL of them back together. The draft re-syncs from the server list whenever
  // it (re)loads AND the draft is clean — never clobbering in-progress edits.
  const [draftPages, setDraftPages] = useState<ContentPage[]>([]);
  const [syncedFrom, setSyncedFrom] = useState<ContentPage[] | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [commitError, setCommitError] = useState<Error | null>(null);
  const tempSeq = useRef(0);

  const serverPages = Array.isArray(pagesQuery.data) ? pagesQuery.data : undefined;
  if (serverPages && serverPages !== syncedFrom && !dirty) {
    setSyncedFrom(serverPages);
    setDraftPages(serverPages.map((p) => ({ ...p })));
  }

  const [sanitizeDiagnostics, setSanitizeDiagnostics] = useState<
    Record<string, SanitizeDiagnostics>
  >({});
  const dismissSanitizeDiagnostics = useCallback((pageId: string) => {
    setSanitizeDiagnostics((prev) => {
      if (!(pageId in prev)) return prev;
      const next = { ...prev };
      delete next[pageId];
      return next;
    });
  }, []);

  // `pages` is the sorted draft, with `templateKeyMissing` derived against the
  // CURRENT catalogue (so it tracks the draft template too), overriding any
  // server flag.
  const validKeys = useMemo(() => new Set(contentTemplates.map((v) => v.key)), [contentTemplates]);
  const pages = useMemo<ContentPage[]>(
    () =>
      [...draftPages]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((p) => ({
          ...p,
          templateKeyMissing:
            p.templateKey != null && contentTemplates.length > 0 && !validKeys.has(p.templateKey),
        })),
    [draftPages, validKeys, contentTemplates.length],
  );

  // ── Local mutators — mutate the draft only; no network until commit() ─────
  const create = useCallback(
    async (input: ContentPageInput): Promise<ContentPage> => {
      const variant = contentTemplates.find((v) => v.key === input.templateKey);
      const page: ContentPage = {
        id: `${DRAFT_ID_PREFIX}${tempSeq.current++}`,
        testId: testId ?? "",
        topicId: input.topicId ?? null,
        position: input.position,
        mode: input.mode,
        type: input.type,
        kind: (variant?.kind as ContentPageKind | undefined) ?? "info",
        templateKey: input.templateKey ?? null,
        sortOrder: input.sortOrder ?? draftPages.length,
        valuesJson: input.valuesJson ?? { values: {} },
        autoAdvance: input.autoAdvance ?? false,
        autoAdvanceDelayMs: input.autoAdvanceDelayMs ?? null,
        createdAt: "",
        updatedAt: "",
      };
      setDraftPages((prev) => [...prev, page]);
      setDirty(true);
      return page;
    },
    [contentTemplates, draftPages.length, testId],
  );

  const update = useCallback(
    async (pageId: string, input: Partial<ContentPageInput>): Promise<ContentPage> => {
      let updated: ContentPage | undefined;
      setDraftPages((prev) =>
        prev.map((p) => {
          if (p.id !== pageId) return p;
          updated = {
            ...p,
            ...(input.topicId !== undefined ? { topicId: input.topicId } : {}),
            ...(input.position !== undefined ? { position: input.position } : {}),
            ...(input.mode !== undefined ? { mode: input.mode } : {}),
            ...(input.type !== undefined ? { type: input.type } : {}),
            ...(input.templateKey !== undefined ? { templateKey: input.templateKey } : {}),
            ...(input.valuesJson !== undefined ? { valuesJson: input.valuesJson } : {}),
            ...(input.autoAdvance !== undefined ? { autoAdvance: input.autoAdvance } : {}),
            ...(input.autoAdvanceDelayMs !== undefined
              ? { autoAdvanceDelayMs: input.autoAdvanceDelayMs }
              : {}),
          };
          return updated;
        }),
      );
      setDirty(true);
      return updated ?? (draftPages.find((p) => p.id === pageId) as ContentPage);
    },
    [draftPages],
  );

  const reorder = useCallback(
    async (updates: Array<{ id: string; sortOrder: number }>): Promise<void> => {
      const order = new Map(updates.map((u) => [u.id, u.sortOrder]));
      setDraftPages((prev) =>
        prev.map((p) => (order.has(p.id) ? { ...p, sortOrder: order.get(p.id)! } : p)),
      );
      setDirty(true);
    },
    [],
  );

  const replaceVariant = useCallback(
    async (pageId: string, newTemplateKey: string): Promise<void> => {
      const newVariant = contentTemplates.find((v) => v.key === newTemplateKey);
      const newKeys = new Set((newVariant?.placeholders ?? []).map((ph) => ph.key));
      setDraftPages((prev) =>
        prev.map((p) => {
          if (p.id !== pageId) return p;
          // Preserve only placeholder values whose key exists in the new variant
          // (mirrors the server's preserve-shared-keys migration).
          const oldValues = (p.valuesJson?.values ?? {}) as Record<string, unknown>;
          const oldStyles = (p.valuesJson?.placeholderStyles ?? {}) as Record<string, unknown>;
          const values: Record<string, unknown> = {};
          const placeholderStyles: Record<string, unknown> = {};
          for (const k of Object.keys(oldValues)) if (newKeys.has(k)) values[k] = oldValues[k];
          for (const k of Object.keys(oldStyles)) if (newKeys.has(k)) placeholderStyles[k] = oldStyles[k];
          return { ...p, templateKey: newTemplateKey, valuesJson: { values, placeholderStyles } };
        }),
      );
      setDirty(true);
    },
    [contentTemplates],
  );

  const remove = useCallback(async (pageId: string): Promise<void> => {
    setDraftPages((prev) => prev.filter((p) => p.id !== pageId));
    setDirty(true);
  }, []);

  // ── Commit / discard ──────────────────────────────────────────────────────
  const commit = useCallback(async (): Promise<Record<string, SanitizeDiagnostics>> => {
    if (!enabled) return {};
    const server = serverPages ?? [];
    const draft = draftPages;
    const draftIds = new Set(draft.map((p) => p.id));
    const diag: Record<string, SanitizeDiagnostics> = {};
    try {
      // 1) Deletes — server pages no longer in the draft.
      for (const s of server) {
        if (!draftIds.has(s.id)) await deleteContentPage(testId!, s.id);
      }
      // 2) Creates — new (draft-id) pages → POST; remember the real id.
      const realId: Record<string, string> = {};
      for (const p of draft) {
        if (isDraftId(p.id)) {
          const created = await postContentPage(testId!, pageToInput(p), draftTemplateId);
          realId[p.id] = created.id;
        }
      }
      // 3) Updates — existing pages whose committed fields changed.
      const serverById = new Map(server.map((s) => [s.id, s]));
      for (const p of draft) {
        if (isDraftId(p.id)) continue;
        const s = serverById.get(p.id);
        if (s && pageChanged(s, p)) {
          const res = await putContentPage(testId!, p.id, pageToInput(p), draftTemplateId);
          const d = (res as { sanitizeDiagnostics?: SanitizeDiagnostics }).sanitizeDiagnostics;
          if (d && Object.keys(d).length > 0) diag[p.id] = d;
        }
      }
      // 4) Reorder — final order with resolved ids (idempotent; covers add/delete).
      const finalIds = draft.map((p) => (isDraftId(p.id) ? realId[p.id] : p.id)).filter(Boolean) as string[];
      if (finalIds.length > 0) {
        await putReorder(testId!, finalIds.map((id, i) => ({ id, sortOrder: i })));
      }

      setCommitError(null);
      setDirty(false);
      setSanitizeDiagnostics(diag);
      await queryClient.invalidateQueries({ queryKey: ["tests", testId, "content-pages"] });
      return diag;
    } catch (err) {
      setCommitError(err as Error);
      // Re-sync the draft to whatever actually persisted, then surface the error.
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["tests", testId, "content-pages"] });
      throw err;
    }
  }, [draftPages, draftTemplateId, enabled, queryClient, serverPages, testId]);

  const discard = useCallback(() => {
    setDirty(false);
    setCommitError(null);
    setSanitizeDiagnostics({});
    setDraftPages((serverPages ?? []).map((p) => ({ ...p })));
  }, [serverPages]);

  // The REAL dirty signal for the «Сохранить» gate: a structural diff between the
  // draft and the persisted list. A no-op edit (opening page props, Save-in-row
  // without changes, an `undefined → {}` style normalisation) leaves `dirty` true
  // — the draft was touched — but `structurallyDirty` false, so Save stays off.
  const structurallyDirty = useMemo(
    () => listDirty(draftPages, serverPages ?? []),
    [draftPages, serverPages],
  );

  return {
    pages,
    contentTemplates,
    infoVariants,
    isLoading: pagesQuery.isLoading,
    error: (pagesQuery.error as Error | null) ?? null,
    create,
    isCreating: false,
    update,
    isUpdating: false,
    sanitizeDiagnostics,
    dismissSanitizeDiagnostics,
    reorder,
    isReordering: false,
    replaceVariant,
    isReplacingVariant: false,
    remove,
    isRemoving: false,
    mutationError: commitError,
    isDirty: dirty && structurallyDirty,
    commit,
    discard,
  };
}
