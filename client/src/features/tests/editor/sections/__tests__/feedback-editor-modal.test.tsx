/**
 * @module features/tests/editor/sections/__tests__/feedback-editor-modal.test
 * @description Component tests for FeedbackEditorModal (PRD-7 FR-36 / FR-37).
 *
 * Coverage:
 *   - Renders Textarea when format="plain".
 *   - Switches to RTE toolbar + contenteditable area on format change.
 *   - Empty-state for links: list absent, only button shown.
 *   - «Добавить ссылку» appends a link row; button is not full-width.
 *   - createLink: mock window.prompt + document.execCommand, verify call.
 *   - PDF upload via hidden input: asset appears in draft; onSave strips size/file.
 *   - «Отменить» calls onCancel; «Сохранить» calls onSave with canonical value.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedbackEditorModal } from "../feedback-editor-modal";
import type { FeedbackEditorValue } from "../feedback-editor-modal";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function baseValue(overrides: Partial<FeedbackEditorValue> = {}): FeedbackEditorValue {
  return {
    format: "plain",
    text: "",
    links: [],
    assets: [],
    ...overrides,
  };
}

function renderModal(
  props: Partial<Parameters<typeof FeedbackEditorModal>[0]> = {},
) {
  const onCancel = vi.fn();
  const onSave = vi.fn();
  render(
    <FeedbackEditorModal
      open
      title="Обратная связь"
      value={baseValue()}
      onCancel={onCancel}
      onSave={onSave}
      {...props}
    />,
  );
  return { onCancel, onSave };
}

// ─── Tests: body editor ───────────────────────────────────────────────────────

describe("<FeedbackEditorModal /> — body editor", () => {
  it("renders Textarea when format='plain'", () => {
    renderModal({ value: baseValue({ format: "plain" }) });
    expect(screen.getByTestId("feedback-editor-text")).toBeInTheDocument();
    expect(screen.queryByTestId("feedback-editor-rte-area")).not.toBeInTheDocument();
  });

  it("renders Textarea when format='html'", () => {
    renderModal({ value: baseValue({ format: "html" }) });
    expect(screen.getByTestId("feedback-editor-text")).toBeInTheDocument();
    expect(screen.queryByTestId("feedback-editor-rte-area")).not.toBeInTheDocument();
  });

  it("renders tb-rte toolbar and contenteditable area when format='richText'", () => {
    renderModal({ value: baseValue({ format: "richText" }) });
    expect(screen.queryByTestId("feedback-editor-text")).not.toBeInTheDocument();
    const area = screen.getByTestId("feedback-editor-rte-area");
    expect(area).toBeInTheDocument();
    expect(area).toHaveAttribute("contenteditable", "true");
    // Toolbar buttons.
    expect(screen.getByTestId("rte-bold")).toBeInTheDocument();
    expect(screen.getByTestId("rte-italic")).toBeInTheDocument();
    expect(screen.getByTestId("rte-link")).toBeInTheDocument();
    // Separator.
    expect(document.querySelector(".tb-rte__sep")).toBeInTheDocument();
  });

  it("switching to richText shows RTE and hides Textarea", async () => {
    renderModal({ value: baseValue({ format: "plain" }) });
    // Initially Textarea is visible.
    expect(screen.getByTestId("feedback-editor-text")).toBeInTheDocument();
    // SegmentedControl renders items as <button aria-pressed>, not role="tab".
    const richBtn = screen.getByRole("button", { name: /Форматированный/i });
    fireEvent.click(richBtn);
    await waitFor(() =>
      expect(screen.getByTestId("feedback-editor-rte-area")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("feedback-editor-text")).not.toBeInTheDocument();
  });
});

// ─── Tests: links section ────────────────────────────────────────────────────

describe("<FeedbackEditorModal /> — links", () => {
  it("shows no link list when links is empty, only the add button", () => {
    renderModal({ value: baseValue({ links: [] }) });
    expect(screen.queryByRole("list", { name: /Ссылки/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("feedback-editor-link-add")).toBeInTheDocument();
  });

  it("«Добавить ссылку» appends a link row", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("feedback-editor-link-add"));
    expect(screen.getByRole("list", { name: /Ссылки/i })).toBeInTheDocument();
    expect(screen.getByTestId("feedback-editor-link-title-0")).toBeInTheDocument();
    expect(screen.getByTestId("feedback-editor-link-url-0")).toBeInTheDocument();
  });

  it("renders existing links from initial value", () => {
    renderModal({
      value: baseValue({ links: [{ title: "Policy", url: "https://example.com" }] }),
    });
    expect(screen.getByTestId("feedback-editor-link-title-0")).toBeInTheDocument();
    expect(screen.getByTestId("feedback-editor-link-url-0")).toBeInTheDocument();
  });

  it("removes a link row on trash click", () => {
    renderModal({
      value: baseValue({ links: [{ title: "Policy", url: "https://example.com" }] }),
    });
    fireEvent.click(screen.getByTestId("feedback-editor-link-remove-0"));
    expect(screen.queryByTestId("feedback-editor-link-title-0")).not.toBeInTheDocument();
  });

  it("«Добавить ссылку» button parent is a <div> (not stretched full-width)", () => {
    renderModal();
    const btn = screen.getByTestId("feedback-editor-link-add");
    expect(btn.parentElement?.tagName).toBe("DIV");
  });
});

// ─── Tests: RTE link insert ───────────────────────────────────────────────────

describe("<FeedbackEditorModal /> — RTE createLink", () => {
  let promptSpy: ReturnType<typeof vi.spyOn>;
  /** Mock for document.execCommand (JSDOM may not expose it as a configurable property). */
  let execCommandMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    promptSpy = vi.spyOn(window, "prompt").mockReturnValue("https://test.example");
    execCommandMock = vi.fn().mockReturnValue(true);
    // JSDOM stubs execCommand but it may not be spy-able via vi.spyOn.
    // Use Object.defineProperty to install the mock directly.
    Object.defineProperty(document, "execCommand", {
      value: execCommandMock,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    promptSpy.mockRestore();
    // Remove custom mock so subsequent tests get JSDOM default.
    Object.defineProperty(document, "execCommand", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  it("«Вставить ссылку» prompts for URL and calls execCommand('createLink')", () => {
    renderModal({ value: baseValue({ format: "richText" }) });
    fireEvent.click(screen.getByTestId("rte-link"));
    expect(promptSpy).toHaveBeenCalledWith("URL ссылки");
    expect(execCommandMock).toHaveBeenCalledWith("createLink", false, "https://test.example");
  });

  it("does not call createLink when prompt returns empty string", () => {
    promptSpy.mockReturnValue("");
    renderModal({ value: baseValue({ format: "richText" }) });
    fireEvent.click(screen.getByTestId("rte-link"));
    expect(execCommandMock).not.toHaveBeenCalledWith("createLink", false, expect.anything());
  });

  it("does not call createLink when prompt is cancelled (null)", () => {
    promptSpy.mockReturnValue(null);
    renderModal({ value: baseValue({ format: "richText" }) });
    fireEvent.click(screen.getByTestId("rte-link"));
    expect(execCommandMock).not.toHaveBeenCalledWith("createLink", false, expect.anything());
  });
});

// ─── Tests: PDF assets section ────────────────────────────────────────────────

describe("<FeedbackEditorModal /> — PDF assets", () => {
  it("renders upload button and hint; no list when assets is empty", () => {
    renderModal();
    expect(screen.getByTestId("feedback-editor-asset-upload")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /Прикреплённые файлы/i })).not.toBeInTheDocument();
  });

  it("hides PDF section when hideAssets=true", () => {
    renderModal({ hideAssets: true });
    expect(screen.queryByTestId("feedback-editor-asset-upload")).not.toBeInTheDocument();
  });

  it("file upload appends asset to draft and shows it in the list", async () => {
    renderModal();
    const input = screen.getByTestId("feedback-editor-asset-input") as HTMLInputElement;
    const file = new File(["content"], "policy.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: 250 * 1024, configurable: true });
    await userEvent.upload(input, file);

    await waitFor(() =>
      expect(screen.getByRole("list", { name: /Прикреплённые файлы/i })).toBeInTheDocument(),
    );
    const titleInput = screen.getByTestId("feedback-editor-asset-title-0") as HTMLInputElement;
    expect(titleInput.value).toBe("policy");
    // File name shown in the asset-file element.
    expect(screen.getByText(/policy\.pdf/)).toBeInTheDocument();
  });

  it("onSave strips size/file from assets before emitting", async () => {
    const onSave = vi.fn();
    render(
      <FeedbackEditorModal
        open
        title="Test"
        value={baseValue()}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );
    const input = screen.getByTestId("feedback-editor-asset-input") as HTMLInputElement;
    const file = new File(["pdf"], "doc.pdf", { type: "application/pdf" });
    await userEvent.upload(input, file);

    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

    const emitted = onSave.mock.calls[0][0] as FeedbackEditorValue;
    expect(emitted.assets).toHaveLength(1);
    expect(emitted.assets[0]).toMatchObject({
      title: "doc",
      fileName: "doc.pdf",
      mimeType: "application/pdf",
    });
    // UI-only fields must NOT leak out.
    expect("size" in emitted.assets[0]).toBe(false);
    expect("file" in emitted.assets[0]).toBe(false);
  });

  it("rejects files over 5 MB with window.alert and does not add them", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    renderModal();
    const input = screen.getByTestId("feedback-editor-asset-input") as HTMLInputElement;
    const bigFile = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(bigFile, "size", { value: 6 * 1024 * 1024, configurable: true });
    await userEvent.upload(input, bigFile);

    expect(alertSpy).toHaveBeenCalledOnce();
    expect(screen.queryByRole("list", { name: /Прикреплённые файлы/i })).not.toBeInTheDocument();
    alertSpy.mockRestore();
  });

  it("removes an asset on trash click", () => {
    render(
      <FeedbackEditorModal
        open
        title="Test"
        value={baseValue({
          assets: [{ title: "Doc", fileName: "doc.pdf", mimeType: "application/pdf" }],
        })}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole("list", { name: /Прикреплённые файлы/i })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("feedback-editor-asset-remove-0"));
    expect(screen.queryByRole("list", { name: /Прикреплённые файлы/i })).not.toBeInTheDocument();
  });
});

// ─── Tests: footer actions ────────────────────────────────────────────────────

describe("<FeedbackEditorModal /> — footer", () => {
  it("«Отменить» calls onCancel", () => {
    const { onCancel } = renderModal();
    fireEvent.click(screen.getByTestId("feedback-editor-cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("«Сохранить» calls onSave with current draft value", () => {
    const { onSave } = renderModal({
      value: baseValue({ format: "plain", text: "Hello" }),
    });
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    expect(onSave).toHaveBeenCalledOnce();
    const arg = onSave.mock.calls[0][0] as FeedbackEditorValue;
    expect(arg.text).toBe("Hello");
    expect(arg.format).toBe("plain");
  });
});
