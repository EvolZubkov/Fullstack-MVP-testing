/**
 * @module shared/psychometrics/__tests__/confidence
 */
import { describe, expect, it } from "vitest";

import { coefficientConfidence, descriptiveConfidence } from "../confidence";

describe("coefficientConfidence", () => {
  it("до тридцати наблюдений коэффициент не выводится вовсе", () => {
    expect(coefficientConfidence(29)).toBe("insufficient");
  });

  it("от тридцати до сотни — с оговоркой", () => {
    expect(coefficientConfidence(30)).toBe("tentative");
    expect(coefficientConfidence(99)).toBe("tentative");
  });

  it("от сотни — как есть", () => {
    expect(coefficientConfidence(100)).toBe("reliable");
  });
});

describe("descriptiveConfidence", () => {
  it("живёт при пороге ИНСТАНСА, а не при пороге коэффициентов", () => {
    // Трудность заменила долю верных на вкладке «Вопросы»: поднять ей порог до тридцати
    // значило бы отнять у автора число, которое он видел раньше.
    expect(descriptiveConfidence(12, 10)).toBe("reliable");
    expect(descriptiveConfidence(9, 10)).toBe("insufficient");
  });

  it("у задания с двенадцатью наблюдениями трудность видна, а коэффициент — нет", () => {
    // Ровно тот случай, который экран обязан объяснять (FR-38a).
    expect(descriptiveConfidence(12, 10)).toBe("reliable");
    expect(coefficientConfidence(12)).toBe("insufficient");
  });
});
