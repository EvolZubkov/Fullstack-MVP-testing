import { describe, it, expect } from "vitest";
import { scoreAnswer, explainAnswer } from "../shared/scoring/engine";
import type { QuestionScoring } from "../shared/schema";

const correct = {
  answerKind: "text",
  join: "any",
  rules: [{ kind: "text", match: "wildcard", value: "Федеральная служба по * надзору" }],
} as const;

describe("scoreAnswer — короткий ответ", () => {
  it("зачитывает подходящий ответ", () => {
    const r = scoreAnswer({ type: "short", correct, answer: "Федеральная служба по атомному надзору" });
    expect(r.ratio).toBe(1);
  });

  it("не зачитывает неподходящий", () => {
    expect(scoreAnswer({ type: "short", correct, answer: "Минэнерго" }).ratio).toBe(0);
  });

  it("не зачитывает пустой и отсутствующий ответ", () => {
    expect(scoreAnswer({ type: "short", correct, answer: "" }).ratio).toBe(0);
    expect(scoreAnswer({ type: "short", correct, answer: null }).ratio).toBe(0);
  });

  it("считает счётчики один к одному", () => {
    const hit = explainAnswer({ type: "short", correct, answer: "федеральная служба по горному надзору" });
    expect({ c: hit.c, x: hit.x, total: hit.total }).toEqual({ c: 1, x: 0, total: 1 });
    const miss = explainAnswer({ type: "short", correct, answer: "нет" });
    expect({ c: miss.c, x: miss.x, total: miss.total }).toEqual({ c: 0, x: 1, total: 1 });
  });

  it("набор без правил не приносит балла", () => {
    const empty = { answerKind: "text", join: "any", rules: [] } as const;
    expect(scoreAnswer({ type: "short", correct: empty, answer: "что угодно" }).ratio).toBe(0);
  });
});

describe("ступень по точности — счётчиком выполненных правил (FR-28aa4)", () => {
  // «Ровно 3,14 — 2 балла; 3,14 ± 0,05 — 1 балл»: правила идут от строгого к мягкому,
  // точное попадание выполняет ОБА, попадание в допуск — только второе.
  const nested = {
    answerKind: "number",
    join: "any",
    rules: [
      { kind: "number", op: "eq", value: 3.14 },
      { kind: "number", op: "eq", value: 3.14, tolerance: { unit: "abs", value: 0.05 } },
    ],
  } as const;

  const tiered: QuestionScoring = {
    kind: "tiered",
    tiers: [
      { when: { all: [{ lhs: "c", op: ">=", rhs: 2 }] }, score: 2 },
      { when: { all: [{ lhs: "c", op: ">=", rhs: 1 }] }, score: 1 },
    ],
  };

  it("счётчик равен числу выполненных правил, знаменатель — числу правил", () => {
    const exact = explainAnswer({ type: "short", correct: nested, answer: "3,14" });
    expect({ c: exact.c, x: exact.x, total: exact.total }).toEqual({ c: 2, x: 0, total: 2 });
    const near = explainAnswer({ type: "short", correct: nested, answer: "3,17" });
    expect({ c: near.c, x: near.x, total: near.total }).toEqual({ c: 1, x: 0, total: 2 });
    const miss = explainAnswer({ type: "short", correct: nested, answer: "7" });
    expect({ c: miss.c, x: miss.x, total: miss.total }).toEqual({ c: 0, x: 1, total: 2 });
  });

  it("таблица ступеней платит по точности", () => {
    expect(scoreAnswer({ type: "short", correct: nested, answer: "3,14", scoring: tiered }).score).toBe(2);
    expect(scoreAnswer({ type: "short", correct: nested, answer: "3,17", scoring: tiered }).score).toBe(1);
    expect(scoreAnswer({ type: "short", correct: nested, answer: "7", scoring: tiered }).score).toBe(0);
  });

  it("дробь и десятичная запись платят одинаково", () => {
    const half = {
      answerKind: "number",
      join: "any",
      rules: [{ kind: "number", op: "eq", value: 0.5 }],
    } as const;
    expect(scoreAnswer({ type: "short", correct: half, answer: "1/2" }).ratio).toBe(1);
    expect(scoreAnswer({ type: "short", correct: half, answer: "0,5" }).ratio).toBe(1);
  });

  it("набор из одного правила даёт прежние числа", () => {
    const one = explainAnswer({ type: "short", correct, answer: "федеральная служба по горному надзору" });
    expect({ c: one.c, x: one.x, total: one.total }).toEqual({ c: 1, x: 0, total: 1 });
  });
});
