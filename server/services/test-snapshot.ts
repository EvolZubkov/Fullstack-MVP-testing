/**
 * @module server/services/test-snapshot
 *
 * Publication snapshots (PRD-15 block B). On publish/republish a test is frozen
 * into a self-contained {@link TestSnapshotContent} blob; delivery of a
 * published test reads ONLY from that blob, so later edits to the shared bank
 * do not change in-flight or future attempts until the next republish (FR-10,
 * FR-11).
 *
 * The blob captures the RAW storage rows the attempt runtime reads live today
 * (questions per topic, sections, adaptive config, scales, measurements, result
 * variables, content pages, topic courses/events). A {@link TestDataSource}
 * facade exposes exactly the storage getters the runtime uses, backed either by
 * a snapshot (published attempts) or by live storage (drafts, preview, legacy
 * attempts) — so the runtime depends on one read interface, not on `storage`
 * directly.
 *
 * Why raw rows and not the SCORM `buildTestJson` shape: the web runtime keys
 * everything by DB UUIDs and calls storage getters, whereas the SCORM bake is
 * index-id / scales-by-key tailored for the in-package player. Storing raw rows
 * keeps the snapshot a drop-in for the live storage reads. Block D follows the
 * same rule: per-test scoring overrides are frozen RAW (`questionScoring`) and
 * resolved at delivery through the shared effective-scoring chain, so live and
 * snapshot attempts share one resolution code path (FR-32).
 */

import { isDeliverable, isSimulation } from "@shared/questions/question-type";
import { orderTestItems, scenarioItemKey } from "@shared/test-items";
import { resolveFlowPolicy } from "@shared/flow/flow-policy";
import { storage } from "../storage";
import { materializeScaleDomains } from "./scale-domain";
import { syncEntityUsages } from "./media/usage-index";
import { logger } from "../logger";
import type {
  Test,
  TestSection,
  TestScenario,
  Question,
  Topic,
  TopicCourse,
  TopicEvent,
  AdaptiveTopicSettings,
  AdaptiveLevel,
  AdaptiveLevelLink,
  Scale,
  QuestionMeasurement,
  ResultVariable,
  ContentPage,
  TestQuestionScoring,
  QuestionScoring,
  ReportBlockRow,
  TestSnapshot,
} from "@shared/schema";

/** The frozen deliverable of a test (stored as test_snapshots.content_json). */
export interface TestSnapshotContent {
  test: Test;
  sections: TestSection[];
  /** Full topic rows for the test's topics (name + feedback for SCORM export). */
  topics: Topic[];
  /** Full question pool per topic, keyed by topicId (the draw source). */
  questionsByTopic: Record<string, Question[]>;
  topicCoursesByTopic: Record<string, TopicCourse[]>;
  topicEventsByTopic: Record<string, TopicEvent[]>;
  adaptiveSettings: AdaptiveTopicSettings[];
  adaptiveLevels: AdaptiveLevel[];
  adaptiveLevelLinksByLevel: Record<string, AdaptiveLevelLink[]>;
  scales: Scale[];
  measurements: QuestionMeasurement[];
  resultVariables: ResultVariable[];
  contentPages: ContentPage[];
  /**
   * PRD-15 block D (FR-32): the test's per-question scoring overrides, frozen
   * RAW — delivery resolves them through the shared effective-scoring chain,
   * the same code path as live attempts. Absent in pre-block-D snapshots
   * (read as []).
   */
  questionScoring?: TestQuestionScoring[];
  /**
   * PRD-51: ДОКУМЕНТ ОТЧЁТА теста — строки `report_blocks` обоих режимов, как они были
   * на момент публикации.
   *
   * Замораживается по той же причине, по какой заморожен весь ряд теста: вместе с ним уже
   * заморожены выбор оболочки и значения её полей (`report_settings_json`). Оставить
   * состав документа живым значило бы печатать по старой попытке наполовину замороженный
   * отчёт — с прежним оформлением и нынешним набором разделов.
   *
   * Отсутствует в снапшотах, снятых раньше (читается как `[]`), и тогда документ берётся
   * по умолчанию шаблона.
   */
  reportBlocks?: ReportBlockRow[];
  /**
   * «Сценарий в ИС»: пункты-сценарии теста. Пул пункта — сценарии его темы, а тема уже лежит в
   * `questionsByTopic`. Отсутствует в снимках, снятых раньше (читается как `[]`).
   */
  scenarios?: TestScenario[];
}

