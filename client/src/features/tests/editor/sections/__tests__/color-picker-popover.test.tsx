/**
 * @module features/tests/editor/sections/__tests__/color-picker-popover
 * @description PRD-22 (plan Э7): the DS `ColorPicker` opens its palette through
 * the shared `Popover` — portalled to the document body and dismissible — instead
 * of an inline `position: absolute` layer that drifted from its button and was
 * clipped by the form. The ui-kit lives outside the vitest include globs, so this
 * consumer-side test is where its behaviour is locked.
 */
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { ColorPicker } from "@universityrt/ui-kit";

afterEach(cleanup);

function Harness() {
  const [value, setValue] = useState("#7700FF");
  return (
    <div data-testid="host" style={{ overflow: "hidden", width: 40 }}>
      <ColorPicker value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </div>
  );
}

describe("ColorPicker over the shared Popover", () => {
  it("opens the palette in a portal, outside the (clipping) host", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /выбрать цвет|#7700FF/i }));

    const dialog = screen.getByRole("dialog", { name: "Выбор цвета" });
    expect(dialog).toBeInTheDocument();
    // Portalled to the body — NOT nested in the overflow:hidden host that would
    // otherwise clip it.
    expect(screen.getByTestId("host").contains(dialog)).toBe(false);
  });

  it("applies a chosen swatch and closes", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /выбрать цвет|#7700FF/i }));

    fireEvent.click(screen.getByTitle("#29CCA3"));
    fireEvent.click(screen.getByRole("button", { name: "Применить" }));

    expect(screen.getByTestId("value")).toHaveTextContent("#29CCA3");
    expect(screen.queryByRole("dialog", { name: "Выбор цвета" })).toBeNull();
  });

  it("dismisses on outside click without changing the value", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /выбрать цвет|#7700FF/i }));
    fireEvent.click(screen.getByTitle("#29CCA3"));

    // Outside pointer-down closes the palette; the draft is discarded, not applied.
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Выбор цвета" })).toBeNull();
    expect(screen.getByTestId("value")).toHaveTextContent("#7700FF");
  });
});
