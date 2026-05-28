/**
 * @module features/tests/editor/sections/template-preview-modal
 * @description Template preview modal for the «Оформление» tab (PRD-7 S12-G2 / FR-30).
 *
 * Renders a full-size ModalDialog containing an iframe that embeds the built-in
 * `preview.html` page generated for each template by
 * `scripts/generate-prd1-template-previews.mjs`. The standalone preview is
 * served by `GET /api/templates/:id/preview-page` with embedding tweaks
 * (fake-builder chrome hidden, param overrides applied from query string).
 *
 * Rationale for the iframe approach (vs. a React mock):
 *   - preview.html uses the template's actual shell / layouts / runtime, so
 *     the author sees pixel-accurate rendering instead of an approximation.
 *   - The preview already has its own rail + stage + footer, so there is no
 *     need to synthesise a rail from `manifest.contentTemplates` on the
 *     React side — that data is already plumbed inside the iframe.
 *   - When the author tweaks `draft.params` and reopens the modal, the new
 *     values flow into the preview via URL params; we do not need a
 *     postMessage channel for static visual evaluation.
 *
 * Param sync model:
 *   - The iframe is keyed on a snapshot of `(template.id, params)` taken when
 *     the modal opens (or when those change while open). A fresh key forces
 *     a clean reload with the new query string, which the backend uses to
 *     override `manifest.params[].default` before the preview bootstrap reads
 *     it. Live param sync without iframe reload is intentionally out of scope.
 */
import { useMemo } from "react";
import { Button, ModalDialog } from "@universityrt/ui-kit";
import type { TemplateRow } from "../use-design-settings";

// ─── Public API ───────────────────────────────────────────────────────────────

export type TemplatePreviewModalProps = {
  open: boolean;
  onClose: () => void;
  /**
   * Current template. When null the modal does not render anything —
   * DesignSection ensures open=true is only set when template != null.
   */
  template: TemplateRow | null;
  /** Current draft.params — pushed to the iframe via query string. */
  params: Record<string, unknown>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds the iframe URL with param overrides serialised into the query
 * string. Values that are not primitives are skipped — the preview consumer
 * only understands scalar overrides (color HSL strings, font family names,
 * boolean-like strings, etc.). `null` is preserved as the literal string
 * `"null"` so the backend can distinguish it from absent overrides.
 */
function buildPreviewUrl(
  templateId: string,
  params: Record<string, unknown>,
): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      usp.append(key, String(value));
    } else if (value === null) {
      usp.append(key, "null");
    }
    // Objects/arrays are intentionally skipped — the preview cannot
    // meaningfully render media/file params in a static preview.
  }
  const qs = usp.toString();
  return `/api/templates/${encodeURIComponent(templateId)}/preview-page${qs ? `?${qs}` : ""}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Modal dialog that embeds the template's preview.html in an iframe, branded
 * with the current design draft params. Static visual evaluation only —
 * controls inside the preview are demo-only and do not persist progress.
 */
export function TemplatePreviewModal({
  open,
  onClose,
  template,
  params,
}: TemplatePreviewModalProps) {
  // Stable URL: recomputed whenever the template or any param changes.
  // The iframe is keyed by the URL so React remounts it on changes, which
  // forces a fresh fetch with the updated query string.
  const previewUrl = useMemo(
    () => (template ? buildPreviewUrl(template.id, params) : ""),
    [template, params],
  );

  if (!template) return null;

  const routeCount =
    Array.isArray((template.manifest as { preview?: { routes?: unknown[] } }).preview?.routes)
      ? (template.manifest as { preview?: { routes?: unknown[] } }).preview!.routes!.length
      : 0;

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="xl"
      className="tpl-preview-modal"
      title={`Шаблон «${template.manifest.name}» — предпросмотр`}
      description="Демо-данные. Цвета и шрифты — из текущего черновика «Оформления». Прогресс не сохраняется."
      footer={
        <div className="tpl-preview-foot" data-testid="design-template-preview-foot">
          <span className="tpl-preview-foot__info">
            {routeCount > 0
              ? `${routeCount} экранов · шаблон «${template.manifest.name}» v${template.version}`
              : `шаблон «${template.manifest.name}» v${template.version}`}
          </span>
          <Button
            variant="secondary"
            size="m"
            onClick={onClose}
            data-testid="design-template-preview-close"
          >
            Закрыть
          </Button>
        </div>
      }
    >
      {/* Wrapper carries data-testid because DS ModalDialog does not forward arbitrary HTML attributes. */}
      <div className="tpl-preview-frame" data-testid="design-template-preview-modal">
        <iframe
          key={previewUrl}
          src={previewUrl}
          title={`Предпросмотр шаблона ${template.manifest.name}`}
          className="tpl-preview-iframe"
          // `allow-same-origin` is required so the preview's inline scripts
          // can read window.PRD1_PREVIEW_* globals defined in the same file.
          // `allow-scripts` enables the runtime that draws the preview.
          // No `allow-forms` / `allow-top-navigation` etc.
          sandbox="allow-scripts allow-same-origin"
          data-testid="design-template-preview-iframe"
        />
      </div>
    </ModalDialog>
  );
}
