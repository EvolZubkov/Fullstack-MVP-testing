/**
 * @module features/tests/assign/bulk-invite-tab
 * @description The fourth tab of the test-assignment dialog (PRD-28 FR-09..FR-19):
 * invite participants from an uploaded workbook. One canvas holds four states —
 * `upload` (file, dates, optional group name), `preview` (classified rows the
 * operator ticks), `running` (the same preview with the action busy) and
 * `report` (what the run amounted to). The run itself is one request: the server
 * creates the accounts, assigns the test and mails the links, and hands back a
 * report that exists only here — the raw links are never stored, which is why
 * the export of раздел 7 lives on this screen and nowhere else.
 *
 * It is a separate module because the dialog is already a long file and its
 * three existing tabs are untouched by this feature: the dialog stays the shell
 * that owns the tab strip, this owns everything behind the fourth tab.
 */
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, KeyRound, Trash2 } from "lucide-react";
import {
  Banner,
  Box,
  Button,
  Cluster,
  FileItem,
  FileUploader,
  Grid,
  Input,
  ScrollArea,
  Stack,
  Table,
  Tag,
  Text,
  type TableColumn,
  type Tone,
} from "@universityrt/ui-kit";
import { useToast } from "@/hooks/use-toast";
import { t } from "@/lib/i18n";
import { buildLinksWorkbook, linksWorkbookFileName } from "./bulk-invite-export";

/** MIME type of an `.xlsx` package, for the saved blob. */
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// ─── Contract with the server (server/services/participants-invite.ts) ────────

/** What the preview says the run would do with a row. */
export type ParticipantStatus =
  | "new" | "external" | "learner" | "privileged" | "assigned" | "error";

/** One classified row of the uploaded workbook. */
export interface ParticipantPreviewRow {
  /** Zero-based position in the sheet; collapsed duplicates leave gaps in it. */
  index: number;
  email: string;
  name: string | null;
  status: ParticipantStatus;
  userId: string | null;
  /** Present only for `status: "error"`. */
  error?: string;
}

/** What happened to one recipient during the run. */
export interface ParticipantResult {
  email: string;
  name: string | null;
  status: ParticipantStatus;
  /** Present only when a one-time link was minted; the ONLY moment it exists. */
  magicLink?: string;
  delivered: boolean;
}

/** A row that did not go all the way through, and what it left behind. */
export interface ParticipantFailure {
  email: string;
  reason: string;
  accountCreated: boolean;
  assignmentCreated: boolean;
}

/** The whole run, as the report screen shows it. */
export interface ParticipantsReport {
  created: number;
  reused: number;
  assigned: number;
  groupId: string | null;
  /**
   * When the links of this run stop working (ISO), as the server resolved it;
   * `null` when no link was issued. Not the value from the form: with the
   * expiry field left empty the real one is the due date, or 30 days out.
   */
  linksExpireAt: string | null;
  results: ParticipantResult[];
  failed: ParticipantFailure[];
}

// ─── Presentation of the statuses (wireframe prd28-bulk-invite-preview) ───────

interface StatusPresentation {
  label: string;
  tone: Tone;
  /** The «Что произойдёт» cell: the rule the row goes through by. */
  effect: string;
}

const STATUS_PRESENTATION: Record<Exclude<ParticipantStatus, "error">, StatusPresentation> = {
  new: {
    label: "Новый",
    tone: "success",
    effect: "Создаётся внешняя учётная запись без пароля, роль «Обычный пользователь»",
  },
  external: {
    label: "Внешний участник",
    tone: "info",
    effect: "Учётная запись переиспользуется",
  },
  learner: {
    label: "Штатный учащийся",
    tone: "neutral",
    effect: "Учётная запись переиспользуется как есть; признак «внешний» не навешивается",
  },
  privileged: {
    label: "Аккаунт с правами",
    tone: "accent",
    effect: "Учётная запись не изменяется. Уведомление уйдёт без разовой ссылки — адрес в письме ведёт на тест",
  },
  assigned: {
    label: "Уже назначен",
    tone: "warning",
    effect: "Второе назначение не создаётся: ссылка перевыпускается, прежняя отзывается",
  },
};

