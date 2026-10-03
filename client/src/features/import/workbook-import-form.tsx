/**
 * @module features/import/workbook-import-form
 *
 * Шаг книги с вопросами в разделе «Импорт» (PRD-14 FR-15). Перенесён со страницы раздела без
 * изменения поведения: книга только с «Вопросами» уходит в общий банк
 * (`POST /api/questions/import`), книга со «Шкалами»/«Показателями»/«Вкладами вопросов» требует
 * целевой тест — существующий (`POST /api/tests/:id/workbook/import`) или новый
 * (`POST /api/workbook/import-new`). У каждого пути — сухой прогон до записи.
 *
 * Правка Э6 (эскиз `docs/wireframes/approved/e6-import-single-point.html`): целевой тест —
 * `Select searchable`, одиночный выбор с поиском по части названия; «＋ Создать новый тест» —
 * первым пунктом. `Combobox` по соглашению проекта — для множественного выбора.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import {
  Banner,
  Box,
  Button,
  Cluster,
  FileItem,
  Input,
  Select,
  Stack,
  Tag,
  Text,
  type SelectOption,
  useToast,
} from "@skillum/ui-kit";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { fileMeta, formatSize, plural } from "./file-meta";

/** Sentinel value of the «＋ Создать новый тест» option in the target select. */
const NEW_TEST = "__new__";

/** Ответ `POST /api/workbook/inspect` для книги с вопросами. */
export interface WorkbookInspectResult {
  kind: "workbook";
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
  /** Non-blocking notices from the importer (e.g. two competing scoring sources). */
  warnings: string[];
  test?: { id: string | null; title: string } | null;
}

interface TestLite {
  id: string;
  title: string;
}

const tr = t.importPage;

