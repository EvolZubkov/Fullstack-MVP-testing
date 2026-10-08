/**
 * @module tests/sim-host-parity/fixture
 * @description «Сценарий в ИС», техдолг №4: ОДИН тест для обоих хостов паритета.
 *
 * Тест сохраняется настоящим путём (`testSettingsService.create`) в pglite, а затем веб получает
 * его через настоящий маршрут старта попытки, пакет — через настоящий `buildScormExportData`.
 * Руками не пишется ни `TEST_DATA`, ни ответ старта: иначе сравнение шло бы между двумя
 * описаниями, сделанными тестом, а не между хостами (проект — записка
 * `docs/handoff/HANDOFF-2026-10-08-sim-host-parity.md`, 9.2).
 *
 * Случайность исключена: темы отдают все вопросы в порядке автора, варианты не перемешиваются,
 * пункты-сценарии выдают фиксированный сценарий. Иначе хосты выдали бы разное и сравнивать было
 * бы нечего.
 *
 * Модуль не мокает базу сам: `vi.mock` модуля `server/db` должен стоять в файле теста (он
 * поднимается выше импортов), а сюда приходит уже подменённое хранилище.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { topics, questions, users, testAssignments } from "@shared/schema";
import type { Scenario } from "@shared/sim/contract";
import type { Harness } from "../it/db-harness";
import { storage } from "../../server/storage";
import { testSettingsService } from "../../server/services/test-settings";

/** Topic and bank ids are fixed: the item keys and the unlock rules refer to them. */
export const T_A = "topic-a";
export const T_B = "topic-b";
export const BANK_1 = "bank-1";
export const BANK_2 = "bank-2";
export const SC_1 = "scenario-1";
export const SC_2 = "scenario-2";
export const SIM_Q1 = "sim-q1";
export const SIM_Q2 = "sim-q2";
export const KEY_SC1 = `scenario:${SC_1}`;
export const KEY_SC2 = `scenario:${SC_2}`;
export const LEARNER_ID = "learner-parity";

/** The reference quest of the contract — a real scenario, so `/finish` can replay its protocol. */
export const EXAMPLE_SCENARIO = JSON.parse(
  readFileSync(resolve(process.cwd(), "docs/specs/sim-scenario/example/scenario.json"), "utf8"),
) as Scenario;

/** What a passage varies. Everything else is the same fixture for every passage. */
export interface FixtureOptions {
  /** `all_required_completed` (default) | `all_required_passed`. */
  completionPolicy?: string;
  /** «Итоги раздела» after each item (PRD-19 FR-05a). Default `true`. */
  showSectionResults?: boolean;
  /** «Менять ответ»: a completed scenario may be run again (tech debt №7). Default `false`. */
  allowAnswerChange?: boolean;
  /** «Засчитывать частичное» for scenarios. Default `true`. */
  countPartial?: boolean;
}

/** Single-choice question; the correct option is always the first one. */
const choice = (id: string, topicId: string) => ({
  id,
  topicId,
  type: "single" as const,
  prompt: `Вопрос ${id}`,
  dataJson: { options: ["верно", "неверно"] },
  correctJson: { correctIndex: 0 },
  shuffleAnswers: false,
});

const simulation = (id: string, topicId: string) => ({
  id,
  topicId,
  type: "simulation" as const,
  prompt: `Сценарий ${id}`,
  dataJson: { scenario: EXAMPLE_SCENARIO },
  correctJson: {},
  shuffleAnswers: false,
});

/** Topics, questions and the learner — once per database. */
export async function seedBank(h: Harness): Promise<void> {
  const db = h.db;
  const names: Record<string, string> = {
    [T_A]: "Тема А",
    [T_B]: "Тема Б",
    [BANK_1]: "Банк сценариев 1",
    [BANK_2]: "Банк сценариев 2",
  };
  for (const [id, name] of Object.entries(names)) {
    await db.insert(topics).values({ id, name, nameNormalized: name.toLowerCase() });
  }
  await db.insert(questions).values([
    choice("qa1", T_A),
    choice("qa2", T_A),
    choice("qb1", T_B),
    choice("qb2", T_B),
    simulation(SIM_Q1, BANK_1),
    simulation(SIM_Q2, BANK_2),
  ] as never);
  await db.insert(users).values({
    id: LEARNER_ID,
    name: "Участник",
    status: "active",
    mustChangePassword: false,
    gdprConsent: true,
  } as never);
}

/**
 * Saves one router test and returns its id. Scenario item ids are unique per call (the key
 * `scenario:<id>` is what both hosts address), so several variants live in one database.
 */
export async function createRouterTest(h: Harness, options: FixtureOptions = {}, suffix = ""): Promise<{
  testId: string;
  keySc1: string;
  keySc2: string;
}> {
  const sc1 = SC_1 + suffix;
  const sc2 = SC_2 + suffix;
  const keySc1 = `scenario:${sc1}`;
  const keySc2 = `scenario:${sc2}`;
  const created = await testSettingsService.create({
    test: {
      title: "Паритет хостов",
      mode: "standard",
      status: "published",
      questionOrder: "fixed",
      overallPassRuleJson: { type: "percent", value: 50 },
      allowAnswerChange: options.allowAnswerChange ?? false,
      showSectionResults: options.showSectionResults ?? true,
      simScoringJson: { countPartial: options.countPartial ?? true },
      flowPolicyJson: {
        mode: "router_by_topics",
        router: {
          completionPolicy: options.completionPolicy ?? "all_required_completed",
          itemOrder: [`topic:${T_A}`, keySc1, `topic:${T_B}`, keySc2],
          sectionUnlockRules: {
            // The scenario opens only after topic A is PASSED — the rule that needs an outcome.
            [keySc1]: { mode: "after_sections_passed", sectionIds: [T_A] },
          },
        },
      },
    } as never,
    sections: [
      { topicId: T_A, drawCount: 2, drawAll: true, topicPassRuleJson: { source: "custom", type: "percent", value: 60 } },
      { topicId: T_B, drawCount: 2, drawAll: true, topicPassRuleJson: { source: "custom", type: "percent", value: 60 } },
    ] as never,
    scenarios: [
      {
        id: sc1,
        topicId: BANK_1,
        questionId: SIM_Q1,
        title: "Сценарий один",
        required: true,
        passRuleJson: { source: "custom", type: "percent", value: 80 },
      },
      { id: sc2, topicId: BANK_2, questionId: SIM_Q2, title: "Сценарий два", required: false },
    ],
  });
  await ensureRouterPage(created.id);
  // The learner's list (and so the web start screen) shows only assigned tests.
  await h.db.insert(testAssignments).values({
    id: randomUUID(),
    testId: created.id,
    userId: LEARNER_ID,
    assignedBy: LEARNER_ID,
  } as never);
  return { testId: created.id, keySc1, keySc2 };
}

/** The hub is the test's `router` content page; both hosts need it to return to. */
async function ensureRouterPage(testId: string): Promise<void> {
  const pages = await storage.getContentPages(testId);
  if (pages.some((p) => p.kind === "router")) return;
  await storage.createContentPage({
    testId,
    topicId: null,
    position: "before",
    mode: "template",
    type: "info",
    kind: "router",
    templateKey: "router.menu",
    sortOrder: 0,
    valuesJson: { values: { title: "Разделы" }, placeholderStyles: {} },
  } as never);
}
