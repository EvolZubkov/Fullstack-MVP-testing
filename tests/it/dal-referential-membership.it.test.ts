/**
 * @module tests/it/dal-referential-membership.it.test
 * @description Integration coverage for the cross-domain reads that were inlined
 * during the storage split (so the facade could stay pure delegation), proving
 * the inlined SQL is behaviourally equivalent to the pre-split repository calls:
 *   - `getTestsUsingQuestion`: a question's dependent tests resolved via topic
 *     sections AND via `question_measurements`, de-duplicated (previously
 *     `questionsRepo.getQuestion` + `getTestsUsingTopic`; now a direct
 *     `questions` read + the measurements join).
 *   - `isTestAssignedToUser` / `getAssignedTestsForUser`: assignment membership
 *     through the user's groups (previously `groupsRepo.getUserGroups().map(id)`
 *     — an inner join to `groups`; now a direct `user_groups` id lookup). The
 *     orphan-invariant case is covered: `deleteGroup` removes the memberships,
 *     so a dangling assignment to a deleted group is not reachable — the direct
 *     id lookup and the old join agree on every DAL-reachable state.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import {
  tests, topics, testSections, questionMeasurements, scales, testAssignments,
} from "@shared/schema";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { DatabaseStorage } from "../../server/storage";

let storage: DatabaseStorage;

beforeAll(async () => {
  h.current = await createHarness();
  storage = new DatabaseStorage();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
});

/** Insert a bare test row (only the columns the reads under test depend on). */
async function seedTest(title: string): Promise<string> {
  const id = randomUUID();
  await h.current!.db.insert(tests).values({
    id, title, overallPassRuleJson: { type: "percent", value: 80 },
  } as never);
  return id;
}

describe("getTestsUsingQuestion — via sections, via measurements, de-duplicated", () => {
  it("returns every test that uses the question and each exactly once", async () => {
    const db = h.current!.db;
    const topicId = randomUUID();
    await db.insert(topics).values({ id: topicId, name: "T" } as never);
    const question = await storage.createQuestion({
      topicId, type: "single", prompt: "Q",
      dataJson: { options: ["a", "b"] }, correctJson: { correctIndex: 0 },
    } as never);

    // A: uses the question through a section on its topic.
    const testA = await seedTest("A-section");
    await db.insert(testSections).values({ id: randomUUID(), testId: testA, topicId, drawCount: 1 } as never);

    // B: uses the question through a scale contribution (question_measurements).
    const testB = await seedTest("B-measurement");
    const scaleB = randomUUID();
    await db.insert(scales).values({ id: scaleB, testId: testB, key: "s", label: "S", type: "number" } as never);
    await db.insert(questionMeasurements).values({
      testId: testB, questionId: question.id, scaleId: scaleB, sourceType: "question", valueJson: 1,
    } as never);

    // C: unrelated — a section on a DIFFERENT topic, no measurement.
    const otherTopic = randomUUID();
    await db.insert(topics).values({ id: otherTopic, name: "Other" } as never);
    const testC = await seedTest("C-unrelated");
    await db.insert(testSections).values({ id: randomUUID(), testId: testC, topicId: otherTopic, drawCount: 1 } as never);

    // D: uses the question BOTH ways — must appear once, not twice.
    const testD = await seedTest("D-both");
    await db.insert(testSections).values({ id: randomUUID(), testId: testD, topicId, drawCount: 1 } as never);
    const scaleD = randomUUID();
    await db.insert(scales).values({ id: scaleD, testId: testD, key: "s", label: "S", type: "number" } as never);
    await db.insert(questionMeasurements).values({
      testId: testD, questionId: question.id, scaleId: scaleD, sourceType: "question", valueJson: 1,
    } as never);

    const refs = await storage.getTestsUsingQuestion(question.id);
    const ids = refs.map((r) => r.id).sort();

    expect(ids).toEqual([testA, testB, testD].sort());
    expect(ids).not.toContain(testC);
    // De-duplicated: D used both ways still appears once.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns empty for a question no test uses", async () => {
    const topicId = randomUUID();
    await h.current!.db.insert(topics).values({ id: topicId, name: "T" } as never);
    const q = await storage.createQuestion({
      topicId, type: "single", prompt: "Q",
      dataJson: { options: ["a"] }, correctJson: { correctIndex: 0 },
    } as never);
    expect(await storage.getTestsUsingQuestion(q.id)).toEqual([]);
  });
});

describe("assignment membership — direct, via group, and the orphan invariant", () => {
  it("resolves direct + group assignments and drops group ones after deleteGroup", async () => {
    const db = h.current!.db;
    const userId = randomUUID();
    const assignedBy = randomUUID();
    const group = await storage.createGroup({ name: "G" } as never);
    await storage.addUserToGroup(userId, group.id);

    const t1 = await seedTest("direct");
    const t2 = await seedTest("via-group");
    const t3 = await seedTest("unassigned");
    await db.insert(testAssignments).values({ id: randomUUID(), testId: t1, userId, assignedBy } as never);
    await db.insert(testAssignments).values({ id: randomUUID(), testId: t2, groupId: group.id, assignedBy } as never);

    // isTestAssignedToUser: direct true, via-group true, unassigned false.
    expect(await storage.isTestAssignedToUser(t1, userId)).toBe(true);
    expect(await storage.isTestAssignedToUser(t2, userId)).toBe(true);
    expect(await storage.isTestAssignedToUser(t3, userId)).toBe(false);

    // getAssignedTestsForUser: union of direct + group, unique.
    const before = (await storage.getAssignedTestsForUser(userId)).map((t) => t.id).sort();
    expect(before).toEqual([t1, t2].sort());

    // Orphan invariant: deleteGroup removes the membership (and the group), so
    // the dangling assignment to the deleted group is no longer reachable — the
    // direct user_groups lookup agrees with the old groups-join semantics.
    expect(await storage.deleteGroup(group.id)).toBe(true);
    const after = (await storage.getAssignedTestsForUser(userId)).map((t) => t.id);
    expect(after).toEqual([t1]);
    expect(await storage.isTestAssignedToUser(t2, userId)).toBe(false);
  });

  it("returns empty for a user with no assignments", async () => {
    expect(await storage.getAssignedTestsForUser(randomUUID())).toEqual([]);
  });
});
