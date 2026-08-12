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

import { resolveTemplateDir, resolveSystemScreenDir, defaultTemplateDir } from "../server/services/template-dir";

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

  // ── Fix C: learner-facing render must not serve a non-active template ───────
  describe("activeOnly", () => {
    it("resolves an active template normally", async () => {
      selectMock.mockResolvedValueOnce([{ sourcePath: EXISTING_DIR, isActive: true }]);
      expect(await resolveTemplateDir("my-template", { activeOnly: true })).toBe(EXISTING_DIR);
      expect(selectMock).toHaveBeenCalledTimes(1);
    });

    it("falls back to default when the requested template is inactive", async () => {
      selectMock
        .mockResolvedValueOnce([{ sourcePath: EXISTING_DIR, isActive: false }]) // requested: inactive
        .mockResolvedValueOnce([{ sourcePath: EXISTING_DIR, isActive: true }]); // default
      expect(await resolveTemplateDir("draft-template", { activeOnly: true })).toBe(EXISTING_DIR);
      expect(selectMock).toHaveBeenCalledTimes(2);
    });

    it("still resolves an inactive template when activeOnly is not set (preview path)", async () => {
      selectMock.mockResolvedValueOnce([{ sourcePath: EXISTING_DIR, isActive: false }]);
      expect(await resolveTemplateDir("draft-template")).toBe(EXISTING_DIR);
    });
  });

  // ── System-screen fallback: a screen kind the template doesn't own → default ──
  describe("resolveSystemScreenDir", () => {
    it("uses the template's own dir when it declares a contentTemplate of the kind", async () => {
      selectMock
        .mockResolvedValueOnce([{ manifest: { contentTemplates: [{ kind: "start" }] } }]) // owns "start"
        .mockResolvedValueOnce([{ sourcePath: EXISTING_DIR, isActive: true }]); // own lookup
      expect(await resolveSystemScreenDir("my-template", "start", { activeOnly: true })).toBe(EXISTING_DIR);
    });

    it("falls back to default when the template declares no contentTemplate of the kind", async () => {
      selectMock
        .mockResolvedValueOnce([{ manifest: { contentTemplates: [{ kind: "intro" }] } }]) // no "start"
        .mockResolvedValueOnce([{ sourcePath: EXISTING_DIR, isActive: true }]); // default lookup
      expect(await resolveSystemScreenDir("my-template", "start")).toBe(EXISTING_DIR);
    });

    it("does not force a fallback when the manifest has no contentTemplates array", async () => {
      selectMock
        .mockResolvedValueOnce([{ manifest: {} }]) // unknown shape → treat as owning
        .mockResolvedValueOnce([{ sourcePath: EXISTING_DIR, isActive: true }]);
      expect(await resolveSystemScreenDir("my-template", "start")).toBe(EXISTING_DIR);
    });

    it("skips the ownership check for the default template id", async () => {
      selectMock.mockResolvedValueOnce([{ sourcePath: EXISTING_DIR }]); // default lookup only
      expect(await resolveSystemScreenDir("default", "start")).toBe(EXISTING_DIR);
      expect(selectMock).toHaveBeenCalledTimes(1);
    });
  });
});
