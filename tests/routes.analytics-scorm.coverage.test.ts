/**
 * Branch-coverage tests for server/routes/analytics/scorm.ts.
 *
 * Complements routes.scorm-telemetry-analytics.test.ts (happy path): here we drive
 * the conditional branches — analytics-scope filtering (admin vs author, deleted
 * packages), the missing-package fallbacks, the 403 on a single attempt, the
 * topic rollup with/without topicId and correct/incorrect rows, null-field
 * fallbacks, and the three achievedLevelsJson shapes (object / valid string /
 * invalid string), plus the catch/500 paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getAllScormAttempts: vi.fn().mockResolvedValue([]),
    getScormPackages: vi.fn().mockResolvedValue([]),
    getScormAnswersByAttempt: vi.fn().mockResolvedValue([]),
    getScormAttempt: vi.fn(),
    getScormPackage: vi.fn(),
    // Object-level scope resolution (author owner/grant paths).
    // PRD-2/PRD-5: analytics recomputes scale contributions and indicators from
    // the test's CURRENT config, so `loadScoringConfig` reads these three. Absent
    // stubs made every detail route answer 500 (`source.getScales is not a function`).
    getScales: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    // PRD-50: the detail route rebuilds the attempt's breakdowns from the live question
    // tags and reads topic codes for the composite «<section>::<key>» addressing. Absent
    // stubs made every detail route answer 500 again.
    getQuestionsByIds: vi.fn().mockResolvedValue([]),
    getTopics: vi.fn().mockResolvedValue([]),
    // D5: тест строки читается по её собственному `test_id`, а не только через пакет.
    getTest: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

import scormRouter from "../server/routes/analytics/scorm";

// ─── App factory ──────────────────────────────────────────────────────────────
const authorUser = {
  id: "author1", email: "a@test.com", name: "Author", role: "author",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/analytics", scormRouter);
  return app;
}

function asAuthor(req: request.Test) { return req.set("x-test-user", "author1"); }

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const pkgOwned = { id: "pkg1", testId: "test1", testTitle: "Test 1", testMode: "standard" };
const pkgOther = { id: "pkg2", testId: "testOther", testTitle: "Other", testMode: "adaptive" };

const baseAttempt = {
  id: "sa1", packageId: "pkg1", sessionId: "sess1",
  lmsUserId: "lms1", lmsUserName: "LMS User", lmsUserEmail: "lms@x.com", lmsUserOrg: null,
  startedAt: new Date(Date.now() - 60000), finishedAt: new Date(),
  resultPercent: 90, resultPassed: true, totalPoints: 9, maxPoints: 10,
  totalQuestions: 5, correctAnswers: 4, achievedLevelsJson: null,
};

let app: express.Express;
beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getAllScormAttempts.mockResolvedValue([]);
  storageMock.getScormPackages.mockResolvedValue([]);
  storageMock.getScormAnswersByAttempt.mockResolvedValue([]);
  storageMock.getTestIdsByOwner.mockResolvedValue([]);
  storageMock.getUserTestGrants.mockResolvedValue([]);
  storageMock.getUser.mockResolvedValue(authorUser);
  storageMock.getQuestionsByIds.mockResolvedValue([]);
  storageMock.getTopics.mockResolvedValue([]);
  storageMock.getTest.mockResolvedValue(undefined);
  storageMock.getResultVariables.mockResolvedValue([]);
  app = makeApp();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /scorm-attempts
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /scorm-attempts", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/analytics/scorm-attempts");
    expect(res.status).toBe(401);
  });

  it("admin sees deleted-package attempts with fallbacks", async () => {
    const withPkg = { ...baseAttempt, id: "sa1", packageId: "pkg1" };
    const orphan = { ...baseAttempt, id: "sa2", packageId: "missing" };
    storageMock.getAllScormAttempts.mockResolvedValue([withPkg, orphan]);
    storageMock.getScormPackages.mockResolvedValue([pkgOwned]);
    storageMock.getScormAnswersByAttempt.mockResolvedValue([{ id: "x" }]);

    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const byId = Object.fromEntries(res.body.map((a: any) => [a.id, a]));
    expect(byId.sa1.testId).toBe("test1");
    expect(byId.sa1.answersCount).toBe(1);
    // Orphaned attempt -> deleted-test fallbacks.
    expect(byId.sa2.testId).toBeNull();
    expect(byId.sa2.testTitle).toBe("Удалённый тест");
    expect(byId.sa2.testMode).toBe("standard");
    expect(byId.sa2.source).toBe("lms");
  });

  it("author scope filters out unreadable and orphaned attempts", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTestIdsByOwner.mockResolvedValue(["test1"]); // owns test1 only
    const kept = { ...baseAttempt, id: "sa1", packageId: "pkg1" };
    const otherTest = { ...baseAttempt, id: "sa2", packageId: "pkg2" };
    const orphan = { ...baseAttempt, id: "sa3", packageId: "missing" };
    storageMock.getAllScormAttempts.mockResolvedValue([kept, otherTest, orphan]);
    storageMock.getScormPackages.mockResolvedValue([pkgOwned, pkgOther]);

    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].testId).toBe("test1");
  });

  it("returns 500 when loading throws", async () => {
    storageMock.getAllScormAttempts.mockRejectedValue(new Error("db down"));
    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get SCORM attempts");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /scorm-attempts/:attemptId
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /scorm-attempts/:attemptId", () => {
  it("returns 404 when the attempt is not found", async () => {
    storageMock.getScormAttempt.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/x"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when scope excludes the (deleted-package) attempt for a non-admin", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getScormAttempt.mockResolvedValue({ ...baseAttempt, packageId: "missing" });
    storageMock.getScormPackage.mockResolvedValue(undefined); // deleted package -> testId null
    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/sa1"));
    expect(res.status).toBe(403);
  });

  it("details answers with topic rollup, correct/incorrect and null-point fallbacks", async () => {
    storageMock.getScormAttempt.mockResolvedValue({
      ...baseAttempt, achievedLevelsJson: { levels: [1, 2] },
    });
    storageMock.getScormPackage.mockResolvedValue(pkgOwned);
    storageMock.getScormAnswersByAttempt.mockResolvedValue([
      { questionId: "q1", questionPrompt: "A?", questionType: "single", topicId: "t1", topicName: "JS",
        difficulty: 50, userAnswerJson: 0, correctAnswerJson: 0, isCorrect: true, points: 2, maxPoints: 3,
        optionsJson: null, leftItemsJson: null, rightItemsJson: null, itemsJson: null,
        levelIndex: null, levelName: null, answeredAt: new Date() },
      // incorrect, maxPoints null -> +1, points null -> +0, topicName null -> "Unknown"
      { questionId: "q2", questionPrompt: "B?", questionType: "single", topicId: "t1", topicName: null,
        difficulty: 50, userAnswerJson: 1, correctAnswerJson: 0, isCorrect: false, points: null, maxPoints: null,
        optionsJson: null, leftItemsJson: null, rightItemsJson: null, itemsJson: null,
        levelIndex: null, levelName: null, answeredAt: new Date() },
      // no topicId -> excluded from the topic rollup
      { questionId: "q3", questionPrompt: "C?", questionType: "single", topicId: null, topicName: null,
        difficulty: 50, userAnswerJson: 0, correctAnswerJson: 0, isCorrect: true, points: 1, maxPoints: 1,
        optionsJson: null, leftItemsJson: null, rightItemsJson: null, itemsJson: null,
        levelIndex: null, levelName: null, answeredAt: new Date() },
    ]);

    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/sa1"));
    expect(res.status).toBe(200);
    expect(res.body.answers).toHaveLength(3);
    expect(res.body.topicResults).toHaveLength(1); // only t1 rows rolled up
    const t1 = res.body.topicResults[0];
    expect(t1.earnedPoints).toBe(2);      // 2 + 0
    expect(t1.possiblePoints).toBe(4);    // 3 + (null->1)
    expect(t1.percent).toBe(50);          // 2/4
    expect(res.body.achievedLevels).toEqual({ levels: [1, 2] }); // object passthrough
    expect(res.body.duration).toBeGreaterThan(0);
  });

  it("parses achievedLevelsJson when it is a valid JSON string", async () => {
    storageMock.getScormAttempt.mockResolvedValue({
      ...baseAttempt, achievedLevelsJson: '[{"topicId":"t1","levelIndex":2}]',
    });
    storageMock.getScormPackage.mockResolvedValue(pkgOwned);
    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/sa1"));
    expect(res.status).toBe(200);
    expect(res.body.achievedLevels).toEqual([{ topicId: "t1", levelIndex: 2 }]);
  });

  it("falls back to null when achievedLevelsJson is an invalid JSON string", async () => {
    storageMock.getScormAttempt.mockResolvedValue({
      ...baseAttempt, achievedLevelsJson: "{not valid json",
    });
    storageMock.getScormPackage.mockResolvedValue(pkgOwned);
    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/sa1"));
    expect(res.status).toBe(200);
    expect(res.body.achievedLevels).toBeNull();
  });

  it("applies null-field fallbacks with a deleted package", async () => {
    storageMock.getScormAttempt.mockResolvedValue({
      ...baseAttempt, packageId: "missing",
      startedAt: null, finishedAt: null,
      resultPercent: null, resultPassed: null, totalPoints: null, maxPoints: null,
      achievedLevelsJson: null,
    });
    storageMock.getScormPackage.mockResolvedValue(undefined); // admin -> has(null) allowed
    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/sa1"));
    expect(res.status).toBe(200);
    expect(res.body.duration).toBeNull();
    expect(res.body.overallPercent).toBe(0);
    expect(res.body.earnedPoints).toBe(0);
    expect(res.body.possiblePoints).toBe(0);
    expect(res.body.passed).toBe(false);
    expect(res.body.startedAt).toBeNull();
    expect(res.body.testId).toBeNull();
    expect(res.body.testTitle).toBe("Удалённый тест");
    expect(res.body.testMode).toBe("standard");
    expect(res.body.achievedLevels).toBeNull();
  });

  it("returns 500 when loading throws", async () => {
    storageMock.getScormAttempt.mockRejectedValue(new Error("db down"));
    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/sa1"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get attempt details");
  });
});

/**
 * D5: импортированное прохождение пакета не имеет — тест у него свой (`scorm_attempts.test_id`),
 * а вариантов в отчёте LMS нет. Раньше тест искался только через пакет: автору такое
 * прохождение отвечало 403, администратору показывалось «Удалённым тестом», ответ — «0».
 */
