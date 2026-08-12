/**
 * @module server/__tests__/test-transfer-completeness
 *
 * The guard that makes «без потерь» a property of the code rather than of someone's memory.
 *
 * The workbook lost half a test because its format was a LIST — of sheets, of columns — and
 * a list is only as complete as the last person who edited it. The transfer package avoids
 * that by serializing rows whole, but one thing still cannot be inferred: WHICH TABLES
 * belong to a test. Add a table with a `test_id` tomorrow and the package will not carry it,
 * silently, exactly as before.
 *
 * So the list lives here instead, split in two, and any table absent from BOTH fails this
 * test. Failing means someone must decide — carry it, or write down why not. That decision
 * is cheap now and expensive after a production import.
 */
import { describe, it, expect } from "vitest";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";

/**
 * Test-scoped tables the package CARRIES.
 *
 * Kept in the order the writer inserts them, so the two read alike.
 */
const CARRIED = [
  "tests",
  "test_sections",
  "scales",
  "question_measurements",
  "result_variables",
  "content_pages",
  "test_question_scoring",
  "adaptive_topic_settings",
  "adaptive_levels",
] as const;

/**
 * Test-scoped tables the package deliberately DOES NOT carry, each with the reason.
 *
 * A reason is required by construction: the value is the ground, not a comment beside it.
 */
const NOT_CARRIED: Record<string, string> = {
  attempts: "попытки — данные инсталляции, а не теста",
  scorm_packages: "выданный в LMS пакет привязан к инсталляции, что его выдала",
  scorm_attempts: "телеметрия попыток — данные инсталляции",
  test_snapshots: "снапшот публикации пересоздаётся на приёмнике при публикации",
  test_access_grants: "права выданы учётным записям, которых на приёмнике нет",
  test_assignments: "назначения адресованы группам и людям этой инсталляции",
  assignment_access_tokens: "токены доступа принадлежат назначениям",
  topic_courses: "легаси-таблица, удалена миграцией 024",
  topic_events: "легаси-таблица, удалена миграцией 024",
};

/** Every drizzle table in the schema that has a `test_id` column. */
function testScopedTables(): string[] {
  const names: string[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const columns = getTableColumns(value as PgTable);
    if ("testId" in columns) names.push(getTableName(value as PgTable));
  }
  return names.sort();
}

describe("transfer completeness guard", () => {
  it("every test-scoped table is either carried or explicitly excluded", () => {
    const known = new Set<string>([...CARRIED, ...Object.keys(NOT_CARRIED)]);
    const unclassified = testScopedTables().filter((name) => !known.has(name));

    expect(
      unclassified,
      `Таблица(ы) ${unclassified.join(", ")} привязаны к тесту, но не отнесены ни к переносимым, ` +
        "ни к сознательно исключённым. Добавьте в CARRIED (и в запись графа) или в NOT_CARRIED с причиной.",
    ).toEqual([]);
  });

  it("carries the tables whose loss produced this work", () => {
    // Not a tautology: these four are the ones the workbook dropped, and a refactor that
    // quietly narrows the transfer would still pass the guard above.
    for (const table of ["result_variables", "content_pages", "scales", "tests"]) {
      expect(CARRIED).toContain(table);
    }
  });

  it("keeps a reason for every exclusion", () => {
    for (const [table, reason] of Object.entries(NOT_CARRIED)) {
      expect(reason.length, `у исключения ${table} нет причины`).toBeGreaterThan(10);
    }
  });

  it("does not list a table twice", () => {
    const overlap = CARRIED.filter((name) => name in NOT_CARRIED);
    expect(overlap).toEqual([]);
  });
});
