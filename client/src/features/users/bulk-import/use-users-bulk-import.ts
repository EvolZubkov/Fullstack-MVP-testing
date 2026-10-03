/**
 * @module features/users/bulk-import/use-users-bulk-import
 *
 * Состояние загрузки списка пользователей: предпросмотр файла, выбор действия у дублей, запись и
 * её итог.
 *
 * Одно на две оболочки (Э6 UX-аудита, «единая точка импорта»): окно «Массовая загрузка
 * пользователей» на странице «Пользователи» и шаг списка пользователей в разделе «Импорт». Хук
 * разметки не держит — обе оболочки рисуют одно и то же состояние, и разойтись в том, что считать
 * импортируемой строкой, им не на чем.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@skillum/ui-kit";

/** Строка предпросмотра — ответ `POST /api/users/bulk-preview`. */
export interface UsersPreviewRow {
  idx: number;
  email: string;
  name: string | null;
  role: string;
  groupName: string | null;
  groupId: string | null;
  groupFound: boolean;
  /**
   * PRD-54: `keyUpdate` — существующий пользователь с непустым внешним ключом. Такая строка НЕ
   * дубль: она не пропускается, а проставляет ключ, поэтому выбора «пропустить / обновить»
   * у неё нет.
   */
  status: "new" | "duplicate" | "keyUpdate" | "error";
  /** Почему строка не будет записана — показывается под статусом «Ошибка». */
  error?: string;
  existingId?: string;
  duplicateAction?: "skip" | "update";
  externalKey?: string | null;
  lmsLearnerId?: string | null;
  organization?: string | null;
  unit?: string | null;
  position?: string | null;
}

/** Итог записи — ответ `POST /api/users/bulk-import`. */
export interface UsersImportResult {
  created: number;
  updated: number;
  skipped: number;
  invitesSent: number;
  errors: string[];
}

/** Шаг загрузки: файл ещё не разобран, предпросмотр, запись выполнена. */
export type UsersBulkStep = "upload" | "preview" | "done";

/** Сколько строк уйдёт в запись: строки с ошибкой не пишутся никогда. */
export function importableCount(rows: readonly UsersPreviewRow[]): number {
  return rows.filter((row) => row.status !== "error").length;
}

export function useUsersBulkImport() {
  const queryClient = useQueryClient();
  const { push: toast } = useToast();

  const [step, setStep] = useState<UsersBulkStep>("upload");
  const [rows, setRows] = useState<UsersPreviewRow[]>([]);
  const [sendInvites, setSendInvites] = useState(true);
  const [result, setResult] = useState<UsersImportResult | null>(null);

  const previewMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/users/bulk-preview", { method: "POST", credentials: "include", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Parse error");
      return res.json() as Promise<UsersPreviewRow[]>;
    },
    onSuccess: (preview) => {
      setRows(preview.map((row) => ({ ...row, duplicateAction: "skip" })));
      setStep("preview");
    },
    onError: (e: Error) => toast({ tone: "error", title: "Ошибка", description: e.message }),
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/users/bulk-import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, sendInvites }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Import error");
      return res.json() as Promise<UsersImportResult>;
    },
    onSuccess: (done) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setResult(done);
      setStep("done");
    },
    onError: (e: Error) => toast({ tone: "error", title: "Ошибка импорта", description: e.message }),
  });

  /** Выбрать действие у строки-дубля. */
  function setDuplicateAction(idx: number, action: NonNullable<UsersPreviewRow["duplicateAction"]>) {
    setRows((prev) => prev.map((row) => (row.idx === idx ? { ...row, duplicateAction: action } : row)));
  }

  /** Вернуться к выбору файла, забыв предпросмотр и итог. */
  function reset() {
    setStep("upload");
    setRows([]);
    setResult(null);
  }

  return {
    step,
    setStep,
    rows,
    sendInvites,
    setSendInvites,
    result,
    preview: (file: File) => previewMutation.mutate(file),
    previewing: previewMutation.isPending,
    runImport: () => importMutation.mutate(),
    importing: importMutation.isPending,
    setDuplicateAction,
    reset,
  };
}

/** Состояние загрузки списка — то, что рисуют предпросмотр и итог. */
export type UsersBulkImport = ReturnType<typeof useUsersBulkImport>;
