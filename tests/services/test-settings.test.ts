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
