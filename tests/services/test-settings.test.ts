/**
 * @module tests/services/test-settings
 * @description Unit tests for {@link TestSettingsService}.
 *
 * Covers (PRD-7 §5.3):
 *   - create(): wraps test + sections in one transaction
 *   - save(): optimistic version check, VersionConflictError on mismatch
 *   - save(): syncs status <-> published per §4.1
 *   - save(): replaces sections atomically
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VersionConflictError, TestSettingsService } from "../../server/services/test-settings";
import {
  templates,
  contentPages,
  testSections,
  tests as testsTable,
  adaptiveTopicSettings,
  adaptiveLevels,
  adaptiveLevelLinks,
} from "../../shared/schema";
import { RequiredFieldsMissingError } from "../../server/services/required-fields-validator";

// ─── DB mock ─────────────────────────────────────────────────────────────────

/** Creates a chainable Drizzle-like query builder that resolves `rows` at the end. */
function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.set = vi.fn().mockReturnValue(chain);
  chain.values = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(rows);
  // make `await chain` work (e.g. tx.delete(...).where(...))
  chain.then = (_resolve: (v: unknown) => void, _reject: (e: unknown) => void) => {
    return Promise.resolve(rows).then(_resolve as any, _reject);
  };
  return chain;
}

const { dbMock } = vi.hoisted(() => {
  const txMock: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const dbMock = {
    transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(txMock)),
    _tx: txMock,
  };

  return { dbMock };
});

vi.mock("../../server/db", () => ({ db: dbMock }));

// Drizzle schema imports must be after the mock declaration.
vi.mock("@shared/schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/schema")>();
  return { ...actual };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const tx = dbMock._tx;

function resetTx() {
  const chain = makeChain([]);
  tx.select.mockReturnValue(chain);
  tx.insert.mockReturnValue(chain);
  tx.update.mockReturnValue(chain);
  tx.delete.mockReturnValue(chain);
}

const dbTest = {
  id: "t1", title: "My Test", version: 3, status: "draft", published: false,
  mode: "standard", overallPassRuleJson: { type: "percent", value: 70 },
  showCorrectAnswers: false, showDifficultyLevel: true, telemetryEnabled: false,
  feedbackJson: null, flowPolicyJson: null, feedback: null, webhookUrl: null,
  timeLimitMinutes: null, maxAttempts: null, startPageContent: null,
  folderId: null, designSettingsJson: {}, createdAt: new Date(), updatedAt: new Date(),
};

// ─── create() ────────────────────────────────────────────────────────────────

describe("TestSettingsService.create()", () => {
  let svc: TestSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetTx();
    svc = new TestSettingsService();
  });

  it("runs inside a transaction", async () => {
    tx.insert.mockReturnValue(makeChain([dbTest]));
    await svc.create({ test: { title: "X", overallPassRuleJson: { type: "percent", value: 70 } }, sections: [] });
    expect(dbMock.transaction).toHaveBeenCalledOnce();
  });

  it("inserts test row and returns it", async () => {
    tx.insert.mockReturnValue(makeChain([dbTest]));
    const result = await svc.create({
      test: { title: "My Test", overallPassRuleJson: { type: "percent", value: 70 } },
      sections: [],
    });
    expect(result).toEqual(dbTest);
    expect(tx.insert).toHaveBeenCalled();
  });

  it("inserts sections for each entry", async () => {
    tx.insert.mockReturnValue(makeChain([dbTest]));
    await svc.create({
      test: { title: "T", overallPassRuleJson: {} },
      sections: [
        { topicId: "topic1", drawCount: 5 },
        { topicId: "topic2", drawCount: 3, required: false },
      ],
    });
    expect(tx.insert).toHaveBeenCalledTimes(3); // 1 test + 2 sections
  });

  it("derives status from published flag when status absent", async () => {
    const capturedValues: unknown[] = [];
    tx.insert.mockImplementation(() => {
      const c = makeChain([dbTest]);
      const origValues = c.values as ReturnType<typeof vi.fn>;
      (c as any).values = vi.fn().mockImplementation((v: unknown) => {
        capturedValues.push(v);
        return origValues(v);
      });
      return c;
    });

    await svc.create({
      test: { title: "T", published: true, overallPassRuleJson: {} },
      sections: [],
    });

    const testInsert = capturedValues[0] as Record<string, unknown>;
    expect(testInsert.status).toBe("published");
    expect(testInsert.published).toBe(true);
  });

  it("derives status='draft' when published=false", async () => {
    const capturedValues: unknown[] = [];
    tx.insert.mockImplementation(() => {
      const c = makeChain([dbTest]);
      const origValues = c.values as ReturnType<typeof vi.fn>;
      (c as any).values = vi.fn().mockImplementation((v: unknown) => {
        capturedValues.push(v);
        return origValues(v); // keep chain intact — origValues returns c
      });
      return c;
    });

    await svc.create({
      test: { title: "T", published: false, overallPassRuleJson: {} },
      sections: [],
    });

    const testInsert = capturedValues[0] as Record<string, unknown>;
    expect(testInsert.status).toBe("draft");
    expect(testInsert.published).toBe(false);
  });
});

