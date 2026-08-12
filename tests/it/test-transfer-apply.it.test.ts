/**
 * @module tests/it/test-transfer-apply.it.test
 * @description Applying a selective-import plan against a REAL database.
 *
 * The decisions themselves are proved without a database (`test-transfer-diff.test.ts`);
 * what needs one is the execution: that an update writes into the receiver's own row rather
 * than a copy, that a deletion takes the cascade with it, and above all that a failure in the
 * middle leaves NOTHING behind — a half-applied import is worse than none, because nothing
 * about it announces that it is half.
 *
 * NOTE: this suite runs on ONE database on purpose — it asks what `apply` DOES, not whether
 * the package carries enough (that is `test-transfer.it.test.ts`, which imports into a wiped
 * database and is the acceptance criterion of the transfer).
 */
import { randomUUID } from "node:crypto";
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
import {
  tests,
  topics,
  questions,
  testSections,
  scales,
  resultVariables,
  contentPages,
  questionMeasurements,
  testQuestionScoring,
} from "@shared/schema";
// eslint-disable-next-line import/first
import { eq } from "drizzle-orm";
// eslint-disable-next-line import/first
import { buildTransferZip } from "../../server/services/test-transfer/export";
// eslint-disable-next-line import/first
import { buildTargetSnapshot } from "../../server/services/test-transfer/target";
// eslint-disable-next-line import/first
import { applyTransfer, TransferForbiddenError } from "../../server/services/test-transfer/apply";
// eslint-disable-next-line import/first
import type { TransferOptions } from "../../server/services/test-transfer/diff";
// eslint-disable-next-line import/first
import type { TestTransferPackage } from "../../server/services/test-transfer/package";

const TEST_ID = "11111111-1111-4111-8111-111111111111";
const TOPIC_ID = "22222222-2222-4222-8222-222222222222";
const QUESTION_ID = "33333333-3333-4333-8333-333333333333";
const EXTRA_QUESTION_ID = "77777777-7777-4777-8777-777777777777";
const SCALE_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_ID = "55555555-5555-4555-8555-555555555555";

/** The test as the SOURCE has it — the state the package will carry. */
async function seedTest(db: Harness["db"]): Promise<void> {
  await db.insert(topics).values({ id: TOPIC_ID, name: "Лидерство", ownerId: OWNER_ID } as never);
  await db.insert(tests).values({
    id: TEST_ID,
    title: "Опросник",
    ownerId: OWNER_ID,
    overallPassRuleJson: { type: "percent", value: 55 },
    introJson: { results: { text: "<p>Об отчёте</p>" } },
  } as never);
  await db.insert(testSections).values({
    id: randomUUID(), testId: TEST_ID, topicId: TOPIC_ID, drawCount: 1,
  } as never);
  await db.insert(questions).values({
    id: QUESTION_ID, topicId: TOPIC_ID, type: "single", prompt: "Вопрос источника",
    dataJson: { options: ["а", "б"] }, correctJson: { correct: [0] },
  } as never);
  await db.insert(scales).values({
    id: SCALE_ID, testId: TEST_ID, key: "vdo", label: "Вдохновляющий", type: "number",
    configJson: { domainMin: 0, domainMax: 98 },
  } as never);
  await db.insert(questionMeasurements).values({
    id: randomUUID(), testId: TEST_ID, questionId: QUESTION_ID, scaleId: SCALE_ID,
    sourceType: "question", valueJson: { value: 1 }, weight: 1,
  } as never);
  await db.insert(resultVariables).values({
    id: randomUUID(), testId: TEST_ID, name: "lead_style", label: "Ведущий стиль",
    type: "string", formula: "topScale(['vdo'],1).key",
    configJson: { outcomes: [{ code: "vdo", label: "Вдохновляющий" }] },
  } as never);
  await db.insert(contentPages).values({
    id: randomUUID(), testId: TEST_ID, position: "after", type: "summary", kind: "results",
    templateKey: "results.standard", settingsJson: { scalesChartKind: "rose" },
  } as never);
  await db.insert(testQuestionScoring).values({
    id: randomUUID(), testId: TEST_ID, questionId: QUESTION_ID, points: 2,
  } as never);
}

/**
 * Drags the database away from the package: the author edited the test here after the
 * package was written, and added content of their own.
 */
async function divergeReceiver(db: Harness["db"]): Promise<void> {
  await db.update(tests).set({ title: "Опросник (правленный тут)" }).where(eq(tests.id, TEST_ID));
  await db.update(questions).set({ prompt: "Вопрос, правленный тут" }).where(eq(questions.id, QUESTION_ID));
  await db.insert(questions).values({
    id: EXTRA_QUESTION_ID, topicId: TOPIC_ID, type: "single", prompt: "Вопрос только приёмника",
    dataJson: { options: ["а"] }, correctJson: { correct: [0] },
  } as never);
  await db.insert(scales).values({
    id: randomUUID(), testId: TEST_ID, key: "old", label: "Шкала только приёмника",
    type: "number", configJson: {},
  } as never);
}

