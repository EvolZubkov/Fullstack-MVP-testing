/**
 * @module tests/routes.scorm-telemetry-exposure
 * @description PRD-55 (FR-01, FR-07): телеметрия пополняет счётчик выдач в момент СОЗДАНИЯ
 * прохождения — единственного однократного её события, поэтому инкремент здесь безопасен.
 *
 * Состав выданной формы сервер узнаёт ровно отсюда: ни `answer`, ни `finish` его не несут, а
 * ответы описывают ОТВЕЧЕННОЕ, тогда как экспозиция — это показ. Пакет знает состав к моменту
 * вызова (`generateVariant` идёт перед `Telemetry.start`) и передаёт его полем
 * `deliveredQuestionIds`.
 *
 * Пакеты, собранные до этой правки, поля не шлют — по ним экспозиция не считается, и это
 * штатная деградация, а не сбой.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import crypto from "crypto";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(), getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getScormPackage: vi.fn(),
    getScormAttemptBySession: vi.fn(),
    getNextAttemptNumber: vi.fn(),
    createScormAttempt: vi.fn(),
    updateScormAttempt: vi.fn(),
    recordDeliveries: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import scormTelemetryRouter from "../server/routes/scorm-telemetry";

const secretKey = "test-secret-key";

function makeSignature(packageId: string, sessionId: string, timestamp: string, data: unknown) {
  const dataToSign = `${packageId}:${sessionId}:${timestamp}:${JSON.stringify(data || {})}`;
  return crypto.createHmac("sha256", secretKey).update(dataToSign).digest("hex");
}

const dbPkg = {
  id: "pkg1", testId: "test1", testTitle: "Test 1", testMode: "standard",
  secretKey, isActive: true, createdAt: new Date(),
};

const dbScormAttempt = {
  id: "satmp1", packageId: "pkg1", sessionId: "sess1", attemptNumber: 1,
  testId: "test1", origin: "telemetry",
  startedAt: new Date(), finishedAt: null, lastActivityAt: new Date(),
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use("/api", scormTelemetryRouter);
  return app;
}

/** Подписанный вызов `start` с произвольным телом данных. */
function startWith(app: express.Express, data: Record<string, unknown>) {
  const ts = String(Date.now());
  return request(app).post("/api/scorm-telemetry/start").send({
    packageId: "pkg1",
    sessionId: "sess1",
    signature: makeSignature("pkg1", "sess1", ts, data),
    timestamp: ts,
    data,
  });
}

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getScormPackage.mockResolvedValue(dbPkg);
  storageMock.getScormAttemptBySession.mockResolvedValue(undefined);
  storageMock.getNextAttemptNumber.mockResolvedValue(1);
  storageMock.createScormAttempt.mockResolvedValue(dbScormAttempt);
  storageMock.recordDeliveries.mockResolvedValue(undefined);
  app = makeApp();
});

describe("телеметрия пополняет счётчик выдач", () => {
  it("пишет выданный состав при создании прохождения", async () => {
    const res = await startWith(app, { attemptNumber: 1, deliveredQuestionIds: ["q1", "q2"] });

    expect(res.status).toBe(200);
    expect(storageMock.recordDeliveries).toHaveBeenCalledTimes(1);
    const [questionIds, testId] = storageMock.recordDeliveries.mock.calls[0];
    expect(questionIds).toEqual(["q1", "q2"]);
    expect(testId).toBe("test1");
  });

  it("продолжение существующего прохождения счётчик НЕ двигает", async () => {
    storageMock.getScormAttemptBySession.mockResolvedValue(dbScormAttempt);

    await startWith(app, { attemptNumber: 1, deliveredQuestionIds: ["q1", "q2"] });

    expect(storageMock.recordDeliveries).not.toHaveBeenCalled();
  });

  it("пакет без поля состава счётчик не трогает", async () => {
    const res = await startWith(app, { attemptNumber: 1 });

    expect(res.status).toBe(200);
    expect(storageMock.recordDeliveries).not.toHaveBeenCalled();
  });

  it("пакет удалённого теста счётчик не трогает", async () => {
    storageMock.getScormPackage.mockResolvedValue({ ...dbPkg, testId: null });

    await startWith(app, { attemptNumber: 1, deliveredQuestionIds: ["q1"] });

    expect(storageMock.recordDeliveries).not.toHaveBeenCalled();
  });

  it("сбой счётчика не роняет начало прохождения", async () => {
    storageMock.recordDeliveries.mockRejectedValue(new Error("база недоступна"));

    const res = await startWith(app, { attemptNumber: 1, deliveredQuestionIds: ["q1"] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
