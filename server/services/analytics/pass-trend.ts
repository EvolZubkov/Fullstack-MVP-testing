/**
 * @module server/services/analytics/pass-trend
 * @description PRD-56 FR-13: динамика сдаваемости теста по месяцам.
 *
 * По дням тренд теста не читается: прохождения идут волнами по назначениям, и дневная линия —
 * частокол из единиц и нулей. Месяц — та единица, в которой об обучении и говорят: «после
 * мартовской правки стали сдавать хуже».
 *
 * Месяц без прохождений в линии не рисуется: ноль сдавших там, где никто не проходил, читается
 * как провал, которого не было. Пропуск в линии честнее выдуманной точки.
 */

import type { Observation } from "./observations";

/** Что динамике нужно от прохождения. */
export type TrendObservation = Pick<Observation, "startedAt" | "passed" | "outcome">;

/** Точка линии: один месяц. */
export interface PassTrendPoint {
  /** `ГГГГ-ММ` — по нему точки сортируются как строки. */
  key: string;
  /** Название для человека: «сентябрь 2026». */
  label: string;
  /** Сколько прохождений начато в этом месяце. */
  attempts: number;
  /** Сколько из них получили вердикт: только они в знаменателе доли сдавших. */
  judged: number;
  /** Доля сдавших среди судимых; `null` — судить было нечего. */
  passRate: number | null;
}

const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

/** Месяц начала прохождения в виде `ГГГГ-ММ`. */
function monthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Название месяца для человека. */
function labelOf(key: string): string {
  const [year, month] = key.split("-");
  return `${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

/**
 * Свести прохождения в помесячную линию сдаваемости.
 *
 * Точка относится к месяцу НАЧАЛА прохождения: именно тогда человек столкнулся с той версией
 * теста, о которой линия и рассказывает.
 */
export function passTrendByMonth(
  observations: readonly TrendObservation[],
): PassTrendPoint[] {
  const months = new Map<string, { attempts: number; judged: number; passed: number }>();

  for (const observation of observations) {
    const key = monthOf(observation.startedAt);
    const point = months.get(key) ?? { attempts: 0, judged: 0, passed: 0 };
    point.attempts += 1;
    // Прохождение без вердикта — опросник или брошенная попытка: в знаменателе доли сдавших
    // ему не место, иначе сдаваемость занижается ровно на их число (PRD-29 §6.7).
    if (observation.passed !== null) {
      point.judged += 1;
      if (observation.passed) point.passed += 1;
    }
    months.set(key, point);
  }

  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, point]) => ({
      key,
      label: labelOf(key),
      attempts: point.attempts,
      judged: point.judged,
      passRate: point.judged > 0 ? (point.passed / point.judged) * 100 : null,
    }));
}
