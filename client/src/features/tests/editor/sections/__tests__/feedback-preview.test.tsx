/**
 * @module features/tests/editor/sections/__tests__/feedback-preview.test
 * @description Tests for the shared FeedbackPreview (TD-02): grouped reference
 * lists (Материалы / Курсы / Мероприятия) with real links, pencil edit trigger,
 * and the click-to-edit empty placeholder.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FeedbackPreview } from "../feedback-preview";

function renderPreview(props: Partial<Parameters<typeof FeedbackPreview>[0]> = {}) {
  const onEdit = vi.fn();
  render(
    <FeedbackPreview
      format="plain"
      text="Поздравляем!"
      links={[]}
      assets={[]}
      events={[]}
      onEdit={onEdit}
      testId="fb"
      {...props}
    />,
  );
  return { onEdit };
}

describe("<FeedbackPreview /> (TD-02)", () => {
  it("renders grouped lists for documents, courses and events", () => {
    renderPreview({
      assets: [{ title: "Памятка", fileName: "memo.pdf", mimeType: "application/pdf", scormHref: "assets/memo.pdf" }],
      links: [{ title: "Базовый курс", url: "https://e.com/course" }],
      events: [{ title: "Вебинар", url: "https://e.com/webinar" }],
    });
    expect(screen.getByText("Материалы")).toBeInTheDocument();
    expect(screen.getByText("Курсы")).toBeInTheDocument();
    expect(screen.getByText("Мероприятия")).toBeInTheDocument();
    // Course/event titles are real links.
    expect(screen.getByRole("link", { name: "Базовый курс" })).toHaveAttribute("href", "https://e.com/course");
    expect(screen.getByRole("link", { name: "Вебинар" })).toHaveAttribute("href", "https://e.com/webinar");
    // Document title is a download link.
    const doc = screen.getByRole("link", { name: "Памятка" });
    expect(doc).toHaveAttribute("href", "assets/memo.pdf");
    expect(doc).toHaveAttribute("download");
  });

  // PRD-32: the address of an attachment belongs in `url`; the preview used to read only
  // the legacy `scormHref` and so showed newly uploaded files without a link.
  it("links a document by its canonical `url`", () => {
    renderPreview({
      assets: [
        {
          title: "Памятка",
          fileName: "memo.pdf",
          mimeType: "application/pdf",
          url: "/api/media/11111111-1111-1111-1111-111111111111",
        },
      ],
    });
    const doc = screen.getByRole("link", { name: "Памятка" });
    expect(doc).toHaveAttribute("href", "/api/media/11111111-1111-1111-1111-111111111111");
    expect(doc).toHaveAttribute("download");
  });

  it("renders an event without a URL as plain text (no link)", () => {
    renderPreview({ text: "", events: [{ title: "Очная встреча" }] });
    expect(screen.getByText("Очная встреча")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Очная встреча" })).not.toBeInTheDocument();
  });

  it("hides empty groups", () => {
    renderPreview({ links: [{ title: "Курс", url: "https://e.com" }] });
    expect(screen.getByText("Курсы")).toBeInTheDocument();
    expect(screen.queryByText("Материалы")).not.toBeInTheDocument();
    expect(screen.queryByText("Мероприятия")).not.toBeInTheDocument();
  });

  it("opens the editor via the pencil button, not the card", () => {
    const { onEdit } = renderPreview({ links: [{ title: "Курс", url: "https://e.com" }] });
    fireEvent.click(screen.getByTestId("fb-edit"));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("empty state is a click-to-edit placeholder", () => {
    const { onEdit } = renderPreview({ text: "", links: [], assets: [], events: [] });
    fireEvent.click(screen.getByTestId("fb"));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