/** Every part on, safe modes, the topic merged. */
function options(overrides: Partial<TransferOptions> = {}): TransferOptions {
  return {
    parts: { structure: true, scoring: true, scales: true, results: true, media: true },
    modes: { scoring: "upsert", scales: "upsert" },
    topics: { [TOPIC_ID]: "merge" },
    ...overrides,
  };
}

/** Applies a package with the target read fresh from the database. */
async function apply(
  pkg: TestTransferPackage,
  archive: Buffer,
  opts: TransferOptions,
  canManageTopic: (id: string) => Promise<boolean> = async () => true,
) {
  const target = await buildTargetSnapshot(pkg, { ownerId: OWNER_ID });
  return applyTransfer({
    archive,
    pkg,
    target,
    options: opts,
    ownerId: OWNER_ID,
    canManageTopic,
    registerMedia: async () => ({ address: "/api/media/none", reused: true }),
  });
}

let harness: Harness;

beforeAll(async () => {
  harness = await createHarness();
  h.current = harness;
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.reset();
});

describe("применение плана переноса", () => {
  it("возвращает строки приёмника к состоянию пакета, не трогая лишнего", async () => {
    await seedTest(harness.db);
    const { buffer, pkg } = await buildTransferZip(TEST_ID, { resolveRef: async () => null });
    await divergeReceiver(harness.db);

    const report = await apply(pkg, buffer, options());

    const [test] = await harness.db.select().from(tests).where(eq(tests.id, TEST_ID));
    expect(test.title).toBe("Опросник");
    const [question] = await harness.db.select().from(questions).where(eq(questions.id, QUESTION_ID));
    expect(question.prompt).toBe("Вопрос источника");
    // Upsert never removes: the receiver's own question and scale stay.
    const pool = await harness.db.select().from(questions).where(eq(questions.topicId, TOPIC_ID));
    expect(pool.map((q) => q.id).sort()).toEqual([QUESTION_ID, EXTRA_QUESTION_ID].sort());
    expect((await harness.db.select().from(scales).where(eq(scales.testId, TEST_ID))).length).toBe(2);
    expect(report.testId).toBe(TEST_ID);
    expect(report.deleted).toEqual({});
  });

  it("полная замена темы удаляет вопрос, которого нет в пакете", async () => {
    await seedTest(harness.db);
    const { buffer, pkg } = await buildTransferZip(TEST_ID, { resolveRef: async () => null });
    await divergeReceiver(harness.db);

    const report = await apply(pkg, buffer, options({ topics: { [TOPIC_ID]: "replace" } }));

    const pool = await harness.db.select().from(questions).where(eq(questions.topicId, TOPIC_ID));
    expect(pool.map((q) => q.id)).toEqual([QUESTION_ID]);
    expect(report.deleted.question).toBe(1);
  });

  it("замена шкал удаляет шкалу, которой нет в пакете, вместе с её вкладами", async () => {
    await seedTest(harness.db);
    const { buffer, pkg } = await buildTransferZip(TEST_ID, { resolveRef: async () => null });
    await divergeReceiver(harness.db);

    await apply(pkg, buffer, options({ modes: { scoring: "upsert", scales: "replace" } }));

    const left = await harness.db.select().from(scales).where(eq(scales.testId, TEST_ID));
    expect(left.map((s) => s.key)).toEqual(["vdo"]);
  });

  it("не трогает чужую тему без прав управления и не пишет ничего", async () => {
    await seedTest(harness.db);
    const { buffer, pkg } = await buildTransferZip(TEST_ID, { resolveRef: async () => null });
    await divergeReceiver(harness.db);

    await expect(apply(pkg, buffer, options(), async () => false)).rejects.toThrow(
      TransferForbiddenError,
    );

    // The forbidden answer must come BEFORE any write.
    const [test] = await harness.db.select().from(tests).where(eq(tests.id, TEST_ID));
    expect(test.title).toBe("Опросник (правленный тут)");
  });

  it("откатывает всё, если запись упала на середине", async () => {
    await seedTest(harness.db);
    const { buffer, pkg } = await buildTransferZip(TEST_ID, { resolveRef: async () => null });
    await divergeReceiver(harness.db);

    // A question with no prompt violates NOT NULL — the failure lands after the test row
    // and the topic have already been written inside the transaction.
    const broken = JSON.parse(JSON.stringify(pkg)) as TestTransferPackage;
    (broken.content.questionsByTopic[TOPIC_ID][0] as unknown as { prompt: unknown }).prompt = null;

    await expect(apply(broken, buffer, options())).rejects.toThrow();

    const [test] = await harness.db.select().from(tests).where(eq(tests.id, TEST_ID));
    expect(test.title).toBe("Опросник (правленный тут)");
    const [question] = await harness.db.select().from(questions).where(eq(questions.id, QUESTION_ID));
    expect(question.prompt).toBe("Вопрос, правленный тут");
  });
});
