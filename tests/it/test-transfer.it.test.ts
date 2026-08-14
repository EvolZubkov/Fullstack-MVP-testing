/**
 * @module tests/it/test-transfer.it.test
 * @description The acceptance criterion the previous attempt got wrong.
 *
 * A round trip through ONE database proves nothing: the values are still there because
 * nobody removed them, so an export that carries NOTHING passes. This suite exports a test,
 * WIPES the database, and imports into the empty one — the receiving installation knows
 * none of the source's identifiers and holds none of its rows. Then it compares field by
 * field, ignoring only what is installation-scoped.
 *
 * That is why this lives in the pglite suite rather than beside the unit tests: it needs a
 * real database it is allowed to erase.
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
import { buildTransferZip } from "../../server/services/test-transfer/export";
// eslint-disable-next-line import/first
import { importTestPackage } from "../../server/services/test-transfer/import";
// eslint-disable-next-line import/first
import { buildSnapshotContent } from "../../server/services/test-snapshot";

const TEST_ID = "11111111-1111-4111-8111-111111111111";
const TOPIC_ID = "22222222-2222-4222-8222-222222222222";
const QUESTION_ID = "33333333-3333-4333-8333-333333333333";
const SCALE_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_ID = "55555555-5555-4555-8555-555555555555";
const IMPORTER_ID = "66666666-6666-4666-8666-666666666666";

/** Fields whose value legitimately differs on the receiving installation. */
const IGNORED = new Set([
  "id",
  "testId",
  "topicId",
  "questionId",
  "scaleId",
  "levelId",
  "ownerId",
  "folderId",
  "createdBy",
  "createdAt",
  "updatedAt",
  "nameNormalized",
]);

/** Strips identifiers and timestamps so two installations can be compared. */
function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (node && typeof node === "object" && !(node instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (IGNORED.has(key)) continue;
      out[key] = normalize(value);
    }
    return out;
  }
  return node;
}

/** The comparable shape of a test: content only, in a stable order. */
function comparable(content: Awaited<ReturnType<typeof buildSnapshotContent>>) {
  if (!content) throw new Error("нет содержимого");
  const questionsFlat = Object.values(content.questionsByTopic)
    .flat()
    .sort((a, b) => String(a.prompt).localeCompare(String(b.prompt)));
  return normalize({
    test: content.test,
    topics: [...content.topics].sort((a, b) => a.name.localeCompare(b.name)),
    sections: content.sections,
    questions: questionsFlat,
    scales: [...content.scales].sort((a, b) => a.key.localeCompare(b.key)),
    resultVariables: [...content.resultVariables].sort((a, b) => a.name.localeCompare(b.name)),
    contentPages: [...content.contentPages].sort((a, b) => String(a.kind).localeCompare(String(b.kind))),
    measurements: content.measurements,
    questionScoring: content.questionScoring ?? [],
  });
}

