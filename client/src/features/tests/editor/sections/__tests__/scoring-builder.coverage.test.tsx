/**
 * @module features/tests/editor/sections/__tests__/scoring-builder.coverage.test
 * @description Branch-coverage tests for the PRD-10 graded-scoring constructor
 * ({@link module:features/tests/editor/sections/scoring-builder}). The existing
 * suite only reaches this component indirectly through the «Оценка» modal, so it
 * left the per-type mode matrix (single→weighted, multiple/matching/ranking→
 * tiered), the tier/condition CRUD map helpers and the pure
 * parse/build/deriveSMax serializers largely uncovered. This file drives the
 * component through a stateful harness (the direct setters become React state) so
 * every mode, question type and CRUD path fires, and calls the exported pure
 * functions directly for their remaining edge branches.
 */
import type * as React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import {
  ScoringBuilder,
  deriveSMax,
  parseScoringJson,
  buildScoringJson,
  type ScoringMode,
  type TierDraft,
} from "../scoring-builder";

// ─── Harness ────────────────────────────────────────────────────────────────

type QuestionType = "single" | "multiple" | "matching" | "ranking";

/**
 * Stateful host: turns the controlled setters into local React state so button
 * clicks and input edits re-render exactly as they do under the question modal.
 */
function Harness({
  type,
  options = [],
  initialMode = "exact",
  initialWeights = [],
  initialTiers = [],
}: {
  type: QuestionType;
  options?: string[];
  initialMode?: ScoringMode;
  initialWeights?: string[];
  initialTiers?: TierDraft[];
}) {
  const [mode, setMode] = useState<ScoringMode>(initialMode);
  const [weights, setWeights] = useState<string[]>(initialWeights);
  const [tiers, setTiers] = useState<TierDraft[]>(initialTiers);
  return (
    <ScoringBuilder
      type={type}
      options={options}
      mode={mode}
      setMode={setMode}
      weights={weights}
      setWeights={setWeights}
      tiers={tiers}
      setTiers={setTiers}
    />
  );
}

