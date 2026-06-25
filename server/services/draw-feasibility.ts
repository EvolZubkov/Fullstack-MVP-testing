/**
 * @module server/services/draw-feasibility
 *
 * Referential protection for shared content (PRD-15 block A, FR-04/FR-05;
 * BRD BRC-15/BRC-16; audit matrix E-1..E-13). Wraps the pure feasibility core
 * (shared/draw/feasibility) with data access: given a proposed mutation of a
 * topic or of questions, it gathers every dependent test (sections drawing
 * from the topic, adaptive levels, scale contributions) and returns the
 * assessment split by the PRD-15 policy:
 *
 * - `blocking` — published dependents with non-advisory issues; the route
 *   answers `409 content_in_use` unless an administrator forces the action;
 * - `warnings` — draft dependents and advisory issues (`draw_all_shrink`);
 *   surfaced to the author, never blocking.
 *
 * Entry points used by the routes (plan T-07) and by import/publication
 * integrations (T-08):
 * - {@link assessTopicDeletion}    — deleting a whole topic (E-2);
 * - {@link assessQuestionsRemoval} — deleting questions, possibly across
 *   topics (E-1/E-3/E-4/E-5/E-9);
 * - {@link assessQuestionChange}   — re-tagging or difficulty change of one
 *   question (E-3/E-4).
 */

import {
  checkDrawFeasibility,
  type DependentTestRequirement,
  type FeasibilityQuestion,
  type TestFeasibility,
} from "@shared/draw/feasibility";
import { tagKey } from "@shared/tags";
import { storage, type TestUsageRef } from "../storage";
import type { Question, TestSection } from "@shared/schema";

/** Describes the proposed change for the formula-loss pass (E-6). */
interface TagMutation {
  deletedTopicIds?: Set<string>;
  removedQuestionIds?: Set<string>;
  changedQuestion?: { id: string; tags: string[] };
}

/** Tags referenced by a result-variable formula: `tag("name")` / `tag('name')`. */
function extractFormulaTags(formula: string): string[] {
  const tags: string[] = [];
  const re = /tag\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula)) !== null) tags.push(m[1]);
  return tags;
}

/**
 * Pre- and post-mutation tag inventories across all of a test's section
 * topics (normalized keys). A tag in `before \ after` was emptied by the
 * mutation — the basis for the formula-loss check (E-6).
 */
async function tagInventories(
  testId: string,
  mutation: TagMutation,
): Promise<{ before: Set<string>; after: Set<string> }> {
  const before = new Set<string>();
  const after = new Set<string>();
  const sections = await storage.getTestSections(testId);
  for (const section of sections) {
    const questions = await storage.getQuestionsByTopic(section.topicId);
    const topicDeleted = mutation.deletedTopicIds?.has(section.topicId) ?? false;
    for (const q of questions) {
      const beforeTags = (q.tags ?? []).map(tagKey);
      beforeTags.forEach((t) => before.add(t));
      if (topicDeleted) continue;
      if (mutation.removedQuestionIds?.has(q.id)) continue;
      const effTags =
        mutation.changedQuestion?.id === q.id
          ? mutation.changedQuestion.tags.map(tagKey)
          : beforeTags;
      effTags.forEach((t) => after.add(t));
    }
  }
  return { before, after };
}

/**
 * Result-variable labels (PRD-2) whose formula references a tag the mutation
 * empties for this test (audit E-6). Only tags that existed before and are
 * gone after are considered, so a formula referencing an already-empty tag is
 * not falsely flagged.
 */
async function formulaLossForTest(testId: string, mutation: TagMutation): Promise<string[]> {
  const variables = await storage.getResultVariables(testId);
  if (variables.length === 0) return [];
  const { before, after } = await tagInventories(testId, mutation);
  const emptied = new Set([...before].filter((t) => !after.has(t)));
  if (emptied.size === 0) return [];
  const lost: string[] = [];
  for (const v of variables) {
    const refs = extractFormulaTags(v.formula).map(tagKey);
    if (refs.some((t) => emptied.has(t))) lost.push(v.label || v.name);
  }
  return lost;
}