/**
 * Wording for the refusals the classifier can attach to a row.
 *
 * Keyed by the message the server sends: it is a fixed, short vocabulary
 * (`classifyParticipants`), and an unknown one still renders — as the message
 * itself — rather than leaving the cell blank.
 */
const ERROR_PRESENTATION: Record<string, { label: string; effect: string; reason: string }> = {
  "Некорректный адрес": {
    label: "Некорректный адрес",
    effect: "Адрес не похож на почтовый — строка не обрабатывается",
    reason: "Адрес не похож на почтовый",
  },
  "Учётная запись деактивирована": {
    label: "Деактивирован",
    effect: "Учётная запись деактивирована — строка не обрабатывается",
    reason: "Учётная запись деактивирована",
  },
};

function errorPresentation(message: string | undefined) {
  const known = message ? ERROR_PRESENTATION[message] : undefined;
  if (known) return known;
  const text = message ?? "Строка не обрабатывается";
  return { label: "Ошибка", effect: `${text} — строка не обрабатывается`, reason: text };
}

/** Short human label for a status, used by the row tag and the links export. */
export function participantStatusLabel(status: ParticipantStatus, error?: string): string {
  return status === "error"
    ? errorPresentation(error).label
    : STATUS_PRESENTATION[status].label;
}

// ─── Small helpers ────────────────────────────────────────────────────────────

/** Human file size for the picked-file row. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

/**
 * A refusal from the run, carrying the route's machine-readable `code` beside
 * the sentence shown to the operator. The code is what the screen branches on:
 * the Russian prose is for the human and may be reworded at any time.
 */
class InviteRefusal extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "InviteRefusal";
  }
}

