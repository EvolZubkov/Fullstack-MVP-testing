/**
 * @module features/tests/editor/sections/__tests__/tone-chips
 * @description PRD-45. The tone row replaces a Select that wrapped to three lines
 * in a 120px column. The list must stay the SAME closed list as TONE_OPTIONS.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TONE_OPTIONS } from "../outcomes-editor";
import { TONE_CHIPS, ToneChips } from "../tone-chips";

describe("ToneChips", () => {
  it("covers exactly the tones TONE_OPTIONS declares", () => {
    expect(TONE_CHIPS.map((c) => c.value)).toEqual(TONE_OPTIONS.map((o) => o.value));
  });

  it("shortens only the empty tone's wording", () => {
    expect(TONE_CHIPS[0].label).toBe("Авто");
    expect(TONE_CHIPS.slice(1).map((c) => c.label)).toEqual(TONE_OPTIONS.slice(1).map((o) => o.label));
  });

  it("reports the picked tone", () => {
    const onChange = vi.fn();
    render(<ToneChips value="" ariaLabel="оценка" onChange={onChange} />);
    fireEvent.click(screen.getByText("Внимание"));
    expect(onChange).toHaveBeenCalledWith("attention");
  });

  it("reports the empty tone for «Авто», not the sentinel", () => {
    const onChange = vi.fn();
    render(<ToneChips value="critical" ariaLabel="оценка" onChange={onChange} />);
    fireEvent.click(screen.getByText("Авто"));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("does not report a change while disabled", () => {
    const onChange = vi.fn();
    render(<ToneChips value="" ariaLabel="оценка" disabled onChange={onChange} />);
    fireEvent.click(screen.getByText("Внимание"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("exposes the test id it was given", () => {
    render(<ToneChips value="" ariaLabel="оценка" testId="scales-level-tone-0-1" onChange={vi.fn()} />);
    expect(screen.getByTestId("scales-level-tone-0-1")).toBeInTheDocument();
  });
});
