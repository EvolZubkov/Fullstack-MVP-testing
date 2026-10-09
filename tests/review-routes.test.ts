/**
 * @module tests/review-routes
 *
 * PRD-52 FR-18..FR-26: API комментариев рецензирования. Проверяются правила
 * жизненного цикла, которые больше нигде не живут: ответ ровно одного уровня,
 * исход только у корня и только от того, кто может править тест, обязательный
 * ответ при отклонении, удаление только своего и только пока не ответили, и
 * пометки «изменено после комментария» / «объект удалён» при чтении.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import { ROLES } from "@shared/access";

vi.hoisted(() => { process.env.DATABASE_URL = "postgresql://fake/test"; });

const { storageMock, accessMock, anchorMock, runMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn(),
    getTest: vi.fn(),
    getTestGrantForUser: vi.fn(),
    // Классификация строк списка рецензентов читает то же, что у участников.
    getUserByEmail: vi.fn(),
    getTestAssignments: vi.fn(),
    getGroupUsers: vi.fn(),
    listReviewThreads: vi.fn(),
    getReviewComment: vi.fn(),
    getTestAccessGrants: vi.fn(),
    removeTestAccessGrant: vi.fn(),
    revokeReviewLinks: vi.fn(),
    hasReviewReplies: vi.fn(),
    createReviewComment: vi.fn(),
    updateReviewCommentBody: vi.fn(),
    deleteReviewComment: vi.fn(),
    resolveReviewComment: vi.fn(),
    reopenReviewComment: vi.fn(),
  },
  accessMock: { canReviewTest: vi.fn(), canEditTest: vi.fn(), canGrantAccess: vi.fn() },
  runMock: {
    buildScormExportData: vi.fn(),
    generateScormPackage: vi.fn(),
    createDebugSession: vi.fn(),
    getDebugSession: vi.fn(),
    dropDebugSession: vi.fn(),
    assessTestPublish: vi.fn(),
    readShimJs: vi.fn(),
    readInspectorComputeJs: vi.fn(),
  },
  anchorMock: { describeAnchor: vi.fn(), isAnchorStale: vi.fn(), isAnchorOrphaned: vi.fn() },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/test-access", () => accessMock);
vi.mock("../server/services/review-anchor", () => anchorMock);
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  // Отметка о выгрузке ссылок пишет в аудит — тот же журнал, что у участников.
  audit: { participantLinksExported: vi.fn() },
}));
vi.mock("../server/scorm/build-export-data", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildScormExportData: runMock.buildScormExportData,
}));
vi.mock("../server/scorm-exporter", () => ({ generateScormPackage: runMock.generateScormPackage }));
vi.mock("../server/scorm/debug-player/session-store", () => ({
  createDebugSession: runMock.createDebugSession,
  getDebugSession: runMock.getDebugSession,
  dropDebugSession: runMock.dropDebugSession,
}));
vi.mock("../server/services/draw-feasibility", () => ({ assessTestPublish: runMock.assessTestPublish }));
vi.mock("../server/scorm/debug-player/assets", () => ({
  readShimJs: runMock.readShimJs,
  readInspectorComputeJs: runMock.readInspectorComputeJs,
}));

import reviewRouter from "../server/routes/review";

const TEST = { id: "t1", ownerId: "author-1" };

/** Приложение с сессией фиксированного пользователя. */
function makeApp(userId: string) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { req.session.userId = userId; next(); });
  app.use("/api/tests", reviewRouter);
  return app;
}

const expertApp = () => makeApp("expert-1");
const authorApp = () => makeApp("author-1");

