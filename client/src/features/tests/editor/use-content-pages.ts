/**
 * @module features/tests/editor/use-content-pages
 * @description React hook for loading and mutating a test's content_pages plus
 * the variant catalogue of the active design template.
 *
 * Responsibilities:
 *   - Fetch all `content_pages` for a test via
 *     `GET /api/tests/:id/content-pages`.
 *   - Resolve the active template (`GET /api/tests/:id/design` →
 *     `GET /api/templates/:templateId`) and expose its
 *     `manifest.contentTemplates` variant catalogue. Author pages pick a
 *     variant with `kind === "info"` (PRD-1 §4.3).
 *   - Provide create / update / reorder / delete mutations that invalidate the
 *     list. Used by the «Структура» editor (PRD-7 closeout of PRD-1 §4).
 *
 * The design / template queries reuse the same React Query keys as
 * {@link useDesignSettings} so the two hooks share one network round-trip.
 */
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContentPagePosition = "before" | "after" | "before_topic" | "after_topic";
export type ContentPageKind = "questions" | "router" | "summary" | "intro" | "info";
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

async function fetchContentPages(testId: string): Promise<ContentPage[]> {
  const res = await fetch(`/api/tests/${testId}/content-pages`, {
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

async function postContentPage(testId: string, input: ContentPageInput): Promise<ContentPage> {
  const res = await fetch(`/api/tests/${testId}/content-pages`, {
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
): Promise<ContentPage> {
  const res = await fetch(`/api/tests/${testId}/content-pages/${pageId}`, {
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

async function postReplaceVariant(
  testId: string,
  pageId: string,
  newTemplateKey: string,
): Promise<void> {
  const res = await fetch(`/api/tests/${testId}/content-pages/${pageId}/replace-variant`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newTemplateKey }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to replace variant: ${res.status} ${text}`);
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

// ─── Hook ─────────────────────────────────────────────────────────────────────

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
  reorder: (updates: Array<{ id: string; sortOrder: number }>) => Promise<void>;
  isReordering: boolean;
  /** Switch a (system or author) page to another variant of the same `kind` (FR-46). */
  replaceVariant: (pageId: string, newTemplateKey: string) => Promise<void>;
  isReplacingVariant: boolean;
  remove: (pageId: string) => Promise<void>;
  isRemoving: boolean;
  /** First mutation error (create / update / reorder / delete), if any. */
  mutationError: Error | null;
  /**
   * True after the first successful content-page mutation in this drawer
   * session. Drives the «Сохранить» button: structure mutations are written
   * directly via the content-pages API (not through the test/design draft),
   * but the user still expects «Сохранить» to light up after add / drag /
   * reorder. The Drawer should call {@link resetMutated} after its save flow.
   */
  hasMutated: boolean;
  resetMutated: () => void;
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
    if (p.kind !== "info") return false;
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

export function useContentPages(testId: string | undefined): UseContentPagesResult {
  const queryClient = useQueryClient();
  const enabled = typeof testId === "string" && testId.length > 0;

  const pagesQuery = useQuery({
    queryKey: ["tests", testId, "content-pages"],
    queryFn: () => fetchContentPages(testId!),
    enabled,
  });

  const designQuery = useQuery({
    queryKey: ["tests", testId, "design"],
    queryFn: () => fetchDesignSettings(testId!),
    enabled,
  });
  const templateId = designQuery.data?.templateId || (enabled ? "default" : undefined);

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

  // `hasMutated` is the Drawer-level dirty signal for the «Структура» tab.
  // Content-page mutations write directly to the API (no draft), but the user
  // expects «Сохранить» to light up after add / drag / reorder; this flag is
  // the bridge between direct-write mutations and the test/design draft dirty
  // tracking the Drawer footer reads. Reset by the Drawer after save.
  const [hasMutated, setHasMutated] = useState(false);
  const resetMutated = useCallback(() => setHasMutated(false), []);

  const onMutationSuccess = () => {
    setHasMutated(true);
    queryClient.invalidateQueries({ queryKey: ["tests", testId, "content-pages"] });
  };

  const createMutation = useMutation({
    mutationFn: (input: ContentPageInput) => postContentPage(testId!, input),
    onSuccess: onMutationSuccess,
  });

  const updateMutation = useMutation({
    mutationFn: ({ pageId, input }: { pageId: string; input: Partial<ContentPageInput> }) =>
      putContentPage(testId!, pageId, input),
    onSuccess: onMutationSuccess,
  });

  const reorderMutation = useMutation({
    mutationFn: (updates: Array<{ id: string; sortOrder: number }>) =>
      putReorder(testId!, updates),
    onSuccess: onMutationSuccess,
  });

  const replaceVariantMutation = useMutation({
    mutationFn: ({ pageId, newTemplateKey }: { pageId: string; newTemplateKey: string }) =>
      postReplaceVariant(testId!, pageId, newTemplateKey),
    onSuccess: onMutationSuccess,
  });

  const removeMutation = useMutation({
    mutationFn: (pageId: string) => deleteContentPage(testId!, pageId),
    onSuccess: onMutationSuccess,
  });

  return {
    pages: pagesQuery.data ?? [],
    contentTemplates,
    infoVariants,
    isLoading: pagesQuery.isLoading,
    error: (pagesQuery.error as Error | null) ?? null,
    create: (input) => createMutation.mutateAsync(input),
    isCreating: createMutation.isPending,
    update: (pageId, input) => updateMutation.mutateAsync({ pageId, input }),
    isUpdating: updateMutation.isPending,
    reorder: (updates) => reorderMutation.mutateAsync(updates),
    isReordering: reorderMutation.isPending,
    replaceVariant: (pageId, newTemplateKey) =>
      replaceVariantMutation.mutateAsync({ pageId, newTemplateKey }),
    isReplacingVariant: replaceVariantMutation.isPending,
    remove: (pageId) => removeMutation.mutateAsync(pageId),
    isRemoving: removeMutation.isPending,
    mutationError:
      (createMutation.error as Error | null) ??
      (updateMutation.error as Error | null) ??
      (reorderMutation.error as Error | null) ??
      (replaceVariantMutation.error as Error | null) ??
      (removeMutation.error as Error | null) ??
      null,
    hasMutated,
    resetMutated,
  };
}