// ─── save() ──────────────────────────────────────────────────────────────────

describe("TestSettingsService.save()", () => {
  let svc: TestSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new TestSettingsService();
  });

  it("throws VersionConflictError when version mismatches", async () => {
    // select returns version=5, but expectedVersion=3
    tx.select.mockReturnValue(makeChain([{ version: 5 }]));
    tx.update.mockReturnValue(makeChain([dbTest]));
    tx.delete.mockReturnValue(makeChain([]));
    tx.insert.mockReturnValue(makeChain([]));

    await expect(
      svc.save("t1", { test: { title: "X" }, expectedVersion: 3 }),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it("VersionConflictError exposes currentVersion and expectedVersion", async () => {
    tx.select.mockReturnValue(makeChain([{ version: 7 }]));
    tx.update.mockReturnValue(makeChain([dbTest]));
    tx.delete.mockReturnValue(makeChain([]));
    tx.insert.mockReturnValue(makeChain([]));

    try {
      await svc.save("t1", { test: {}, expectedVersion: 4 });
    } catch (err) {
      expect(err).toBeInstanceOf(VersionConflictError);
      const e = err as VersionConflictError;
      expect(e.currentVersion).toBe(7);
      expect(e.expectedVersion).toBe(4);
    }
  });

  it("saves successfully when version matches", async () => {
    tx.select.mockReturnValue(makeChain([{ version: 3 }]));
    tx.update.mockReturnValue(makeChain([{ ...dbTest, version: 4 }]));
    tx.delete.mockReturnValue(makeChain([]));
    tx.insert.mockReturnValue(makeChain([]));

    const result = await svc.save("t1", { test: { title: "New" }, expectedVersion: 3 });
    expect(result.version).toBe(4);
    expect(tx.update).toHaveBeenCalled();
  });

  it("skips version check when expectedVersion is undefined", async () => {
    tx.select.mockReturnValue(makeChain([{ version: 99 }]));
    tx.update.mockReturnValue(makeChain([dbTest]));
    tx.delete.mockReturnValue(makeChain([]));
    tx.insert.mockReturnValue(makeChain([]));

    await expect(
      svc.save("t1", { test: { title: "X" } }),
    ).resolves.not.toThrow();

    expect(tx.select).not.toHaveBeenCalled();
  });

  it("syncs published=true when status='published'", async () => {
    const captured: unknown[] = [];
    tx.update.mockImplementation(() => {
      const c = makeChain([dbTest]);
      (c as any).set = vi.fn().mockImplementation((v: unknown) => {
        captured.push(v);
        return c;
      });
      return c;
    });
    tx.delete.mockReturnValue(makeChain([]));
    tx.insert.mockReturnValue(makeChain([]));

    await svc.save("t1", { test: { status: "published" } });

    const patch = captured[0] as Record<string, unknown>;
    expect(patch.published).toBe(true);
  });

  it("syncs status='draft' when published=false", async () => {
    const captured: unknown[] = [];
    tx.update.mockImplementation(() => {
      const c = makeChain([dbTest]);
      (c as any).set = vi.fn().mockImplementation((v: unknown) => {
        captured.push(v);
        return c;
      });
      return c;
    });
    tx.delete.mockReturnValue(makeChain([]));
    tx.insert.mockReturnValue(makeChain([]));

    await svc.save("t1", { test: { published: false } });

    const patch = captured[0] as Record<string, unknown>;
    expect(patch.status).toBe("draft");
  });

  it("replaces sections when sections array provided", async () => {
    tx.update.mockReturnValue(makeChain([dbTest]));
    tx.delete.mockReturnValue(makeChain([]));
    tx.insert.mockReturnValue(makeChain([]));

    await svc.save("t1", {
      test: {},
      sections: [{ topicId: "tp1", drawCount: 5 }, { topicId: "tp2", drawCount: 3 }],
    });

    expect(tx.delete).toHaveBeenCalled();
    expect(tx.insert).toHaveBeenCalledTimes(2); // 2 sections
  });

  it("does NOT touch sections when sections is undefined", async () => {
    tx.update.mockReturnValue(makeChain([dbTest]));
    tx.delete.mockReturnValue(makeChain([]));
    tx.insert.mockReturnValue(makeChain([]));

    await svc.save("t1", { test: { title: "Only title" } });

    expect(tx.delete).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });
});

// ─── System pages reconciliation (PRD-1 §4.3.5, PRD-7 §1.4) ───────────────────

/** Built-in default template manifest sufficient for reconciliation. */
const defaultManifest = {
  id: "default",
  name: "Default",
  version: "1.0.0",
  templateApiVersion: "1.0",
  contentTemplates: [
    { key: "q.std", label: "Q", kind: "questions", isDefault: true },
    { key: "i.std", label: "I", kind: "intro" },
    { key: "s.std", label: "S", kind: "summary" },
    { key: "r.std", label: "R", kind: "router" },
  ],
};

/**
 * Configures `tx.select(...).from(table).where(...)` to return table-specific
 * rows. `tx.select` itself returns a thin proxy whose `.from(table)` dispatches
 * to the matching pre-built chain.
 */
function setupSelectDispatch(entries: Array<[unknown, unknown[]]>) {
  const rowsByTable = new Map<unknown, unknown[]>(entries);
  tx.select.mockImplementation(() => {
    const outer: Record<string, unknown> = {};
    outer.from = vi.fn().mockImplementation((table: unknown) => {
      const rows = rowsByTable.get(table) ?? [];
      return makeChain(rows);
    });
    return outer;
  });
}

function captureInserts(): Array<{ table: unknown; values: unknown }> {
  const captured: Array<{ table: unknown; values: unknown }> = [];
  tx.insert.mockImplementation((table: unknown) => {
    const c = makeChain([{ ...dbTest }]);
    (c as any).values = vi.fn().mockImplementation((v: unknown) => {
      captured.push({ table, values: v });
      return c;
    });
    return c;
  });
  return captured;
}

function captureDeletes(): unknown[] {
  const captured: unknown[] = [];
  tx.delete.mockImplementation((table: unknown) => {
    captured.push(table);
    return makeChain([]);
  });
  return captured;
}

describe("TestSettingsService._reconcileSystemPages — via create()", () => {
  let svc: TestSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetTx();
    svc = new TestSettingsService();
  });

  it("creates only the flat questions row on linear_flat create() — no section intro/summary", async () => {
    setupSelectDispatch([
      [templates, [{ id: "default", manifest: defaultManifest }]],
      [contentPages, []],
    ]);
    const inserts = captureInserts();

    await svc.create({
      test: {
        title: "T",
        flowPolicyJson: { mode: "linear_flat" },
        designSettingsJson: { templateId: "default" },
      },
      sections: [{ topicId: "tp1", drawCount: 5 }],
    });

    const cpInserts = inserts.filter((i) => i.table === contentPages);
    const kinds = cpInserts.map((i) => (i.values as { kind: string }).kind).sort();
    // intro/summary are per-section now (none in a flat test); this fixture's
    // template declares no start/results, so only the flat questions row is made.
    expect(kinds).toEqual(["questions"]);

    const questionsRow = cpInserts.find((i) => (i.values as { kind: string }).kind === "questions");
    expect((questionsRow!.values as { topicId: string | null }).topicId).toBeNull();
  });

  it("creates per-topic questions rows on linear_by_topics create()", async () => {
    setupSelectDispatch([
      [templates, [{ id: "default", manifest: defaultManifest }]],
      [contentPages, []],
    ]);
    const inserts = captureInserts();

    await svc.create({
      test: {
        title: "T",
        flowPolicyJson: { mode: "linear_by_topics" },
        designSettingsJson: { templateId: "default" },
      },
      sections: [
        { topicId: "tp1", drawCount: 5 },
        { topicId: "tp2", drawCount: 3 },
      ],
    });

    const cpInserts = inserts.filter((i) => i.table === contentPages);
    const questionsRows = cpInserts.filter((i) => (i.values as { kind: string }).kind === "questions");
    expect(questionsRows).toHaveLength(2);
    expect(questionsRows.map((r) => (r.values as { topicId: string | null }).topicId).sort()).toEqual(["tp1", "tp2"]);
  });

  it("creates router + per-topic questions on router_by_topics create()", async () => {
    setupSelectDispatch([
      [templates, [{ id: "default", manifest: defaultManifest }]],
      [contentPages, []],
    ]);
    const inserts = captureInserts();

    await svc.create({
      test: {
        title: "T",
        flowPolicyJson: { mode: "router_by_topics" },
        designSettingsJson: { templateId: "default" },
      },
      sections: [{ topicId: "tp1", drawCount: 5 }],
    });

    const cpInserts = inserts.filter((i) => i.table === contentPages);
    const kinds = cpInserts.map((i) => (i.values as { kind: string }).kind).sort();
    // PRD-1 §4.3: per-topic `intro` is created; legacy per-topic `summary` is not.
    // This fixture's template declares no start/results/review/section-results, so
    // the rows are the router hub + the topic's intro + questions (one topic).
    expect(kinds).toEqual(["intro", "questions", "router"]);
  });

  it("silently no-ops reconciliation when default template manifest is missing", async () => {
    setupSelectDispatch([
      [templates, []], // no manifests
      [contentPages, []],
    ]);
    const inserts = captureInserts();

    await svc.create({
      test: { title: "T", flowPolicyJson: { mode: "linear_flat" } },
      sections: [],
    });

    // Only the test row gets inserted; no content_pages inserts since
    // reconciliation aborts on missing manifest.
    const cpInserts = inserts.filter((i) => i.table === contentPages);
    expect(cpInserts).toHaveLength(0);
  });
});

