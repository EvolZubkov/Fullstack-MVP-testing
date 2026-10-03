/**
 * @module features/import/package-import-form
 *
 * Шаг пакета теста (.tbtest) в разделе «Импорт» (Э6 UX-аудита): шаг «Что импортировать» и отчёт
 * окна «Импорт теста» ({@link module:features/tests/transfer/transfer-import-parts}) на
 * странице. Состояние — тот же хук `useTransferImport`, что у окна: план пересчитывается на
 * каждое изменение, и пока он пересчитывается, записать нельзя (PRD-48 §3).
 */
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Banner, Button, Cluster, FileItem, Spinner, Stack, Text } from "@skillum/ui-kit";
import { useTransferImport } from "@/features/tests/transfer/use-transfer-import";
import { TransferImportChoose, TransferImportReport } from "@/features/tests/transfer/transfer-import-parts";
import { queryClient } from "@/lib/queryClient";
import { t } from "@/lib/i18n";
import { fileMeta, formatSize } from "./file-meta";

export interface PackageImportFormProps {
  /** Выбранный пакет. */
  file: File;
  /** Убрать файл: раздел возвращается к загрузчику. */
  onReset: () => void;
}

export function PackageImportForm({ file, onReset }: PackageImportFormProps) {
  const transfer = useTransferImport();
  const summary = transfer.summary;
  // Разбор пакета — один раз на файл: строгий режим React запускает эффект дважды.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void transfer.choose(file);
  }, [transfer, file]);

  if (transfer.step === "done" && transfer.report) {
    return (
      <Stack gap={4}>
        <TransferImportReport report={transfer.report} />
        <Cluster justify="end" gap={2}>
          <Button
            variant="secondary"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/tests"] });
              onReset();
            }}
          >
            {t.importPage.importMore}
          </Button>
        </Cluster>
      </Stack>
    );
  }

  const meta = summary
    ? fileMeta(
        "пакет теста",
        `«${summary.test.title}»`,
        `пакет от ${new Date(summary.exportedAt).toLocaleDateString("ru-RU")}`,
        `формат ${summary.formatVersion}`,
      )
    : fileMeta("пакет теста", formatSize(file.size));

  return (
    <Stack gap={4}>
      <FileItem
        name={file.name}
        meta={meta}
        kind="zip"
        thumb="TBT"
        actions={transfer.busy ? [] : [{ icon: <X size={14} />, ariaLabel: t.importPage.removeFile, danger: true, onClick: onReset }]}
      />

      {transfer.error && <Banner variant="outline" tone="error" stacked title={transfer.error} />}

      {transfer.step === "file" && transfer.busy && (
        <Cluster gap={2}><Spinner size="s" /><Text variant="body-s" tone="muted">Читаем пакет…</Text></Cluster>
      )}

      {transfer.step === "choose" && (
        <>
          <TransferImportChoose t={transfer} />
          <Cluster justify="end" gap={2}>
            <Button
              variant="primary"
              onClick={() => void transfer.apply()}
              // A plan being recomputed is a plan the author has not seen.
              disabled={transfer.planning || transfer.busy}
              loading={transfer.busy}
            >
              Импортировать
            </Button>
          </Cluster>
        </>
      )}
    </Stack>
  );
}
