/**
 * @module features/templates/use-admin-templates
 * @description React Query hooks + types for the PRD-3 admin template registry
 * API (`/api/admin/templates`). Covers the list, per-template details, the
 * lifecycle mutations (upload, activate, deactivate, delete, update, re-validate),
 * the browser smoke-test report intake, and the smoke-bundle fetch the
 * preview/check modal renders from.
 *
 * Upload/update use multipart `FormData` and intentionally do NOT throw on a 422
 * validation rejection — the caller needs the structural report from the body to
 * render the rejection list, so those mutations resolve with `{ ok, status, ... }`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { SmokeReport } from "@shared/template/smoke-runner";
import type { PreviewDemoDataset, PreviewManifest } from "@shared/template/preview-context";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TemplateStatus = "draft" | "active" | "inactive" | "invalid";
export type TemplateSourceType = "builtin" | "uploaded";

/** Manifest fields the admin UI reads (superset of the preview bridge subset). */
export interface AdminTemplateManifest extends PreviewManifest {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  templateApiVersion?: string;
  assets?: { preview?: string; styles?: string[]; scripts?: string[]; images?: string[] };
  params?: Array<{ key: string; type?: string; label?: string }>;
}

/** One issue in a structural validation report. */
export interface ValidationIssue {
  code: string;
  message?: string;
  detail?: string;
}

/** Structural validation report (client view of the server report). */
export interface ValidationReport {
  ok: boolean;
  blocking: ValidationIssue[];
  warnings: ValidationIssue[];
}

/** A template row as returned by the admin list / details endpoints. */
export interface AdminTemplate {
  id: string;
  name: string;
  description: string | null;
  version: string;
  templateApiVersion: string;
  isBuiltin: boolean;
  isActive: boolean;
  status: TemplateStatus;
  sourceType: TemplateSourceType;
  sourcePath: string | null;
  manifest: AdminTemplateManifest;
  validationJson: ValidationReport | null;
  smokeTestJson: SmokeReport | null;
  installedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Files the browser needs to render preview screens and run the smoke-test. */
export interface SmokeBundle {
  manifest: AdminTemplateManifest;
  demo: PreviewDemoDataset;
  layouts: Record<string, string>;
  css: string;
  templateJs?: string;
}

export interface TemplateDetails {
  template: AdminTemplate;
  usageCount: number;
}

/** Result of an upload/update attempt (does not throw on a 422 rejection). */
export interface UploadOutcome {
  ok: boolean;
  status: number;
  template?: AdminTemplate;
  report?: ValidationReport;
  error?: string;
}

// ─── Query keys ───────────────────────────────────────────────────────────────

const LIST_KEY = ["/api/admin/templates"] as const;

/**
 * Author-facing template query prefix — the design-tab card
 * (`["templates", <id>]`) and the «Заменить шаблон» gallery
 * (`["templates", "list"]`). The global QueryClient runs `staleTime: Infinity`,
 * so without an explicit invalidation these caches never refetch and a template
 * activated/deactivated/re-uploaded in the admin registry stays invisible (or
 * stale) in the test editor.
 */
const AUTHOR_TEMPLATES_KEY = ["templates"] as const;

/**
 * Invalidates BOTH the admin registry list and the author-facing template
 * caches after any lifecycle change so the gallery + design tab pick the change
 * up on their next render.
 */
function invalidateTemplateCaches(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: LIST_KEY });
  qc.invalidateQueries({ queryKey: AUTHOR_TEMPLATES_KEY });
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** All templates (built-in + uploaded, including draft/invalid). */
export function useAdminTemplates() {
  return useQuery<AdminTemplate[]>({ queryKey: LIST_KEY });
}

/** Details + usage count for one template (enabled-gated). */
export function useTemplateDetails(id: string | null, enabled: boolean) {
  return useQuery<TemplateDetails>({
    queryKey: ["/api/admin/templates", id ?? "_"],
    enabled: enabled && id != null,
  });
}

/** Fetch the smoke-bundle for client-side rendering + checks. */
export async function fetchSmokeBundle(id: string): Promise<SmokeBundle> {
  const res = await fetch(`/api/admin/templates/${encodeURIComponent(id)}/smoke-bundle`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to load template bundle: ${res.status}`);
  return res.json();
}

/** URL of the template's preview thumbnail (may 404 → handle onError). */
export function previewImageUrl(id: string): string {
  return `/api/admin/templates/${encodeURIComponent(id)}/preview-image`;
}

// ─── Mutations ──────────────────────────────────────────────────────────────

async function uploadRequest(method: "POST" | "PUT", url: string, file: File): Promise<UploadOutcome> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(url, { method, body: form, credentials: "include" });
  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }
  return {
    ok: res.ok,
    status: res.status,
    template: body.template as AdminTemplate | undefined,
    report: body.report as ValidationReport | undefined,
    error: body.error as string | undefined,
  };
}

/** Upload a new template ZIP. Resolves with the outcome (no throw on 422). */
export function useUploadTemplate() {
  const qc = useQueryClient();
  return useMutation<UploadOutcome, Error, File>({
    mutationFn: (file) => uploadRequest("POST", "/api/admin/templates", file),
    onSuccess: () => invalidateTemplateCaches(qc),
  });
}

/** Re-upload a ZIP for an existing template. Resolves with the outcome. */
export function useUpdateTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation<UploadOutcome, Error, File>({
    mutationFn: (file) => uploadRequest("PUT", `/api/admin/templates/${encodeURIComponent(id)}/update`, file),
    onSuccess: () => invalidateTemplateCaches(qc),
  });
}

/** Activate a template (server gates on validation + smoke-test). */
export function useActivateTemplate() {
  const qc = useQueryClient();
  return useMutation<AdminTemplate, Error, string>({
    mutationFn: async (id) => {
      const res = await apiRequest("PUT", `/api/admin/templates/${encodeURIComponent(id)}/activate`);
      return res.json();
    },
    onSuccess: () => invalidateTemplateCaches(qc),
  });
}

/** Deactivate a template; switches dependent tests to `default`. */
export function useDeactivateTemplate() {
  const qc = useQueryClient();
  return useMutation<{ id: string; status: string; switchedTests: number }, Error, string>({
    mutationFn: async (id) => {
      const res = await apiRequest("PUT", `/api/admin/templates/${encodeURIComponent(id)}/deactivate`);
      return res.json();
    },
    onSuccess: () => invalidateTemplateCaches(qc),
  });
}

/** Delete an uploaded, inactive, unused template. */
export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation<{ id: string; deleted: boolean }, Error, string>({
    mutationFn: async (id) => {
      const res = await apiRequest("DELETE", `/api/admin/templates/${encodeURIComponent(id)}`);
      return res.json();
    },
    onSuccess: () => invalidateTemplateCaches(qc),
  });
}

/** Persist a browser smoke-test report (NFR-03 intake). */
export function usePostSmokeReport() {
  const qc = useQueryClient();
  return useMutation<{ template: AdminTemplate; report: SmokeReport }, Error, { id: string; report: SmokeReport }>({
    mutationFn: async ({ id, report }) => {
      const res = await apiRequest("POST", `/api/admin/templates/${encodeURIComponent(id)}/smoke-test`, report);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}
