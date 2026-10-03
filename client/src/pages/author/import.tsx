/**
 * @module pages/author/import
 *
 * Раздел «Импорт» — ЕДИНАЯ точка импорта (Э6 UX-аудита, решение владельца 2026-10-02; эскиз
 * `docs/wireframes/approved/e6-import-single-point.html`). Принимает любой вид файла, на который
 * у человека есть право, и после распознавания продолжает на той же странице формой этого вида:
 *
 * - книга с вопросами (.xlsx) — {@link module:features/import/workbook-import-form};
 * - выгрузка отчёта LMS (.xlsx) — {@link module:features/analytics/lms-import/lms-import-form};
 * - список пользователей (.csv, .xlsx) — {@link module:features/import/users-import-form};
 * - пакет теста (.tbtest) — {@link module:features/import/package-import-form};
 * - шаблон оформления (.zip) — {@link module:features/import/template-import-form}.
 *
 * Вид .xlsx и .csv определяет разбор `POST /api/workbook/inspect`, .tbtest и .zip — расширение.
 * Права — по виду (`shared/access/import-kinds`): вид без права не перечисляется и не
 * принимается, а распознанный файл такого вида получает отказ без пояснений.
 *
 * Вход из меню теста (`?testId=…`) сразу ставит раздел на выгрузку LMS этого теста и показывает
 * его загрузки — без файла. Это только начальный вид: тест задаёт файл.
 *
 * The page title currently lives in the content (PageHeader); it moves to the
 * shell header when the app-wide header-title task lands (see
 * docs/PLAN_appshell_migration.md §9).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Ban, Upload, X } from "lucide-react";
import {
  Banner,
  Box,
  Button,
  Card,
  CardBody,
  CardHeader,
  Cluster,
  FileItem,
  FileUploader,
  Stack,
  useToast,
  type FileItemKind,
} from "@skillum/ui-kit";
import { IMPORT_KIND_CAPABILITY, IMPORT_KINDS, canAssignRole, type ImportKind } from "@shared/access";
import { PageHeader } from "@/components/page-header";
import { LmsImportForm, type LmsInspectResult } from "@/features/analytics/lms-import/lms-import-form";
import { ImportKindsTable, KIND_EXTENSIONS } from "@/features/import/import-kinds-table";
import { WorkbookImportForm, type WorkbookInspectResult } from "@/features/import/workbook-import-form";
import { UsersImportForm } from "@/features/import/users-import-form";
import { PackageImportForm } from "@/features/import/package-import-form";
import { TemplateImportForm } from "@/features/import/template-import-form";
import { useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n";

const tr = t.importPage;

/** Ответ разбора файла: вид и его данные. */
type InspectResult =
  | WorkbookInspectResult
  | LmsInspectResult
  | { kind: "users"; sheets: string[]; rows: number };

/** Где сейчас раздел после выбора файла. */
type Step =
  | { kind: "inspecting" }
  /** Вид распознан, права на него нет. */
  | { kind: "denied" }
  | { kind: "workbook"; inspect: WorkbookInspectResult }
  | { kind: "lmsExport"; inspect: LmsInspectResult }
  | { kind: "users"; rows: number }
  | { kind: "package" }
  | { kind: "template" };

/**
 * A failed `/inspect` read, carrying the server's reason code so the toast can
 * tell the author what to do next (`not_a_zip` / `unparsable`, or null when the
 * response said nothing).
 */
class WorkbookReadFailure extends Error {
  constructor(readonly code: string | null) {
    super("inspect failed");
    this.name = "WorkbookReadFailure";
  }
}

/** Разбор ответил 403: вид распознан, права на него нет. */
class ImportDenied extends Error {
  constructor() {
    super("import denied");
    this.name = "ImportDenied";
  }
}

/** Расширение файла в нижнем регистре, с точкой; пустая строка — расширения нет. */
function extensionOf(name: string): string {
  const match = /\.[^.]+$/.exec(name);
  return match ? match[0].toLowerCase() : "";
}

/** Значок строки файла по расширению. */
function fileKindOf(ext: string): FileItemKind {
  if (ext === ".xlsx") return "xls";
  if (ext === ".zip" || ext === ".tbtest") return "zip";
  return "other";
}

async function inspectFile(file: File): Promise<InspectResult> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/workbook/inspect", { method: "POST", body: fd, credentials: "include" });
  if (res.status === 403) throw new ImportDenied();
  if (!res.ok) {
    // The server tells WHY the read failed; carry the code so the toast can
    // say what to do about it instead of «проверьте формат».
    const code = await res
      .json()
      .then((b) => (typeof b?.code === "string" ? b.code : null))
      .catch(() => null);
    throw new WorkbookReadFailure(code);
  }
  return res.json();
}

