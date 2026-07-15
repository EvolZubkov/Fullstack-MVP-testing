// @vitest-environment node
/**
 * @module tests/storage/scales-variables-repository.test
 * @description DAL coverage for
 * {@link module:server/storage/scales-variables-repository} — the scoring-config
 * domain (result variables PRD-2, scales + per-question measurements PRD-5, and
 * per-(test, question) scoring overrides PRD-15 block D). Driven through the
 * {@link DatabaseStorage} facade (so the delegation in `server/storage.ts` is
 * exercised too) against a real in-process pglite database, the same harness the
 * integration suite uses. Runs in the `node` environment (per-file override) so
 * pglite works under the otherwise-jsdom unit run; living under `tests/` (not
 * `tests/it/`) means its coverage counts toward the reported total.
 *
 * Harness caveat: pglite does NOT populate `result.rowCount` for a DELETE/UPDATE
 * without RETURNING. Every method under test here uses `.returning()`, so the
 * boolean/row results are reliable; round-trip reads still back the assertions.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createHarness, type Harness } from "../it/db-harness";

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
import { tests, topics, questions, testSections } from "@shared/schema";

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

/** Insert a minimal `tests` row directly (bypasses createTest defaults/Zod). */
async function insertTest(): Promise<string> {
  const id = randomUUID();
  await h.current!.db.insert(tests).values({
    id,
    title: "T",
    overallPassRuleJson: {},
  } as never);
  return id;
}

/** Insert a minimal `topics` row directly; optional readable `code` (slug). */
async function insertTopic(opts: { code?: string; name?: string } = {}): Promise<string> {
  const id = randomUUID();
  await h.current!.db.insert(topics).values({
    id,
    name: opts.name ?? "Topic",
    code: opts.code ?? null,
  } as never);
  return id;
}

/** Insert a minimal `questions` row directly (FK target for measurements/scoring). */
async function insertQuestion(topicId: string): Promise<string> {
  const id = randomUUID();
  await h.current!.db.insert(questions).values({
    id,
    topicId,
    type: "single",
    prompt: "P",
    dataJson: {},
    correctJson: {},
  } as never);
  return id;
}

/** Link a topic to a test via one `test_sections` row (used by formula validation). */
async function insertSection(testId: string, topicId: string): Promise<void> {
  await h.current!.db.insert(testSections).values({
    id: randomUUID(),
    testId,
    topicId,
    drawCount: 1,
  } as never);
}

/** Build a full InsertResultVariable payload (all NOT NULL columns present). */
function rvPayload(
  testId: string,
  name: string,
  extra: Record<string, unknown> = {},
): never {
  return {
    testId,
    name,
    label: name,
    type: "number",
    formula: "1",
    ...extra,
  } as never;
}

// ─── Result variables (PRD-2) ────────────────────────────────────────────────

describe("ScalesVariablesRepository — result variables", () => {
  it("getResultVariables returns [] for a test with none, then rows in sortOrder", async () => {
    const testId = await insertTest();
    expect(await storage.getResultVariables(testId)).toEqual([]);

    await storage.createResultVariable(rvPayload(testId, "beta", { sortOrder: 2 }));
    await storage.createResultVariable(rvPayload(testId, "alpha", { sortOrder: 1 }));

    const rows = await storage.getResultVariables(testId);
    expect(rows.map((r) => r.name)).toEqual(["alpha", "beta"]); // ordered by sortOrder
  });

  it("createResultVariable persists and returns the row", async () => {
    const testId = await insertTest();
    const created = await storage.createResultVariable(
      rvPayload(testId, "score_total", { label: "Итог", type: "number", formula: "1 + 1" }),
    );
    expect(created.id).toBeTruthy();
    expect(created.name).toBe("score_total");
    expect(created.label).toBe("Итог");
    expect(created.testId).toBe(testId);
  });

  it("updateResultVariable patches an existing row and returns undefined for an unknown id", async () => {
    const testId = await insertTest();
    const created = await storage.createResultVariable(rvPayload(testId, "v1"));

    const updated = await storage.updateResultVariable(created.id, { label: "Renamed", formula: "42" });
    expect(updated?.label).toBe("Renamed");
    expect(updated?.formula).toBe("42");

    expect(await storage.updateResultVariable(randomUUID(), { label: "x" })).toBeUndefined();
  });

  it("deleteResultVariable returns true when a row was removed, false otherwise", async () => {
    const testId = await insertTest();
    const created = await storage.createResultVariable(rvPayload(testId, "v1"));

    expect(await storage.deleteResultVariable(created.id)).toBe(true);
    expect(await storage.getResultVariables(testId)).toEqual([]);
    expect(await storage.deleteResultVariable(randomUUID())).toBe(false);
  });

  it("reorderResultVariables rewrites sortOrder transactionally", async () => {
    const testId = await insertTest();
    const a = await storage.createResultVariable(rvPayload(testId, "a", { sortOrder: 0 }));
    const b = await storage.createResultVariable(rvPayload(testId, "b", { sortOrder: 1 }));

    await storage.reorderResultVariables([
      { id: a.id, sortOrder: 10 },
      { id: b.id, sortOrder: 5 },
    ]);

    const rows = await storage.getResultVariables(testId);
    expect(rows.map((r) => r.name)).toEqual(["b", "a"]); // b now sorts first
  });
});