/** Attaches E-6 formula-loss variable names to each dependent requirement. */
async function attachFormulaLoss(
  requirements: DependentTestRequirement[],
  mutation: TagMutation,
): Promise<void> {
  for (const req of requirements) {
    const lost = await formulaLossForTest(req.testId, mutation);
    if (lost.length > 0) req.formulaLossVariableNames = lost;
  }
}

/** Assessment split by the PRD-15 policy (published block / draft warn). */
export interface FeasibilityAssessment {
  blocking: TestFeasibility[];
  warnings: TestFeasibility[];
}

export const EMPTY_ASSESSMENT: FeasibilityAssessment = { blocking: [], warnings: [] };

function toPoolQuestion(q: Question): FeasibilityQuestion {
  return { id: q.id, tags: q.tags ?? [], difficulty: q.difficulty };
}

/**
 * PRD-17 (FR-10): the distinct question ids referenced by any fixed variant of a
 * section, or null when the section isn't in variants mode. Feeds the core's
 * `variant_incomplete` check (a variant question gone from the pool).
 */
function variantQuestionIdsOf(section: TestSection | undefined): string[] | null {
  if (!section?.formSetJson) return null;
  return [...new Set(section.formSetJson.forms.flatMap((f) => f.questionIds))];
}

/** Published + non-advisory -> blocking; everything else -> warning. */
function applyPolicy(results: TestFeasibility[]): FeasibilityAssessment {
  const blocking: TestFeasibility[] = [];
  const warnings: TestFeasibility[] = [];
  for (const result of results) {
    const hasHardIssue = result.issues.some((issue) => !("advisory" in issue && issue.advisory));
    if (result.status === "published" && hasHardIssue) blocking.push(result);
    else warnings.push(result);
  }
  return { blocking, warnings };
}

/** Merges per-topic results so a test depending on several topics appears once. */
function mergeByTest(results: TestFeasibility[]): TestFeasibility[] {
  const merged = new Map<string, TestFeasibility>();
  for (const result of results) {
    const existing = merged.get(result.testId);
    if (existing) existing.issues.push(...result.issues);
    else merged.set(result.testId, { ...result, issues: [...result.issues] });
  }
  return [...merged.values()];
}

/**
 * Collects the dependent-test requirements of one topic: its sections, the
 * adaptive levels of adaptive dependents, and scale contributions of the
 * removed questions (including tests that no longer draw from the topic but
 * still hold measurements).
 */
