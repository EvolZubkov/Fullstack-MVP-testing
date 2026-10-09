/**
 * @module shared/analytics/attention-period
 * @description Период вкладки «Требует внимания»: за неделю, месяц, квартал (решение владельца
 * 2026-09-25).
 *
 * Один источник на сервер и клиент: сервер режет по нему дела, клиент — переходит в реестр с
 * тем же началом периода. Разойдись длительности, число на карточке и число в реестре перестали
 * бы совпадать.
 */

/** Период вкладки. */
export type AttentionPeriod = "week" | "month" | "quarter";

/** Период по умолчанию: месяц — рабочий горизонт, неделя слишком коротка, квартал — архив. */
export const DEFAULT_ATTENTION_PERIOD: AttentionPeriod = "month";

/** Длительность периода в днях: считается назад от текущего момента, а не по календарю. */
export const ATTENTION_PERIOD_DAYS: Record<AttentionPeriod, number> = {
  week: 7,
  month: 30,
  quarter: 90,
};

/** Подпись периода в карточках: «14 прохождений за месяц». */
export const ATTENTION_PERIOD_LABEL: Record<AttentionPeriod, string> = {
  week: "за неделю",
  month: "за месяц",
  quarter: "за квартал",
};

/**
 * Разобрать период из параметра запроса; неизвестное значение — период по умолчанию.
 *
 * @param value значение параметра `period`
 */
export function parseAttentionPeriod(value: unknown): AttentionPeriod {
  return value === "week" || value === "month" || value === "quarter" ? value : DEFAULT_ATTENTION_PERIOD;
}

/**
 * Начало периода.
 *
 * @param period период вкладки
 * @param now текущий момент
 */
export function attentionPeriodStart(period: AttentionPeriod, now: Date): Date {
  return new Date(now.getTime() - ATTENTION_PERIOD_DAYS[period] * 24 * 60 * 60 * 1000);
}