export default function ImportPage() {
  const { push: toast } = useToast();
  const { can, user } = useAuth();
  const presetTestId = new URLSearchParams(useSearch()).get("testId");

  const kinds = useMemo<ImportKind[]>(
    () => IMPORT_KINDS.filter((kind) => can(IMPORT_KIND_CAPABILITY[kind])),
    [can],
  );
  const extensions = useMemo(
    () => Array.from(new Set(kinds.flatMap((kind) => KIND_EXTENSIONS[kind]))),
    [kinds],
  );
  const usersBeyondLearners = canAssignRole(user?.roles ?? [], "author", { atCreation: true });

  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  /** Тест выгрузки, выбранной при входе из меню теста: подзаголовок переключается на него. */
  const [fileTestTitle, setFileTestTitle] = useState<string | null>(null);

  const fromTestMenu = !!presetTestId && kinds.includes("lmsExport");
  const { data: tests } = useQuery<Array<{ id: string; title: string }>>({
    queryKey: ["/api/tests"],
    enabled: fromTestMenu,
  });
  const presetTitle = tests?.find((test) => test.id === presetTestId)?.title ?? null;

  function resetAll() {
    setFile(null);
    setStep(null);
  }

  async function handleFiles(files: File[]) {
    const f = files[0];
    if (!f) return;
    const ext = extensionOf(f.name);
    if (!extensions.includes(ext)) {
      toast({ tone: "error", title: t.common.error, description: `${tr.wrongFileType} ${extensions.join(", ")}` });
      return;
    }
    setFile(f);
    if (ext === ".tbtest") return setStep({ kind: "package" });
    if (ext === ".zip") return setStep({ kind: "template" });

    setStep({ kind: "inspecting" });
    try {
      const inspect = await inspectFile(f);
      if (inspect.kind === "users") setStep({ kind: "users", rows: inspect.rows });
      else if (inspect.kind === "lmsExport") setStep({ kind: "lmsExport", inspect });
      else setStep({ kind: "workbook", inspect });
    } catch (error) {
      if (error instanceof ImportDenied) {
        setStep({ kind: "denied" });
        return;
      }
      const code = error instanceof WorkbookReadFailure ? error.code : null;
      const description =
        code === "not_a_zip"
          ? tr.notAnXlsxPackage
          : code === "unparsable"
            ? tr.unparsableXlsx
            : tr.failedToInspect;
      toast({ tone: "error", title: t.common.error, description });
      resetAll();
    }
  }

  // ── Вход из меню теста: шаг выгрузки LMS этого теста, без файла ──────────
  if (fromTestMenu) {
    return (
      <div>
        <PageHeader title={tr.title} description={tr.description} />
        <Box maxW="3xl">
          <Card variant="outlined">
            <CardHeader title={tr.cardTitleLms} subtitle={fileTestTitle ?? presetTitle ?? undefined} />
            <CardBody>
              <LmsImportForm
                presetTestId={presetTestId!}
                onInspect={(inspect) => setFileTestTitle(inspect.testTitle)}
                onReset={() => setFileTestTitle(null)}
              />
            </CardBody>
          </Card>
        </Box>
      </div>
    );
  }

  const removeAction = [{ icon: <X size={14} />, ariaLabel: tr.removeFile, danger: true, onClick: resetAll }];

  return (
    <div>
      <PageHeader title={tr.title} description={tr.description} />

      <Box maxW="3xl">
        <Card variant="outlined">
          <CardHeader title={tr.cardTitle} />
          <CardBody>
            {!file || !step ? (
              /* ── Пусто: зона загрузки и что принимается ──────────────── */
              <Stack gap={4}>
                {/* `children` overrides the uploader's built-in CTA «таблетка»
                    (ou-uploader__cta) with a real DS Button; the whole dropzone
                    stays clickable (root opens the picker via bubbling). */}
                <FileUploader accept={extensions.join(",")} onFiles={(files) => void handleFiles(files)}>
                  <span className="ou-uploader__icon" aria-hidden="true">
                    <Upload size={24} />
                  </span>
                  <span className="ou-uploader__title">{tr.uploaderTitle}</span>
                  <span className="ou-uploader__sub">{extensions.join(", ")}</span>
                  <Button variant="secondary" size="s" type="button" tabIndex={-1} style={{ marginTop: "var(--ou-space-2)" }}>
                    {tr.uploaderCta}
                  </Button>
                </FileUploader>
                <ImportKindsTable kinds={kinds} usersBeyondLearners={usersBeyondLearners} />
              </Stack>
            ) : step.kind === "inspecting" ? (
              <Stack gap={3}>
                <FileItem name={file.name} kind={fileKindOf(extensionOf(file.name))} actions={removeAction} />
                <Banner tone="info" description={tr.inspecting} />
              </Stack>
            ) : step.kind === "denied" ? (
              /* Отказ не объясняет и не перечисляет доступного (владелец 2026-10-02). */
              <Stack gap={3}>
                <FileItem name={file.name} kind={fileKindOf(extensionOf(file.name))} actions={removeAction} />
                <Banner tone="error" variant="subtle" icon={<Ban size={16} />} title={tr.importDenied} />
                <Cluster justify="end" gap={2}>
                  <Button variant="secondary" onClick={resetAll}>{tr.chooseOtherFile}</Button>
                </Cluster>
              </Stack>
            ) : step.kind === "workbook" ? (
              <WorkbookImportForm file={file} inspect={step.inspect} onReset={resetAll} />
            ) : step.kind === "lmsExport" ? (
              <LmsImportForm file={file} inspect={step.inspect} onReset={resetAll} />
            ) : step.kind === "users" ? (
              <UsersImportForm file={file} rows={step.rows} onReset={resetAll} />
            ) : step.kind === "package" ? (
              <PackageImportForm file={file} onReset={resetAll} />
            ) : (
              <TemplateImportForm file={file} onReset={resetAll} />
            )}
          </CardBody>
        </Card>
      </Box>
    </div>
  );
}
