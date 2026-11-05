/**
 * @module server/services/scoring-warnings
 * @description Publication warnings about a test's answer scoring. Today it holds one rule,
 * {@link weightedReferenceMismatch}: a single/scale question scored by «Веса опций» whose
 * largest weight sits on another option than the one marked correct. Like
 * `breakdown-warnings.ts` it only speaks — publication never stops on it.
 *
 * Weighted scoring lives only in the per-test override rows (`test_question_scoring`):
 * section and test defaults carry a price, never a method. So the rule walks the override
 * rows, not the whole bank, and skips questions whose topic no longer belongs to the test.
 */
import { storage } from "../storage";
import { weightedReferenceMismatch, type ScoringWarning } from "@shared/scoring/reference-mismatch";

export type { ScoringWarning };

/** Longest excerpt of the prompt the message quotes. */
const EXCERPT_LENGTH = 60;

/** The prompt as one short line of text: tags and entities dropped, whitespace collapsed. */
function excerptOf(prompt: string | null | undefined): string {
  const text = (prompt ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH).trimEnd()}…` : text;
}

/**
 * Gather the scoring warnings of one test.
 *
 * @param testId test
 * @returns the warnings, ordered as the topics appear in the test; empty when there are none
 */
export async function assessScoringPublish(testId: string): Promise<ScoringWarning[]> {
  const overrides = (await storage.getTestQuestionScoring(testId)).filter(
    (row) => row.scoringJson?.kind === "weighted",
  );
  if (overrides.length === 0) return [];

  // The test's topics in delivery order: sections first, then adaptive topics.
  const sections = await storage.getTestSections(testId);
  const adaptive = await storage.getAdaptiveTopicSettingsByTest(testId);
  const topicOrder = [...sections.map((s) => s.topicId), ...adaptive.map((a) => a.topicId)];
  const rank = new Map<string, number>();
  topicOrder.forEach((id) => { if (!rank.has(id)) rank.set(id, rank.size); });

  const questions = await storage.getQuestionsByIds(overrides.map((row) => row.questionId));
  const byId = new Map(questions.map((q) => [q.id, q]));
  const topicNames = new Map<string, string>();

  const found: ScoringWarning[] = [];
  for (const row of overrides) {
    const question = byId.get(row.questionId);
    if (!question || !rank.has(question.topicId)) continue;
    const mismatch = weightedReferenceMismatch(
      question.type,
      question.correctJson as { correctIndex?: unknown } | null,
      row.scoringJson,
    );
    if (!mismatch) continue;
    if (!topicNames.has(question.topicId)) {
      topicNames.set(question.topicId, (await storage.getTopic(question.topicId))?.name ?? "");
    }
    found.push({
      code: "weighted_reference_mismatch",
      topicId: question.topicId,
      topicName: topicNames.get(question.topicId) ?? "",
      questionId: question.id,
      questionExcerpt: excerptOf(question.prompt),
      ...mismatch,
    });
  }
  return found.sort((a, b) => (rank.get(a.topicId) ?? 0) - (rank.get(b.topicId) ?? 0));
}
