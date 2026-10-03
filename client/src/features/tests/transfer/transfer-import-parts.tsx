/**
 * @module features/tests/transfer/transfer-import-parts
 *
 * Шаг «Что импортировать» и отчёт импорта пакета теста (PRD-48 §3-5) — общие для окна «Импорт
 * теста» в списке тестов и шага пакета в разделе «Импорт» (Э6 UX-аудита, «единая точка
 * импорта»). Разметка перенесена из окна без изменений: части пакета, режимы, темы, три числа
 * плана и — до записи — перечень того, что будет удалено (PRD-48 §2.5).
 *
 * The markup is ui-kit components, not hand-written `ou-*` classes; only `Stack`/`Cluster`/
 * `Grid` arrange them.
 */
import {
  Banner,
  Card,
  CardBody,
  CardKpi,
  Checkbox,
  Chip,
  Cluster,
  Grid,
  SegmentedControl,
  Select,
  Stack,
  Table,
} from "@skillum/ui-kit";
import type {
  PartMode,
  TopicPolicy,
  TransferApplyReport,
  TransferOperation,
  TransferTopicSummary,
} from "./transfer-api";
import type { useTransferImport } from "./use-transfer-import";

/** Состояние импорта пакета — то, что рисует шаг выбора. */
export type TransferImportState = ReturnType<typeof useTransferImport>;

/** Russian count forms: 1 вопрос, 2 вопроса, 5 вопросов. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

const MODE_ITEMS: Array<{ value: PartMode; label: string }> = [
  { value: "upsert", label: "Обновить и долить" },
  { value: "replace", label: "Заменить" },
];

/** What a topic of the package may be told to do here; a foreign topic has one option. */
function policyOptions(topic: TransferTopicSummary): Array<{ value: TopicPolicy; label: string }> {
  if (topic.state === "foreign") return [{ value: "new", label: "Создать новую тему" }];
  return [
    { value: "merge", label: "Обновить и долить" },
    { value: "new", label: "Создать новую тему" },
    { value: "replace", label: "Полная замена вопросов" },
  ];
}

/** The chip that says how the topic meets this installation. */
function topicStateChip(topic: TransferTopicSummary) {
  if (topic.state === "existing") {
    return <Chip size="s">есть · {plural(topic.questions, "вопрос", "вопроса", "вопросов")}</Chip>;
  }
  if (topic.state === "foreign") return <Chip size="s">чужая · нет прав управления</Chip>;
  return (
    <Chip size="s" solid selected>
      новая тема
    </Chip>
  );
}

function countBy(operations: TransferOperation[], kind: TransferOperation["kind"]): number {
  return operations.filter((op) => op.kind === kind).length;
}

/** Total across entities, for the report's three numbers. */
function sum(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, n) => total + n, 0);
}