/** Корень ветки от эксперта. */
function root(over: Record<string, unknown> = {}) {
  return {
    id: "c1", testId: "t1", authorId: "expert-1", parentId: null,
    body: "Формулировка допускает два прочтения",
    anchorKind: "question", questionId: "q1", topicId: "tp1", contentPageId: null,
    contextLabel: "Раздел «О компании» · Вопрос «…»",
    pinnedContentHash: "a".repeat(64),
    status: "open", resolvedBy: null, resolvedAt: null,
    createdAt: new Date("2026-09-02T14:20:00Z"), updatedAt: new Date("2026-09-02T14:20:00Z"),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockImplementation(async (id: string) => ({
    id, status: "active", email: `${id}@x`,
    name: id === "expert-1" ? "Ирина Петрова" : id === "author-1" ? "Автор Теста" : null,
  }));
  storageMock.getUserRoles.mockResolvedValue([ROLES.AUTHOR]);
  storageMock.getTest.mockResolvedValue(TEST);
  storageMock.getTestGrantForUser.mockResolvedValue(undefined);
  storageMock.listReviewThreads.mockResolvedValue([{ ...root(), replies: [] }]);
  storageMock.getReviewComment.mockResolvedValue(root());
  storageMock.hasReviewReplies.mockResolvedValue(false);
  storageMock.createReviewComment.mockImplementation(async (input: Record<string, unknown>) => root(input));
  storageMock.updateReviewCommentBody.mockImplementation(async (_id: string, body: string) => root({ body }));
  storageMock.deleteReviewComment.mockResolvedValue(true);
  storageMock.resolveReviewComment.mockImplementation(
    async (_id: string, outcome: Record<string, unknown>) => root(outcome),
  );
  storageMock.reopenReviewComment.mockResolvedValue(root({ status: "open" }));
  accessMock.canReviewTest.mockResolvedValue(true);
  accessMock.canGrantAccess.mockImplementation((_r: unknown, userId: string) => userId === "author-1");
  storageMock.getTestAccessGrants.mockResolvedValue([
    { testId: "t1", userId: "expert-1", accessLevel: "review", createdAt: new Date("2026-09-02") },
    { testId: "t1", userId: "manager-1", accessLevel: "assign", createdAt: new Date("2026-09-02") },
  ]);
  storageMock.removeTestAccessGrant.mockResolvedValue(true);
  storageMock.revokeReviewLinks.mockResolvedValue(undefined);
  accessMock.canEditTest.mockImplementation(async (_r: unknown, userId: string) => userId === "author-1");
  anchorMock.describeAnchor.mockResolvedValue({
    contextLabel: "Раздел «О компании» · Вопрос «…»", pinnedContentHash: "a".repeat(64),
  });
  anchorMock.isAnchorStale.mockResolvedValue(false);
  anchorMock.isAnchorOrphaned.mockResolvedValue(false);
  runMock.buildScormExportData.mockResolvedValue({
    test: { id: "t1", title: "Тест" }, designSettings: { templateId: "default" },
  });
  runMock.generateScormPackage.mockResolvedValue(Buffer.from("zip"));
  runMock.createDebugSession.mockResolvedValue({ token: "tok1", launch: "index.html" });
  runMock.getDebugSession.mockReturnValue({
    launch: "index.html", files: new Map([["index.html", Buffer.from("<html>")]]),
  });
  runMock.dropDebugSession.mockReturnValue(true);
  runMock.assessTestPublish.mockResolvedValue([]);
  runMock.readShimJs.mockReturnValue("/* shim */");
  runMock.readInspectorComputeJs.mockReturnValue("/* compute */");
});

describe("GET /:id/review/comments", () => {
  it("подписывает комментарий именем автора, а не идентификатором", async () => {
    const res = await request(expertApp()).get("/api/tests/t1/review/comments");
    expect(res.body[0].authorName).toBe("Ирина Петрова");
  });

  it("отдаёт ветки рецензенту", async () => {
    const res = await request(expertApp()).get("/api/tests/t1/review/comments");
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe("c1");
  });

  it("помечает ветку изменённой, когда содержимое разошлось с пином", async () => {
    anchorMock.isAnchorStale.mockResolvedValue(true);
    const res = await request(expertApp()).get("/api/tests/t1/review/comments");
    expect(res.body[0].stale).toBe(true);
  });

  it("помечает ветку осиротевшей, когда объект якоря удалён", async () => {
    anchorMock.isAnchorOrphaned.mockResolvedValue(true);
    const res = await request(expertApp()).get("/api/tests/t1/review/comments");
    expect(res.body[0].orphaned).toBe(true);
  });

  it("посторонний получает 403", async () => {
    accessMock.canReviewTest.mockResolvedValue(false);
    const res = await request(makeApp("stranger")).get("/api/tests/t1/review/comments");
    expect(res.status).toBe(403);
  });
});

