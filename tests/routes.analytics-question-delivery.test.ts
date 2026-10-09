/**
 * @module tests/routes.analytics-question-delivery
 * @description PRD-56 FR-17a, FR-17b: исключение задания из выдачи и возврат в неё.
 *
 * Исключение — состояние, и меняет его тот, кто читает аналитику, поэтому ручка живёт здесь.
 * Два правила, ради которых она написана.
 *
 * ПЕРВОЕ: если после исключения выдать тест станет нельзя, действие ЗАПРЕЩЕНО, а не «выполнено
 * с предупреждением» (FR-17b). Тест, который не выдаётся, ломается не у автора, а у участника.
 *
 * ВТОРОЕ: возврат в выдачу подтверждения не требует и запрету не подлежит — он ничего не
 * отнимает.
 */
import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { storageMock, feasibilityMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getTest: vi.fn(),
    getTestSections: vi.fn(),
    getQuestion: vi.fn(),
    getQuestionsByTopic: vi.fn(),
    getTopic: vi.fn(),
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    // Окно исключения говорит, когда оно подействует: дата — из последнего снимка (план 5.8).
    getLatestSnapshot: vi.fn().mockResolvedValue({ publishedAt: new Date("2026-09-01T10:00:00Z") }),
    setQuestionDelivery: vi.fn(),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
  },
  feasibilityMock: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/draw-feasibility", () => ({
  assessTestPublish: feasibilityMock,
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import questionDeliveryRouter from "../server/routes/analytics/question-delivery";

const TEST = { id: "test1", title: "Сертификация", mode: "standard", ownerId: "a1" };

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/analytics", questionDeliveryRouter);
  return app;
}

const exclude = (body: unknown) => request(makeApp())
  .put("/api/analytics/tests/test1/questions/q1/delivery")
  .set("x-test-user", "a1")
  .send(body);

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockResolvedValue({ id: "a1", name: "Автор", email: "a@b.c" });
  storageMock.getTest.mockResolvedValue(TEST);
  storageMock.getTestSections.mockResolvedValue([
    { id: "s1", testId: "test1", topicId: "t1", drawCount: 2 },
  ]);
  storageMock.getQuestion.mockResolvedValue({ id: "q1", topicId: "t1", prompt: "Вопрос" });
  storageMock.getQuestionsByTopic.mockResolvedValue([
    { id: "q1", topicId: "t1" }, { id: "q2", topicId: "t1" }, { id: "q3", topicId: "t1" },
  ]);
  storageMock.getTopic.mockResolvedValue({ id: "t1", name: "Право" });
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.setQuestionDelivery.mockResolvedValue({ excludedFromDelivery: true });
  feasibilityMock.mockResolvedValue([]);
});

describe("PUT /api/analytics/tests/:testId/questions/:questionId/delivery", () => {
  it("исключает задание из выдачи", async () => {
    const res = await exclude({ excluded: true });

    expect(res.status).toBe(200);
    expect(storageMock.setQuestionDelivery).toHaveBeenCalledWith("test1", "q1", true);
  });

  it("запрещает исключение, после которого тест выдать нельзя", async () => {
    // FR-17b: не «выполнено с предупреждением». Сломанная выдача проявится у участника на
    // старте попытки, а не у автора в аналитике.
    feasibilityMock.mockResolvedValue([
      { topicId: "t1", topicName: "Право", issues: [{ kind: "pool_shortfall", required: 3, available: 2 }] },
    ]);

    const res = await exclude({ excluded: true });

    expect(res.status).toBe(409);
    expect(storageMock.setQuestionDelivery).not.toHaveBeenCalled();
  });

  it("называет причину запрета, а не отказывает молча", async () => {
    feasibilityMock.mockResolvedValue([
      { topicId: "t1", topicName: "Право", issues: [{ kind: "pool_shortfall", required: 3, available: 2 }] },
    ]);

    const res = await exclude({ excluded: true });

    expect(res.body.error).toMatch(/выдач/i);
    expect(res.body.findings).toHaveLength(1);
  });

  it("возвращает задание в выдачу без проверки выполнимости", async () => {
    // Возврат ничего не отнимает: пул от него только растёт, и запрещать тут нечего.
    storageMock.setQuestionDelivery.mockResolvedValue({ excludedFromDelivery: false });

    const res = await exclude({ excluded: false });

    expect(res.status).toBe(200);
    expect(feasibilityMock).not.toHaveBeenCalled();
    expect(storageMock.setQuestionDelivery).toHaveBeenCalledWith("test1", "q1", false);
  });

  it("отвечает 404 на задание не из этого теста", async () => {
    storageMock.getQuestion.mockResolvedValue({ id: "q1", topicId: "other-topic" });

    const res = await exclude({ excluded: true });

    expect(res.status).toBe(404);
  });

  it("требует явного состояния в теле запроса", async () => {
    const res = await exclude({});

    expect(res.status).toBe(400);
  });
});

describe("GET /api/analytics/tests/:testId/questions/:questionId/delivery-impact", () => {
  const impact = () => request(makeApp())
    .get("/api/analytics/tests/test1/questions/q1/delivery-impact")
    .set("x-test-user", "a1");

  it("говорит, сколько заданий останется в теме и сколько нужно выдать", async () => {
    // FR-17b: окно подтверждения называет последствия числами, а не общими словами.
    const res = await impact();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ topicName: "Право", remaining: 2, drawCount: 2, allowed: true });
  });

  it("называет дату публикации: до новой публикации исключение не подействует (план 5.8)", async () => {
    const res = await impact();
    expect(res.body.publishedAt).toBe("2026-09-01T10:00:00.000Z");
  });

  it("у неопубликованного теста даты нет — прохождения идут по живому содержанию", async () => {
    storageMock.getLatestSnapshot.mockResolvedValueOnce(undefined);
    const res = await impact();
    expect(res.body.publishedAt).toBeNull();
  });

  it("предупреждает, что выдать станет нельзя", async () => {
    storageMock.getTestSections.mockResolvedValue([
      { id: "s1", testId: "test1", topicId: "t1", drawCount: 3 },
    ]);
    feasibilityMock.mockResolvedValue([
      { topicId: "t1", topicName: "Право", issues: [{ kind: "pool_shortfall", required: 3, available: 2 }] },
    ]);

    const res = await impact();

    expect(res.body).toMatchObject({ remaining: 2, drawCount: 3, allowed: false });
  });

  it("судит о выполнимости тем же движком, что и само действие", async () => {
    // Приёмка Э4: окно считало остаток наивно и обещало «можно» там, где квота по тегу
    // (PRD-11) уже не набиралась, — а действие отказывало. Обещание и отказ обязаны
    // приходить из одного расчёта.
    feasibilityMock.mockResolvedValue([
      { topicId: "t1", topicName: "Право", issues: [{ kind: "quota_shortfall", tag: "Охрана труда", requested: 3, available: 2 }] },
    ]);

    const res = await impact();

    expect(res.body.allowed).toBe(false);
    expect(res.body.findings[0].issues[0]).toMatchObject({ kind: "quota_shortfall", tag: "Охрана труда" });
  });

  it("не считает доступными задания, исключённые ранее", async () => {
    storageMock.getTestQuestionScoring.mockResolvedValue([
      { testId: "test1", questionId: "q3", excludedFromDelivery: true },
    ]);

    const res = await impact();

    expect(res.body.remaining).toBe(1);
  });
});