async function buildRequirements(
  topicId: string,
  removedIds: readonly string[],
  options: { includeTopicPages?: boolean } = {},
): Promise<DependentTestRequirement[]> {
  const [usage, sections] = await Promise.all([
    storage.getTestsUsingTopic(topicId),
    storage.getTestSectionsByTopic(topicId),
  ]);
  const sectionByTest = new Map(sections.map((s) => [s.testId, s]));

  const measurementRows = await storage.getMeasurementsForQuestions([...removedIds]);
  const measurementsByTest = new Map<string, string[]>();
  for (const row of measurementRows) {
    const list = measurementsByTest.get(row.testId) ?? [];
    list.push(row.questionId);
    measurementsByTest.set(row.testId, list);
  }

  // Topic-scoped content pages die with the topic (audit F-4) — only relevant
  // when the whole topic is being deleted.
  const pagesByTest = new Map<string, number>();
  if (options.includeTopicPages) {
    for (const row of await storage.getTopicPageRefs(topicId)) {
      pagesByTest.set(row.testId, (pagesByTest.get(row.testId) ?? 0) + 1);
    }
  }

  // Tests depending only via measurements or topic pages (no section).
  const usageIds = new Set(usage.map((t) => t.id));
  const extraRefs: TestUsageRef[] = [];
  for (const testId of new Set([...measurementsByTest.keys(), ...pagesByTest.keys()])) {
    if (usageIds.has(testId)) continue;
    const test = await storage.getTest(testId);
    if (test) {
      extraRefs.push({
        id: test.id,
        title: test.title,
        ownerId: test.ownerId,
        status: test.status,
        mode: test.mode,
      });
    }
  }

  const requirements: DependentTestRequirement[] = [];
  for (const ref of [...usage, ...extraRefs]) {
    const section = sectionByTest.get(ref.id);
    const adaptive =
      ref.mode === "adaptive" ? await storage.getAdaptiveLevels(ref.id, topicId) : [];
    requirements.push({
      testId: ref.id,
      title: ref.title,
      status: ref.status,
      ownerId: ref.ownerId,
      section: section
        ? {
            drawCount: section.drawCount,
            drawAll: section.drawAll,
            blueprint: section.drawBlueprintJson ?? null,
          }
        : null,
      // PRD-17 (FR-10): variants supersede the draw-count check in the core.
      variantQuestionIds: variantQuestionIdsOf(section),
      adaptiveLevels: adaptive.map((level) => ({
        levelIndex: level.levelIndex,
        levelName: level.levelName,
        minDifficulty: level.minDifficulty,
        maxDifficulty: level.maxDifficulty,
        questionsCount: level.questionsCount,
      })),
      measurementQuestionIds: measurementsByTest.get(ref.id) ?? [],
      topicPageCount: pagesByTest.get(ref.id) ?? 0,
      // PRD-15 block D (FR-34): adaptive level matching in the core uses the
      // EFFECTIVE difficulty — per-test overrides win over the base value.
      difficultyOverrides: adaptive.length > 0 ? await difficultyOverridesOf(ref.id) : null,
    });
  }
  return requirements;
}

/**
 * Per-test difficulty overrides (block D, FR-34): questionId -> effective
 * difficulty for this test. Null when the test overrides nothing — the core
 * then reads the questions' base difficulty.
 */
async function difficultyOverridesOf(testId: string): Promise<Record<string, number> | null> {
  const rows = await storage.getTestQuestionScoring(testId);
  const map: Record<string, number> = {};
  for (const row of rows) {
    if (typeof row.difficulty === "number") map[row.questionId] = row.difficulty;
  }
  return Object.keys(map).length > 0 ? map : null;
}

/** Feasibility of deleting a whole topic: the pool empties, all questions go. */
export async function assessTopicDeletion(topicId: string): Promise<FeasibilityAssessment> {
  const questions = await storage.getQuestionsByTopic(topicId);
  const removedIds = questions.map((q) => q.id);
  const tests = await buildRequirements(topicId, removedIds, { includeTopicPages: true });
  if (tests.length === 0) return EMPTY_ASSESSMENT;
  await attachFormulaLoss(tests, { deletedTopicIds: new Set([topicId]) });
  return applyPolicy(checkDrawFeasibility({ pool: [], removedQuestionIds: removedIds, tests }));
}

/**
 * Feasibility of deleting questions (single or bulk, possibly across topics):
 * each affected topic is checked against its post-removal pool.
 */
export async function assessQuestionsRemoval(
  questionIds: readonly string[],
): Promise<FeasibilityAssessment> {
  if (questionIds.length === 0) return EMPTY_ASSESSMENT;
  const removed = new Set(questionIds);
  const byTopic = new Map<string, string[]>();
  for (const id of questionIds) {
    const question = await storage.getQuestion(id);
    if (!question) continue;
    const list = byTopic.get(question.topicId) ?? [];
    list.push(id);
    byTopic.set(question.topicId, list);
  }

  const results: TestFeasibility[] = [];
  for (const [topicId, removedInTopic] of byTopic) {
    const pool = (await storage.getQuestionsByTopic(topicId))
      .filter((q) => !removed.has(q.id))
      .map(toPoolQuestion);
    const tests = await buildRequirements(topicId, removedInTopic);
    if (tests.length === 0) continue;
    await attachFormulaLoss(tests, { removedQuestionIds: removed });
    results.push(
      ...checkDrawFeasibility({ pool, removedQuestionIds: removedInTopic, tests }),
    );
  }
  return applyPolicy(mergeByTest(results));
}

