/**
 * @module client/features/tests/list/__tests__/delete-impact.test
 * @description The text of the delete dialog's warning (PRD-15 FR-07a, approved wireframe
 * `test-delete-lms-impact.html`): which lines appear for which counts, and the Russian plurals.
 */
import { describe, it, expect } from "vitest";
import { describeDeleteImpact } from "../delete-impact";

const none = { webAttempts: 0, lmsAttempts: 0, importBatches: 0, packages: 0 };

describe("describeDeleteImpact", () => {
  it("says nothing when the test has neither attempts nor packages", () => {
    expect(describeDeleteImpact(none)).toBeNull();
  });

  it("matches the wireframe's «LMS» state", () => {
    expect(describeDeleteImpact({ webAttempts: 12, lmsAttempts: 125, importBatches: 2, packages: 3 })).toEqual({
      title: "Будут удалены 137 прохождений",
      description:
        "12 — в сервисе, 125 — из LMS, в том числе 2 загруженные выгрузки. " +
        "Выгруженные пакеты (3) перестанут передавать результаты в аналитику.",
    });
  });

  it("gives only the title when every attempt was taken in the service", () => {
    expect(describeDeleteImpact({ ...none, webAttempts: 12 })).toEqual({ title: "Будут удалены 12 прохождений" });
  });

  it.each([
    [1, "Будет удалено 1 прохождение"],
    [3, "Будут удалены 3 прохождения"],
    [11, "Будут удалены 11 прохождений"],
    [21, "Будет удалено 21 прохождение"],
  ])("agrees the title with %i", (n, title) => {
    expect(describeDeleteImpact({ ...none, webAttempts: n })?.title).toBe(title);
  });

  it("drops the batch clause without uploads and declines it by number", () => {
    expect(describeDeleteImpact({ ...none, lmsAttempts: 4 })?.description).toBe("0 — в сервисе, 4 — из LMS.");
    expect(describeDeleteImpact({ ...none, lmsAttempts: 4, importBatches: 1 })?.description)
      .toBe("0 — в сервисе, 4 — из LMS, в том числе 1 загруженная выгрузка.");
    expect(describeDeleteImpact({ ...none, lmsAttempts: 4, importBatches: 5 })?.description)
      .toBe("0 — в сервисе, 4 — из LMS, в том числе 5 загруженных выгрузок.");
  });

  it("speaks of a single package in the singular", () => {
    expect(describeDeleteImpact({ ...none, webAttempts: 2, packages: 1 })?.description)
      .toBe("Выгруженный пакет перестанет передавать результаты в аналитику.");
  });

  it("makes the package line the title when there are packages but no attempts", () => {
    expect(describeDeleteImpact({ ...none, packages: 2 })).toEqual({
      title: "Выгруженные пакеты (2) перестанут передавать результаты в аналитику.",
    });
  });
});