/** Hand the browser a URL to save; the response carries its own file name. */
function saveFromUrl(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Save bytes assembled in the page under a chosen file name. */
function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────────────────────

interface BulkInviteTabProps {
  testId: string;
  testTitle: string;
  /** Return to the «Назначено» tab, where revoke and re-send already live. */
  onGoToAssignments: () => void;
}

type BulkStep = "upload" | "preview" | "running" | "report";

export function BulkInviteTab({ testId, testTitle, onGoToAssignments }: BulkInviteTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<BulkStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [linkExpiresAt, setLinkExpiresAt] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupNameError, setGroupNameError] = useState<string | null>(null);
  /**
   * The run has refused this list over the group name at least once, so the
   * name field belongs on the preview from now on. Kept apart from
   * {@link groupNameError}, which the first keystroke clears: tying the field's
   * presence to the error would make it vanish from under the cursor the moment
   * the operator starts renaming.
   */
  const [groupNameConflict, setGroupNameConflict] = useState(false);
  const [rows, setRows] = useState<ParticipantPreviewRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [report, setReport] = useState<ParticipantsReport | null>(null);
  const groupInputRef = useRef<HTMLInputElement>(null);

  // Same linkage as the neighbouring tabs: the link expiry follows the due date
  // until the operator sets it by hand (assign-test-dialog.tsx).
  const handleDueDateChange = (value: string) => {
    setDueDate(value);
    if (!linkExpiresAt || linkExpiresAt === dueDate) setLinkExpiresAt(value);
  };

  const previewMutation = useMutation({
    mutationFn: async (picked: File) => {
      const fd = new FormData();
      fd.append("file", picked);
      const res = await fetch(`/api/tests/${testId}/participants/preview`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) throw new Error((await res.json()).error || "Не удалось разобрать файл");
      return res.json() as Promise<ParticipantPreviewRow[]>;
    },
    onSuccess: (parsed) => {
      setRows(parsed);
      setSelected(parsed.filter((r) => r.status !== "error").map((r) => String(r.index)));
      setStep("preview");
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: t.common.error, description: e.message }),
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tests/${testId}/participants/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          rows: rows.filter((r) => selected.includes(String(r.index))),
          dueDate: dueDate || null,
          linkExpiresAt: linkExpiresAt || null,
          groupName: groupName.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new InviteRefusal(body.error || "Не удалось выполнить рассылку", body.code);
      }
      return res.json() as Promise<ParticipantsReport>;
    },
    onMutate: () => {
      setGroupNameError(null);
      setStep("running");
    },
    onSuccess: (result) => {
      setReport(result);
      setStep("report");
      setGroupNameConflict(false);
      // The «Назначено (N)» counter and the list behind it are now stale.
      queryClient.invalidateQueries({ queryKey: [`/api/tests/${testId}/assignments`] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
    },
    onError: (e: Error) => {
      // The refusal keeps the operator on the preview: the rows they confirmed
      // are still valid, and a taken name is one rename away from a run.
      setStep("preview");
      if (e instanceof InviteRefusal && e.code === "group_name_taken") {
        setGroupNameError("Имя занято");
        setGroupNameConflict(true);
        return;
      }
      toast({ variant: "destructive", title: t.common.error, description: e.message });
    },
  });

  /**
   * Save the issued links and tell the server it happened.
   *
   * The book is built from the report in hand — the server is never asked for
   * the links, because it does not have them (раздел 7). The mark that follows
   * carries the count and nothing else: the audit trail must not become the
   * store of live keys the design goes out of its way to avoid.
   */
  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!report) return 0;
      const issued = report.results.filter((r) => r.magicLink);
      const bytes = await buildLinksWorkbook({
        testTitle,
        results: report.results,
        // The run's own answer, never the form: an empty «Ссылка активна до»
        // still produces links with an expiry (the due date, else 30 days), and
        // guessing it here left the column empty on every such run.
        expiresAt: report.linksExpireAt,
      });
      saveBlob(new Blob([bytes], { type: XLSX_MIME }), linksWorkbookFileName(testTitle));
      await fetch(`/api/tests/${testId}/participants/links-exported`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ count: issued.length }),
      });
      return issued.length;
    },
    onSuccess: (count) =>
      toast({ title: "Файл сохранён", description: `Ссылок в файле: ${count}` }),
    onError: () =>
      toast({ variant: "destructive", title: t.common.error, description: "Не удалось собрать файл со ссылками" }),
  });

  const handleFiles = (files: File[]) => {
    const picked = files[0];
    if (!picked) return;
    if (!/\.xlsx$/i.test(picked.name)) {
      toast({ variant: "destructive", title: t.common.error, description: "Поддерживается только формат .xlsx." });
      return;
    }
    setFile(picked);
  };

  const backToUpload = () => {
    setStep("upload");
    setRows([]);
    setSelected([]);
    setGroupNameError(null);
    setGroupNameConflict(false);
  };

  // ── Upload ─────────────────────────────────────────────────────────────────

  const groupField = (
    <Input
      ref={groupInputRef}
      label="Создать группу из списка"
      fullWidth
      value={groupName}
      onChange={(e) => {
        setGroupName(e.target.value);
        setGroupNameError(null);
      }}
      placeholder="Например: Аудит ИБ, сентябрь 2026"
      error={groupNameError ?? undefined}
      hint={
        groupNameError
          ? undefined
          : "Пусто — каждый участник получит поимённое назначение. Имя задано — создаётся новая группа, тест назначается на неё одним назначением."
      }
    />
  );

  const uploadPanel = (
    <Stack gap={5}>
      {file ? (
        <FileItem
          name={file.name}
          kind="xls"
          meta={formatBytes(file.size)}
          actions={[
            {
              icon: <Trash2 size={16} />,
              ariaLabel: "Убрать файл",
              danger: true,
              onClick: () => setFile(null),
            },
          ]}
        />
      ) : (
        <FileUploader
          accept=".xlsx"
          title="Перетащите книгу или нажмите, чтобы выбрать"
          description="Только .xlsx. Колонки: email, name."
          cta="Выбрать файл"
          onFiles={handleFiles}
        />
      )}

      <Cluster justify="start" gap={0}>
        <Button
          variant="ghost"
          size="s"
          leadingIcon={<Download size={16} />}
          onClick={() => saveFromUrl(`/api/tests/${testId}/participants/template`)}
        >
          Скачать шаблон .xlsx
        </Button>
      </Cluster>

      <Stack direction="row" gap={4}>
        <Box grow>
          <Input
            label={t.assignments.dueDate}
            type="date"
            fullWidth
            value={dueDate}
            onChange={(e) => handleDueDateChange(e.target.value)}
          />
        </Box>
        <Box grow>
          <Input
            label="Ссылка активна до"
            type="date"
            fullWidth
            value={linkExpiresAt}
            onChange={(e) => setLinkExpiresAt(e.target.value)}
            hint="По умолчанию: +30 дней"
          />
        </Box>
      </Stack>

      {groupField}

      <Cluster justify="end" gap={2}>
        <Button
          onClick={() => file && previewMutation.mutate(file)}
          disabled={!file}
          loading={previewMutation.isPending}
        >
          Проверить список
        </Button>
      </Cluster>
    </Stack>
  );

  // ── Preview ────────────────────────────────────────────────────────────────

  const previewColumns: TableColumn<ParticipantPreviewRow>[] = [
    { key: "email", header: "Адрес", render: (r) => <Text variant="mono-s">{r.email}</Text> },
    { key: "name", header: "Имя", render: (r) => <Text variant="body-s">{r.name || "—"}</Text> },
    {
      key: "status",
      header: "Статус",
      render: (r) =>
        r.status === "error" ? (
          <Tag tone="error" size="s">{errorPresentation(r.error).label}</Tag>
        ) : (
          <Tag tone={STATUS_PRESENTATION[r.status].tone} size="s">
            {STATUS_PRESENTATION[r.status].label}
          </Tag>
        ),
    },
    {
      key: "effect",
      header: "Что произойдёт",
      render: (r) =>
        r.status === "error" ? (
          <Text variant="body-s" tone="error">{errorPresentation(r.error).effect}</Text>
        ) : (
          <Text variant="body-s" tone="muted">{STATUS_PRESENTATION[r.status].effect}</Text>
        ),
    },
  ];

  const newCount = rows.filter((r) => r.status === "new").length;
  const errorCount = rows.filter((r) => r.status === "error").length;
  const reusedCount = rows.length - newCount - errorCount;
  /**
   * Rows the sheet held, inferred from the last kept row's sheet position: the
   * server collapses a repeated address before answering, so a collapsed row
   * shows up only as a gap in `index`. A duplicate in the LAST line of the book
   * leaves no gap and is therefore invisible here — the count then equals the
   * kept rows and the «после схлопывания» half is simply not shown.
   */
  const sheetRowCount = rows.length > 0 ? rows[rows.length - 1].index + 1 : 0;

  const previewPanel = (
    <Stack gap={4}>
      <Cluster gap={3} wrap>
        <Tag tone="success" size="s" dot>Новых: {newCount}</Tag>
        <Tag tone="info" size="s" dot>Переиспользуется: {reusedCount}</Tag>
        <Tag tone="error" size="s" dot>Ошибок: {errorCount}</Tag>
        <Text variant="body-s" tone="muted">
          {sheetRowCount > rows.length
            ? `${sheetRowCount} строк файла · ${rows.length} после схлопывания повторов`
            : `${rows.length} строк файла`}
        </Text>
      </Cluster>

      {groupNameError && (
        <Banner
          variant="subtle"
          tone="error"
          stacked
          title={`Группа «${groupName.trim()}» уже существует`}
          description="Участников нельзя дописать в существующую группу: у неё могут быть другие назначения, и люди из этого списка получат чужие тесты. Задайте другое имя."
          actions={[
            { label: "Изменить имя", primary: true, onClick: () => groupInputRef.current?.focus() },
          ]}
        />
      )}
      {/* Переименовать, не возвращаясь на шаг загрузки (§5.1). */}
      {groupNameConflict && groupField}

      <ScrollArea maxH="md">
        <Table
          selectable
          selected={selected}
          onSelectChange={setSelected}
          rowSelectable={(r) => r.status !== "error"}
          rowClassName={(r) => (r.status === "error" ? "tb-row--error" : undefined)}
          columns={previewColumns}
          rows={rows}
          rowKey={(r) => String(r.index)}
        />
      </ScrollArea>

      <Cluster justify="end" gap={2}>
        <Button variant="secondary" onClick={backToUpload}>Назад</Button>
        <Button
          onClick={() => inviteMutation.mutate()}
          disabled={selected.length === 0 || groupNameError !== null}
          loading={step === "running"}
        >
          Пригласить ({selected.length})
        </Button>
      </Cluster>
    </Stack>
  );

  // ── Report ─────────────────────────────────────────────────────────────────

  interface AttentionRow {
    key: string;
    email: string;
    outcome: string;
    tone: Tone;
    reason: string;
  }

  const attentionColumns: TableColumn<AttentionRow>[] = [
    { key: "email", header: "Адрес", render: (r) => <Text variant="mono-s">{r.email}</Text> },
    { key: "outcome", header: "Исход", render: (r) => <Tag tone={r.tone} size="s">{r.outcome}</Tag> },
    { key: "reason", header: "Причина", render: (r) => <Text variant="body-s" tone="muted">{r.reason}</Text> },
  ];

  const buildAttentionRows = (result: ParticipantsReport): AttentionRow[] => [
    ...result.results
      .filter((r) => !r.delivered)
      .map((r) => ({
        key: `undelivered:${r.email}`,
        email: r.email,
        outcome: "Письмо не доставлено",
        tone: "warning" as Tone,
        reason: "Почтовый сервер отклонил адрес. Назначение создано, ссылка выпущена и действует — заберите её из выгрузки",
      })),
    ...result.failed.map((f) => ({
      key: `failed:${f.email}`,
      email: f.email,
      outcome: "Сбой",
      tone: "error" as Tone,
      // What the row left behind decides whether a retry duplicates anything.
      reason: [
        f.reason,
        f.accountCreated ? "учётная запись создана" : null,
        f.assignmentCreated ? "назначение создано" : null,
      ].filter(Boolean).join(". "),
    })),
    ...rows
      .filter((r) => r.status === "error")
      .map((r) => ({
        key: `skipped:${r.index}`,
        email: r.email,
        outcome: "Пропущен",
        tone: "error" as Tone,
        reason: errorPresentation(r.error).reason,
      })),
  ];

  const statTile = (value: number, label: string, tone: "success" | "info" | "accent" | "error" | "muted") => (
    <Box border radius="l" pad={4}>
      <Stack gap={1} align="center">
        <Text variant="display-s" weight="bold" tone={tone}>{value}</Text>
        <Text as="p" variant="body-s" tone="muted">{label}</Text>
      </Stack>
    </Box>
  );

  const reportPanel = report && (
    <Stack gap={5}>
      <Grid cols={3} gap={3}>
        {statTile(report.created, "Создано учётных записей", "success")}
        {statTile(report.reused, "Переиспользовано", "info")}
        {statTile(report.assigned, "Назначено", "accent")}
        {statTile(report.results.filter((r) => r.delivered).length, "Писем отправлено", "success")}
        {statTile(report.results.filter((r) => !r.delivered).length, "Письмо не ушло", "error")}
        {statTile(Math.max(0, rows.length - report.results.length), "Пропущено", "muted")}
      </Grid>

      {buildAttentionRows(report).length > 0 && (
        <Stack gap={2}>
          <Text variant="heading-s">Требуют внимания</Text>
          <Table
            columns={attentionColumns}
            rows={buildAttentionRows(report)}
            rowKey={(r) => r.key}
          />
        </Stack>
      )}

      <Banner
        variant="subtle"
        tone="warning"
        stacked
        icon={<KeyRound size={18} />}
        title="Файл со ссылками содержит действующие ключи доступа"
        description="Каждая ссылка открывает тест без пароля — храните файл как список паролей. Выгрузка возможна, только пока открыт этот отчёт: сырые ссылки нигде не хранятся, и после закрытия диалога восстановить их нельзя. Позже останется лишь перевыпустить ссылки, а это отзовёт прежние, включая уже доставленные письмами."
        actions={[
          {
            label: (
              <>
                <Download size={14} aria-hidden="true" />
                {` Выгрузить ссылки (${report.results.filter((r) => r.magicLink).length})`}
              </>
            ),
            primary: true,
            onClick: () => exportMutation.mutate(),
          },
        ]}
      />

      <Cluster justify="end" gap={2}>
        <Button onClick={onGoToAssignments}>К назначениям</Button>
      </Cluster>
    </Stack>
  );

  if (step === "report" && reportPanel) return reportPanel;
  if (step === "preview" || step === "running") return previewPanel;
  return uploadPanel;
}
