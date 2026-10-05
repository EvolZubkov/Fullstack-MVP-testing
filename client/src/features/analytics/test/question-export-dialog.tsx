/**
 * @module features/analytics/test/question-export-dialog
 * @description Э5.2: окно «Экспорт» уровня вопроса (эскиз docs/wireframes/approved/e5-export.html,
 * состояние «Экспорт: вопрос»).
 *
 * Раньше кнопка «Выгрузить ответы в Excel» была прямой ссылкой и выгружала ответы всех
 * прохождений теста мимо фильтра страницы. Окно называет условия и число ответов под них — то
 * же, что увидит книга: ручка выгрузки и ручка списка ответов читают одни и те же условия.
 */
import { useEffect, useState } from "react";
import { Download } from "lucide-react";

import { Banner, Button, ModalDialog, Stack, Text } from "@skillum/ui-kit";

import { fileNameOf } from "@/features/tests/export/save-as-dialog";

/** Свойства окна. */
export interface QuestionExportDialogProps {
  open: boolean;
  onClose: () => void;
  testId: string;
  questionId: string;
  /** Условия страницы (`?…` или пусто). */
  search: string;
  /** Подписи условий — те же, что в полосе фильтра. */
  conditionLabels: string[];
}

/** Базовый адрес ответов задания. */
function answersPath(testId: string, questionId: string): string {
  return `/api/analytics/tests/${encodeURIComponent(testId)}/questions/${encodeURIComponent(questionId)}/answers`;
}

/**
 * Окно «Экспорт» вопроса.
 *
 * @param props вопрос, условия страницы и их подписи
 */
export function QuestionExportDialog({ open, onClose, testId, questionId, search, conditionLabels }: QuestionExportDialogProps) {
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // Число ответов — той же ручкой списка с теми же условиями; строк не берём.
  useEffect(() => {
    if (!open) return;
    setFailed(null);
    let alive = true;
    const params = new URLSearchParams(search.replace(/^\?/, ""));
    params.set("limit", "1");
    void (async () => {
      try {
        const response = await fetch(`${answersPath(testId, questionId)}?${params.toString()}`, { credentials: "include" });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as { total: number };
        if (alive) setTotal(data.total);
      } catch {
        if (alive) setTotal(null);
      }
    })();
    return () => { alive = false; };
  }, [open, testId, questionId, search]);

  const download = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const response = await fetch(`${answersPath(testId, questionId)}/export/excel${search}`, { credentials: "include" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Не удалось собрать файл");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameOf(response.headers.get("Content-Disposition"), "answers.xlsx");
      link.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (error) {
      setFailed((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="s"
      title="Экспорт"
      description="Ответы на вопрос — по текущему фильтру страницы"
      footer={(
        <>
          <Button variant="ghost" size="m" onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            size="m"
            leadingIcon={<Download size={16} />}
            disabled={busy || total === 0}
            onClick={() => void download()}
          >
            {busy ? "Собираем…" : "Выгрузить"}
          </Button>
        </>
      )}
    >
      <Stack gap={4}>
        <Banner
          tone={total === 0 ? "warning" : "info"}
          size="sm"
          title={total === null ? "Считаем ответы…" : `Под условия подходит ${total} ${total === 1 ? "ответ" : "ответов"}`}
          description={conditionLabels.length > 0
            ? conditionLabels.join(" · ")
            : "Условий не задано — выгрузятся ответы всех прохождений теста"}
        />
        <Text variant="body-s" tone="muted">
          Книга .xlsx: участник, источник, когда, ответ, исход и время на вопросе.
        </Text>
        {failed && <Banner tone="error" size="sm" title="Файл не собран" description={failed} />}
      </Stack>
    </ModalDialog>
  );
}
