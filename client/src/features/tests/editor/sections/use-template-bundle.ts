/**
 * @module features/tests/editor/sections/use-template-bundle
 * @description React Query hooks that fetch a template's render files (manifest +
 * demo + layouts + css) for the unified editor previews. Both previews mount the
 * SAME renderer the runtime/«Шаблоны» use ({@link TemplateScreen}); these hooks
 * just deliver the files. Resolved server-side via the templates table
 * `sourcePath`, so uploaded (PRD-3) templates preview too.
 */
import { useQuery } from "@tanstack/react-query";
import type { PreviewDemoDataset, PreviewManifest } from "@shared/template/preview-context";
import type { TemplateParamDef } from "@shared/template/params-css";

/** Manifest fields the previews read (superset of the renderer's PreviewManifest). */
export type BundleManifest = PreviewManifest & {
  name?: string;
  version?: string;
  params?: TemplateParamDef[];
};

/** Render files for one template (`GET /api/templates/:id/bundle`). */
export interface TemplateBundle {
  manifest: BundleManifest;
  demo: PreviewDemoDataset | null;
  layouts: Record<string, string>;
  css: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Не удалось загрузить файлы шаблона (${res.status})`);
  return res.json() as Promise<T>;
}

/**
 * Bundle for a template by id — used by BOTH editor previews (the «Оформление»
 * template preview and the «Структура» single-page preview), which render against
 * the in-progress design DRAFT template and apply draft params client-side.
 */
export function useTemplateBundle(templateId: string | null | undefined, enabled: boolean) {
  return useQuery<TemplateBundle>({
    queryKey: ["/api/templates", templateId, "bundle"],
    queryFn: () => getJson<TemplateBundle>(`/api/templates/${encodeURIComponent(templateId!)}/bundle`),
    enabled: enabled && !!templateId,
  });
}
