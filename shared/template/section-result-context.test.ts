/**
 * @module shared/template/section-result-context.test
 * Unit tests for the PRD-19 FR-05a section-results (итоги раздела) context builder.
 */
import { describe, it, expect } from "vitest";
import { buildSectionResultContext } from "./result-context";

describe("buildSectionResultContext", () => {
  it("passed section: pass verdict + rounded percent + ring offset + summary", () => {
    const { course, sectionResult } = buildSectionResultContext({
      topicName: "Сеть",
      correct: 6,
      total: 8,
      percent: 74.6,
      passed: true,
    });
    expect(course.title).toBe("Сеть");
    expect(sectionResult.topicName).toBe("Сеть");
    expect(sectionResult.scorePercent).toBe(75); // rounded
    expect(sectionResult.passClass).toBe("is-pass");
    expect(sectionResult.statusLabel).toBe("Раздел пройден");
    expect(sectionResult.hasVerdict).toBe(true);
    expect(sectionResult.summaryLabel).toBe("6 из 8 верно · 75%");
    expect(sectionResult.continueLabel).toBe("Продолжить");
    // 2π·63 ≈ 395.84; offset = round(C·(1 - 75/100)) = round(98.96) = 99.
    expect(sectionResult.ringDashoffset).toBe(99);
  });

  it("failed section: fail verdict", () => {
    const { sectionResult } = buildSectionResultContext({
      topicName: "Безопасность",
      correct: 2,
      total: 10,
      percent: 20,
      passed: false,
    });
    expect(sectionResult.passClass).toBe("is-fail");
    expect(sectionResult.statusLabel).toBe("Раздел не пройден");
    expect(sectionResult.hasVerdict).toBe(true);
  });

  it("no pass rule (passed=null): no verdict tag, neutral class/label", () => {
    const { sectionResult } = buildSectionResultContext({
      topicName: "Протоколы",
      correct: 5,
      total: 5,
      percent: 100,
      passed: null,
    });
    expect(sectionResult.hasVerdict).toBe(false);
    expect(sectionResult.passClass).toBe("");
    expect(sectionResult.statusLabel).toBe("");
    expect(sectionResult.scorePercent).toBe(100);
    expect(sectionResult.ringDashoffset).toBe(0); // full ring at 100%
  });

  it("custom continue label is honored", () => {
    const { sectionResult } = buildSectionResultContext({
      topicName: "Сеть",
      correct: 0,
      total: 3,
      percent: 0,
      passed: null,
      continueLabel: "К завершению теста",
    });
    expect(sectionResult.continueLabel).toBe("К завершению теста");
    expect(sectionResult.summaryLabel).toBe("0 из 3 верно · 0%");
  });

  it("header: test title + subtitle in course, «Раздел N из M» tag + progress from position", () => {
    const { course, sectionResult } = buildSectionResultContext({
      topicName: "Базовые угрозы",
      correct: 5,
      total: 6,
      percent: 85,
      passed: true,
      courseTitle: "Основы информационной безопасности",
      subtitle: "Попытка 1 из 2",
      sectionIndex: 1,
      sectionsTotal: 3,
    });
    // Header shows the TEST title; the section name stays in sectionResult for the body h2.
    expect(course.title).toBe("Основы информационной безопасности");
    expect(course.subtitle).toBe("Попытка 1 из 2");
    expect(sectionResult.topicName).toBe("Базовые угрозы");
    expect(sectionResult.sectionLabel).toBe("Раздел 1 из 3");
    expect(sectionResult.progressPercent).toBe(33); // round(1/3*100)
  });

  it("no section position: section tag + progress omitted (title falls back to topic)", () => {
    const { course, sectionResult } = buildSectionResultContext({
      topicName: "Сеть",
      correct: 3,
      total: 4,
      percent: 75,
      passed: true,
    });
    expect(course.title).toBe("Сеть"); // fallback when no courseTitle
    expect(sectionResult.sectionLabel).toBeUndefined();
    expect(sectionResult.progressPercent).toBeUndefined();
  });
});
