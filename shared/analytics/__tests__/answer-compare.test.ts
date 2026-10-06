/**
 * @module shared/analytics/__tests__/answer-compare
 * @description PRD-56 FR-07m, FR-07n: сведение разброса ответов выбранных срезов.
 */
import { describe, it, expect } from "vitest";
import { compareAnswerSpreads, type SliceQuestionSpread } from "../answer-compare";

const slice = (...spreads: SliceQuestionSpread[]) => new Map(spreads.map(s => [s.questionId, s]));
const q = (answered: number, options: Array<[string, number]>, questionId = "q1"): SliceQuestionSpread => ({
  questionId, answered, options: options.map(([label, share]) => ({ label, share })),
});

describe("compareAnswerSpreads", () => {
  it("расхождение — наибольший по вариантам размах, вариант назван", () => {
    const [row] = compareAnswerSpreads(
      [slice(q(26, [["A", 32], ["B", 31], ["C", 24]])), slice(q(22, [["A", 49], ["B", 24], ["C", 17]]))],
      ["q1"], 10,
    );
    expect(row.spread).toBe(17);
    expect(row.topIndex).toBe(0);
    expect(row.options.map(o => o.shares)).toEqual([[32, 49], [31, 24], [24, 17]]);
  });

  it("при четырёх срезах — размах наибольшей и наименьшей доли", () => {
    const [row] = compareAnswerSpreads(
      [slice(q(26, [["A", 32]])), slice(q(22, [["A", 49]])), slice(q(41, [["A", 40]])), slice(q(30, [["A", 28]]))],
      ["q1"], 10,
    );
    expect(row.spread).toBe(21);
  });

  it("срез ниже минимума наблюдений показывается, но в расхождение не входит", () => {
    const [row] = compareAnswerSpreads(
      [slice(q(26, [["A", 35]])), slice(q(22, [["A", 29]])), slice(q(6, [["A", 90]]))],
      ["q1"], 10,
    );
    expect(row.thin).toEqual([false, false, true]);
    expect(row.options[0].shares).toEqual([35, 29, 90]);
    expect(row.spread).toBe(6);
  });

  it("доли округляются до целых до разности — расхождение сходится с видимыми числами", () => {
    const [row] = compareAnswerSpreads([slice(q(30, [["A", 13.33]])), slice(q(30, [["A", 6.67]]))], ["q1"], 10);
    expect(row.options[0].shares).toEqual([13, 7]);
    expect(row.spread).toBe(6);
  });

  it("меньше двух годных срезов — расхождения нет, но вариант строке назван", () => {
    const [row] = compareAnswerSpreads(
      [slice(q(26, [["A", 35], ["B", 65]])), slice(q(4, [["A", 80], ["B", 20]]))],
      ["q1"], 10,
    );
    expect(row.spread).toBeNull();
    expect(row.topIndex).toBe(0);
  });

  it("ответы только в одном срезе — ни расхождения, ни варианта", () => {
    const [row] = compareAnswerSpreads([slice(q(26, [["A", 35]])), slice()], ["q1"], 10);
    expect(row.spread).toBeNull();
    expect(row.topIndex).toBeNull();
  });

  it("вариант, которого никто в срезе не выбрал, — ноль; срез без ответов — null", () => {
    const [row] = compareAnswerSpreads(
      [slice(q(20, [["A", 100]])), slice(q(20, [["A", 60], ["B", 40]])), slice()],
      ["q1"], 10,
    );
    expect(row.options).toEqual([{ label: "A", shares: [100, 60, null] }, { label: "B", shares: [0, 40, null] }]);
    expect(row.answered).toEqual([20, 20, 0]);
    expect(row.spread).toBe(40);
  });

  it("вопрос без ответов во всех срезах в таблицу не идёт, порядок — как задан", () => {
    const rows = compareAnswerSpreads(
      [slice(q(20, [["A", 50]], "q2"), q(20, [["A", 50]], "q1")), slice(q(20, [["A", 40]], "q2"))],
      ["q1", "q2", "q3"], 10,
    );
    expect(rows.map(r => r.questionId)).toEqual(["q1", "q2"]);
  });
});
