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
import { Banner, Button, ModalDialog, SegmentedControl } from "@universityrt/ui-kit";
import { TemplateScreen } from "@/components/template-screen";
import { buildScreenInputs, type PreviewDemoDataset } from "@shared/template/preview-context";
import { buildTemplateCssVars } from "@shared/template/params-css";
import { baseParams, buildTemplateThemeCss } from "@shared/template/theme-css";
import { declaredThemes, type TestTheme, type ThemeId } from "@shared/template/themes";
import { buildRail } from "@/features/templates/preview-rail";
import { TemplatePreviewRail } from "@/features/templates/preview-rail-nav";
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
  /** PRD-23: palette the author pinned; «Авто» shows both, by the switch. */
  theme?: TestTheme;
  /** PRD-23: draft colour overrides per palette. */
  paramsByTheme?: Partial<Record<ThemeId, Record<string, unknown>>>;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function TemplatePreviewModal({ open, onClose, template, params, theme, paramsByTheme }: TemplatePreviewModalProps) {
  const bundleQuery = useTemplateBundle(template?.id, open);
  const bundle = bundleQuery.data;

  // Screens from the template's demo dataset (same bridge as «Шаблоны»).
  const specs = useMemo(
    () => (bundle?.demo ? buildScreenInputs(bundle.demo as PreviewDemoDataset, bundle.manifest) : []),
    [bundle],
  );
  const specById = useMemo(() => new Map(specs.map((s) => [s.id, s])), [specs]);
  // The SAME grouped rail «Шаблоны» shows (Раздел → Вариант → демонстрации). A flat
  // list of every demo screen is unreadable once a template ships a dozen
  // learning-page variants — same-type screens belong in one branch.
  const rail = useMemo(() => buildRail(specs), [specs]);
  const [openVariants, setOpenVariants] = useState<Set<string>>(new Set());

  const toggleVariant = (key: string) => {
    setOpenVariants((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Draft params → CSS variables, via the SAME mapping the runtime uses. PRD-23:
  // for a template with palettes the colours leave this map and become a CSS block
  // instead — inline properties cannot be scoped to a palette.
  const design = useMemo(() => ({ params, theme, paramsByTheme }), [params, theme, paramsByTheme]);
  const cssVars = useMemo(
    () => buildTemplateCssVars(baseParams(design, bundle?.manifest), bundle?.manifest?.params),
    [design, bundle],
  );
  const themeCss = useMemo(
    () => buildTemplateThemeCss(design, bundle?.manifest, { rootSelector: ":host" }),
    [design, bundle],
  );
  const themes = useMemo(() => declaredThemes(bundle?.manifest), [bundle]);

  // Which palette the STAGE shows. A pinned test opens on its own palette; «Авто»
  // opens on the first one and the author flips between them — that is the only
  // way to check a theme the author is not currently running.
  const [stageTheme, setStageTheme] = useState<ThemeId | null>(null);
  const shownTheme: ThemeId | null =
    themes.length >= 2
      ? (stageTheme ?? (theme && theme !== "auto" ? theme : themes[0].id))
      : null;

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // On open / template switch, select the manifest default screen (or the first).
  // `defaultRoute` is a route; resolve it to a screen id (first match).
  useEffect(() => {
    if (open && specs.length) {
      const wanted = bundle?.manifest.preview?.defaultRoute;
      setSelectedId(
        specs.find((s) => s.id === wanted)?.id ??
          specs.find((s) => s.route === wanted)?.id ??
          specs[0].id,
      );
      // Branches open, as in «Шаблоны»: the author must SEE the demonstrations, and
      // a rail that opens fully collapsed hides the very screens it lists.
      setOpenVariants(new Set(rail.flatMap((s) => s.variants.map((v) => v.key))));
    }
    if (!open) setSelectedId(null);
  }, [open, template?.id, specs, rail, bundle]);

  if (!template) return null;

  const selectedSpec = selectedId ? specById.get(selectedId) : undefined;
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
            <TemplatePreviewRail
              rail={rail}
              selectedId={selectedId}
              onSelect={setSelectedId}
              openVariants={openVariants}
              onToggleVariant={toggleVariant}
              ariaLabel="Экраны шаблона"
              screenTestId={(id) => `design-template-preview-screen-${id}`}
            />

            <div className="tpl-check-stage">
              {themes.length >= 2 && (
                <div className="tpl-check-stage__themes">
                  <SegmentedControl<ThemeId>
                    size="s"
                    items={themes.map((t) => ({ value: t.id, label: t.label }))}
                    value={shownTheme ?? themes[0].id}
                    onChange={(v) => setStageTheme(v)}
                    aria-label="Палитра предпросмотра"
                    data-testid="design-template-preview-theme"
                  />
                </div>
              )}
              <div className="tpl-check-stage__frame">
                {selectedSpec && selectedLayout != null ? (
                  <TemplateScreen
                    layout={selectedLayout}
                    context={selectedSpec.input.context}
                    slots={selectedSpec.input.slots}
                    content={selectedSpec.input.content}
                    css={bundle.css}
                    cssVars={cssVars}
                    themeCss={themeCss}
                    dataTheme={shownTheme ?? undefined}
                    shell={(bundle.manifest as { mountShell?: boolean }).mountShell ? bundle.layouts.shell : undefined}
                  />
                ) : (
                  <p className="tpl-upload-hint tpl-check-stage__empty">
                    {selectedSpec ? `Макет «${selectedSpec.layoutKey}» не найден в шаблоне.` : "Выберите экран слева."}
                  </p>
                )}
              </div>
              <div className="tpl-check-stage__caption" data-testid="design-template-preview-caption">
                {selectedSpec?.label ?? selectedSpec?.route ?? ""}
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
