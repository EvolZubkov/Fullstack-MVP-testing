/**
 * @module features/tests/editor/sections/__tests__/levels-editor
 * @description PRD-45. The levels editor is stateless: it derives its draft from
 * `bands` and folds every edit back. These tests drive it exactly the way the
 * author does — through the visible fields — and assert on the bands it emits.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { LevelsEditor } from "../levels-editor";
import type { FeedbackEditorValue } from "../feedback-editor-modal";
import type { ScaleBandModel } from "../../test-editor.types";

function band(min: string, max: string, level: string, label = ""): ScaleBandModel {
  return { clientKey: `b-${level}`, min, max, label, level, text: "", tone: "" };
}

/** A feedback value with only the parts a test cares about filled in. */
function fb(p: Partial<FeedbackEditorValue>): FeedbackEditorValue {
  return { format: "plain", text: "", links: [], assets: [], events: [], ...p };
}

const THREE = [band("0", "15", "low", "Слабо"), band("15", "29", "mid", "Средне"), band("29", "98", "high", "Ярко")];

/** Stateful host: the component is controlled, so the test owns the bands. */
function Host({ initial, onBands }: { initial: ScaleBandModel[]; onBands?: (b: ScaleBandModel[]) => void }) {
  const [bands, setBands] = useState(initial);
  return (
    <LevelsEditor
      bands={bands}
      index={0}
      readOnly={false}
      domain={{ min: 0, max: 98 }}
      onChange={(next) => {
        setBands(next);
        onBands?.(next);
      }}
    />
  );
}