/**
 * «Сценарий в ИС»: пункт-сценарий, каким его видит выдача, — раздел своей темы-банка, из
 * которого выдаётся ровно один вопрос.
 *
 * Тест «Сценарий» не заводит своего пути попытки: старт, завершение, итоги, отчёт и аналитика
 * работают с разделами, и пункт приходит к ним разделом. Синтез живёт в ОДНОМ месте — в
 * `getTestSections` источников данных ниже, — поэтому все читатели видят один и тот же раздел.
 * Своё у такого раздела только одно: пул. Его даёт {@link TestDataSource.getScenarioPool}, а
 * не `getQuestionsByTopic`: тот сценарии из выдачи отбрасывает (см. `isDeliverable`).
 */
export type ScenarioSection = TestSection & { scenarioItem: TestScenario };

/** Раздел, синтезированный из пункта-сценария. */
export function isScenarioSection(section: TestSection): section is ScenarioSection {
  return (section as Partial<ScenarioSection>).scenarioItem !== undefined;
}

/**
 * Пункт-сценарий как раздел выдачи: один вопрос из темы-банка.
 *
 * `topicId` раздела — КЛЮЧ ПУНКТА `scenario:<id>`, а не тема-банк: разделы попытки, правила
 * разблокировки и состояние хаба ключуются этим полем, и пункт на той же теме, что обычный раздел
 * теста, не должен с ним схлопнуться (`shared/test-items`). Тема-банк — в `scenarioItem.topicId`.
 */
export function scenarioSection(item: TestScenario): ScenarioSection {
  return {
    id: item.id,
    testId: item.testId,
    topicId: scenarioItemKey(item.id),
    drawCount: 1,
    drawAll: false,
    topicPassRuleJson: null,
    required: item.required,
    timeLimitMinutes: item.timeLimitMinutes,
    feedbackJson: null,
    drawBlueprintJson: null,
    formSetJson: null,
    breakdownFeedbackJson: null,
    interpretationJson: null,
    breakdownInterpretationJson: null,
    groupKey: null,
    questionOrder: null,
    defaultPoints: null,
    sortOrder: item.sortOrder,
    scenarioItem: item,
  };
}

/**
 * Имя раздела выдачи, которое видит участник: у темы — её название, у пункта-сценария —
 * название, заданное автором, иначе название темы-банка.
 *
 * @param topicName Название темы по идентификатору.
 */
export function deliverySectionName(section: TestSection, topicName: (topicId: string) => string | undefined): string {
  if (isScenarioSection(section)) {
    return section.scenarioItem.title?.trim() || topicName(section.scenarioItem.topicId) || "Сценарий";
  }
  return topicName(section.topicId) || "Unknown";
}

/**
 * Разделы выдачи теста — то, что видят старт, завершение и итоги.
 *
 * - тест «Сценарий» — его пункт;
 * - тест с роутером — разделы тем и пункты-сценарии, в порядке `router.itemOrder`;
 * - прочие — разделы тем. Пункты-сценарии в линейном потоке не выдаются: их место — хаб.
 */
export function deliverySections(test: Test, sections: TestSection[], scenarios: TestScenario[]): TestSection[] {
  // Тест «Сценарий» — один пункт: первый в порядке автора; остальные — пункты роутера, которые
  // ждут возврата теста к нему (FR-40).
  if (test.mode === "scenario") return scenarios.slice(0, 1).map(scenarioSection);
  const policy = resolveFlowPolicy(test.flowPolicyJson);
  if (policy.mode !== "router_by_topics" || scenarios.length === 0) return sections;
  const items = [
    ...sections.map((section) => ({ key: section.topicId, section })),
    ...scenarios.map((item) => ({ key: scenarioItemKey(item.id), section: scenarioSection(item) as TestSection })),
  ];
  return orderTestItems(items, policy.itemOrder).map((entry) => entry.section);
}

/**
 * Пул пункта-сценария: сценарии его темы; у фиксированной выдачи — только выбранный.
 * Прочие вопросы темы пункт не выдаёт (решение владельца, plan-tests.md раздел 1).
 */
