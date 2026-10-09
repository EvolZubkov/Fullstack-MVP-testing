/**
 * @module tests/routes.test-transfer-export
 * @description Stage E5 (owner decision Р7 2026-10-05): the `.tbtest` export takes a version.
 * `?source=published` builds the package from the active snapshot, `draft` (and no parameter)
 * from the working draft; a test with no published version answers 409, a bad value 400.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { storageMock, buildTransferZipMock, publishedSnapshotOfMock } = vi.hoisted(() => ({
  storageMock: { getTest: vi.fn() },
  buildTransferZipMock: vi.fn(),
  publishedSnapshotOfMock: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/middleware/auth", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../server/middleware/test-scope", () => ({
  requireTestScope: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../server/services/test-transfer/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/services/test-transfer/export")>()),
  buildTransferZip: buildTransferZipMock,
}));
vi.mock("../server/services/test-snapshot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/services/test-snapshot")>()),
  publishedSnapshotOf: publishedSnapshotOfMock,
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import transferRouter from "../server/routes/test-transfer";

function makeApp() {
  const app = express();
  app.use((req: any, _res, next) => { req.session = { userId: "u1" }; next(); });
  app.use("/api/tests", transferRouter);
  return app;
}

const SNAPSHOT_CONTENT = { test: { id: "t1", title: "Опубликованный" } };

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTest.mockResolvedValue({ id: "t1", title: "Тест" });
  buildTransferZipMock.mockResolvedValue({ buffer: Buffer.from("PK"), pkg: { missingMedia: [] } });
});

describe("GET /api/tests/:id/transfer — version (E5)", () => {
  it("no parameter and «draft» build from the working draft", async () => {
    for (const query of ["", "?source=draft"]) {
      const res = await request(makeApp()).get(`/api/tests/t1/transfer${query}`);
      expect(res.status).toBe(200);
      expect(buildTransferZipMock).toHaveBeenLastCalledWith("t1", {});
    }
    expect(publishedSnapshotOfMock).not.toHaveBeenCalled();
  });

  it("«published» builds from the active snapshot", async () => {
    publishedSnapshotOfMock.mockResolvedValue({ id: "snap", version: 4, contentJson: SNAPSHOT_CONTENT });
    const res = await request(makeApp()).get("/api/tests/t1/transfer?source=published");

    expect(res.status).toBe(200);
    const [, opts] = buildTransferZipMock.mock.calls[0] as [string, { loadContent: () => Promise<unknown> }];
    await expect(opts.loadContent()).resolves.toBe(SNAPSHOT_CONTENT);
  });

  it("«published» of a test without a published version — 409; a bad value — 400", async () => {
    publishedSnapshotOfMock.mockResolvedValue(null);
    expect((await request(makeApp()).get("/api/tests/t1/transfer?source=published")).status).toBe(409);
    expect((await request(makeApp()).get("/api/tests/t1/transfer?source=old")).status).toBe(400);
    expect(buildTransferZipMock).not.toHaveBeenCalled();
  });
});