describe("TestSettingsService._reconcileSystemPages — via save()", () => {
  let svc: TestSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetTx();
    svc = new TestSettingsService();
  });

  it("flowMode change linear_flat → linear_by_topics: deletes flat questions, creates per-topic", async () => {
    setupSelectDispatch([
      [templates, [{ id: "default", manifest: defaultManifest }]],
      [contentPages, [
        { id: "p-intro",   kind: "intro",     topicId: null, templateKey: "i.std", valuesJson: {} },
        { id: "p-summary", kind: "summary",   topicId: null, templateKey: "s.std", valuesJson: {} },
        { id: "p-qflat",   kind: "questions", topicId: null, templateKey: "q.std", valuesJson: { color: "blue" } },
      ]],
    ]);
    tx.update.mockReturnValue(makeChain([{
      ...dbTest,
      flowPolicyJson: { mode: "linear_by_topics" },
      designSettingsJson: { templateId: "default" },
    }]));
    const inserts = captureInserts();
    const deletes = captureDeletes();

    await svc.save("t1", {
      test: {
        flowPolicyJson: { mode: "linear_by_topics" },
        designSettingsJson: { templateId: "default" },
      },
      sections: [
        { topicId: "tp1", drawCount: 5 },
        { topicId: "tp2", drawCount: 3 },
      ],
    });

    // Flat questions row deleted
    expect(deletes.filter((t) => t === contentPages).length).toBeGreaterThan(0);
    // Per-topic questions rows created, values carried from flat row
    const cpInserts = inserts.filter((i) => i.table === contentPages);
    const newQ = cpInserts.filter((i) => (i.values as { kind: string }).kind === "questions");
    expect(newQ).toHaveLength(2);
    expect(newQ.every((i) => ((i.values as { valuesJson: { color?: string } }).valuesJson.color) === "blue")).toBe(true);
  });

  it("flowMode change → router_by_topics: adds router row, keeps existing", async () => {
    setupSelectDispatch([
      [templates, [{ id: "default", manifest: defaultManifest }]],
      [contentPages, [
        { id: "p-intro",   kind: "intro",     topicId: null, templateKey: "i.std", valuesJson: {} },
        { id: "p-summary", kind: "summary",   topicId: null, templateKey: "s.std", valuesJson: {} },
        { id: "p-q-tp1",   kind: "questions", topicId: "tp1", templateKey: "q.std", valuesJson: {} },
      ]],
    ]);
    tx.update.mockReturnValue(makeChain([{
      ...dbTest,
      flowPolicyJson: { mode: "router_by_topics" },
      designSettingsJson: { templateId: "default" },
    }]));
    const inserts = captureInserts();

    await svc.save("t1", {
      test: {
        flowPolicyJson: { mode: "router_by_topics" },
        designSettingsJson: { templateId: "default" },
      },
      sections: [{ topicId: "tp1", drawCount: 5 }],
    });

    const cpInserts = inserts.filter((i) => i.table === contentPages);
    const kinds = cpInserts.map((i) => (i.values as { kind: string }).kind);
    expect(kinds).toContain("router");
    expect(kinds.filter((k) => k === "questions")).toHaveLength(0); // existing tp1 questions kept
    // PRD-4 v1.1 §4.7: the router hub is a test-scope «До теста» page. It MUST be
    // inserted at position 'before' (not 'before_topic') — the router runtime seeds
    // the initial pageSequence from the test-scope 'before' pages, so 'before_topic'
    // would orphan the hub and the router page would never render.
    const routerInsert = cpInserts.find((i) => (i.values as { kind: string }).kind === "router");
    expect((routerInsert!.values as { position: string }).position).toBe("before");
  });

  it("flowMode change router_by_topics → linear_*: deletes router row", async () => {
    setupSelectDispatch([
      [templates, [{ id: "default", manifest: defaultManifest }]],
      [contentPages, [
        { id: "p-intro",   kind: "intro",     topicId: null, templateKey: "i.std", valuesJson: {} },
        { id: "p-summary", kind: "summary",   topicId: null, templateKey: "s.std", valuesJson: {} },
        { id: "p-router",  kind: "router",    topicId: null, templateKey: "r.std", valuesJson: {} },
        { id: "p-q-tp1",   kind: "questions", topicId: "tp1", templateKey: "q.std", valuesJson: {} },
      ]],
    ]);
    tx.update.mockReturnValue(makeChain([{
      ...dbTest,
      flowPolicyJson: { mode: "linear_by_topics" },
      designSettingsJson: { templateId: "default" },
    }]));
    captureInserts();
    const deletes = captureDeletes();

    await svc.save("t1", {
      test: {
        flowPolicyJson: { mode: "linear_by_topics" },
        designSettingsJson: { templateId: "default" },
      },
      sections: [{ topicId: "tp1", drawCount: 5 }],
    });

    // The router row should be deleted; other system rows kept.
    expect(deletes.filter((t) => t === contentPages).length).toBeGreaterThan(0);
  });

  it("triggers reconciliation when flowPolicyJson changes (no sections in payload)", async () => {
    setupSelectDispatch([
      [templates, [{ id: "default", manifest: defaultManifest }]],
      [contentPages, []],
      [testSections, [{ topicId: "tp-existing" }]],
    ]);
    tx.update.mockReturnValue(makeChain([{
      ...dbTest,
      flowPolicyJson: { mode: "router_by_topics" },
      designSettingsJson: { templateId: "default" },
    }]));
    const inserts = captureInserts();

    await svc.save("t1", {
      test: {
        flowPolicyJson: { mode: "router_by_topics" },
        designSettingsJson: { templateId: "default" },
      },
    });

    const cpInserts = inserts.filter((i) => i.table === contentPages);
    expect(cpInserts.length).toBeGreaterThan(0);
  });

  it("does NOT trigger reconciliation when only basic fields change", async () => {
    setupSelectDispatch([
      [templates, [{ id: "default", manifest: defaultManifest }]],
      [contentPages, []],
    ]);
    tx.update.mockReturnValue(makeChain([dbTest]));
    const inserts = captureInserts();

    await svc.save("t1", { test: { title: "New title only" } });

    const cpInserts = inserts.filter((i) => i.table === contentPages);
    expect(cpInserts).toHaveLength(0);
  });
});

