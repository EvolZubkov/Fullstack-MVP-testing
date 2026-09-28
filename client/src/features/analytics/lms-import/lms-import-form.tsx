/**
 * @module features/analytics/lms-import/lms-import-form
 * @description Форма загрузки выгрузки отчёта LMS (PRD-54 раздел 11).
 *
 * ОДНА на три точки входа: экран «Импорт» встраивает её в страницу, обе страницы аналитики — в
 * `ModalDialog` через `LmsImportDialog`. В окне кнопки уходят в стандартный подвал окна (`frame`),
 * на встроенном экране стоят в теле формы. Копии разошлись бы поведением сухого прогона и предупреждений, а разойдясь,
 * начали бы обещать разное про один и тот же файл.
 *
 * Хост может отдать уже разобранный файл (экран импорта опознаёт вид до ветвления) либо не отдать
 * ничего — тогда форма показывает собственный загрузчик и опознаёт файл сама.
 *
 * Эскиз: `docs/wireframes/prd54-lms-import.html` (согласован 2026-09-12).
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Trash2, Upload, X } from "lucide-react";
import {
  Banner,
  Button,
  Checkbox,
  Cluster,
  EmptyState,
  FileItem,
  FileUploader,
  Input,
  Select,
  Spinner,
  Stack,
  Switch,
  Tag,
  Text,
  useToast,
} from "@skillum/ui-kit";
import { queryClient } from "@/lib/queryClient";
import { invalidateAnalytics } from "../invalidate-analytics";

/** Сентинелы списка групп — по образцу `NEW_TEST = "__new__"` со страницы «Импорт». */
const NO_GROUP = "__none__";
const NEW_GROUP = "__new__";

/** Ответ `/api/workbook/inspect` для выгрузки отчёта LMS. */
export interface LmsInspectResult {
  kind: "lmsExport";
  testId: string | null;
  testTitle: string | null;
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
  warnings: string[];
}

interface Batch {
  id: string;
  fileName: string;
  importedAt: string;
  rowsCreated: number;
  rowsUpdated: number;
  rowsLinked: number;
  /** PRD-66 FR-12: учитывается ли загрузка в расчётах. Снятая остаётся в базе целиком. */
  counted: boolean;
}

/**
 * Части формы, которые хост-окно раскладывает по своим местам: тело — в тело окна, кнопки — в
 * его подвал с разделителем.
 */
export interface LmsImportFrameParts {
  /** Содержимое формы без кнопок. */
  body: ReactNode;
  /** Кнопки текущего состояния формы («Отмена», «Проверить», «Импортировать» и т. п.). */
  actions: ReactNode;
}

