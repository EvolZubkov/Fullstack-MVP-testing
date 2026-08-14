/**
 * @module server/services/test-transfer/target
 *
 * Reads THIS installation into the snapshot the decision core compares against.
 *
 * Kept apart from `diff.ts` on purpose: the decisions must stay pure and testable by table,
 * so everything that knows about the database lives here. The snapshot carries only what a
 * decision needs — identifiers and the author's handles — never payloads: the payload of an
 * imported row always comes from the package.
 *
 * The lookup is by the package's identifiers, because the import keeps them (PRD-48 §2.4).
 * A test that is not here at all yields an empty snapshot, and every operation becomes a
 * creation.
 */
import { storage } from "../../storage";
import type { TestTransferPackage } from "./package";
import type { TargetSnapshot } from "./diff";

/** Builds the snapshot of the receiving installation for one package. */
export async function buildTargetSnapshot(
  pkg: TestTransferPackage,
  opts: { ownerId: string },
): Promise<TargetSnapshot> {
  const content = pkg.content;
  const testId = (content.test as unknown as { id: string }).id;

  const test = await storage.getTest(testId);

  const [
    sections,
    scales,
    measurements,
    resultVariables,
    contentPages,
    questionScoring,
    adaptiveSettings,
    adaptiveLevels,
    answered,
  ] = test
    ? await Promise.all([
        storage.getTestSections(testId),
        storage.getScales(testId),
        storage.getQuestionMeasurements(testId),
        storage.getResultVariables(testId),
        storage.getContentPages(testId),
        storage.getTestQuestionScoring(testId),
        storage.getAdaptiveTopicSettingsByTest(testId),
        storage.getAdaptiveLevelsByTest(testId),
        storage.getAnsweredQuestionIds(testId),
      ])
    : [[], [], [], [], [], [], [], [], []];

  const adaptiveLevelLinks: Array<{ id: string }> = [];
  for (const level of adaptiveLevels) {
    adaptiveLevelLinks.push(...(await storage.getAdaptiveLevelLinks(level.id)));
  }

  // Topics are looked up ONE BY ONE by the package's identifiers: a topic is a shared
  // resource and may well exist here without belonging to this test.
  const topics: TargetSnapshot["topics"] = [];
  for (const packaged of content.topics ?? []) {
    const here = await storage.getTopic(packaged.id);
    if (!here) continue;
    const questions = await storage.getQuestionsByTopic(here.id);
    topics.push({
      id: here.id,
      name: here.name,
      questions: questions.map((q) => ({ id: q.id, prompt: q.prompt })),
    });
  }

  // Names this owner already holds: `(owner_id, name_normalized)` is unique, so a topic the
  // import creates may have to be renamed, and the PLAN must show the name it will get.
  const owned = (await storage.getTopics()).filter((t) => t.ownerId === opts.ownerId);

  return {
    test: test ? { id: test.id } : null,
    sections: sections.map((s) => ({ id: s.id, topicId: s.topicId })),
    topics,
    scales: scales.map((s) => ({ id: s.id, key: s.key, label: s.label })),
    measurements: measurements.map((m) => ({
      id: m.id,
      questionId: m.questionId,
      scaleId: m.scaleId,
    })),
    resultVariables: resultVariables.map((v) => ({ id: v.id, name: v.name })),
    contentPages: contentPages.map((p) => ({ id: p.id, kind: p.kind })),
    questionScoring: questionScoring.map((s) => ({ id: s.id, questionId: s.questionId })),
    adaptiveSettings: adaptiveSettings.map((s) => ({ id: s.id })),
    adaptiveLevels: adaptiveLevels.map((l) => ({ id: l.id })),
    adaptiveLevelLinks,
    questionsUsedInAttempts: new Set(answered as string[]),
    takenTopicNames: owned.map((t) => t.name),
  };
}