describe("POST /:id/review/comments", () => {
  it("подставляет ярлык и пин по якорю", async () => {
    const res = await request(expertApp())
      .post("/api/tests/t1/review/comments")
      .send({ body: "Криво", anchor: { kind: "question", questionId: "q1" } });
    expect(res.status).toBe(201);
    expect(storageMock.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({
        contextLabel: "Раздел «О компании» · Вопрос «…»",
        pinnedContentHash: "a".repeat(64),
        authorId: "expert-1",
      }),
    );
  });

  it("ответ цепляется к корню и не несёт своего якоря", async () => {
    const res = await request(expertApp())
      .post("/api/tests/t1/review/comments")
      .send({ body: "Согласен", parentId: "c1" });
    expect(res.status).toBe(201);
    expect(storageMock.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: "c1" }),
    );
  });

  it("ответ на ответ отвергается: ветка ровно одного уровня", async () => {
    storageMock.getReviewComment.mockResolvedValue(root({ id: "r1", parentId: "c1" }));
    const res = await request(expertApp())
      .post("/api/tests/t1/review/comments")
      .send({ body: "Ещё", parentId: "r1" });
    expect(res.status).toBe(422);
    expect(storageMock.createReviewComment).not.toHaveBeenCalled();
  });

  it("пустой текст не проходит", async () => {
    const res = await request(expertApp())
      .post("/api/tests/t1/review/comments")
      .send({ body: "   ", anchor: { kind: "test" } });
    expect(res.status).toBe(400);
  });
});

describe("PATCH и DELETE — правка своего", () => {
  it("автор комментария правит свой текст", async () => {
    const res = await request(expertApp())
      .patch("/api/tests/t1/review/comments/c1")
      .send({ body: "Уточняю" });
    expect(res.status).toBe(200);
    expect(storageMock.updateReviewCommentBody).toHaveBeenCalledWith("c1", "Уточняю");
  });

  it("чужой комментарий не правится даже владельцем теста", async () => {
    const res = await request(authorApp())
      .patch("/api/tests/t1/review/comments/c1")
      .send({ body: "Перепишу за эксперта" });
    expect(res.status).toBe(403);
  });

  it("после ответа свой комментарий уже не правится", async () => {
    storageMock.hasReviewReplies.mockResolvedValue(true);
    const res = await request(expertApp())
      .patch("/api/tests/t1/review/comments/c1")
      .send({ body: "Поздно" });
    expect(res.status).toBe(409);
  });

  it("свой комментарий удаляется, пока на него не ответили", async () => {
    const res = await request(expertApp()).delete("/api/tests/t1/review/comments/c1");
    expect(res.status).toBe(200);
    expect(storageMock.deleteReviewComment).toHaveBeenCalledWith("c1");
  });

  it("чужой комментарий не удаляет никто, включая владельца теста", async () => {
    const res = await request(authorApp()).delete("/api/tests/t1/review/comments/c1");
    expect(res.status).toBe(403);
    expect(storageMock.deleteReviewComment).not.toHaveBeenCalled();
  });

  it("после ответа свой комментарий не удаляется", async () => {
    storageMock.hasReviewReplies.mockResolvedValue(true);
    const res = await request(expertApp()).delete("/api/tests/t1/review/comments/c1");
    expect(res.status).toBe(409);
  });
});

