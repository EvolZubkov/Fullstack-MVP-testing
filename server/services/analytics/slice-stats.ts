/**
 * @module server/services/analytics/slice-stats
 * @description PRD-56 FR-06, FR-06c, FR-06d: величины среза прохождений.
 *
 * Срез отвечает на «кого учили и с каким результатом»: объёмы, доля сдавших, средний результат.
 * Средние законны, потому что считаются ВНУТРИ одного теста — смешивать разные пороги и шкалы
 * запрещено решением 2 спеки.
 *
 * Чего здесь нет намеренно: сравнения. Список срезов показывает факты, а не отклонения от
 * невидимой на экране величины (FR-06c) — из-за этого понятие «база» из продукта и убрали.
 * Сравнение живёт отдельным режимом с явно названными срезами.
 */

import type { Observation } from "./observations";

export interface SliceStatsInput {
  observations: readonly Observation[];
  /**
   * Сколько прохождений нужно, чтобы печатать процент (`analytics.minObservations`).
   * Ниже порога проценты отвечают `null`, а читателю остаётся объём выборки.
   */
  minObservations: number;
}

export interface SliceStats {
  /** Начатые прохождения, включая брошенные: сколько людей вообще притронулось к тесту. */
  started: number;
  /** Доведённые до конца — знаменатель долей. */
  completed: number;
  /** Сдавшие. Знаменатель — прохождения с вердиктом, а не все завершённые. */
  passed: number;
  /** Участники: один человек с тремя попытками считается один раз. */
  participants: number;
  /** Доля сдавших; `null` ниже порога или когда вердикта никто не выносил. */
  passRate: number | null;
  /** Средний результат; `null` ниже порога или когда оценивать было нечего. */
  avgPercent: number | null;
  /**
   * Хватает ли наблюдений, чтобы говорить процентами.
   *
   * Публикуется отдельным полем, потому что экран должен различать «ноль процентов» и
   * «процент не считается»: без этого «мало данных» превращается в «0 %».
   */
  enoughData: boolean;
}

/** Величины одного среза. */
export function summariseSlice({ observations, minObservations }: SliceStatsInput): SliceStats {
  const completed = observations.filter(o => o.outcome !== "incomplete");
  const judged = completed.filter(o => o.passed !== null);
  const graded = completed.filter(o => o.percent !== null && !o.adaptive);
  const passed = judged.filter(o => o.passed).length;

  // Порог считается по ЗАВЕРШЁННЫМ прохождениям: брошенные ничего не говорят о результате,
  // и добирать ими выборку до приличного размера значило бы обманывать самих себя.
  const enoughData = completed.length >= minObservations;

  return {
    started: observations.length,
    completed: completed.length,
    passed,
    participants: new Set(observations.map(o => o.participantId ?? o.id)).size,
    passRate: enoughData && judged.length > 0 ? (passed / judged.length) * 100 : null,
    avgPercent: enoughData && graded.length > 0
      ? graded.reduce((sum, o) => sum + (o.percent ?? 0), 0) / graded.length
      : null,
    enoughData,
  };
}