// ─── Required fields validation (PRD-1 §4.3.6, PRD-7 §1.4) ────────────────────

const manifestWithRequired = {
  id: "default",
  name: "Default",
  version: "1.0.0",
  templateApiVersion: "1.0",
  contentTemplates: [
    { key: "q.std", label: "Q", kind: "questions", isDefault: true, placeholders: [] },
    {
      key: "i.std", label: "I", kind: "intro",
      placeholders: [
        { key: "title", type: "text", required: true },
        { key: "subtitle", type: "text", required: false },
      ],
    },
    {
      key: "s.std", label: "S", kind: "summary",
      placeholders: [
        { key: "title", type: "text", required: true },
        { key: "result", type: "resultField", required: true },
      ],
    },
  ],
};

describe("TestSettingsService — required fields validation on save", () => {
  let svc: TestSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetTx();
    svc = new TestSettingsService();
  });

  it("does NOT validate when status remains draft, even with missing required values", async () => {
    setupSelectDispatch([
      [templates, [{ id: "default", manifest: manifestWithRequired }]],
      [contentPages, [
        { id: "p-intro",   templateKey: "i.std", valuesJson: { values: {} } },
        { id: "p-summary", templateKey: "s.std", valuesJson: { values: {} } },
      ]],
    ]);
    tx.update.mockReturnValue(makeChain([{ ...dbTest, status: "draft" }]));
    captureInserts();

    await expect(svc.save("t1", { test: { status: "draft" } })).resolves.toBeTruthy();
  });

  it("validates and throws RequiredFieldsMissingError when transitioning to published with missing values", async () => {
    setupSelectDispatch([
      [templates, [{ id: "default", manifest: manifestWithRequired }]],
      [contentPages, [
        { id: "p-intro",   templateKey: "i.std", valuesJson: { values: { title: "Hello" } } },
        { id: "p-summary", templateKey: "s.std", valuesJson: { values: { title: "Done" } } }, // missing `result`
      ]],
    ]);
    tx.update.mockReturnValue(makeChain([{ ...dbTest, status: "published" }]));
    captureInserts();

    await expect(svc.save("t1", { test: { status: "published" } }))
      .rejects.toBeInstanceOf(RequiredFieldsMissingError);
  });

  it("RequiredFieldsMissingError exposes per-page violations with templateKey and missing fields", async () => {
    setupSelectDispatch([
      [templates, [{ id: "default", manifest: manifestWithRequired }]],
      [contentPages, [
        { id: "p-intro",   templateKey: "i.std", valuesJson: { values: { /* title missing */ } } },
        { id: "p-summary", templateKey: "s.std", valuesJson: { values: { title: "x" /* result missing */ } } },
      ]],
    ]);
    tx.update.mockReturnValue(makeChain([{ ...dbTest, status: "published" }]));
    captureInserts();

    try {
      await svc.save("t1", { test: { status: "published" } });
      throw new Error("expected RequiredFieldsMissingError");
    } catch (err) {
      expect(err).toBeInstanceOf(RequiredFieldsMissingError);
      const e = err as RequiredFieldsMissingError;
      const byPage = new Map(e.violations.map((v) => [v.pageId, v]));
      expect(byPage.get("p-intro")?.missingFields).toEqual(["title"]);
      expect(byPage.get("p-intro")?.templateKey).toBe("i.std");
      expect(byPage.get("p-summary")?.missingFields).toEqual(["result"]);
    }
  });

  it("passes when publishing with all required fields filled", async () => {
    setupSelectDispatch([
      [templates, [{ id: "default", manifest: manifestWithRequired }]],
      [contentPages, [
        { id: "p-intro",   templateKey: "i.std", valuesJson: { values: { title: "Hello" } } },
        { id: "p-summary", templateKey: "s.std", valuesJson: {
          values: { title: "Done", result: { path: "result.scorePercent" } },
        } },
      ]],
    ]);
    tx.update.mockReturnValue(makeChain([{ ...dbTest, status: "published" }]));
    captureInserts();

    await expect(svc.save("t1", { test: { status: "published" } })).resolves.toBeTruthy();
  });

  it("silently no-ops validation when template manifest cannot be loaded", async () => {
    setupSelectDispatch([
      [templates, []], // no manifest available
      [contentPages, []],
    ]);
    tx.update.mockReturnValue(makeChain([{ ...dbTest, status: "published" }]));
    captureInserts();

    // No throw — fail-soft on missing manifest (same behaviour as reconciliation).
    await expect(svc.save("t1", { test: { status: "published" } })).resolves.toBeTruthy();
  });

  it("skips rows whose templateKey is no longer in the manifest", async () => {
    setupSelectDispatch([
      [templates, [{ id: "default", manifest: manifestWithRequired }]],
      [contentPages, [
        // Stale templateKey — variant was removed from the manifest. The
        // validator can't check unknown variants; the row is skipped (the
        // upcoming template-change rebind will pick up the orphan).
        { id: "p-stale", templateKey: "unknown.key", valuesJson: { values: {} } },
      ]],
    ]);
    tx.update.mockReturnValue(makeChain([{ ...dbTest, status: "published" }]));
    captureInserts();

    await expect(svc.save("t1", { test: { status: "published" } })).resolves.toBeTruthy();
  });

  it("does NOT re-validate an already-published test (no draft->published transition)", async () => {
    // Regression (te-3): a test left published in an incomplete state must stay
    // editable. The pre-update row reports status "published", so re-saving with
    // status "published" is not a transition and skips the gate even though a
    // required field is missing — otherwise every save would roll back.
    setupSelectDispatch([
      [testsTable, [{ version: 1, status: "published", published: true }]],
      [templates, [{ id: "default", manifest: manifestWithRequired }]],
      [contentPages, [
        { id: "p-summary", templateKey: "s.std", valuesJson: { values: { title: "Done" } } }, // missing `result`
      ]],
    ]);
    tx.update.mockReturnValue(makeChain([{ ...dbTest, status: "published" }]));
    captureInserts();

    await expect(svc.save("t1", { test: { status: "published" } })).resolves.toBeTruthy();
  });
});

