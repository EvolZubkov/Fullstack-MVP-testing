/**
 * @module components/__tests__/truncated-label.test
 * @description A one-line cell reveals its full text on hover ONLY when it is
 * actually clipped: a permanent `title` on a fully visible label repeats what the
 * user already reads and pops up over the row for no reason.
 */
import { describe, expect, it, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TruncatedLabel } from "../truncated-label";

/** jsdom computes no layout — drive the two widths the component measures. */
function stubWidths(scroll: number, client: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, value: scroll });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: client });
}

afterEach(() => {
  for (const prop of ["scrollWidth", "clientWidth"]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value: 0 });
  }
});

const LONG = "Вы — руководитель одного из HR-подразделений, в вашем подчинении команда опытных проектных менеджеров";

describe("TruncatedLabel", () => {
  it("reveals the full text when the label is clipped", () => {
    stubWidths(900, 400);
    render(<TruncatedLabel text={LONG} className="ct-name__label" />);
    expect(screen.getByText(LONG)).toHaveAttribute("title", LONG);
  });

  it("adds no tooltip when the text fits", () => {
    stubWidths(320, 400);
    render(<TruncatedLabel text="Короткий вопрос" />);
    expect(screen.getByText("Короткий вопрос")).not.toHaveAttribute("title");
  });

  it("treats a sub-pixel overflow as fitting", () => {
    stubWidths(401, 400);
    render(<TruncatedLabel text="Ровно по ширине" />);
    expect(screen.getByText("Ровно по ширине")).not.toHaveAttribute("title");
  });

  it("keeps the caller's class so the cell still clamps to one line", () => {
    stubWidths(900, 400);
    render(<TruncatedLabel text={LONG} className="ct-name__label" />);
    expect(screen.getByText(LONG)).toHaveClass("ct-name__label");
  });
});