/** Шаг «Что импортировать»: части пакета, режимы, темы, план и перечень удаляемого. */
export function TransferImportChoose({ t }: { t: TransferImportState }) {
  const summary = t.summary;
  if (!summary || !t.options) return null;
  const deletions = t.operations.filter((op) => op.kind === "delete");

  return (
    <>
      <Card variant="outlined">
        <CardBody>
          <Stack gap={4}>
            {/* 1 — структура и вопросы: режим задаётся ПО ТЕМЕ, а не на всю часть */}
            <Stack gap={2}>
              <Checkbox
                checked={t.options.parts.structure}
                onChange={(e) => t.setPart("structure", e.target.checked)}
                label="Структура и вопросы"
                description={`${plural(summary.parts.structure.sections, "раздел", "раздела", "разделов")} · ${plural(summary.parts.structure.topics, "тема", "темы", "тем")} · ${plural(summary.parts.structure.questions, "вопрос", "вопроса", "вопросов")} · режим выбирается для каждой темы`}
                data-testid="transfer-part-structure"
              />
              {t.options.parts.structure && (
                <Table<TransferTopicSummary>
                  // В ячейках — меню «Что делать»: без модификатора их обрезал край таблицы.
                  className="tb-tbl--menus"
                  density="compact"
                  rowKey={(row) => row.id}
                  rows={summary.topics}
                  emptyMessage="Тем в пакете нет"
                  columns={[
                    { key: "name", header: "Тема пакета", render: (row) => row.name },
                    { key: "state", header: "В этой системе", render: topicStateChip },
                    {
                      key: "policy",
                      header: "Что делать",
                      render: (row) =>
                        row.state === "new" ? (
                          <Chip size="s">будет создана</Chip>
                        ) : (
                          <Select<TopicPolicy>
                            size="s"
                            value={t.options?.topics[row.id] ?? "merge"}
                            options={policyOptions(row)}
                            onChange={(value) => t.setTopicPolicy(row.id, value)}
                            aria-label={`Что делать с темой «${row.name}»`}
                          />
                        ),
                    },
                  ]}
                />
              )}
            </Stack>

            {/* 2 — шкалы и показатели */}
            <PartRow
              label="Шкалы и показатели"
              description={`${plural(summary.parts.scales.scales, "шкала", "шкалы", "шкал")} · ${plural(summary.parts.scales.measurements, "вклад", "вклада", "вкладов")} · ${plural(summary.parts.scales.resultVariables, "показатель", "показателя", "показателей")}`}
              checked={t.options.parts.scales}
              onToggle={(on) => t.setPart("scales", on)}
              testId="transfer-part-scales"
              mode={t.options.modes.scales}
              onMode={(mode) => t.setMode("scales", mode)}
              modeTestId="transfer-mode-scales"
            />

            {/* 3 — оценивание */}
            <PartRow
              label="Оценивание"
              description={`${summary.parts.scoring.hasPassRule ? "правило прохождения · " : ""}${plural(summary.parts.scoring.overrides, "переопределение", "переопределения", "переопределений")} по вопросам`}
              checked={t.options.parts.scoring}
              onToggle={(on) => t.setPart("scoring", on)}
              testId="transfer-part-scoring"
              mode={t.options.modes.scoring}
              onMode={(mode) => t.setMode("scoring", mode)}
              modeTestId="transfer-mode-scoring"
            />

            {/* 4 и 5 — переключателя нет: удалять там нечего */}
            <PartRow
              label="Итоги и оформление"
              description={`${plural(summary.parts.results.contentPages, "страница", "страницы", "страниц")} · вводный блок · настройки отчёта · оформление`}
              checked={t.options.parts.results}
              onToggle={(on) => t.setPart("results", on)}
              testId="transfer-part-results"
            />
            <PartRow
              label="Медиа"
              description={plural(summary.parts.media.files, "файл", "файла", "файлов")}
              checked={t.options.parts.media}
              onToggle={(on) => t.setPart("media", on)}
              testId="transfer-part-media"
            />
          </Stack>
        </CardBody>
      </Card>

      <Grid cols={3} gap={2}>
        <CardKpi variant="outlined" label="будет создано" value={countBy(t.operations, "create")} />
        <CardKpi variant="outlined" label="будет обновлено" value={countBy(t.operations, "update")} />
        <CardKpi variant="outlined" label="будет удалено" value={deletions.length} />
      </Grid>

      {deletions.length > 0 && (
        <Banner
          variant="outline"
          tone="warning"
          stacked
          title={`Будет удалено ${plural(deletions.length, "запись", "записи", "записей")}`}
          description={deletions.map((op) => op.title).join("; ")}
          data-testid="transfer-deletions"
        />
      )}

      {summary.missingMedia.length > 0 && (
        <Banner
          variant="outline"
          tone="info"
          stacked
          title={`${plural(summary.missingMedia.length, "вложение", "вложения", "вложений")} не доехало из источника`}
          description="В источнике файл был уже недоступен на момент выгрузки — ссылка приедет битой."
        />
      )}
    </>
  );
}

/** Отчёт выполненного импорта; `onRefresh` — кнопка «Обновить список», где список рядом. */
export function TransferImportReport({ report, onRefresh }: { report: TransferApplyReport; onRefresh?: () => void }) {
  return (
    <Banner
      variant="outline"
      tone="success"
      stacked
      title="Импорт выполнен"
      description={
        `Создано: ${sum(report.created)} · обновлено: ${sum(report.updated)} · удалено: ${sum(report.deleted)}. ` +
        `Медиа: добавлено ${report.mediaCreated}, найдено в медиатеке ${report.mediaReused}.` +
        (report.renamedTopics.length ? ` Переименованы темы: ${report.renamedTopics.join("; ")}.` : "")
      }
      actions={onRefresh ? [{ label: "Обновить список", onClick: onRefresh }] : undefined}
      data-testid="transfer-report"
    />
  );
}

/** One part of the package: a checkbox, and a mode where replacement can erase. */
function PartRow(props: {
  label: string;
  description: string;
  checked: boolean;
  onToggle: (on: boolean) => void;
  testId: string;
  mode?: PartMode;
  onMode?: (mode: PartMode) => void;
  modeTestId?: string;
}) {
  return (
    <Cluster gap={3} align="center" justify="between">
      <Checkbox
        checked={props.checked}
        onChange={(e) => props.onToggle(e.target.checked)}
        label={props.label}
        description={props.description}
        data-testid={props.testId}
      />
      {props.mode && props.onMode ? (
        <SegmentedControl<PartMode>
          size="s"
          variant={props.mode === "replace" ? "accent" : "default"}
          items={MODE_ITEMS}
          value={props.mode}
          onChange={props.onMode}
          data-testid={props.modeTestId}
        />
      ) : (
        <Chip size="s">только обновление</Chip>
      )}
    </Cluster>
  );
}