export function scenarioPool(item: TestScenario, topicQuestions: Question[]): Question[] {
  return topicQuestions.filter(
    (question) => isSimulation(question.type) && (!item.questionId || question.id === item.questionId),
  );
}

/**
 * The read surface the attempt runtime needs. Both the snapshot facade and the
 * live-storage facade implement it, so attempts.ts can take a source without
 * knowing whether it is frozen or live.
 */
export interface TestDataSource {
  getTest(testId: string): Promise<Test | undefined>;
  /**
   * Разделы выдачи. В тесте «Сценарий» — его пункт-сценарий, синтезированный в раздел
   * ({@link scenarioSection}).
   */
  getTestSections(testId: string): Promise<TestSection[]>;
  /** «Сценарий в ИС»: пункты-сценарии теста. */
  getTestScenarios(testId: string): Promise<TestScenario[]>;
  /** «Сценарий в ИС»: пул пункта-сценария ({@link scenarioPool}). */
  getScenarioPool(item: TestScenario): Promise<Question[]>;
  getTopics(): Promise<Topic[]>;
  getTopic(topicId: string): Promise<Topic | undefined>;
  getQuestionsByTopic(topicId: string): Promise<Question[]>;
  getQuestionsByIds(ids: string[]): Promise<Question[]>;
  getTopicCourses(topicId: string): Promise<TopicCourse[]>;
  getTopicEvents(topicId: string): Promise<TopicEvent[]>;
  getAdaptiveTopicSettingsByTest(testId: string): Promise<AdaptiveTopicSettings[]>;
  getAdaptiveLevelsByTest(testId: string): Promise<AdaptiveLevel[]>;
  getAdaptiveLevelLinks(levelId: string): Promise<AdaptiveLevelLink[]>;
  getScales(testId: string): Promise<Scale[]>;
  getQuestionMeasurements(testId: string): Promise<QuestionMeasurement[]>;
  getResultVariables(testId: string): Promise<ResultVariable[]>;
  getContentPages(testId: string): Promise<ContentPage[]>;
  getTestQuestionScoring(testId: string): Promise<TestQuestionScoring[]>;
  /** PRD-51: строки документа отчёта для режима теста. */
  getReportBlocks(testId: string, mode: "standard" | "adaptive"): Promise<ReportBlockRow[]>;
}

/**
 * Assembles the frozen deliverable of a test from live storage. Called at
 * publish time (T-15). Adaptive config is only captured for adaptive tests.
 */
