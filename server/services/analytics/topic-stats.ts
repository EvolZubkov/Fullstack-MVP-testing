/**
 * @module server/services/analytics/topic-stats
 * @description PRD-56 FR-14, FR-14a: разрезы теста по темам и подтемам.
 *
 * Две доли, которые нельзя путать. «Прошли тему» — доля ПРОХОЖДЕНИЙ, где участник взял порог
 * темы: тот же исход «Пройдено / Не пройдено», что видит участник, посчитанный поштучно. «Доля
 * верных ответов» — доля ОТВЕТОВ, мера трудности материала. В теме из четырёх вопросов с порогом
 * «три из четырёх» все могут отвечать верно на два: доля верных 50 %, тему не прошёл никто.
 *
 * Исход считает движок PRD-50 (`checkPassRule`), а не собственное правило аналитики: иначе исход
 * в отчёте участника и исход на этом экране однажды разойдутся, и объяснить расхождение будет
 * нечем.
 *
 * Колонки «вердикт» у темы нет: порог судит одну попытку, у среднего исхода нет, и третьего
 * состояния («на грани») в модели не существует.
 */

import { checkPassRule, type ResolvedRule } from "@shared/scoring/pass-rule";

/** Один ответ, отнесённый к теме и подтемам. */
export interface TopicAnswerFact {
  /** Прохождение, которому принадлежит ответ: по нему считаются доли ПРОХОЖДЕНИЙ. */
  attemptId: string;
  topicId: string;
  topicName: string;
  /** Подтемы (теги вопроса, PRD-11). Ответ может попасть в несколько — это правда о данных. */
  subtopics: string[];
  result: "correct" | "incorrect" | "neutral";
  /** Баллы; `null` — оценивать было нечего (измерительный вопрос). */
  earnedPoints: number | null;
  possiblePoints: number | null;
}

/** Разрез: тема или её подтема. */
export interface TopicSliceStats {
  /** Доля прохождений, взявших порог; `null` — порога нет, исхода у темы не существует. */
  passedShare: number | null;
  /** Доля верных среди оценённых ответов; `null` — оценивать было нечего. */
  correctShare: number | null;
  /** Порог в процентах; `null` — не задан или задан в баллах. */
  thresholdPercent: number | null;
  /** Сколько ПРОХОЖДЕНИЙ содержали вопросы этого разреза. */
  inSample: number;
}

export interface SubtopicStatsRow extends TopicSliceStats {
  name: string;
}

export interface TopicStatsRow extends TopicSliceStats {
  topicId: string;
  topicName: string;
  subtopics: SubtopicStatsRow[];
}

/** Накопитель одного разреза. */
interface Bucket {
  attempts: Map<string, { earned: number; possible: number }>;
  graded: number;
  correct: number;
}

function emptyBucket(): Bucket {
  return { attempts: new Map(), graded: 0, correct: 0 };
}

/** Учесть ответ в разрезе. */
function add(bucket: Bucket, fact: TopicAnswerFact): void {
  const attempt = bucket.attempts.get(fact.attemptId) ?? { earned: 0, possible: 0 };
  attempt.earned += fact.earnedPoints ?? 0;
  attempt.possible += fact.possiblePoints ?? 0;
  bucket.attempts.set(fact.attemptId, attempt);

  // Измерительный ответ не идёт ни в числитель, ни в знаменатель доли верных: эталона у него
  // нет вовсе (PRD-26 FR-08), и «ноль верных» было бы про него ложью.
  if (fact.result === "neutral") return;
  bucket.graded += 1;
  if (fact.result === "correct") bucket.correct += 1;
}

/** Свести накопленное в показатели разреза. */
function summarise(bucket: Bucket, rule: ResolvedRule | null): TopicSliceStats {
  const attempts = [...bucket.attempts.values()];
  // Прохождение без достижимых баллов оценивать нечем: порог к нему неприменим, и в знаменатель
  // доли оно не идёт. Раньше оно шло туда «не прошедшим» — и выгрузка LMS, которая баллов за
  // вопрос не несёт (только «верно/неверно»), давала «Прошли тему: 0 %» у любой темы.
  const judged = attempts.filter(attempt => attempt.possible > 0);
  const passed = rule === null
    ? null
    : judged.filter(attempt =>
      checkPassRule(rule, (attempt.earned / attempt.possible) * 100, attempt.earned)).length;

  return {
    passedShare: passed === null || judged.length === 0
      ? null
      : (passed / judged.length) * 100,
    correctShare: bucket.graded > 0 ? (bucket.correct / bucket.graded) * 100 : null,
    thresholdPercent: rule?.type === "percent" ? rule.value : null,
    inSample: attempts.length,
  };
}

/**
 * Свести ответы в разрезы по темам и подтемам.
 *
 * @param facts ответы прохождений теста обоих источников
 * @param rules порог темы по её идентификатору; отсутствие ключа значит «порога нет».
 *   Подтема наследует порог своей темы (PRD-50 §16): своего у неё не бывает, и показать
 *   на экране требование, которого никто не задавал, было бы выдумкой
 */
export function summariseTopics(
  facts: readonly TopicAnswerFact[],
  rules: ReadonlyMap<string, ResolvedRule | null>,
): TopicStatsRow[] {
  const topics = new Map<string, {
    topicName: string;
    bucket: Bucket;
    subtopics: Map<string, Bucket>;
  }>();

  for (const fact of facts) {
    const topic = topics.get(fact.topicId) ?? {
      topicName: fact.topicName,
      bucket: emptyBucket(),
      subtopics: new Map<string, Bucket>(),
    };
    add(topic.bucket, fact);

    for (const name of fact.subtopics) {
      const subtopic = topic.subtopics.get(name) ?? emptyBucket();
      add(subtopic, fact);
      topic.subtopics.set(name, subtopic);
    }

    topics.set(fact.topicId, topic);
  }

  return [...topics.entries()].map(([topicId, topic]) => {
    const rule = rules.get(topicId) ?? null;
    return {
      topicId,
      topicName: topic.topicName,
      ...summarise(topic.bucket, rule),
      subtopics: [...topic.subtopics.entries()]
        .map(([name, bucket]) => ({ name, ...summarise(bucket, rule) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}