/** Per-topic publish-time finding of one test (E-12 payload). */
export interface PublishCheckFinding {
  topicId: string;
  topicName: string;
  issues: TestFeasibility["issues"];
}

/**
 * Publish-time validation (E-12, FR-06): the flip side of the mutation checks.
 * Before a test goes `published`, every section is verified against the
 * CURRENT pools of its topics — draw count, blueprint quotas and adaptive
 * levels must be satisfiable right now. Advisory issues are filtered out:
 * only hard shortfalls should stop a publication.
 */
export async function assessTestPublish(testId: string): Promise<PublishCheckFinding[]> {
  const test = await storage.getTest(testId);
  if (!test) return [];
  const sections = await storage.getTestSections(testId);
  // PRD-15 block D (FR-34): publish-time adaptive checks must see the same
  // effective difficulty the delivery will use.
  const difficultyOverrides =
    test.mode === "adaptive" ? await difficultyOverridesOf(testId) : null;
  const findings: PublishCheckFinding[] = [];
  for (const section of sections) {
    const pool = (await storage.getQuestionsByTopic(section.topicId)).map(toPoolQuestion);
    const adaptive =
      test.mode === "adaptive" ? await storage.getAdaptiveLevels(testId, section.topicId) : [];
    const results = checkDrawFeasibility({
      pool,
      tests: [
        {
          testId: test.id,
          title: test.title,
          status: test.status,
          ownerId: test.ownerId,
          section: {
            drawCount: section.drawCount,
            drawAll: section.drawAll,
            blueprint: section.drawBlueprintJson ?? null,
          },
          // PRD-17 (FR-10): a published variant whose questions left the bank
          // blocks the publication (the variant can't be delivered whole).
          variantQuestionIds: variantQuestionIdsOf(section),
          adaptiveLevels: adaptive.map((level) => ({
            levelIndex: level.levelIndex,
            levelName: level.levelName,
            minDifficulty: level.minDifficulty,
            maxDifficulty: level.maxDifficulty,
            questionsCount: level.questionsCount,
          })),
          difficultyOverrides,
        },
      ],
    });
    const hardIssues = results
      .flatMap((r) => r.issues)
      .filter((issue) => !("advisory" in issue && issue.advisory));
    if (hardIssues.length > 0) {
      const topic = await storage.getTopic(section.topicId);
      findings.push({
        topicId: section.topicId,
        topicName: topic?.name ?? "Unknown",
        issues: hardIssues,
      });
    }
  }
  return findings;
}

/**
 * Feasibility of changing one question's draw-relevant content (tags and/or
 * difficulty): the pool is evaluated with the question's NEW values. Nothing
 * is removed, so scale contributions are unaffected (E-7 stays a warning at
 * the route level, not a feasibility issue).
 */
export async function assessQuestionChange(
  questionId: string,
  next: { tags?: string[]; difficulty?: number },
): Promise<FeasibilityAssessment> {
  const question = await storage.getQuestion(questionId);
  if (!question) return EMPTY_ASSESSMENT;
  const pool = (await storage.getQuestionsByTopic(question.topicId)).map((q) =>
    q.id === questionId
      ? {
          id: q.id,
          tags: next.tags ?? q.tags ?? [],
          difficulty: next.difficulty ?? q.difficulty,
        }
      : toPoolQuestion(q),
  );
  const tests = await buildRequirements(question.topicId, []);
  if (tests.length === 0) return EMPTY_ASSESSMENT;
  if (next.tags !== undefined) {
    await attachFormulaLoss(tests, { changedQuestion: { id: questionId, tags: next.tags } });
  }
  return applyPolicy(checkDrawFeasibility({ pool, tests }));
}