export async function buildSnapshotContent(testId: string): Promise<TestSnapshotContent | null> {
  const test = await storage.getTest(testId);
  if (!test) return null;

  // PRD-35: the domain of a scale must be inside the frozen version, not derived
  // later — a snapshot exists to keep the delivered artefacts reproducible (NFR-21).
  // This is the safety net for tests whose scales the author never opened in the
  // editor; it writes nothing when the bounds are already there.
  await materializeScaleDomains(testId);

  const [sections, allTopics, scales, measurements, resultVariables, contentPages, questionScoring, scenarios] =
    await Promise.all([
      storage.getTestSections(testId),
      storage.getTopics(),
      storage.getScales(testId),
      storage.getQuestionMeasurements(testId),
      storage.getResultVariables(testId),
      storage.getContentPages(testId),
      storage.getTestQuestionScoring(testId),
      storage.getTestScenarios(testId),
    ]);

  // PRD-51: документ отчёта морозится ОБОИМИ режимами. Тест хранит обе ветви
  // одновременно (как и `report_settings_json`), и смена режима после публикации не
  // должна оставлять снапшот без документа.
  const reportBlocks = [
    ...(await storage.listReportBlocks(testId, "standard")),
    ...(await storage.listReportBlocks(testId, "adaptive")),
  ];

  // Topics referenced by sections (plus any referenced by content pages).
  const topicIds = new Set<string>();
  for (const s of sections) topicIds.add(s.topicId);
  // «Сценарий в ИС»: тема-банк пункта — источник его пула.
  for (const item of scenarios) topicIds.add(item.topicId);
  for (const p of contentPages) if (p.topicId) topicIds.add(p.topicId);

  const topics = allTopics.filter((t) => topicIds.has(t.id));

  const questionsByTopic: Record<string, Question[]> = {};
  const topicCoursesByTopic: Record<string, TopicCourse[]> = {};
  const topicEventsByTopic: Record<string, TopicEvent[]> = {};
  /**
   * PRD-56 FR-17a: задания, исключённые из выдачи этого теста, в НОВУЮ публикацию не идут.
   *
   * Снимок фиксирует то, что тест выдаёт СЕЙЧАС, а сейчас он их не выдаёт: иначе автор
   * снимает вопрос, публикует тест и молча получает его обратно. Уже опубликованные версии
   * при этом не меняются — в этом и смысл снимка (PRD-15), и об этом говорит окно
   * подтверждения (FR-17b).
   */
  const excludedFromDelivery = new Set(
    (await storage.getTestQuestionScoring(testId))
      .filter(row => row.excludedFromDelivery)
      .map(row => row.questionId),
  );
  for (const topicId of topicIds) {
    questionsByTopic[topicId] = (await storage.getQuestionsByTopic(topicId))
      .filter(question => !excludedFromDelivery.has(question.id));
    topicCoursesByTopic[topicId] = await storage.getTopicCourses(topicId);
    topicEventsByTopic[topicId] = await storage.getTopicEvents(topicId);
  }

  let adaptiveSettings: AdaptiveTopicSettings[] = [];
  let adaptiveLevels: AdaptiveLevel[] = [];
  const adaptiveLevelLinksByLevel: Record<string, AdaptiveLevelLink[]> = {};
  if (test.mode === "adaptive") {
    [adaptiveSettings, adaptiveLevels] = await Promise.all([
      storage.getAdaptiveTopicSettingsByTest(testId),
      storage.getAdaptiveLevelsByTest(testId),
    ]);
    for (const level of adaptiveLevels) {
      adaptiveLevelLinksByLevel[level.id] = await storage.getAdaptiveLevelLinks(level.id);
    }
  }

  return {
    test,
    sections,
    topics,
    questionsByTopic,
    topicCoursesByTopic,
    topicEventsByTopic,
    adaptiveSettings,
    adaptiveLevels,
    adaptiveLevelLinksByLevel,
    scales,
    measurements,
    resultVariables,
    contentPages,
    questionScoring,
    reportBlocks,
    scenarios,
  };
}

/**
 * Creates the next snapshot for a test (version = latest + 1) and persists it.
 * Returns the new snapshot id, or null if the test is missing.
 */
export async function createTestSnapshot(
  testId: string,
  publishedBy: string | null,
): Promise<string | null> {
  const content = await buildSnapshotContent(testId);
  if (!content) return null;
  const latest = await storage.getLatestSnapshot(testId);
  const version = (latest?.version ?? 0) + 1;
  const row = await storage.createTestSnapshot({ testId, version, contentJson: content, publishedBy });

  // Медиатека: index the frozen deliverable NOW that it is fixed in the DB. Without
  // this, an asset that only survives inside the published snapshot (replaced or
  // removed from live content since) reads as an orphan and can be deleted out from
  // under an in-flight/delivered attempt (spec §8.2/§4.3). Best-effort like every
  // other save-path sync — a failed index write must not fail publication, since the
  // full re-sync (`reindexAllUsages`) is the safety net.
  try {
    await syncEntityUsages("snapshot", row.id, content);
  } catch (error) {
    logger.error(`Media usage sync failed for snapshot ${row.id}: ${(error as Error).message}`, "test-snapshot");
  }

  await pruneSnapshots(testId, row.id);
  return row.id;
}

/**
 * Retention (FR-17): keep the active snapshot plus any still referenced by an
 * attempt; delete the rest. Called after a new snapshot is created so stale
 * versions no in-flight attempt plays do not accumulate.
 */
export async function pruneSnapshots(testId: string, keepId: string): Promise<void> {
  const [all, referenced] = await Promise.all([
    storage.getSnapshotsForTest(testId),
    storage.getReferencedSnapshotIds(testId),
  ]);
  const keep = new Set<string>([keepId, ...referenced]);
  for (const snap of all) {
    if (keep.has(snap.id)) continue;
    await storage.deleteSnapshotById(snap.id);
    // Медиатека: the deleted snapshot's own usage rows have no FK cascade onto
    // `media_usages` (deliberate — see shared/schema.ts), so clear them here or
    // they dangle, pointing at a snapshot id that no longer exists.
    try {
      await syncEntityUsages("snapshot", snap.id, null);
    } catch (error) {
      logger.error(`Media usage sync failed for snapshot ${snap.id}: ${(error as Error).message}`, "test-snapshot");
    }
  }
}