// ─── validateResultVariableFormula (PRD-2 DSL, reference-set assembly) ────────

describe("ScalesVariablesRepository — validateResultVariableFormula", () => {
  it("validates a formula against the test's section topics (by code and by name)", async () => {
    const testId = await insertTest();
    const topicId = await insertTopic({ code: "math", name: "Математика" });
    await insertSection(testId, topicId);

    const byCode = await storage.validateResultVariableFormula(
      testId,
      'topicById("math").percent',
      "number",
    );
    expect(byCode.valid).toBe(true);

    const byName = await storage.validateResultVariableFormula(
      testId,
      'topicByName("Математика").percent',
      "number",
    );
    expect(byName.valid).toBe(true);
  });

  it("rejects an unknown-topic reference when the test has no sections (empty branch)", async () => {
    const testId = await insertTest();
    const res = await storage.validateResultVariableFormula(
      testId,
      'topicById("ghost").percent',
      "number",
    );
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.code === "unknown-topic")).toBe(true);
  });

  it("allows var() only for prior variables (sortOrder / excludeId / extraVarNames)", async () => {
    const testId = await insertTest();
    const base = await storage.createResultVariable(rvPayload(testId, "base", { sortOrder: 0 }));

    // A later variable may reference the earlier one.
    const ok = await storage.validateResultVariableFormula(testId, 'var("base")', "number", {
      sortOrder: 5,
    });
    expect(ok.valid).toBe(true);

    // Excluding the target from the prior set makes the reference forward/self → error.
    const excluded = await storage.validateResultVariableFormula(testId, 'var("base")', "number", {
      excludeId: base.id,
    });
    expect(excluded.errors.some((e) => e.code === "var-order")).toBe(true);

    // A not-yet-persisted sibling variable is honoured via extraVarNames.
    const fresh = await storage.validateResultVariableFormula(testId, 'var("fresh")', "number", {
      extraVarNames: ["fresh"],
    });
    expect(fresh.valid).toBe(true);
  });

  it("resolves scaleById against the test's scales and extraScaleKeys (warning only when absent)", async () => {
    const testId = await insertTest();

    // No scale, no extra → scaleById is unresolved → warning (but still valid).
    const warned = await storage.validateResultVariableFormula(
      testId,
      'scaleById("lead").level',
      "string",
    );
    expect(warned.valid).toBe(true);
    expect(warned.warnings.some((w) => w.code === "scale-unresolved")).toBe(true);

    // A persisted scale key resolves cleanly (no warning).
    await storage.createScale({ testId, key: "lead", label: "Lead", type: "level" } as never);
    const resolved = await storage.validateResultVariableFormula(
      testId,
      'scaleById("lead").level',
      "string",
    );
    expect(resolved.warnings.some((w) => w.code === "scale-unresolved")).toBe(false);

    // An in-workbook-but-unpersisted key resolves via extraScaleKeys.
    const viaExtra = await storage.validateResultVariableFormula(
      testId,
      'scaleById("fresh").level',
      "string",
      { extraScaleKeys: ["fresh"] },
    );
    expect(viaExtra.warnings.some((w) => w.code === "scale-unresolved")).toBe(false);
  });

  it("reports a syntax error as invalid", async () => {
    const testId = await insertTest();
    const res = await storage.validateResultVariableFormula(testId, "1 +", "number");
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.code === "syntax")).toBe(true);
  });
});

