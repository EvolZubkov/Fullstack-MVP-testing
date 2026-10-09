/**
 * Tests for analytics/helpers.ts (pure functions) and analytics/test-details route
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { observationsDouble } from "./helpers/observations-double";
import express from "express";
import session from "express-session";

// ─── Pure function tests (no mocks needed) ────────────────────────────────────
import {
  formatQuestionType,
  formatAllOptions,
  formatCorrectAnswerText,
  formatUserAnswerText,
} from "../server/routes/analytics/helpers";

describe("formatQuestionType", () => {
  it("returns Russian label for known types", () => {
    expect(formatQuestionType("single")).toBe("Один ответ");
    expect(formatQuestionType("multiple")).toBe("Несколько ответов");
    expect(formatQuestionType("matching")).toBe("Сопоставление");
    expect(formatQuestionType("ranking")).toBe("Ранжирование");
  });

  it("returns the type string as-is for unknown types", () => {
    expect(formatQuestionType("unknown_type")).toBe("unknown_type");
    expect(formatQuestionType("")).toBe("");
  });
});

describe("formatAllOptions", () => {
  it("returns empty string for null dataJson", () => {
    expect(formatAllOptions("single", null)).toBe("");
    expect(formatAllOptions("single", undefined)).toBe("");
  });

  it("formats single/multiple options as numbered list", () => {
    const data = { options: ["Alpha", "Beta", "Gamma"] };
    const result = formatAllOptions("single", data);
    expect(result).toBe("1) Alpha\n2) Beta\n3) Gamma");
  });

  it("formats multiple options the same way", () => {
    const data = { options: ["A", "B"] };
    expect(formatAllOptions("multiple", data)).toBe("1) A\n2) B");
  });

  it("formats matching as left/right lists", () => {
    const data = { left: ["Cat", "Dog"], right: ["Meow", "Woof"] };
    const result = formatAllOptions("matching", data);
    expect(result).toContain("Левая: 1. Cat, 2. Dog");
    expect(result).toContain("Правая: A. Meow, B. Woof");
  });

  it("formats ranking as numbered items", () => {
    const data = { items: ["First", "Second", "Third"] };
    const result = formatAllOptions("ranking", data);
    expect(result).toBe("1) First\n2) Second\n3) Third");
  });

  it("returns JSON string for unknown type", () => {
    const data = { foo: "bar" };
    const result = formatAllOptions("unknown", data);
    expect(result).toBe(JSON.stringify(data));
  });
});

describe("formatCorrectAnswerText", () => {
  it("returns empty string for null correctJson", () => {
    expect(formatCorrectAnswerText("single", {}, null)).toBe("");
  });

  it("formats single correct answer", () => {
    const data = { options: ["Alpha", "Beta", "Gamma"] };
    const correct = { correctIndex: 1 };
    expect(formatCorrectAnswerText("single", data, correct)).toBe("2) Beta");
  });

  it("formats multiple correct answers", () => {
    const data = { options: ["A", "B", "C"] };
    const correct = { correctIndices: [0, 2] };
    expect(formatCorrectAnswerText("multiple", data, correct)).toBe("1) A, 3) C");
  });

  it("formats matching pairs", () => {
    const data = { left: ["Cat", "Dog"], right: ["Meow", "Woof"] };
    const correct = { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }] };
    const result = formatCorrectAnswerText("matching", data, correct);
    expect(result).toBe("Cat → Meow, Dog → Woof");
  });

  it("formats ranking order", () => {
    const data = { items: ["First", "Second", "Third"] };
    const correct = { correctOrder: [2, 0, 1] };
    const result = formatCorrectAnswerText("ranking", data, correct);
    expect(result).toBe("1. Third, 2. First, 3. Second");
  });

  it("returns JSON for missing data fields", () => {
    const correct = { correctIndex: 0 };
    const result = formatCorrectAnswerText("single", {}, correct);
    expect(result).toBe(JSON.stringify(correct));
  });
});

describe("formatUserAnswerText", () => {
  it("returns (нет ответа) for null/undefined", () => {
    expect(formatUserAnswerText("single", {}, null)).toBe("(нет ответа)");
    expect(formatUserAnswerText("single", {}, undefined)).toBe("(нет ответа)");
  });

  it("formats single user answer", () => {
    const data = { options: ["Alpha", "Beta"] };
    expect(formatUserAnswerText("single", data, 0)).toBe("1) Alpha");
    expect(formatUserAnswerText("single", data, 1)).toBe("2) Beta");
  });

  it("formats multiple user answers", () => {
    const data = { options: ["A", "B", "C"] };
    expect(formatUserAnswerText("multiple", data, [0, 2])).toBe("1) A, 3) C");
  });

  it("returns (ничего не выбрано) for empty multiple answer", () => {
    const data = { options: ["A", "B"] };
    expect(formatUserAnswerText("multiple", data, [])).toBe("(ничего не выбрано)");
  });

  it("formats matching user answer", () => {
    const data = { left: ["Cat", "Dog"], right: ["Meow", "Woof"] };
    const answer = { "0": 0, "1": 1 };
    const result = formatUserAnswerText("matching", data, answer);
    expect(result).toContain("Cat → Meow");
    expect(result).toContain("Dog → Woof");
  });

  it("formats ranking user answer", () => {
    const data = { items: ["A", "B", "C"] };
    expect(formatUserAnswerText("ranking", data, [2, 0, 1])).toBe("1. C, 2. A, 3. B");
  });

  it("falls back to String() for unrecognised type", () => {
    expect(formatUserAnswerText("unknown", {}, 42)).toBe("42");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST-DETAILS ROUTE
// ─────────────────────────────────────────────────────────────────────────────
const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(), getUserRoles: vi.fn().mockResolvedValue(["administrator"]), getTest: vi.fn(), getAllAttempts: vi.fn(), async getAttemptsByTests(ids: string[]) { return ((await this.getAllAttempts()) ?? []).filter((a: { testId: string }) => ids.includes(a.testId)); },
    // PRD-56 FR-33: страница теста читает прохождения через выборку DAL.
    selectObservations: vi.fn(),
    // PRD-56 FR-25: ответы прохождений из LMS — часть выборки страницы теста.
    selectAnswersForTest: vi.fn().mockResolvedValue([]),
    getQuestionsByIds: vi.fn(), getTopics: vi.fn(),
    // PRD-15 block D: effective-scoring chain sources (no overrides by default).
    getTestSections: vi.fn(), getTestQuestionScoring: vi.fn(),
    // PRD-56 FR-21: признак «у теста есть шкалы» — по нему экран показывает вкладку «Шкалы».
    getScales: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
  }
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

import testDetailsRouter from "../server/routes/analytics/test-details";

const authorUser = {
  id: "author1", email: "a@test.com", name: "Author", role: "author",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};

function makeApp(router: express.Router, path: string) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use(path, router);
  return app;
}

function asAuthor(req: request.Test) { return req.set("x-test-user", "author1"); }

const dbQuestion = {
  id: "q1", topicId: "t1", type: "single", prompt: "What is JS?",
  dataJson: { options: ["A lang", "A food"] }, correctJson: { correctIndex: 0 },
  points: 5, difficulty: 50, shuffleAnswers: true,
};

const makeAttempt = (overrides: any = {}) => ({
  id: "atmp1", testId: "test1", userId: "u1",
  variantJson: { sections: [{ topicId: "t1", topicName: "JS", questionIds: ["q1"] }] },
  answersJson: { q1: 0 },
  resultJson: {
    totalCorrect: 1, totalQuestions: 1, overallPercent: 100,
    totalEarnedPoints: 5, totalPossiblePoints: 5, overallPassed: true,
    topicResults: [{
      topicId: "t1", topicName: "JS", correct: 1, total: 1,
      earnedPoints: 5, possiblePoints: 5, percent: 100, passed: true,
    }],
  },
  startedAt: new Date(Date.now() - 120000),
  finishedAt: new Date(),
  testVersion: 1,
  ...overrides,
});

describe("Analytics test-details route", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
    storageMock.getUser.mockResolvedValue(authorUser);
    // Разрезы по темам читают секции теста: порог темы разрешается их правилом (PRD-56 FR-14).
    storageMock.getTestSections.mockResolvedValue([]);
    storageMock.getTestQuestionScoring.mockResolvedValue([]);
    app = makeApp(testDetailsRouter, "/api/analytics");
  });

  it("GET /:testId — returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/analytics/test1");
    expect(res.status).toBe(401);
  });

  it("GET /:testId — returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    storageMock.getAllAttempts.mockResolvedValue([]);
    const res = await asAuthor(request(app).get("/api/analytics/x"));
    expect(res.status).toBe(404);
  });

  it("GET /:testId — returns full analytics for standard test", async () => {
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "Test 1", mode: "standard" });
    storageMock.getAllAttempts.mockResolvedValue([makeAttempt()]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    const res = await asAuthor(request(app).get("/api/analytics/test1"));
    expect(res.status).toBe(200);
    expect(res.body.testTitle).toBe("Test 1");
    expect(res.body.summary.completedAttempts).toBe(1);
    expect(res.body.summary.passRate).toBe(100);
    expect(res.body.summary.avgPercent).toBe(100);
    expect(res.body.topicStats).toHaveLength(1);
    expect(res.body.topicStats[0].topicName).toBe("JS");
    expect(res.body.questionStats).toHaveLength(1);
    expect(res.body.questionStats[0].correctPercent).toBe(100);
    expect(res.body.scoreDistribution).toHaveLength(10);
    expect(res.body.passTrend).toHaveLength(1);
    // levelStats only present for adaptive
    expect(res.body.levelStats).toBeUndefined();
  });

  it("GET /:testId — zero stats when no completed attempts", async () => {
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "Test 1", mode: "standard" });
    storageMock.getAllAttempts.mockResolvedValue([]);
    storageMock.getQuestionsByIds.mockResolvedValue([]);
    storageMock.getTopics.mockResolvedValue([]);
    const res = await asAuthor(request(app).get("/api/analytics/test1"));
    expect(res.status).toBe(200);
    expect(res.body.summary.totalAttempts).toBe(0);
    // `null`, not `0`: there is no average of an empty set, and «0 % сдали» over
    // nobody reads as a failed test rather than an unused one (PRD-29 §6.7 gave the
    // grade-shaped metrics an explicit «неприменимо»; `avgDuration` always had one).
    expect(res.body.summary.passRate).toBeNull();
    expect(res.body.summary.avgDuration).toBeNull();
    expect(res.body.questionStats).toHaveLength(0);
  });

  it("GET /:testId — counts score distribution correctly", async () => {
    const attempts = [
      makeAttempt({ id: "a1", resultJson: { ...makeAttempt().resultJson, overallPercent: 15 } }),
      makeAttempt({ id: "a2", resultJson: { ...makeAttempt().resultJson, overallPercent: 75 } }),
      makeAttempt({ id: "a3", resultJson: { ...makeAttempt().resultJson, overallPercent: 95 } }),
    ];
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "T", mode: "standard" });
    storageMock.getAllAttempts.mockResolvedValue(attempts);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    const res = await asAuthor(request(app).get("/api/analytics/test1"));
    expect(res.status).toBe(200);
    // PRD-56 FR-13a: корзины одной ширины, нижняя граница включается, верхняя — нет.
    const dist = res.body.scoreDistribution;
    const at = (label: string) => dist.find((b: any) => b.label === label).count;
    expect(at("10–19")).toBe(1);
    expect(at("70–79")).toBe(1);
    expect(at("90–100")).toBe(1);
  });

  it("GET /:testId — includes levelStats for adaptive test", async () => {
    const adaptiveResult = {
      overallPassed: true, overallPercent: 80,
      totalEarnedPoints: 8, totalPossiblePoints: 10,
      topicResults: [{
        topicId: "t1", topicName: "JS",
        achievedLevelIndex: 2, achievedLevelName: "Advanced",
        levelsAttempted: [
          { levelIndex: 0, levelName: "Beginner", status: "passed", correctCount: 3, questionsAnswered: 4 },
          { levelIndex: 1, levelName: "Intermediate", status: "passed", correctCount: 4, questionsAnswered: 5 },
        ],
      }],
    };
    const adaptiveAttempt = makeAttempt({
      variantJson: { mode: "adaptive", topics: [{
        topicId: "t1", levelsState: [{ questionIds: ["q1"] }]
      }] },
      resultJson: adaptiveResult,
    });
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "T", mode: "adaptive" });
    storageMock.getAllAttempts.mockResolvedValue([adaptiveAttempt]);
    storageMock.getQuestionsByIds.mockResolvedValue([]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    const res = await asAuthor(request(app).get("/api/analytics/test1"));
    expect(res.status).toBe(200);
    expect(res.body.levelStats).toBeDefined();
    expect(res.body.levelStats.length).toBeGreaterThan(0);
    const achievedLevel = res.body.levelStats.find((l: any) => l.levelIndex === 2);
    expect(achievedLevel).toBeDefined();
    expect(achievedLevel.achievedCount).toBe(1);
  });

  it("GET /:testId — question stats: wrong answer is not counted as correct", async () => {
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "T", mode: "standard" });
    storageMock.getAllAttempts.mockResolvedValue([makeAttempt({ answersJson: { q1: 1 } })]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    const res = await asAuthor(request(app).get("/api/analytics/test1"));
    expect(res.status).toBe(200);
    expect(res.body.questionStats[0].correctAnswers).toBe(0);
    expect(res.body.questionStats[0].correctPercent).toBe(0);
  });
});

/**
 * PRD-57 FR-32, Э10. До этого новые типы доезжали до колонок аналитики сырым JSON: тип
 * печатался как `short`, содержимое и эталон — как `{"answerKind":"text",…}`, а ответ на
 * задание с пропусками — как `[object Object]`.
 */
