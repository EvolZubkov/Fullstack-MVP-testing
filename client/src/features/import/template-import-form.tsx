/**
 * @module features/import/template-import-form
 *
 * Шаг шаблона оформления (.zip) в разделе «Импорт» (Э6 UX-аудита): итог загрузки — тот же
 * компонент, что в окне «Загрузка шаблона» реестра шаблонов
 * ({@link module:features/templates/upload-outcome}). «Перейти к проверке» открывает то же окно
 * проверки работоспособности прямо здесь — уводить человека в реестр ради одной кнопки незачем.
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button, Cluster, FileItem, Stack } from "@skillum/ui-kit";
import { useUploadTemplate, type UploadOutcome } from "@/features/templates/use-admin-templates";
import { TemplateUploadOutcome } from "@/features/templates/upload-outcome";
import { PreviewCheckModal } from "@/features/templates/preview-check-modal";
import { t } from "@/lib/i18n";
import { fileMeta, formatSize } from "./file-meta";

export interface TemplateImportFormProps {
  /** Выбранный архив шаблона. */
  file: File;
  /** Убрать файл: раздел возвращается к загрузчику. */
  onReset: () => void;
}

export function TemplateImportForm({ file, onReset }: TemplateImportFormProps) {
  const upload = useUploadTemplate();
  const [outcome, setOutcome] = useState<UploadOutcome | null>(null);
  const [checking, setChecking] = useState(false);
  // Загрузка создаёт черновик — дважды её запускать нельзя, а строгий режим React зовёт эффект дважды.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    upload.mutate(file, { onSuccess: (res) => setOutcome(res) });
  }, [upload, file]);

  const accepted = outcome?.ok ? outcome.template : null;

  return (
    <Stack gap={3}>
      <FileItem
        name={file.name}
        meta={fileMeta("шаблон оформления", formatSize(file.size))}
        kind="zip"
        actions={upload.isPending ? [] : [{ icon: <X size={14} />, ariaLabel: t.importPage.removeFile, danger: true, onClick: onReset }]}
      />

      <TemplateUploadOutcome
        pending={upload.isPending}
        failure={upload.isError ? upload.error?.message ?? null : null}
        outcome={outcome}
      />

      {(accepted || (outcome && !outcome.ok)) && (
        <Cluster justify="end" gap={2}>
          {accepted ? (
            <Button variant="primary" onClick={() => setChecking(true)}>Перейти к проверке</Button>
          ) : (
            <Button variant="secondary" onClick={onReset}>{t.importPage.chooseOtherFile}</Button>
          )}
        </Cluster>
      )}

      {accepted && checking && (
        <PreviewCheckModal
          open
          template={accepted}
          onClose={() => setChecking(false)}
          onActivated={() => setChecking(false)}
        />
      )}
    </Stack>
  );
}
