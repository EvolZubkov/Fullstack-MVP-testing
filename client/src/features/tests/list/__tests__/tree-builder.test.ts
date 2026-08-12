/**
 * @module features/tests/list/__tests__/tree-builder.test
 * @description Unit tests for the pure tree/search builders. No DOM, no API —
 * we feed plain arrays and assert the produced row stream.
 */
import { describe, expect, it } from "vitest";
import {
  buildSearchRows,
  buildTreeRows,
  descendantFolderIds,
  excludeArchived,
  sortTests,
} from "../tree-builder";
import type {
  FolderEntry,
  TestListEntry,
} from "../tests-list.types";

function test(
  overrides: Partial<TestListEntry> & { id: string; title: string },
): TestListEntry {
  return {
    status: "draft",
    mode: "standard",
    flowMode: "linear_flat",
    folderId: null,
    topicCount: 1,
    questionCount: 10,
    assignmentCount: 0,
    updatedAt: "2026-01-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function folder(id: string, name: string, parentId: string | null = null): FolderEntry {
  return { id, name, parentId };
}

// ─── sortTests ────────────────────────────────────────────────────────────────

describe("sortTests", () => {
  it("title_asc sorts by Russian locale", () => {
    const result = sortTests(
      [test({ id: "1", title: "Я" }), test({ id: "2", title: "А" }), test({ id: "3", title: "К" })],
      "title_asc",
    );
    expect(result.map((t) => t.id)).toEqual(["2", "3", "1"]);
  });

  it("updated_desc puts most recently updated first", () => {
    const result = sortTests(
      [
        test({ id: "1", title: "A", updatedAt: "2026-01-01T00:00:00Z" }),
        test({ id: "2", title: "B", updatedAt: "2026-05-01T00:00:00Z" }),
        test({ id: "3", title: "C", updatedAt: "2026-03-01T00:00:00Z" }),
      ],
      "updated_desc",
    );
    expect(result.map((t) => t.id)).toEqual(["2", "3", "1"]);
  });

  it("created_desc puts most recently created first", () => {
    const result = sortTests(
      [
        test({ id: "1", title: "A", createdAt: "2026-01-01T00:00:00Z" }),
        test({ id: "2", title: "B", createdAt: "2026-04-01T00:00:00Z" }),
      ],
      "created_desc",
    );
    expect(result.map((t) => t.id)).toEqual(["2", "1"]);
  });
});

// ─── excludeArchived (FR-31) ──────────────────────────────────────────────────

describe("excludeArchived (FR-31)", () => {
  it("drops archived rows", () => {
    const result = excludeArchived([
      test({ id: "1", title: "A", status: "published" }),
      test({ id: "2", title: "B", status: "archived" }),
      test({ id: "3", title: "C", status: "draft" }),
    ]);
    expect(result.map((t) => t.id)).toEqual(["1", "3"]);
  });
});

// ─── buildTreeRows ────────────────────────────────────────────────────────────

describe("buildTreeRows", () => {
  it("emits root row + folders + indented tests + root-level tests", () => {
    const folders = [folder("f1", "Информационная безопасность")];
    const tests = [
      test({ id: "t1", title: "Основы ИБ", folderId: "f1" }),
      test({ id: "t2", title: "Аудит логов", folderId: null }),
    ];
    const rows = buildTreeRows({
      tests,
      folders,
      expandedFolderIds: new Set(["f1"]),
      sort: "title_asc",
    });

    expect(rows[0]).toEqual({ kind: "root", testsCount: 2 });
    expect(rows[1]).toMatchObject({ kind: "folder", id: "f1", depth: 1, expanded: true, testsCount: 1 });
    expect(rows[2]).toMatchObject({ kind: "test", id: "t1", depth: 2, parentId: "f1" });
    expect(rows[3]).toMatchObject({ kind: "test", id: "t2", depth: 1, parentId: null });
  });

  it("collapses folder children when not in expandedFolderIds", () => {
    const folders = [folder("f1", "F1")];
    const tests = [
      test({ id: "t1", title: "Inside", folderId: "f1" }),
      test({ id: "t2", title: "Outside", folderId: null }),
    ];
    const rows = buildTreeRows({
      tests,
      folders,
      expandedFolderIds: new Set(),
      sort: "title_asc",
    });

    expect(rows.map((r) => `${r.kind}:${"id" in r ? r.id : ""}`)).toEqual([
      "root:",
      "folder:f1",
      "test:t2",
    ]);
  });

  it("counts tests recursively across sub-folders for the folder's testsCount", () => {
    const folders = [
      folder("parent", "Parent"),
      folder("child", "Child", "parent"),
    ];
    const tests = [
      test({ id: "t1", title: "In child", folderId: "child" }),
      test({ id: "t2", title: "In parent", folderId: "parent" }),
    ];
    const rows = buildTreeRows({
      tests,
      folders,
      expandedFolderIds: new Set(["parent", "child"]),
      sort: "title_asc",
    });
    const parentRow = rows.find((r) => r.kind === "folder" && r.id === "parent");
    expect(parentRow).toMatchObject({ testsCount: 2 });
  });

  it("sorts folders alphabetically regardless of input order", () => {
    const folders = [folder("a", "Я"), folder("b", "А"), folder("c", "К")];
    const rows = buildTreeRows({
      tests: [],
      folders,
      expandedFolderIds: new Set(),
      sort: "title_asc",
    });
    expect(rows.filter((r) => r.kind === "folder").map((r) => "name" in r && r.name)).toEqual(
      ["А", "К", "Я"],
    );
  });
});

// ─── buildSearchRows ──────────────────────────────────────────────────────────

describe("buildSearchRows", () => {
  it("returns empty array for empty query", () => {
    const rows = buildSearchRows({
      tests: [test({ id: "1", title: "Anything" })],
      folders: [],
      query: "",
      sort: "title_asc",
    });
    expect(rows).toEqual([]);
  });

  it("matches by case-insensitive substring on title", () => {
    const rows = buildSearchRows({
      tests: [
        test({ id: "1", title: "Основы информационной безопасности" }),
        test({ id: "2", title: "GDPR для разработчиков" }),
      ],
      folders: [],
      query: "БЕЗОПАСН",
      sort: "title_asc",
    });
    expect(rows.map((r) => r.id)).toEqual(["1"]);
  });

  it("attaches folder name as breadcrumb when test is inside a folder", () => {
    const rows = buildSearchRows({
      tests: [
        test({ id: "1", title: "Основы ИБ", folderId: "f1" }),
        test({ id: "2", title: "Аудит логов", folderId: null }),
      ],
      folders: [folder("f1", "Инфобез")],
      query: "о",
      sort: "title_asc",
    });
    const m1 = rows.find((r) => r.id === "1");
    const m2 = rows.find((r) => r.id === "2");
    expect(m1?.folderName).toBe("Инфобез");
    expect(m2?.folderName).toBeNull();
  });
});

// ─── descendantFolderIds ──────────────────────────────────────────────────────

describe("descendantFolderIds", () => {
  it("returns the folder itself when no children exist", () => {
    const ids = descendantFolderIds("a", [folder("a", "A")]);
    expect(Array.from(ids).sort()).toEqual(["a"]);
  });

  it("includes transitive children", () => {
    const folders = [
      folder("a", "A"),
      folder("b", "B", "a"),
      folder("c", "C", "b"),
      folder("d", "D"),
    ];
    const ids = descendantFolderIds("a", folders);
    expect(Array.from(ids).sort()).toEqual(["a", "b", "c"]);
  });
});
