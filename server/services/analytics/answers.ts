/**
 * @module server/services/analytics/answers
 * @description PRD-56 FR-25, FR-33: ответы обоих источников — одна статистика вопроса.
 *
 * Слой наблюдений (`observations.ts`) отвечает на вопрос «какие прохождения есть»; этот —
 * на вопрос «что в них отвечали». Разделены они потому, что ответы нужны не всегда: реестру и
 * срезам хватает самих прохождений, а платить за разбор ответов при каждом их показе незачем.
 *
 * Третье состояние ответа (`neutral`, PRD-54) не бывает ни верным, ни неверным: измерительный
 * вопрос ничего не проверяет. В знаменателе доли верных он занижал бы её ровно на число таких
 * ответов, а в числителе врал бы прямо — поэтому у него свой счёт.
 */

import { storage } from "../../storage";

import type { ObservationSource } from "./observations";

/** Один ответ на один вопрос, приведённый к общему виду независимо от источника. */
export interface AnswerFact {
  questionId: string;
  /** Прохождение, которому принадлежит ответ: по нему считаются доли ПРОХОЖДЕНИЙ (FR-14a). */
  attemptId: string;
  /** `neutral` — ответ, которому нечего было оценивать (измерительный вопрос). */
  result: "correct" | "incorrect" | "neutral";
  source: ObservationSource;
  /** Время на вопрос; `null` — не измерялось (PRD-55: пакеты до 2026-09-12 его не шлют). */
  latencyMs: number | null;
  /** Баллы ответа; `null` — оценивать было нечего. */
  earnedPoints: number | null;
  possiblePoints: number | null;
  /**
   * Сам ответ участника (FR-22). Верному/неверному он не нужен — там всё сказано `result`, —
   * но у измерительного задания эталона нет, и единственное, что о нём можно рассказать, это
   * ЧТО выбирали. Тип свободный: у шкалы это индекс градации, у распределения — баллы по
   * утверждениям, и приводит их к общему виду тот, кто считает разброс.
   */
  answer: unknown;
}

/** Сколько наблюдений пришло из каждого источника — на чём стоит число. */
export type AnswersBySource = Record<ObservationSource, number>;

/** Статистика ответов на один вопрос. */
export interface QuestionAnswerStats {
  questionId: string;
  /** Сколько раз на вопрос ответили — включая ответы без оценивания. */
  answered: number;
  /** Сколько из них оценивалось: только по ним законна доля верных. */
  graded: number;
  correct: number;
  /** Доля верных среди оценённых; `null`, когда оценивать было нечего. */
  correctPercent: number | null;
  bySource: AnswersBySource;
}

/** Оценка ответа веб-попытки: чем он стал и во сколько баллов обошёлся. */
export interface WebGrade {
  result: AnswerFact["result"];
  earnedPoints: number | null;
  possiblePoints: number | null;
}

/**
 * Как оценён ответ веб-попытки. `null` — вопроса в тесте больше нет, ответ не учитывается.
 *
 * Третьим аргументом приходит СОХРАНЁННЫЙ результат попытки: исход ответа записан в нём
 * (PRD-57, #43), и оценщик обязан прочитать его, а не считать заново по живому вопросу.
 */
export type GradeWebAnswer = (
  questionId: string,
  answer: unknown,
  attemptResult: unknown,
) => WebGrade | null;

/** Веб-часть выборки: попытки с их ответами и правило оценки. */
export interface WebAnswerInput {
  attempts: ReadonlyArray<{ id?: string; answersJson?: unknown; resultJson?: unknown; variantJson?: unknown }>;
  /**
   * Оценка ответа.
   *
   * Приходит снаружи, потому что эффективная стоимость и правило проверки вопроса внутри теста
   * уже разрешены вызывающим (`loadTestScoringContext`): считать их здесь во второй раз значило
   * бы завести второй источник правды о том, что такое «верно».
   */
  grade: GradeWebAnswer;
}

/**
 * Собрать ответы теста из обоих источников.
 *
 * Веб отдаёт их разбором попытки, LMS — строками `scorm_answers`, где результат уже записан
 * пакетом либо импортом (PRD-54). Порядок: сначала веб, потом LMS — статистике он безразличен,
 * но делает выборку повторяемой.
 */
export async function loadAnswerFacts(
  testId: string,
  web: WebAnswerInput,
): Promise<AnswerFact[]> {
  const facts: AnswerFact[] = [];

  for (const attempt of web.attempts) {
    const answers = (attempt.answersJson ?? {}) as Record<string, unknown>;
    // PRD-66 FR-37a: время на задании веб хранит в ФОРМЕ попытки, рядом с составом выдачи:
    // карта ответов плоская, «задание -> значение», и второй величине в ней места нет.
    // Попытка, пройденная до появления замера, карты не имеет — у её ответов времени нет,
    // и это «не измерялось», а не ноль.
    const latency = ((attempt.variantJson as { latencyMs?: Record<string, number> } | null)?.latencyMs
      ?? {}) as Record<string, number>;
    for (const [questionId, answer] of Object.entries(answers)) {
      const grade = web.grade(questionId, answer, attempt.resultJson);
      if (grade === null) continue;
      facts.push({
        questionId,
        attemptId: attempt.id ?? "",
        result: grade.result,
        source: "web",
        latencyMs: typeof latency[questionId] === "number" ? latency[questionId] : null,
        earnedPoints: grade.earnedPoints,
        possiblePoints: grade.possiblePoints,
        answer,
      });
    }
  }

  for (const row of await storage.selectAnswersForTest(testId)) {
    facts.push({
      questionId: row.questionId,
      attemptId: row.attemptId,
      result: row.result,
      source: row.origin,
      latencyMs: row.latencyMs,
      earnedPoints: row.points,
      possiblePoints: row.maxPoints,
      answer: row.userAnswer,
    });
  }

  return facts;
}

/**
 * Свести ответы в статистику по вопросам.
 *
 * Порядок вопросов — в котором они впервые встретились: сортировка принадлежит экрану, а не
 * расчёту, и навязывать её отсюда значит спорить с тем, кто умеет сортировать по любому столбцу.
 */
export function summariseAnswers(facts: readonly AnswerFact[]): QuestionAnswerStats[] {
  const byQuestion = new Map<string, QuestionAnswerStats>();

  for (const fact of facts) {
    const stats = byQuestion.get(fact.questionId) ?? {
      questionId: fact.questionId,
      answered: 0,
      graded: 0,
      correct: 0,
      correctPercent: null,
      bySource: { web: 0, telemetry: 0, import: 0 },
    };

    stats.answered += 1;
    stats.bySource[fact.source] += 1;
    if (fact.result !== "neutral") {
      stats.graded += 1;
      if (fact.result === "correct") stats.correct += 1;
    }

    byQuestion.set(fact.questionId, stats);
  }

  for (const stats of byQuestion.values()) {
    // Ноль означал бы «все ошиблись», а здесь никто не ошибался: оценивания не было.
    stats.correctPercent = stats.graded > 0 ? (stats.correct / stats.graded) * 100 : null;
  }

  return [...byQuestion.values()];
}
