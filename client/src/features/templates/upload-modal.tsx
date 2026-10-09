/**
 * @module features/templates/upload-modal
 * @description Upload a new template ZIP (PRD-3 §3.1, §4.1–4.2). The DS
 * `FileUploader` dropzone accepts a `.zip` (≤ 20 МБ); the server validates
 * structural completeness in memory and either creates a `draft` (possibly with
 * warnings) or rejects with a blocking list. On acceptance the author can jump
 * straight to the preview/check modal for the fresh draft.
 */
import { useEffect, useState } from "react";
import { Button, FileUploader, ModalDialog } from "@skillum/ui-kit";
import { useUploadTemplate, type AdminTemplate, type UploadOutcome } from "./use-admin-templates";
import { TemplateUploadOutcome } from "./upload-outcome";

export interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the created draft when the author chooses to check it now. */
  onCheckNow: (template: AdminTemplate) => void;
}

const MAX_MB = 20;

export function UploadModal({ open, onClose, onCheckNow }: UploadModalProps) {
  const upload = useUploadTemplate();
  const [outcome, setOutcome] = useState<UploadOutcome | null>(null);

  useEffect(() => {
    if (open) {
      setOutcome(null);
      upload.reset();
    }
    // upload identity is stable enough; reset only on open toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onFiles = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setOutcome(null);
    upload.mutate(file, { onSuccess: (res) => setOutcome(res) });
  };

  const pending = upload.isPending;
  const accepted = outcome?.ok && outcome.template;
  const rejected = outcome && !outcome.ok;

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="m"
      className="tpl-upload-modal"
      title="Загрузка шаблона"
      description="Загрузите ZIP-архив шаблона. Система проверит его комплектность перед активацией."
      closeOnBackdrop={!pending}
      footer={
        <div className="tpl-check-foot">
          <span className="tpl-upload-hint">ZIP · до {MAX_MB} МБ · без внешних ссылок</span>
          <div className="tpl-check-foot__actions">
            <Button variant="ghost" size="m" onClick={onClose} disabled={pending}>
              {accepted ? "Закрыть" : "Отмена"}
            </Button>
            {accepted && (
              <Button
                variant="primary"
                size="m"
                onClick={() => outcome!.template && onCheckNow(outcome!.template)}
              >
                Перейти к проверке
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="tpl-upload-body">
        {!accepted && (
          <FileUploader
            accept=".zip,application/zip"
            maxSizeMb={MAX_MB}
            error={!!rejected}
            disabled={pending}
            onFiles={onFiles}
            title="Перетащите ZIP-архив сюда"
            description="или нажмите, чтобы выбрать файл"
            cta="Выбрать архив"
          />
        )}

        <TemplateUploadOutcome
          pending={pending}
          failure={upload.isError ? upload.error?.message ?? null : null}
          outcome={outcome}
        />
      </div>
    </ModalDialog>
  );
}
