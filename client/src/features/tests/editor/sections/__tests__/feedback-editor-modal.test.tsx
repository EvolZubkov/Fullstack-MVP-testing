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
    expect(screen.queryByRole("list", { name: /Курсы/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("feedback-editor-link-add")).toBeInTheDocument();
  });

  it("«Добавить ссылку» appends a link row", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("feedback-editor-link-add"));
    expect(screen.getByRole("list", { name: /Курсы/i })).toBeInTheDocument();
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

// ─── Tests: events section (TD-02) ───────────────────────────────────────────

describe("<FeedbackEditorModal /> — events", () => {
  it("«Добавить мероприятие» appends an event row (title + optional URL)", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("feedback-editor-event-add"));
    expect(screen.getByRole("list", { name: /Мероприятия/i })).toBeInTheDocument();
    expect(screen.getByTestId("feedback-editor-event-title-0")).toBeInTheDocument();
    expect(screen.getByTestId("feedback-editor-event-url-0")).toBeInTheDocument();
  });

  it("renders existing events from the initial value", () => {
    renderModal({ value: baseValue({ events: [{ title: "Вебинар", url: "https://e.com" }] }) });
    expect(screen.getByTestId("feedback-editor-event-title-0")).toBeInTheDocument();
  });

  it("saves an event without a URL (URL optional)", () => {
    const { onSave } = renderModal({ value: baseValue({ events: [{ title: "Очно" }] }) });
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ events: [{ title: "Очно" }] }),
    );
  });

  it("removes an event row on trash click", () => {
    renderModal({ value: baseValue({ events: [{ title: "X" }] }) });
    fireEvent.click(screen.getByTestId("feedback-editor-event-remove-0"));
    expect(screen.queryByTestId("feedback-editor-event-title-0")).not.toBeInTheDocument();
  });

  it("hideEvents hides the events section entirely", () => {
    renderModal({ hideEvents: true, value: baseValue({ events: [{ title: "X" }] }) });
    expect(screen.queryByTestId("feedback-editor-event-add")).not.toBeInTheDocument();
  });

  it("renders the courses list under «Курсы» (links relabel)", () => {
    renderModal({ value: baseValue({ links: [{ title: "Курс", url: "https://e.com" }] }) });
    expect(screen.getByRole("list", { name: /Курсы/i })).toBeInTheDocument();
  });
});

// ─── Tests: RTE link insert (S13.1-G39 — modal replaces window.prompt) ───────

describe("<FeedbackEditorModal /> — RTE link-insert modal", () => {
  /** Mock for document.execCommand (JSDOM may not expose it as a configurable property). */
  let execCommandMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    execCommandMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      value: execCommandMock,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(document, "execCommand", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  it("«Вставить ссылку» opens the link-insert modal (no window.prompt)", () => {
    const promptSpy = vi.spyOn(window, "prompt");
    renderModal({ value: baseValue({ format: "richText" }) });
    fireEvent.click(screen.getByTestId("rte-link"));
    expect(promptSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("rte-link-url")).toBeInTheDocument();
    expect(screen.getByTestId("rte-link-text")).toBeInTheDocument();
    expect(screen.getByTestId("rte-link-submit")).toBeInTheDocument();
    expect(screen.getByTestId("rte-link-cancel")).toBeInTheDocument();
    promptSpy.mockRestore();
  });

  it("«Вставить» is disabled until URL field is non-empty", () => {
    renderModal({ value: baseValue({ format: "richText" }) });
    fireEvent.click(screen.getByTestId("rte-link"));
    expect(screen.getByTestId("rte-link-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("rte-link-url"), {
      target: { value: "https://test.example" },
    });
    expect(screen.getByTestId("rte-link-submit")).not.toBeDisabled();
  });

  it("«Отмена» closes the modal without inserting a link", () => {
    renderModal({ value: baseValue({ format: "richText" }) });
    fireEvent.click(screen.getByTestId("rte-link"));
    fireEvent.click(screen.getByTestId("rte-link-cancel"));
    expect(screen.queryByTestId("rte-link-url")).not.toBeInTheDocument();
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

  it("rejects files over 5 MB with an in-modal Banner (S13.1-G40, no window.alert)", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    renderModal();
    const input = screen.getByTestId("feedback-editor-asset-input") as HTMLInputElement;
    const bigFile = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(bigFile, "size", { value: 6 * 1024 * 1024, configurable: true });
    await userEvent.upload(input, bigFile);

    expect(alertSpy).not.toHaveBeenCalled();
    const banner = await screen.findByTestId("feedback-editor-oversize-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain("big.pdf");
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
