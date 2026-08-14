/**
 * @module tests/config.limits.test
 * @description The `limits` section of {@link module:server/config} (PRD-28
 * задача 5): operational ceilings an installation may tune without a code
 * change. Two things are checked here — the defaults (they are the values the
 * code used to hard-code, so moving them into configuration must not change
 * behaviour for an installation that says nothing about `limits`), and that the
 * three call sites actually READ the setting instead of their old literal.
 *
 * The applied-limit cases tune the config singleton in place (the same trick
 * `tests/email.test.ts` uses for SMTP settings) and pick values that differ
 * from the defaults, so a handler that kept its literal fails the case.
 *
 * Harness mirrors tests/routes.auth-external.test.ts: hoisted storage mock,
 * mocked e-mail seam, supertest over an express app with a session shim.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import ExcelJS from "exceljs";
import { addAoaSheet, workbookToBuffer } from "../server/utils/excel";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock, sendInviteMock, sendResetMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserByEmail: vi.fn(),
    getUserRoles: vi.fn(),
    getUserGroups: vi.fn(),
    getGroups: vi.fn(),
    getRecentTokensCount: vi.fn(),
    createPasswordResetToken: vi.fn(),
  },
  sendInviteMock: vi.fn(),
  sendResetMock: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/email", () => ({
  sendInviteEmail: sendInviteMock,
  sendPasswordResetEmail: sendResetMock,
}));

// eslint-disable-next-line import/first -- import after vi.mock
import { config } from "../server/config";
// eslint-disable-next-line import/first
import authRouter from "../server/routes/auth";
// eslint-disable-next-line import/first
import usersRouter from "../server/routes/users";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const base = {
  name: "Кто-то", status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", isExternal: false,
  createdAt: new Date(), lastLoginAt: null, expiresAt: null, gdprConsentAt: null, createdBy: null,
};
const adminUser = { ...base, id: "admin1", email: "admin@test.com" };

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    req.session.userId = req.headers["x-test-user"] ?? "admin1";
    next();
  });
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  return app;
}

/** Build an XLSX buffer with `count` participant rows under a header. */
async function makeXlsx(count: number): Promise<Buffer> {
  const rows: string[][] = [["email", "name"]];
  for (let i = 0; i < count; i++) rows.push([`u${i}@test.com`, `U${i}`]);
  const wb = new ExcelJS.Workbook();
  addAoaSheet(wb, "Users", rows);
  return workbookToBuffer(wb);
}

let app: express.Express;
let savedLimits: typeof config.limits;

beforeEach(() => {
  vi.clearAllMocks();
  savedLimits = { ...config.limits };
  app = makeApp();
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockResolvedValue(adminUser);
  storageMock.getUserGroups.mockResolvedValue([]);
  storageMock.getGroups.mockResolvedValue([]);
  storageMock.getUserByEmail.mockResolvedValue(undefined);
  storageMock.getRecentTokensCount.mockResolvedValue(0);
  storageMock.createPasswordResetToken.mockResolvedValue({});
  sendInviteMock.mockResolvedValue(true);
  sendResetMock.mockResolvedValue(true);
});

afterEach(() => {
  config.limits = savedLimits;
});

describe("limits в конфигурации", () => {
  it("значения по умолчанию сохраняют нынешнее поведение", () => {
    expect(config.limits.participantsImportMaxRows).toBe(500);
    expect(config.limits.passwordEmailsPerHour).toBe(3);
  });
});

describe("потолок строк книги берётся из настроек", () => {
  it("книга сверх потолка отклоняется, и в тексте ошибки — настроенное число", async () => {
    config.limits = { ...config.limits, participantsImportMaxRows: 2 };

    const res = await request(app)
      .post("/api/users/bulk-preview")
      .attach("file", await makeXlsx(3), "users.xlsx");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Maximum 2 rows per upload");
  });

  it("книга ровно по потолку проходит", async () => {
    config.limits = { ...config.limits, participantsImportMaxRows: 2 };

    const res = await request(app)
      .post("/api/users/bulk-preview")
      .attach("file", await makeXlsx(2), "users.xlsx");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

describe("почасовой предел писем берётся из настроек", () => {
  it("приглашение отклоняется на сниженном пределе", async () => {
    config.limits = { ...config.limits, passwordEmailsPerHour: 1 };
    storageMock.getUser.mockImplementation((id: string) =>
      Promise.resolve(id === "u2" ? { ...base, id: "u2", email: "staff@example.com", status: "pending" } : adminUser),
    );
    storageMock.getRecentTokensCount.mockResolvedValue(1);

    const res = await request(app).post("/api/users/u2/invite").send({});

    expect(res.status).toBe(429);
    expect(sendInviteMock).not.toHaveBeenCalled();
  });

  it("восстановление доступа при поднятом пределе письмо всё же шлёт", async () => {
    // Three tokens in the last hour used to be the hard-coded refusal point;
    // with the ceiling raised the letter must go out.
    config.limits = { ...config.limits, passwordEmailsPerHour: 5 };
    storageMock.getUserByEmail.mockResolvedValue({ ...base, id: "u3", email: "staff@example.com" });
    storageMock.getRecentTokensCount.mockResolvedValue(3);

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "staff@example.com" });

    expect(res.status).toBe(200);
    expect(storageMock.createPasswordResetToken).toHaveBeenCalled();
    expect(sendResetMock).toHaveBeenCalled();
  });

  it("восстановление доступа отклоняется на сниженном пределе", async () => {
    config.limits = { ...config.limits, passwordEmailsPerHour: 1 };
    storageMock.getUserByEmail.mockResolvedValue({ ...base, id: "u3", email: "staff@example.com" });
    storageMock.getRecentTokensCount.mockResolvedValue(1);

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "staff@example.com" });

    expect(res.status).toBe(429);
    expect(sendResetMock).not.toHaveBeenCalled();
  });
});
