/**
 * @module tests/it/sim-chain-roundtrip.it.test
 * @description «Сценарий в ИС», техдолг №3: круговой тест цепочки «сохранение -> снимок
 * публикации -> книга Excel (выгрузка и загрузка) -> SCORM-сборка» на ОДНОМ тесте и настоящей базе.
 *
 * Звенья покрыты по отдельности; здесь проверяется, что пункты-сценарии не теряют поле на стыке:
 * после КАЖДОГО звена сверяются состав пунктов, их порядок, правила открытия, пороги и свойства
 * пункта. Книга сценарии не переносит, поэтому звено «книга -> импорт» проверяется в той форме,
 * в какой оно существует: книга обязана НЕ СТЕРЕТЬ пункты и то, что к ним привязано.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import session from "express-session";
import request from "supertest";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));
// The route's access gates are not under test here: the chain is.
vi.mock("../../server/middleware/auth", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/middleware/test-scope", () => ({
  requireTestScope: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { topics, questions } from "@shared/schema";
// eslint-disable-next-line import/first
import { DatabaseStorage } from "../../server/storage";
// eslint-disable-next-line import/first
import { testSettingsService, type ScenarioPayload } from "../../server/services/test-settings";
// eslint-disable-next-line import/first
import { buildSnapshotContent, createTestSnapshot, deliverySections } from "../../server/services/test-snapshot";
// eslint-disable-next-line import/first
import { buildScormExportData } from "../../server/scorm/build-export-data";
// eslint-disable-next-line import/first
import { buildTestJson } from "../../server/scorm/builders/test-json";
// eslint-disable-next-line import/first
import testsWorkbookRouter from "../../server/routes/tests-workbook";

/** Ids are fixed: the router keys (`scenario:<id>`) and the unlock rules refer to them. */
const T_A = "topic-a";
const T_B = "topic-b";
const BANK_RANDOM = "bank-random";
const BANK_FIXED = "bank-fixed";
const SC_RANDOM = "scenario-random";
const SC_FIXED = "scenario-fixed";
const FIXED_QUESTION = "sim-fixed-1";
const KEY_RANDOM = `scenario:${SC_RANDOM}`;
const KEY_FIXED = `scenario:${SC_FIXED}`;

const PENALTIES = { penalties: { miss: 0.5, wrongValue: 0.25, hint: 0.1 }, countPartial: true };

/** Pass rule of a scenario item as authored: `custom`, percent, 80. */
const scenarioPassRule = { source: "custom", type: "percent", value: 80 };
const topicPassRule = { source: "custom", type: "percent", value: 60 };

const ITEM_ORDER = ["topic:" + T_A, KEY_RANDOM, "topic:" + T_B, KEY_FIXED];
const UNLOCK_RULES = {
  // A scenario opens after a topic is passed; a topic opens after a scenario is completed.
  [KEY_RANDOM]: { mode: "after_sections_passed", sectionIds: [T_A] },
  [T_B]: { mode: "after_sections_completed", sectionIds: [KEY_RANDOM] },
};

let storage: DatabaseStorage;

beforeAll(async () => {
  h.current = await createHarness();
  storage = new DatabaseStorage();
});
afterAll(async () => {
  await h.current!.close();
});

/** Single-choice question of a plain topic. */
const plainQuestion = (id: string, topicId: string) => ({
  id,
  topicId,
  type: "single" as const,
  prompt: `Вопрос ${id}`,
  dataJson: { options: ["да", "нет"] },
  correctJson: { index: 0 },
});

/** Scenario question of a bank topic: the contract is irrelevant to the chain. */
const scenarioQuestion = (id: string, topicId: string) => ({
  id,
  topicId,
  type: "simulation" as const,
  prompt: `Сценарий ${id}`,
  dataJson: { scenario: {} },
  correctJson: {},
});

async function seedBank(): Promise<void> {
  const db = h.current!.db;
  const names: Record<string, string> = {
    [T_A]: "Тема А",
    [T_B]: "Тема Б",
    [BANK_RANDOM]: "Банк случайных",
    [BANK_FIXED]: "Банк фиксированного",
  };
  for (const [id, name] of Object.entries(names)) {
    await db.insert(topics).values({ id, name, nameNormalized: name.toLowerCase() });
  }
  await db.insert(questions).values([
    plainQuestion("qa1", T_A),
    plainQuestion("qb1", T_B),
    scenarioQuestion("sim-rnd-1", BANK_RANDOM),
    scenarioQuestion("sim-rnd-2", BANK_RANDOM),
    scenarioQuestion(FIXED_QUESTION, BANK_FIXED),
    scenarioQuestion("sim-fixed-2", BANK_FIXED),
  ] as never);
}