/**
 * The questions of a topic a host may hand to a learner.
 *
 * Both sources below answer `getQuestionsByTopic` through it, and every delivery path — the web
 * start, the adaptive pool, the SCORM bake, the debug player — reads a topic through a source.
 * A type a host cannot play yet (see {@link isDeliverable}) therefore never reaches a learner,
 * from live content or from a snapshot published before the type existed.
 */
function deliverable(questions: Question[]): Question[] {
  return questions.filter((question) => isDeliverable(question.type));
}

/** A read source backed by live storage (drafts, preview, legacy attempts). */
export function liveDataSource(): TestDataSource {
  return {
    getTest: (id) => storage.getTest(id),
    getTestSections: async (id) => {
      const test = await storage.getTest(id);
      const sections = await storage.getTestSections(id);
      if (!test) return sections;
      // Пункты читаются только там, где они выдаются: в тесте «Сценарий» и в роутере.
      const usesItems = test.mode === "scenario" || resolveFlowPolicy(test.flowPolicyJson).mode === "router_by_topics";
      return deliverySections(test, sections, usesItems ? await storage.getTestScenarios(id) : []);
    },
    getTestScenarios: (id) => storage.getTestScenarios(id),
    getScenarioPool: async (item) => scenarioPool(item, await storage.getQuestionsByTopic(item.topicId)),
    getTopics: () => storage.getTopics(),
    getTopic: (id) => storage.getTopic(id),
    getQuestionsByTopic: async (id) => deliverable(await storage.getQuestionsByTopic(id)),
    getQuestionsByIds: (ids) => storage.getQuestionsByIds(ids),
    getTopicCourses: (id) => storage.getTopicCourses(id),
    getTopicEvents: (id) => storage.getTopicEvents(id),
    getAdaptiveTopicSettingsByTest: (id) => storage.getAdaptiveTopicSettingsByTest(id),
    getAdaptiveLevelsByTest: (id) => storage.getAdaptiveLevelsByTest(id),
    getAdaptiveLevelLinks: (id) => storage.getAdaptiveLevelLinks(id),
    getScales: (id) => storage.getScales(id),
    getQuestionMeasurements: (id) => storage.getQuestionMeasurements(id),
    getResultVariables: (id) => storage.getResultVariables(id),
    getContentPages: (id) => storage.getContentPages(id),
    getTestQuestionScoring: (id) => storage.getTestQuestionScoring(id),
    getReportBlocks: (id, mode) => storage.listReportBlocks(id, mode),
  };
}

/**
 * A read source backed by a frozen snapshot. Pure (no DB): every getter reads
 * the blob, so a published attempt is delivered and graded from exactly the
 * test state captured at publish. Getter signatures match {@link liveDataSource}
 * so the runtime is agnostic to the source.
 */
