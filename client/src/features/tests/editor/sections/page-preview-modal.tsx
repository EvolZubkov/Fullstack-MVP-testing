/**
 * @module features/tests/editor/sections/page-preview-modal
 * @description Single content-page preview modal for the «Структура» tab
 * (PRD-7 S13.4-G17 / FR-44).
 *
 * Renders ONLY the page being previewed, through the SAME unified renderer the
 * runtime and «Шаблоны» use ({@link TemplateScreen} → `renderScreenInto`) — no
 * second preview engine. The page's current placeholder values are fed into the
 * renderer's content channel ({@link buildContentPageScreen}); the template +
 * branding come from the DESIGN DRAFT (the in-progress «Оформление» selection),
 * not the saved design — so switching the template in «Оформление» is reflected
 * here immediately, consistent with the template preview. Resolved server-side
 * via `sourcePath`, so uploaded (PRD-3) templates preview too.
 *
 * Static visual evaluation only — interactions are demo-only and persist nothing.
 */
import { useMemo } from "react";
import { Banner, Button, ModalDialog } from "@universityrt/ui-kit";
import { TemplateScreen } from "@/components/template-screen";
import { buildContentPageScreen, buildScreenInputs, type PreviewDemoDataset } from "@shared/template/preview-context";
import { buildTemplateCssVars } from "@shared/template/params-css";
import { useTemplateBundle } from "./use-template-bundle";

// ─── Public API ───────────────────────────────────────────────────────────────

/** The content-page fields the preview reads (structural — date shapes vary by host). */
export interface PagePreviewPage {
  id: string;
  /** Variant-binding kind (PRD-1 §4.3): intro | info | summary | router | questions. */
  kind?: string | null;
  templateKey?: string | null;
  valuesJson?: unknown;
}

export type PagePreviewModalProps = {
  open: boolean;
  onClose: () => void;
  /** Draft design template id — the page previews against the IN-PROGRESS template. */
  templateId: string | undefined;
  /** Draft design params (branding), applied as CSS variables. */
  params: Record<string, unknown>;
  /** The content page being previewed (its current values are rendered). */
  page: PagePreviewPage;
  /** Display title for the modal header («Предпросмотр: <title>»). */
  pageTitle: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function PagePreviewModal({ open, onClose, templateId, params, page, pageTitle }: PagePreviewModalProps) {
  const bundleQuery = useTemplateBundle(templateId, open);
  const bundle = bundleQuery.data;

  // One ScreenSpec for THIS page. `start` / `results` / `questions` are rendered
  // by their OWN runtimes (landing, final results, question stream), not as
  // content pages — preview them from the template's demo dataset via the SAME
  // builders the player/«Предпросмотр» use (buildStartState / buildResultContext /
  // demo question). Content kinds (intro/info/summary) render the page's own values.
  const spec = useMemo(() => {
    if (!bundle) return null;
    if (page.kind === "start" || page.kind === "results" || page.kind === "questions") {
      const demoScreens = bundle.demo ? buildScreenInputs(bundle.demo as PreviewDemoDataset, bundle.manifest) : [];
      const matches =
        page.kind === "start"
          ? (r: string) => r === "start"
          : page.kind === "results"
            ? (r: string) => r === "results" || r === "results.adaptive"
            : (r: string) => r.startsWith("question");
      return demoScreens.find((s) => matches(s.route)) ?? null;
    }
    const values = (page.valuesJson as { values?: Record<string, unknown> } | null)?.values ?? {};
    const tpl = (bundle.manifest.contentTemplates ?? []).find((c) => c.key === page.templateKey);
    const route = tpl?.pageKind ?? `content.${page.kind ?? "info"}`;
    const runtime = (bundle.demo as { runtime?: { result?: Record<string, unknown>; sectionResult?: Record<string, unknown> } } | null)?.runtime;
    const rr = runtime?.sectionResult ?? runtime?.result;
    const result = rr
      ? { scorePercent: Number(rr.scorePercent) || 0, status: rr.status ?? "", passed: !!rr.passed }
      : undefined;
    return buildContentPageScreen({
      manifest: bundle.manifest,
      route,
      templateKey: page.templateKey ?? undefined,
      values,
      courseTitle: "",
      result,
    });
  }, [bundle, page]);

  // Draft branding → CSS variables, via the SAME mapping the runtime uses.
  const cssVars = useMemo(() => buildTemplateCssVars(params, bundle?.manifest.params), [params, bundle]);

  if (!open) return null;

  const layout = spec && bundle ? bundle.layouts[spec.layoutKey] : undefined;

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="xl"
      className="tpl-preview-modal"
      title={`Предпросмотр: ${pageTitle}`}
      description="Так страница выглядит в плеере. Прогресс не сохраняется."
      footer={
        <div className="tpl-preview-foot" data-testid="page-preview-foot">
          <span className="tpl-preview-foot__info">
            предпросмотр одной страницы · стиль и шрифты — из текущего «Оформления»
          </span>
          <Button variant="secondary" size="m" onClick={onClose} data-testid="page-preview-close">
            Закрыть
          </Button>
        </div>
      }
    >
      <div className="tpl-preview-frame" data-testid="page-preview-modal">
        {bundleQuery.isLoading && <p className="tpl-upload-hint">Загружаем шаблон…</p>}
        {bundleQuery.error && (
          <Banner tone="error" title="Не удалось загрузить файлы шаблона" description={(bundleQuery.error as Error).message} />
        )}
        {bundle && spec && layout != null ? (
          <div className="tpl-check-stage__frame">
            <TemplateScreen
              layout={layout}
              context={spec.input.context}
              slots={spec.input.slots}
              content={spec.input.content}
              css={bundle.css}
              cssVars={cssVars}
            />
          </div>
        ) : (
          bundle && (
            <Banner
              tone="warning"
              title="Не удалось собрать предпросмотр страницы"
              description={spec ? `Макет «${spec.layoutKey}» не найден в шаблоне.` : "Выбранный шаблон не содержит подходящего макета."}
            />
          )
        )}
      </div>
    </ModalDialog>
  );
}
