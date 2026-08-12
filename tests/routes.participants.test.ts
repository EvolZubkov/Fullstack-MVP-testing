/**
 * @module tests/routes.participants
 * @description PRD-28 (FR-09, FR-10, FR-14, FR-22): the three endpoints behind
 * the «Списком из файла» tab — preview, run and file template.
 *
 * What is pinned here is the ROUTE layer only: who may call it, how an uploaded
 * file turns into an answer, and how the two conditions the pipeline refuses on
 * (a missing test, a taken group name) are told apart in the response. The
 * pipeline itself is pinned in `tests/services.participants-invite.test.ts`.
 *
 * The delivery seam is left real on purpose: the run then mints actual links,
 * which is what lets the audit case assert that none of them reaches the log.
 * Only the e-mail transport is mocked.
 *
 * Harness mirrors `tests/routes.assignments.test.ts`: hoisted storage mock,
 * mocked e-mail seam, supertest over an express app with a session shim.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import ExcelJS from "exceljs";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock, sendEmailMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn(),
    getUserByEmail: vi.fn(),
    getTest: vi.fn(),
    getTestGrantForUser: vi.fn(),
    getTestAssignments: vi.fn(),
    getGroupUsers: vi.fn(),
    getGroups: vi.fn(),
    createGroup: vi.fn(),
    addUserToGroup: vi.fn(),
    createUser: vi.fn(),
    setUserRoles: vi.fn(),
    updateUser: vi.fn(),
    createTestAssignment: vi.fn(),
    createAssignmentAccessToken: vi.fn(),
    revokeAssignmentAccessTokensByAssignmentAndUser: vi.fn(),
  },
  sendEmailMock: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/email", () => ({ sendAssignmentEmail: sendEmailMock }));

// eslint-disable-next-line import/first -- import after vi.mock
import { config } from "../server/config";
// eslint-disable-next-line import/first
import { addAoaSheet, workbookToBuffer } from "../server/utils/excel";
// eslint-disable-next-line import/first
import assignmentsRouter from "../server/routes/assignments";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const base = {
  name: "Кто-то", status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", isExternal: false,
  createdAt: new Date(), lastLoginAt: null, expiresAt: null, gdprConsentAt: null, createdBy: null,
};
const managerUser = { ...base, id: "mgr1", email: "manager@test.com", name: "Менеджер" };
const learnerUser = { ...base, id: "lrn1", email: "learner@test.com", name: "Учащийся" };

const dbTest = { id: "t1", title: "Тест", description: null, ownerId: "author1" };

/** Roles by user id; anyone unknown is a plain learner (the recipients). */
const rolesById: Record<string, string[]> = { mgr1: ["manager"], lrn1: ["learner"] };

/** Build an xlsx buffer from an array-of-arrays, first row being the header. */
async function workbookWith(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addAoaSheet(wb, "Участники", rows);
  return workbookToBuffer(wb);
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    req.session.userId = (req.headers["x-test-user"] as string) ?? "mgr1";
    next();
  });
  app.use("/api", assignmentsRouter);
  return app;
}

/** A request as the given identity; the manager holds an assign grant on `t1`. */
function as(userId: string, req: request.Test) {
  return req.set("x-test-user", userId);
}

let app: express.Express;
let savedLimits: typeof config.limits;

beforeEach(() => {
  vi.clearAllMocks();
  savedLimits = { ...config.limits };
  app = makeApp();

  storageMock.getUser.mockImplementation((id: string) =>
    Promise.resolve(id === "mgr1" ? managerUser : id === "lrn1" ? learnerUser : undefined));
  storageMock.getUserRoles.mockImplementation((id: string) =>
    Promise.resolve(rolesById[id] ?? ["learner"]));
  storageMock.getTest.mockResolvedValue(dbTest);
  // Object-level scope: the manager may assign this particular test.
  storageMock.getTestGrantForUser.mockResolvedValue({ accessLevel: "assign" });
  storageMock.getTestAssignments.mockResolvedValue([]);
  storageMock.getGroupUsers.mockResolvedValue([]);
  storageMock.getGroups.mockResolvedValue([]);
  storageMock.getUserByEmail.mockResolvedValue(undefined);
  storageMock.createGroup.mockImplementation((g: Record<string, unknown>) =>
    Promise.resolve({ ...g, id: "g-new" }));
  storageMock.addUserToGroup.mockResolvedValue(undefined);
  storageMock.createUser.mockImplementation((u: Record<string, unknown>) =>
    Promise.resolve({ ...u, id: `u-${u.email}`, name: u.name ?? null, emailHash: "x" }));
  storageMock.setUserRoles.mockResolvedValue(undefined);
  storageMock.updateUser.mockImplementation((id: string, data: Record<string, unknown>) =>
    Promise.resolve({ id, ...data }));
  storageMock.createTestAssignment.mockImplementation((a: Record<string, unknown>) =>
    Promise.resolve({ ...a, id: "as-1" }));
  storageMock.createAssignmentAccessToken.mockResolvedValue({ id: "tok-1" });
  storageMock.revokeAssignmentAccessTokensByAssignmentAndUser.mockResolvedValue(undefined);
  sendEmailMock.mockResolvedValue(true);
});