describe("текстовые типы в колонках аналитики (PRD-57 FR-32)", () => {
  const rules = {
    answerKind: "text",
    join: "any",
    rules: [
      { kind: "text", match: "wildcard", value: "Федеральная служба по * надзору" },
      { kind: "text", match: "regex", value: "^РТН$" },
    ],
  };
  const numericRules = {
    answerKind: "number",
    join: "all",
    unit: "°C",
    rules: [{ kind: "number", op: "eq", value: -25, tolerance: { unit: "abs", value: 2 } }],
  };
  const blanks = {
    blanks: [
      { id: "city", answerKind: "text", join: "any", rules: [{ kind: "text", match: "wildcard", value: "Москва" }] },
      { id: "year", answerKind: "number", join: "any", rules: [{ kind: "number", op: "eq", value: 1703 }] },
    ],
  };

  it("тип называется словами", () => {
    expect(formatQuestionType("short")).toBe("Короткий ответ");
    expect(formatQuestionType("blanks")).toBe("Пропуски");
    expect(formatQuestionType("long")).toBe("Развёрнутый ответ");
  });

  it("содержимое: предел и единица у короткого, перечень пропусков, прочерк у развёрнутого", () => {
    expect(formatAllOptions("short", { maxLength: 120 })).toContain("120");
    expect(formatAllOptions("blanks", {}, blanks)).toBe("Пропуски: city, year");
    expect(formatAllOptions("long", { placeholder: "Своими словами" })).toBe("—");
  });

  it("эталон — правила словами, а не JSON", () => {
    const text = formatCorrectAnswerText("short", {}, rules);
    expect(text).toContain("Федеральная служба по * надзору");
    expect(text).not.toContain("wildcard");
    const numeric = formatCorrectAnswerText("short", {}, numericRules);
    expect(numeric).toContain("от -27 до -23 °C");
  });

  it("эталон пропусков называет каждое поле", () => {
    const text = formatCorrectAnswerText("blanks", {}, blanks);
    expect(text).toContain("city");
    expect(text).toContain("Москва");
    expect(text).toContain("1703");
  });

  it("у задания без правил и у развёрнутого ответа эталона нет — прочерк", () => {
    expect(formatCorrectAnswerText("short", {}, { answerKind: "text", join: "any", rules: [] })).toBe("—");
    expect(formatCorrectAnswerText("long", {}, {})).toBe("—");
  });

  it("ответ участника печатается как набран, а пропуски — по именам", () => {
    expect(formatUserAnswerText("short", {}, "Ростехнадзор")).toBe("Ростехнадзор");
    expect(formatUserAnswerText("long", {}, "Сначала обесточить.")).toBe("Сначала обесточить.");
    expect(formatUserAnswerText("blanks", {}, { city: "Москва", year: "1703" }))
      .toBe("city: Москва, year: 1703");
  });

  it("незаполненный пропуск виден пустым, а не пропадает", () => {
    expect(formatUserAnswerText("blanks", {}, { city: "Москва", year: "" }))
      .toBe("city: Москва, year: (нет ответа)");
  });
});
