/**
 * @module tests/it/section-roundtrip.it.test
 * @description After removing the two dead section-insert copies (storage.createTest
 * and the updateTest(sections) branch), TestSettingsService._insertSections is the
 * single writer of test_sections. This round-trip proves it persists formSetJson
 * and sortOrder (the fields the dead copies dropped) and that getTestSections reads
 * them back in author order.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
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
// eslint-disable-next-line import/first
import { testSettingsService } from "../../server/services/test-settings";

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

describe("test sections round-trip through the single writer", () => {
  it("persists formSetJson + sortOrder and reads them back in author order", async () => {
    const formSet = {
      forms: [
        { id: "f1", questionIds: ["q1"] },
        { id: "f2", questionIds: ["q2"] },
      ],
    };
    const created = await testSettingsService.create({
      test: { title: "RT", mode: "standard", overallPassRuleJson: { type: "percent", value: 70 } },
      sections: [
        { topicId: "topic-A", drawCount: 1 },
        { topicId: "topic-B", drawCount: 2, formSetJson: formSet as never },
      ],
    });

    const sections = await storage.getTestSections(created.id);
    expect(sections).toHaveLength(2);

    // sortOrder = array index — author order round-trips through getTestSections.
    expect(sections[0].topicId).toBe("topic-A");
    expect(sections[0].sortOrder).toBe(0);
    expect(sections[1].topicId).toBe("topic-B");
    expect(sections[1].sortOrder).toBe(1);

    // formSetJson preserved (the field the removed dead copies dropped).
    expect(sections[0].formSetJson).toBeNull();
    expect(sections[1].formSetJson).toEqual(formSet);
  });
});