// ─── Adaptive settings persistence (PRD-7 §5.3, §6.3) ─────────────────────────
//
// Adaptive topic settings, levels, and per-level links are written by
// `_replaceAdaptiveSettings` inside the same transaction as the test row.
// These cases cover the API checklist items "POST adaptive creates test +
// adaptive settings atomically" and "PUT adaptive rolls back on a level/link
// error" (docs/specs/prd-7/s9-s11-in-progress.md §2.3).

/** A topic with two difficulty levels; the first level carries a single link. */
const adaptivePayload = [
  {
    topicId: "tp1",
    failureFeedback: "Study more",
    levels: [
      {
        levelIndex: 0, levelName: "Basic",
        minDifficulty: 0, maxDifficulty: 33, questionsCount: 5,
        passThreshold: 80, passThresholdType: "percent" as const,
        feedback: "ok", links: [{ title: "Course 1", url: "https://example.com/1" }],
      },
      {
        levelIndex: 1, levelName: "Advanced",
        minDifficulty: 34, maxDifficulty: 100, questionsCount: 5,
        passThreshold: 90, links: [], // passThresholdType omitted → defaults to "percent"
      },
    ],
  },
];

describe("TestSettingsService — adaptive settings persistence", () => {
  let svc: TestSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetTx();
    svc = new TestSettingsService();
  });

  it("create() adaptive inserts topic settings + levels + links in one transaction", async () => {
    setupSelectDispatch([
      [adaptiveLevels, []], // no existing levels to delete
      [templates, [{ id: "default", manifest: defaultManifest }]],
      [contentPages, []],
    ]);
    const inserts = captureInserts();

    await svc.create({
      test: {
        title: "Adaptive",
        mode: "adaptive",
        // PRD-4 v1.1: (adaptive, linear_flat) is invalid; use linear_by_topics for adaptive-flow tests.
        flowPolicyJson: { mode: "linear_by_topics" },
        designSettingsJson: { templateId: "default" },
        overallPassRuleJson: {},
      },
      sections: [],
      adaptiveSettings: adaptivePayload,
    });

    expect(dbMock.transaction).toHaveBeenCalledOnce();
    expect(inserts.filter((i) => i.table === adaptiveTopicSettings)).toHaveLength(1);
    expect(inserts.filter((i) => i.table === adaptiveLevels)).toHaveLength(2);
    expect(inserts.filter((i) => i.table === adaptiveLevelLinks)).toHaveLength(1);
  });

  it("create() adaptive persists topicId, level fields, and link title/url", async () => {
    setupSelectDispatch([
      [adaptiveLevels, []],
      [templates, [{ id: "default", manifest: defaultManifest }]],
      [contentPages, []],
    ]);
    const inserts = captureInserts();

    await svc.create({
      test: {
        title: "A",
        mode: "adaptive",
        flowPolicyJson: { mode: "linear_by_topics" },
        designSettingsJson: { templateId: "default" },
        overallPassRuleJson: {},
      },
      sections: [],
      adaptiveSettings: adaptivePayload,
    });

    const ts = inserts.find((i) => i.table === adaptiveTopicSettings)!.values as Record<string, unknown>;
    expect(ts.topicId).toBe("tp1");
    expect(ts.failureFeedback).toBe("Study more");

    const levels = inserts
      .filter((i) => i.table === adaptiveLevels)
      .map((i) => i.values as Record<string, unknown>);
    expect(levels.map((l) => l.levelName).sort()).toEqual(["Advanced", "Basic"]);
    // passThresholdType defaults to "percent" when the payload omits it.
    expect(levels.find((l) => l.levelName === "Advanced")!.passThresholdType).toBe("percent");

    const link = inserts.find((i) => i.table === adaptiveLevelLinks)!.values as Record<string, unknown>;
    expect(link.title).toBe("Course 1");
    expect(link.url).toBe("https://example.com/1");
  });

  it("save() adaptive deletes existing adaptive rows then inserts the new set", async () => {
    setupSelectDispatch([
      [adaptiveLevels, [{ id: "old-level-1" }]], // one pre-existing level → its links are cleared first
    ]);
    tx.update.mockReturnValue(makeChain([{ ...dbTest, mode: "adaptive" }]));
    const inserts = captureInserts();
    const deletes = captureDeletes();

    await svc.save("t1", {
      test: { mode: "adaptive", flowPolicyJson: { mode: "linear_by_topics" } },
      adaptiveSettings: adaptivePayload,
    });

    // Old rows are removed bottom-up to respect FK order…
    expect(deletes).toContain(adaptiveLevelLinks);
    expect(deletes).toContain(adaptiveLevels);
    expect(deletes).toContain(adaptiveTopicSettings);
    // …then the new payload is inserted.
    expect(inserts.filter((i) => i.table === adaptiveLevels)).toHaveLength(2);
    expect(inserts.filter((i) => i.table === adaptiveTopicSettings)).toHaveLength(1);
  });

  it("save() adaptive propagates a level-insert failure so the transaction rolls back", async () => {
    // The mocked `db.transaction` cannot perform a real ROLLBACK, but the real
    // Drizzle wrapper rolls back whenever the callback rejects. Asserting the
    // error escapes `save()` is what guarantees that rollback fires in prod.
    setupSelectDispatch([
      [adaptiveLevels, []],
    ]);
    tx.update.mockReturnValue(makeChain([{ ...dbTest, mode: "adaptive" }]));
    tx.insert.mockImplementation((table: unknown) => {
      if (table === adaptiveLevels) {
        const c = makeChain([]);
        (c as any).then = (_resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          Promise.reject(new Error("adaptive level insert failed")).then(_resolve, reject);
        return c;
      }
      return makeChain([{ ...dbTest }]);
    });

    await expect(
      svc.save("t1", {
        test: { mode: "adaptive", flowPolicyJson: { mode: "linear_by_topics" } },
        adaptiveSettings: adaptivePayload,
      }),
    ).rejects.toThrow("adaptive level insert failed");
  });
});

