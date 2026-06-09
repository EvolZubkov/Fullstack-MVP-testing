/**
 * @module tests/template-registry.reconcile
 * @description Unit tests for the PRD-3 startup template-integrity gate
 * (`reconcileTemplates`): orphaned built-ins (phantom rows from an old build with
 * no files) are removed with a dependent-test repoint to `default`; uploaded
 * templates that are broken/missing are deactivated (not deleted); valid
 * templates keep their state; shipped built-ins are skipped; and an unchanged
 * source fingerprint skips the expensive re-validation.
 *
 * Uses REAL temp directories for the fingerprint walk (a global `node:fs` mock
 * leaks across the suite); only the DB, file reader and validator are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─── Hoisted mocks (DB + service layer only; fs stays real) ──────────────────
const { dbMock, pkgMock, valMock, state } = vi.hoisted(() => {
  const state: { rows: any[]; updates: Array<{ values: any }>; deletes: number } = {
    rows: [],
    updates: [],
    deletes: 0,
  };
  const dbMock: any = {
    select: () => ({ from: () => Promise.resolve(state.rows) }),
    update: () => ({
      set: (values: any) => ({
        where: () => {
          state.updates.push({ values });
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({
      where: () => {
        state.deletes += 1;
        return Promise.resolve();
      },
    }),
    transaction: async (cb: any) => cb(dbMock),
  };
  const pkgMock = { readDirEntries: vi.fn(async () => new Map<string, Buffer>()) };
  const valMock = { validateTemplatePackage: vi.fn(() => ({ ok: true, blocking: [], warnings: [], manifest: {} })) };
  return { dbMock, pkgMock, valMock, state };
});

vi.mock("../server/db", () => ({ db: dbMock }));
vi.mock("../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../server/services/template-package", () => pkgMock);
vi.mock("../server/services/template-validation", () => valMock);

import { reconcileTemplates } from "../server/template-registry";

// Real temp dirs for the fingerprint walk.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-reconcile-"));
function makeTemplateDir(id: string): string {
  const dir = path.join(tmpRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ id }));
  return dir;
}
const MISSING = path.join(tmpRoot, "does-not-exist");

afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [];
  state.updates = [];
  state.deletes = 0;
  pkgMock.readDirEntries.mockResolvedValue(new Map());
  valMock.validateTemplatePackage.mockReturnValue({ ok: true, blocking: [], warnings: [], manifest: {} });
});

describe("reconcileTemplates", () => {
  it("removes an orphaned built-in whose source files are missing", async () => {
    state.rows = [
      { id: "corporate", sourceType: "builtin", isActive: true, status: "active", sourcePath: MISSING, sourceFingerprint: null },
    ];
    await reconcileTemplates();
    expect(state.deletes).toBe(1); // row deleted (inside a transaction with the tests-repoint)
  });

  it("deactivates (not deletes) an uploaded template whose files are missing", async () => {
    state.rows = [
      { id: "acme", sourceType: "uploaded", isActive: true, status: "active", sourcePath: MISSING, sourceFingerprint: "x" },
    ];
    await reconcileTemplates();
    expect(state.deletes).toBe(0);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].values).toMatchObject({ status: "invalid", isActive: false, sourceFingerprint: null });
  });

  it("skips an uploaded missing template already invalid + inactive", async () => {
    state.rows = [
      { id: "acme", sourceType: "uploaded", isActive: false, status: "invalid", sourcePath: MISSING, sourceFingerprint: null },
    ];
    await reconcileTemplates();
    expect(state.updates).toHaveLength(0);
    expect(state.deletes).toBe(0);
  });

  it("skips a shipped built-in (validated by syncBuiltinTemplates)", async () => {
    state.rows = [
      { id: "default", sourceType: "builtin", isActive: true, status: "active", sourcePath: MISSING, sourceFingerprint: null },
    ];
    await reconcileTemplates();
    expect(state.updates).toHaveLength(0);
    expect(state.deletes).toBe(0);
    expect(pkgMock.readDirEntries).not.toHaveBeenCalled();
  });

  it("deactivates a present template that fails structural validation", async () => {
    const dir = makeTemplateDir("acme-bad");
    valMock.validateTemplatePackage.mockReturnValue({ ok: false, blocking: [{ code: "QUESTION_CONTRACT" }], warnings: [], manifest: {} });
    state.rows = [
      { id: "acme-bad", sourceType: "uploaded", isActive: true, status: "active", sourcePath: dir, sourceFingerprint: "old" },
    ];
    await reconcileTemplates();
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].values).toMatchObject({ status: "invalid", isActive: false });
    expect(typeof state.updates[0].values.sourceFingerprint).toBe("string");
  });

  it("keeps a valid present template active and persists report + fingerprint", async () => {
    const dir = makeTemplateDir("acme-ok");
    state.rows = [
      { id: "acme-ok", sourceType: "uploaded", isActive: true, status: "active", sourcePath: dir, sourceFingerprint: "stale" },
    ];
    await reconcileTemplates();
    expect(state.updates).toHaveLength(1);
    const v = state.updates[0].values;
    expect(v.validationJson).toBeDefined();
    expect(typeof v.sourceFingerprint).toBe("string");
    // Must NOT auto-(de)activate a valid template.
    expect(v.status).toBeUndefined();
    expect(v.isActive).toBeUndefined();
  });

  it("skips re-validation when the source fingerprint is unchanged", async () => {
    const dir = makeTemplateDir("acme-cached");
    state.rows = [{ id: "acme-cached", sourceType: "uploaded", isActive: true, status: "active", sourcePath: dir, sourceFingerprint: null }];

    // First pass computes + stores the fingerprint (validation runs once).
    await reconcileTemplates();
    expect(pkgMock.readDirEntries).toHaveBeenCalledTimes(1);
    const storedFp = state.updates[0].values.sourceFingerprint as string;
    expect(typeof storedFp).toBe("string");

    // Second pass with the stored fingerprint + untouched files → skip entirely.
    vi.clearAllMocks();
    state.updates = [];
    state.rows = [{ id: "acme-cached", sourceType: "uploaded", isActive: true, status: "active", sourcePath: dir, sourceFingerprint: storedFp }];
    await reconcileTemplates();
    expect(pkgMock.readDirEntries).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });
});
