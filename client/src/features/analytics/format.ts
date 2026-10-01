/**
 * @module features/analytics/format
 * @description Единый формат процентов на экранах аналитики (этап Э1 UX-аудита аналитики).
 *
 * До этого у каждого экрана был свой локальный `percent()`: одни печатали «62 %», другие
 * «62%», третьи `toFixed(1)` — «61.6%» с точкой. Читатель сравнивает числа соседних экранов, и
 * три написания одной величины мешают это делать, а «62» и «%» к тому же разрывались переносом
 * строки. Теперь процент пишется везде одинаково: целое число, неразрывный пробел, знак.
 * Десятая — только там, где она несёт смысл (порог и интервал ошибки), и с запятой.
 */

/** Неразрывный пробел: «62» и «%» не должны расходиться по строкам. */
export const NBSP = " ";

/** Как печатать процент. */
export interface PercentOptions {
  /**
   * Десятая доля, когда она есть: «70 %», «65,8 %». Для величин, где разница в десятых что-то
   * значит, — порог прохождения и его интервал. Умолчание — целые.
   */
  precise?: boolean;
}

/**
 * Число процента без знака: «62», «65,8».
 *
 * Отдельно от {@link percent} для диапазонов, где знак ставится один раз в конце:
 * «65,8 — 74,2 %».
 *
 * @param value процент, 0-100
 * @param options формат
 */
export function percentNumber(value: number, options: PercentOptions = {}): string {
  if (!options.precise) return String(Math.round(value));
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
}

/**
 * Процент словами экрана: «62 %»; нет значения — прочерк.
 *
 * @param value процент, 0-100; `null` / `undefined` — величина не посчитана
 * @param options формат
 */
export function percent(value: number | null | undefined, options: PercentOptions = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${percentNumber(value, options)}${NBSP}%`;
}

/**
 * Процент из ДОЛИ 0-1: «0,62» печатается как «62 %».
 *
 * Отдельная функция, а не множитель у вызывающего: доли и проценты приходят с сервера
 * вперемешку, и умножение, забытое в одном месте, давало «0 %» вместо «62 %».
 *
 * @param share доля, 0-1; `null` / `undefined` — величина не посчитана
 * @param options формат
 */
export function percentOfShare(share: number | null | undefined, options: PercentOptions = {}): string {
  if (share === null || share === undefined || !Number.isFinite(share)) return "—";
  return percent(share * 100, options);
}
