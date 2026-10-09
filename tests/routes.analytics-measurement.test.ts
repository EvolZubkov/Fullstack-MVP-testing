/**
 * @module tests/routes.analytics-measurement
 * @description Author-facing analytics of a MEASUREMENT test (PRD-5 scales +
 * PRD-2 indicators). Until this suite the analytics layer was purely grade-shaped:
 * a questionnaire run was registered as «0.0 % / Сдан» with no trace of what was
 * actually measured, and its detail carried no scales at all even though the very
 * same route computed them. Two contracts are pinned here:
 *
 *  1. the run's MEASUREMENTS travel — per attempt, read off what was STORED at
 *     finish (what the learner actually got), with the test's scale/indicator
 *     labels alongside so a table can name its columns;
 *  2. PRD-29 §6.7 reaches the AUTHOR too — a run with nothing to grade carries no
 *     verdict, so analytics stops printing a green «Сдан» over zero points.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { observationsDouble } from "./helpers/observations-double";
import express from "express";
import session from "express-session";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getTest: vi.fn(),
    // The test-level book is the general one: it reads the tests directory and org spellings.
    getTests: vi.fn().mockResolvedValue([]),
    selectOrgSpellings: vi.fn().mockResolvedValue({ organization: [], unit: [], position: [] }),
    getAllAttempts: vi.fn(), async getAttemptsByTests(ids: string[]) { return ((await this.getAllAttempts()) ?? []).filter((a: { testId: string }) => ids.includes(a.testId)); },
    // PRD-56 FR-33: страница теста читает прохождения через выборку DAL.
    selectObservations: vi.fn(),
    // PRD-56 FR-25: ответы прохождений из LMS — часть выборки страницы теста.
    selectAnswersForTest: vi.fn().mockResolvedValue([]),
    getAttempt: vi.fn(),
    getQuestionsByIds: vi.fn().mockResolvedValue([]),
    getTopics: vi.fn().mockResolvedValue([]),
    getTestSections: vi.fn().mockResolvedValue([]),
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    getSnapshotsForTest: vi.fn().mockResolvedValue([]),
    getSnapshot: vi.fn().mockResolvedValue(undefined),
    getTestGrantForUser: vi.fn().mockResolvedValue(undefined),
    getScales: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    isTestAssignedToUser: vi.fn().mockResolvedValue(false),
    // PRD-56 FR-21h: LMS runs of the book and their stored measurements.
    getAllScormAttempts: vi.fn().mockResolvedValue([]),
    getScormPackages: vi.fn().mockResolvedValue([]),
    getScormAttemptMeasures: vi.fn().mockResolvedValue([]),
    getScormAttemptOutcomes: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

import attemptsRouter from "../server/routes/analytics/attempts";
import testDetailsRouter from "../server/routes/analytics/test-details";
import exportRouter from "../server/routes/analytics/export";
import ExcelJS from "exceljs";

const adminUser = {
  id: "admin1", email: "a@test.com", name: "Admin", role: "administrator",
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
  app.use("/api/analytics", attemptsRouter);
  app.use("/api/analytics/tests", testDetailsRouter);
  app.use("/api/analytics", exportRouter);
  return app;
}

const asAdmin = (req: request.Test) => req.set("x-test-user", "admin1");

/** Fetch an .xlsx endpoint as a Buffer (supertest parses text by default). */
function asWorkbook(req: request.Test) {
  return asAdmin(req).buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  });
}

/** Sheet name -> rows of stringified cells, for readable assertions. */
async function sheetRows(body: Buffer, sheetName: string): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body as unknown as ArrayBuffer);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`sheet "${sheetName}" not found`);
  const rows: string[][] = [];
  for (let i = 1; i <= ws.rowCount; i++) {
    const values = ws.getRow(i).values;
    const cells = Array.isArray(values) ? values.slice(1) : [];
    rows.push(cells.map((v) => (v === null || v === undefined ? "" : String(v))));
  }
  return rows;
}