/** Maps a raw endpoint response to the unified {@link Plan}. */
function normalizePlan(data: any, requiresTest: boolean): Plan {
  if (!requiresTest) {
    return {
      scope: "questions",
      questions: { created: data.created ?? 0, updated: data.updated ?? 0, skipped: data.skipped ?? 0 },
      errors: data.errors ?? [],
      warnings: data.warnings ?? [],
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
    warnings: data.warnings ?? [],
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
    <Cluster as="li" gap={3} wrap={false}>
      <Box as="span" grow style={{ fontWeight: 600 }}>
        {name}
        {suffix && <Text tone="muted"> {suffix}</Text>}
      </Box>
      <Cluster as="span" gap={2}>
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
      </Cluster>
    </Cluster>
  );
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

function renderPlanRows(plan: Plan) {
  if (plan.scope === "questions") {
    const q = plan.questions!;
    return (
      <Stack as="ul" gap={2}>
        <PlanRow name={tr.planQuestions} suffix={tr.bankSuffix} created={q.created} updated={q.updated} skipped={q.skipped} />
      </Stack>
    );
  }
  return (
    <Stack as="ul" gap={2}>
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
    </Stack>
  );
}

export interface WorkbookImportFormProps {
  /** Выбранная книга. */
  file: File;
  /** Её разбор. */
  inspect: WorkbookInspectResult;
  /** Убрать файл: раздел возвращается к загрузчику. */
  onReset: () => void;
}

export function WorkbookImportForm({ file, inspect, onReset }: WorkbookImportFormProps) {
  const { push: toast } = useToast();
  const { can } = useAuth();
  const canCreateTest = can("tests.create");

  const [targetTestId, setTargetTestId] = useState<string | null>(null);
  const [newTestTitle, setNewTestTitle] = useState("");
  const [preview, setPreview] = useState<Plan | null>(null);
  const [result, setResult] = useState<Plan | null>(null);

  const { data: tests } = useQuery<TestLite[]>({ queryKey: ["/api/tests"] });

  const testOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [];
    if (canCreateTest) opts.push({ value: NEW_TEST, label: tr.createNew });
    for (const test of tests ?? []) opts.push({ value: test.id, label: test.title });
    return opts;
  }, [tests, canCreateTest]);

  const isNew = targetTestId === NEW_TEST;
  const requiresTest = inspect.requiresTest;
  const targetReady =
    !requiresTest ||
    (isNew ? newTestTitle.trim().length > 0 : !!targetTestId && targetTestId !== NEW_TEST);

  const targetTitle = isNew
    ? newTestTitle.trim()
    : tests?.find((it) => it.id === targetTestId)?.title ?? "";

  // ── Import / dry-run: routes by the inspect result and target choice. ──
  const importMut = useMutation({
    mutationFn: async ({ dryRun }: { dryRun: boolean }): Promise<Plan> => {
      const fd = new FormData();
      fd.append("file", file);
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
      toast({ tone: "success", title: tr.doneTitle, description: doneSummary(plan) });
    },
    onError: () => {
      toast({ tone: "error", title: t.common.error, description: tr.failedToImport });
    },
  });

  const busy = importMut.isPending;

  // ── Done ────────────────────────────────────────────────────────────────
  if (result) {
    return (
      <Stack gap={4}>
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
        <Cluster justify="end" gap={2} wrap={false}>
          <Button variant="secondary" onClick={onReset}>{tr.importMore}</Button>
        </Cluster>
      </Stack>
    );
  }

  return (
    <Stack gap={3}>
      <FileItem
        name={file.name}
        meta={
          preview
            ? "запись ещё не выполнена"
            : fileMeta("книга с вопросами", plural(inspect.sheets.length, ["лист", "листа", "листов"]), formatSize(file.size))
        }
        kind="xls"
        actions={[{ icon: <X size={14} />, ariaLabel: tr.removeFile, danger: true, onClick: onReset }]}
      />

      {/* Preview (dry-run) */}
      {preview && (
        <>
          {requiresTest && targetTitle && (
            <Text as="p" tone="muted">
              {tr.targetLabel} <strong style={{ color: "var(--ou-fg-default)" }}>{targetTitle}</strong>
            </Text>
          )}
          {preview.errors.length > 0 ? (
            <Banner
              tone="error"
              title={`${preview.errors.length} ${tr.rowsSkippedTitle}`}
              description={tr.rowsSkippedDesc}
            />
          ) : (
            <Banner tone="success" variant="subtle" description={tr.noErrors} />
          )}
          {/* Warnings do not block the import — the book is valid, but
              something in it likely is not what the author meant. */}
          {preview.warnings.length > 0 && (
            <Banner
              tone="warning"
              title={tr.warningsTitle}
              description={
                <ul className="ou-list--bulleted">
                  {preview.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              }
            />
          )}
          {renderPlanRows(preview)}
          {preview.errors.length > 0 && (
            <ul className="ou-list--bulleted">
              {preview.errors.slice(0, 12).map((e, i) => (
                <Text as="li" key={i} tone="muted">{e}</Text>
              ))}
            </ul>
          )}
          <Cluster justify="end" gap={2} wrap={false}>
            <Button variant="ghost" onClick={() => setPreview(null)}>{tr.back}</Button>
            <Button variant="primary" loading={busy} onClick={() => importMut.mutate({ dryRun: false })}>
              {preview.errors.length > 0 ? tr.importValid : tr.doImport}
            </Button>
          </Cluster>
        </>
      )}

      {/* Action (no preview yet) */}
      {!preview && (
        <>
          <Banner
            tone="info"
            variant="subtle"
            description={requiresTest ? tr.detectedWorkbook : tr.detectedQuestionsOnly}
          />

          {requiresTest && (
            <Stack gap={3}>
              <Select
                // Select has no `required`: the mark goes into the label, as elsewhere in the app.
                label={<>{tr.targetTest} <span className="ou-formfield__lbl-req" aria-hidden="true">*</span></>}
                placeholder={tr.targetTestPlaceholder}
                searchable
                searchPlaceholder="Поиск по названию теста"
                options={testOptions}
                value={targetTestId ?? undefined}
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
            </Stack>
          )}

          <Cluster justify="end" gap={2} wrap={false}>
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
              title={targetReady ? undefined : isNew ? tr.nameNewTestFirst : tr.chooseTestFirst}
              onClick={() => importMut.mutate({ dryRun: false })}
            >
              {tr.doImport}
            </Button>
          </Cluster>
        </>
      )}
    </Stack>
  );
}
