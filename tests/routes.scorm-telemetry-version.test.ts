/**
 * @module tests/routes.scorm-telemetry-version
 * @description PRD-56 FR-19a/FR-18/FR-21: сервер принимает от пакета версию публикации,
 * выданные варианты и значения шкал.
 *
 * До этого прохождение из LMS не несло ни версии, ни варианта — разрез по версиям видел одни
 * веб-попытки, а таблица вариантов не видела ничего. Шкалы живая телеметрия не сообщала вовсе:
 * колонку `scales_json` заполнял только импорт выгрузки (PRD-54).
 *
 * Отдельно закрепляется отказ выдумывать версию: снимка с сообщённым номером может не
 * оказаться (тест заведён заново, снимок подчищен `pruneSnapshots`) — прохождение тогда идёт
 * в строку «Версия не указана», а не приписывается текущей версии.
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
    getSnapshotByVersion: vi.fn(),
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

function signedPost(app: express.Express, endpoint: string, data: Record<string, unknown>) {
  const ts = String(Date.now());
  return request(app).post(`/api/scorm-telemetry/${endpoint}`).send({
    packageId: "pkg1",
    sessionId: "sess1",
    signature: makeSignature("pkg1", "sess1", ts, data),
    timestamp: ts,
    data,
  });
}

const startWith = (app: express.Express, data: Record<string, unknown>) =>
  signedPost(app, "start", data);
const finishWith = (app: express.Express, data: Record<string, unknown>) =>
  signedPost(app, "finish", data);

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getScormPackage.mockResolvedValue(dbPkg);
  storageMock.getScormAttemptBySession.mockResolvedValue(undefined);
  storageMock.getNextAttemptNumber.mockResolvedValue(1);
  storageMock.createScormAttempt.mockResolvedValue(dbScormAttempt);
  storageMock.getSnapshotByVersion.mockResolvedValue(undefined);
  app = makeApp();
});

describe("start: версия публикации", () => {
  it("номер версии превращается в снимок этого теста", async () => {
    storageMock.getSnapshotByVersion.mockResolvedValue({ id: "snap3", testId: "test1", version: 3 });

    const res = await startWith(app, { attemptNumber: 1, publicationVersion: 3 });

    expect(res.status).toBe(200);
    expect(storageMock.getSnapshotByVersion).toHaveBeenCalledWith("test1", 3);
    expect(storageMock.createScormAttempt.mock.calls[0][0]).toMatchObject({ snapshotId: "snap3" });
  });

  it("неизвестная версия оставляет прохождение без снимка и не роняет старт", async () => {
    // Снимок мог быть подчищен, а тест заведён заново. Приписать прохождение текущей версии
    // значит сделать разрез по версиям бесполезным ровно там, где он и нужен.
    const res = await startWith(app, { attemptNumber: 1, publicationVersion: 99 });

    expect(res.status).toBe(200);
    expect(storageMock.createScormAttempt.mock.calls[0][0]).toMatchObject({ snapshotId: null });
  });

  it("пакет, собранный до этой работы, версии не шлёт — снимка нет и запроса тоже", async () => {
    const res = await startWith(app, { attemptNumber: 1 });

    expect(res.status).toBe(200);
    expect(storageMock.getSnapshotByVersion).not.toHaveBeenCalled();
    expect(storageMock.createScormAttempt.mock.calls[0][0]).toMatchObject({ snapshotId: null });
  });

  it("сбой чтения снимка не роняет начало прохождения", async () => {
    storageMock.getSnapshotByVersion.mockRejectedValue(new Error("база недоступна"));

    const res = await startWith(app, { attemptNumber: 1, publicationVersion: 3 });

    expect(res.status).toBe(200);
    expect(storageMock.createScormAttempt.mock.calls[0][0]).toMatchObject({ snapshotId: null });
  });
});

describe("start: выданные варианты", () => {
  it("карта «тема -> вариант» сохраняется как есть", async () => {
    await startWith(app, {
      attemptNumber: 1,
      deliveredForms: { "topic-1": "form-a", "topic-2": "form-b" },
    });

    expect(storageMock.createScormAttempt.mock.calls[0][0]).toMatchObject({
      formsJson: { "topic-1": "form-a", "topic-2": "form-b" },
    });
  });

  it("тест без вариантов пишет пусто, а не выдуманный ключ", async () => {
    await startWith(app, { attemptNumber: 1, deliveredForms: {} });

    expect(storageMock.createScormAttempt.mock.calls[0][0]).toMatchObject({ formsJson: null });
  });

  it("мусор вместо карты в базу не попадает", async () => {
    // Тело запроса приходит из LMS-окружения, которым мы не управляем.
    await startWith(app, { attemptNumber: 1, deliveredForms: ["form-a"] });

    expect(storageMock.createScormAttempt.mock.calls[0][0]).toMatchObject({ formsJson: null });
  });
});

describe("finish: шкалы и показатели", () => {
  beforeEach(() => {
    storageMock.getScormAttemptBySession.mockResolvedValue(dbScormAttempt);
  });

  it("значения шкал и показателей пишутся в те же колонки, что заполняет импорт", async () => {
    const res = await finishWith(app, {
      attemptNumber: 1, percent: 80, passed: true,
      scales: { burnout: 27, engagement: 13 },
      variables: { risk: "high" },
    });

    expect(res.status).toBe(200);
    expect(storageMock.updateScormAttempt.mock.calls[0][1]).toMatchObject({
      scalesJson: { burnout: 27, engagement: 13 },
      variablesJson: { risk: "high" },
    });
  });

  it("оцениваемый тест шкал не шлёт — колонки остаются пустыми", async () => {
    await finishWith(app, { attemptNumber: 1, percent: 80, passed: true, scales: {}, variables: {} });

    expect(storageMock.updateScormAttempt.mock.calls[0][1]).toMatchObject({
      scalesJson: null,
      variablesJson: null,
    });
  });

  it("пакет старой сборки полей не шлёт вовсе", async () => {
    await finishWith(app, { attemptNumber: 1, percent: 80, passed: true });

    expect(storageMock.updateScormAttempt.mock.calls[0][1]).toMatchObject({
      scalesJson: null,
      variablesJson: null,
    });
  });
});
