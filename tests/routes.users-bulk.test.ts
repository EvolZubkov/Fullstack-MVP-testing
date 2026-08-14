/**
 * Tests for bulk user routes in /api/users:
 * - GET  /bulk-template
 * - POST /bulk-preview
 * - POST /bulk-import
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import ExcelJS from "exceljs";
import {
  addAoaSheet,
  readWorkbookFromBuffer,
  sheetToArrays,
  workbookToBuffer,
} from "../server/utils/excel";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock, sendEmailMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUsers: vi.fn(),
    getUserByEmail: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    getUserGroups: vi.fn(),
    setUserGroups: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    setUserRoles: vi.fn(),
    getGroups: vi.fn(),
    createGroup: vi.fn(),
    addUserToGroup: vi.fn(),
    createPasswordResetToken: vi.fn(),
    updateUserPassword: vi.fn(),
    deactivateUser: vi.fn(),
    activateUser: vi.fn(),
    deleteAttemptsByUserAndTest: vi.fn(),
    getAttemptsByUser: vi.fn(),
    getTests: vi.fn(),
  },
  sendEmailMock: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
// Bulk-import sends invites via sendInviteEmail({ to, userName, inviteLink });
// the single reset-password endpoint uses sendPasswordResetEmail. Map both to
// the same spy so either call path is observable.
vi.mock("../server/email", () => ({
  sendInviteEmail: sendEmailMock,
  sendPasswordResetEmail: sendEmailMock,
}));

import usersRouter from "../server/routes/users";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const authorUser = {
  id: "author1", email: "author@test.com", name: "Author", role: "author",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};
const learnerUser = { ...authorUser, id: "learner1", role: "learner", email: "learner@test.com" };

const groupA = { id: "grp1", name: "Группа А", description: null, createdAt: new Date(), createdBy: null };
const groupB = { id: "grp2", name: "Группа Б", description: null, createdAt: new Date(), createdBy: null };

const newUser = {
  id: "new1", email: "new@test.com", name: "Новый Юзер", role: "learner",
  status: "pending", mustChangePassword: true, gdprConsent: false,
  passwordHash: "hash", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: "author1",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/users", usersRouter);
  return app;
}

function asAuthor(req: request.Test) { return req.set("x-test-user", "author1"); }
function asLearner(req: request.Test) { return req.set("x-test-user", "learner1"); }

/** Build an XLSX buffer with the given rows (first row = header) */
async function makeXlsx(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addAoaSheet(wb, "Users", rows);
  return workbookToBuffer(wb);
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockImplementation((id: string) => {
    if (id === "author1") return Promise.resolve(authorUser);
    if (id === "learner1") return Promise.resolve(learnerUser);
    return Promise.resolve(undefined);
  });
  storageMock.getUserGroups.mockResolvedValue([]);
  storageMock.createPasswordResetToken.mockResolvedValue({});
  sendEmailMock.mockResolvedValue(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/bulk-template
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/users/bulk-template", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).get("/api/users/bulk-template");
    expect(res.status).toBe(401);
  });

  it("returns 403 for learner", async () => {
    storageMock.getUserRoles.mockResolvedValueOnce(["learner"]);
    const res = await asLearner(request(makeApp()).get("/api/users/bulk-template"));
    expect(res.status).toBe(403);
  });

  it("returns XLSX file with correct headers", async () => {
    const res = await asAuthor(request(makeApp()).get("/api/users/bulk-template"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.headers["content-disposition"]).toContain("users-template.xlsx");
  });

  it("XLSX file contains expected columns", async () => {
    const res = await asAuthor(request(makeApp()).get("/api/users/bulk-template").buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    }));
    const wb = await readWorkbookFromBuffer(res.body);
    const rows = sheetToArrays(wb.worksheets[0]);
    const header = rows[0] as string[];
    expect(header).toContain("email");
    expect(header).toContain("name");
    expect(header).toContain("role");
    expect(header).toContain("group");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/users/bulk-preview
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/users/bulk-preview", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).post("/api/users/bulk-preview");
    expect(res.status).toBe(401);
  });

  it("returns 403 for learner", async () => {
    storageMock.getUserRoles.mockResolvedValueOnce(["learner"]);
    const buf = await makeXlsx([["email", "name"], ["a@a.com", "Тест"]]);
    const res = await asLearner(request(makeApp()).post("/api/users/bulk-preview").attach("file", buf, "users.xlsx"));
    expect(res.status).toBe(403);
  });

  it("returns 400 when no file attached", async () => {
    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-preview"));
    expect(res.status).toBe(400);
  });

  it("returns 400 with a reason code for an unreadable file, not 500", async () => {
    const notAZip = Buffer.from("email;name\na@a.com;Тест\n", "utf8");
    const res = await asAuthor(
      request(makeApp()).post("/api/users/bulk-preview").attach("file", notAZip, "users.xlsx"),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("not_a_zip");
  });

  it("returns preview rows for new users", async () => {
    storageMock.getGroups.mockResolvedValue([groupA]);
    storageMock.getUserByEmail.mockResolvedValue(undefined); // all new

    const buf = await makeXlsx([
      ["email", "name", "role", "group"],
      ["alice@test.com", "Alice", "learner", "Группа А"],
      ["bob@test.com", "Bob", "learner", ""],
    ]);
    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-preview").attach("file", buf, "users.xlsx"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const alice = res.body[0];
    expect(alice.email).toBe("alice@test.com");
    expect(alice.status).toBe("new");
    expect(alice.groupId).toBe("grp1");
    expect(alice.groupFound).toBe(true);

    const bob = res.body[1];
    expect(bob.email).toBe("bob@test.com");
    expect(bob.groupId).toBeNull();
  });

  it("marks existing emails as duplicate", async () => {
    storageMock.getGroups.mockResolvedValue([]);
    storageMock.getUserByEmail.mockResolvedValue(learnerUser);

    const buf = await makeXlsx([["email", "name"], ["learner@test.com", "Learner"]]);
    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-preview").attach("file", buf, "users.xlsx"));
    expect(res.status).toBe(200);
    expect(res.body[0].status).toBe("duplicate");
    expect(res.body[0].existingId).toBe("learner1");
  });

  it("marks invalid emails as error", async () => {
    storageMock.getGroups.mockResolvedValue([]);
    const buf = await makeXlsx([["email", "name"], ["not-an-email", "Test"]]);
    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-preview").attach("file", buf, "users.xlsx"));
    expect(res.status).toBe(200);
    expect(res.body[0].status).toBe("error");
  });

  it("marks group as not found when group name doesn't match", async () => {
    storageMock.getGroups.mockResolvedValue([groupA]);
    storageMock.getUserByEmail.mockResolvedValue(undefined);

    const buf = await makeXlsx([["email", "name", "group"], ["x@test.com", "X", "Несуществующая группа"]]);
    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-preview").attach("file", buf, "users.xlsx"));
    expect(res.status).toBe(200);
    expect(res.body[0].groupFound).toBe(false);
    expect(res.body[0].groupId).toBeNull();
  });

  it("returns 400 for empty file", async () => {
    storageMock.getGroups.mockResolvedValue([]);
    const buf = await makeXlsx([["email", "name"]]); // only header, no data rows
    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-preview").attach("file", buf, "users.xlsx"));
    expect(res.status).toBe(400);
  });

  it("group matching is case-insensitive", async () => {
    storageMock.getGroups.mockResolvedValue([{ ...groupA, name: "Группа А" }]);
    storageMock.getUserByEmail.mockResolvedValue(undefined);

    const buf = await makeXlsx([["email", "name", "group"], ["y@test.com", "Y", "группа а"]]);
    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-preview").attach("file", buf, "users.xlsx"));
    expect(res.status).toBe(200);
    expect(res.body[0].groupFound).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/users/bulk-import
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/users/bulk-import", () => {
  const baseRow = {
    idx: 0, email: "new@test.com", name: "Новый", role: "learner",
    groupName: null, groupId: null, groupFound: false,
    status: "new", existingId: null,
  };

  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).post("/api/users/bulk-import").send({ rows: [baseRow], sendInvites: false });
    expect(res.status).toBe(401);
  });

  it("returns 403 for learner", async () => {
    storageMock.getUserRoles.mockResolvedValueOnce(["learner"]);
    const res = await asLearner(request(makeApp()).post("/api/users/bulk-import").send({ rows: [baseRow], sendInvites: false }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when rows is missing", async () => {
    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-import").send({ sendInvites: false }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when rows is empty array", async () => {
    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-import").send({ rows: [], sendInvites: false }));
    expect(res.status).toBe(400);
  });

  it("creates new users and returns counts", async () => {
    storageMock.createUser.mockResolvedValue(newUser);
    storageMock.getGroups.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-import").send({
      rows: [baseRow],
      sendInvites: false,
    }));
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.updated).toBe(0);
    expect(res.body.skipped).toBe(0);
    expect(storageMock.createUser).toHaveBeenCalledOnce();
    expect(storageMock.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: "new@test.com",
      name: "Новый",
      status: "pending",
      mustChangePassword: true,
    }));
  });

  it("skips rows with status=error", async () => {
    const errorRow = { ...baseRow, status: "error" };
    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-import").send({
      rows: [errorRow],
      sendInvites: false,
    }));
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(1);
    expect(res.body.created).toBe(0);
    expect(storageMock.createUser).not.toHaveBeenCalled();
  });

  it("skips duplicates with action=skip", async () => {
    const dupRow = { ...baseRow, status: "duplicate", existingId: "learner1", duplicateAction: "skip" };
    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-import").send({
      rows: [dupRow],
      sendInvites: false,
    }));
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(1);
    expect(storageMock.updateUser).not.toHaveBeenCalled();
  });

  it("updates duplicates with action=update", async () => {
    storageMock.updateUser.mockResolvedValue({ ...learnerUser, name: "Updated" });
    storageMock.getGroups.mockResolvedValue([]);

    const dupRow = {
      ...baseRow, status: "duplicate", existingId: "learner1",
      duplicateAction: "update", name: "Updated",
    };
    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-import").send({
      rows: [dupRow],
      sendInvites: false,
    }));
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(storageMock.updateUser).toHaveBeenCalledWith("learner1", expect.objectContaining({ name: "Updated" }));
  });

  it("assigns existing group by groupId", async () => {
    storageMock.createUser.mockResolvedValue(newUser);
    storageMock.addUserToGroup.mockResolvedValue({});
    storageMock.getGroups.mockResolvedValue([groupA]);

    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-import").send({
      rows: [{ ...baseRow, groupId: "grp1", groupName: "Группа А", groupFound: true }],
      sendInvites: false,
    }));
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(storageMock.addUserToGroup).toHaveBeenCalledWith("new1", "grp1");
  });

  it("auto-creates group when groupId is null but groupName is provided", async () => {
    storageMock.createUser.mockResolvedValue(newUser);
    storageMock.addUserToGroup.mockResolvedValue({});
    storageMock.getGroups.mockResolvedValue([]); // no groups in DB
    storageMock.createGroup.mockResolvedValue({ ...groupA, id: "new-grp", name: "Новая Группа" });

    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-import").send({
      rows: [{ ...baseRow, groupId: null, groupName: "Новая Группа", groupFound: false }],
      sendInvites: false,
    }));
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(storageMock.createGroup).toHaveBeenCalledWith(expect.objectContaining({ name: "Новая Группа" }));
    expect(storageMock.addUserToGroup).toHaveBeenCalledWith("new1", "new-grp");
  });

  it("does not duplicate auto-created group across multiple rows", async () => {
    storageMock.createUser.mockResolvedValue(newUser);
    storageMock.addUserToGroup.mockResolvedValue({});
    storageMock.getGroups.mockResolvedValue([]);
    storageMock.createGroup.mockResolvedValue({ ...groupA, id: "new-grp", name: "Новая Группа" });

    const row1 = { ...baseRow, email: "a1@test.com", groupId: null, groupName: "Новая Группа", groupFound: false };
    const row2 = { ...baseRow, idx: 1, email: "a2@test.com", groupId: null, groupName: "Новая Группа", groupFound: false };

    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-import").send({
      rows: [row1, row2],
      sendInvites: false,
    }));
    expect(res.status).toBe(200);
    // createGroup should only be called once — second row reuses cached id
    expect(storageMock.createGroup).toHaveBeenCalledTimes(1);
  });

  it("sends invite email when sendInvites=true", async () => {
    storageMock.createUser.mockResolvedValue(newUser);
    storageMock.getGroups.mockResolvedValue([]);
    sendEmailMock.mockResolvedValue(true);

    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-import").send({
      rows: [baseRow],
      sendInvites: true,
    }));
    expect(res.status).toBe(200);
    expect(res.body.invitesSent).toBe(1);
    expect(storageMock.createPasswordResetToken).toHaveBeenCalledOnce();
    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: newUser.email,
        inviteLink: expect.stringContaining("reset-password"),
      }),
    );
  });

  it("does not send invite emails when sendInvites=false", async () => {
    storageMock.createUser.mockResolvedValue(newUser);
    storageMock.getGroups.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-import").send({
      rows: [baseRow],
      sendInvites: false,
    }));
    expect(res.status).toBe(200);
    expect(res.body.invitesSent).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("collects per-row errors without failing whole import", async () => {
    storageMock.createUser.mockRejectedValue(new Error("Email taken"));
    storageMock.getGroups.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-import").send({
      rows: [baseRow],
      sendInvites: false,
    }));
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0]).toContain("new@test.com");
  });

  it("processes mixed rows: new + duplicate-skip + error", async () => {
    storageMock.createUser.mockResolvedValue(newUser);
    storageMock.getGroups.mockResolvedValue([]);

    const rows = [
      { ...baseRow, email: "new@test.com", status: "new" },
      { ...baseRow, idx: 1, email: "dup@test.com", status: "duplicate", existingId: "learner1", duplicateAction: "skip" },
      { ...baseRow, idx: 2, email: "bad-email", status: "error" },
    ];

    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-import").send({ rows, sendInvites: false }));
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.skipped).toBe(2); // duplicate-skip + error
    expect(res.body.updated).toBe(0);
  });
});
