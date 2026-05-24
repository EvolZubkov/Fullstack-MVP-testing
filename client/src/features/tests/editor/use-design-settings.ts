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
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DesignParamType =
  | "text"
  | "color"
  | "boolean"
  | "select"
  | "image"
  | "asset"
  | "number";

export type TemplateParam = {
  key: string;
  type: DesignParamType;
  label: string;
  default?: unknown;
  group?: string;
  options?: string[];
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
  };
  previewPath: string | null;
};

export type DesignSettings = {
  templateId: string;
  templateVersion?: string;
  templateApiVersion?: string;
  params?: Record<string, unknown>;
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
  /** Patch a single param key in the draft. */
  setParam: (key: string, value: unknown) => void;
  /** Reset the draft to the manifest's defaults (clearing all params). */
  resetToDefaults: () => void;
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

  const templateQuery = useQuery({
    queryKey: ["templates", persisted?.templateId],
    queryFn: () => fetchTemplate(persisted!.templateId),
    enabled: Boolean(persisted?.templateId),
  });

  const [draft, setDraft] = useState<DesignSettings>({ templateId: "default" });

  useEffect(() => {
    if (persisted) {
      setDraft({ ...persisted, params: { ...(persisted.params ?? {}) } });
    }
  }, [persisted]);

  const isDirty = useMemo(() => {
    if (!persisted) return false;
    return JSON.stringify(persisted) !== JSON.stringify(draft);
  }, [draft, persisted]);

  const setParam = (key: string, value: unknown) => {
    setDraft((d) => ({ ...d, params: { ...(d.params ?? {}), [key]: value } }));
  };

  const resetToDefaults = () => {
    setDraft((d) => ({ ...d, params: {} }));
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

  return {
    isLoading: designQuery.isLoading || templateQuery.isLoading,
    error: (designQuery.error as Error | null) ?? (templateQuery.error as Error | null),
    template: templateQuery.data ?? null,
    draft,
    isDirty,
    setParam,
    resetToDefaults,
    revert,
    save: () => saveMutation.mutateAsync(),
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error as Error | null,
  };
}
