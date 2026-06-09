/**
 * @module features/templates/upload-modal
 * @description Upload a new template ZIP (PRD-3 §3.1, §4.1–4.2). The DS
 * `FileUploader` dropzone accepts a `.zip` (≤ 20 МБ); the server validates
 * structural completeness in memory and either creates a `draft` (possibly with
 * warnings) or rejects with a blocking list. On acceptance the author can jump
 * straight to the preview/check modal for the fresh draft.
 */
import { useEffect, useState } from "react";
import { Banner, Button, FileUploader, ModalDialog } from "@universityrt/ui-kit";
import { AlertCircle } from "lucide-react";
import { useUploadTemplate, type AdminTemplate, type UploadOutcome, type ValidationIssue } from "./use-admin-templates";

export interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the created draft when the author chooses to check it now. */
  onCheckNow: (template: AdminTemplate) => void;
}

const MAX_MB = 20;

function IssueList({ issues, tone }: { issues: ValidationIssue[]; tone: "error" | "warning" }) {
  return (
    <ul className="tpl-upload-result-list">
      {issues.map((it, i) => (
        <li className="tpl-upload-result-item" key={`${it.code}-${i}`}>
          <AlertCircle size={16} style={{ color: `var(--ou-${tone}-default)`, flex: "0 0 auto" }} aria-hidden="true" />
          <span>{it.message ?? it.detail ?? it.code}</span>
        </li>
      ))}
    </ul>
  );
}

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
  const warnings = outcome?.report?.warnings ?? [];

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

        {pending && (
          <Banner
            tone="info"
            title="Идёт распаковка и проверка комплектности…"
            description="Архив проверяется в памяти; ничего не сохраняется до прохождения проверки."
          />
        )}

        {upload.isError && !outcome && (
          <Banner tone="error" title="Не удалось загрузить архив" description={upload.error?.message} />
        )}

        {accepted && (
          <Banner
            tone={warnings.length > 0 ? "warning" : "success"}
            title={
              warnings.length > 0
                ? "Архив принят с предупреждениями — создан черновик"
                : "Комплектность в порядке — создан черновик"
            }
            description="Запустите проверку работоспособности, чтобы шаблон можно было активировать."
          />
        )}

        {accepted && warnings.length > 0 && (
          <div>
            <div className="tpl-detail-section-title">Предупреждения ({warnings.length})</div>
            <IssueList issues={warnings} tone="warning" />
          </div>
        )}

        {rejected && (
          <>
            <Banner
              tone="error"
              title="Шаблон не загружен — есть блокирующие ошибки"
              description={outcome?.error ?? "Устраните ошибки и загрузите архив повторно."}
            />
            {outcome?.report?.blocking && outcome.report.blocking.length > 0 && (
              <div>
                <div className="tpl-detail-section-title">
                  Блокирующие ошибки ({outcome.report.blocking.length})
                </div>
                <IssueList issues={outcome.report.blocking} tone="error" />
              </div>
            )}
          </>
        )}
      </div>
    </ModalDialog>
  );
}