// ─── Legacy / backward-compat regression (PRD-7 §1.13.4) ──────────────────────

describe("TestSettingsService — legacy regression", () => {
  let svc: TestSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetTx();
    svc = new TestSettingsService();
  });

  it("create() without designSettingsJson falls back to the default template for reconciliation", async () => {
    // A legacy test carries no `designSettingsJson`; `extractTemplateId`
    // resolves to "default" and reconciliation still provisions system pages.
    setupSelectDispatch([
      [templates, [{ id: "default", manifest: defaultManifest }]],
      [contentPages, []],
    ]);
    const inserts = captureInserts();

    await svc.create({
      test: { title: "Legacy", flowPolicyJson: { mode: "linear_flat" }, overallPassRuleJson: {} },
      sections: [{ topicId: "tp1", drawCount: 5 }],
    });

    expect(inserts.filter((i) => i.table === contentPages).length).toBeGreaterThan(0);
  });

  it("create() without adaptiveSettings inserts no adaptive rows (standard test stays standard)", async () => {
    setupSelectDispatch([
      [templates, [{ id: "default", manifest: defaultManifest }]],
      [contentPages, []],
    ]);
    const inserts = captureInserts();

    await svc.create({
      test: {
        title: "Std",
        flowPolicyJson: { mode: "linear_flat" },
        designSettingsJson: { templateId: "default" },
        overallPassRuleJson: {},
      },
      sections: [{ topicId: "tp1", drawCount: 5 }],
    });

    expect(inserts.filter((i) => i.table === adaptiveTopicSettings)).toHaveLength(0);
    expect(inserts.filter((i) => i.table === adaptiveLevels)).toHaveLength(0);
    expect(inserts.filter((i) => i.table === adaptiveLevelLinks)).toHaveLength(0);
  });
});
