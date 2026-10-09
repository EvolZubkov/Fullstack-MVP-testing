import { describe, it, expect } from "vitest";

import { explainAnswer, scoreAnswer } from "../shared/scoring/engine";
import type { QuestionScoring } from "../shared/schema";

/** Два пропуска: текстовый и числовой — как в согласованном эскизе. */
const CORRECT = {
  blanks: [
    {
      id: "organ",
      answerKind: "text",
      join: "any",
      rules: [
        { kind: "text", match: "wildcard", value: "Ростехнадзор" },
        { kind: "text", match: "wildcard", value: "РТН" },
      ],
    },
    { id: "srok", answerKind: "number", join: "any", rules: [{ kind: "number", op: "eq", value: 15 }] },
  ],
};

describe("scoreAnswer — пропуски", () => {
  it("верно, когда верны ВСЕ пропуски", () => {
    expect(scoreAnswer({ type: "blanks", correct: CORRECT, answer: { organ: "ртн", srok: "15" } }).ratio).toBe(1);
  });

  it("один неверный пропуск делает задание неверным", () => {
    expect(scoreAnswer({ type: "blanks", correct: CORRECT, answer: { organ: "ртн", srok: "30" } }).ratio).toBe(0);
  });

  it("незаполненный пропуск тоже неверен", () => {
    expect(scoreAnswer({ type: "blanks", correct: CORRECT, answer: { organ: "ртн" } }).ratio).toBe(0);
  });

  it("пустой ответ не приносит балла", () => {
    expect(scoreAnswer({ type: "blanks", correct: CORRECT, answer: {} }).ratio).toBe(0);
    expect(scoreAnswer({ type: "blanks", correct: CORRECT, answer: null }).ratio).toBe(0);
  });
});

describe("счётчики пропусков (FR-26)", () => {
  it("c — сколько верно, x — сколько неверно, итог — сколько их всего", () => {
    const both = explainAnswer({ type: "blanks", correct: CORRECT, answer: { organ: "ртн", srok: "15" } });
    expect({ c: both.c, x: both.x, total: both.total }).toEqual({ c: 2, x: 0, total: 2 });

    const half = explainAnswer({ type: "blanks", correct: CORRECT, answer: { organ: "ртн", srok: "30" } });
    expect({ c: half.c, x: half.x, total: half.total }).toEqual({ c: 1, x: 1, total: 2 });

    // Незаполненный пропуск не «лишний»: человек его не трогал.
    const empty = explainAnswer({ type: "blanks", correct: CORRECT, answer: { organ: "ртн" } });
    expect({ c: empty.c, x: empty.x, total: empty.total }).toEqual({ c: 1, x: 0, total: 2 });
  });

  it("пропуск без правил в знаменатель не идёт", () => {
    const correct = {
      blanks: [
        CORRECT.blanks[0],
        { id: "kto", answerKind: "text", join: "any", rules: [] },
      ],
    };
    const one = explainAnswer({ type: "blanks", correct, answer: { organ: "ртн", kto: "что угодно" } });
    expect(one.total).toBe(1);
    expect(scoreAnswer({ type: "blanks", correct, answer: { organ: "ртн", kto: "что угодно" } }).ratio).toBe(1);
  });

  it("ступень платит за три пропуска из четырёх", () => {
    const four = {
      blanks: ["a", "b", "c", "d"].map((id) => ({
        id,
        answerKind: "text",
        join: "any",
        rules: [{ kind: "text", match: "wildcard", value: "да" }],
      })),
    };
    const tiered: QuestionScoring = {
      kind: "tiered",
      tiers: [
        { when: { all: [{ lhs: "c", op: "==", rhs: "T" }] }, score: 3 },
        { when: { all: [{ lhs: "c", op: ">=", rhs: 3 }] }, score: 2 },
        { when: { all: [{ lhs: "c", op: ">=", rhs: 1 }] }, score: 1 },
      ],
    };
    const answer = { a: "да", b: "да", c: "да", d: "нет" };
    expect(scoreAnswer({ type: "blanks", correct: four, answer, scoring: tiered }).score).toBe(2);
    const all = { a: "да", b: "да", c: "да", d: "да" };
    expect(scoreAnswer({ type: "blanks", correct: four, answer: all, scoring: tiered }).score).toBe(3);
  });
});
