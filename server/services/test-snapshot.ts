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

import { storage } from "../storage";
import { materializeScaleDomains } from "./scale-domain";
import type {
  Test,
  TestSection,
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
}

/**
 * The read surface the attempt runtime needs. Both the snapshot facade and the
 * live-storage facade implement it, so attempts.ts can take a source without
 * knowing whether it is frozen or live.
 */
export interface TestDataSource {
  getTest(testId: string): Promise<Test | undefined>;
  getTestSections(testId: string): Promise<TestSection[]>;
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

  const [sections, allTopics, scales, measurements, resultVariables, contentPages, questionScoring] =
    await Promise.all([
      storage.getTestSections(testId),
      storage.getTopics(),
      storage.getScales(testId),
      storage.getQuestionMeasurements(testId),
      storage.getResultVariables(testId),
      storage.getContentPages(testId),
      storage.getTestQuestionScoring(testId),
    ]);

  // Topics referenced by sections (plus any referenced by content pages).
  const topicIds = new Set<string>();
  for (const s of sections) topicIds.add(s.topicId);
  for (const p of contentPages) if (p.topicId) topicIds.add(p.topicId);

  const topics = allTopics.filter((t) => topicIds.has(t.id));

  const questionsByTopic: Record<string, Question[]> = {};
  const topicCoursesByTopic: Record<string, TopicCourse[]> = {};
  const topicEventsByTopic: Record<string, TopicEvent[]> = {};
  for (const topicId of topicIds) {
    questionsByTopic[topicId] = await storage.getQuestionsByTopic(topicId);
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
    if (!keep.has(snap.id)) await storage.deleteSnapshotById(snap.id);
  }
}

/** A read source backed by live storage (drafts, preview, legacy attempts). */
export function liveDataSource(): TestDataSource {
  return {
    getTest: (id) => storage.getTest(id),
    getTestSections: (id) => storage.getTestSections(id),
    getTopics: () => storage.getTopics(),
    getTopic: (id) => storage.getTopic(id),
    getQuestionsByTopic: (id) => storage.getQuestionsByTopic(id),
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
      return content.sections;
    },
    async getTopics() {
      return content.topics;
    },
    async getTopic(topicId) {
      return content.topics.find((t) => t.id === topicId);
    },
    async getQuestionsByTopic(topicId) {
      return content.questionsByTopic[topicId] ?? [];
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

/**
 * Resolves the data source for SCORM EXPORT (PRD-15 FR-16). A published test
 * exports from its active snapshot — the package then matches exactly what the
 * web delivers, even if the working draft has drifted. Drafts (no snapshot)
 * export from live storage (preview-style).
 */
export async function exportSourceForTest(testId: string): Promise<TestDataSource> {
  const test = await storage.getTest(testId);
  if (test?.status === "published") {
    const snap = await storage.getLatestSnapshot(testId);
    if (snap) return snapshotDataSource(snap.contentJson as TestSnapshotContent);
  }
  return liveDataSource();
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
