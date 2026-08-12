/**
 * @module tests/report-preview
 *
 * PRD-27 Фаза 4 — демонстрационные данные предпросмотра отчёта (FR-18, FR-19).
 *
 * Пиннится ровно то, из-за чего предпросмотр перестаёт быть полезным: если числа
 * НЕ согласованы между собой, автор примет расхождение за дефект макета; если они
 * НЕдетерминированы, два варианта не сравнить; если структура не настоящая, автор
 * оценивает не свой тест; если в предпросмотр протекает имя человека — это уже
 * персональные данные.
 */

import { describe, it, expect } from "vitest";
import {
  buildReportPreviewInput,
  buildAdaptiveReportPreviewInput,
  PREVIEW_LEARNER_NAME,
} from "@shared/report/report-preview";
import { buildReportContext, buildAdaptiveReportContext } from "@shared/report/report-context";

const TEST = {
  testName: "Сертификация руководителей",
  sections: [
    { topicId: "t1", topicName: "Управление", questionCount: 10 },
    { topicId: "t2", topicName: "Финансы", questionCount: 5 },
    { topicId: "t3", topicName: "Право", questionCount: 4 },
  ],
};

describe("структура — настоящая, числа — демонстрационные (FR-18)", () => {
  it("берёт название и разделы редактируемого теста", () => {
    const input = buildReportPreviewInput(TEST, "failed");
    expect(input.testName).toBe("Сертификация руководителей");
    expect(input.result.topicResults.map((t) => t.topicName)).toEqual([
      "Управление",
      "Финансы",
      "Право",
    ]);
    expect(input.result.topicResults.map((t) => t.total)).toEqual([10, 5, 4]);
  });

  it("слушатель обозначен нейтрально — персональных данных нет", () => {
    expect(buildReportPreviewInput(TEST, "passed").learnerName).toBe(PREVIEW_LEARNER_NAME);
    expect(buildAdaptiveReportPreviewInput(TEST, "passed").learnerName).toBe(PREVIEW_LEARNER_NAME);
  });

  it("тест без разделов всё равно рисуется", () => {
    const input = buildReportPreviewInput({ testName: "Пустой", sections: [] }, "failed");
    expect(input.result.topicResults).toHaveLength(1);
    expect(input.result.totalQuestions).toBeGreaterThan(0);
  });

  it("раздел без заданной выдачи получает демонстрационное число вопросов", () => {
    const input = buildReportPreviewInput(
      { testName: "T", sections: [{ topicName: "Без выдачи" }] },
      "passed",
    );
    expect(input.result.topicResults[0].total).toBeGreaterThan(0);
  });
});

describe("числа согласованы между собой", () => {
  it("процент темы считается из её же долей", () => {
    for (const outcome of ["passed", "failed"] as const) {
      for (const t of buildReportPreviewInput(TEST, outcome).result.topicResults) {
        expect(t.percent).toBe(Math.round((t.correct / t.total) * 100));
        expect(t.correct).toBeLessThanOrEqual(t.total);
      }
    }
  });

  it("итог складывается из тем, а не задаётся отдельно", () => {
    const { result } = buildReportPreviewInput(TEST, "failed");
    const correct = result.topicResults.reduce((n, t) => n + t.correct, 0);
    const total = result.topicResults.reduce((n, t) => n + t.total, 0);
    expect(result.correct).toBe(correct);
    expect(result.totalQuestions).toBe(total);
    expect(result.percent).toBe(Math.round((correct / total) * 100));
  });
});

describe("детерминированность", () => {
  it("два вызова с тем же входом дают тот же результат", () => {
    expect(buildReportPreviewInput(TEST, "failed")).toEqual(buildReportPreviewInput(TEST, "failed"));
    expect(buildAdaptiveReportPreviewInput(TEST, "passed")).toEqual(
      buildAdaptiveReportPreviewInput(TEST, "passed"),
    );
  });
});