describe("LevelsEditor", () => {
  it("shows one start, one end and N-1 cuts — not a min/max pair per level", () => {
    render(<Host initial={THREE} />);
    expect((screen.getByLabelText("Начало") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("Конец") as HTMLInputElement).value).toBe("98");
    expect((screen.getByLabelText("Порог между уровнями 1 и 2") as HTMLInputElement).value).toBe("15");
    expect((screen.getByLabelText("Порог между уровнями 2 и 3") as HTMLInputElement).value).toBe("29");
    expect(screen.queryByLabelText(/^min /)).toBeNull();
    expect(screen.queryByLabelText(/^max /)).toBeNull();
  });

  it("writes an edited cut into both neighbouring bands", () => {
    const onBands = vi.fn();
    render(<Host initial={THREE} onBands={onBands} />);
    fireEvent.change(screen.getByLabelText("Порог между уровнями 1 и 2"), { target: { value: "20" } });
    const emitted = onBands.mock.calls[0][0] as ScaleBandModel[];
    expect([emitted[0].max, emitted[1].min]).toEqual(["20", "20"]);
  });

  it("labels every field next to itself, with no table header", () => {
    const { container } = render(<Host initial={THREE} />);
    expect(container.querySelector("table")).toBeNull();
    expect(screen.getAllByLabelText("Название уровня 1")).toHaveLength(1);
    expect(screen.getAllByLabelText("Код уровня 1")).toHaveLength(1);
  });

  it("shows the computed range in each card header", () => {
    render(<Host initial={THREE} />);
    expect(screen.getByTestId("scales-level-range-0-0")).toHaveTextContent("0 … 15");
    expect(screen.getByTestId("scales-level-range-0-2")).toHaveTextContent("29 … 98");
  });

  it("draws one ribbon stripe per level", () => {
    render(<Host initial={THREE} />);
    expect(screen.getAllByTestId(/^scales-level-seg-0-/)).toHaveLength(3);
  });

  it("carries the full level name in the stripe title, so a clipped caption stays readable", () => {
    render(<Host initial={THREE} />);
    // The stripe ellipses its caption once the level's span is narrow (see
    // `.tb-levels__seglbl`); jsdom lays nothing out, so the tooltip is what a test
    // can hold on to — and the tooltip is the only way back to the full name.
    expect(screen.getByTestId("scales-level-seg-0-0")).toHaveAttribute("title", "Слабо");
    expect(screen.getByTestId("scales-level-seg-0-2")).toHaveAttribute("title", "Ярко");
  });

  it("adds a level by halving the last one", () => {
    const onBands = vi.fn();
    render(<Host initial={[band("0", "98", "only")]} onBands={onBands} />);
    fireEvent.click(screen.getByTestId("scales-level-add-0"));
    const emitted = onBands.mock.calls[0][0] as ScaleBandModel[];
    expect(emitted.map((b) => [b.min, b.max])).toEqual([["0", "49"], ["49", "98"]]);
  });

  it("removes a level and closes the gap it left", () => {
    const onBands = vi.fn();
    render(<Host initial={THREE} onBands={onBands} />);
    fireEvent.click(screen.getByLabelText("Удалить уровень 2"));
    const emitted = onBands.mock.calls[0][0] as ScaleBandModel[];
    expect(emitted.map((b) => [b.min, b.max])).toEqual([["0", "29"], ["29", "98"]]);
  });

  it("offers the empty state instead of an empty table", () => {
    render(<Host initial={[]} />);
    expect(screen.getByTestId("scales-levels-empty-0")).toHaveTextContent("обучающийся увидит только числовой балл");
  });

  it("opens the interpretation fold when the level already has text", () => {
    const filled = [{ ...band("0", "98", "only", "Ярко"), text: "Проявляется устойчиво" }];
    render(<Host initial={filled} />);
    expect(screen.getByText("Толкование для обучающегося").closest("button"))
      .toHaveAttribute("aria-expanded", "true");
  });

  it("keeps the interpretation fold shut when the level has no text", () => {
    render(<Host initial={[band("0", "98", "only", "Ярко")]} />);
    expect(screen.getByText("Толкование для обучающегося").closest("button"))
      .toHaveAttribute("aria-expanded", "false");
  });

  it("blocks with a banner when the row stops ascending", () => {
    render(<Host initial={[band("0", "42", "a"), band("42", "29", "b")]} />);
    expect(screen.getByTestId("scales-levels-error-0")).toHaveTextContent("по возрастанию");
  });

  it("warns when the domain is wider than the levels cover", () => {
    render(
      <LevelsEditor
        bands={[band("10", "69", "only")]}
        index={0}
        readOnly={false}
        domain={{ min: 0, max: 98 }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("scales-levels-uncovered-0")).toBeInTheDocument();
    expect(screen.getAllByText("не разобрано")).toHaveLength(2);
  });

  it("notices that a legacy gap has been closed", () => {
    render(<Host initial={[band("0", "15", "low"), band("16", "29", "mid")]} />);
    expect(screen.getByTestId("scales-levels-closed-gap-0")).toHaveTextContent("сомкнуты");
  });

  it("shows the coverage status under the ribbon", () => {
    render(<Host initial={THREE} />);
    expect(screen.getByText("Шкала разобрана целиком, 3 уровня")).toBeInTheDocument();
  });

  it("keeps focus and caret in the field being typed into", () => {
    render(<Host initial={THREE} />);
    const cut = screen.getByLabelText("Порог между уровнями 1 и 2") as HTMLInputElement;
    cut.focus();
    fireEvent.change(cut, { target: { value: "1," } });
    const after = screen.getByLabelText("Порог между уровнями 1 и 2") as HTMLInputElement;
    expect(document.activeElement).toBe(after);
    expect(after.value).toBe("1,");
  });

  it("blames the ORDER, not completeness, when every boundary is a number", () => {
    render(<Host initial={[band("0", "42", "a"), band("42", "29", "b")]} />);
    const ribbon = screen.getByTestId("scales-levels-noribbon-0");
    expect(ribbon).toHaveTextContent("Порядок границ нарушен");
    expect(ribbon).not.toHaveTextContent("не полностью");
  });

  it("blames completeness when a boundary is not a number", () => {
    render(<Host initial={[band("0", "42", "a"), band("42", "", "b")]} />);
    const ribbon = screen.getByTestId("scales-levels-noribbon-0");
    expect(ribbon).toHaveTextContent("Границы заданы не полностью");
    expect(ribbon).not.toHaveTextContent("Порядок");
  });

  it("puts the ordering message under the offending field", () => {
    render(<Host initial={[band("0", "42", "a"), band("42", "29", "b")]} />);
    expect(screen.getByText("Меньше предыдущего порога 42")).toBeInTheDocument();
  });

  it("does not rewrite a legacy gap until the author edits something", () => {
    const onBands = vi.fn();
    render(<Host initial={[band("0", "15", "low"), band("16", "29", "mid")]} onBands={onBands} />);
    expect(onBands).not.toHaveBeenCalled();
  });

  it("summarises recommendations as text plus a counted material", () => {
    const withText = [{ ...band("0", "98", "only"), feedback: fb({ text: "Читайте" }) }];
    render(<Host initial={withText} />);
    expect(screen.getByText("Рекомендации").closest("button")).toHaveTextContent("текст");
  });

  it("counts courses, files and events together in the recommendations badge", () => {
    const rich = [
      {
        ...band("0", "98", "only"),
        feedback: fb({ text: "Читайте", links: [{ title: "к", url: "u" }], events: [{ title: "с" }] }),
      },
    ];
    render(<Host initial={rich} />);
    expect(screen.getByText("Рекомендации").closest("button")).toHaveTextContent("текст, 2 материала");
  });

  it("hides every control in read-only mode", () => {
    render(<LevelsEditor bands={THREE} index={0} readOnly domain={null} onChange={vi.fn()} />);
    expect(screen.queryByTestId("scales-level-add-0")).toBeNull();
    expect(screen.queryByLabelText("Удалить уровень 1")).toBeNull();
    expect((screen.getByLabelText("Начало") as HTMLInputElement).disabled).toBe(true);
  });
});
