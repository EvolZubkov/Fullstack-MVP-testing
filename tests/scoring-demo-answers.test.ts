/**
 * @module tests/scoring-demo-answers
 * @description Unit tests for the demo-answer generator behind the «Предпросмотр
 * балла» modal (PRD-10 §7, issue #31; wireframe prd15-test-scoring.html s-preview).
 *
 * The author never types a hypothetical answer: the set is DERIVED from the
 * question's answer key, so every entry is guaranteed to be a well-formed answer
 * of the right shape for the type. The cases that a key cannot produce (an
 * «extra option» when every option is correct, «part of the correct ones» when
 * there is only one) are absent rather than present-and-broken.
 */
import { describe, it, expect } from "vitest";
import { buildDemoAnswers } from "../shared/scoring/demo-answers";
import { explainAnswer } from "../shared/scoring/engine";

const ids = (list: { id: string }[]) => list.map((d) => d.id);

// ─── multiple ────────────────────────────────────────────────────────────────

describe("buildDemoAnswers — multiple", () => {
  const options = ["Москва", "Тула", "Пермь", "Омск"];
  const correct = { correctIndices: [0, 1] };

  it("derives the full set from the key, in wireframe order", () => {
    const demos = buildDemoAnswers({ type: "multiple", correct, options });
    expect(ids(demos)).toEqual([
      "all-correct",
      "some-correct",
      "correct-plus-extra",
      "only-extra",
      "empty",
    ]);
    expect(demos.map((d) => d.answer)).toEqual([[0, 1], [0], [0, 1, 2], [2, 3], []]);
  });

  it("labels name the chosen options so the author sees the actual answer", () => {
    const demos = buildDemoAnswers({ type: "multiple", correct, options });
    expect(demos[0].label).toBe("Полностью верный (Москва, Тула)");
    expect(demos[1].label).toBe("Часть верных (Москва)");
    expect(demos[2].label).toBe("Все верные и лишний (Москва, Тула, Пермь)");
    expect(demos[3].label).toBe("Только лишние (Пермь, Омск)");
    expect(demos[4].label).toBe("Пустой ответ");
  });

  it("drops «часть верных» when the key holds a single correct option", () => {
    const demos = buildDemoAnswers({
      type: "multiple",
      correct: { correctIndices: [1] },
      options,
    });
    expect(ids(demos)).not.toContain("some-correct");
    expect(ids(demos)).toContain("correct-plus-extra");
  });

  it("drops the extra-option cases when every option is correct", () => {
    const demos = buildDemoAnswers({
      type: "multiple",
      correct: { correctIndices: [0, 1, 2, 3] },
      options,
    });
    expect(ids(demos)).toEqual(["all-correct", "some-correct", "empty"]);
  });

  it("never lists more than two extra options — the point is the tally, not the length", () => {
    const wide = ["А", "Б", "В", "Г", "Д", "Е"];
    const demos = buildDemoAnswers({
      type: "multiple",
      correct: { correctIndices: [0] },
      options: wide,
    });
    const onlyExtra = demos.find((d) => d.id === "only-extra");
    expect(onlyExtra?.answer).toEqual([1, 2]);
  });
});

// ─── single / scale ──────────────────────────────────────────────────────────