describe("переключатель исхода (FR-19)", () => {
  it("исход меняет вердикт теста", () => {
    expect(buildReportPreviewInput(TEST, "passed").result.passed).toBe(true);
    expect(buildReportPreviewInput(TEST, "failed").result.passed).toBe(false);
  });

  it("непройденный исход даёт непройденные темы и блок обратной связи", () => {
    const failed = buildReportPreviewInput(TEST, "failed").result.topicResults;
    expect(failed.some((t) => t.passed === false)).toBe(true);
    expect(failed.some((t) => (t.feedback ?? "").length > 0)).toBe(true);
  });

  it("пройденный исход даёт заметно более высокий процент", () => {
    const pass = buildReportPreviewInput(TEST, "passed").result.percent;
    const fail = buildReportPreviewInput(TEST, "failed").result.percent;
    expect(pass).toBeGreaterThan(fail);
  });

  it("непройденный исход даёт СМЕСЬ строк — макет проверяется не на одинаковых темах", () => {
    // Смесь должна быть при ЛЮБОЙ выдаче: на малых числах она легко вырождается
    // в одинаковые строки из-за округления.
    for (let count = 1; count <= 12; count++) {
      const sections = Array.from({ length: 4 }, (_, i) => ({
        topicName: `Раздел ${i + 1}`,
        questionCount: count,
      }));
      const topics = buildReportPreviewInput({ testName: "T", sections }, "failed").result.topicResults;
      expect(topics.some((t) => t.passed === true)).toBe(true);
      expect(topics.some((t) => t.passed === false)).toBe(true);
    }
  });

  it("пройденный исход — документ связный: непройденных тем в нём нет", () => {
    // Иначе автор видит «Тест пройден» над красной строкой и считает это дефектом.
    // Число разделов и выдача перебираются НЕЗАВИСИМО: доли берутся по циклу, и если
    // связать их одним индексом, часть пар «доля × число вопросов» вообще не встретится.
    // Малая выдача опаснее большой — доля округляется грубее, и вердикт сваливается ниже
    // порога там, где на десяти вопросах он держится.
    for (let n = 1; n <= 8; n++) {
      for (let count = 1; count <= 12; count++) {
        const sections = Array.from({ length: n }, (_, i) => ({
          topicName: `Раздел ${i + 1}`,
          questionCount: count,
        }));
        const topics = buildReportPreviewInput({ testName: "T", sections }, "passed").result.topicResults;
        expect(topics.every((t) => t.passed === true)).toBe(true);
      }
    }
  });
});

describe("адаптивный режим (D-5)", () => {
  it("непройденный исход показывает и подтверждённый уровень, и неподтверждённый", () => {
    const topics = buildAdaptiveReportPreviewInput(TEST, "failed").result.topicResults;
    expect(topics.some((t) => t.achievedLevelIndex == null)).toBe(true);
    expect(topics.some((t) => t.achievedLevelIndex != null)).toBe(true);
  });

  it("берёт лестницу уровней теста, когда она задана", () => {
    const topics = buildAdaptiveReportPreviewInput(
      { ...TEST, levelNames: ["Стажёр", "Специалист"] },
      "passed",
    ).result.topicResults;
    for (const t of topics) {
      expect(["Стажёр", "Специалист"]).toContain(t.achievedLevelName);
    }
  });

  it("помечен адаптивным — иначе построитель контекста не выберет свой макет", () => {
    expect(buildAdaptiveReportPreviewInput(TEST, "passed").adaptive).toBe(true);
  });
});

describe("проходит через ТОТ ЖЕ построитель контекста, что и выдача", () => {
  it("стандартный отчёт собирается и несёт разделы теста", () => {
    const ctx = buildReportContext(buildReportPreviewInput(TEST, "failed"), { isPreview: true });
    expect(ctx.report.isPreview).toBe(true);
    expect(ctx.result.topicResults?.map((t) => t.topicName)).toEqual([
      "Управление",
      "Финансы",
      "Право",
    ]);
    expect(ctx.report.verdictHeadline).toBe("Тест не пройден");
  });

  it("значения полей вида доходят до контекста (FR-20)", () => {
    const ctx = buildReportContext(buildReportPreviewInput(TEST, "passed"), {
      values: { headline: "Аттестация" },
    });
    expect(ctx.report.values.headline).toBe("Аттестация");
  });

  it("адаптивный отчёт собирается", () => {
    const ctx = buildAdaptiveReportContext(buildAdaptiveReportPreviewInput(TEST, "passed"), {
      isPreview: true,
    });
    expect(ctx.report.hasTopics).toBe(true);
    expect(ctx.result.topicResults).toHaveLength(3);
  });
});