/** A questionnaire: scales, indicators, the DEFAULT 70% threshold, zero points. */
const MEASUREMENT_TEST = {
  id: "test1",
  title: "Опросник ведущего стиля",
  mode: "standard",
  ownerId: null,
  // The default every new test is created with — the whole point of PRD-29 §6.7:
  // the threshold alone must not make a questionnaire look graded.
  overallPassRuleJson: { type: "percent", value: 70 },
};

const SCALE_ROWS = [
  { id: "s2", testId: "test1", key: "kom", label: "Командный", sortOrder: 1, configJson: {}, aggregation: "sum", normalization: "none", direction: "positive" },
  { id: "s1", testId: "test1", key: "cel", label: "Целевой", sortOrder: 0, configJson: {}, aggregation: "sum", normalization: "none", direction: "positive" },
  // Empty label — consumers fall back to the key (the label is optional by design).
  { id: "s3", testId: "test1", key: "pro", label: "", sortOrder: 2, configJson: {}, aggregation: "sum", normalization: "none", direction: "positive" },
];

const RV_ROWS = [
  { id: "rv1", testId: "test1", name: "lead_style", label: "Ведущий стиль", type: "string", formula: "x", sortOrder: 0, configJson: {}, controlsStatus: null },
];

/** What the learner actually got, as stored at finish. */
const STORED_RESULT = {
  totalCorrect: 0,
  totalQuestions: 14,
  overallPercent: 0,
  totalEarnedPoints: 0,
  totalPossiblePoints: 0,
  // The legacy lie this suite exists to stop repeating to the author.
  overallPassed: true,
  topicResults: [],
  scaleResults: {
    cel: { raw: 21, normalized: 21, percent: 0, level: "", label: "", hasValue: true },
    kom: { raw: 35, normalized: 35, percent: 0, level: "high", label: "Высокий", hasValue: true },
    pro: { raw: 14, normalized: 14, percent: 0, level: "", label: "", hasValue: true },
  },
  resultVariables: { lead_style: "kom", lead_score: 35 },
};

const MEASUREMENT_ATTEMPT = {
  id: "atmp1",
  testId: "test1",
  userId: "u1",
  startedAt: new Date("2026-08-12T09:50:00Z"),
  finishedAt: new Date("2026-08-12T09:51:18Z"),
  snapshotId: null,
  variantJson: { sections: [{ topicId: "t1", topicName: "ЧИЛ", questionIds: ["q1"] }] },
  answersJson: { q1: { "0": 7 } },
  resultJson: STORED_RESULT,
};

