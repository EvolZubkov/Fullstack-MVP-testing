/**
 * @module shared/psychometrics/stats
 *
 * Базовая статистика психометрического движка: среднее, дисперсия, корреляция.
 *
 * Вынесена отдельно и намеренно скучна. Все метрики трека — трудность, дискриминативность,
 * надёжность — стоят на этих четырёх функциях, и ошибка здесь проявится не падением, а
 * неверными числами, которые выглядят правдоподобно. Поэтому у каждой функции есть свой
 * эталонный тест, а единственное решение, которое здесь принимается, — что делать, когда
 * считать не на чем.
 *
 * ПУСТОТА ВОЗВРАЩАЕТСЯ КАК `null`, НЕ КАК НОЛЬ (FR-44). Ноль — это утверждение: «разброса нет»,
 * «связи нет». Отсутствие данных такого утверждения не даёт, и `NaN`, выданный за трудность,
 * — ровно та ошибка, ради которой это правило и записано.
 *
 * Дисперсия ВЫБОРОЧНАЯ (делитель `n - 1`). Наблюдения — выборка из потока прохождений, а не
 * вся совокупность, и альфа Кронбаха традиционно считается именно так: отношение дисперсий в
 * ней почти не чувствительно к выбору делителя, но делитель обязан быть ОДИН и тот же в
 * числителе и знаменателе, иначе коэффициент поедет.
 */

/** Среднее арифметическое; `null` — считать не на чем. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/**
 * Выборочная дисперсия (делитель `n - 1`); `null` — наблюдений меньше двух.
 *
 * Одно наблюдение не даёт разброса — не «нулевой разброс», а отсутствие величины: по одному
 * человеку нельзя сказать, насколько люди различаются.
 */
export function variance(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const centre = mean(values)!;
  let sum = 0;
  for (const value of values) {
    const delta = value - centre;
    sum += delta * delta;
  }
  return sum / (values.length - 1);
}

/** Выборочное стандартное отклонение; `null` — наблюдений меньше двух. */
export function standardDeviation(values: readonly number[]): number | null {
  const varianceValue = variance(values);
  return varianceValue === null ? null : Math.sqrt(varianceValue);
}

/**
 * Корреляция Пирсона двух рядов; `null` — рядов короче двух или один из них без разброса.
 *
 * Отсутствие разброса — не нулевая корреляция, а невычислимая: если задание решили все,
 * различать им некого, и «связи нет» было бы ложным выводом. Ровно так выглядит задание,
 * которое все проходят, и списать его в «не дискриминирует» нельзя — оно просто не измеряет.
 *
 * @param xs первый ряд
 * @param ys второй ряд той же длины; лишние значения — ошибка вызывающего, а не данных
 */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const meanX = mean(xs)!;
  const meanY = mean(ys)!;

  let covariance = 0;
  let sumSquaresX = 0;
  let sumSquaresY = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    covariance += dx * dy;
    sumSquaresX += dx * dx;
    sumSquaresY += dy * dy;
  }

  if (sumSquaresX === 0 || sumSquaresY === 0) return null;
  return covariance / Math.sqrt(sumSquaresX * sumSquaresY);
}