describe("исход ветки", () => {
  it("отклонение без ответа не проходит", async () => {
    const res = await request(authorApp())
      .post("/api/tests/t1/review/comments/c1/resolve")
      .send({ status: "rejected" });
    expect(res.status).toBe(422);
    expect(storageMock.resolveReviewComment).not.toHaveBeenCalled();
  });

  it("отклонение с ответом в ветке закрывает её", async () => {
    storageMock.hasReviewReplies.mockResolvedValue(true);
    const res = await request(authorApp())
      .post("/api/tests/t1/review/comments/c1/resolve")
      .send({ status: "rejected" });
    expect(res.status).toBe(200);
    expect(storageMock.resolveReviewComment).toHaveBeenCalledWith("c1", {
      status: "rejected", resolvedBy: "author-1",
    });
  });

  it("«учтено» ответа не требует", async () => {
    const res = await request(authorApp())
      .post("/api/tests/t1/review/comments/c1/resolve")
      .send({ status: "accepted" });
    expect(res.status).toBe(200);
  });

  it("рецензент закрыть ветку не может", async () => {
    const res = await request(expertApp())
      .post("/api/tests/t1/review/comments/c1/resolve")
      .send({ status: "accepted" });
    expect(res.status).toBe(403);
  });

  it("исход ставится только на корень ветки", async () => {
    storageMock.getReviewComment.mockResolvedValue(root({ id: "r1", parentId: "c1", status: null }));
    const res = await request(authorApp())
      .post("/api/tests/t1/review/comments/r1/resolve")
      .send({ status: "accepted" });
    expect(res.status).toBe(422);
  });

  it("закрытая ветка открывается заново", async () => {
    storageMock.getReviewComment.mockResolvedValue(root({ status: "accepted" }));
    const res = await request(authorApp()).post("/api/tests/t1/review/comments/c1/reopen");
    expect(res.status).toBe(200);
    expect(storageMock.reopenReviewComment).toHaveBeenCalledWith("c1");
  });

  it("комментарий чужого теста не трогается через свой", async () => {
    storageMock.getReviewComment.mockResolvedValue(root({ testId: "other" }));
    const res = await request(authorApp())
      .post("/api/tests/t1/review/comments/c1/resolve")
      .send({ status: "accepted" });
    expect(res.status).toBe(404);
  });
});

describe("прогон рецензирования", () => {
  it("собирает пакет из живого состояния с выключенной телеметрией", async () => {
    const res = await request(expertApp()).post("/api/tests/t1/review/session");
    expect(res.status).toBe(200);
    expect(res.body.playUrl).toBe("/api/tests/t1/review/play/tok1/index.html");
    expect(runMock.buildScormExportData).toHaveBeenCalledWith("t1", { source: "debug" });
    expect(runMock.generateScormPackage).toHaveBeenCalledWith(
      expect.objectContaining({ telemetry: null }),
    );
  });

  it("прогон не оставляет попытки", async () => {
    await request(expertApp()).post("/api/tests/t1/review/session");
    expect(storageMock.createReviewComment).not.toHaveBeenCalled();
    expect(Object.keys(storageMock)).not.toContain("createAttempt");
  });

  it("посторонний прогон не откроет", async () => {
    accessMock.canReviewTest.mockResolvedValue(false);
    const res = await request(makeApp("stranger")).post("/api/tests/t1/review/session");
    expect(res.status).toBe(403);
    expect(runMock.generateScormPackage).not.toHaveBeenCalled();
  });

  it("раздаёт файл пакета вербатим", async () => {
    const res = await request(expertApp()).get("/api/tests/t1/review/play/tok1/index.html");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toBe("<html>");
  });

  it("истёкший прогон отвечает 410, чужой токен — 404", async () => {
    runMock.getDebugSession.mockReturnValue("expired");
    expect((await request(expertApp()).get("/api/tests/t1/review/play/tok1/index.html")).status).toBe(410);
    runMock.getDebugSession.mockReturnValue(undefined);
    expect((await request(expertApp()).get("/api/tests/t1/review/play/tok1/index.html")).status).toBe(404);
  });

  it("отдаёт шим и вычислительный слой инспектора в окно рецензента", async () => {
    const shim = await request(expertApp()).get("/api/tests/t1/review/shim.js");
    const compute = await request(expertApp()).get("/api/tests/t1/review/inspector-compute.js");
    expect(shim.text).toBe("/* shim */");
    expect(compute.text).toBe("/* compute */");
  });

  it("закрывает прогон", async () => {
    const res = await request(expertApp()).delete("/api/tests/t1/review/session/tok1");
    expect(res.body.dropped).toBe(true);
  });
});

