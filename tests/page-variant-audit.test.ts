/**
 * @module tests/page-variant-audit
 * @description PRD-22 (plan Э6): the tests-list audit that counts content pages
 * bound to a variant their design template no longer declares. Locks the two
 * things the list depends on — the verdict itself, and that the audit costs a
 * fixed number of queries however many tests are on the page.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbState = vi.hoisted(() => ({ templates: [] as unknown[], selects: 0 }));

vi.mock("../server/db", () => ({
  db: {
    select: () => {
      dbState.selects += 1;
      return { from: () => ({ where: () => Promise.resolve(dbState.templates) }) };
    },
  },
}));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { countUnmappedPages, type AuditableTest } from "../server/services/page-variant-audit";
import type { IStorage } from "../server/storage";

const GRID = {
  id: "default",
  isActive: true,
  manifest: { contentTemplates: [{ key: "info.text" }, { key: "info.image-left" }] },
};

function storageWith(
  bindings: Array<{ testId: string; templateKey: string | null; kind: string }>,
  calls = { n: 0 },
): IStorage {
  return {
    getContentPageBindings: async (ids: string[]) => {
      calls.n += 1;
      return bindings.filter((b) => ids.includes(b.testId));
    },
  } as unknown as IStorage;
}

const test = (id: string, templateId?: string): AuditableTest => ({
  id,
  designSettingsJson: templateId ? { templateId } : null,
});

beforeEach(() => {
  dbState.templates = [GRID];
  dbState.selects = 0;
});

describe("countUnmappedPages", () => {
  it("counts only the pages whose variant the template does not declare", async () => {
    const counts = await countUnmappedPages(
      [test("t1"), test("t2")],
      storageWith([
        { testId: "t1", templateKey: "info.text", kind: "info" },
        { testId: "t1", templateKey: "gallery.card", kind: "info" },
        { testId: "t1", templateKey: "info.gone", kind: "info" },
        { testId: "t2", templateKey: "info.image-left", kind: "info" },
      ]),
    );

    expect(counts.get("t1")).toBe(2);
    // A test with nothing to map is absent, not zero — callers read it as «none».
    expect(counts.has("t2")).toBe(false);
  });

  it("ignores pages with no binding at all", async () => {
    const counts = await countUnmappedPages(
      [test("t1")],
      storageWith([{ testId: "t1", templateKey: null, kind: "info" }]),
    );
    expect(counts.size).toBe(0);
  });

  it("audits each test against ITS OWN design template", async () => {
    dbState.templates = [
      GRID,
      { id: "other", isActive: true, manifest: { contentTemplates: [{ key: "gallery.card" }] } },
    ];
    const counts = await countUnmappedPages(
      [test("t1"), test("t2", "other")],
      storageWith([
        { testId: "t1", templateKey: "gallery.card", kind: "info" },
        { testId: "t2", templateKey: "gallery.card", kind: "info" },
      ]),
    );

    expect(counts.get("t1")).toBe(1);
    expect(counts.has("t2")).toBe(false);
  });

  // Reporting a template problem as a content problem would flag EVERY page of the
  // test and send the author to «Структура», where there is nothing to fix.
  it("reports nothing when the template cannot be resolved", async () => {
    dbState.templates = [{ ...GRID, isActive: false }];
    const counts = await countUnmappedPages(
      [test("t1")],
      storageWith([{ testId: "t1", templateKey: "info.gone", kind: "info" }]),
    );
    expect(counts.size).toBe(0);
  });

  it("reports nothing, rather than failing, when the audit itself breaks", async () => {
    const broken = {
      getContentPageBindings: async () => {
        throw new Error("db down");
      },
    } as unknown as IStorage;

    await expect(countUnmappedPages([test("t1")], broken)).resolves.toEqual(new Map());
  });

  it("costs one page-binding call and one template query, whatever the list size", async () => {
    const calls = { n: 0 };
    const many = Array.from({ length: 40 }, (_, i) => test(`t${i}`, i % 2 ? "other" : undefined));
    await countUnmappedPages(many, storageWith([], calls));

    expect(calls.n).toBe(1);
    expect(dbState.selects).toBe(1);
  });

  it("returns an empty map for an empty list without touching the database", async () => {
    const calls = { n: 0 };
    expect(await countUnmappedPages([], storageWith([], calls))).toEqual(new Map());
    expect(calls.n).toBe(0);
    expect(dbState.selects).toBe(0);
  });
});
