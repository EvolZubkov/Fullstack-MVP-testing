/**
 * @module server/services/analytics/review-inputs
 * @description PRD-70 FR-03: входы эвристик «требуют ревизии» — одни для таблицы вопросов теста и
 * для фонового пересчёта признаков.
 *
 * Эвристики PRD-56 (`question-review.ts`) считаются по статистике ВЫДАЧИ: доле верных, доле
 * прохождений с вопросом и медиане времени. Раньше эти входы собирал только маршрут аналитики
 * теста, и фоновый пересчёт обходился без эвристик — число в карточке «Тесты с вопросами под
 * подозрением» могло не совпасть со списком, который она открывает (решение владельца 2026-10-05:
 * эвристики учитываются везде). Здесь собраны и сами входы, и их сведение с правилом: второй
 * копии сборки, которая однажды разошлась бы с первой, нет.
 */
import { config } from "../../config";
import { logger } from "../../logger";
import { storage } from "../../storage";
import type { ReviewHeuristic } from "@shared/psychometrics/question-flag";
import { summariseAnswers } from "./answers";
import { loadObservations } from "./observations";
import { reviewFlags, type ReviewFlag } from "./question-review";
import { loadTestAnswerFacts } from "./test-answer-facts";

/** Выдача теста за окно счётчика (PRD-55): знаменатель доли, выдачи и время по вопросам. */
export interface DeliveryInputs {
  /** Попытки теста за окно, СЧИТАЯ брошенные: они показали задание так же. */
  attemptsInWindow: number;
  /** Выдачи вопроса в этом тесте за окно. */
  exposureOwn: ReadonlyMap<string, number>;
  /** Медиана времени на вопрос и число замеров за ней. */
  latency: ReadonlyMap<string, { medianMs: number; sampleSize: number }>;
}

/** Ответы вопроса, по которым считается доля верных. */
export interface AnswerInputs {
  questionId: string;
  gradedAnswers: number;
  correctPercent: number | null;
}

/** Что эвристики сказали о вопросе и на каких числах. */
export interface ReviewOutcome {
  exposureCount: number;
  /** Доля прохождений с вопросом; `null` — сравнивать не с чем или вопрос не выдавался. */
  exposurePercent: number | null;
  latencyMedianMs: number | null;
  latencySampleSize: number;
  reviewFlags: ReviewFlag[];
}

/** Начало окна счётчика выдач — от сегодняшнего дня назад на `exposureWindowMonths`. */
export function exposureWindowStart(): Date {
  const start = new Date();
  start.setMonth(start.getMonth() - config.delivery.exposureWindowMonths);
  return start;
}

/**
 * Эвристики ревизии одного вопроса — по его ответам и выдаче теста.
 *
 * @param answers доля верных и её знаменатель
 * @param delivery выдача теста за окно
 */
export function reviewOf(answers: AnswerInputs, delivery: DeliveryInputs): ReviewOutcome {
  const exposureCount = delivery.exposureOwn.get(answers.questionId) ?? 0;
  const lat = delivery.latency.get(answers.questionId);
  // Ноль попыток означает «сравнивать не с чем»: доля тогда `null`, а не ноль.
  const exposurePercent = delivery.attemptsInWindow > 0 && exposureCount > 0
    ? (exposureCount / delivery.attemptsInWindow) * 100
    : null;
  const latencyMedianMs = lat ? lat.medianMs : null;
  const latencySampleSize = lat ? lat.sampleSize : 0;
  return {
    exposureCount,
    exposurePercent,
    latencyMedianMs,
    latencySampleSize,
    reviewFlags: reviewFlags({
      questionId: answers.questionId,
      gradedAnswers: answers.gradedAnswers,
      correctPercent: answers.correctPercent,
      exposurePercent,
      latencyMedianMs,
      latencySampleSize,
    }, { minObservations: config.analytics.minObservations }),
  };
}

/**
 * Прочитать выдачу теста за окно. Сбой счётчиков не роняет расчёт: без них эвристики молчат,
 * что честнее выдуманных долей.
 *
 * @param testId тест
 * @param questionIds вопросы, по которым нужны выдачи и время
 * @param attemptsInWindow попытки теста за окно
 * @param windowStart начало окна
 */
export async function loadDeliveryInputs(
  testId: string,
  questionIds: string[],
  attemptsInWindow: number,
  windowStart: Date,
): Promise<DeliveryInputs> {
  try {
    const [exposureOwn, latency] = await Promise.all([
      storage.getDeliveryCountsForTest(questionIds, testId, windowStart),
      storage.getLatencyStats(questionIds, testId, windowStart),
    ]);
    return { attemptsInWindow, exposureOwn, latency };
  } catch (error) {
    logger.warn("PRD-55: экспозиция и время заданий не прочитаны — " + (error as Error).message);
    return { attemptsInWindow, exposureOwn: new Map(), latency: new Map() };
  }
}

/** Эвристика в том виде, в каком её берёт правило признака: виды и числа, которые её вызвали. */
export function heuristicOf(answers: AnswerInputs, outcome: ReviewOutcome): ReviewHeuristic | undefined {
  if (outcome.reviewFlags.length === 0) return undefined;
  return {
    kinds: outcome.reviewFlags.map(flag => flag.kind),
    exposurePercent: outcome.exposurePercent,
    correctPercent: answers.correctPercent,
    latencyMedianMs: outcome.latencyMedianMs,
  };
}

/**
 * Эвристики ревизии вопросов теста — по ВСЕМ завершённым прохождениям, как таблица теста без
 * условий отбора. Для фонового пересчёта: экран считает их сам по своей выборке.
 *
 * @param testId тест
 * @returns вопрос -> эвристика; в карте только вопросы, где она сработала
 */
export async function reviewHeuristicsOfTest(testId: string): Promise<Map<string, ReviewHeuristic>> {
  const attempts = (await storage.getAttemptsByTests([testId])).filter(a => a.resultJson !== null);
  const { facts, questionById } = await loadTestAnswerFacts(testId, attempts);
  const stats = summariseAnswers(facts).filter(s => questionById.has(s.questionId));

  const windowStart = exposureWindowStart();
  const { rows: passages } = await loadObservations({ testIds: [testId] }, { all: true, ids: new Set([testId]) });
  const attemptsInWindow = passages.filter(o => o.startedAt >= windowStart).length;
  const delivery = await loadDeliveryInputs(testId, stats.map(s => s.questionId), attemptsInWindow, windowStart);

  const result = new Map<string, ReviewHeuristic>();
  for (const s of stats) {
    const answers = { questionId: s.questionId, gradedAnswers: s.graded, correctPercent: s.correctPercent };
    const heuristic = heuristicOf(answers, reviewOf(answers, delivery));
    if (heuristic) result.set(s.questionId, heuristic);
  }
  return result;
}