// ─── Scales (PRD-5) ──────────────────────────────────────────────────────────

describe("ScalesVariablesRepository — scales", () => {
  it("getScales returns [] then rows in sortOrder", async () => {
    const testId = await insertTest();
    expect(await storage.getScales(testId)).toEqual([]);

    await storage.createScale({ testId, key: "second", label: "B", type: "number", sortOrder: 2 } as never);
    await storage.createScale({ testId, key: "first", label: "A", type: "number", sortOrder: 1 } as never);

    expect((await storage.getScales(testId)).map((s) => s.key)).toEqual(["first", "second"]);
  });

  it("createScale persists and returns the row", async () => {
    const testId = await insertTest();
    const created = await storage.createScale({
      testId,
      key: "leadership",
      label: "Лидерство",
      type: "level",
    } as never);
    expect(created.id).toBeTruthy();
    expect(created.key).toBe("leadership");
    expect(created.type).toBe("level");
  });

  it("updateScale patches an existing row and returns undefined for an unknown id", async () => {
    const testId = await insertTest();
    const created = await storage.createScale({ testId, key: "k", label: "L", type: "number" } as never);

    const updated = await storage.updateScale(created.id, { label: "New", direction: "inverse" });
    expect(updated?.label).toBe("New");
    expect(updated?.direction).toBe("inverse");

    expect(await storage.updateScale(randomUUID(), { label: "x" })).toBeUndefined();
  });

  it("deleteScale returns true when a row was removed, false otherwise", async () => {
    const testId = await insertTest();
    const created = await storage.createScale({ testId, key: "k", label: "L", type: "number" } as never);

    expect(await storage.deleteScale(created.id)).toBe(true);
    expect(await storage.getScales(testId)).toEqual([]);
    expect(await storage.deleteScale(randomUUID())).toBe(false);
  });

  it("reorderScales rewrites sortOrder transactionally", async () => {
    const testId = await insertTest();
    const a = await storage.createScale({ testId, key: "a", label: "A", type: "number", sortOrder: 0 } as never);
    const b = await storage.createScale({ testId, key: "b", label: "B", type: "number", sortOrder: 1 } as never);

    await storage.reorderScales([
      { id: a.id, sortOrder: 9 },
      { id: b.id, sortOrder: 3 },
    ]);

    expect((await storage.getScales(testId)).map((s) => s.key)).toEqual(["b", "a"]);
  });
});

// ─── Per-question measurements (PRD-5) ───────────────────────────────────────

describe("ScalesVariablesRepository — question measurements", () => {
  /** Create a test + topic + question + scale and return their ids. */
  async function fixture() {
    const testId = await insertTest();
    const topicId = await insertTopic();
    const questionId = await insertQuestion(topicId);
    const scale = await storage.createScale({ testId, key: "s1", label: "S1", type: "number" } as never);
    return { testId, questionId, scaleId: scale.id };
  }

  it("upsertQuestionMeasurements replaces the question's set and reads back by test / by question", async () => {
    const { testId, questionId, scaleId } = await fixture();

    const rows = await storage.upsertQuestionMeasurements(testId, questionId, [
      { scaleId, sourceType: "question", valueJson: 3, sortOrder: 0 } as never,
      { scaleId, sourceType: "option", sourceKey: "opt-1", valueJson: -2, weight: 2, sortOrder: 1 } as never,
    ]);
    expect(rows).toHaveLength(2);
    // testId/questionId are stamped by the method regardless of the payload.
    expect(rows.every((r) => r.testId === testId && r.questionId === questionId)).toBe(true);

    expect(await storage.getQuestionMeasurements(testId)).toHaveLength(2);
    const byQ = await storage.getQuestionMeasurementsByQuestion(testId, questionId);
    expect(byQ.map((r) => r.sourceType)).toEqual(["question", "option"]); // sortOrder

    // A second upsert fully replaces the previous set (delete-then-insert).
    const replaced = await storage.upsertQuestionMeasurements(testId, questionId, [
      { scaleId, sourceType: "question", valueJson: 5, sortOrder: 0 } as never,
    ]);
    expect(replaced).toHaveLength(1);
    expect(replaced[0].valueJson).toBe(5);
    expect(await storage.getQuestionMeasurements(testId)).toHaveLength(1);
  });

  it("upsertQuestionMeasurements with an empty array clears the question's contributions", async () => {
    const { testId, questionId, scaleId } = await fixture();
    await storage.upsertQuestionMeasurements(testId, questionId, [
      { scaleId, sourceType: "question", valueJson: 1 } as never,
    ]);

    const cleared = await storage.upsertQuestionMeasurements(testId, questionId, []);
    expect(cleared).toEqual([]);
    expect(await storage.getQuestionMeasurementsByQuestion(testId, questionId)).toEqual([]);
  });

  it("getMeasurementsForQuestions returns [] for an empty id list and (testId,questionId) pairs otherwise", async () => {
    const { testId, questionId, scaleId } = await fixture();
    await storage.upsertQuestionMeasurements(testId, questionId, [
      { scaleId, sourceType: "question", valueJson: 1 } as never,
    ]);

    expect(await storage.getMeasurementsForQuestions([])).toEqual([]);

    const found = await storage.getMeasurementsForQuestions([questionId, randomUUID()]);
    expect(found).toEqual([{ testId, questionId }]);
  });
});