/** Open a DS Select by its data-testid wrapper, then click the option by text. */
function pickSelectOption(testId: string, optionLabel: string | RegExp) {
  const wrap = screen.getByTestId(testId);
  fireEvent.click(within(wrap).getByRole("button"));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

function renderBuilder(ui: React.JSX.Element) {
  return render(ui);
}

// ─── Component: mode selector + exact hint ──────────────────────────────────

describe("<ScoringBuilder /> — mode selector & exact hint", () => {
  it("single exposes «Веса опций» and the exact hint points at it", () => {
    renderBuilder(<Harness type="single" options={["А", "Б"]} initialMode="exact" />);
    expect(screen.getByTestId("scoring-exact-hint")).toHaveTextContent("на «Веса опций»");
    // The segmented control offers the weighted mode for single-choice.
    expect(screen.getByRole("button", { name: "Веса опций" })).toBeInTheDocument();
    // sMax for exact is always 1.
    expect(screen.getByTestId("scoring-smax")).toHaveTextContent("sMax = 1");
  });

  it("multiple exposes «Ступенчато» and the exact hint points at it", () => {
    renderBuilder(<Harness type="multiple" initialMode="exact" />);
    expect(screen.getByTestId("scoring-exact-hint")).toHaveTextContent("на «Ступенчато»");
    expect(screen.getByRole("button", { name: "Ступенчато" })).toBeInTheDocument();
  });

  it("switches single from exact to weighted via the segmented control", async () => {
    renderBuilder(<Harness type="single" options={["А", "Б"]} initialMode="exact" />);
    fireEvent.click(screen.getByRole("button", { name: "Веса опций" }));
    await waitFor(() => expect(screen.getByTestId("scoring-weights")).toBeInTheDocument());
  });

  it("switches multiple from exact to tiered via the segmented control", async () => {
    renderBuilder(<Harness type="multiple" initialMode="exact" />);
    fireEvent.click(screen.getByRole("button", { name: "Ступенчато" }));
    await waitFor(() => expect(screen.getByTestId("scoring-tiers")).toBeInTheDocument());
  });
});

// ─── Component: weighted (single) ───────────────────────────────────────────

describe("<ScoringBuilder /> — weighted table (single)", () => {
  it("renders one row per option, falls back to «Вариант N» for blanks and computes sMax", () => {
    renderBuilder(
      <Harness type="single" options={["Первый", "", "Третий"]} initialMode="weighted" initialWeights={["3"]} />,
    );
    // Non-empty option keeps its label; the blank one falls back.
    const table = screen.getByTestId("scoring-weights");
    expect(table).toHaveTextContent("Первый");
    expect(table).toHaveTextContent("Вариант 2");
    // Weight present for index 0, empty for the rest.
    expect((screen.getByTestId("scoring-weight-0") as HTMLInputElement).value).toBe("3");
    expect((screen.getByTestId("scoring-weight-1") as HTMLInputElement).value).toBe("");
    // sMax = the largest weight.
    expect(screen.getByTestId("scoring-smax")).toHaveTextContent("sMax = 3");
  });

  it("editing a weight backfills missing entries with «0» and updates sMax", async () => {
    renderBuilder(
      <Harness type="single" options={["А", "Б", "В"]} initialMode="weighted" initialWeights={["4"]} />,
    );
    // Editing index 1 forces setWeight to map over every option: index 0 keeps
    // "4", indices 1/2 default to "0", then index 1 becomes "6".
    fireEvent.change(screen.getByTestId("scoring-weight-1"), { target: { value: "6" } });
    await waitFor(() =>
      expect((screen.getByTestId("scoring-weight-1") as HTMLInputElement).value).toBe("6"),
    );
    expect((screen.getByTestId("scoring-weight-2") as HTMLInputElement).value).toBe("0");
    expect(screen.getByTestId("scoring-smax")).toHaveTextContent("sMax = 6");
  });
});

// ─── Component: tiered constructor (multiple / matching / ranking) ───────────

describe("<ScoringBuilder /> — tiered constructor", () => {
  it("multiple labels the counter «верных» and uses token T", () => {
    renderBuilder(<Harness type="multiple" initialMode="tiered" />);
    const tiers = screen.getByTestId("scoring-tiers");
    expect(tiers).toHaveTextContent("всего верных");
  });

  it("matching labels the counter «пар» and the rhs placeholder uses token P", () => {
    renderBuilder(
      <Harness
        type="matching"
        initialMode="tiered"
        initialTiers={[{ conds: [{ lhs: "c", op: ">=", rhs: "1" }], score: "1" }]}
      />,
    );
    expect(screen.getByTestId("scoring-tiers")).toHaveTextContent("всего пар");
    expect(
      (screen.getByTestId("scoring-cond-rhs-0-0") as HTMLInputElement).placeholder,
    ).toBe("число или P");
  });

  it("ranking labels the counter «элементов» and the rhs placeholder uses token N", () => {
    renderBuilder(
      <Harness
        type="ranking"
        initialMode="tiered"
        initialTiers={[{ conds: [{ lhs: "c", op: ">=", rhs: "1" }], score: "1" }]}
      />,
    );
    expect(screen.getByTestId("scoring-tiers")).toHaveTextContent("всего элементов");
    expect(
      (screen.getByTestId("scoring-cond-rhs-0-0") as HTMLInputElement).placeholder,
    ).toBe("число или N");
  });

  it("adds tiers/conditions, edits every field and removes rows (full CRUD)", async () => {
    renderBuilder(<Harness type="multiple" initialMode="tiered" initialTiers={[]} />);

    // Empty → «Добавить строку» seeds the first tier with one condition.
    fireEvent.click(screen.getByTestId("scoring-add-tier"));
    expect(await screen.findByTestId("scoring-tier-0")).toBeInTheDocument();

    // A single condition shows no remove-condition affordance yet.
    expect(
      within(screen.getByTestId("scoring-tier-0")).queryByLabelText("Удалить условие"),
    ).toBeNull();

    // «И условие» appends a second condition → remove buttons appear.
    fireEvent.click(screen.getByTestId("scoring-add-cond-0"));
    await waitFor(() =>
      expect(screen.getByTestId("scoring-cond-rhs-0-1")).toBeInTheDocument(),
    );
    expect(
      within(screen.getByTestId("scoring-tier-0")).getAllByLabelText("Удалить условие").length,
    ).toBeGreaterThanOrEqual(2);

    // Edit the first condition's lhs (c → x) and the second condition's operator.
    pickSelectOption("scoring-cond-lhs-0-0", "Лишних (x)");
    pickSelectOption("scoring-cond-op-0-1", "=");
    fireEvent.change(screen.getByTestId("scoring-cond-rhs-0-1"), { target: { value: "T" } });
    fireEvent.change(screen.getByTestId("scoring-tier-score-0"), { target: { value: "2" } });

    // A second tier exercises the outer `i === ti` map paths (edit tier index 1).
    fireEvent.click(screen.getByTestId("scoring-add-tier"));
    expect(await screen.findByTestId("scoring-tier-1")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("scoring-tier-score-1"), { target: { value: "5" } });
    fireEvent.change(screen.getByTestId("scoring-cond-rhs-1-0"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("scoring-add-cond-1"));
    await waitFor(() =>
      expect(screen.getByTestId("scoring-cond-rhs-1-1")).toBeInTheDocument(),
    );

    // sMax follows the largest tier score.
    expect(screen.getByTestId("scoring-smax")).toHaveTextContent("sMax = 5");

    // Remove the extra condition in tier 0, then remove tier 0 entirely.
    fireEvent.click(
      within(screen.getByTestId("scoring-tier-0")).getAllByLabelText("Удалить условие")[0],
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId("scoring-tier-0")).queryByTestId("scoring-cond-rhs-0-1"),
      ).toBeNull(),
    );
    fireEvent.click(
      within(screen.getByTestId("scoring-tier-0")).getByLabelText("Удалить строку"),
    );
    // One tier remains (the former tier 1 slides to index 0).
    await waitFor(() =>
      expect(screen.queryByTestId("scoring-tier-1")).toBeNull(),
    );
  });
});