afterEach(() => {
  config.limits = savedLimits;
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/tests/:id/participants/preview", () => {
  it("требует прав и области теста", async () => {
    const buf = await workbookWith([["email", "name"], ["a@x.ru", "Анна"]]);

    const res = await as("lrn1", request(app).post("/api/tests/t1/participants/preview"))
      .attach("file", buf, "list.xlsx");

    expect(res.status).toBe(403);
  });

  it("возвращает строки со статусами", async () => {
    const buf = await workbookWith([["email", "name"], ["a@x.ru", "Анна"]]);

    const res = await as("mgr1", request(app).post("/api/tests/t1/participants/preview"))
      .attach("file", buf, "list.xlsx");

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ email: "a@x.ru", status: "new" });
  });

  it("отклоняет файл сверх потолка", async () => {
    config.limits = { ...config.limits, participantsImportMaxRows: 1 };
    const buf = await workbookWith([["email", "name"], ["a@x.ru", "А"], ["b@x.ru", "Б"]]);

    const res = await as("mgr1", request(app).post("/api/tests/t1/participants/preview"))
      .attach("file", buf, "list.xlsx");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Maximum/);
  });

  it("отсутствие файла — ошибка запроса, а не сбой сервера", async () => {
    const res = await as("mgr1", request(app).post("/api/tests/t1/participants/preview"));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/File required/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/tests/:id/participants/invite", () => {
  const rows = [{ index: 0, email: "a@x.ru", name: "Анна", status: "new", userId: null }];

  it("возвращает отчёт", async () => {
    const res = await as("mgr1", request(app).post("/api/tests/t1/participants/invite"))
      .send({ rows, groupName: null });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 1, assigned: 1 });
  });

  it("требует прав и области теста", async () => {
    const res = await as("lrn1", request(app).post("/api/tests/t1/participants/invite"))
      .send({ rows });

    expect(res.status).toBe(403);
  });

  it("занятое имя группы отдаёт 400 с текстом для оператора", async () => {
    storageMock.getGroups.mockResolvedValue([{ id: "g1", name: "Поток 12" }]);

    const res = await as("mgr1", request(app).post("/api/tests/t1/participants/invite"))
      .send({ rows, groupName: "Поток 12" });

    expect(res.status).toBe(400);
    // Shown to the operator verbatim: it names the group they must rename.
    expect(res.body.error).toBe("Группа с таким именем уже есть: Поток 12");
    expect(storageMock.createGroup).not.toHaveBeenCalled();
  });

  it("несуществующий тест отдаёт 404", async () => {
    storageMock.getTest.mockResolvedValue(undefined);

    const res = await as("mgr1", request(app).post("/api/tests/t1/participants/invite"))
      .send({ rows });

    expect(res.status).toBe(404);
  });

  it("тест, исчезнувший после проверки области, тоже отдаёт 404", async () => {
    // The scope middleware and the run each read the test; between them it can
    // be deleted. The run refuses, and the route must not turn that into a 500.
    storageMock.getTest.mockResolvedValueOnce(dbTest).mockResolvedValue(undefined);

    const res = await as("mgr1", request(app).post("/api/tests/t1/participants/invite"))
      .send({ rows });

    expect(res.status).toBe(404);
  });

  it("пустой список отклоняется", async () => {
    const res = await as("mgr1", request(app).post("/api/tests/t1/participants/invite"))
      .send({ rows: [] });

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/tests/:id/participants/template", () => {
  it("отдаёт книгу с двумя колонками", async () => {
    const res = await as("mgr1", request(app).get("/api/tests/t1/participants/template"))
      .buffer()
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("participants-template.xlsx");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const ws = wb.worksheets[0];
    // Two columns and no more: `role` and `group` are ignored by the reader, and
    // offering them in the template would promise behaviour that does not exist.
    expect(ws.getRow(1).values).toEqual([undefined, "email", "name"]);
  });

  it("учащемуся отказано", async () => {
    const res = await as("lrn1", request(app).get("/api/tests/t1/participants/template"));

    expect(res.status).toBe(403);
  });
});
