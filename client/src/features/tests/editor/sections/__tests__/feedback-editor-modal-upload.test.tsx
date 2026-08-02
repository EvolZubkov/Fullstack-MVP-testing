/**
 * @module features/tests/editor/sections/__tests__/feedback-editor-modal-upload.test
 * @description Picking a PDF sends the file to the server at once and puts the canonical
 * address into the descriptor. Without this the author saves an attachment that exists
 * nowhere (PRD-32).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { FeedbackEditorModal } from "../feedback-editor-modal";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ id: "asset-1", url: "/api/media/asset-1", mime: "application/pdf", size: 10 }),
  });
});

function open(onSave: (value: unknown) => void) {
  render(
    <FeedbackEditorModal
      open
      title="Обратная связь"
      value={{ format: "plain", text: "", links: [], assets: [], events: [] }}
      onCancel={() => {}}
      onSave={onSave}
      testId="fb"
    />,
  );
}

describe("FeedbackEditorModal — загрузка вложения", () => {
  it("шлёт файл на /api/media/upload с назначением и сохраняет адрес", async () => {
    const onSave = vi.fn();
    open(onSave);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["%PDF-1.4"], "memo.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/media/upload?purpose=feedback-asset",
      expect.objectContaining({ method: "POST" }),
    ));
    await waitFor(() => expect(screen.getByText(/memo\.pdf/)).toBeTruthy());

    fireEvent.click(screen.getByText("Сохранить"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        assets: [expect.objectContaining({ fileName: "memo.pdf", url: "/api/media/asset-1" })],
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

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "big.pdf", { type: "application/pdf" })] },
    });

    await waitFor(() => expect(screen.getByText(/не должен превышать/i)).toBeTruthy());
    fireEvent.click(screen.getByText("Сохранить"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ assets: [] }));
  });
});
