/**
 * @module server/services/analytics/test-answer-facts
 * @description PRD-56: ответы теста, собранные ОДИН раз и для всех, кому они нужны.
 *
 * Факты ответов (`loadAnswerFacts`) сводят веб и LMS, но чтобы получить их, надо сначала
 * разрешить оценивание: эффективную стоимость задания внутри теста (PRD-15 блок D), правило
 * проверки ответа и то, что измерительное задание не оценивается вовсе (PRD-26 FR-08,
 * PRD-44 FR-09). Этот кусок жил внутри маршрута страницы теста, и он же понадобился развороту
 * строки среза по темам (FR-06e).
 *
 * Второй экземпляр этой логики разошёлся бы с первым на первой же правке правил оценивания —
 * а расходятся такие копии молча, расхождением ЧИСЕЛ на двух экранах, которое PRD-56 и взялся
 * убрать (FR-25). Поэтому сбор один, а кто как режет полученные факты — дело вызывающего.
 */

import type { Question } from "@shared/schema";
import { isMeasurementOnly } from "@shared/questions/question-type";
import { resolveOverallRule, resolveTopicRule, type ResolvedRule } from "@shared/scoring/pass-rule";

import { storage } from "../../storage";
import { outcomeFor } from "./answer-outcome";
import { loadTestScoringContext } from "../effective-scoring";
import { liveDataSource } from "../test-snapshot";
import { loadAnswerFacts, type AnswerFact } from "./answers";

/** Состав выданной формы прохождения — задания, которые человек ВИДЕЛ. */
export function variantQuestionIds(variantJson: unknown): string[] {
  const variant = variantJson as {
    sections?: Array<{ questionIds?: string[] }>;
    topics?: Array<{ levelsState?: Array<{ questionIds?: string[] }> }>;
  } | null;
  if (!variant) return [];

  const ids: string[] = [];
  for (const section of variant.sections ?? []) ids.push(...(section.questionIds ?? []));
  for (const topic of variant.topics ?? []) {
    for (const level of topic.levelsState ?? []) ids.push(...(level.questionIds ?? []));
  }
  return ids;
}

/** Веб-попытка в том виде, в каком её читает сбор ответов. */
export interface WebAttemptRow {
  id: string;
  variantJson?: unknown;
  answersJson?: unknown;
}

export interface TestAnswerFacts {
  facts: AnswerFact[];
  /** Задания, встреченные в выдаче или в ответах, по идентификатору. */
  questionById: Map<string, Question>;
  /** Название темы по идентификатору — подпись разрезов. */
  topicNameById: Map<string, string>;
  /** Порог темы, разрешённый правилом теста; отсутствие ключа значит «порога нет». */
  topicRules: Map<string, ResolvedRule | null>;
  /** Эффективная трудность задания: та же цепочка, что и у стоимости (PRD-15 блок D). */
  difficultyOf: (question: Question) => number | null;
  /**
   * Цена задания в этом тесте — та же цепочка, что оценивает ответы (переопределение в тесте →
   * цена раздела → цена теста). `null` у измерительного задания: баллов оно не приносит, и
   * «цена 1» у опросного пункта читалась бы как вклад в результат, которого нет.
   */
  pointsOf: (question: Question) => number | null;
}

/**
 * Собрать ответы теста из обоих источников вместе со справочниками разрезов.
 *
 * @param testId тест
 * @param attempts завершённые веб-попытки теста — их ответы разбираются здесь же
 */
export async function loadTestAnswerFacts(
  testId: string,
  attempts: readonly WebAttemptRow[],
): Promise<TestAnswerFacts> {
  // Задание, выданное только пакетом, в вариантах веб-попыток не встречается — без ответов
  // из LMS оно потерялось бы молча (FR-25).
  const questionIds = new Set<string>();
  for (const attempt of attempts) {
    for (const questionId of variantQuestionIds(attempt.variantJson)) questionIds.add(questionId);
  }
  const lmsAnswers = await storage.selectAnswersForTest(testId);
  for (const answer of lmsAnswers) questionIds.add(answer.questionId);

  const [questions, topics, test, sections, scoring] = await Promise.all([
    storage.getQuestionsByIds(Array.from(questionIds)),
    storage.getTopics(),
    storage.getTest(testId),
    storage.getTestSections(testId),
    // «Сценарий в ИС»: разделы — из источника выдачи, с разделами пунктов-сценариев, чтобы балл
    // пункта по умолчанию отвечал за его сценарии, как при оценке попытки.
    loadTestScoringContext(testId, liveDataSource()),
  ]);

  const questionById = new Map(questions.map(q => [q.id, q]));
  const overallRule = resolveOverallRule(test?.overallPassRuleJson);
  const topicRules = new Map(sections.map(section => [
    section.topicId,
    resolveTopicRule(section.topicPassRuleJson, overallRule),
  ]));

  const facts = await loadAnswerFacts(testId, {
    attempts: attempts as Parameters<typeof loadAnswerFacts>[1]["attempts"],
    grade: (questionId, answer, attemptResult) => {
      const question = questionById.get(questionId);
      // Задания в тесте больше нет — оценивать нечем, и придумывать исход не из чего.
      if (!question) return null;
      // PRD-57 (#43): исход берётся из попытки, а считается только у старых попыток, где
      // его не сохранили. Неоцениваемость определяется ПРИЗНАКОМ: перечень типов здесь
      // назвал бы короткий ответ без правил неверным (§5.3).
      const effective = scoring.resolve(question);
      const outcome = outcomeFor(attemptResult, questionId, question, answer, effective);
      if (outcome === null) return null;
      return {
        result: outcome.result,
        earnedPoints: outcome.result === "neutral" ? null : outcome.earned,
        possiblePoints: outcome.result === "neutral" ? null : outcome.possible,
      };
    },
  });

  return {
    facts,
    questionById,
    topicNameById: new Map(topics.map(t => [t.id, t.name])),
    topicRules,
    difficultyOf: question => scoring.difficultyOf(question),
    pointsOf: question => (isMeasurementOnly(question) ? null : scoring.resolve(question).points),
  };
}
