/**
 * @module features/tests/editor/sections/page-preview-modal
 * @description Single content-page preview modal for the «Структура» tab
 * (PRD-7 S13.4-G17 / FR-44). Wireframe state `s-page-preview` in
 * `prd7-structure-linear-by-topics.html` (lines 984-1058).
 *
 * Renders an iframe that embeds the test's design-template `preview.html` and
 * - via a server-injected override script - calls the runtime-exposed
 * `renderContentPage(page, contentTemplates)` directly with the page's saved
 * values. The standalone navigation chrome is suppressed by the same embed
 * CSS template-preview uses (S12-G2).
 *
 * Differs from {@link TemplatePreviewModal} in source-of-truth:
 *   - TemplatePreview: param overrides arrive via query string; the iframe
 *     walks the demo navigation of the chosen template.
 *   - PagePreview: the backend reads the content_page from the DB and patches
 *     the bootstrap to render just that one page in the test's current
 *     design-template branding.
 */
import { ModalDialog, Button } from "@universityrt/ui-kit";

// ─── Public API ───────────────────────────────────────────────────────────────

export type PagePreviewModalProps = {
  open: boolean;
  onClose: () => void;
  /** Test id - part of the preview-page URL. */
  testId: string;
  /** Content page being previewed (id used in URL, title shown in header). */
  pageId: string;
  /** Display title for the modal header («Предпросмотр: <title>»). */
  pageTitle: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Modal dialog that embeds the test's design-template preview.html and
 * delegates rendering of the single target page to the iframe runtime.
 * Static visual evaluation only - interactions inside the preview are
 * demo-only and do not persist anything.
 */
export function PagePreviewModal({
  open,
  onClose,
  testId,
  pageId,
  pageTitle,
}: PagePreviewModalProps) {
  const previewUrl = `/api/tests/${encodeURIComponent(testId)}/content-pages/${encodeURIComponent(pageId)}/preview-page`;

  if (!open) return null;

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="xl"
      className="tpl-preview-modal"
      title={`Предпросмотр: ${pageTitle}`}
      description="Так страница выглядит в SCORM-плеере. Прогресс не сохраняется."
      footer={
        <div className="tpl-preview-foot" data-testid="page-preview-foot">
          <span className="tpl-preview-foot__info">
            предпросмотр одной страницы · стиль и шрифты — из текущего шаблона теста
          </span>
          <Button
            variant="secondary"
            size="m"
            onClick={onClose}
            data-testid="page-preview-close"
          >
            Закрыть
          </Button>
        </div>
      }
    >
      <div className="tpl-preview-frame" data-testid="page-preview-modal">
        <iframe
          key={previewUrl}
          src={previewUrl}
          title={`Предпросмотр страницы ${pageTitle}`}
          className="tpl-preview-iframe"
          // Same sandbox as template-preview: scripts to run the runtime,
          // same-origin to read window.PRD1_PREVIEW_* globals injected by
          // the backend response.
          sandbox="allow-scripts allow-same-origin"
          data-testid="page-preview-iframe"
        />
      </div>
    </ModalDialog>
  );
}
