/**
 * @module features/tests/editor/sections/template-preview-modal
 * @description Template preview modal for the «Оформление» tab (PRD-7 S12-G2 / FR-30).
 *
 * Renders the selected design template's screens through the SAME unified renderer
 * the runtime and «Шаблоны» use ({@link TemplateScreen} → `renderScreenInto`) — no
 * second preview engine. The screens come from the template's demo dataset
 * ({@link buildScreenInputs}); the author's current «Оформление» draft params are
 * applied as CSS variables ({@link buildTemplateCssVars}) on top of the template
 * CSS, so the preview is themed exactly as the learner would see it. Resolved
 * server-side via `sourcePath`, so uploaded (PRD-3) templates preview too.
 *
 * Static visual evaluation only — controls are demo-only and persist nothing.
 */
import { useEffect, useMemo, useState } from "react";
import { Banner, Button, ModalDialog } from "@universityrt/ui-kit";
import { TemplateScreen } from "@/components/template-screen";
import { buildScreenInputs, type PreviewDemoDataset } from "@shared/template/preview-context";
import { buildTemplateCssVars } from "@shared/template/params-css";
import { useTemplateBundle } from "./use-template-bundle";
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
  /** Current draft.params — applied as CSS variables (live branding). */
  params: Record<string, unknown>;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function TemplatePreviewModal({ open, onClose, template, params }: TemplatePreviewModalProps) {
  const bundleQuery = useTemplateBundle(template?.id, open);
  const bundle = bundleQuery.data;

  // Screens from the template's demo dataset (same bridge as «Шаблоны»).
  const specs = useMemo(
    () => (bundle?.demo ? buildScreenInputs(bundle.demo as PreviewDemoDataset, bundle.manifest) : []),
    [bundle],
  );
  const specByRoute = useMemo(() => new Map(specs.map((s) => [s.route, s])), [specs]);

  // Draft params → CSS variables, via the SAME mapping the runtime uses.
  const cssVars = useMemo(
    () => buildTemplateCssVars(params, bundle?.manifest.params),
    [params, bundle],
  );

  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);

  // On open / template switch, select the manifest default route (or the first).
  useEffect(() => {
    if (open && specs.length) {
      setSelectedRoute(bundle?.manifest.preview?.defaultRoute ?? specs[0].route);
    }
    if (!open) setSelectedRoute(null);
  }, [open, template?.id, specs, bundle]);

  if (!template) return null;

  const selectedSpec = selectedRoute ? specByRoute.get(selectedRoute) : undefined;
  const selectedLayout = selectedSpec && bundle ? bundle.layouts[selectedSpec.layoutKey] : undefined;

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
            {specs.length > 0
              ? `${specs.length} экранов · шаблон «${template.manifest.name}» v${template.version}`
              : `шаблон «${template.manifest.name}» v${template.version}`}
          </span>
          <Button variant="secondary" size="m" onClick={onClose} data-testid="design-template-preview-close">
            Закрыть
          </Button>
        </div>
      }
    >
      <div className="tpl-preview-frame" data-testid="design-template-preview-modal">
        {bundleQuery.isLoading && <p className="tpl-upload-hint">Загружаем шаблон…</p>}
        {bundleQuery.error && (
          <Banner tone="error" title="Не удалось загрузить файлы шаблона" description={(bundleQuery.error as Error).message} />
        )}
        {bundle && specs.length === 0 && (
          <Banner tone="warning" title="У шаблона нет демонстрационных данных" description="Предпросмотр недоступен — в манифесте не объявлен preview.demoData." />
        )}

        {bundle && specs.length > 0 && (
          <div className="tpl-check-split">
            <nav className="tpl-check-rail" aria-label="Экраны шаблона">
              {specs.map((s) => (
                <button
                  key={s.route}
                  type="button"
                  className={"tpl-check-rail__var tpl-check-rail__var--top" + (s.route === selectedRoute ? " is-active" : "")}
                  aria-current={s.route === selectedRoute ? "page" : undefined}
                  onClick={() => setSelectedRoute(s.route)}
                  data-testid={`design-template-preview-screen-${s.route}`}
                >
                  <span>{s.label ?? s.route}</span>
                </button>
              ))}
            </nav>

            <div className="tpl-check-stage">
              <div className="tpl-check-stage__frame">
                {selectedSpec && selectedLayout != null ? (
                  <TemplateScreen
                    layout={selectedLayout}
                    context={selectedSpec.input.context}
                    slots={selectedSpec.input.slots}
                    content={selectedSpec.input.content}
                    css={bundle.css}
                    cssVars={cssVars}
                  />
                ) : (
                  <p className="tpl-upload-hint tpl-check-stage__empty">
                    {selectedSpec ? `Макет «${selectedSpec.layoutKey}» не найден в шаблоне.` : "Выберите экран слева."}
                  </p>
                )}
              </div>
              <div className="tpl-check-stage__caption">{selectedSpec?.label ?? selectedRoute}</div>
            </div>
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