describe("GET /scorm-attempts/:attemptId — импортированное прохождение (D5)", () => {
  const imported = {
    ...baseAttempt, id: "imp1", packageId: null, testId: "test1", origin: "import",
    lmsUserName: "Иванов Пётр",
  };
  const answerRow = {
    questionId: "q1", questionPrompt: "Срок хранения?", questionType: "single", topicId: "t1", topicName: null,
    difficulty: null, userAnswerJson: 1, correctAnswerJson: null, isCorrect: false, result: "incorrect",
    points: null, maxPoints: null,
    optionsJson: null, leftItemsJson: null, rightItemsJson: null, itemsJson: null,
    levelIndex: null, levelName: null, answeredAt: new Date(),
  };

  beforeEach(() => {
    storageMock.getScormAttempt.mockResolvedValue(imported);
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "Охрана труда", mode: "standard" });
    storageMock.getScormAnswersByAttempt.mockResolvedValue([answerRow]);
    storageMock.getQuestionsByIds.mockResolvedValue([{
      id: "q1", type: "single", tags: null,
      dataJson: { options: ["Один год", "Десять лет"] }, correctJson: { correctIndex: 1 },
    }]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "Документы", code: null }]);
  });

  it("открывается автору теста — область видимости по тесту строки, а не пакета", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTestIdsByOwner.mockResolvedValue(["test1"]);

    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/imp1"));

    expect(res.status).toBe(200);
    expect(res.body.testId).toBe("test1");
    expect(res.body.testTitle).toBe("Охрана труда");
    expect(storageMock.getScormPackage).not.toHaveBeenCalled();
  });

  it("закрыт автору чужого теста", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTestIdsByOwner.mockResolvedValue(["other"]);

    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/imp1"));

    expect(res.status).toBe(403);
  });

  it("без снимка вариантов отдаёт данные вопроса, эталон и тему", async () => {
    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/imp1"));

    const answer = res.body.answers[0];
    expect(answer.questionData).toEqual({ options: ["Один год", "Десять лет"] });
    expect(answer.correctAnswer).toEqual({ correctIndex: 1 });
    expect(answer.topicName).toBe("Документы");
  });

  it("со снимком вариантов данные вопроса не подменяют то, что видел участник", async () => {
    storageMock.getScormAnswersByAttempt.mockResolvedValue([{ ...answerRow, optionsJson: ["Год", "Десятилетие"] }]);

    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/imp1"));

    expect(res.body.answers[0].questionData).toBeUndefined();
    expect(res.body.answers[0].options).toEqual(["Год", "Десятилетие"]);
  });

  it("протокол пишет ответ словами, а пустые баллы — пустой ячейкой", async () => {
    const binary = (r: any, cb: (err: Error | null, body: Buffer) => void) => {
      const chunks: Buffer[] = [];
      r.on("data", (chunk: Buffer) => chunks.push(chunk));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    };

    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/imp1/export/excel"))
      .buffer(true).parse(binary);

    const { readWorkbookFromBuffer, sheetToArrays } = await import("../server/utils/excel");
    const workbook = await readWorkbookFromBuffer(res.body as Buffer);
    const row = sheetToArrays(workbook.getWorksheet("Ответы")!)[1];
    expect(row.slice(1, 7)).toEqual(["Документы", "Один ответ", "2) Десять лет", "2) Десять лет", "Неверно", ""]);
  });
});