// ─── Per-(test, question) scoring overrides (PRD-15 block D) ──────────────────

describe("ScalesVariablesRepository — test-question scoring overrides", () => {
  /** Create a test + question and return their ids. */
  async function fixture() {
    const testId = await insertTest();
    const topicId = await insertTopic();
    const questionId = await insertQuestion(topicId);
    return { testId, questionId };
  }

  it("getTestQuestionScoring returns [] then the test's override rows", async () => {
    const { testId, questionId } = await fixture();
    expect(await storage.getTestQuestionScoring(testId)).toEqual([]);

    await storage.upsertTestQuestionScoring(testId, questionId, { points: 4 } as never);
    const rows = await storage.getTestQuestionScoring(testId);
    expect(rows).toHaveLength(1);
    expect(rows[0].points).toBe(4);
  });

  it("upsertTestQuestionScoring inserts, then updates on the (test,question) conflict", async () => {
    const { testId, questionId } = await fixture();

    const inserted = await storage.upsertTestQuestionScoring(testId, questionId, {
      points: 3,
      difficulty: 40,
      pinnedContentHash: "hash-1",
    } as never);
    expect(inserted.points).toBe(3);
    expect(inserted.difficulty).toBe(40);
    expect(inserted.pinnedContentHash).toBe("hash-1");

    // Second call on the same (test,question) updates the SAME row and clears
    // omitted value columns to null (all columns replaced as a unit).
    const updated = await storage.upsertTestQuestionScoring(testId, questionId, {
      points: 7,
    } as never);
    expect(updated.id).toBe(inserted.id);
    expect(updated.points).toBe(7);
    expect(updated.difficulty).toBeNull();
    expect(updated.pinnedContentHash).toBeNull();
    expect(await storage.getTestQuestionScoring(testId)).toHaveLength(1);
  });

  it("deleteTestQuestionScoring returns true when a row was removed, false otherwise", async () => {
    const { testId, questionId } = await fixture();
    await storage.upsertTestQuestionScoring(testId, questionId, { points: 1 } as never);

    expect(await storage.deleteTestQuestionScoring(testId, questionId)).toBe(true);
    expect(await storage.getTestQuestionScoring(testId)).toEqual([]);
    expect(await storage.deleteTestQuestionScoring(testId, randomUUID())).toBe(false);
  });

  it("replaceTestQuestionScoring swaps the whole override set; empty clears it", async () => {
    const { testId, questionId } = await fixture();
    const topicId = await insertTopic();
    const questionB = await insertQuestion(topicId);

    const replaced = await storage.replaceTestQuestionScoring(testId, [
      { questionId, points: 2 } as never,
      { questionId: questionB, points: 5 } as never,
    ]);
    expect(replaced).toHaveLength(2);
    expect(replaced.every((r) => r.testId === testId)).toBe(true);

    // Replacing again with one row drops the other.
    const one = await storage.replaceTestQuestionScoring(testId, [
      { questionId, points: 9 } as never,
    ]);
    expect(one).toHaveLength(1);
    expect(one[0].points).toBe(9);

    // Empty replacement clears everything.
    expect(await storage.replaceTestQuestionScoring(testId, [])).toEqual([]);
    expect(await storage.getTestQuestionScoring(testId)).toEqual([]);
  });
});
