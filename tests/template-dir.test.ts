/**
 * @module tests/template-dir
 *
 * Locks the template-directory resolution (PRD-3 fix): a template connected to a
 * test must resolve to its real on-disk `sourcePath` from the `templates` table —
 * for BOTH uploaded templates AND the built-in `default`. The latter matters in a
 * bundled production build, where a `__dirname`-relative guess points at a path
 * that does not exist; the DB `sourcePath` (process.cwd-based) is correct.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";

// db is created at import time and throws without DATABASE_URL — stub it so the
// resolver can be unit-tested without a database.
const selectMock = vi.fn();
vi.mock("../server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => selectMock() }) }),
  },
}));

import { resolveTemplateDir, defaultTemplateDir } from "../server/services/template-dir";

// An on-disk directory that is guaranteed to exist (the built-in default ships).
const EXISTING_DIR = defaultTemplateDir();

beforeEach(() => {
  selectMock.mockReset();
});

describe("resolveTemplateDir", () => {
  it("resolves the `default` template via its DB sourcePath (not a __dirname guess)", async () => {
    selectMock.mockResolvedValueOnce([{ sourcePath: EXISTING_DIR }]); // default lookup
    expect(await resolveTemplateDir("default")).toBe(EXISTING_DIR);
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("resolves an uploaded template to its on-disk sourcePath", async () => {
    selectMock.mockResolvedValueOnce([{ sourcePath: EXISTING_DIR }]); // requested lookup
    expect(await resolveTemplateDir("my-template")).toBe(EXISTING_DIR);
  });

  it("falls back to the default sourcePath when the requested files are missing", async () => {
    selectMock
      .mockResolvedValueOnce([{ sourcePath: path.join(EXISTING_DIR, "__missing__") }]) // requested: gone
      .mockResolvedValueOnce([{ sourcePath: EXISTING_DIR }]); // default
    expect(await resolveTemplateDir("my-template")).toBe(EXISTING_DIR);
  });

  it("falls back to the default sourcePath for an unknown id (no row)", async () => {
    selectMock
      .mockResolvedValueOnce([]) // requested: none
      .mockResolvedValueOnce([{ sourcePath: EXISTING_DIR }]); // default
    expect(await resolveTemplateDir("ghost")).toBe(EXISTING_DIR);
  });

  it("resolves an empty/nullish id via the default sourcePath", async () => {
    selectMock.mockResolvedValueOnce([{ sourcePath: EXISTING_DIR }]);
    expect(await resolveTemplateDir("")).toBe(EXISTING_DIR);
    selectMock.mockResolvedValueOnce([{ sourcePath: EXISTING_DIR }]);
    expect(await resolveTemplateDir(undefined)).toBe(EXISTING_DIR);
  });

  it("degrades to the computed default dir when the db query throws", async () => {
    selectMock.mockRejectedValue(new Error("db down"));
    expect(await resolveTemplateDir("my-template")).toBe(defaultTemplateDir());
  });
});