describe("buildDemoAnswers — single and scale", () => {
  const options = ["Да", "Скорее да", "Нет"];

  it("offers one demo per option — one per weight in the constructor", () => {
    const demos = buildDemoAnswers({
      type: "single",
      correct: { correctIndex: 2 },
      options,
    });
    expect(ids(demos)).toEqual(["option-0", "option-1", "option-2", "empty"]);
    expect(demos.map((d) => d.answer)).toEqual([0, 1, 2, null]);
  });

  it("marks which option the key calls correct", () => {
    const demos = buildDemoAnswers({
      type: "single",
      correct: { correctIndex: 2 },
      options,
    });
    expect(demos[2].label).toBe("Нет (верный)");
    expect(demos[0].label).toBe("Да");
  });

  it("a measurement-only scale has no correct option, so nothing is marked", () => {
    const demos = buildDemoAnswers({ type: "scale", correct: {}, options });
    expect(demos.every((d) => !d.label.includes("верный"))).toBe(true);
    expect(ids(demos)).toEqual(["option-0", "option-1", "option-2", "empty"]);
  });

  it("cuts a long option text — a label names two or three options at once", () => {
    const long = "Индикатор PON мигает или не горит, ONT не получает конфигурацию";
    const demos = buildDemoAnswers({
      type: "single",
      correct: { correctIndex: 0 },
      options: [long, "Б"],
    });
    expect(demos[0].label).toBe("Индикатор PON мигает или не гор… (верный)");
  });

  it("falls back to a positional name for an unnamed option", () => {
    const demos = buildDemoAnswers({
      type: "single",
      correct: { correctIndex: 0 },
      options: ["", "Б"],
    });
    expect(demos[0].label).toBe("Вариант 1 (верный)");
  });
});

// ─── matching ────────────────────────────────────────────────────────────────

describe("buildDemoAnswers — matching", () => {
  const correct = { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }, { left: 2, right: 2 }] };

  it("derives answers whose tallies walk the c/x range", () => {
    const demos = buildDemoAnswers({ type: "matching", correct });
    expect(ids(demos)).toEqual([
      "all-correct",
      "some-correct",
      "one-swapped",
      "all-shuffled",
      "empty",
    ]);
    const tally = (id: string) => {
      const demo = demos.find((d) => d.id === id)!;
      const r = explainAnswer({ type: "matching", correct, answer: demo.answer });
      return { c: r.c, x: r.x };
    };
    expect(tally("all-correct")).toEqual({ c: 3, x: 0 });
    expect(tally("some-correct")).toEqual({ c: 2, x: 0 });
    expect(tally("one-swapped")).toEqual({ c: 1, x: 2 });
    expect(tally("all-shuffled")).toEqual({ c: 0, x: 3 });
    expect(tally("empty")).toEqual({ c: 0, x: 0 });
  });

  it("a single pair leaves only the cases it can produce", () => {
    // With one pair there is exactly one possible right-hand side, so «перепутано»
    // has nothing to permute — the wrong answer does not exist for this key.
    const demos = buildDemoAnswers({
      type: "matching",
      correct: { pairs: [{ left: 0, right: 0 }] },
    });
    expect(ids(demos)).toEqual(["all-correct", "empty"]);
  });
});

// ─── ranking ─────────────────────────────────────────────────────────────────

describe("buildDemoAnswers — ranking", () => {
  const correct = { correctOrder: [2, 0, 1] };

  it("derives exact, one-swap and reversed orders", () => {
    const demos = buildDemoAnswers({ type: "ranking", correct });
    expect(ids(demos)).toEqual(["all-correct", "one-swapped", "reversed", "empty"]);
    expect(demos.map((d) => d.answer)).toEqual([[2, 0, 1], [0, 2, 1], [1, 0, 2], []]);
  });

  it("drops the reversed order when it repeats the swap (two items)", () => {
    const demos = buildDemoAnswers({ type: "ranking", correct: { correctOrder: [0, 1] } });
    expect(ids(demos)).toEqual(["all-correct", "one-swapped", "empty"]);
  });
});

// ─── types without an answer price ───────────────────────────────────────────

describe("buildDemoAnswers — inapplicable types", () => {
  it("allocation has no answer price at all, so it has no demos (PRD-44 FR-10)", () => {
    expect(buildDemoAnswers({ type: "allocation", correct: {}, options: ["А", "Б"] })).toEqual([]);
  });

  it("an empty key yields the empty answer alone rather than a broken demo", () => {
    expect(ids(buildDemoAnswers({ type: "multiple", correct: {}, options: [] }))).toEqual(["empty"]);
    expect(ids(buildDemoAnswers({ type: "matching", correct: {} }))).toEqual(["empty"]);
    expect(ids(buildDemoAnswers({ type: "ranking", correct: {} }))).toEqual(["empty"]);
  });
});
