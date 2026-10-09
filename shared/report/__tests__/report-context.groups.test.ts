/**
 * @module shared/report/__tests__/report-context.groups
 *
 * PRD-50 FR-11 в ОТЧЁТЕ: блоки разделов печатаются и в документе, а не только на экране.
 *
 * Дефект, пойманный живой приёмкой PRD-51: группы приезжают МАТЕРИАЛОМ итогов, а сборщик
 * отчёта их не перекладывал во вход результата — документ печатал плоский список тем там,
 * где экран печатал карточки со счётчиком «пройдено N из M». Расхождение двух выдач
 * запрещено §5.2 спецификации PRD-51.
 */
import { describe, it, expect } from "vitest";
import { buildReportContext } from "../report-context";

const result = {
  overallPassed: false,
  overallPercent: 33,
  totalQuestions: 6,
  totalCorrect: 2,
  totalEarnedPoints: 2,
  totalPossiblePoints: 6,
  topicResults: [
    { topicId: "t1", topicName: "Часть 1", correct: 1, total: 3, percent: 33, passed: false, earnedPoints: 1, possiblePoints: 3, groupKey: "competencies" },
    { topicId: "t2", topicName: "Часть 2", correct: 1, total: 3, percent: 33, passed: false, earnedPoints: 1, possiblePoints: 3, groupKey: "competencies" },
  ],
};

const measures = {
  ramp: [] as never,
  scaleKind: "none" as never,
  indicatorKind: "none" as never,
  scales: [],
  indicators: [],
  sectionGroupsJson: [{ key: "competencies", label: "Управленческие компетенции", order: 0 }],
};

describe("блоки разделов в отчёте", () => {
  it("документ печатает карточку блока со счётчиком, а не плоский список", () => {
    const ctx = buildReportContext({ result, testName: "Тест" } as never, { values: {}, measures } as never);
    const groups = (ctx.result as { topicGroups?: Array<Record<string, unknown>> }).topicGroups;
    expect(groups, "групп нет — документ напечатает плоский список").toBeDefined();
    expect(groups).toHaveLength(1);
    expect(groups![0].label).toBe("Управленческие компетенции");
    expect(groups![0].counterLabel, "счётчик блока не посчитан").toBeTruthy();
  });

  it("без блоков контекст остаётся прежним — плоский список тем", () => {
    const ctx = buildReportContext({ result, testName: "Тест" } as never, { values: {} } as never);
    expect((ctx.result as { topicGroups?: unknown }).topicGroups).toBeUndefined();
    expect((ctx.result as { topicResults: unknown[] }).topicResults).toHaveLength(2);
  });
});
