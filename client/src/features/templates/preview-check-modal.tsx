/**
 * @module features/templates/preview-check-modal
 * @description The PRD-3 §3.4 preview + health-check modal. Loads the template's
 * smoke-bundle (manifest + demo + layouts + css), renders every preview screen
 * from the SAME unified renderer the runtime hosts use ({@link TemplateScreen}),
 * and runs the browser health check ({@link runSmokeChecks}) entirely client-side
 * (NFR-03). A passing report is posted to the server and unlocks activation
 * (NFR-01); the server re-enforces the gate.
 *
 * Left: a three-level rail (Раздел → Вариант → демонстрации) with a status dot on
 * every level that can be selected — the group dot is the worst status of its
 * demonstrations. Right: the live preview of the selected screen plus the
 * check summary and the selected variant's messages — blocking errors and
 * non-blocking warnings are both spelled out, so a yellow dot is readable and
 * not just countable.
 *
 * PRD-23: a template that declares `themes[]` ships a palette per theme, so the
 * stage carries the same palette switch as the editor's preview
 * ({@link module:features/tests/editor/sections/template-preview-modal}). Without it
 * the registry showed only whichever palette `prefers-color-scheme` happened to pick,
 * and an admin could neither see nor health-check the other one.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banner, Button, ModalDialog, SegmentedControl } from "@universityrt/ui-kit";
import { AlertTriangle, Play, Power, RefreshCw, X } from "lucide-react";
import { TemplateScreen } from "@/components/template-screen";
import { buildScreenInputs } from "@shared/template/preview-context";
import { declaredThemes, type ThemeId } from "@shared/template/themes";
import { runSmokeChecks, type SmokeReport, type SmokeRouteResult } from "@shared/template/smoke-runner";
import {
  fetchSmokeBundle,
  useActivateTemplate,
  usePostSmokeReport,
  type AdminTemplate,
  type SmokeBundle,
} from "./use-admin-templates";
import { buildRail, variantStatus, type RailVariant } from "./preview-rail";
import { TemplatePreviewRail } from "./preview-rail-nav";

export interface PreviewCheckModalProps {
  open: boolean;
  onClose: () => void;
  template: AdminTemplate;
  /** Called after a successful activation so the parent can refresh/close. */
  onActivated?: () => void;
}

