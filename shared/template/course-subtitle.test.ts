/**
 * @module shared/template/course-subtitle.test
 *
 * Unit coverage for {@link buildCourseSubtitle}: the shared header-subtitle
 * builder both hosts use, so its "Попытка N из M" text stays byte-identical.
 */

import { describe, it, expect } from "vitest";
import { buildCourseSubtitle } from "./course-subtitle";

describe("buildCourseSubtitle", () => {
  it("renders attempt N of M when both are known", () => {
    expect(buildCourseSubtitle({ attemptNumber: 1, maxAttempts: 2 })).toBe("Попытка 1 из 2");
    expect(buildCourseSubtitle({ attemptNumber: 3, maxAttempts: 5 })).toBe("Попытка 3 из 5");
  });

  it("drops the «из M» tail when the cap is absent or non-positive (unlimited)", () => {
    expect(buildCourseSubtitle({ attemptNumber: 2, maxAttempts: null })).toBe("Попытка 2");
    expect(buildCourseSubtitle({ attemptNumber: 2 })).toBe("Попытка 2");
    expect(buildCourseSubtitle({ attemptNumber: 2, maxAttempts: 0 })).toBe("Попытка 2");
  });

  it("returns empty (title-only header) when the attempt number is unknown/invalid", () => {
    expect(buildCourseSubtitle({ attemptNumber: null, maxAttempts: 2 })).toBe("");
    expect(buildCourseSubtitle({ maxAttempts: 2 })).toBe("");
    expect(buildCourseSubtitle({ attemptNumber: 0 })).toBe("");
    expect(buildCourseSubtitle({ attemptNumber: NaN })).toBe("");
  });
});
