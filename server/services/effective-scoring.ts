/**
 * @module server/services/effective-scoring
 *
 * Per-test wiring of the pure effective-scoring resolver (PRD-15 block D,
 * FR-32; shared/scoring/effective-scoring). Loads the three test-side chain
 * sources once — the test row (test default), its sections (section defaults
 * by topic) and the per-question override rows (`test_question_scoring`) —
 * and exposes a synchronous per-question resolution context.
 *
 * One context serves every consumer of a test's effective scoring: the web
 * grading paths (attempt finish, adaptive answer), the adaptive draw
 * (effective difficulty, FR-34), the SCORM bake, the analytics recompute and
 * the editor's maxPoints summary. The source is a {@link TestScoringSource} —
 * live storage or a publication snapshot (block B) — so live and frozen
 * attempts share one resolution path.
 *
 * Transitional (until T-40 drops the question columns): the question's own
 * `points`/`scoringJson` feed the resolver's `legacy` link as `q.points || 1`
 * — the exact coercion every runtime applied before block D (an explicit 0
 * behaved as 1), keeping pre-backfill behaviour bit-identical (BRC-26). A real
 * zero price is expressible through an override (`points: 0`).
 */

import {
  resolveEffectiveScoring,
  resolveEffectiveDifficulty,
  type EffectiveScoring,
} from "@shared/scoring/effective-scoring";
import type { Question, Test, TestSection, TestQuestionScoring } from "@shared/schema";

/** The chain sources reader — live storage or a snapshot data source. */
export interface TestScoringSource {
  getTest(testId: string): Promise<Test | undefined>;
  getTestSections(testId: string): Promise<TestSection[]>;
  getTestQuestionScoring(testId: string): Promise<TestQuestionScoring[]>;
}

/** Synchronous per-question resolution over one test's loaded chain sources. */
export interface TestScoringContext {
  /** Effective price + graded config of `question` inside this test. */
  resolve(question: Question): EffectiveScoring;
  /** Effective difficulty (per-test override wins over the base, FR-34). */
  difficultyOf(question: Question): number;
  /** The raw override row, if any (editor/staleness surfaces). */
  overrideFor(questionId: string): TestQuestionScoring | undefined;
}

/**
 * Builds the context from already-loaded rows (pure; unit-testable without a
 * DB). Section defaults are keyed by topicId — a question's section is the
 * test's section on its topic.
 */
export function buildTestScoringContext(
  test: Pick<Test, "defaultQuestionPoints"> | undefined,
  sections: Array<Pick<TestSection, "topicId" | "defaultPoints">>,
  overrides: TestQuestionScoring[],
): TestScoringContext {
  const overrideByQuestion = new Map(overrides.map((row) => [row.questionId, row]));
  const sectionDefaultByTopic = new Map(sections.map((s) => [s.topicId, s.defaultPoints]));
  const testDefaultPoints = test?.defaultQuestionPoints ?? null;

  return {
    resolve(question: Question): EffectiveScoring {
      const override = overrideByQuestion.get(question.id);
      return resolveEffectiveScoring({
        override: override
          ? {
              points: override.points,
              scoring: override.scoringJson,
              difficulty: override.difficulty,
              pinnedContentHash: override.pinnedContentHash,
            }
          : null,
        defaults: {
          sectionDefaultPoints: sectionDefaultByTopic.get(question.topicId) ?? null,
          testDefaultPoints,
        },
        // Transitional legacy link (see the module header): `|| 1` reproduces
        // the pre-block-D runtime coercion exactly, explicit 0 included.
        legacy: { points: question.points || 1, scoring: question.scoringJson ?? null },
        questionContentHash: question.contentHash ?? null,
      });
    },

    difficultyOf(question: Question): number {
      const override = overrideByQuestion.get(question.id);
      return resolveEffectiveDifficulty(override?.difficulty, question.difficulty);
    },

    overrideFor(questionId: string): TestQuestionScoring | undefined {
      return overrideByQuestion.get(questionId);
    },
  };
}

/** Loads the chain sources of one test and builds its resolution context. */
export async function loadTestScoringContext(
  testId: string,
  src: TestScoringSource,
): Promise<TestScoringContext> {
  const [test, sections, overrides] = await Promise.all([
    src.getTest(testId),
    src.getTestSections(testId),
    src.getTestQuestionScoring(testId),
  ]);
  return buildTestScoringContext(test, sections ?? [], overrides ?? []);
}