let app: express.Express;
beforeEach(() => {
  vi.clearAllMocks();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getQuestionsByIds.mockResolvedValue([]);
  storageMock.getTopics.mockResolvedValue([]);
  storageMock.getTestSections.mockResolvedValue([]);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.getSnapshotsForTest.mockResolvedValue([]);
  storageMock.getSnapshot.mockResolvedValue(undefined);
  storageMock.getScales.mockResolvedValue([]);
  storageMock.getQuestionMeasurements.mockResolvedValue([]);
  storageMock.getResultVariables.mockResolvedValue([]);
  storageMock.getAllScormAttempts.mockResolvedValue([]);
  storageMock.getScormPackages.mockResolvedValue([]);
  storageMock.getScormAttemptMeasures.mockResolvedValue([]);
  storageMock.getUser.mockImplementation((id: string) =>
    Promise.resolve(id === "admin1" ? adminUser : { id, name: `User ${id}`, email: `${id}@t.com` }),
  );
  app = makeApp();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /attempts/:attemptId — измерительное прохождение разбирается полностью", () => {
  // PRD-56 FR-23: список попыток теста снят, и проверки его полей переехали на РАЗБОР одного
  // прохождения — единственное место, где шкалы и показатели участника видны целиком.
  beforeEach(() => {
    storageMock.getTest.mockResolvedValue(MEASUREMENT_TEST);
    storageMock.getScales.mockResolvedValue(SCALE_ROWS);
    storageMock.getResultVariables.mockResolvedValue(RV_ROWS);
    storageMock.getAttempt.mockResolvedValue(MEASUREMENT_ATTEMPT);
  });

  it("называет шкалы и показатели теста в АВТОРСКОМ порядке", async () => {
    const res = await asAdmin(request(app).get("/api/analytics/attempts/atmp1"));

    expect(res.status).toBe(200);
    expect(res.body.measures.scales).toEqual([
      // `hasLevels` говорит, может ли шкала вообще дать подпись уровня: отчёт добавляет
      // колонку уровня только там, где её есть чем заполнить.
      { key: "cel", label: "Целевой", hasLevels: false },
      { key: "kom", label: "Командный", hasLevels: false },
      // Пустая подпись падает на ключ — колонка всё равно названа.
      { key: "pro", label: "pro", hasLevels: false },
    ]);
    expect(res.body.measures.indicators).toEqual([
      { name: "lead_style", label: "Ведущий стиль" },
    ]);
  });

  it("несёт записанные значения шкал и показателей", async () => {
    const res = await asAdmin(request(app).get("/api/analytics/attempts/atmp1"));

    expect(res.body.scaleResults.cel).toMatchObject({ raw: 21, level: "" });
    expect(res.body.scaleResults.kom).toMatchObject({ raw: 35, level: "high", label: "Высокий" });
    expect(res.body.resultVariables).toMatchObject({ lead_style: "kom" });
  });

  it("не выносит вердикта там, где оценивать было нечего (PRD-29 §6.7)", async () => {
    const res = await asAdmin(request(app).get("/api/analytics/attempts/atmp1"));

    expect(res.body.scored).toBe(false);
    expect(res.body.verdictPronounced).toBe(false);
  });

  it("оставляет вердикт контрольному тесту, где баллы есть", async () => {
    storageMock.getAttempt.mockResolvedValue({
      ...MEASUREMENT_ATTEMPT,
      resultJson: {
        ...STORED_RESULT,
        overallPercent: 80, totalEarnedPoints: 8, totalPossiblePoints: 10,
        overallPassed: true, scaleResults: undefined, resultVariables: undefined,
      },
    });
    storageMock.getScales.mockResolvedValue([]);
    storageMock.getResultVariables.mockResolvedValue([]);

    const res = await asAdmin(request(app).get("/api/analytics/attempts/atmp1"));

    expect(res.body.scored).toBe(true);
    expect(res.body.verdictPronounced).toBe(true);
    expect(res.body.passed).toBe(true);
    expect(res.body.overallPercent).toBe(80);
    // Шкал у теста нет: блок пуст, а не отсутствует и роняет страницу.
    expect(res.body.measures).toEqual({ scales: [], indicators: [] });
  });

  it("адаптивное прохождение сохраняет вердикт — его судят уровни, а не баллы", async () => {
    // В адаптивном результате `totalPossiblePoints` нет вовсе: прогнав его через балльный
    // гейт, мы заглушили бы вердикт каждого адаптивного прохождения в продукте.
    storageMock.getTest.mockResolvedValue({ ...MEASUREMENT_TEST, mode: "adaptive" });
    storageMock.getAttempt.mockResolvedValue({
      ...MEASUREMENT_ATTEMPT,
      resultJson: { mode: "adaptive", overallPassed: true, topicResults: [] },
    });

    const res = await asAdmin(request(app).get("/api/analytics/attempts/atmp1"));

    expect(res.body.verdictPronounced).toBe(true);
    expect(res.body.scored).toBe(true);
  });

  it("объявленное автором «порога нет» заглушает вердикт оценённого прохождения", async () => {
    storageMock.getTest.mockResolvedValue({ ...MEASUREMENT_TEST, overallPassRuleJson: { type: "none" } });
    storageMock.getAttempt.mockResolvedValue({
      ...MEASUREMENT_ATTEMPT,
      resultJson: { ...STORED_RESULT, totalPossiblePoints: 10, overallPercent: 80 },
    });

    const res = await asAdmin(request(app).get("/api/analytics/attempts/atmp1"));

    expect(res.body.hasPassThreshold).toBe(false);
    expect(res.body.verdictPronounced).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /tests/:testId — the summary stops averaging what was never graded", () => {
  it("reports no averages and no pass rate for a questionnaire", async () => {
    storageMock.getTest.mockResolvedValue(MEASUREMENT_TEST);
    storageMock.getAllAttempts.mockResolvedValue([
      MEASUREMENT_ATTEMPT,
      { ...MEASUREMENT_ATTEMPT, id: "atmp2" },
    ]);

    const res = await asAdmin(request(app).get("/api/analytics/tests/test1"));
    expect(res.status).toBe(200);
    // Both runs are registered — the COUNTS are real and stay.
    expect(res.body.summary.completedAttempts).toBe(2);
    expect(res.body.summary.gradedAttempts).toBe(0);
    // …but «100% успешно сдали тест» over zero points was a lie.
    expect(res.body.summary.passRate).toBeNull();
    expect(res.body.summary.avgPercent).toBeNull();
    expect(res.body.summary.avgScore).toBeNull();
    expect(res.body.hasPassThreshold).toBe(true);
  });

  it("averages a control test exactly as before", async () => {
    storageMock.getTest.mockResolvedValue(MEASUREMENT_TEST);
    const graded = (id: string, percent: number, passed: boolean) => ({
      ...MEASUREMENT_ATTEMPT,
      id,
      resultJson: {
        ...STORED_RESULT,
        overallPercent: percent, totalEarnedPoints: percent / 10,
        totalPossiblePoints: 10, overallPassed: passed,
      },
    });
    storageMock.getAllAttempts.mockResolvedValue([graded("a1", 80, true), graded("a2", 40, false)]);

    const res = await asAdmin(request(app).get("/api/analytics/tests/test1"));
    expect(res.body.summary.gradedAttempts).toBe(2);
    expect(res.body.summary.avgPercent).toBe(60);
    expect(res.body.summary.passRate).toBe(50);
    expect(res.body.summary.avgScore).toBe(6);
    expect(res.body.summary.maxScore).toBe(10);
  });

  it("averages only the GRADED runs when a test carries both kinds", async () => {
    // A test whose scoring was switched on mid-life: the ungraded runs must not
    // drag the average toward zero, and must not count as failures either.
    storageMock.getTest.mockResolvedValue(MEASUREMENT_TEST);
    storageMock.getAllAttempts.mockResolvedValue([
      MEASUREMENT_ATTEMPT,
      {
        ...MEASUREMENT_ATTEMPT,
        id: "a2",
        resultJson: { ...STORED_RESULT, overallPercent: 80, totalEarnedPoints: 8, totalPossiblePoints: 10, overallPassed: true },
      },
    ]);

    const res = await asAdmin(request(app).get("/api/analytics/tests/test1"));
    expect(res.body.summary.completedAttempts).toBe(2);
    expect(res.body.summary.gradedAttempts).toBe(1);
    expect(res.body.summary.avgPercent).toBe(80);
    expect(res.body.summary.passRate).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /export/excel for one test — the workbook carries the measurements", () => {
  const ALLOCATION_QUESTION = {
    id: "q1",
    topicId: "t1",
    type: "allocation",
    prompt: "Как вы действуете?",
    // PRD-44: the statements live in `options`, the budget beside them.
    dataJson: { budget: 7, options: ["Фокус на цели", "Обсуждение с командой"], minPerOption: 0, maxPerOption: 7 },
    // `correct_json` is NOT NULL — the measurement state is an EMPTY object, and it
    // used to reach `JSON.stringify` and print «{}» as the reference answer.
    correctJson: {},
    difficulty: 50,
    contentHash: "h1",
  };

  beforeEach(() => {
    storageMock.getTest.mockResolvedValue(MEASUREMENT_TEST);
    storageMock.getTests.mockResolvedValue([MEASUREMENT_TEST]);
    storageMock.getScales.mockResolvedValue(SCALE_ROWS);
    storageMock.getResultVariables.mockResolvedValue(RV_ROWS);
    storageMock.getAllAttempts.mockResolvedValue([MEASUREMENT_ATTEMPT]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "ЧИЛ" }]);
    storageMock.getQuestionsByIds.mockResolvedValue([ALLOCATION_QUESTION]);
    storageMock.getQuestionMeasurements.mockResolvedValue([
      { questionId: "q1", scaleId: "s1", sourceType: "option_allocation", sourceKey: "0", valueJson: 1, weight: 1 },
    ]);
  });

  it("grows a column per scale and per indicator, filled from the stored run", async () => {
    const res = await asWorkbook(request(app).post("/api/analytics/export/excel").send({ testIds: ["test1"] }));
    expect(res.status).toBe(200);
    const rows = await sheetRows(res.body, "Прохождения");

    expect(rows[0]).toEqual(expect.arrayContaining(["Целевой", "Командный", "pro", "Ведущий стиль"]));
    const iCel = rows[0].indexOf("Целевой");
    const iStyle = rows[0].indexOf("Ведущий стиль");
    expect(rows[1][iCel]).toBe("21");
    expect(rows[1][iStyle]).toBe("kom");
  });

  it("stops calling an unchecked answer «Неверно» and shows what it DID measure", async () => {
    const res = await asWorkbook(request(app).post("/api/analytics/export/excel").send({ testIds: ["test1"] }));
    const rows = await sheetRows(res.body, "Ответы");
    const head = rows[0];
    const row = rows[1];

    // The three cells that made a questionnaire look like a failed exam.
    expect(row[head.indexOf("Результат")]).toBe("—");
    expect(row[head.indexOf("Баллы")]).toBe("—");
    expect(row[head.indexOf("Правильный ответ")]).toBe("—");
    // …and the raw JSON that stood where the statements belong.
    expect(row[head.indexOf("Варианты ответа")]).toBe("Бюджет: 7\n1) Фокус на цели\n2) Обсуждение с командой");
    // The answer's only real outcome: how it moved the scale.
    expect(row[head.indexOf("Вклад в шкалы")]).toBe("Целевой: +7");
  });

  it("reports «неприменимо» instead of 0% in the summary and the item stats", async () => {
    const res = await asWorkbook(request(app).post("/api/analytics/export/excel").send({ testIds: ["test1"] }));
    const summary = await sheetRows(res.body, "Сводка");
    const flat = summary.map((r) => r.join("|"));
    expect(flat).toContain("Средний результат|—");
    expect(flat).toContain("Процент прохождения|—");

    const stats = await sheetRows(res.body, "Статистика вопросов");
    const head = stats[0];
    // The count of ANSWERS is real and stays; the correctness columns do not apply.
    expect(stats[1][head.indexOf("Всего ответов")]).toBe("1");
    expect(stats[1][head.indexOf("Правильных")]).toBe("—");
    expect(stats[1][head.indexOf("% правильных")]).toBe("—");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /attempts/:attemptId — the detail of a measurement run", () => {
  beforeEach(() => {
    storageMock.getTest.mockResolvedValue(MEASUREMENT_TEST);
    storageMock.getScales.mockResolvedValue(SCALE_ROWS);
    storageMock.getResultVariables.mockResolvedValue(RV_ROWS);
    storageMock.getAttempt.mockResolvedValue(MEASUREMENT_ATTEMPT);
  });

  it("reports the STORED scale values, not a recompute of today's config", async () => {
    // The scales are configured but their measurement rows are gone from the live
    // config: a recompute would answer «no measurements, all zero» and quietly
    // rewrite history. The run's own record is the answer.
    storageMock.getQuestionMeasurements.mockResolvedValue([]);
    const res = await asAdmin(request(app).get("/api/analytics/attempts/atmp1"));
    expect(res.status).toBe(200);
    expect(res.body.scaleResults.kom).toMatchObject({ raw: 35, level: "high" });
    expect(res.body.resultVariables).toMatchObject({ lead_style: "kom" });
  });

  it("names the scales and indicators for the detail view too", async () => {
    const res = await asAdmin(request(app).get("/api/analytics/attempts/atmp1"));
    expect(res.body.measures.scales.map((s: any) => s.key)).toEqual(["cel", "kom", "pro"]);
    expect(res.body.measures.indicators).toEqual([{ name: "lead_style", label: "Ведущий стиль" }]);
  });

  it("resolves each indicator's outcome into readable text", async () => {
    // PRD-2/PRD-29: the stored value is a CODE («kom»), which is what a formula
    // addresses — not what a person reads. The window's «Толкование» column comes
    // from the author's outcome list, resolved with the same shared helpers the
    // learner's screen uses — its LABEL, never its `text`: on the reference
    // questionnaire that text runs to a page and a half.
    storageMock.getResultVariables.mockResolvedValue([
      {
        ...RV_ROWS[0],
        configJson: {
          outcomes: [
            { code: "kom", label: "Командный", text: "Опора на людей и совместность" },
            { code: "cel", label: "Целеустремленный", text: "Опора на результат" },
          ],
        },
      },
      {
        id: "rv2", testId: "test1", name: "lead_score", label: "Баллов у ведущего стиля",
        type: "number", formula: "x", sortOrder: 1, controlsStatus: null,
        configJson: { bands: [{ min: 0, max: 20, level: "low", label: "Низкий" }, { min: 21, max: 60, level: "high", label: "Выраженный" }] },
      },
      {
        id: "rv3", testId: "test1", name: "lead_margin", label: "Отрыв", type: "number",
        formula: "x", sortOrder: 2, configJson: {}, controlsStatus: null,
      },
    ]);

    const res = await asAdmin(request(app).get("/api/analytics/attempts/atmp1"));
    expect(res.body.indicatorViews).toEqual([
      // The outcome's LABEL, not its long explanatory `text`.
      { name: "lead_style", label: "Ведущий стиль", value: "kom", interpretation: "Командный" },
      { name: "lead_score", label: "Баллов у ведущего стиля", value: 35, interpretation: "Выраженный" },
      // No interpretation configured — the column stays honestly empty.
      { name: "lead_margin", label: "Отрыв", value: null, interpretation: null },
    ]);
  });

  it("says how many of the delivered questions were answered", async () => {
    // «Отвечено 1 из 1»: the answered count alone cannot tell a full run from an
    // abandoned one, and a measurement run has no percent to say it instead.
    storageMock.getQuestionsByIds.mockResolvedValue([{
      id: "q1", topicId: "t1", type: "allocation", prompt: "Как вы действуете?",
      dataJson: { budget: 7, options: ["А", "Б"] }, correctJson: {},
      difficulty: 50, contentHash: "h1",
    }]);
    const res = await asAdmin(request(app).get("/api/analytics/attempts/atmp1"));
    expect(res.body.questionCount).toBe(1);
    expect(res.body.answeredCount).toBe(1);
  });

  it("marks the unchecked answers so the window drops their points and tick", async () => {
    storageMock.getQuestionsByIds.mockResolvedValue([{
      id: "q1", topicId: "t1", type: "allocation", prompt: "Как вы действуете?",
      dataJson: { budget: 7, options: ["А", "Б"] }, correctJson: {},
      difficulty: 50, contentHash: "h1",
    }]);
    const res = await asAdmin(request(app).get("/api/analytics/attempts/atmp1"));
    expect(res.body.answers[0].measurementOnly).toBe(true);
  });

  it("pronounces no verdict and reports the run as ungraded", async () => {
    const res = await asAdmin(request(app).get("/api/analytics/attempts/atmp1"));
    expect(res.body.scored).toBe(false);
    expect(res.body.verdictPronounced).toBe(false);
    expect(res.body.hasPassThreshold).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /export/excel — measurements of LMS runs (PRD-56 FR-21h)", () => {
  const SCALES = [{
    id: "s1", testId: "test1", key: "kom", label: "Командный", sortOrder: 0, aggregation: "sum",
    normalization: "none", direction: "positive",
    configJson: { bands: [{ min: 0, max: 20, level: "low", label: "Низкий" }, { min: 21, max: 40, level: "high", label: "Высокий" }] },
  }];
  const INDICATORS = [{
    id: "rv1", testId: "test1", name: "lead_style", label: "Ведущий стиль", type: "string", formula: "x",
    sortOrder: 0, controlsStatus: null,
    configJson: { outcomes: [{ code: "kom", label: "Командный стиль" }] },
  }];
  const lmsRow = (id: string, origin: string) => ({
    id, testId: "test1", packageId: null, origin,
    userId: null, participantKey: null, groupId: null, lmsUserId: id, lmsUserName: "Пётр",
    startedAt: new Date("2026-09-01T09:00:00Z"), finishedAt: new Date("2026-09-01T09:30:00Z"),
    resultPercent: null, resultPassed: null, maxPoints: 0, totalPoints: 0,
  });

  beforeEach(() => {
    storageMock.getTest.mockResolvedValue(MEASUREMENT_TEST);
    storageMock.getTests.mockResolvedValue([MEASUREMENT_TEST]);
    storageMock.getScales.mockResolvedValue(SCALES);
    storageMock.getResultVariables.mockResolvedValue(INDICATORS);
    storageMock.getAllAttempts.mockResolvedValue([]);
    storageMock.getAllScormAttempts.mockResolvedValue([lmsRow("tel-1", "telemetry"), lmsRow("imp-1", "import")]);
    storageMock.getScormAttemptMeasures.mockResolvedValue([
      { id: "tel-1", scalesJson: { kom: 30 }, variablesJson: { lead_style: "kom" } },
      // An export without `var_*` blocks: the indicator was not reported.
      { id: "imp-1", scalesJson: { kom: 12 }, variablesJson: null },
    ]);
  });

  it("fills the scale and indicator columns of LMS rows on the passages sheet", async () => {
    const res = await asWorkbook(request(app).post("/api/analytics/export/excel").send({ testIds: ["test1"] }));
    expect(res.status).toBe(200);
    const rows = await sheetRows(res.body, "Прохождения");
    const head = rows[0];
    const row = (id: string) => rows.find(r => r.includes(id))!;

    expect(row("tel-1")[head.indexOf("Командный")]).toBe("30");
    expect(row("tel-1")[head.indexOf("Командный, уровень")]).toBe("Высокий");
    expect(row("tel-1")[head.indexOf("Ведущий стиль")]).toBe("kom");
    expect(row("imp-1")[head.indexOf("Командный")]).toBe("12");
    expect(row("imp-1")[head.indexOf("Ведущий стиль")]).toBe("—");
  });

  it("lists LMS runs on the measurements sheet with the indicator's outcome as its level", async () => {
    const res = await asWorkbook(request(app).post("/api/analytics/export/excel").send({ testIds: ["test1"] }));
    const rows = await sheetRows(res.body, "Измерения");
    const head = rows[0];
    const of = (id: string, kind: string) => rows.find(r => r.includes(id) && r[head.indexOf("Вид")] === kind)!;

    expect(of("tel-1", "Показатель")[head.indexOf("Значение")]).toBe("kom");
    expect(of("tel-1", "Показатель")[head.indexOf("Уровень")]).toBe("Командный стиль");
    expect(of("tel-1", "Шкала")[head.indexOf("Уровень")]).toBe("Высокий");
    expect(of("imp-1", "Показатель")[head.indexOf("Значение")]).toBe("—");
    expect(of("imp-1", "Шкала")[head.indexOf("Значение")]).toBe("12");
  });
});
