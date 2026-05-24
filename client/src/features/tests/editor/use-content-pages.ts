/**
 * @module features/tests/editor/use-content-pages
 * @description React hook for loading and mutating a test's content_pages.
 *
 * Responsibilities:
 *   - Fetch all `content_pages` for a test via
 *     `GET /api/tests/:id/content-pages`.
 *   - Provide a delete mutation that calls
 *     `DELETE /api/tests/:id/content-pages/:pageId` and invalidates the list.
 *
 * Anti-goals:
 *   - Create / reorder / rich-edit are deferred to the next step. The hook
 *     intentionally exposes only the surface area required by the current
 *     read-only zones view.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContentPagePosition = "before" | "before_topic" | "after_topic";
export type ContentPageKind = "questions" | "router" | "summary" | "intro" | "info";
export type ContentPageMode = "template" | "standard" | "html";

export type ContentPage = {
  id: string;
  testId: string;
  topicId: string | null;
  position: ContentPagePosition;
  mode: ContentPageMode;
  type: "intro" | "info" | "summary" | "html";
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
  isLoading: boolean;
  error: Error | null;
  remove: (pageId: string) => Promise<void>;
  isRemoving: boolean;
  removeError: Error | null;
};

export function useContentPages(testId: string | undefined): UseContentPagesResult {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["tests", testId, "content-pages"],
    queryFn: () => fetchContentPages(testId!),
    enabled: typeof testId === "string" && testId.length > 0,
  });

  const removeMutation = useMutation({
    mutationFn: (pageId: string) => deleteContentPage(testId!, pageId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["tests", testId, "content-pages"],
      });
    },
  });

  return {
    pages: query.data ?? [],
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    remove: (pageId) => removeMutation.mutateAsync(pageId),
    isRemoving: removeMutation.isPending,
    removeError: removeMutation.error as Error | null,
  };
}
