/**
 * @module tests/section-groups-hosts
 * @description PRD-50 FR-11/FR-24 - FR-27, задача 6 (часть А): блоки разделов доезжают до
 * сборщика контекста на ОБОИХ хостах.
 *
 * До этой работы ядро блоки считать умело, но их никто не передавал: веб-адаптер
 * перечисляет поля темы поимённо (значит `groupKey` терялся), список блоков теста никуда
 * не ехал, а пакет SCORM не нёс их вовсе. Экран печатал плоский список при любых
 * настройках автора.
 *
 * Главное требование, которое здесь и стережётся: тест БЕЗ блоков обязан давать ровно
 * прежний контекст и ровно прежний `TEST_DATA` — ни нового поля, ни нового ключа.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { topicResultSchema, type AttemptResult, type TopicResult } from "../shared/schema";
import { buildResultContext, buildReportInput, type MeasuresSource } from "../server/services/result-context";
import { buildTestJson, type ExportData } from "../server/scorm/builders/test-json";

// ─── Веб-хост: адаптер результата попытки ────────────────────────────────────

const storedTopic = (topicName: string, passed: boolean | null, groupKey?: string): TopicResult =>
  ({
    topicId: topicName,
    topicName,
    correct: passed === true ? 4 : 1,
    total: 5,
    percent: passed === true ? 80 : 20,
    earnedPoints: passed === true ? 4 : 1,
    possiblePoints: 5,
    passed,
    passRule: null,
    recommendedCourses: [],
    recommendedEvents: [],
    recommendedAssets: [],
    feedbackTexts: [],
    breakdown: [],
    ...(groupKey === undefined ? {} : { groupKey }),
  }) as TopicResult;

const storedResult = (topicResults: TopicResult[]): AttemptResult => ({
  totalCorrect: 5,
  totalQuestions: 10,
  overallPercent: 50,
  totalEarnedPoints: 5,
  totalPossiblePoints: 10,
  overallPassed: false,
  topicResults,
});

const measures = (sectionGroupsJson?: MeasuresSource["sectionGroupsJson"]): MeasuresSource => ({
  scales: [],
  variables: [],
  blockSettings: {},
  hasPassThreshold: true,
  ...(sectionGroupsJson === undefined ? {} : { sectionGroupsJson }),
});

const GROUPS = [
  { key: "competencies", label: "Управленческие компетенции", order: 0 },
  { key: "knowledge", label: "Знания", order: 1 },
];

describe("схема результата попытки несёт блок раздела", () => {
  it("принимает ключ блока у темы", () => {
    const parsed = topicResultSchema.parse({
      topicId: "law", topicName: "Право", correct: 1, total: 2, percent: 50,
      earnedPoints: 1, possiblePoints: 2, passed: false, passRule: null,
      recommendedCourses: [], groupKey: "knowledge",
    });
    expect(parsed.groupKey).toBe("knowledge");
  });

  it("результат, сохранённый до этой работы, остаётся валидным и без ключа", () => {
    const parsed = topicResultSchema.parse({
      topicId: "law", topicName: "Право", correct: 1, total: 2, percent: 50,
      earnedPoints: 1, possiblePoints: 2, passed: false, passRule: null,
      recommendedCourses: [],
    });
    expect(parsed.groupKey).toBeUndefined();
    expect("groupKey" in parsed).toBe(false);
  });
});

describe("веб-хост: блоки разделов доезжают до контекста экрана", () => {
  it("собирает блоки из списка теста и ключей его тем", () => {
    const { result } = buildResultContext(
      storedResult([
        storedTopic("Знание 1", true, "knowledge"),
        storedTopic("Компетенция", false, "competencies"),
        storedTopic("Без блока", true),
      ]),
      "Тест",
      measures(GROUPS),
    );
    expect(result.topicGroups?.map((g) => g.key)).toEqual(["competencies", "knowledge"]);
    expect(result.topicGroups![0]).toMatchObject({ label: "Управленческие компетенции", counterLabel: "0 / 1" });
    expect(result.topicGroups![1].topics.map((t) => t.topicName)).toEqual(["Знание 1"]);
    expect(result.ungroupedTopics?.map((t) => t.topicName)).toEqual(["Без блока"]);
    // Плоский список остаётся ПОЛНЫМ: сторонний шаблон из реестра PRD-3 печатает его.
    expect(result.topicResults).toHaveLength(3);
  });

  it("тест без блоков не получает ни одного нового поля", () => {
    const { result } = buildResultContext(
      storedResult([storedTopic("Тема", true)]),
      "Тест",
      measures(null),
    );
    expect("topicGroups" in result).toBe(false);
    expect("ungroupedTopics" in result).toBe(false);
    expect(result.topicResults).toHaveLength(1);
  });

  it("материал экрана нечитаем — экран прежний, без блоков", () => {
    const { result } = buildResultContext(storedResult([storedTopic("Тема", true, "knowledge")]), "Тест");
    expect(result.topicGroups).toBeUndefined();
  });
});

describe("веб-хост: вход отчёта несёт то же, что экран", () => {
  it("везёт список блоков теста и ключ блока темы", () => {
    const input = buildReportInput(
      storedResult([storedTopic("Знание 1", true, "knowledge")]),
      "Тест",
      {},
      measures(GROUPS),
    );
    expect(input.result.sectionGroups).toEqual(GROUPS);
    expect(input.result.topicResults[0].groupKey).toBe("knowledge");
  });

  it("тест без блоков — вход отчёта прежний", () => {
    const input = buildReportInput(storedResult([storedTopic("Тема", true)]), "Тест", {}, measures(null));
    expect(input.result.sectionGroups).toBeUndefined();
    expect(input.result.topicResults[0].groupKey).toBeUndefined();
  });
});

// ─── Пакет SCORM: выпечка ────────────────────────────────────────────────────

const question = (id: string) => ({
  id, topicId: "t1", type: "single", prompt: `Q ${id}`,
  dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
  difficulty: 50, mediaUrl: null, mediaType: null, feedback: null,
  feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
  tags: [], createdAt: new Date(), updatedAt: new Date(),
});

function bake(sectionGroupsJson: unknown, groupKey: string | null) {
  const topic = {
    id: "t1", name: "Тема", description: "", feedback: null,
    createdAt: new Date(), updatedAt: new Date(),
  };
  const data = {
    test: {
      id: "test1", title: "Тест", description: "", mode: "standard",
      showDifficultyLevel: true, overallPassRuleJson: { type: "percent", value: 70 },
      webhookUrl: null, feedback: null, timeLimitMinutes: null, maxAttempts: null,
      showCorrectAnswers: true, startPageContent: null, published: true, status: "published",
      folderId: null, designSettingsJson: { templateId: "default", params: {} },
      sectionGroupsJson,
      createdAt: new Date(), updatedAt: new Date(),
    },
    sections: [{
      id: "s1", testId: "test1", topicId: "t1", drawCount: 1, sortOrder: 0,
      required: true, topicPassRuleJson: null, timeLimitMinutes: null, feedbackJson: null,
      groupKey,
      topic, questions: [question("a")], courses: [], events: [],
    }],
    adaptiveSettings: null, contentPages: [],
    designSettings: { templateId: "default", params: {} },
    telemetry: null,
  };
  return JSON.parse(buildTestJson(data as unknown as ExportData)) as {
    sectionGroups?: unknown;
    sections: Array<Record<string, unknown>>;
  };
}

describe("пакет SCORM: блоки разделов выпекаются в TEST_DATA", () => {
  it("несёт список блоков теста и ключ блока у раздела", () => {
    const baked = bake(GROUPS, "knowledge");
    expect(baked.sectionGroups).toEqual(GROUPS);
    expect(baked.sections[0].groupKey).toBe("knowledge");
  });

  it("тест без блоков даёт БАЙТ-В-БАЙТ прежний TEST_DATA", () => {
    // Ни ключа `sectionGroups` у теста, ни `groupKey` у раздела: пакеты тестов, которые
    // блоков не заводили, обязаны остаться прежними (FR-02).
    const baked = bake(null, null);
    expect("sectionGroups" in baked).toBe(false);
    expect("groupKey" in baked.sections[0]).toBe(false);
  });

  it("пустой список блоков — тоже отсутствие блоков", () => {
    expect("sectionGroups" in bake([], null)).toBe(false);
  });
});

// ─── Пакет SCORM: рантайм ────────────────────────────────────────────────────

const runtime = (file: string) =>
  readFileSync(resolve(process.cwd(), "server/scorm/template/app", file), "utf8");

describe("пакет SCORM: рантайм передаёт блоки в сборщик", () => {
  const viewSrc = runtime("render/viewResults.js");
  const resultsSrc = runtime("render/resultsPage.js");
  const pdfSrc = runtime("utils/pdfExport.js");

  it("оба экрана итогов кладут список блоков во ВХОД сборщика", () => {
    // Два вызова `buildResultContext` — финиш и «Мой результат»; пропуск одного читается
    // как «блоки то есть, то нет» и ничем другим не ловится.
    expect(viewSrc.match(/input\.sectionGroups = TEST_DATA\.sectionGroups/g)).toHaveLength(2);
    expect(viewSrc.match(/groupKey: vrTopicGroupKey\(tr\)/g)).toHaveLength(2);
  });

  it("отчёт пакета собирается из тех же блоков, что экран", () => {
    expect(pdfSrc).toMatch(/input\.sectionGroups = TEST_DATA\.sectionGroups/);
    expect(pdfSrc).toMatch(/vrTopicGroupKey\(tr\)/);
  });

  it("тема, уходящая в suspend_data, несёт ключ блока", () => {
    const mapped = resultsSrc.match(/topicResults: agg\.topicResults\.map\([\s\S]*?\n {4}\}\)/);
    const fnSrc = mapped?.[0]?.replace(/^topicResults: agg\.topicResults\.map\(/, "").replace(/\)$/, "");
    if (!fnSrc) throw new Error("topicResults mapper function not found");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const mapper = new Function(`return (${fnSrc});`)() as (t: unknown) => Record<string, unknown>;

    expect(mapper({ breakdown: [], extra: {}, groupKey: "knowledge" }).groupKey).toBe("knowledge");
    // Раздел без блока не пишет ключа вовсе: `JSON.stringify` гасит `undefined`, и
    // попытка теста без блоков весит ровно столько же, сколько весила.
    const withoutGroup = mapper({ breakdown: [], extra: {} });
    expect(JSON.stringify(withoutGroup)).not.toContain("groupKey");
  });

  it("ключ блока темы читается с самой темы, а при её молчании — из раздела пакета", () => {
    const match = viewSrc.match(/function vrTopicGroupKey\([\s\S]*?\n\}/);
    if (!match) throw new Error("vrTopicGroupKey not found in viewResults.js");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function("TEST_DATA", `${match[0]}\n;return vrTopicGroupKey;`)({
      sections: [{ topicId: "law", groupKey: "knowledge" }],
    }) as (tr: unknown) => string | null;

    expect(fn({ topicId: "law", groupKey: "competencies" })).toBe("competencies");
    // Попытка, сохранённая ДО пересборки пакета, ключа на теме не несёт — раздел несёт.
    expect(fn({ topicId: "law" })).toBe("knowledge");
    expect(fn({ topicId: "unknown" })).toBeNull();
  });
});
