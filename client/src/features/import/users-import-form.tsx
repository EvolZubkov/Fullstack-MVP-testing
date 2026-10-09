/**
 * @module features/import/users-import-form
 *
 * Шаг списка пользователей в разделе «Импорт» (Э6 UX-аудита): предпросмотр и итог — те же
 * компоненты, что в окне «Массовая загрузка пользователей» на странице «Пользователи»
 * ({@link module:features/users/bulk-import/users-bulk-preview}). Файл уже выбран разделом,
 * поэтому шага загрузки здесь нет: предпросмотр запрашивается сразу.
 */
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button, Cluster, FileItem, Spinner, Stack, Text } from "@skillum/ui-kit";
import { importableCount, useUsersBulkImport } from "@/features/users/bulk-import/use-users-bulk-import";
import { UsersBulkPreview, UsersBulkResult } from "@/features/users/bulk-import/users-bulk-preview";
import { t } from "@/lib/i18n";
import { fileMeta, formatSize, plural } from "./file-meta";

export interface UsersImportFormProps {
  /** Выбранный список (.csv или .xlsx). */
  file: File;
  /** Число строк по разбору раздела — до предпросмотра. */
  rows: number;
  /** Убрать файл: раздел возвращается к загрузчику. */
  onReset: () => void;
}

export function UsersImportForm({ file, rows, onReset }: UsersImportFormProps) {
  const bulk = useUsersBulkImport();
  // Предпросмотр — один раз на файл: строгий режим React запускает эффект дважды.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    bulk.preview(file);
  }, [bulk, file]);

  if (bulk.step === "done" && bulk.result) {
    return (
      <Stack gap={4}>
        <UsersBulkResult result={bulk.result} />
        <Cluster justify="end" gap={2}>
          <Button variant="secondary" onClick={onReset}>{t.importPage.importMore}</Button>
        </Cluster>
      </Stack>
    );
  }

  const count = importableCount(bulk.rows);
  return (
    <Stack gap={3}>
      <FileItem
        name={file.name}
        meta={fileMeta("список пользователей", plural(rows, ["строка", "строки", "строк"]), formatSize(file.size))}
        kind={/\.csv$/i.test(file.name) ? "other" : "xls"}
        thumb={/\.csv$/i.test(file.name) ? "CSV" : undefined}
        actions={bulk.importing ? [] : [{ icon: <X size={14} />, ariaLabel: t.importPage.removeFile, danger: true, onClick: onReset }]}
      />

      {bulk.previewing && (
        <Cluster gap={2}><Spinner size="s" /><Text variant="body-s" tone="muted">Анализируем файл...</Text></Cluster>
      )}

      {bulk.step === "preview" && (
        <>
          <UsersBulkPreview bulk={bulk} />
          <Cluster justify="end" gap={2}>
            <Button onClick={bulk.runImport} disabled={count === 0} loading={bulk.importing}>
              Импортировать ({plural(count, ["строка", "строки", "строк"])})
            </Button>
          </Cluster>
        </>
      )}
    </Stack>
  );
}
