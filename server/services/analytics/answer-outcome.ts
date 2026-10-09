/**
 * @module server/services/analytics/answer-outcome
 *
 * THE single rule «откуда аналитика берёт исход ответа» (PRD-57, решение владельца
 * 2026-09-19, задача #43).
 *
 * До этой работы исход по-ответно не хранился вовсе, поэтому аналитика и выгрузка считали
 * его заново — и делали это по ЖИВЫМ вопросам, мимо снимка попытки. Автор правил эталон
 * после прохождения, и выгрузка начинала говорить «верно» там, где попытка засчитала
 * «неверно»: отчёт противоречил результату участника, и понять, какое из двух чисел
 * настоящее, было нечем.
 *
 * Теперь исход хранится (`AggregateResult.questionOutcomes`), и порядок один: СНАЧАЛА
 * сохранённое, и только при его отсутствии — расчёт на месте. Правило живёт в одном месте
 * не ради красоты: читателей шесть, и шесть копий «сначала сохранённое, потом расчёт»
 * разошлись бы на первой правке, а разойдясь — дали бы два разных числа в одном отчёте.
 *
 * Расчёт на месте остаётся только для попыток, завершённых ДО этой работы; он помечается
 * признаком `computed`, потому что расхождение двух источников иначе читается как порча
 * данных.
 */
import { isMeasurementOnly } from "@shared/questions/question-type";
import type { QuestionOutcome } from "@shared/scoring/aggregate";
import { checkAnswer } from "../../utils/check-answer";
import type { Question, QuestionScoring } from "@shared/schema";

/** Исход ответа и то, откуда он взялся. */
export interface AnswerOutcome {
  /**
   * Исход в терминах ТЕЛЕМЕТРИИ — три состояния, как в колонке `scorm_answers.result`.
   *
   * Четвёртое состояние результата попытки, «ждёт проверки» (PRD-57 FR-35), сюда
   * приходит нейтральным: у аналитики обоих источников состояний три, и заводить
   * четвёртое значило бы миграцию колонки ради того, что она всё равно считает «не
   * оценивалось». Различие живёт там, где оно нужно, — в результате попытки.
   */
  result: "correct" | "incorrect" | "neutral";
  earned: number;
  possible: number;
  /** `true` — посчитан сейчас, потому что у попытки сохранённого исхода нет. */
  computed: boolean;
}

/** Действующая оценка вопроса в этом тесте (PRD-15 блок D). */
export interface EffectiveScoring {
  points: number;
  scoring?: QuestionScoring | null;
}

/** Список исходов из `attempts.result_json`, если он там есть. */
function storedOutcomes(attemptResult: unknown): QuestionOutcome[] | null {
  const outcomes = (attemptResult as { questionOutcomes?: unknown } | null | undefined)?.questionOutcomes;
  return Array.isArray(outcomes) ? (outcomes as QuestionOutcome[]) : null;
}

/**
 * Исход одного ответа.
 *
 * @param attemptResult Сохранённый результат попытки (`attempts.result_json`).
 * @param questionId    Вопрос, исход которого нужен.
 * @param question      Сам вопрос — из СНИМКА попытки, когда он есть; нужен только для
 *                      расчёта на месте. `undefined` = задания больше нет.
 * @param answer        Ответ участника.
 * @param effective     Действующая цена и конфигурация оценки.
 * @returns Исход либо `null`, когда его неоткуда взять.
 */
export function outcomeFor(
  attemptResult: unknown,
  questionId: string,
  question: Question | undefined,
  answer: unknown,
  effective: EffectiveScoring,
): AnswerOutcome | null {
  const stored = storedOutcomes(attemptResult)?.find((o) => o.questionId === questionId);
  if (stored) {
    return {
      result: stored.result === "pending" ? "neutral" : stored.result,
      earned: stored.earned,
      possible: stored.possible,
      computed: false,
    };
  }

  if (!question) return null;

  // Признак, а не перечень типов: короткий ответ БЕЗ правил неоцениваем ровно так же, как
  // шкала без эталона, и назвать его «неверно» значит показать ошибку там, где ошибиться
  // не во что (§5.3, FR-16).
  if (isMeasurementOnly(question)) {
    return { result: "neutral", earned: 0, possible: 0, computed: true };
  }

  const ratio = checkAnswer(question, answer, effective.scoring ?? null);
  return {
    result: ratio === 1 ? "correct" : "incorrect",
    earned: ratio * effective.points,
    possible: effective.points,
    computed: true,
  };
}
