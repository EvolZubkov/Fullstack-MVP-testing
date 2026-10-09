import { describe, it, expect } from "vitest";

import { DEFAULT_BUDGET_MS, DEFAULT_WARN_MS, measure, provocations } from "../shared/answer-check/budget";
import { aggregateStandardResult } from "../shared/scoring/aggregate";
import { scoreAnswer } from "../shared/scoring/engine";

const REGEX_SET = {
  answerKind: "text" as const,
  join: "any" as const,
  rules: [{ kind: "text" as const, match: "regex" as const, value: "^рос.*$" }],
};

describe("бюджет: общие числа и замер", () => {
  it("числа по умолчанию заданы и разумны друг относительно друга", () => {
    expect(DEFAULT_WARN_MS).toBeGreaterThan(0);
    expect(DEFAULT_BUDGET_MS).toBeGreaterThan(DEFAULT_WARN_MS);
  });

  it("замер возвращает и значение, и время", () => {
    const { value, ms } = measure(() => 2 + 2);
    expect(value).toBe(4);
    expect(ms).toBeGreaterThanOrEqual(0);
  });

  it("строки-провокации растут в длину и НЕ подходят выражению", () => {
    const strings = provocations();
    expect(strings.length).toBeGreaterThan(3);
    // Замер 2026-09-19: у `^(\S+\s?)+ надзору$` кривая отрывается от нуля только после
    // шестидесяти символов, поэтому короткий набор объявил бы худшее выражение быстрым.
    expect(strings[strings.length - 1].length).toBeGreaterThan(60);
    for (let i = 1; i < strings.length; i += 1) {
      expect(strings[i].length).toBeGreaterThan(strings[i - 1].length);
    }
    // Откат разворачивается на неподходящем ответе: подходящий движок бросает на первом
    // же совпадении, и замер на нём показал бы ноль. Проверяется это ДЕШЁВЫМ шаблоном:
    // прогнать здесь то самое катастрофическое выражение значит подвесить прогон тестов
    // на минуту — ровно то, от чего бюджет и защищает (проверено: 72 секунды).
    for (const text of strings) {
      expect(/ надзору$/.test(text)).toBe(false);
      expect(text.endsWith("абв!")).toBe(true);
    }
  });
});

describe("превышение бюджета в оценке (FR-28r)", () => {
  it("ответ не становится неверным", () => {
    const result = scoreAnswer({
      type: "short",
      correct: REGEX_SET,
      answer: "Ростехнадзор",
      verdicts: ["budget"],
    });
    expect(result.ratio).toBe(0);
  });

  it("в итоге попытки такой ответ ЖДЁТ проверки и вне знаменателя", () => {
    const result = aggregateStandardResult({
      sections: [
        {
          topicId: "t1",
          topicName: "Тема",
          topicPassRule: null,
          questions: [
            { id: "q1", type: "short", correct: REGEX_SET, points: 1, answer: "Ростехнадзор", ruleVerdicts: ["budget"] },
            { id: "q2", type: "short", correct: REGEX_SET, points: 1, answer: "Ростехнадзор" },
          ],
        },
      ],
      overallPassRule: null,
    });

    const outcomes = result.questionOutcomes ?? [];
    // Э9 дал этому состоянию имя: «не уложился в бюджет» всегда означало «никто не
    // проверял», и теперь оно не путается с «не требует оценки» (FR-35).
    expect(outcomes.find((o) => o.questionId === "q1")?.result).toBe("pending");
    expect(outcomes.find((o) => o.questionId === "q2")?.result).toBe("correct");
    // Непроверенный ответ не отнимает балла и не раздувает знаменатель: в зачёт идёт
    // только второй вопрос.
    expect(result.possiblePoints).toBe(1);
    expect(result.earnedPoints).toBe(1);
    expect(result.percent).toBe(100);
  });
});
