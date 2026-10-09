/**
 * @module server/services/analytics/test-summary
 * @description PRD-56 FR-13: сводка теста поверх наблюдений.
 *
 * Считает ровно то, что стоит плитками над экраном: сколько прохождений, сколько участников,
 * какая доля сдала, каков средний результат и сколько времени уходит. Источник наблюдений
 * сюда уже не доезжает — к моменту счёта веб-попытка, телеметрия и импорт неотличимы, и в
 * этом весь смысл слоя (FR-25).
 *
 * Ни одна величина не додумывается: где оценивать было нечего, ответ `null` — «неприменимо»,
 * а не ноль. Ноль означал бы, что участники отвечали и не набрали ничего.
 */

import type { Observation } from "./observations";

export interface TestSummary {
  /** Все прохождения выборки, включая брошенные. */
  totalAttempts: number;
  /** Доведённые до конца — знаменатель всех средних. */
  completedAttempts: number;
  /** Прохождения, которым вынесен вердикт: знаменатель доли сдавших. */
  judgedAttempts: number;
  /** Прохождения, где было что оценивать: знаменатель среднего результата. */
  gradedAttempts: number;
  /** Люди и псевдонимы: одно прохождение одного участника не считается дважды. */
  uniqueParticipants: number;
  avgPercent: number | null;
  passRate: number | null;
  /** Адаптивные прохождения и сколько из них сдано: их процент в средние не входит. */
  adaptiveAttempts: number;
  adaptivePassed: number;
  /** Средний набранный балл и наибольший достижимый: у теста с вариантами он не один. */
  avgScore: number | null;
  maxScore: number | null;
  /**
   * Среднее время прохождения. Держится рядом с медианой намеренно: среднее отвечает на
   * «сколько суммарно стоит прогнать группу», медиана — на «сколько занимает у человека».
   */
  avgDurationMs: number | null;
  /**
   * Медиана, а не среднее: распределение времени тяжелохвостое, и участник, ушедший на обед,
   * сдвинул бы среднее на часы (решение PRD-55).
   */
  medianDurationMs: number | null;
}

/** Середина ряда; у чётной длины — среднее двух средних значений. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Сводка по набору наблюдений. */
export function summariseObservations(observations: readonly Observation[]): TestSummary {
  const completed = observations.filter(o => o.outcome !== "incomplete");
  // Адаптивные прохождения не участвуют в среднем проценте: их результат — уровень.
  const graded = completed.filter(o => o.percent !== null && !o.adaptive);
  const adaptive = completed.filter(o => o.adaptive);
  const judged = completed.filter(o => o.passed !== null);
  const durations = completed
    .map(o => o.durationMs)
    .filter((ms): ms is number => ms !== null);

  const participants = new Set(observations.map(o => o.participantId ?? o.id));

  const scores = graded
    .map(o => o.earnedPoints)
    .filter((points): points is number => points !== null);
  const possible = graded
    .map(o => o.possiblePoints)
    .filter((points): points is number => points !== null);

  return {
    totalAttempts: observations.length,
    completedAttempts: completed.length,
    judgedAttempts: judged.length,
    gradedAttempts: graded.length,
    uniqueParticipants: participants.size,
    avgPercent: graded.length
      ? graded.reduce((sum, o) => sum + (o.percent ?? 0), 0) / graded.length
      : null,
    passRate: judged.length
      ? (judged.filter(o => o.passed).length / judged.length) * 100
      : null,
    adaptiveAttempts: adaptive.length,
    adaptivePassed: adaptive.filter(o => o.passed).length,
    avgScore: scores.length ? scores.reduce((sum, p) => sum + p, 0) / scores.length : null,
    maxScore: possible.length ? Math.max(...possible) : null,
    avgDurationMs: durations.length
      ? durations.reduce((sum, ms) => sum + ms, 0) / durations.length
      : null,
    medianDurationMs: median(durations),
  };
}
