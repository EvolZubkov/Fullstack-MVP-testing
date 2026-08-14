/**
 * @module server/__tests__/test-transfer-plan
 *
 * The renumbering core of the import. Every identifier becomes a new one and every
 * reference must follow it — including the ones hiding inside jsonb
 * (`form_set_json.forms[].questionIds`). A reference left pointing at the source's id is
 * the failure mode this suite exists to prevent: the import succeeds, and the test is
 * quietly broken.
 */
import { describe, it, expect } from "vitest";
import { planImport, UnsupportedPackageError } from "../services/test-transfer/plan";
import type { TestTransferPackage } from "../services/test-transfer/package";

/** Sequential ids, so expectations can name them. */
function idGen(): () => string {
  let n = 0;
  return () => `new-${++n}`;
}

function packageFixture(): TestTransferPackage {
  return {
    formatVersion: 1,
    exportedAt: "2026-08-12T00:00:00.000Z",
    appVersion: "2.13.0",
    media: [],
    missingMedia: [],
    content: {
      test: {
        id: "old-test",
        title: "Опросник",
        ownerId: "author-from-source",
        folderId: "folder-from-source",
        introJson: { results: { text: "<p>Итог</p>" } },
      },
      topics: [{ id: "old-topic", name: "Тема", ownerId: "author-from-source", folderId: "f1" }],
      sections: [
        {
          id: "old-section",
          testId: "old-test",
          topicId: "old-topic",
          formSetJson: { forms: [{ id: "form-a", label: "A", questionIds: ["old-q1", "old-q2"] }] },
        },
      ],
      questionsByTopic: {
        "old-topic": [
          { id: "old-q1", topicId: "old-topic", text: "Вопрос 1" },
          { id: "old-q2", topicId: "old-topic", mediaUrl: "/api/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
        ],
      },
      scales: [{ id: "old-scale", testId: "old-test", key: "vdo" }],
      measurements: [
        { id: "old-m1", testId: "old-test", questionId: "old-q1", scaleId: "old-scale", value: 1 },
      ],
      resultVariables: [
        { id: "old-v", testId: "old-test", name: "lead_style", formula: "topScale(['vdo'],1).key" },
      ],
      contentPages: [
        { id: "old-page", testId: "old-test", topicId: "old-topic", kind: "results", settingsJson: {} },
      ],
      questionScoring: [
        { id: "old-s", testId: "old-test", questionId: "old-q2", points: 3 },
      ],
      topicCoursesByTopic: {},
      topicEventsByTopic: {},
      adaptiveSettings: [],
      adaptiveLevels: [],
      adaptiveLevelLinksByLevel: {},
    },
  } as unknown as TestTransferPackage;
}

describe("planImport", () => {
  it("renumbers every entity and keeps references consistent", () => {
    const plan = planImport(packageFixture(), { newId: idGen(), ownerId: "importer" });

    const testId = plan.test.id;
    const topicId = plan.topics[0].id;
    const [q1, q2] = plan.questionsByTopic[topicId];

    expect(testId).not.toBe("old-test");
    expect(topicId).not.toBe("old-topic");

    expect(plan.sections[0].testId).toBe(testId);
    expect(plan.sections[0].topicId).toBe(topicId);
    expect(plan.questionsByTopic[topicId]).toHaveLength(2);
    expect(q1.topicId).toBe(topicId);

    expect(plan.measurements[0].testId).toBe(testId);
    expect(plan.measurements[0].questionId).toBe(q1.id);
    expect(plan.measurements[0].scaleId).toBe(plan.scales[0].id);

    expect(plan.contentPages[0].testId).toBe(testId);
    expect(plan.contentPages[0].topicId).toBe(topicId);
    expect(plan.questionScoring?.[0].questionId).toBe(q2.id);
  });

  it("follows question ids INSIDE form_set_json", () => {
    const plan = planImport(packageFixture(), { newId: idGen(), ownerId: "importer" });

    const topicId = plan.topics[0].id;
    const newQuestionIds = plan.questionsByTopic[topicId].map((q) => q.id);
    const formIds = (plan.sections[0].formSetJson as { forms: Array<{ questionIds: string[] }> })
      .forms[0].questionIds;

    expect(formIds).toEqual(newQuestionIds);
  });

  it("gives the test to the importer and drops the source's folder", () => {
    const plan = planImport(packageFixture(), { newId: idGen(), ownerId: "importer" });

    expect(plan.test.ownerId).toBe("importer");
    expect(plan.test.folderId).toBeNull();
    expect(plan.topics[0].ownerId).toBe("importer");
    expect(plan.topics[0].folderId).toBeNull();
  });

  it("leaves KEY-based references alone — formulas address scales by key", () => {
    const plan = planImport(packageFixture(), { newId: idGen(), ownerId: "importer" });

    expect(plan.scales[0].key).toBe("vdo");
    expect(plan.resultVariables[0].formula).toBe("topScale(['vdo'],1).key");
    expect(plan.resultVariables[0].name).toBe("lead_style");
  });

  it("rewrites media addresses through the supplied map", () => {
    const plan = planImport(packageFixture(), {
      newId: idGen(),
      ownerId: "importer",
      mediaAddressMap: new Map([
        ["/api/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "/api/media/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"],
      ]),
    });

    const topicId = plan.topics[0].id;
    expect(plan.questionsByTopic[topicId][1].mediaUrl).toBe(
      "/api/media/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    );
  });

  it("refuses a package format it cannot read", () => {
    const future = { ...packageFixture(), formatVersion: 99 };
    expect(() => planImport(future, { newId: idGen(), ownerId: "importer" })).toThrow(
      UnsupportedPackageError,
    );
  });

  it("leaves no source identifier anywhere in the plan", () => {
    const plan = planImport(packageFixture(), { newId: idGen(), ownerId: "importer" });

    // The blunt check that catches a reference nobody thought to enumerate.
    const serialized = JSON.stringify(plan);
    for (const stale of ["old-test", "old-topic", "old-q1", "old-q2", "old-scale", "old-m1", "old-v", "old-page", "old-s", "old-section"]) {
      expect(serialized).not.toContain(stale);
    }
  });
});