export interface LmsImportFormProps {
  /** Файл, уже выбранный хостом. Без него форма показывает свой загрузчик. */
  file?: File;
  /** Разбор, уже выполненный хостом. */
  inspect?: LmsInspectResult;
  /**
   * Задан на странице аналитики КОНКРЕТНОГО теста. Файл чужого теста тогда отвергается — это
   * единственная защита от загрузки посторонней выгрузки в открытую перед глазами аналитику.
   */
  fixedTestId?: string;
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
  /**
   * Закрыть окно, в котором открыта форма. Задан — среди кнопок первой появляется «Отмена»
   * (после успешной загрузки — «Закрыть»). Встроенная форма экрана «Импорт» его не передаёт.
   */
  onCancel?: () => void;
  /**
   * Раскладка по окну. Задана — форма отдаёт тело и кнопки порознь, и хост ставит кнопки в подвал
   * окна (эскиз, состояние «в окне»). Не задана — кнопки стоят в теле формы, перед списком загрузок.
   */
  frame?: (parts: LmsImportFrameParts) => ReactNode;
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

export function LmsImportForm({ file: hostFile, inspect: hostInspect, fixedTestId, onDone, onReset, onCancel, frame }: LmsImportFormProps) {
  const { push: toast } = useToast();

  const [ownFile, setOwnFile] = useState<File | null>(null);
  const [ownInspect, setOwnInspect] = useState<LmsInspectResult | null>(null);
  const [notRecognized, setNotRecognized] = useState(false);
  const [group, setGroup] = useState<string>(NO_GROUP);
  const [newGroupName, setNewGroupName] = useState("");
  const [linkUsers, setLinkUsers] = useState(false);
  const [plan, setPlan] = useState<ImportOutcome | null>(null);
  const [done, setDone] = useState<ImportOutcome | null>(null);

  const file = hostFile ?? ownFile;
  const inspect = hostInspect ?? ownInspect;
  const testId = inspect?.testId ?? null;
  const mismatch = !!fixedTestId && !!testId && fixedTestId !== testId;
  /**
   * Чьи загрузки показывать. Тест, заданный страницей, известен ДО выбора файла: снять загрузку
   * с учёта (PRD-66 FR-12) можно, ничего не загружая. Где тест определяется по файлу, до файла
   * списка нет — показывать нечего.
   */
  const batchesTestId = testId ?? fixedTestId ?? null;

  const groups = useQuery<Array<{ id: string; name: string }>>({ queryKey: ["/api/groups"] });
  const batches = useQuery<Batch[]>({
    queryKey: [`/api/analytics/lms-import/batches/${batchesTestId}`],
    enabled: !!batchesTestId && !mismatch,
  });

  /** Тело запроса: и сухой прогон, и импорт отправляют одно и то же. */
  function body(): FormData {
    const fd = new FormData();
    if (file) fd.append("file", file);
    if (fixedTestId) fd.append("fixedTestId", fixedTestId);
    if (group !== NO_GROUP && group !== NEW_GROUP) fd.append("groupId", group);
    if (group === NEW_GROUP) fd.append("newGroupName", newGroupName);
    fd.append("linkUsers", String(linkUsers));
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
      if (!res.ok) throw new Error("read failed");
      return res.json();
    },
    onSuccess: (data) => {
      // Книга теста в эту форму не годится: она про содержание теста, а не про прохождения.
      if (data.kind !== "lmsExport") { setNotRecognized(true); return; }
      setOwnInspect(data);
    },
    onError: () => setNotRecognized(true),
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
  /**
   * PRD-66 FR-12: снять загрузку с учёта или вернуть. Решение обратимое, поэтому без
   * подтверждения — в отличие от отката рядом, который удаляет строки навсегда.
   */
  const countedMut = useMutation({
    mutationFn: async ({ id, counted }: { id: string; counted: boolean }) => {
      const res = await fetch(`/api/analytics/lms-import/batches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ counted }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Не удалось изменить учёт загрузки");
    },
    onSuccess: () => {
      // Выборка изменилась: числа аналитики на странице-хозяине обязаны пересчитаться.
      invalidateAnalytics(queryClient);
      batches.refetch();
    },
    onError: (e: Error) => toast({ tone: "error", title: "Ошибка", description: e.message }),
  });

  function reset() {
    setOwnFile(null);
    setOwnInspect(null);
    setNotRecognized(false);
    setPlan(null);
    setDone(null);
    // Файл мог прийти от хоста — своё состояние он чистит сам.
    onReset?.();
  }

  /**
   * Собрать состояние формы. В окне тело и кнопки уходят хосту порознь — кнопки встают в подвал;
   * встроенная форма ставит их в конец тела, справа.
   *
   * @param body содержимое до кнопок
   * @param buttons кнопки состояния, без «Отмены»: её добавляет сама раскладка
   * @param options.closeLabel подпись закрывающей кнопки — после записи отменять уже нечего
   * @param options.after содержимое под кнопками встроенной формы (список загрузок); в окне оно
   *   остаётся в теле, а кнопки уходят в подвал
   */
  function compose(
    body: ReactNode,
    buttons: ReactNode,
    { closeLabel = "Отмена", after = null }: { closeLabel?: string; after?: ReactNode } = {},
  ) {
    const cancel = onCancel ? (
      <Button variant="ghost" onClick={onCancel} disabled={runMut.isPending}>{closeLabel}</Button>
    ) : null;
    const actions = <>{cancel}{buttons}</>;
    if (frame) return <>{frame({ body: <Stack gap={3}>{body}{after}</Stack>, actions })}</>;
    return (
      <Stack gap={3}>
        {body}
        <Cluster justify="end" gap={2}>{actions}</Cluster>
        {after}
      </Stack>
    );
  }

  // ── Пусто: собственный загрузчик на месте строки файла ───────────────────
  // Остальная форма видна и до файла (эскиз, состояние «в окне»): человек сразу видит, что его
  // ждёт, а на странице теста — ещё и загрузки, которые можно снять с учёта.
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
      <span className="ou-uploader__sub">
        {fixedTestId ? "Только выгрузка отчёта LMS этого теста" : "Выгрузка отчёта LMS — вид определяется автоматически"}
      </span>
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
    // Встроенной форме без «Отмены» кнопок тут нет вовсе — пустую строку не рисуем.
    const body = (
      <>
        {fileRow}
        <Cluster gap={2}><Spinner size="s" /><Text variant="body-s" tone="muted">Читаем файл…</Text></Cluster>
      </>
    );
    return onCancel || frame ? compose(body, null) : <Stack gap={3}>{body}</Stack>;
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
  if (inspect && !testId) {
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

  // ── Чужой тест ───────────────────────────────────────────────────────────
  if (mismatch) {
    return compose(
      <>
        {fileRow}
        <Banner
          tone="error"
          title="Это выгрузка другого теста"
          description={`В файле — «${inspect?.testTitle ?? testId}». Открыта аналитика другого теста, и записать эти строки сюда нельзя.`}
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
        description={`Добавлено ${done.rowsCreated}, обновлено ${done.rowsUpdated}, пропущено ${done.rowsSkipped}, связано с пользователями ${done.rowsLinked}.`}
      />,
      <Button variant="secondary" onClick={reset}>Загрузить ещё</Button>,
      { closeLabel: "Закрыть" },
    );
  }

  const groupOptions = [
    { value: NO_GROUP, label: "Без группы" },
    { value: NEW_GROUP, label: "＋ Создать новую группу" },
    ...(groups.data ?? []).map((g) => ({ value: g.id, label: g.name })),
  ];

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
        disabled={!file || runMut.isPending || (group === NEW_GROUP && !newGroupName.trim())}
        title={!file ? "Сначала выберите файл" : undefined}
      >
        Проверить
      </Button>
      {/* «Импортировать» до проверки заблокирована намеренно: план — единственное место, где
          предупреждения видны ДО записи, и пропустить его значит записать вслепую. */}
      <Button
        onClick={() => runMut.mutate()}
        loading={runMut.isPending}
        disabled={!plan || (group === NEW_GROUP && !newGroupName.trim())}
        title={!file ? "Сначала выберите файл" : !plan ? "Сначала проверьте файл" : undefined}
      >
        Импортировать
      </Button>
    </>
  );

  const form = (
    <>
      {file ? fileRow : uploader}

      {inspect && (
        <Banner
          tone="info"
          icon={<CheckCircle2 size={16} />}
          title={inspect.testTitle ?? "Тест определён"}
          description={
            `${plural(inspect.questionIds, ["вопрос", "вопроса", "вопросов"])}, ` +
            `${plural(inspect.scaleKeys.length, ["шкала", "шкалы", "шкал"])}, ` +
            `${plural(inspect.variableNames.length, ["показатель", "показателя", "показателей"])}. ` +
            "Тест определён по файлу — выбирать не нужно."
          }
        />
      )}

      <Select
        label="Группа"
        hint="Разрез для аналитики. Метка ставится на прохождения этой загрузки."
        fullWidth
        value={group}
        onChange={setGroup}
        options={groupOptions}
        disabled={runMut.isPending}
      />
      {group === NEW_GROUP && (
        <Input
          label="Название новой группы"
          required
          fullWidth
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
        />
      )}

      {/* Флажка «данные уже обезличены» нет: обезличенный файл узнаётся по колонке
          `external_id`, и спрашивать человека о том, что видно из самого файла, незачем. */}
      <Checkbox
        label="Связать с пользователями по ключу"
        description="Совпадение с внешним ключом пользователя свяжет прохождение с ним."
        checked={linkUsers}
        onChange={(e) => setLinkUsers(e.target.checked)}
        disabled={runMut.isPending}
      />

      {plan && (
        <Stack gap={2}>
          <Cluster gap={2} wrap>
            <Tag tone="success" variant="outline" size="s">Будет добавлено: {plan.rowsCreated}</Tag>
            <Tag variant="outline" size="s">Будет обновлено: {plan.rowsUpdated}</Tag>
            <Tag tone={plan.rowsSkipped > 0 ? "warning" : undefined} variant="outline" size="s">
              Будет пропущено: {plan.rowsSkipped}
            </Tag>
            <Tag variant="outline" size="s">Будет связано: {plan.rowsLinked}</Tag>
          </Cluster>
          {plan.warnings.map((w) => (
            <Banner key={w} tone="warning" icon={<AlertTriangle size={16} />} description={w} />
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
            // Строка не переносится: в узком окне аналитики переключатель и откат иначе
            // уезжали на отдельные строки и у соседних загрузок вставали по-разному. Переносится
            // только текст — он и растягивается.
            <Cluster key={b.id} gap={3} wrap={false}>
              <Stack gap={0} grow>
                <Text variant="body-s" weight="medium">{b.fileName}</Text>
                <Text variant="body-xs" tone="muted">
                  {new Date(b.importedAt).toLocaleString("ru-RU")} · добавлено {b.rowsCreated}, обновлено {b.rowsUpdated}
                  {/* Выключенный переключатель в списке легко не заметить — говорим словами. */}
                  {b.counted ? null : " · не учитывается в расчётах — данные сохранены"}
                </Text>
              </Stack>
              <Switch
                size="s"
                label="В расчётах"
                checked={b.counted}
                onChange={(e) => countedMut.mutate({ id: b.id, counted: e.target.checked })}
                disabled={countedMut.isPending}
              />
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

  return compose(form, buttons, { after: batchList });
}