describe("рецензенты теста", () => {
  it("отдаёт ТОЛЬКО приглашённых рецензентов, а не всех, у кого есть доступ", async () => {
    const res = await request(authorApp()).get("/api/tests/t1/review/reviewers");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ userId: "expert-1", comments: 1 });
  });

  it("посторонний список не увидит", async () => {
    const res = await request(expertApp()).get("/api/tests/t1/review/reviewers");
    expect(res.status).toBe(403);
  });

  it("отзыв снимает грант И гасит живые ссылки", async () => {
    storageMock.getReviewComment.mockResolvedValue(root());
    storageMock.getTestGrantForUser.mockResolvedValue({ accessLevel: "review" });
    const res = await request(authorApp()).delete("/api/tests/t1/review/reviewers/expert-1");
    expect(res.status).toBe(200);
    expect(storageMock.removeTestAccessGrant).toHaveBeenCalledWith("t1", "expert-1");
    expect(storageMock.revokeReviewLinks).toHaveBeenCalledWith("t1", "expert-1");
  });

  it("отзыв не трогает грант другого уровня: edit-доступ отзывают не здесь", async () => {
    storageMock.getTestGrantForUser.mockResolvedValue({ accessLevel: "edit" });
    await request(authorApp()).delete("/api/tests/t1/review/reviewers/author-2");
    expect(storageMock.removeTestAccessGrant).not.toHaveBeenCalled();
    // Ссылки всё равно гасим: ревью-ссылка могла быть выдана раньше повышения.
    expect(storageMock.revokeReviewLinks).toHaveBeenCalledWith("t1", "author-2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRD-52 раздел 14: список рецензентов идёт СВОИМИ маршрутами под правом
// `tests.review.invite`. До этого вкладка ходила в маршруты участников, и автор
// — единственная роль, ради которой всё сделано, — получал там 403.
describe("список рецензентов", () => {
  beforeEach(() => {
    storageMock.getUserByEmail.mockResolvedValue(undefined);
    storageMock.getTestAssignments.mockResolvedValue([]);
    storageMock.getGroupUsers.mockResolvedValue([]);
  });

  it("разбирает набранные строки и отдаёт их со статусами", async () => {
    const res = await request(authorApp())
      .post("/api/tests/t1/review/preview")
      .send({ rows: [{ index: 0, email: "expert@x.test", name: "Ирина" }] });

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ email: "expert@x.test", name: "Ирина", status: "new" });
  });

  it("не владельцу теста отказывает", async () => {
    const res = await request(makeApp("author-2"))
      .post("/api/tests/t1/review/preview")
      .send({ rows: [{ index: 0, email: "expert@x.test", name: null }] });

    expect(res.status).toBe(403);
  });

  it("пустой список отклоняет фразой про список, а не про файл", async () => {
    const res = await request(authorApp()).post("/api/tests/t1/review/preview").send({ rows: [] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("empty_list");
    expect(res.body.error).toBe("В списке нет ни одного адреса.");
  });

  it("шаблон книги отдаётся под тем же правом", async () => {
    const res = await request(authorApp()).get("/api/tests/t1/review/template");

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("participants-template.xlsx");
  });

  it("отметка о выгрузке ссылок принимается и ничего не возвращает", async () => {
    const res = await request(authorApp())
      .post("/api/tests/t1/review/links-exported")
      .send({ count: 3 });

    expect(res.status).toBe(204);
  });

  it("отметку о выгрузке не владельцу не ставит", async () => {
    const res = await request(makeApp("author-2"))
      .post("/api/tests/t1/review/links-exported")
      .send({ count: 3 });

    expect(res.status).toBe(403);
  });
});
