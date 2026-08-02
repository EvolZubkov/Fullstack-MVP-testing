/**
 * @module features/tests/editor/sections/__tests__/feedback-editor-modal.coverage.test
 * @description Additional branch coverage for {@link FeedbackEditorModal}
 * (PRD-7 FR-36 / FR-37). Complements `feedback-editor-modal.test.tsx` by
 * exercising the interactive paths the smoke test only renders:
 *   - RTE toolbar commands (bold / italic) and the contenteditable `onInput`;
 *   - the link-insert modal submit across all three branches (wrap existing
 *     selection via `createLink`, insert `<a>` at a collapsed caret, append when
 *     the editor was never focused);
 *   - editing link / event / asset fields and asserting the emitted value;
 *   - human-readable file sizes (B / KB / MB) and the mixed oversize + valid case;
 *   - the description subtitle, the richText open-init effect and the value reset.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedbackEditorModal } from "../feedback-editor-modal";
import type { FeedbackEditorValue } from "../feedback-editor-modal";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function baseValue(overrides: Partial<FeedbackEditorValue> = {}): FeedbackEditorValue {
  return { format: "plain", text: "", links: [], assets: [], ...overrides };
}

function renderModal(props: Partial<Parameters<typeof FeedbackEditorModal>[0]> = {}) {
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

// ─── RTE toolbar + link-insert (execCommand-backed) ────────────────────────────

describe("<FeedbackEditorModal /> — RTE editing", () => {
  let execCommandMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    execCommandMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", { value: execCommandMock, configurable: true, writable: true });
  });
  afterEach(() => {
    Object.defineProperty(document, "execCommand", { value: undefined, configurable: true, writable: true });
    window.getSelection()?.removeAllRanges();
  });

  it("bold / italic toolbar buttons run the matching execCommand", () => {
    renderModal({ value: baseValue({ format: "richText" }) });
    fireEvent.click(screen.getByTestId("rte-bold"));
    expect(execCommandMock).toHaveBeenCalledWith("bold", false, undefined);
    fireEvent.click(screen.getByTestId("rte-italic"));
    expect(execCommandMock).toHaveBeenCalledWith("italic", false, undefined);
  });

  it("typing into the RTE area feeds the draft text emitted on save", () => {
    const { onSave } = renderModal({ value: baseValue({ format: "richText" }) });
    const area = screen.getByTestId("feedback-editor-rte-area");
    area.innerHTML = "<b>bold</b>";
    fireEvent.input(area);
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ text: "<b>bold</b>" }));
  });

  it("wraps an existing selection via createLink on submit", () => {
    renderModal({ value: baseValue({ format: "richText" }) });
    const area = screen.getByTestId("feedback-editor-rte-area");
    area.innerHTML = "hello";
    const range = document.createRange();
    range.selectNodeContents(area);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    fireEvent.click(screen.getByTestId("rte-link"));
    fireEvent.change(screen.getByTestId("rte-link-url"), { target: { value: "https://a.b" } });
    fireEvent.click(screen.getByTestId("rte-link-submit"));

    expect(execCommandMock).toHaveBeenCalledWith("createLink", false, "https://a.b");
    // Modal closed after submit.
    expect(screen.queryByTestId("rte-link-url")).not.toBeInTheDocument();
  });

  it("inserts an <a> at a collapsed caret on submit", () => {
    renderModal({ value: baseValue({ format: "richText" }) });
    const area = screen.getByTestId("feedback-editor-rte-area");
    area.innerHTML = "abc";
    const range = document.createRange();
    range.setStart(area.firstChild!, 1);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    fireEvent.click(screen.getByTestId("rte-link"));
    fireEvent.change(screen.getByTestId("rte-link-url"), { target: { value: "https://x.y" } });
    fireEvent.change(screen.getByTestId("rte-link-text"), { target: { value: "Link" } });
    fireEvent.click(screen.getByTestId("rte-link-submit"));

    const a = area.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://x.y");
    expect(a?.textContent).toBe("Link");
  });

  it("appends the link to the editor when there was no selection", () => {
    renderModal({ value: baseValue({ format: "richText" }) });
    const area = screen.getByTestId("feedback-editor-rte-area");
    window.getSelection()?.removeAllRanges();

    fireEvent.click(screen.getByTestId("rte-link"));
    fireEvent.change(screen.getByTestId("rte-link-url"), { target: { value: "https://z.z" } });
    fireEvent.click(screen.getByTestId("rte-link-submit"));

    // Empty display text → the URL is used as the link text.
    const a = area.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://z.z");
    expect(a?.textContent).toBe("https://z.z");
  });

  it("initializes the RTE area with the incoming text on open", () => {
    renderModal({ value: baseValue({ format: "richText", text: "<p>привет</p>" }) });
    expect(screen.getByTestId("feedback-editor-rte-area").innerHTML).toContain("привет");
  });
});

// ─── Field editing → emitted value ─────────────────────────────────────────────

describe("<FeedbackEditorModal /> — field editing", () => {
  it("edits a link title + url and emits them", () => {
    const { onSave } = renderModal({ value: baseValue({ links: [{ title: "", url: "" }] }) });
    fireEvent.change(screen.getByTestId("feedback-editor-link-title-0"), { target: { value: "Курс 1" } });
    fireEvent.change(screen.getByTestId("feedback-editor-link-url-0"), { target: { value: "https://c.1" } });
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ links: [{ title: "Курс 1", url: "https://c.1" }] }),
    );
  });

  it("edits an event title + url and emits them", () => {
    const { onSave } = renderModal({ value: baseValue({ events: [{ title: "", url: "" }] }) });
    fireEvent.change(screen.getByTestId("feedback-editor-event-title-0"), { target: { value: "Митап" } });
    fireEvent.change(screen.getByTestId("feedback-editor-event-url-0"), { target: { value: "https://m" } });
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ events: [{ title: "Митап", url: "https://m" }] }),
    );
  });

  it("edits an asset title and emits it (UI-only fields stripped)", () => {
    const { onSave } = renderModal({
      value: baseValue({ assets: [{ title: "Old", fileName: "d.pdf", mimeType: "application/pdf" }] }),
    });
    fireEvent.change(screen.getByTestId("feedback-editor-asset-title-0"), { target: { value: "New" } });
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ assets: [expect.objectContaining({ title: "New", fileName: "d.pdf" })] }),
    );
  });
});

// ─── File-size rendering + mixed oversize ──────────────────────────────────────

describe("<FeedbackEditorModal /> — asset sizes", () => {
  // PRD-32: a picked file now goes to the media library at once, so the upload path needs a
  // server answer before any asset row can appear.
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "a", url: "/api/media/a", mime: "application/pdf", size: 1 }),
    }) as unknown as typeof fetch;
  });

  function fileOfSize(name: string, size: number): File {
    const f = new File(["x"], name, { type: "application/pdf" });
    Object.defineProperty(f, "size", { value: size, configurable: true });
    return f;
  }

  it("renders human-readable sizes (B / KB / MB)", async () => {
    renderModal();
    const input = screen.getByTestId("feedback-editor-asset-input") as HTMLInputElement;
    await userEvent.upload(input, [
      fileOfSize("s.pdf", 500),
      fileOfSize("k.pdf", 250 * 1024),
      fileOfSize("m.pdf", 2 * 1024 * 1024),
    ]);
    await waitFor(() => expect(screen.getByText(/500 B/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/250\.0 KB/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/2\.0 MB/)).toBeInTheDocument());
  });

  it("adds valid files and warns only about the oversize ones (mixed pick)", async () => {
    renderModal();
    const input = screen.getByTestId("feedback-editor-asset-input") as HTMLInputElement;
    await userEvent.upload(input, [fileOfSize("ok.pdf", 1024), fileOfSize("big.pdf", 6 * 1024 * 1024)]);

    const banner = await screen.findByTestId("feedback-editor-oversize-banner");
    expect(banner.textContent).toContain("big.pdf");
    expect(banner.textContent).not.toContain("ok.pdf");
    expect(await screen.findByTestId("feedback-editor-asset-title-0")).toBeInTheDocument();
  });
});

// ─── Misc props / lifecycle ────────────────────────────────────────────────────

describe("<FeedbackEditorModal /> — misc", () => {
  it("renders the description subtitle", () => {
    renderModal({ description: "Подсказка для автора" });
    expect(screen.getByText("Подсказка для автора")).toBeInTheDocument();
  });

  it("resets the draft when a new value prop is supplied", () => {
    const { rerender } = render(
      <FeedbackEditorModal open title="T" value={baseValue({ text: "A" })} onCancel={vi.fn()} onSave={vi.fn()} />,
    );
    expect((screen.getByTestId("feedback-editor-text") as HTMLTextAreaElement).value).toBe("A");
    rerender(
      <FeedbackEditorModal open title="T" value={baseValue({ text: "B" })} onCancel={vi.fn()} onSave={vi.fn()} />,
    );
    expect((screen.getByTestId("feedback-editor-text") as HTMLTextAreaElement).value).toBe("B");
  });
});
