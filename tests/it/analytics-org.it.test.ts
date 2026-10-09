/**
 * @module tests/it/analytics-org.it.test
 * @description Org-structure values of an observation and the org conditions of
 * the selection, on a real database (org-structure plan, task 4; PRD-56 FR-06b,
 * OQ-04).
 *
 * Checked against a database because both halves are SQL-shaped: the value of a
 * passage is «its own, else the linked profile's» and must be the same in the
 * normalisation and in the WHERE clause; and the condition must match every
 * stored spelling of a unit («Отдел продаж» in a profile, «ОТДЕЛ  ПРОДАЖ» in an
 * export) — inside the query, before the limit, or a page would come back short.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { attempts, scormAttempts, tests, users } from "@shared/schema";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { loadObservations } from "../../server/services/analytics/observations";

const ALL_TESTS = { all: true, ids: new Set<string>() };

let testId: string;
let petrov: string;
let egorov: string;

async function user(id: string, profile: Record<string, unknown>) {
  await h.current!.db.insert(users).values({
    id, email: `${id}@x.ru`, passwordHash: "x", name: id, ...profile,
  } as never);
}

async function webAttempt(userId: string) {
  const row = {
    id: randomUUID(), userId, testId, testVersion: 1, variantJson: {},
    resultJson: { overallPercent: 80, overallPassed: true, totalPossiblePoints: 10 },
    startedAt: new Date("2026-09-11T14:00:00Z"), finishedAt: new Date("2026-09-11T14:20:00Z"),
  };
  await h.current!.db.insert(attempts).values(row as never);
  return row.id;
}

async function lmsAttempt(over: Record<string, unknown>) {
  const row = {
    id: randomUUID(), packageId: null, sessionId: null, testId, origin: "import" as const,
    participantKey: randomUUID(), groupId: null, userId: null, lmsUserName: null,
    resultPercent: 60, resultPassed: false, maxPoints: 10,
    startedAt: new Date("2026-09-10T09:00:00Z"), finishedAt: new Date("2026-09-10T09:30:00Z"),
    lastActivityAt: new Date("2026-09-10T09:30:00Z"),
    ...over,
  };
  await h.current!.db.insert(scormAttempts).values(row as never);
  return row.id;
}

beforeAll(async () => {
  h.current = await createHarness();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
  testId = randomUUID();
  petrov = randomUUID();
  egorov = randomUUID();
  await user(petrov, { organization: "АО «Ромашка»", unit: "Отдел продаж", position: "Менеджер" });
  await user(egorov, { organization: "АО «Ромашка»", unit: "Логистика", position: null });
  await h.current!.db.insert(tests).values({
    id: testId, title: "Тест", overallPassRuleJson: { type: "percent", value: 70 }, createdBy: petrov,
  } as never);
});

describe("org values of an observation", () => {
  it("web attempt: from the profile", async () => {
    const id = await webAttempt(petrov);
    const { rows } = await loadObservations({}, ALL_TESTS);
    expect(rows.find(r => r.id === id)).toMatchObject({
      organization: "АО «Ромашка»", unit: "Отдел продаж", position: "Менеджер",
    });
  });

  it("imported passage: its own value first, the linked profile for what it lacks", async () => {
    const id = await lmsAttempt({
      userId: egorov, lmsUserUnit: "Склад №3", lmsUserPosition: "Кладовщик", lmsUserOrg: null,
    });
    const { rows } = await loadObservations({}, ALL_TESTS);
    expect(rows.find(r => r.id === id)).toMatchObject({
      // the passage's unit wins over the profile's «Логистика»
      unit: "Склад №3", position: "Кладовщик",
      // the anonymised import has no organisation — it comes from the profile
      organization: "АО «Ромашка»",
    });
  });

  it("unlinked passage without values: nothing to fall back on", async () => {
    const id = await lmsAttempt({});
    const { rows } = await loadObservations({}, ALL_TESTS);
    expect(rows.find(r => r.id === id)).toMatchObject({ organization: null, unit: null, position: null });
  });
});

describe("org conditions of the selection", () => {
  it("match every stored spelling of a unit, in both sources", async () => {
    const web = await webAttempt(petrov);
    const imported = await lmsAttempt({ lmsUserUnit: "ОТДЕЛ  ПРОДАЖ" });
    await webAttempt(egorov);
    await lmsAttempt({ lmsUserUnit: "Логистика" });

    const page = await loadObservations({ units: ["отдел продаж"] }, ALL_TESTS);

    expect(page.total).toBe(2);
    expect(page.rows.map(r => r.id).sort()).toEqual([web, imported].sort());
  });

  it("use the profile for a linked passage that has no value of its own", async () => {
    const linked = await lmsAttempt({ userId: petrov, lmsUserUnit: null });
    await lmsAttempt({ userId: egorov, lmsUserUnit: null });

    const page = await loadObservations({ units: ["Отдел продаж"] }, ALL_TESTS);

    expect(page.rows.map(r => r.id)).toEqual([linked]);
  });

  it("combine fields with AND and values of one field with OR", async () => {
    const a = await webAttempt(petrov);
    const b = await webAttempt(egorov);

    const either = await loadObservations({ units: ["Отдел продаж", "Логистика"] }, ALL_TESTS);
    expect(either.rows.map(r => r.id).sort()).toEqual([a, b].sort());

    const both = await loadObservations({ units: ["Логистика"], positions: ["Менеджер"] }, ALL_TESTS);
    expect(both.total).toBe(0);
  });

  it("select nothing for a value nobody has, instead of dropping the condition", async () => {
    await webAttempt(petrov);
    const page = await loadObservations({ organizations: ["ООО «Нет такой»"] }, ALL_TESTS);
    expect(page.total).toBe(0);
    expect(page.rows).toEqual([]);
  });
});
