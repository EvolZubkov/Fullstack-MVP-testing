/**
 * @module features/analytics/lms-import/lms-import-form
 * @description Форма загрузки выгрузки отчёта LMS (PRD-54 раздел 11).
 *
 * Живёт только в разделе «Импорт» (Э6 UX-аудита, «единая точка импорта»): окно загрузки в
 * аналитике снято, а меню теста ведёт сюда же с тестом в адресе.
 *
 * Хост может отдать уже разобранный файл (раздел опознаёт вид до ветвления) либо не отдать
 * ничего — тогда форма показывает собственный загрузчик и опознаёт файл сама. Так она работает
 * при входе из меню теста: загрузки теста видны сразу, до файла.
 *
 * Эскизы: `docs/wireframes/prd54-lms-import.html` (согласован 2026-09-12),
 * `docs/wireframes/approved/e6-import-single-point.html` (согласован 2026-10-02).
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, CheckCircle2, Trash2, Upload, X } from "lucide-react";
import {
  Banner,
  Box,
  Button,
  Cluster,
  EmptyState,
  FileItem,
  FileUploader,
  Input,
  Select,
  Spinner,
  Stack,
  Tag,
  Text,
  useToast,
} from "@skillum/ui-kit";
import { queryClient } from "@/lib/queryClient";
import { invalidateAnalytics } from "../invalidate-analytics";

/**
 * Отказ по праву на вид файла (Э6) — тот же текст, что отдаёт разбор файла на сервере. Без
 * пояснений и без перечня доступного: решение владельца 2026-10-02.
 */
export const IMPORT_DENIED_TEXT = "Недостаточно прав для выполнения операции";

/** Разбор файла ответил 403: вид распознан, права на него нет. */
class ImportDenied extends Error {
  constructor() {
    super("import denied");
    this.name = "ImportDenied";
  }
}

/** Сентинелы списка групп — по образцу `NEW_TEST = "__new__"` со страницы «Импорт». */
const NO_GROUP = "__none__";
const NEW_GROUP = "__new__";

/** Тест, в разделах которого стоят вопросы файла, — пункт выбора, когда таких тестов несколько. */
export interface LmsTestCandidate {
  testId: string;
  title: string;
  status: string;
  createdAt: string | null;
  /** Сколько вопросов файла стоят в разделах теста. */
  matched: number;
}

/** Ответ `/api/workbook/inspect` для выгрузки отчёта LMS. */
export interface LmsInspectResult {
  kind: "lmsExport";
  testId: string | null;
  testTitle: string | null;
  /**
   * Тесты на выбор, когда вопросы файла стоят в нескольких (PRD-54 раздел 6.2, 2026-10-06):
   * опубликованные первыми. Пусто, если тест определился однозначно или не определился вовсе.
   */
  candidates?: LmsTestCandidate[];
  /** Кандидат, подставляемый в выбор: однозначно лучший опубликованный. */
  recommendedTestId?: string | null;
  foreignQuestionIds?: string[];
  rows: number;
  questionIds: number;
  scaleKeys: string[];
  variableNames: string[];
  unknownColumns: string[];
}

/** Счётчики и протокол одного прогона — общие у сухого и настоящего. */
interface ImportOutcome {
  testId: string;
  testTitle: string | null;
  rowsTotal: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsLinked: number;
  /** PRD-54 BR-54-38: внешних учётных записей заведено (в сухом прогоне — будет заведено). */
  usersCreated: number;
  warnings: string[];
}

interface Batch {
  id: string;
  fileName: string;
  importedAt: string;
  rowsCreated: number;
  rowsUpdated: number;
  rowsLinked: number;
}