// ─── Pure helpers: deriveSMax ───────────────────────────────────────────────

describe("deriveSMax()", () => {
  it("exact is always 1", () => {
    expect(deriveSMax("exact", [], [])).toBe(1);
  });

  it("weighted is the max weight and treats non-numeric weights as 0", () => {
    expect(deriveSMax("weighted", ["2", "5", "нет"], [])).toBe(5);
  });

  it("tiered is the max tier score", () => {
    expect(
      deriveSMax("tiered", [], [
        { conds: [], score: "3" },
        { conds: [], score: "7" },
      ]),
    ).toBe(7);
  });
});

// ─── Pure helpers: parseScoringJson ─────────────────────────────────────────

describe("parseScoringJson()", () => {
  it("null / unknown kind → exact with empty weights and tiers", () => {
    expect(parseScoringJson(null)).toEqual({ mode: "exact", weights: [], tiers: [] });
    expect(parseScoringJson({ kind: "unknown" })).toEqual({ mode: "exact", weights: [], tiers: [] });
  });

  it("weighted with a weights array is stringified", () => {
    expect(parseScoringJson({ kind: "weighted", weights: [1, 2, 3] })).toEqual({
      mode: "weighted",
      weights: ["1", "2", "3"],
      tiers: [],
    });
  });

  it("weighted without a weights array yields empty weights", () => {
    expect(parseScoringJson({ kind: "weighted" })).toEqual({
      mode: "weighted",
      weights: [],
      tiers: [],
    });
  });

  it("tiered maps when/all conditions and defaults a missing score to 0", () => {
    const parsed = parseScoringJson({
      kind: "tiered",
      tiers: [
        { when: { all: [{ lhs: "c", op: ">=", rhs: 2 }] }, score: 3 },
        { score: undefined },
      ],
    });
    expect(parsed.mode).toBe("tiered");
    expect(parsed.tiers[0]).toEqual({ conds: [{ lhs: "c", op: ">=", rhs: "2" }], score: "3" });
    // Missing `when` → empty conds; missing score → "0".
    expect(parsed.tiers[1]).toEqual({ conds: [], score: "0" });
  });

  it("tiered without a tiers array yields empty tiers", () => {
    expect(parseScoringJson({ kind: "tiered" }).tiers).toEqual([]);
  });
});

// ─── Pure helpers: buildScoringJson ─────────────────────────────────────────

describe("buildScoringJson()", () => {
  it("weighted (single) emits numeric weights, backfilling gaps with 0", () => {
    expect(buildScoringJson("single", ["А", "Б", "В"], "weighted", ["2", "3"], [])).toEqual({
      kind: "weighted",
      weights: [2, 3, 0],
    });
  });

  it("weighted for a non-single type falls through to null (exact)", () => {
    expect(buildScoringJson("multiple", [], "weighted", ["2"], [])).toBeNull();
  });

  it("tiered (non-single) keeps token rhs (T/P/N) and coerces numeric rhs", () => {
    const built = buildScoringJson("matching", [], "tiered", [], [
      { conds: [{ lhs: "c", op: ">=", rhs: "P" }], score: "2" },
      { conds: [{ lhs: "x", op: "==", rhs: "0" }], score: "1" },
    ]) as { kind: string; tiers: Array<{ when: { all: unknown[] }; score: number }> };
    expect(built.kind).toBe("tiered");
    expect(built.tiers[0].when.all).toEqual([{ lhs: "c", op: ">=", rhs: "P" }]);
    expect(built.tiers[1].when.all).toEqual([{ lhs: "x", op: "==", rhs: 0 }]);
    expect(built.tiers[0].score).toBe(2);
  });

  it("tiered with only empty-condition rows collapses to null", () => {
    expect(buildScoringJson("multiple", [], "tiered", [], [{ conds: [], score: "1" }])).toBeNull();
  });

  it("exact mode always returns null", () => {
    expect(buildScoringJson("single", ["А"], "exact", [], [])).toBeNull();
  });
});
