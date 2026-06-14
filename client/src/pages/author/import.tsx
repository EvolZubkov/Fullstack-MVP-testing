/**
 * @module pages/author/import
 *
 * PRD-14 FR-15 «Импорт» section: a single inline page (no modal/drawer) that
 * imports an Excel file. The file's role sheets are auto-detected
 * (POST /api/workbook/inspect): a questions-only file goes to the global bank
 * (POST /api/questions/import), while a file carrying «Шкалы»/«Показатели»/
 * «Вклады вопросов» requires a target test — an existing one
 * (POST /api/tests/:id/workbook/import) or a freshly created one
 * (POST /api/workbook/import-new). Each path supports a dry-run preview before
 * the actual write.
 *
 * The page title currently lives in the content (PageHeader); it moves to the
 * shell header when the app-wide header-title task lands (see
 * docs/PLAN_appshell_migration.md §9).
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Download, Upload, X } from "lucide-react";
import {
  Banner,
  Button,
  Card,
  CardBody,
  CardHeader,
  Combobox,
  FileItem,
  FileUploader,
  Input,
  Tag,
  Text,
  type ComboboxOption,
} from "@universityrt/ui-kit";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n";

/** Sentinel value of the «＋ Создать новый тест» option in the target combobox. */
const NEW_TEST = "__new__";

interface InspectResult {
  sheets: string[];
  hasQuestions: boolean;
  hasScales: boolean;
  hasResultVariables: boolean;
  hasMeasurements: boolean;
  requiresTest: boolean;
  counts: { questions: number; scales: number; resultVariables: number; measurements: number };
}

/** Normalized import/dry-run result across the three endpoints. */
interface Plan {
  scope: "questions" | "workbook";
  questions?: { created: number; updated: number; skipped: number };
  scales?: { created: number; updated: number };
  resultVariables?: { created: number; updated: number };
  measurements?: { rows: number; questions: number };
  structure?: { sections: number; quotas: number };
  errors: string[];
  test?: { id: string | null; title: string } | null;
}

interface TestLite {
  id: string;
  title: string;
}

const tr = t.importPage;

function formatKb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

/** Maps a raw endpoint response to the unified {@link Plan}. */
function normalizePlan(data: any, requiresTest: boolean): Plan {
  if (!requiresTest) {
    return {
      scope: "questions",
      questions: { created: data.created ?? 0, updated: data.updated ?? 0, skipped: data.skipped ?? 0 },
      errors: data.errors ?? [],
    };
  }
  return {
    scope: "workbook",
    questions: data.questions,
    scales: data.scales,
    resultVariables: data.resultVariables,
    measurements: data.measurements,
    structure: data.structure,
    errors: data.errors ?? [],
    test: data.test ?? null,
  };
}

/** One plan line: name + create/update/skip count tags. */
function PlanRow({
  name,
  suffix,
  created,
  updated,
  skipped,
  extra,
}: {
  name: string;
  suffix?: string;
  created?: number;
  updated?: number;
  skipped?: number;
  extra?: string;
}) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex-1 font-semibold">
        {name}
        {suffix && <Text tone="muted"> {suffix}</Text>}
      </span>
      <span className="flex flex-wrap gap-2">
        {!!created && (
          <Tag tone="success" variant="outline" size="s">{`+${created} ${tr.countCreate}`}</Tag>
        )}
        {!!updated && (
          <Tag tone="neutral" variant="outline" size="s">{`${updated} ${tr.countUpdate}`}</Tag>
        )}
        {!!skipped && (
          <Tag tone="neutral" variant="outline" size="s">{`${skipped} ${tr.countSkip}`}</Tag>
        )}
        {extra && <Tag tone="neutral" variant="outline" size="s">{extra}</Tag>}
      </span>
    </li>
  );
}