/** D3: протокол прохождения из LMS книгой — варианты из снимка, пришедшего с ответом. */
describe("GET /scorm-attempts/:attemptId/export/excel", () => {
  const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  };

  it("отдаёт книгу с ответом словами и вердиктом прохождения", async () => {
    storageMock.getScormAttempt.mockResolvedValue(baseAttempt);
    storageMock.getScormPackage.mockResolvedValue(pkgOwned);
    storageMock.getScormAnswersByAttempt.mockResolvedValue([
      { questionId: "q1", questionPrompt: "A?", questionType: "single", topicId: "t1", topicName: "JS",
        difficulty: 50, userAnswerJson: 1, correctAnswerJson: { correctIndex: 0 }, isCorrect: false,
        result: "incorrect", points: 0, maxPoints: 1,
        optionsJson: ["Да", "Нет"], leftItemsJson: null, rightItemsJson: null, itemsJson: null,
        levelIndex: null, levelName: null, answeredAt: new Date() },
    ]);

    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/sa1/export/excel"))
      .buffer(true).parse(binary);

    expect(res.status).toBe(200);
    const { readWorkbookFromBuffer, sheetToArrays } = await import("../server/utils/excel");
    const workbook = await readWorkbookFromBuffer(res.body as Buffer);
    expect(sheetToArrays(workbook.getWorksheet("Ответы")!)[1].slice(3, 6)).toEqual(["2) Нет", "1) Да", "Неверно"]);
    const summary = Object.fromEntries(sheetToArrays(workbook.getWorksheet("Попытка")!) as Array<[string, unknown]>);
    expect(summary["Участник"]).toBe("LMS User");
    expect(summary["Статус"]).toBe("Сдан");
  });

  it("не выносит вердикт, которого пакет не прислал", async () => {
    storageMock.getScormAttempt.mockResolvedValue({ ...baseAttempt, resultPassed: null });
    storageMock.getScormPackage.mockResolvedValue(pkgOwned);

    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/sa1/export/excel"))
      .buffer(true).parse(binary);

    const { readWorkbookFromBuffer, sheetToArrays } = await import("../server/utils/excel");
    const workbook = await readWorkbookFromBuffer(res.body as Buffer);
    const summary = Object.fromEntries(sheetToArrays(workbook.getWorksheet("Попытка")!) as Array<[string, unknown]>);
    expect(summary["Статус"]).toBe("Без вердикта");
  });

  it("не отдаёт прохождение вне области видимости", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getScormAttempt.mockResolvedValue({ ...baseAttempt, packageId: "missing" });
    storageMock.getScormPackage.mockResolvedValue(undefined);

    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/sa1/export/excel"));

    expect(res.status).toBe(403);
  });
});

