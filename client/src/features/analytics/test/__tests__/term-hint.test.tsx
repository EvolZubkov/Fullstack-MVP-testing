/**
 * @module features/analytics/test/__tests__/term-hint.test
 * @description The term's hint icon (PRD-66 FR-14b): a lucide-react `Info`
 * component — never a hand-drawn glyph (owner's rule 2026-09-28) — kept in one
 * no-wrap block with the term's last word, so a narrow column cannot tear it off.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TermHint } from "../term-hint";

describe("TermHint", () => {
  it("glues the lucide Info icon to the last word", () => {
    const { container } = render(<TermHint entry="latency" />);
    const term = container.querySelector(".tb-term-hint__term")!;
    const tail = term.querySelector(".tb-term-hint__tail")!;

    expect(term.textContent).toBe("Время, медиана");
    expect(tail.textContent).toBe("медиана");
    expect(tail.querySelector("svg.lucide-info")).not.toBeNull();
  });

  it("keeps a one-word term whole, with the icon", () => {
    const { container } = render(<TermHint entry="scaleContribution" />);
    const tail = container.querySelector(".tb-term-hint__tail")!;
    expect(tail.textContent).toBe("Вклад");
    expect(tail.querySelector("svg.lucide-info")).not.toBeNull();
  });

  it("wraps a non-text term together with the icon", () => {
    const { container } = render(<TermHint entry="observations" term={<b>n</b>} />);
    const tail = container.querySelector(".tb-term-hint__tail")!;
    expect(tail.querySelector("b")?.textContent).toBe("n");
    expect(tail.querySelector("svg.lucide-info")).not.toBeNull();
  });

  it("takes the hint from the analytics glossary (Э4а)", async () => {
    const { GLOSSARY } = await import("../../glossary");
    const { container } = render(<TermHint entry="difficulty" />);
    expect(container.querySelector(".tb-term-hint__term")?.textContent).toBe(GLOSSARY.difficulty.term);
    expect(container.textContent).toContain(GLOSSARY.difficulty.hint);
  });
});
