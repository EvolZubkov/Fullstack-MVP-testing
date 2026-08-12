/**
 * @module features/templates/__tests__/upload-modal.test
 * @description Branch coverage for {@link UploadModal}: the upload outcome
 * states (accepted clean / accepted-with-warnings / rejected-with-blocking),
 * the pending and network-error banners, the issue-message fallback chain
 * (message -> detail -> code), the footer label switch and the "check now"
 * jump. The upload mutation hook is mocked so outcomes are driven directly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const hook = vi.hoisted(() => ({
  state: {
    isPending: false,
    isError: false,
    error: null as { message: string } | null,
    reset: vi.fn(),
    nextResult: null as unknown,
    mutate: vi.fn(),
  },
}));
hook.state.mutate = vi.fn((_file: File, opts?: { onSuccess?: (r: unknown) => void }) => {
  if (hook.state.nextResult && opts?.onSuccess) opts.onSuccess(hook.state.nextResult);
});

vi.mock("../use-admin-templates", () => ({ useUploadTemplate: () => hook.state }));

// eslint-disable-next-line import/first -- after vi.mock
import { UploadModal } from "../upload-modal";

const onClose = vi.fn();
const onCheckNow = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  hook.state.isPending = false;
  hook.state.isError = false;
  hook.state.error = null;
  hook.state.nextResult = null;
});

function renderModal() {
  return render(<UploadModal open onClose={onClose} onCheckNow={onCheckNow} />);
}

/** Drop a fake .zip through the DS FileUploader's hidden input (rendered in a portal). */
function dropZip() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["x"], "tpl.zip", { type: "application/zip" });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("<UploadModal />", () => {
  it("renders the dropzone and the «Отмена» label before any upload", () => {
    renderModal();
    expect(screen.getByText("Загрузка шаблона")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отмена" })).toBeInTheDocument();
  });

  it("accepts a clean archive: success banner + «Перейти к проверке» jump", () => {
    const template = { id: "acme", name: "Acme" };
    hook.state.nextResult = { ok: true, template, report: { warnings: [] } };
    renderModal();
    dropZip();
    expect(hook.state.mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Комплектность в порядке/)).toBeInTheDocument();
    // Footer switches to "Закрыть" once accepted (the × close button shares the label).
    expect(screen.getAllByRole("button", { name: "Закрыть" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Перейти к проверке" }));
    expect(onCheckNow).toHaveBeenCalledWith(template);
  });

  it("accepts with warnings: warning banner + issue list (message)", () => {
    hook.state.nextResult = {
      ok: true, template: { id: "t" },
      report: { warnings: [{ code: "W1", message: "нет light-темы" }] },
    };
    renderModal();
    dropZip();
    expect(screen.getByText(/принят с предупреждениями/)).toBeInTheDocument();
    expect(screen.getByText(/Предупреждения \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("нет light-темы")).toBeInTheDocument();
  });

  it("rejects with blocking errors: error banner + blocking list (detail fallback)", () => {
    hook.state.nextResult = {
      ok: false, error: "Комплектность нарушена",
      report: { blocking: [{ code: "B1", detail: "нет manifest.json" }] },
    };
    renderModal();
    dropZip();
    expect(screen.getByText(/Шаблон не загружен/)).toBeInTheDocument();
    expect(screen.getByText(/Блокирующие ошибки \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("нет manifest.json")).toBeInTheDocument();
  });

  it("falls back to the issue code when neither message nor detail is set", () => {
    hook.state.nextResult = { ok: false, error: null, report: { blocking: [{ code: "E_ONLY_CODE" }] } };
    renderModal();
    dropZip();
    expect(screen.getByText("E_ONLY_CODE")).toBeInTheDocument();
  });

  it("shows the pending banner while the upload is in flight", () => {
    hook.state.isPending = true;
    renderModal();
    expect(screen.getByText(/Идёт распаковка/)).toBeInTheDocument();
  });

  it("shows the network-error banner when the mutation errors with no outcome", () => {
    hook.state.isError = true;
    hook.state.error = { message: "сеть недоступна" };
    renderModal();
    expect(screen.getByText("Не удалось загрузить архив")).toBeInTheDocument();
    expect(screen.getByText("сеть недоступна")).toBeInTheDocument();
  });

  it("ignores an empty file selection (no mutation)", () => {
    renderModal();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    expect(hook.state.mutate).not.toHaveBeenCalled();
  });

  it("closes via «Отмена»", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(onClose).toHaveBeenCalled();
  });
});