export interface LmsImportFormProps {
  /** Файл, уже выбранный хостом. Без него форма показывает свой загрузчик. */
  file?: File;
  /** Разбор, уже выполненный хостом. */
  inspect?: LmsInspectResult;
  /**
   * Тест, известный ДО файла, — вход из меню теста (Э6). Только начальный вид: загрузки этого
   * теста видны сразу, без файла. Тест задаёт ФАЙЛ: выгрузка другого теста грузится в свой тест,
   * без отказа (владелец 2026-10-02).
   */
  presetTestId?: string;
  /** Сообщает хосту разбор файла, выбранного в собственном загрузчике формы. */
  onInspect?: (inspect: LmsInspectResult) => void;
  /**
   * Зовётся после успешного импорта — ТОЛЬКО чтобы хост обновил свои данные.
   *
   * Сбрасывать форму отсюда нельзя: экран импорта так и делал, и человек, нажав «Импортировать»,
   * видел не итог с числами, а пустой загрузчик — будто ничего не произошло.
   */
  onDone?: () => void;
  /**
   * Зовётся, когда человек убирает файл или берёт следующий. Нужен хосту, который отдал файл
   * СВОЙ: форма чужое состояние не чистит, и без этого «Загрузить ещё» ничего бы не меняло.
   */
  onReset?: () => void;
}

/** Статус теста словами — в пункте выбора теста. */
const STATUS_LABEL: Record<string, string> = {
  published: "опубликован",
  draft: "черновик",
  archived: "в архиве",
};

/**
 * Пункт выбора теста: название, статус, покрытие и дата. Копии теста носят то же название,
 * поэтому без остального их не различить.
 *
 * @param c кандидат
 * @param total вопросов в файле
 * @param recommended подставлен ли он рекомендацией
 */
function candidateLabel(c: LmsTestCandidate, total: number, recommended: boolean): string {
  return [
    c.title,
    STATUS_LABEL[c.status] ?? c.status,
    `${c.matched} из ${total} вопросов`,
    c.createdAt ? `создан ${new Date(c.createdAt).toLocaleDateString("ru-RU")}` : null,
    recommended ? "рекомендуется" : null,
  ].filter(Boolean).join(" · ");
}

/** Килобайты файла для подписи под именем. */
function formatKb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

/**
 * Число со словом в нужном падеже: «1 шкала», «4 шкалы», «14 шкал».
 *
 * Без этого строка читалась «14 вопросов, 4 шкал, 4 показателей» — по-русски неверно ровно в том
 * месте, где человек первым делом сверяет, тот ли файл он взял.
 *
 * @param n количество
 * @param forms три формы: для 1, для 2-4, для 5 и больше
 */
function plural(n: number, forms: [string, string, string]): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} ${forms[2]}`;
  if (mod10 === 1) return `${n} ${forms[0]}`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} ${forms[1]}`;
  return `${n} ${forms[2]}`;
}