export function snapshotDataSource(content: TestSnapshotContent): TestDataSource {
  const allQuestions = Object.values(content.questionsByTopic).flat();
  const byId = new Map(allQuestions.map((q) => [q.id, q]));
  return {
    async getTest() {
      return content.test;
    },
    async getTestSections() {
      return deliverySections(content.test, content.sections, content.scenarios ?? []);
    },
    async getTestScenarios() {
      return content.scenarios ?? [];
    },
    async getScenarioPool(item) {
      return scenarioPool(item, content.questionsByTopic[item.topicId] ?? []);
    },
    async getTopics() {
      return content.topics;
    },
    async getTopic(topicId) {
      return content.topics.find((t) => t.id === topicId);
    },
    async getQuestionsByTopic(topicId) {
      return deliverable(content.questionsByTopic[topicId] ?? []);
    },
    async getQuestionsByIds(ids) {
      return ids.map((id) => byId.get(id)).filter((q): q is Question => !!q);
    },
    async getTopicCourses(topicId) {
      return content.topicCoursesByTopic[topicId] ?? [];
    },
    async getTopicEvents(topicId) {
      return content.topicEventsByTopic[topicId] ?? [];
    },
    async getAdaptiveTopicSettingsByTest() {
      return content.adaptiveSettings;
    },
    async getAdaptiveLevelsByTest() {
      return content.adaptiveLevels;
    },
    async getAdaptiveLevelLinks(levelId) {
      return content.adaptiveLevelLinksByLevel[levelId] ?? [];
    },
    async getScales() {
      return content.scales;
    },
    async getQuestionMeasurements() {
      return content.measurements;
    },
    async getResultVariables() {
      return content.resultVariables;
    },
    async getContentPages() {
      return content.contentPages;
    },
    async getTestQuestionScoring() {
      // Block-D+ snapshots froze the per-test overrides explicitly.
      if (content.questionScoring && content.questionScoring.length > 0) {
        return content.questionScoring;
      }
      // T-40 back-compat: a pre-block-D snapshot has no override rows, but its
      // frozen question rows still carry their own points/scoring_json in
      // content_json. The live resolver no longer reads those columns (they were
      // dropped), so synthesize override rows from the frozen values to grade a
      // pinned attempt EXACTLY as before the drop (the 0-change-for-pinned
      // invariant). The predicate mirrors migration 027/028: materialize points
      // only when they differ from the system default (NOT IN (0,1) — the old
      // `q.points || 1` coercion treated 0 as 1), and scoring whenever set.
      return synthesizeFrozenOverrides(content.test.id, allQuestions);
    },
    async getReportBlocks(_testId, mode) {
      // Снапшот заморозил ОБА режима одной пачкой — отбираем нужный. Пусто здесь значит
      // «снапшот снят до PRD-51 либо автор документа не собирал»: и в том, и в другом
      // случае печатается документ по умолчанию шаблона, а не пустой отчёт.
      return (content.reportBlocks ?? []).filter((r) => r.mode === mode);
    },
  };
}

/**
 * Reconstruct per-test scoring overrides from a pre-block-D snapshot's frozen
 * question rows (T-40 back-compat; see {@link snapshotDataSource}). Reads the
 * question's own points/scoring_json off the historical JSON via a loose cast —
 * the {@link Question} type no longer declares them after the column drop.
 */