const SCENARIOS: ScenarioPayload[] = [
  {
    id: SC_RANDOM,
    topicId: BANK_RANDOM,
    questionId: null,
    title: "Работа в СЭД",
    required: true,
    groupKey: "grp-1",
    defaultPoints: 3,
    passRuleJson: scenarioPassRule,
  },
  {
    id: SC_FIXED,
    topicId: BANK_FIXED,
    questionId: FIXED_QUESTION,
    title: "Оформление заявки",
    required: false,
    groupKey: null,
    defaultPoints: 5,
    passRuleJson: scenarioPassRule,
  },
];

/** What the chain must preserve, read from LIVE storage. */
interface ChainState {
  /** Delivery order of the items, as keys. */
  order: string[];
  scenarios: Array<{
    id: string;
    topicId: string;
    questionId: string | null;
    title: string | null;
    required: boolean;
    groupKey: string | null;
    defaultPoints: number | null;
    passRuleJson: unknown;
    sortOrder: number;
  }>;
  sections: Array<{ topicId: string; topicPassRuleJson: unknown }>;
  itemOrder: unknown;
  unlockRules: unknown;
  simScoring: unknown;
  mode: string;
  flowMode: unknown;
}

/**
 * Unlock rules without the explicit default: the book writes `always_available` for every topic
 * it describes, and that entry means exactly what an absent one does.
 */
function meaningfulRules(rules: unknown): unknown {
  return Object.fromEntries(
    Object.entries((rules ?? {}) as Record<string, { mode?: string }>).filter(([, rule]) => rule?.mode !== "always_available"),
  );
}

async function liveState(testId: string): Promise<ChainState> {
  const test = (await storage.getTest(testId))!;
  const sections = await storage.getTestSections(testId);
  const scenarios = await storage.getTestScenarios(testId);
  const router = ((test.flowPolicyJson as { router?: Record<string, unknown> } | null)?.router ?? {}) as Record<string, unknown>;
  return {
    order: deliverySections(test, sections, scenarios).map((s) => s.topicId),
    scenarios: scenarios.map((s) => ({
      id: s.id,
      topicId: s.topicId,
      questionId: s.questionId,
      title: s.title,
      required: s.required,
      groupKey: s.groupKey,
      defaultPoints: s.defaultPoints,
      passRuleJson: s.passRuleJson,
      sortOrder: s.sortOrder,
    })),
    sections: sections.map((s) => ({ topicId: s.topicId, topicPassRuleJson: s.topicPassRuleJson })),
    itemOrder: router.itemOrder,
    unlockRules: meaningfulRules(router.sectionUnlockRules),
    simScoring: test.simScoringJson,
    mode: test.mode,
    flowMode: (test.flowPolicyJson as { mode?: unknown } | null)?.mode,
  };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use("/api/tests", testsWorkbookRouter);
  return app;
}