/** Creates a test whose every loss-prone field is filled in. */
async function seedSourceTest(db: Harness["db"]): Promise<void> {
  await db.insert(topics).values({ id: TOPIC_ID, name: "Лидерство", ownerId: OWNER_ID } as never);
  await db.insert(tests).values({
    id: TEST_ID,
    title: "Опросник",
    ownerId: OWNER_ID,
    overallPassRuleJson: { type: "percent", value: 55 },
    // Precisely the fields the workbook dropped.
    introJson: { results: { text: "<p>Об отчёте</p>" } },
    reportSettingsJson: { standard: { values: { scalesChartKind: "rose" } } },
    designSettingsJson: { params: { scaleRenderKind: "gradient_bar" } },
    maxAttempts: 3,
    copyProtection: false,
    showSectionResults: false,
  } as never);
  await db.insert(testSections).values({
    id: randomUUID(), testId: TEST_ID, topicId: TOPIC_ID, drawCount: 1,
  } as never);
  await db.insert(questions).values({
    id: QUESTION_ID, topicId: TOPIC_ID, type: "single_choice", prompt: "Вопрос",
    dataJson: { options: ["а", "б"] }, correctJson: { correct: [0] },
  } as never);
  await db.insert(scales).values({
    id: SCALE_ID, testId: TEST_ID, key: "vdo", label: "Вдохновляющий", type: "number",
    configJson: { domainMin: 0, domainMax: 98, valence: "none" },
  } as never);
  await db.insert(questionMeasurements).values({
    id: randomUUID(), testId: TEST_ID, questionId: QUESTION_ID, scaleId: SCALE_ID,
    sourceType: "question", valueJson: { value: 1 }, weight: 1,
  } as never);
  await db.insert(resultVariables).values({
    id: randomUUID(), testId: TEST_ID, name: "lead_style", label: "Ведущий стиль",
    type: "string", formula: "topScale(['vdo'],1).key",
    configJson: { outcomes: [{ code: "vdo", label: "Вдохновляющий", text: "Описание стиля" }] },
  } as never);
  await db.insert(contentPages).values({
    id: randomUUID(), testId: TEST_ID, position: "after", type: "summary", kind: "results",
    templateKey: "results.standard",
    settingsJson: { scalesChartKind: "rose", scoreSummary: "hide" },
  } as never);
  await db.insert(testQuestionScoring).values({
    id: randomUUID(), testId: TEST_ID, questionId: QUESTION_ID, points: 2,
  } as never);
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

describe("перенос теста в ЧИСТУЮ базу", () => {
  it("доставляет тест целиком: сверка поле в поле после очистки базы", async () => {
    await seedSourceTest(harness.db);

    const before = comparable(await buildSnapshotContent(TEST_ID));
    const { buffer } = await buildTransferZip(TEST_ID, { resolveRef: async () => null });

    // The receiving installation: same schema, nothing in it.
    await harness.reset();
    expect((await harness.db.select().from(tests)).length).toBe(0);

    const report = await importTestPackage(buffer, {
      ownerId: IMPORTER_ID,
      registerMedia: async () => ({ address: "/api/media/none", reused: true }),
    });

    const after = comparable(await buildSnapshotContent(report.testId));
    expect(after).toEqual(before);
  });

  it("отдаёт импортированный тест новому владельцу", async () => {
    await seedSourceTest(harness.db);
    const { buffer } = await buildTransferZip(TEST_ID, { resolveRef: async () => null });
    await harness.reset();

    const report = await importTestPackage(buffer, {
      ownerId: IMPORTER_ID,
      registerMedia: async () => ({ address: "/api/media/none", reused: true }),
    });

    const content = await buildSnapshotContent(report.testId);
    expect(content!.test.ownerId).toBe(IMPORTER_ID);
    expect(content!.topics[0].ownerId).toBe(IMPORTER_ID);
    expect(report.testId).not.toBe(TEST_ID);
  });

  it("откатывает импорт целиком, если запись не удалась", async () => {
    await seedSourceTest(harness.db);
    const { buffer } = await buildTransferZip(TEST_ID, { resolveRef: async () => null });
    await harness.reset();

    // A duplicate id inside one package is a package that must not land half-written.
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);
    const manifest = JSON.parse(await zip.file("test.json")!.async("string"));
    manifest.content.topics.push({ ...manifest.content.topics[0] });
    zip.file("test.json", JSON.stringify(manifest));
    const broken = await zip.generateAsync({ type: "nodebuffer" });

    await expect(
      importTestPackage(broken, {
        ownerId: IMPORTER_ID,
        registerMedia: async () => ({ address: "/api/media/none", reused: true }),
      }),
    ).rejects.toThrow();

    // Nothing at all: not the test, not the topic that inserted before the failure.
    expect((await harness.db.select().from(tests)).length).toBe(0);
    expect((await harness.db.select().from(topics)).length).toBe(0);
  });
});
