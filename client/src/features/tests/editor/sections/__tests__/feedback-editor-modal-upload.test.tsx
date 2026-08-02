/**
 * @module features/tests/editor/sections/__tests__/feedback-editor-modal-upload.test
 * @description Picking a PDF sends the file to the server at once and puts the canonical
 * address into the descriptor. Without this the author saves an attachment that exists
 * nowhere (PRD-32).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { FeedbackEditorModal } from "../feedback-editor-modal";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ id: "asset-1", url: "/api/media/asset-1", mime: "application/pdf", size: 10 }),
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/**
 * The modal element. Callers render it unconditionally and only flip `open`, so the
 * reopen case below drives the very same instance rather than a fresh mount.
 */
function modal(isOpen: boolean, onSave: (value: unknown) => void) {
  return (
    <FeedbackEditorModal
      open={isOpen}
      title="Обратная связь"
      value={{ format: "plain", text: "", links: [], assets: [], events: [] }}
      onCancel={() => {}}
      onSave={onSave}
      testId="fb"
    />
  );
}

function open(onSave: (value: unknown) => void) {
  return render(modal(true, onSave));
}

/** A PDF of the given name; size stays well under the 5 MB limit. */
function pdf(name: string): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

/** Hands the hidden file input a selection, as the picker would. */
function pick(...files: File[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

describe("FeedbackEditorModal — загрузка вложения", () => {
  it("шлёт файл на /api/media/upload с назначением и сохраняет адрес", async () => {
    const onSave = vi.fn();
    open(onSave);

    pick(pdf("memo.pdf"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/media/upload?purpose=feedback-asset",
      expect.objectContaining({ method: "POST" }),
    ));
    await waitFor(() => expect(screen.getByText(/memo\.pdf/)).toBeTruthy());

    fireEvent.click(screen.getByText("Сохранить"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        assets: [
          expect.objectContaining({
            fileName: "memo.pdf",
            url: "/api/media/asset-1",
            // The registry id travels with the descriptor: it is what identifies the asset
            // afterwards, and it is what keys the list row.
            id: "asset-1",
          }),
        ],
      }),
    );
  });

  it("показывает отказ сервера и не добавляет вложение", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "feedback_asset_invalid", message: "Размер вложения не должен превышать 5 МБ" }),
    });
    const onSave = vi.fn();
    open(onSave);

    pick(pdf("big.pdf"));

    await waitFor(() => expect(screen.getByText(/не должен превышать/i)).toBeTruthy());
    fireEvent.click(screen.getByText("Сохранить"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ assets: [] }));
  });

  it("сообщение об отказе переживает следующий выбор файла", async () => {
    open(vi.fn());

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "feedback_asset_invalid", message: "Вложением обратной связи может быть только PDF" }),
    });
    pick(pdf("wrong.pdf"));
    await screen.findByText(/может быть только PDF/i);

    // A second pick must not silently wipe a message the author may not have read yet.
    pick(pdf("good.pdf"));
    await screen.findByText(/good\.pdf/);
    expect(screen.getByText(/может быть только PDF/i)).toBeTruthy();
  });

  it("на время загрузки «Сохранить» занята, а переоткрытие модалки её освобождает", async () => {
    // An answer that never settles keeps the upload in flight for the whole case.
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { rerender } = open(vi.fn());

    pick(pdf("slow.pdf"));
    await waitFor(() => expect(screen.getByTestId("feedback-editor-save")).toBeDisabled());

    // Closing and reopening starts a clean visit: the abandoned upload must not leave the
    // button busy forever, and the banner state must not carry over either.
    rerender(modal(false, vi.fn()));
    rerender(modal(true, vi.fn()));
    await waitFor(() => expect(screen.getByTestId("feedback-editor-save")).not.toBeDisabled());
  });

  it("переоткрытие убирает баннер отказа от прошлого визита", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "feedback_asset_invalid", message: "Размер вложения не должен превышать 5 МБ" }),
    });
    const { rerender } = open(vi.fn());

    pick(pdf("big.pdf"));
    await screen.findByText(/не должен превышать/i);

    rerender(modal(false, vi.fn()));
    rerender(modal(true, vi.fn()));
    await waitFor(() => expect(screen.queryByText(/не должен превышать/i)).toBeNull());
  });
});