export function PreviewCheckModal({ open, onClose, template, onActivated }: PreviewCheckModalProps) {
  const bundleQuery = useQuery<SmokeBundle>({
    queryKey: ["/api/admin/templates", template.id, "smoke-bundle"],
    queryFn: () => fetchSmokeBundle(template.id),
    enabled: open,
  });
  const postReport = usePostSmokeReport();
  const activate = useActivateTemplate();

  const bundle = bundleQuery.data;
  const specs = useMemo(() => (bundle ? buildScreenInputs(bundle.demo, bundle.manifest) : []), [bundle]);
  const rail = useMemo(() => buildRail(specs), [specs]);
  const specById = useMemo(() => new Map(specs.map((s) => [s.id, s])), [specs]);

  const [report, setReport] = useState<SmokeReport | null>(template.smokeTestJson ?? null);
  const [running, setRunning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openVariants, setOpenVariants] = useState<Set<string>>(new Set());

  // PRD-23: palettes the template declares. Two or more is a CHOICE — then the
  // stage is pinned to one of them and the switch flips between them. With a single
  // palette nothing is pinned, so the template's own `prefers-color-scheme` rules
  // decide, exactly as they do in a run.
  const themes = useMemo(() => declaredThemes(bundle?.manifest), [bundle]);
  const [stageTheme, setStageTheme] = useState<ThemeId | null>(null);
  const shownTheme: ThemeId | null =
    themes.length >= 2 ? (stageTheme ?? themes[0].id) : null;

  // Reset per open / template switch.
  useEffect(() => {
    if (open) {
      setReport(template.smokeTestJson ?? null);
      setSelectedId(null);
      setRunning(false);
      setStageTheme(null);
    }
  }, [open, template.id, template.smokeTestJson]);

  // Once specs are available, select the default screen and expand all types.
  // `preview.defaultRoute` is a route; map it to a screen id (first match), so a
  // template whose default points at a content kind still resolves to a variant.
  useEffect(() => {
    if (open && specs.length && selectedId == null) {
      const wanted = bundle?.manifest.preview?.defaultRoute;
      const initial =
        specs.find((s) => s.id === wanted)?.id ??
        specs.find((s) => s.route === wanted)?.id ??
        specs[0].id;
      setSelectedId(initial);
      setOpenVariants(new Set(rail.flatMap((s) => s.variants.map((v) => v.key))));
    }
  }, [open, specs, rail, selectedId, bundle]);

  // Where the selected screen sits: its variant group and its index among that
  // variant's demonstrations. Drives the slide counter and the stage navigation.
  const placeById = useMemo(() => {
    const map = new Map<string, { variant: RailVariant; index: number }>();
    for (const section of rail) {
      for (const variant of section.variants) {
        variant.screens.forEach((screen, index) => map.set(screen.id, { variant, index }));
      }
    }
    return map;
  }, [rail]);

  const statusById = useMemo(
    () => new Map<string, SmokeRouteResult>((report?.routes ?? []).map((r) => [r.id ?? r.route, r])),
    [report],
  );

  const runCheck = () => {
    if (!bundle) return;
    setRunning(true);
    // Defer so the "running" state paints before the (brief, synchronous) run.
    window.setTimeout(() => {
      try {
        const rep = runSmokeChecks({
          dataset: bundle.demo,
          manifest: bundle.manifest,
          layouts: bundle.layouts,
          templateJs: bundle.templateJs,
          // Картинки отчёта — файлы этого шаблона; в браузере они доступны только
          // через роут ассетов (PRD-27 FR-05).
          assetBase: `/api/templates/${encodeURIComponent(template.id)}/assets/`,
        });
        setReport(rep);
        const firstFail = rep.routes.find((r) => r.status === "fail");
        const failId = firstFail?.id ?? firstFail?.route;
        if (failId && specById.has(failId)) setSelectedId(failId);
        postReport.mutate({ id: template.id, report: rep });
      } finally {
        setRunning(false);
      }
    }, 30);
  };

  const toggleVariant = (key: string) => {
    setOpenVariants((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const dotClassFor = (status?: string): string =>
    running ? "tpl-check-dot tpl-check-dot--run" : "tpl-check-dot" + (status ? ` tpl-check-dot--${status}` : "");

  const dotClass = (id: string): string => dotClassFor(statusById.get(id)?.status);

  const selectedSpec = selectedId ? specById.get(selectedId) : undefined;
  const selectedLayout = selectedSpec && bundle ? bundle.layouts[selectedSpec.layoutKey] : undefined;
  const selectedResult = selectedId ? statusById.get(selectedId) : undefined;
  const selectedPlace = selectedId ? placeById.get(selectedId) : undefined;
  const slideCount = selectedPlace?.variant.screens.length ?? 0;
  // A variant with one demonstration IS its variant — name it from the manifest.
  // With several, the demonstration's own name is what tells them apart.
  const selectedLabel = selectedPlace
    ? slideCount > 1
      ? selectedPlace.variant.screens[selectedPlace.index].label
      : selectedPlace.variant.label
    : selectedSpec?.route ?? "";

  /**
   * The layout's own «Далее»/«Назад» leaf through the variant's demonstrations, so
   * a gallery previews the way a learner walks it. Wraps around: the preview has
   * no run state to end on.
   */
  const handleStageAction = (action: string) => {
    if (!selectedPlace || slideCount < 2) return;
    const step = action === "nav:next" ? 1 : action === "nav:prev" ? -1 : 0;
    if (step === 0) return;
    const next = (selectedPlace.index + step + slideCount) % slideCount;
    setSelectedId(selectedPlace.variant.screens[next].id);
  };

  // Reports persisted before warnings existed carry no `warnings` array — read
  // both lists defensively so an old `templates.smoke_test_json` still renders.
  const selectedErrors = selectedResult?.errors ?? [];
  const selectedWarnings = selectedResult?.warnings ?? [];

  const isAlreadyActive = template.status === "active" || template.isActive === true;
  const canActivateNow = !isAlreadyActive && (template.isBuiltin || (report?.ok ?? false));

  // ─── Footer verdict ──────────────────────────────────────────────────────
  let verdict: React.ReactNode;
  if (running) {
    verdict = <span className="tpl-check-verdict">Проверка выполняется…</span>;
  } else if (isAlreadyActive) {
    verdict = <span className="tpl-check-verdict tpl-check-verdict--ok">Шаблон активен</span>;
  } else if (!report) {
    verdict = <span className="tpl-check-verdict">Проверка работоспособности не запускалась</span>;
  } else if (report.ok) {
    verdict = <span className="tpl-check-verdict tpl-check-verdict--ok">Активация доступна</span>;
  } else {
    verdict = <span className="tpl-check-verdict tpl-check-verdict--blocked">Активация заблокирована</span>;
  }

  // ─── Stage summary banner ────────────────────────────────────────────────
  let summary: React.ReactNode = null;
  if (running) {
    summary = <Banner tone="info" title="Идёт проверка работоспособности…" description="Каждый экран отрисовывается на демонстрационных данных в изолированном окне." />;
  } else if (report?.ok) {
    summary = (
      <Banner
        tone={report.warned > 0 ? "warning" : "success"}
        title={`Проверка пройдена · ${report.passed} из ${report.total} экранов`}
        description={
          report.warned > 0
            ? `${report.warned} предупреждение(й) — выберите вариант с жёлтой отметкой, чтобы прочитать текст. Шаблон можно активировать.`
            : "Шаблон можно активировать."
        }
      />
    );
  } else if (report && !report.ok) {
    summary = (
      <Banner
        tone="error"
        title={`Проверка не пройдена · ${report.failed} экран(ов) с ошибками`}
        description="Выберите вариант с красной отметкой, чтобы увидеть детали."
      />
    );
  }

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="xl"
      className="tpl-check-modal"
      title={`Предпросмотр «${template.name}» v${template.version}`}
      description="Демонстрационные данные шаблона. Элементы управления работают, прогресс не сохраняется."
      footer={
        <div className="tpl-check-foot">
          {verdict}
          <div className="tpl-check-foot__actions">
            <Button
              variant="secondary"
              size="m"
              leadingIcon={report ? <RefreshCw size={14} /> : <Play size={14} />}
              onClick={runCheck}
              loading={running}
              disabled={!bundle || running}
            >
              {report ? "Перепроверить" : "Проверить работоспособность"}
            </Button>
            <Button
              variant="primary"
              size="m"
              leadingIcon={<Power size={14} />}
              onClick={() => activate.mutate(template.id, { onSuccess: () => onActivated?.() })}
              loading={activate.isPending}
              disabled={isAlreadyActive || !canActivateNow || running}
            >
              {isAlreadyActive ? "Активирован" : "Активировать"}
            </Button>
          </div>
        </div>
      }
    >
      {bundleQuery.isLoading && <p className="tpl-upload-hint">Загружаем шаблон…</p>}
      {bundleQuery.error && (
        <Banner tone="error" title="Не удалось загрузить файлы шаблона" description={(bundleQuery.error as Error).message} />
      )}

      {bundle && (
        <div className="tpl-check-split">
          <TemplatePreviewRail
            rail={rail}
            selectedId={selectedId}
            onSelect={setSelectedId}
            openVariants={openVariants}
            onToggleVariant={toggleVariant}
            ariaLabel="Экраны шаблона по разделам"
            screenDot={(id) => <span className={dotClass(id)} aria-hidden="true" />}
            // The group dot carries the WORST status of its demonstrations, so a
            // collapsed variant never hides a failing slide.
            variantDot={(variant) => (
              <span className={dotClassFor(variantStatus(variant, statusById))} aria-hidden="true" />
            )}
          />

          <div className="tpl-check-stage">
            {summary}

            {selectedErrors.length > 0 && (
              <div className="tpl-check-errors">
                <div className="tpl-check-errors__head">
                  <AlertTriangle size={16} aria-hidden="true" />
                  {selectedLabel} — {selectedErrors.length} блокирующая(их) ошибка(и)
                </div>
                <ul className="tpl-check-errors__list">
                  {selectedErrors.map((e, i) => (
                    <li className="tpl-check-errors__item" key={i}>
                      <X size={16} style={{ color: "var(--ou-error-default)", flex: "0 0 auto" }} aria-hidden="true" />
                      <span>{e}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selectedWarnings.length > 0 && (
              <div className="tpl-check-errors tpl-check-errors--warn">
                <div className="tpl-check-errors__head">
                  <AlertTriangle size={16} aria-hidden="true" />
                  {selectedLabel} — {selectedWarnings.length} предупреждение(й)
                </div>
                <ul className="tpl-check-errors__list">
                  {selectedWarnings.map((w, i) => (
                    <li className="tpl-check-errors__item" key={i}>
                      <AlertTriangle
                        size={16}
                        style={{ color: "var(--ou-warning-default)", flex: "0 0 auto" }}
                        aria-hidden="true"
                      />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Directly above the stage it controls — same control, same class and
                same position as the editor's preview (PRD-23). */}
            {themes.length >= 2 && (
              <div className="tpl-check-stage__themes">
                <SegmentedControl<ThemeId>
                  size="s"
                  items={themes.map((t) => ({ value: t.id, label: t.label }))}
                  value={shownTheme ?? themes[0].id}
                  onChange={(v) => setStageTheme(v)}
                  aria-label="Палитра предпросмотра"
                  data-testid="tpl-check-preview-theme"
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
                  dataTheme={shownTheme ?? undefined}
                  themed={themes.length >= 2}
                  shell={bundle.manifest.mountShell ? bundle.layouts.shell : undefined}
                  onAction={handleStageAction}
                />
              ) : (
                <p className="tpl-upload-hint" style={{ padding: "var(--ou-space-5)" }}>
                  {selectedSpec ? `Макет «${selectedSpec.layoutKey}» не найден в пакете.` : "Выберите экран слева."}
                </p>
              )}
            </div>
            <div className="tpl-check-stage__caption">
              {selectedLabel}
              {slideCount > 1 && selectedPlace ? ` · слайд ${selectedPlace.index + 1} из ${slideCount}` : null}
              {selectedSpec ? (
                <>
                  {" · экран "}
                  <code>{selectedSpec.route}</code>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </ModalDialog>
  );
}