function synthesizeFrozenOverrides(
  testId: string,
  questions: Question[],
): TestQuestionScoring[] {
  const rows: TestQuestionScoring[] = [];
  for (const q of questions) {
    const frozen = q as unknown as { points?: number | null; scoringJson?: QuestionScoring | null };
    const rawPoints = frozen.points;
    const points =
      typeof rawPoints === "number" && rawPoints !== 0 && rawPoints !== 1 ? rawPoints : null;
    const scoringJson = frozen.scoringJson ?? null;
    if (points === null && scoringJson === null) continue;
    rows.push({
      id: `frozen:${q.id}`,
      testId,
      questionId: q.id,
      points,
      scoringJson,
      // Difficulty stays on the question (not dropped); never overridden here.
      difficulty: null,
      // Pin to the frozen question so the resolver never marks it stale.
      pinnedContentHash: q.contentHash ?? null,
      // Задание, лежащее В СНИМКЕ, по определению не исключено из его выдачи: исключённые
      // в снимок не попадают (PRD-56 FR-17a), а уже опубликованный состав не меняется.
      excludedFromDelivery: false,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
  }
  return rows;
}

/**
 * Resolves the data source for an attempt: the pinned snapshot if the attempt
 * has one (published delivery), otherwise live storage (drafts, preview, legacy
 * attempts started before snapshots existed — the transitional mode).
 */
export async function dataSourceForAttempt(snapshotId: string | null): Promise<TestDataSource> {
  if (!snapshotId) return liveDataSource();
  const snap = await storage.getSnapshot(snapshotId);
  if (!snap) return liveDataSource();
  return snapshotDataSource(snap.contentJson as TestSnapshotContent);
}

/** What an export bakes from: the content source and the snapshot behind it, if any. */
export interface ExportSource {
  src: TestDataSource;
  /**
   * The snapshot the package is baked from, or `null` for a draft baked live.
   *
   * PRD-56 FR-19a: its VERSION travels into the package and from there into the LMS, so
   * a run played from the package can be told apart from a run played before the last
   * republish. A draft has no publication version, and inventing one would be the very
   * lie the version slice exists to prevent.
   */
  snapshot: TestSnapshot | null;
}

/**
 * Which version of a test an export is built from (stage E5, owner decision Р7 2026-10-05):
 * the published one — the active snapshot — or the current working draft.
 */
export type ExportVersion = "published" | "draft";

/** The published version was asked for, but the test has none. */
export class ExportVersionUnavailableError extends Error {
  constructor(message = "Тест не опубликован: выгрузить можно только текущий черновик") {
    super(message);
    this.name = "ExportVersionUnavailableError";
  }
}

/**
 * The published version of a test: its active snapshot, if the test is published and has one.
 * Archived tests and drafts have no published version to export — even with an old snapshot.
 *
 * @param testId test
 * @returns the snapshot, or `null`
 */
export async function publishedSnapshotOf(testId: string): Promise<TestSnapshot | null> {
  const test = await storage.getTest(testId);
  if (test?.status !== "published") return null;
  return (await storage.getLatestSnapshot(testId)) ?? null;
}

/**
 * Resolves the data source for SCORM EXPORT (PRD-15 FR-16). A published test
 * exports from its active snapshot — the package then matches exactly what the
 * web delivers, even if the working draft has drifted. Drafts (no snapshot)
 * export from live storage (preview-style).
 *
 * Stage E5: the author may choose the version explicitly. `draft` always bakes live storage;
 * `published` requires a published version and throws {@link ExportVersionUnavailableError}
 * otherwise — silently falling back to the draft would hand out a package nobody asked for.
 *
 * @param testId test
 * @param version explicit version; omitted — the snapshot-aware default above
 */
export async function exportSourceForTest(testId: string, version?: ExportVersion): Promise<ExportSource> {
  if (version === "draft") return { src: liveDataSource(), snapshot: null };
  const snap = await publishedSnapshotOf(testId);
  if (snap) {
    return { src: snapshotDataSource(snap.contentJson as TestSnapshotContent), snapshot: snap };
  }
  if (version === "published") throw new ExportVersionUnavailableError();
  return { src: liveDataSource(), snapshot: null };
}

/** Publication state of a test for the author UI (PRD-15 FR-12). */
export type PublicationState = "draft" | "published" | "published_with_changes" | "archived";

export interface PublicationStatus {
  state: PublicationState;
  /** The test itself was edited after publish (version bumped past the snapshot). */
  editedAfterPublish: boolean;
  /** A topic the test draws from gained/lost/edited questions since publish. */
  poolDrift: boolean;
}

/** A stable signature of a topic's pool: sorted `id:contentHash` pairs. */
function poolSignature(questions: Array<{ id: string; contentHash?: string | null }>): string {
  return questions
    .map((q) => `${q.id}:${q.contentHash ?? ""}`)
    .sort()
    .join("|");
}

/**
 * Computes the publication state of a test (PRD-15 FR-12). A published test
 * shows "published_with_changes" when its working version diverged from the
 * active snapshot — either the test was edited (version bumped) or a topic it
 * draws from drifted (questions added/removed/edited, compared by contentHash).
 * Drafts/archived map straight through; a published test without a snapshot
 * (transitional) reports plain "published".
 */
export async function getPublicationState(testId: string): Promise<PublicationStatus> {
  const test = await storage.getTest(testId);
  const none: PublicationStatus = { state: "draft", editedAfterPublish: false, poolDrift: false };
  if (!test) return none;
  if (test.status !== "published") {
    return { state: test.status as PublicationState, editedAfterPublish: false, poolDrift: false };
  }

  const snap = await storage.getLatestSnapshot(testId);
  if (!snap) {
    // Transitional: published before snapshots existed (or build pending).
    return { state: "published", editedAfterPublish: false, poolDrift: false };
  }
  const content = snap.contentJson as TestSnapshotContent;

  const editedAfterPublish = (test.version ?? 1) > (content.test.version ?? 1);

  let poolDrift = false;
  const topicIds = new Set(content.sections.map((s) => s.topicId));
  for (const topicId of topicIds) {
    const live = await storage.getQuestionsByTopic(topicId);
    const frozen = content.questionsByTopic[topicId] ?? [];
    if (poolSignature(live) !== poolSignature(frozen)) {
      poolDrift = true;
      break;
    }
  }

  const state: PublicationState =
    editedAfterPublish || poolDrift ? "published_with_changes" : "published";
  return { state, editedAfterPublish, poolDrift };
}
