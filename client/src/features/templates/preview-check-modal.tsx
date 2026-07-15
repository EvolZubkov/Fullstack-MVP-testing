/**
 * @module features/templates/preview-check-modal
 * @description The PRD-3 §3.4 preview + health-check modal. Loads the template's
 * smoke-bundle (manifest + demo + layouts + css), renders every preview screen
 * from the SAME unified renderer the runtime hosts use ({@link TemplateScreen}),
 * and runs the browser health check ({@link runSmokeChecks}) entirely client-side
 * (NFR-03). A passing report is posted to the server and unlocks activation
 * (NFR-01); the server re-enforces the gate.
 *
 * Left: a three-level rail (Раздел → Тип → Вариант отрисовки) with a status dot
 * on each variant leaf. Right: the live preview of the selected variant plus the
 * check summary and, for a failing variant, its blocking errors.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banner, Button, ModalDialog } from "@universityrt/ui-kit";
import { AlertTriangle, ChevronRight, Play, Power, RefreshCw, X } from "lucide-react";
import { TemplateScreen } from "@/components/template-screen";
import { buildScreenInputs } from "@shared/template/preview-context";
import { runSmokeChecks, type SmokeReport, type SmokeRouteResult } from "@shared/template/smoke-runner";
import {
  fetchSmokeBundle,
  useActivateTemplate,
  usePostSmokeReport,
  type AdminTemplate,
  type SmokeBundle,
} from "./use-admin-templates";
import { buildRail } from "./preview-rail";

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
  const [openTypes, setOpenTypes] = useState<Set<string>>(new Set());

  // Reset per open / template switch.
  useEffect(() => {
    if (open) {
      setReport(template.smokeTestJson ?? null);
      setSelectedId(null);
      setRunning(false);
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
      setOpenTypes(new Set(rail.flatMap((s) => s.types.map((t) => t.key))));
    }
  }, [open, specs, rail, selectedId, bundle]);

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

  const toggleType = (key: string) => {
    setOpenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const dotClass = (id: string): string => {
    if (running) return "tpl-check-dot tpl-check-dot--run";
    const s = statusById.get(id)?.status;
    return "tpl-check-dot" + (s ? ` tpl-check-dot--${s}` : "");
  };

  const selectedSpec = selectedId ? specById.get(selectedId) : undefined;
  const selectedLayout = selectedSpec && bundle ? bundle.layouts[selectedSpec.layoutKey] : undefined;
  const selectedResult = selectedId ? statusById.get(selectedId) : undefined;
  const selectedLabel = selectedSpec
    ? rail
        .flatMap((sec) => sec.types.flatMap((t) => t.variants))
        .find((v) => v.id === selectedId)?.label ?? selectedSpec.route
    : "";

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
        description={report.warned > 0 ? `${report.warned} предупреждение(й). Шаблон можно активировать.` : "Шаблон можно активировать."}
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
          <nav className="tpl-check-rail" aria-label="Экраны шаблона по разделам">
            {rail.map((section) => (
              <div key={section.key}>
                <div className="tpl-check-rail__section">{section.label}</div>
                {section.types.map((type) => {
                  // Two-level rail: a type with a single render variant is shown as
                  // the screen itself (no redundant middle level). The collapsible
                  // type group appears ONLY when a type has 2+ render variants.
                  if (type.variants.length === 1) {
                    const v = type.variants[0];
                    return (
                      <button
                        key={v.id}
                        type="button"
                        className={"tpl-check-rail__var tpl-check-rail__var--top" + (v.id === selectedId ? " is-active" : "")}
                        aria-current={v.id === selectedId ? "page" : undefined}
                        onClick={() => setSelectedId(v.id)}
                      >
                        <span>{type.label}</span>
                        <span className={dotClass(v.id)} aria-hidden="true" />
                      </button>
                    );
                  }
                  const isOpen = openTypes.has(type.key);
                  return (
                    <div key={type.key}>
                      <button
                        type="button"
                        className={"tpl-check-rail__type" + (isOpen ? " is-open" : "")}
                        onClick={() => toggleType(type.key)}
                        aria-expanded={isOpen ? "true" : "false"}
                      >
                        <ChevronRight size={14} className="tpl-check-rail__chevron" aria-hidden="true" />
                        <span className="tpl-check-rail__type-label">{type.label}</span>
                        <span className="tpl-check-rail__type-n" aria-label={`вариантов: ${type.variants.length}`}>
                          {type.variants.length}
                        </span>
                      </button>
                      {isOpen &&
                        type.variants.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            className={"tpl-check-rail__var" + (v.id === selectedId ? " is-active" : "")}
                            aria-current={v.id === selectedId ? "page" : undefined}
                            onClick={() => setSelectedId(v.id)}
                          >
                            <span>{v.label}</span>
                            <span className={dotClass(v.id)} aria-hidden="true" />
                          </button>
                        ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="tpl-check-stage">
            {summary}

            {selectedResult && selectedResult.status === "fail" && selectedResult.errors.length > 0 && (
              <div className="tpl-check-errors">
                <div className="tpl-check-errors__head">
                  <AlertTriangle size={16} aria-hidden="true" />
                  {selectedLabel} — {selectedResult.errors.length} блокирующая(их) ошибка(и)
                </div>
                <ul className="tpl-check-errors__list">
                  {selectedResult.errors.map((e, i) => (
                    <li className="tpl-check-errors__item" key={i}>
                      <X size={16} style={{ color: "var(--ou-error-default)", flex: "0 0 auto" }} aria-hidden="true" />
                      <span>{e}</span>
                    </li>
                  ))}
                </ul>
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
                  shell={bundle.manifest.mountShell ? bundle.layouts.shell : undefined}
                />
              ) : (
                <p className="tpl-upload-hint" style={{ padding: "var(--ou-space-5)" }}>
                  {selectedSpec ? `Макет «${selectedSpec.layoutKey}» не найден в пакете.` : "Выберите экран слева."}
                </p>
              )}
            </div>
            <div className="tpl-check-stage__caption">
              {selectedLabel}
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