export default function ImportPage() {
  const { toast } = useToast();
  const { can } = useAuth();
  const canCreateTest = can("tests.create");

  const [file, setFile] = useState<File | null>(null);
  const [inspect, setInspect] = useState<InspectResult | null>(null);
  const [targetTestId, setTargetTestId] = useState<string | null>(null);
  const [newTestTitle, setNewTestTitle] = useState("");
  const [preview, setPreview] = useState<Plan | null>(null);
  const [result, setResult] = useState<Plan | null>(null);

  const { data: tests } = useQuery<TestLite[]>({ queryKey: ["/api/tests"] });

  const testOptions = useMemo<ComboboxOption[]>(() => {
    const opts: ComboboxOption[] = [];
    if (canCreateTest) opts.push({ value: NEW_TEST, label: tr.createNew });
    for (const test of tests ?? []) opts.push({ value: test.id, label: test.title });
    return opts;
  }, [tests, canCreateTest]);

  const isNew = targetTestId === NEW_TEST;
  const requiresTest = inspect?.requiresTest ?? false;
  const targetReady =
    !requiresTest ||
    (isNew ? newTestTitle.trim().length > 0 : !!targetTestId && targetTestId !== NEW_TEST);

  const targetTitle = isNew
    ? newTestTitle.trim()
    : tests?.find((it) => it.id === targetTestId)?.title ?? "";

  function resetAll() {
    setFile(null);
    setInspect(null);
    setTargetTestId(null);
    setNewTestTitle("");
    setPreview(null);
    setResult(null);
  }

  // ── Inspect: detect the file's role sheets, decide if a test is needed. ──
  const inspectMut = useMutation({
    mutationFn: async (f: File): Promise<InspectResult> => {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/workbook/inspect", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error("inspect failed");
      return res.json();
    },
    onSuccess: (data) => setInspect(data),
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: tr.failedToInspect });
      resetAll();
    },
  });

  // ── Import / dry-run: routes by the inspect result and target choice. ──
  const importMut = useMutation({
    mutationFn: async ({ dryRun }: { dryRun: boolean }): Promise<Plan> => {
      const fd = new FormData();
      fd.append("file", file!);
      const q = dryRun ? "?dryRun=true" : "";
      let url: string;
      if (!requiresTest) {
        url = `/api/questions/import${q}`;
      } else if (isNew) {
        fd.append("newTestTitle", newTestTitle.trim());
        url = `/api/workbook/import-new${q}`;
      } else {
        url = `/api/tests/${targetTestId}/workbook/import${q}`;
      }
      const res = await fetch(url, { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error("import failed");
      return normalizePlan(await res.json(), requiresTest);
    },
    onSuccess: (plan, vars) => {
      if (vars.dryRun) {
        setPreview(plan);
        return;
      }
      setResult(plan);
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/questions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/topics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tests"] });
      toast({ title: tr.doneTitle, description: doneSummary(plan) });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: tr.failedToImport });
    },
  });

  function handleFiles(files: File[]) {
    const f = files[0];
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) {
      toast({ variant: "destructive", title: t.common.error, description: tr.wrongFileType });
      return;
    }
    setFile(f);
    setInspect(null);
    setPreview(null);
    setResult(null);
    setTargetTestId(null);
    setNewTestTitle("");
    inspectMut.mutate(f);
  }

  /** Human-readable one-line summary for the success toast / done banner. */
  function doneSummary(plan: Plan): string {
    if (plan.scope === "questions" && plan.questions) {
      const { created, updated, skipped } = plan.questions;
      return `${tr.planQuestions}: ${created} ${tr.countCreate}, ${updated} ${tr.countUpdate}, ${skipped} ${tr.countSkip}`;
    }
    const parts: string[] = [];
    if (plan.questions) {
      parts.push(`${tr.planQuestions}: +${plan.questions.created} / ${plan.questions.updated}`);
    }
    if (plan.scales) parts.push(`${tr.planScales}: +${plan.scales.created} / ${plan.scales.updated}`);
    if (plan.resultVariables) {
      parts.push(`${tr.planResultVariables}: +${plan.resultVariables.created} / ${plan.resultVariables.updated}`);
    }
    if (plan.measurements) {
      parts.push(`${tr.planMeasurements}: ${plan.measurements.rows}`);
    }
    if (plan.structure && plan.structure.sections > 0) {
      parts.push(`${tr.planStructure}: ${plan.structure.sections}`);
    }
    return parts.join(" · ");
  }

  const busy = importMut.isPending;
  const inspecting = inspectMut.isPending;

  // ── Render ────────────────────────────────────────────────────────────────
  const fileMeta = file
    ? inspect
      ? `Листов: ${inspect.sheets.length} · ${formatKb(file.size)}`
      : formatKb(file.size)
    : "";

  function renderPlanRows(plan: Plan) {
    if (plan.scope === "questions") {
      const q = plan.questions!;
      return (
        <ul className="my-3 flex flex-col gap-2">
          <PlanRow name={tr.planQuestions} suffix={tr.bankSuffix} created={q.created} updated={q.updated} skipped={q.skipped} />
        </ul>
      );
    }
    return (
      <ul className="my-3 flex flex-col gap-2">
        {plan.questions && (
          <PlanRow
            name={tr.planQuestions}
            suffix={tr.bankSuffix}
            created={plan.questions.created}
            updated={plan.questions.updated}
            skipped={plan.questions.skipped}
          />
        )}
        {plan.scales && (
          <PlanRow name={tr.planScales} created={plan.scales.created} updated={plan.scales.updated} />
        )}
        {plan.resultVariables && (
          <PlanRow
            name={tr.planResultVariables}
            created={plan.resultVariables.created}
            updated={plan.resultVariables.updated}
          />
        )}
        {plan.measurements && (
          <PlanRow
            name={tr.planMeasurements}
            extra={`${plan.measurements.rows} ${tr.measurementsSummary} · ${plan.measurements.questions} ${tr.questionsWord}`}
          />
        )}
        {plan.structure && (plan.structure.sections > 0 || plan.structure.quotas > 0) && (
          <PlanRow
            name={tr.planStructure}
            extra={`${plan.structure.sections} ${tr.sectionsWord} · ${plan.structure.quotas} ${tr.quotasWord}`}
          />
        )}
      </ul>
    );
  }

  return (
    <div>
      <PageHeader title={tr.title} description={tr.description} />

      <div className="max-w-3xl">
        <Card variant="outlined">
          <CardHeader title={tr.cardTitle} />
          <CardBody>
            {/* ── Done ────────────────────────────────────────────────── */}
            {result ? (
              <>
                <Banner
                  tone="success"
                  title={tr.doneTitle}
                  description={
                    <>
                      {doneSummary(result)}
                      {result.test?.id && (
                        <>
                          {" · "}
                          {tr.newTestCreated}: <strong>{result.test.title}</strong>
                        </>
                      )}
                    </>
                  }
                />
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="secondary" onClick={resetAll}>{tr.importMore}</Button>
                </div>
              </>
            ) : !file ? (
              /* ── Empty: uploader + template ──────────────────────────── */
              <>
                {/* `children` overrides the uploader's built-in CTA «таблетка»
                    (ou-uploader__cta) with a real DS Button; the whole dropzone
                    stays clickable (root opens the picker via bubbling). */}
                <FileUploader accept=".xlsx" onFiles={handleFiles}>
                  <span className="ou-uploader__icon" aria-hidden="true">
                    <Upload size={24} />
                  </span>
                  <span className="ou-uploader__title">{tr.uploaderTitle}</span>
                  <span className="ou-uploader__sub">{tr.uploaderSub}</span>
                  <Button variant="secondary" size="s" type="button" tabIndex={-1} className="mt-2">
                    {tr.uploaderCta}
                  </Button>
                </FileUploader>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="ghost"
                    size="s"
                    leadingIcon={<Download size={14} />}
                    onClick={() => {
                      window.location.href = "/api/workbook/template";
                    }}
                  >
                    {tr.downloadTemplate}
                  </Button>
                </div>
              </>
            ) : (
              /* ── File chosen → inspect → action / preview ─────────────── */
              <>
                <FileItem
                  name={file.name}
                  meta={preview ? "запись ещё не выполнена" : fileMeta}
                  kind="xls"
                  actions={[
                    { icon: <X size={14} />, ariaLabel: tr.removeFile, danger: true, onClick: resetAll },
                  ]}
                />

                {inspecting && (
                  <Banner tone="info" className="mt-3" description={tr.inspecting} />
                )}

                {/* Preview (dry-run) */}
                {!inspecting && preview && (
                  <>
                    {requiresTest && targetTitle && (
                      <Text as="p" tone="muted" className="mt-3">
                        {tr.targetLabel} <strong className="text-foreground">{targetTitle}</strong>
                      </Text>
                    )}
                    {preview.errors.length > 0 ? (
                      <Banner
                        tone="error"
                        className="mt-3"
                        title={`${preview.errors.length} ${tr.rowsSkippedTitle}`}
                        description={tr.rowsSkippedDesc}
                      />
                    ) : (
                      <Banner tone="success" variant="subtle" className="mt-3" description={tr.noErrors} />
                    )}
                    {renderPlanRows(preview)}
                    {preview.errors.length > 0 && (
                      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                        {preview.errors.slice(0, 12).map((e, i) => (
                          <li key={i} className="text-sm text-muted-foreground">{e}</li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-4 flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => setPreview(null)}>{tr.back}</Button>
                      <Button
                        variant="primary"
                        loading={busy}
                        onClick={() => importMut.mutate({ dryRun: false })}
                      >
                        {preview.errors.length > 0 ? tr.importValid : tr.doImport}
                      </Button>
                    </div>
                  </>
                )}

                {/* Action (no preview yet) */}
                {!inspecting && !preview && inspect && (
                  <>
                    <Banner
                      tone="info"
                      variant="subtle"
                      className="mt-3"
                      description={requiresTest ? tr.detectedWorkbook : tr.detectedQuestionsOnly}
                    />

                    {requiresTest && (
                      <div className="mt-3 flex flex-col gap-3">
                        <Combobox
                          label={tr.targetTest}
                          required
                          placeholder={tr.targetTestPlaceholder}
                          options={testOptions}
                          value={targetTestId}
                          onChange={(v) => {
                            setTargetTestId(v);
                            setPreview(null);
                          }}
                          fullWidth
                        />
                        {isNew && (
                          <Input
                            id="new-test-name"
                            label={tr.newTestName}
                            required
                            value={newTestTitle}
                            placeholder={tr.newTestNamePlaceholder}
                            fullWidth
                            onChange={(e) => {
                              setNewTestTitle(e.target.value);
                              setPreview(null);
                            }}
                          />
                        )}
                      </div>
                    )}

                    <div className="mt-4 flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        disabled={!targetReady || busy}
                        onClick={() => importMut.mutate({ dryRun: true })}
                      >
                        {tr.check}
                      </Button>
                      <Button
                        variant="primary"
                        disabled={!targetReady}
                        loading={busy}
                        title={
                          targetReady
                            ? undefined
                            : isNew
                              ? tr.nameNewTestFirst
                              : tr.chooseTestFirst
                        }
                        onClick={() => importMut.mutate({ dryRun: false })}
                      >
                        {tr.doImport}
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