describe("GET /scorm-attempts/:attemptId — показатели из сохранённого значения (FR-21e)", () => {
  // The formula yields 99 on any answers: if the route recomputed, the detail would say 99.
  const RV = [{
    name: "idx", label: "Индекс", type: "number", formula: "99", sortOrder: 0,
    learnerVisibility: "level_and_value", scormTarget: "both", controlsStatus: "none",
    configJson: { bands: [{ min: 0, max: 49, level: "low", label: "Низкий" }, { min: 50, max: 100, level: "high", label: "Высокий" }] },
  }];

  beforeEach(() => {
    storageMock.getScormPackage.mockResolvedValue(pkgOwned);
    storageMock.getResultVariables.mockResolvedValue(RV);
  });

  it("reads the value the LMS reported, typed, with its interpretation", async () => {
    storageMock.getScormAttempt.mockResolvedValue({ ...baseAttempt, variablesJson: { idx: "64" } });

    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/sa1"));

    expect(res.status).toBe(200);
    expect(res.body.resultVariables).toEqual({ idx: 64 });
    expect(res.body.indicatorViews).toEqual([
      { name: "idx", label: "Индекс", value: 64, interpretation: "Высокий" },
    ]);
  });

  it("a mask number reported as text reads by the bands of a string indicator (PRD-53 §7.1)", async () => {
    storageMock.getResultVariables.mockResolvedValue([{
      name: "profile", label: "Резюме профиля", type: "string", formula: "x", sortOrder: 0,
      learnerVisibility: "level", scormTarget: "both", controlsStatus: "none",
      configJson: {
        outcomes: [{ code: "cel+pro", label: "Двухвекторный профиль" }],
        bands: [{ min: 9, max: 9, level: "m9", label: "Двухвекторный профиль" }],
      },
    }]);
    storageMock.getScormAttempt.mockResolvedValue({ ...baseAttempt, variablesJson: { profile: "9" } });

    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/sa1"));

    expect(res.body.indicatorViews[0]).toMatchObject({ value: "9", interpretation: "Двухвекторный профиль" });
  });

  it("does not recompute an indicator the LMS did not report", async () => {
    storageMock.getScormAttempt.mockResolvedValue({ ...baseAttempt, variablesJson: null });

    const res = await asAuthor(request(app).get("/api/analytics/scorm-attempts/sa1"));

    expect(res.status).toBe(200);
    expect(res.body.resultVariables).toEqual({});
    expect(res.body.indicatorViews[0]).toMatchObject({ name: "idx", value: null, interpretation: null });
  });
});
