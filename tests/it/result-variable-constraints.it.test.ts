/**
 * @module tests/it/result-variable-constraints.it.test
 * @description Proves the correctness constraints reconciled into schema.ts are
 * actually enforced by the database (they were silently dropped by an earlier
 * `drizzle-kit push` and are invisible to the mock-based unit suite):
 *  - at most one success / one completion controller per test (partial unique),
 *  - unique variable name / scale key within a test (natural unique),
 *  - name / key must be a DSL identifier (regex CHECK).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { tests } from "@shared/schema";
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

/** A minimal parent test row (result_variables.test_id has an FK to it). */
async function makeTest(): Promise<string> {
  const id = randomUUID();
  await h.current!.db
    .insert(tests)
    .values({ id, title: "T", overallPassRuleJson: { type: "percent", value: 80 } } as never);
  return id;
}

describe("result-variable / scale correctness constraints (real DB)", () => {
  it("rejects a second success controller in the same test", async () => {
    const testId = await makeTest();
    await storage.createResultVariable({
      testId, name: "a", label: "", type: "boolean", formula: "1", controlsStatus: "success",
    } as never);
    await expect(
      storage.createResultVariable({
        testId, name: "b", label: "", type: "boolean", formula: "1", controlsStatus: "success",
      } as never),
    ).rejects.toThrow();
  });

  it("allows one success plus one completion controller in the same test", async () => {
    const testId = await makeTest();
    await storage.createResultVariable({
      testId, name: "a", label: "", type: "boolean", formula: "1", controlsStatus: "success",
    } as never);
    await expect(
      storage.createResultVariable({
        testId, name: "b", label: "", type: "boolean", formula: "1", controlsStatus: "completion",
      } as never),
    ).resolves.toBeTruthy();
  });

  it("rejects a duplicate variable name within a test", async () => {
    const testId = await makeTest();
    await storage.createResultVariable({
      testId, name: "score", label: "", type: "number", formula: "1",
    } as never);
    await expect(
      storage.createResultVariable({
        testId, name: "score", label: "", type: "number", formula: "1",
      } as never),
    ).rejects.toThrow();
  });

  it("rejects a variable name that is not a DSL identifier", async () => {
    const testId = await makeTest();
    await expect(
      storage.createResultVariable({
        testId, name: "Bad Name", label: "", type: "number", formula: "1",
      } as never),
    ).rejects.toThrow();
  });

  it("rejects a scale key that is not a DSL identifier", async () => {
    const testId = await makeTest();
    await expect(
      storage.createScale({ testId, key: "Bad Key", label: "", type: "number" } as never),
    ).rejects.toThrow();
  });
});
