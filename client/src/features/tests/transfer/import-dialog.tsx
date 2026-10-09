/**
 * @module features/tests/transfer/import-dialog
 *
 * The selective-import form (PRD-48 §3-5), laid out after
 * `.playwright-mcp/wf-transfer-import.html`.
 *
 * Three steps, because the choice cannot be made blind: pick the package, choose what to take,
 * read the report. The middle step shows the inventory of the five parts, the state of every
 * topic of the package, and — before anything is written — the count and the NAMES of what
 * would be deleted. A replacement mode without that list does not ship (PRD-48 §2.5).
 *
 * The steps themselves live in {@link module:features/tests/transfer/transfer-import-parts}:
 * the «Импорт» section shows the same choice and report on its page (E6, single import point).
 */
import {
  Banner,
  Button,
  Cluster,
  FileUploader,
  ModalDialog,
  Stack,
  WizardSteps,
} from "@skillum/ui-kit";
import { useTransferImport } from "./use-transfer-import";
import { TransferImportChoose, TransferImportReport } from "./transfer-import-parts";

export interface TransferImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful run, so the list can refresh. */
  onDone?: () => void;
}

export function TransferImportDialog({ open, onClose, onDone }: TransferImportDialogProps) {
  const t = useTransferImport();
  const summary = t.summary;

  const stepIndex = t.step === "file" ? 0 : t.step === "choose" ? 1 : 2;
  const exportedAt = summary ? new Date(summary.exportedAt).toLocaleDateString("ru-RU") : "";

  const wizard = (
    <WizardSteps
      horizontal
      narrow
      navOnly
      current={stepIndex}
      steps={[
        { id: "file", title: "Файл" },
        { id: "choose", title: "Что импортировать", description: "выбор частей и режимов" },
        { id: "done", title: "Готово" },
      ]}
    />
  );

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="xl"
      title="Импорт теста"
      description={
        summary
          ? `${summary.test.title} · пакет от ${exportedAt} · формат ${summary.formatVersion}`
          : "Пакет .tbtest переносит тест целиком: содержание, оформление и тексты итогов"
      }
      footer={
        <>
          <span className="ou-text ou-text--muted">
            {t.step === "done"
              ? "Изменения записаны."
              : "Ничего не записано. Изменения применятся по кнопке справа."}
          </span>
          <Cluster gap={2}>
            <Button variant="secondary" onClick={onClose} data-testid="transfer-cancel">
              {t.step === "done" ? "Закрыть" : "Отмена"}
            </Button>
            {t.step === "choose" && (
              <Button
                variant="primary"
                onClick={() => void t.apply()}
                // A plan being recomputed is a plan the author has not seen.
                disabled={t.planning || t.busy}
                data-testid="transfer-apply"
              >
                Импортировать
              </Button>
            )}
          </Cluster>
        </>
      }
      data-testid="transfer-import-dialog"
    >
      <Stack gap={4}>
        {wizard}

        {t.error && <Banner variant="outline" tone="error" stacked title={t.error} />}

        {t.step === "file" && (
          <FileUploader
            title="Перетащите файл .tbtest или выберите его"
            description="Пакет переноса, выгруженный из другой инсталляции"
            accept=".tbtest,application/zip"
            disabled={t.busy}
            onFiles={(files) => files[0] && void t.choose(files[0])}
            data-testid="transfer-file"
          />
        )}

        {t.step === "choose" && <TransferImportChoose t={t} />}

        {t.step === "done" && t.report && (
          <TransferImportReport report={t.report} onRefresh={() => onDone?.()} />
        )}
      </Stack>
    </ModalDialog>
  );
}
