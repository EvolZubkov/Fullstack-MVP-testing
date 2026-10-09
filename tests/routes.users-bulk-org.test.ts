/**
 * @module tests/routes.users-bulk-org
 * @description Org-structure fields and the LMS learner id in the users bulk
 * import (org-structure plan, task 2; PRD-54 BR-54-29).
 *
 * Without these columns people created by a list stay without a unit, and the
 * analytics slices have nothing to split them by; filling it in afterwards means
 * one form per person. Rules asserted here:
 *  - the template offers the columns, the preview reads and shows them;
 *  - an LMS learner id held by someone else is a row error, like a taken key;
 *  - a new row is created with the fields; an existing one gets them only by an
 *    explicit update, and an EMPTY cell never wipes what the profile has.
 *
 * Harness mirrors routes.users.coverage.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import ExcelJS from "exceljs";
import { addAoaSheet, readWorkbookFromBuffer, workbookToBuffer } from "../server/utils/excel";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserByEmail: vi.fn(),
    getUserByExternalKey: vi.fn(),
    getUserByLmsLearnerId: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    getUserRoles: vi.fn(),
    setUserRoles: vi.fn(),
    getUserGroups: vi.fn(),
    getGroups: vi.fn(),
    createGroup: vi.fn(),
    addUserToGroup: vi.fn(),
    createPasswordResetToken: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/email", () => ({ sendInviteEmail: vi.fn(), sendPasswordResetEmail: vi.fn() }));
vi.mock("../server/superadmin", () => ({ isSuperadminEmailHash: () => false, superadminEmails: () => [] }));

import usersRouter from "../server/routes/users";

const base = {
  status: "active", mustChangePassword: false, gdprConsent: true, isExternal: false,
  createdAt: new Date(), lastLoginAt: null, createdBy: null,
};
const admin = { ...base, id: "admin1", email: "admin@test.com", name: "Admin" };
const petrov = { ...base, id: "petrov1", email: "petrov@test.com", name: "Петров Иван" };

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

const asAdmin = (req: request.Test) => req.set("x-test-user", "admin1");

async function makeXlsx(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addAoaSheet(wb, "Users", rows);
  return workbookToBuffer(wb);
}

beforeEach(() => {
  vi.resetAllMocks();
  storageMock.getUser.mockImplementation((id: string) => Promise.resolve(id === "admin1" ? admin : undefined));
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getGroups.mockResolvedValue([]);
  storageMock.getUserByEmail.mockResolvedValue(undefined);
  storageMock.getUserByExternalKey.mockResolvedValue(undefined);
  storageMock.getUserByLmsLearnerId.mockResolvedValue(undefined);
  storageMock.createUser.mockImplementation((u: object) => Promise.resolve({ ...base, ...u, id: "new1" }));
  storageMock.updateUser.mockResolvedValue(petrov);
});

describe("GET /api/users/bulk-template", () => {
  it("offers the org-structure and LMS-id columns", async () => {
    const res = await asAdmin(request(makeApp()).get("/api/users/bulk-template"))
      .buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    const wb = await readWorkbookFromBuffer(res.body as Buffer);
    const header = (wb.worksheets[0].getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual(expect.arrayContaining(["organization", "unit", "position", "lms_learner_id"]));
  });
});

describe("POST /api/users/bulk-preview — org columns", () => {
  it("reads the columns, Russian headers included, into the preview row", async () => {
    const file = await makeXlsx([
      ["email", "Организация", "Подразделение", "Должность", "Идентификатор в LMS"],
      ["new@test.com", "АО «Ромашка»", " Отдел  продаж ", "Менеджер", "new_n"],
    ]);
    const res = await asAdmin(request(makeApp()).post("/api/users/bulk-preview")).attach("file", file, "u.xlsx");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      status: "new", organization: "АО «Ромашка»", unit: "Отдел продаж", position: "Менеджер", lmsLearnerId: "new_n",
    });
  });

  it("marks a row whose LMS learner id another person holds as an error", async () => {
    storageMock.getUserByLmsLearnerId.mockResolvedValue(petrov);
    const file = await makeXlsx([["email", "lms_learner_id"], ["gavrilov@test.com", "petrov_i"]]);
    const res = await asAdmin(request(makeApp()).post("/api/users/bulk-preview")).attach("file", file, "u.xlsx");
    expect(res.body[0].status).toBe("error");
    expect(res.body[0].error).toContain("Петров Иван");
  });

  it("lets an existing person keep their own LMS learner id and offers it as a key update", async () => {
    storageMock.getUserByEmail.mockResolvedValue(petrov);
    storageMock.getUserByLmsLearnerId.mockResolvedValue(petrov);
    const file = await makeXlsx([["email", "lms_learner_id"], ["petrov@test.com", "petrov_i"]]);
    const res = await asAdmin(request(makeApp()).post("/api/users/bulk-preview")).attach("file", file, "u.xlsx");
    expect(res.body[0]).toMatchObject({ status: "keyUpdate", lmsLearnerId: "petrov_i" });
  });
});

describe("POST /api/users/bulk-import — org columns", () => {
  const importRows = (rows: object[]) =>
    asAdmin(request(makeApp()).post("/api/users/bulk-import")).send({ sendInvites: false, rows });

  it("creates a new row with its org fields and LMS learner id", async () => {
    await importRows([{
      email: "new@test.com", status: "new",
      organization: "АО «Ромашка»", unit: "Отдел продаж", position: "Менеджер", lmsLearnerId: "new_n",
    }]);
    expect(storageMock.createUser).toHaveBeenCalledWith(expect.objectContaining({
      organization: "АО «Ромашка»", unit: "Отдел продаж", position: "Менеджер", lmsLearnerId: "new_n",
    }));
  });

  it("updates a duplicate's org fields on «Обновить», leaving empty cells alone", async () => {
    await importRows([{
      email: "petrov@test.com", status: "duplicate", duplicateAction: "update", existingId: "petrov1",
      name: "Петров Иван", unit: "Отдел продаж", position: "Старший менеджер", organization: null,
    }]);
    const patch = storageMock.updateUser.mock.calls[0][1];
    expect(patch).toMatchObject({ unit: "Отдел продаж", position: "Старший менеджер" });
    expect(patch).not.toHaveProperty("organization");
  });

  it("does not touch a duplicate that is skipped", async () => {
    await importRows([{
      email: "petrov@test.com", status: "duplicate", duplicateAction: "skip", existingId: "petrov1", unit: "X",
    }]);
    expect(storageMock.updateUser).not.toHaveBeenCalled();
  });

  it("writes the LMS learner id and org fields on a key update", async () => {
    await importRows([{
      email: "petrov@test.com", status: "keyUpdate", existingId: "petrov1", lmsLearnerId: "petrov_i", unit: "Логистика",
    }]);
    expect(storageMock.updateUser.mock.calls[0][1]).toMatchObject({ lmsLearnerId: "petrov_i", unit: "Логистика" });
    expect(storageMock.updateUser.mock.calls[0][1]).not.toHaveProperty("externalKey");
  });
});
