/**
 * @module server/services/breakdown-warnings
 * @description PRD-50 FR-45 - FR-47 и FR-56: gathers what {@link checkBreakdownPublish}
 * judges — the sections, their delivery config, the topics' current pools and the two
 * test-level breakdown settings — and returns the publication warnings of one test. The mirror of `assessTestPublish`
 * (`draw-feasibility.ts`) with the opposite policy: that one BLOCKS an infeasible draw,
 * this one only speaks. Adaptive tests deliver by difficulty levels, not by sections with
 * quotas and variants, so they are out of scope and answer with an empty list.
 */
import { storage } from "../storage";
import {
  checkBreakdownPublish,
  type BreakdownPublishSection,
  type BreakdownWarning,
} from "@shared/breakdown/publish-warnings";

export async function assessBreakdownPublish(testId: string): Promise<BreakdownWarning[]> {
  const test = await storage.getTest(testId);
  if (!test || test.mode !== "standard") return [];
  const sections = await storage.getTestSections(testId);
  const input: BreakdownPublishSection[] = [];
  for (const s of sections) {
    const topic = await storage.getTopic(s.topicId);
    const questions = await storage.getQuestionsByTopic(s.topicId);
    input.push({
      topicId: s.topicId,
      topicName: topic?.name ?? "Unknown",
      drawCount: s.drawCount,
      drawAll: s.drawAll,
      blueprint: s.drawBlueprintJson ?? null,
      variants: s.formSetJson?.forms ?? null,
      questions: questions.map((q) => ({ id: q.id, tags: q.tags ?? [] })),
    });
  }
  return checkBreakdownPublish({
    sections: input,
    breakdownGateEnabled: test.breakdownGateEnabled === true,
    // Отсутствие настройки = подытоги скрыты: ровно то, что печатает тест, который её не
    // трогал (FR-13).
    breakdownVisible: !!test.breakdownDisplayJson && test.breakdownDisplayJson.visibility !== "hidden",
  });
}
