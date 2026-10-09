/**
 * @module server/services/analytics/slice-topics
 * @description PRD-56 FR-06, FR-06e: доли верных ответов по темам ВНУТРИ среза.
 *
 * Отвечает на «в какой теме провал у этих людей». Один сбор ответов теста обслуживает сколько
 * угодно срезов: факты собираются по тесту целиком и режутся принадлежностью прохождения срезу.
 * Второго разбора ответов в продукте быть не должно — иначе «верно» стало бы считаться в двух
 * местах по-своему, и список срезов начал бы спорить с их разворотом (FR-25).
 *
 * Модуль намеренно ничего не сравнивает: сравнение срезов — отдельный режим вкладки.
 */

import { storage } from "../../storage";

import type { Observation } from "./observations";
import { loadTestAnswerFacts } from "./test-answer-facts";
import { summariseTopics, type TopicStatsRow } from "./topic-stats";

/** Тема среза в том виде, в каком её показывают экраны срезов. */
export interface SliceTopicRow {
  topicId: string;
  topicName: string;
  /** Доля верных ОТВЕТОВ темы; `null` — оценивать было нечего. */
  correctShare: number | null;
  /** Сколько прохождений среза вообще содержали вопросы темы. */
  inSample: number;
}

/** Готовый сбор: темы любого подмножества прохождений считаются без новых запросов. */
export interface SliceTopicsReader {
  topicsOf(observationIds: ReadonlySet<string>): SliceTopicRow[];
}

/**
 * Слабейшая тема среза — та, где доля верных ниже всех.
 *
 * Темы с выборкой меньше порога наблюдений в расчёт НЕ берутся: тема, попавшая в три
 * прохождения, регулярно даёт ноль процентов и заняла бы первое место во всех срезах разом,
 * увести внимание с настоящего провала (то же правило, что у долей среза, FR-06d).
 *
 * @param topics темы одного среза
 * @param minObservations порог наблюдений инстанса (`analytics.minObservations`)
 * @returns тема с наименьшей долей верных либо `null`, когда говорить не о чем
 */
export function weakestTopic(
  topics: readonly SliceTopicRow[],
  minObservations: number,
): SliceTopicRow | null {
  const eligible = topics.filter(
    topic => topic.correctShare !== null && topic.inSample >= minObservations,
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((worst, topic) =>
    (topic.correctShare as number) < (worst.correctShare as number) ? topic : worst);
}

/**
 * Собрать ответы теста один раз и отдать читателя, который режет их по срезам.
 *
 * @param testId тест — рамка расчёта: темы считаются внутри одного теста
 * @param observations все прохождения рамки (не одного среза): из них берутся веб-попытки,
 *   ответы прохождений из LMS дочитываются по тесту
 */
export async function readSliceTopics(
  testId: string,
  observations: readonly Observation[],
): Promise<SliceTopicsReader> {
  const webIds = new Set(observations.filter(o => o.source === "web").map(o => o.id));
  const attempts = webIds.size
    // PRD-70 FR-01: the frame test by query; ids filter in memory (a list of thousands of ids
    // would hit the bind-parameter limit).
    ? (await storage.getAttemptsByTests([testId])).filter(attempt => webIds.has(attempt.id))
    : [];

  const { facts, questionById, topicNameById, topicRules } =
    await loadTestAnswerFacts(testId, attempts);

  return {
    topicsOf(observationIds: ReadonlySet<string>): SliceTopicRow[] {
      const rows: TopicStatsRow[] = summariseTopics(
        facts.filter(fact => observationIds.has(fact.attemptId)).flatMap(fact => {
          const question = questionById.get(fact.questionId);
          if (!question) return [];
          return [{
            attemptId: fact.attemptId,
            topicId: question.topicId,
            topicName: topicNameById.get(question.topicId) ?? "Без темы",
            subtopics: question.tags ?? [],
            result: fact.result,
            earnedPoints: fact.earnedPoints,
            possiblePoints: fact.possiblePoints,
          }];
        }),
        topicRules,
      );

      return rows.map(row => ({
        topicId: row.topicId,
        topicName: row.topicName,
        correctShare: row.correctShare,
        inSample: row.inSample,
      }));
    },
  };
}
