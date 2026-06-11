/**
 * @module tests/test-snapshot
 *
 * Unit tests of the snapshot read facade (PRD-15 block B, T-14): the
 * snapshotDataSource serves the runtime's storage getters purely from the
 * frozen blob, so a published attempt reads exactly the captured state. The
 * builder/persistence (buildSnapshotContent/createTestSnapshot) is covered by
 * the integration tests; here we pin the pure facade behaviour.
 */

import { describe, it, expect, vi } from "vitest";

// The facade is pure; stub storage so importing the service does not pull in db.
vi.mock("../server/storage", () => ({ storage: {} }));

import { snapshotDataSource } from "../server/services/test-snapshot";
import type { TestSnapshotContent } from "../server/services/test-snapshot";

function makeContent(overrides: Partial<TestSnapshotContent> = {}): TestSnapshotContent {
  const q = (id: string, topicId: string) =>
    ({
      id,
      topicId,
      type: "single",
      prompt: `Q ${id}`,
      dataJson: {},
      correctJson: { correctIndex: 0 },
      points: 1,
      difficulty: 50,
      tags: [],
    }) as unknown as TestSnapshotContent["questionsByTopic"][string][number];
  return {
    test: { id: "t1", title: "Frozen", mode: "standard" } as TestSnapshotContent["test"],
    sections: [{ id: "s1", testId: "t1", topicId: "tp1", drawCount: 1 } as TestSnapshotContent["sections"][number]],
    topics: [{ id: "tp1", name: "Тема 1" }],
    questionsByTopic: { tp1: [q("q1", "tp1"), q("q2", "tp1")] },
    topicCoursesByTopic: { tp1: [] },
    topicEventsByTopic: { tp1: [] },
    adaptiveSettings: [],
    adaptiveLevels: [],
    adaptiveLevelLinksByLevel: {},
    scales: [],
    measurements: [],
    resultVariables: [],
    contentPages: [],
    ...overrides,
  };
}

describe("snapshotDataSource — frozen reads", () => {
  it("serves the test, sections and topics from the blob", async () => {
    const src = snapshotDataSource(makeContent());
    expect((await src.getTest("t1"))?.id).toBe("t1");
    expect(await src.getTestSections("t1")).toHaveLength(1);
    expect(await src.getTopics()).toEqual([{ id: "tp1", name: "Тема 1" }]);
  });

  it("serves the topic question pool and resolves ids across all topics", async () => {
    const src = snapshotDataSource(makeContent());
    expect((await src.getQuestionsByTopic("tp1")).map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(await src.getQuestionsByTopic("missing")).toEqual([]);
    const byIds = await src.getQuestionsByIds(["q2", "nope", "q1"]);
    expect(byIds.map((q) => q.id)).toEqual(["q2", "q1"]); // missing ids dropped, order kept
  });

  it("does not see questions added to the live bank after capture", async () => {
    const content = makeContent();
    const src = snapshotDataSource(content);
    // A later live insert is irrelevant: the facade only knows the blob.
    const before = await src.getQuestionsByTopic("tp1");
    expect(before).toHaveLength(2);
  });

  it("serves adaptive config and per-level links from the blob", async () => {
    const src = snapshotDataSource(
      makeContent({
        adaptiveLevels: [{ id: "lvl1", levelIndex: 0 } as TestSnapshotContent["adaptiveLevels"][number]],
        adaptiveLevelLinksByLevel: { lvl1: [{ id: "lk1", levelId: "lvl1", title: "T", url: "u" }] },
      }),
    );
    expect(await src.getAdaptiveLevelsByTest("t1")).toHaveLength(1);
    expect((await src.getAdaptiveLevelLinks("lvl1"))[0].url).toBe("u");
    expect(await src.getAdaptiveLevelLinks("absent")).toEqual([]);
  });

  it("serves scales, measurements and result variables for grading", async () => {
    const src = snapshotDataSource(
      makeContent({
        scales: [{ id: "sc1", testId: "t1", key: "EE" } as TestSnapshotContent["scales"][number]],
        resultVariables: [{ id: "rv1", testId: "t1", name: "pass" } as TestSnapshotContent["resultVariables"][number]],
      }),
    );
    expect(await src.getScales("t1")).toHaveLength(1);
    expect(await src.getResultVariables("t1")).toHaveLength(1);
    expect(await src.getQuestionMeasurements("t1")).toEqual([]);
  });
});
