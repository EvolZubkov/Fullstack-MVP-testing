/**
 * @module features/tests/editor/sections/__tests__/paste-presentation-field
 *
 * A paste into the formatted mode of a content field loses the source's colours and fonts
 * (`transformPaste`), while the same colours written on purpose in HTML mode survive:
 * the transform runs over the pasted fragment only, never over the whole value.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RichTextEditor } from "@skillum/ui-kit";
import { sanitizeHtml as sanitizeContentHtml } from "@shared/security/html-sanitize";
import { stripPastedPresentation } from "../rte-paste";

/** Test double for the editing command jsdom lacks: inserts the fragment at the end. */
function stubInsertHtml(area: HTMLElement) {
  const exec = vi.fn((command: string, _ui?: boolean, value?: string) => {
    if (command === "insertHTML" && value) area.insertAdjacentHTML("beforeend", value);
    return true;
  });
  Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
  return exec;
}

function paste(area: HTMLElement, html: string) {
  fireEvent.paste(area, { clipboardData: { getData: (type: string) => (type === "text/html" ? html : "") } });
}

describe("вставка в форматированный режим поля контента", () => {
  it("теряет цвета и фон источника, но не трогает цвет, заданный автором", () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor
        value='<p style="color: red">Важно</p>'
        mode="rich"
        modes={["plain", "rich", "html"]}
        sanitize={(html) => sanitizeContentHtml(html)}
        transformPaste={stripPastedPresentation}
        onChange={onChange}
        data-testid="field"
      />,
    );
    const area = screen.getByTestId("field-area");
    const exec = stubInsertHtml(area);
    paste(area, '<div style="background-color: rgb(17, 21, 30); color: rgb(255, 255, 255)">Текст</div>');
    expect(exec).toHaveBeenCalledWith("insertHTML", false, "<div>Текст</div>");
    expect(onChange).toHaveBeenLastCalledWith('<p style="color: red">Важно</p><div>Текст</div>');
  });
});