describe("«Сценарий в ИС»: сквозной круг сохранение -> снимок -> книга -> SCORM", () => {
  it("пункты, порядок, правила открытия, пороги и свойства переживают каждое звено", async () => {
    await seedBank();

    // ── 1. Сохранение ────────────────────────────────────────────────────────
    const created = await testSettingsService.create({
      test: {
        title: "Цепочка",
        mode: "standard",
        status: "published",
        flowPolicyJson: {
          mode: "router_by_topics",
          router: {
            completionPolicy: "all_required_completed",
            itemOrder: ITEM_ORDER,
            sectionUnlockRules: UNLOCK_RULES,
          },
        },
        simScoringJson: PENALTIES,
        sectionGroupsJson: [{ key: "grp-1", label: "Группа 1" }],
      },
      sections: [
        { topicId: T_A, drawCount: 1, topicPassRuleJson: topicPassRule },
        { topicId: T_B, drawCount: 1, topicPassRuleJson: topicPassRule },
      ],
      scenarios: SCENARIOS,
    });
    const testId = created.id;

    const saved = await liveState(testId);
    expect(saved.order).toEqual([T_A, KEY_RANDOM, T_B, KEY_FIXED]);
    expect(saved.scenarios).toEqual([
      expect.objectContaining({ id: SC_RANDOM, topicId: BANK_RANDOM, questionId: null, title: "Работа в СЭД", required: true, groupKey: "grp-1", defaultPoints: 3, passRuleJson: scenarioPassRule, sortOrder: 0 }),
      expect.objectContaining({ id: SC_FIXED, topicId: BANK_FIXED, questionId: FIXED_QUESTION, title: "Оформление заявки", required: false, groupKey: null, defaultPoints: 5, passRuleJson: scenarioPassRule, sortOrder: 1 }),
    ]);
    expect(saved.itemOrder).toEqual(ITEM_ORDER);
    expect(saved.unlockRules).toEqual(UNLOCK_RULES);
    expect(saved.simScoring).toEqual(PENALTIES);
    expect(saved.sections).toEqual([
      { topicId: T_A, topicPassRuleJson: topicPassRule },
      { topicId: T_B, topicPassRuleJson: topicPassRule },
    ]);

    // ── 2. Снимок публикации ─────────────────────────────────────────────────
    const frozen = (await buildSnapshotContent(testId))!;
    expect(frozen.scenarios!.map((s) => ({ id: s.id, passRuleJson: s.passRuleJson, title: s.title, required: s.required, groupKey: s.groupKey, defaultPoints: s.defaultPoints, questionId: s.questionId }))).toEqual(
      saved.scenarios.map((s) => ({ id: s.id, passRuleJson: s.passRuleJson, title: s.title, required: s.required, groupKey: s.groupKey, defaultPoints: s.defaultPoints, questionId: s.questionId })),
    );
    const frozenDelivery = deliverySections(frozen.test, frozen.sections, frozen.scenarios ?? []);
    expect(frozenDelivery.map((s) => s.topicId)).toEqual(saved.order);
    expect(frozenDelivery.map((s) => s.topicPassRuleJson)).toEqual([topicPassRule, scenarioPassRule, topicPassRule, scenarioPassRule]);
    expect((frozen.test.flowPolicyJson as { router: { sectionUnlockRules: unknown; itemOrder: unknown } }).router).toMatchObject({ sectionUnlockRules: UNLOCK_RULES, itemOrder: ITEM_ORDER });
    expect(frozen.test.simScoringJson).toEqual(PENALTIES);

    const snapshotId = await createTestSnapshot(testId, null);
    expect(snapshotId).toBeTruthy();
    // The stored (JSON-serialised) snapshot must say the same as the one just assembled.
    const stored = (await storage.getLatestSnapshot(testId))!.contentJson as typeof frozen;
    expect(stored.scenarios!.map((s) => s.passRuleJson)).toEqual([scenarioPassRule, scenarioPassRule]);
    expect(deliverySections(stored.test, stored.sections, stored.scenarios ?? []).map((s) => s.topicId)).toEqual(saved.order);

    // ── 3. Книга: выгрузка и загрузка обратно ───────────────────────────────
    const app = makeApp();
    const exported = await request(app)
      .get(`/api/tests/${testId}/workbook/export`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(exported.status).toBe(200);

    const imported = await request(app)
      .post(`/api/tests/${testId}/workbook/import`)
      .attach("file", exported.body as Buffer, { filename: "book.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    expect(imported.status).toBe(200);
    expect(imported.body.errors).toEqual([]);

    const afterBook = await liveState(testId);
    expect(afterBook.scenarios).toEqual(saved.scenarios);
    expect(afterBook.order).toEqual(saved.order);
    expect(afterBook.itemOrder).toEqual(saved.itemOrder);
    expect(afterBook.unlockRules).toEqual(saved.unlockRules);
    expect(afterBook.simScoring).toEqual(saved.simScoring);
    expect(afterBook.sections).toEqual(saved.sections);
    expect(afterBook.mode).toBe(saved.mode);
    expect(afterBook.flowMode).toBe(saved.flowMode);

    // ── 4. SCORM-сборка: по живому состоянию и по новому снимку ─────────────
    await createTestSnapshot(testId, null);
    for (const version of ["draft", "published"] as const) {
      const data = await buildScormExportData(testId, { source: "export", version });
      const pkg = JSON.parse(buildTestJson(data as never)) as {
        flowPolicy: { mode: string; sectionUnlockRules: unknown; itemOrder?: unknown };
        sections: Array<{ topicId: string; topicName: string; topicPassRule: unknown; required: boolean; drawCount: number; questions: Array<{ id: string; scoring?: unknown }> }>;
      };
      expect(pkg.sections.map((s) => s.topicId), version).toEqual(saved.order);
      expect(pkg.sections.map((s) => s.topicPassRule), version).toEqual([topicPassRule, scenarioPassRule, topicPassRule, scenarioPassRule]);
      expect(pkg.sections.map((s) => s.topicName), version).toEqual(["Тема А", "Работа в СЭД", "Тема Б", "Оформление заявки"]);
      expect(pkg.sections.map((s) => s.required), version).toEqual([true, true, true, false]);
      expect(pkg.flowPolicy.mode, version).toBe("router_by_topics");
      expect(meaningfulRules(pkg.flowPolicy.sectionUnlockRules), version).toEqual(UNLOCK_RULES);
      expect(pkg.flowPolicy.itemOrder, version).toEqual(ITEM_ORDER);
      // The fixed item ships its one scenario; the random one ships its whole bank.
      const byItem = Object.fromEntries(pkg.sections.map((sec) => [sec.topicId, sec.questions.map((q) => q.id)]));
      expect(byItem[KEY_RANDOM], version).toEqual(["sim-rnd-1", "sim-rnd-2"]);
      expect(byItem[KEY_FIXED], version).toEqual([FIXED_QUESTION]);
      // Test-wide penalties reach the scenario questions.
      for (const key of [KEY_RANDOM, KEY_FIXED]) {
        for (const q of pkg.sections.find((sec) => sec.topicId === key)!.questions) {
          expect(JSON.stringify(q.scoring), `${version} ${q.id}`).toContain("0.25");
        }
      }
    }
  });
});
