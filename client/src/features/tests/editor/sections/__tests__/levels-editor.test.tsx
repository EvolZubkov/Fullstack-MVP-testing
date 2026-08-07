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
import type { ScaleBandModel } from "../../test-editor.types";

function band(min: string, max: string, level: string, label = ""): ScaleBandModel {
  return { clientKey: `b-${level}`, min, max, label, level, text: "", tone: "" };
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

  it("hides every control in read-only mode", () => {
    render(<LevelsEditor bands={THREE} index={0} readOnly domain={null} onChange={vi.fn()} />);
    expect(screen.queryByTestId("scales-level-add-0")).toBeNull();
    expect(screen.queryByLabelText("Удалить уровень 1")).toBeNull();
    expect((screen.getByLabelText("Начало") as HTMLInputElement).disabled).toBe(true);
  });
});