export function LmsImportForm({ file: hostFile, inspect: hostInspect, presetTestId, onInspect, onDone, onReset }: LmsImportFormProps) {
  const { push: toast } = useToast();

  const [ownFile, setOwnFile] = useState<File | null>(null);
  const [ownInspect, setOwnInspect] = useState<LmsInspectResult | null>(null);
  const [notRecognized, setNotRecognized] = useState(false);
  /** Файл распознан, но права на его вид нет (Э6): отказ без пояснений. */
  const [denied, setDenied] = useState(false);
  const [group, setGroup] = useState<string>(NO_GROUP);
  const [newGroupName, setNewGroupName] = useState("");
  const [plan, setPlan] = useState<ImportOutcome | null>(null);
  const [done, setDone] = useState<ImportOutcome | null>(null);
  /** Тест, выбранный человеком из кандидатов. Пока не выбран — действует рекомендация. */
  const [chosenTestId, setChosenTestId] = useState<string | null>(null);

  const file = hostFile ?? ownFile;
  const inspect = hostInspect ?? ownInspect;
  const candidates = inspect?.candidates ?? [];
  /** Вопросы файла стоят в нескольких тестах — тест выбирается из них. */
  const ambiguous = !!inspect && !inspect.testId && candidates.length > 0;
  const testId = inspect?.testId ?? (ambiguous ? chosenTestId ?? inspect?.recommendedTestId ?? null : null);
  /**
   * Чьи загрузки показывать. Тест файла главнее заданного заранее: выгрузка другого теста
   * грузится в свой тест, и список переключается на него. Тест, заданный входом из меню, известен
   * ДО выбора файла: откатить загрузку можно, ничего не загружая. Где тест определяется по файлу,
   * до файла списка нет — показывать нечего.
   */
  const batchesTestId = testId ?? presetTestId ?? null;

  const groups = useQuery<Array<{ id: string; name: string }>>({ queryKey: ["/api/groups"] });
  const batches = useQuery<Batch[]>({
    queryKey: [`/api/analytics/lms-import/batches/${batchesTestId}`],
    enabled: !!batchesTestId,
  });

  /** Тело запроса: и сухой прогон, и импорт отправляют одно и то же. */
  function body(): FormData {
    const fd = new FormData();
    if (file) fd.append("file", file);
    // Тест шлётся только выбранный: однозначный сервер определит по файлу сам.
    if (ambiguous && testId) fd.append("testId", testId);
    if (group !== NO_GROUP && group !== NEW_GROUP) fd.append("groupId", group);
    if (group === NEW_GROUP) fd.append("newGroupName", newGroupName);
    return fd;
  }

  async function send(dryRun: boolean): Promise<ImportOutcome> {
    const res = await fetch(`/api/analytics/lms-import?dryRun=${dryRun}`, {
      method: "POST",
      body: body(),
      credentials: "include",
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error || "Не удалось выполнить загрузку");
    return payload as ImportOutcome;
  }

  const inspectMut = useMutation({
    mutationFn: async (f: File): Promise<LmsInspectResult> => {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/workbook/inspect", { method: "POST", body: fd, credentials: "include" });
      if (res.status === 403) throw new ImportDenied();
      if (!res.ok) throw new Error("read failed");
      return res.json();
    },
    onSuccess: (data) => {
      // Книга теста в эту форму не годится: она про содержание теста, а не про прохождения.
      if (data.kind !== "lmsExport") { setNotRecognized(true); return; }
      setOwnInspect(data);
      onInspect?.(data);
    },
    onError: (error) => (error instanceof ImportDenied ? setDenied(true) : setNotRecognized(true)),
  });

  const dryMut = useMutation({ mutationFn: () => send(true), onSuccess: setPlan });
  const runMut = useMutation({
    mutationFn: () => send(false),
    onSuccess: (res) => {
      setDone(res);
      // Цифры на странице, с которой форму открыли, должны обновиться без перезагрузки.
      invalidateAnalytics(queryClient);
      batches.refetch();
      onDone?.();
    },
  });
  const rollbackMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/analytics/lms-import/batches/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Не удалось откатить загрузку");
    },
    onSuccess: () => {
      toast({ tone: "success", title: "Загрузка откачена" });
      invalidateAnalytics(queryClient);
      batches.refetch();
    },
    onError: (e: Error) => toast({ tone: "error", title: "Ошибка", description: e.message }),
  });
  function reset() {
    setOwnFile(null);
    setOwnInspect(null);
    setNotRecognized(false);
    setDenied(false);
    setPlan(null);
    setDone(null);
    setChosenTestId(null);
    // Файл мог прийти от хоста — своё состояние он чистит сам.
    onReset?.();
  }

  /**
   * Собрать состояние формы: тело, кнопки справа под ним и список загрузок ниже кнопок.
   *
   * @param body содержимое до кнопок
   * @param buttons кнопки состояния
   * @param after содержимое под кнопками (список загрузок теста)
   */
  function compose(body: ReactNode, buttons: ReactNode, after: ReactNode = null) {
    return (
      <Stack gap={3}>
        {body}
        <Cluster justify="end" gap={2}>{buttons}</Cluster>
        {after}
      </Stack>
    );
  }

  // ── Пусто: собственный загрузчик на месте строки файла ───────────────────
  // До файла рядом с ним — только загрузки теста, которые можно откатить (эскиз Э6).
  const uploader = (
    <FileUploader
      accept=".xlsx"
      onFiles={(files) => {
        const f = files[0];
        if (!f) return;
        setOwnFile(f);
        inspectMut.mutate(f);
      }}
    >
      <span className="ou-uploader__icon" aria-hidden="true"><Upload size={24} /></span>
      <span className="ou-uploader__title">Перетащите файл .xlsx или выберите</span>
      <span className="ou-uploader__sub">Выгрузка отчёта LMS — тест определится по файлу</span>
      <Button variant="secondary" size="s" type="button" tabIndex={-1}>Выбрать файл</Button>
    </FileUploader>
  );

  const fileRow = file && (
    <FileItem
      name={file.name}
      meta={plan || done ? "запись ещё не выполнена" : `выгрузка отчёта LMS · ${inspect ? plural(inspect.rows, ["строка", "строки", "строк"]) : "…"} · ${formatKb(file.size)}`}
      kind="xls"
      actions={runMut.isPending ? [] : [{ icon: <X size={14} />, ariaLabel: "Убрать файл", danger: true, onClick: reset }]}
    />
  );

  // ── Идёт разбор ──────────────────────────────────────────────────────────
  if (inspectMut.isPending) {
    // Кнопок тут нет вовсе — пустую строку под ними не рисуем.
    return (
      <Stack gap={3}>
        {fileRow}
        <Cluster gap={2}><Spinner size="s" /><Text variant="body-s" tone="muted">Читаем файл…</Text></Cluster>
      </Stack>
    );
  }

  // ── Нет права на вид файла ───────────────────────────────────────────────
  // Отказ не объясняет и не перечисляет доступного (владелец 2026-10-02).
  if (denied) {
    return compose(
      <>
        {fileRow}
        <Banner tone="error" variant="subtle" icon={<Ban size={16} />} title={IMPORT_DENIED_TEXT} />
      </>,
      <Button variant="secondary" onClick={reset}>Выбрать другой файл</Button>,
    );
  }

  // ── Файл не распознан ────────────────────────────────────────────────────
  if (notRecognized) {
    return compose(
      <>
        {fileRow}
        <Banner
          tone="error"
          title="Файл не распознан"
          description="Это не выгрузка отчёта LMS. Проверьте, что выгружали отчёт по SCORM-модулю, а не что-то другое."
        />
      </>,
      <Button variant="secondary" onClick={reset}>Выбрать другой файл</Button>,
    );
  }

  // ── Тест по вопросам не найден ───────────────────────────────────────────
  if (inspect && !testId && !ambiguous) {
    return compose(
      <>
        {fileRow}
        <Banner
          tone="error"
          title="Тест по файлу не определён"
          description={`Из ${inspect.questionIds} вопросов файла ни один однозначно не указывает на тест этой установки. Похоже, выгрузка сделана по тесту из другой системы.`}
        />
      </>,
      <Button variant="secondary" onClick={reset}>Выбрать другой файл</Button>,
    );
  }


  // ── Готово ───────────────────────────────────────────────────────────────
  if (done) {
    return compose(
      <Banner
        tone="success"
        title="Загрузка завершена"
        description={`Добавлено ${done.rowsCreated}, обновлено ${done.rowsUpdated}, пропущено ${done.rowsSkipped}, связано с пользователями ${done.rowsLinked}, заведено участников ${done.usersCreated}.`}
      />,
      <Button variant="secondary" onClick={reset}>Загрузить ещё</Button>,
    );
  }

  // Служебные пункты идут первыми и находятся поиском, как и группы: «Без группы» — по «без».
  const groupOptions = [
    { value: NO_GROUP, label: "Без группы" },
    { value: NEW_GROUP, label: "＋ Создать новую группу" },
    ...(groups.data ?? []).map((g) => ({ value: g.id, label: g.name })),
  ];
  /** Числа файла для баннера; нулевые не называются — «0 показателей» ничего не говорит. */
  const fileCounts = inspect
    ? [
        inspect.questionIds > 0 ? plural(inspect.questionIds, ["вопрос", "вопроса", "вопросов"]) : null,
        inspect.scaleKeys.length > 0 ? plural(inspect.scaleKeys.length, ["шкала", "шкалы", "шкал"]) : null,
        inspect.variableNames.length > 0
          ? plural(inspect.variableNames.length, ["показатель", "показателя", "показателей"])
          : null,
      ].filter(Boolean).join(", ")
    : "";

  /**
   * «Проверить» и «Импортировать». Без файла проверять нечего, поэтому обе заблокированы. В окне
   * перед ними встаёт «Отмена», и все три уходят в подвал окна — порядок как в эскизе; на
   * встроенном экране «Импорт» они стоят в теле, перед списком загрузок.
   */
  const buttons = (
    <>
      <Button
        variant="secondary"
        onClick={() => dryMut.mutate()}
        loading={dryMut.isPending}
        disabled={!file || !testId || runMut.isPending || (group === NEW_GROUP && !newGroupName.trim())}
        title={!file ? "Сначала выберите файл" : !testId ? "Сначала выберите тест" : undefined}
      >
        Проверить
      </Button>
      {/* «Импортировать» до проверки заблокирована намеренно: план — единственное место, где
          предупреждения видны ДО записи, и пропустить его значит записать вслепую. */}
      <Button
        onClick={() => runMut.mutate()}
        loading={runMut.isPending}
        disabled={!plan || !testId || (group === NEW_GROUP && !newGroupName.trim())}
        title={!file ? "Сначала выберите файл" : !testId ? "Сначала выберите тест" : !plan ? "Сначала проверьте файл" : undefined}
      >
        Импортировать
      </Button>
    </>
  );

  const form = (
    <>
      {file ? fileRow : uploader}

      {ambiguous && inspect && (
        // Вопросы файла стоят в нескольких тестах (PRD-54 раздел 6.2, 2026-10-06): вместо
        // подтверждения — выбор из них. Опубликованный подставлен рекомендацией, выбор меняется.
        <>
          <Banner
            tone="warning"
            variant="subtle"
            icon={<AlertTriangle size={16} />}
            title={`Вопросы файла есть в ${candidates.length} ${candidates.length % 10 === 1 && candidates.length % 100 !== 11 ? "тесте" : "тестах"}`}
            description={[
              "Выберите, в какой тест загрузить прохождения.",
              inspect.recommendedTestId ? "Подставлен опубликованный тест — выбор можно изменить." : null,
              fileCounts ? `В файле ${fileCounts}.` : null,
            ].filter(Boolean).join(" ")}
          />
          <Select
            label="Тест"
            hint="Показаны тесты, в разделах которых стоят вопросы файла."
            placeholder="Выберите тест"
            fullWidth
            value={testId ?? undefined}
            onChange={(v) => {
              setChosenTestId(v);
              // План считан для прежнего теста — для нового его надо проверить заново.
              setPlan(null);
            }}
            options={candidates.map((c) => ({
              value: c.testId,
              label: candidateLabel(c, inspect.questionIds, c.testId === inspect.recommendedTestId),
            }))}
            disabled={runMut.isPending}
          />
        </>
      )}

      {inspect && !ambiguous && (
        // Баннер называет тест и числа файла — без технических пояснений (владелец 2026-10-02).
        <Banner
          tone="info"
          variant="subtle"
          icon={<CheckCircle2 size={16} />}
          title={inspect.testTitle ?? "Тест определён"}
          description={fileCounts ? `${fileCounts}.` : undefined}
        />
      )}

      {/* Одиночный выбор с поиском — Select searchable: групп бывают десятки (эскиз Э6).
          Поле узкое, как в эскизе: название группы короче ширины карточки. */}
      <Box maxW="lg" style={{ marginInline: 0 }}>
        <Select
          label="Группа"
          hint="Разрез для аналитики. Метка ставится на прохождения этой загрузки."
          fullWidth
          searchable
          searchPlaceholder="Поиск по названию группы"
          value={group}
          onChange={setGroup}
          options={groupOptions}
          disabled={runMut.isPending}
        />
      </Box>
      {group === NEW_GROUP && (
        <Input
          label="Название новой группы"
          required
          fullWidth
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
        />
      )}

      {/* Флажков нет. «Данные уже обезличены» узнаётся по колонке `external_id`, а связывание с
          пользователями с 2026-10-06 идёт всегда: участник, которого в системе нет, получает
          внешнюю учётную запись (PRD-54 BR-54-38). */}

      {plan && (
        <Stack gap={2}>
          <Cluster gap={2} wrap>
            <Tag tone="success" variant="outline" size="s">Будет добавлено: {plan.rowsCreated}</Tag>
            <Tag variant="outline" size="s">Будет обновлено: {plan.rowsUpdated}</Tag>
            <Tag tone={plan.rowsSkipped > 0 ? "warning" : undefined} variant="outline" size="s">
              Будет пропущено: {plan.rowsSkipped}
            </Tag>
            <Tag variant="outline" size="s">Будет связано: {plan.rowsLinked}</Tag>
            <Tag variant="outline" size="s">Будет заведено участников: {plan.usersCreated}</Tag>
          </Cluster>
          {/* Ключ с номером: протокол повторяет одну фразу на каждую такую строку файла. */}
          {plan.warnings.map((w, i) => (
            <Banner key={`${i}:${w}`}tone="warning" icon={<AlertTriangle size={16} />} description={w} />
          ))}
        </Stack>
      )}

      {runMut.isPending && (
        <Cluster gap={2}><Spinner size="s" /><Text variant="body-s" tone="muted">Импортируем… Не закрывайте окно.</Text></Cluster>
      )}
      {runMut.isError && (
        <Banner
          tone="error"
          title="Загрузка не выполнена"
          description={`${(runMut.error as Error).message} Ничего не записано — можно повторить.`}
        />
      )}
      {dryMut.isError && (
        <Banner tone="error" title="Проверка не выполнена" description={(dryMut.error as Error).message} />
      )}
    </>
  );

  const batchList = batchesTestId && (
    <Stack gap={2}>
      <Text variant="body-s" weight="medium">Загрузки этого теста</Text>
      {(batches.data ?? []).length === 0 ? (
        <EmptyState
          title="Выгрузки ещё не загружали"
          description="Здесь появится список загруженных файлов — с датой, автором и возможностью откатить."
        />
      ) : (
        <Stack gap={1}>
          {(batches.data ?? []).map((b) => (
            // Строка не переносится: в узком месте откат иначе уезжал на отдельную строку и у
            // соседних загрузок вставал по-разному. Переносится только текст — он и растягивается.
            <Cluster key={b.id} gap={3} wrap={false}>
              <Stack gap={0} grow>
                <Text variant="body-s" weight="medium">{b.fileName}</Text>
                <Text variant="body-xs" tone="muted">
                  {new Date(b.importedAt).toLocaleString("ru-RU")} · добавлено {b.rowsCreated}, обновлено {b.rowsUpdated}
                </Text>
              </Stack>
              <Button
                variant="ghost"
                size="s"
                leadingIcon={<Trash2 size={14} />}
                onClick={() => rollbackMut.mutate(b.id)}
                loading={rollbackMut.isPending}
              >
                Откатить
              </Button>
            </Cluster>
          ))}
        </Stack>
      )}
    </Stack>
  );

  // До файла — только загрузчик и загрузки теста (эскиз Э6, «из меню теста»): группе, связыванию
  // и кнопкам нечего делать, пока нет файла.
  if (!file) {
    return (
      <Stack gap={4}>
        {uploader}
        {batchList}
      </Stack>
    );
  }

  return compose(form, buttons, batchList);
}
