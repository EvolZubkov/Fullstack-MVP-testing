/**
 * @module shared/psychometrics/reliability
 *
 * Надёжность ТЕСТА: альфа Кронбаха и KR-20, стандартная ошибка измерения, прогноз
 * Спирмена-Брауна (FR-19 — FR-23).
 *
 * Что означает альфа, одной фразой (FR-19c): она сравнивает разброс СУММЫ с разбросом
 * отдельных пунктов. Пункты, меряющие одно и то же, меняются согласованно — сумма разбрасывается
 * заметно сильнее, чем слагаемые по отдельности, и коэффициент растёт к единице; независимые
 * пункты гасят друг друга, и он падает к нулю.
 *
 * ```text
 * alpha = (k / (k - 1)) * (1 - sum(var_item) / var_total)
 * ```
 *
 * ЗНАЧЕНИЕ ПУНКТА, а не сырой ответ (FR-19a). Для теста это доля балла задания, для
 * измерительной шкалы — вклад ответа в шкалу со знаком и весом, а не номер выбранной градации.
 * Отсюда прямое следствие: альфа при ПЕРЕВЁРНУТОМ вкладе пункта вычислима (FR-31b) — меняется
 * знак значения, меняются ковариации, а наблюдения остаются те же.
 *
 * ТОЛЬКО ПОЛНЫЕ НАБОРЫ (FR-19b). Дисперсии слагаемых и дисперсия суммы обязаны быть посчитаны
 * на одной и той же выборке, иначе их отношение теряет смысл. Респондент, пропустивший пункт,
 * из расчёта выпадает целиком, и число включённых выводится рядом с коэффициентом — оно тем
 * меньше общего `n`, чем чаще пункты пропускали.
 */

import { pearson, standardDeviation, variance } from "./stats";

/** Значение одного пункта у одного респондента — вход расчёта надёжности. */
export interface ItemValue {
  respondentId: string;
  itemId: string;
  /** Значение пункта: доля балла задания либо вклад ответа в шкалу со знаком. */
  value: number;
}

/** Почему надёжность не посчиталась — на экране это разные сообщения, а не одно «нет данных». */
export type ReliabilityGap =
  /** Пунктов меньше двух: согласованность одного пункта с самим собой не определена. */
  | "too-few-items"
  /** Респондентов с полным набором меньше двух: разброса нет. */
  | "too-few-respondents"
  /** Разброс суммы нулевой: все набрали поровну, и сравнивать не с чем. */
  | "no-variance"
  /**
   * FR-20: у участников разные наборы, и пар заданий с достаточным пересечением слишком мало —
   * ни полного набора, ни оценки по связям заданий построить не на чем.
   */
  | "random-delivery";

/**
 * Как посчитана надёжность (FR-20): по полному набору, по общему ядру или оценкой по связям
 * заданий. На экране это разные подписи: оценка — не то же самое, что альфа полного набора.
 */
export type ReliabilityMethod = "full" | "core" | "pairwise";

export interface Reliability {
  alpha: number;
  /** Пунктов в расчёте. */
  items: number;
  /**
   * Респондентов с ПОЛНЫМ набором пунктов — на них и посчитано (FR-19b).
   *
   * Выводится рядом с коэффициентом: расхождение с общим `n` выборки и есть мера того, как
   * часто пункты пропускали.
   */
  respondents: number;
  /** Стандартное отклонение суммарного балла — оно же основа ошибки измерения. */
  totalSd: number;
  /**
   * Строго дихотомический набор: каждый пункт принимает только 0 или 1.
   *
   * Тогда альфа В ТОЧНОСТИ равна KR-20 — это не другая формула, а её частный случай, и
   * считать её отдельно значило бы завести второй источник одного и того же числа.
   */
  dichotomous: boolean;
  /** Способ расчёта; отсутствует у результатов, посчитанных до FR-20, — это полный набор. */
  method?: ReliabilityMethod;
  /** Для оценки по связям заданий: сколько пар вошло в среднюю корреляцию. */
  pairs?: number;
}

/**
 * Сколько участников должно было получить ОБА задания пары, чтобы её корреляция вошла в
 * среднюю. Меньше пяти — корреляция по двум-трём точкам, шум, а не связь.
 */
const MIN_PAIR_OVERLAP = 5;

/**
 * Сколько пар нужно, чтобы средняя корреляция что-то значила. Одна-две пары — это свойство
 * этих заданий, а не банка.
 */
const MIN_PAIRS = 3;

/**
 * Оценка надёжности по связям заданий — для выдачи, где у участников разные наборы (FR-20).
 *
 * Для каждой пары заданий корреляция считается по тем, кому досталось и то и другое; средняя
 * по парам (взвешенная числом таких участников) — это средняя связь заданий банка `r̄`. Её
 * формула Спирмена-Брауна пересчитывает в надёжность варианта той длины, которую получает
 * участник:
 *
 * ```text
 * rel = L * r̄ / (1 + (L - 1) * r̄)
 * ```
 *
 * Это стандартный приём для выдачи «каждому — часть банка»: полного набора нет ни у кого, но
 * пар, встретившихся вместе, много, и средняя по ним устойчива. Число — ОЦЕНКА: оно исходит из
 * того, что задания банка взаимозаменяемы, и подписывается на экране именно так.
 *
 * @param values значения пунктов по респондентам
 * @returns оценка с длиной варианта и числом пар либо причина, по которой её нет
 */
export function pairwiseReliability(values: readonly ItemValue[]): Reliability | ReliabilityGap {
  const byRespondent = new Map<string, Map<string, number>>();
  for (const entry of values) {
    let row = byRespondent.get(entry.respondentId);
    if (!row) {
      row = new Map<string, number>();
      byRespondent.set(entry.respondentId, row);
    }
    row.set(entry.itemId, entry.value);
  }
  const rows = [...byRespondent.values()];
  const itemIds = [...new Set(values.map(v => v.itemId))];

  let weightedSum = 0;
  let weight = 0;
  let pairs = 0;
  for (let i = 0; i < itemIds.length; i += 1) {
    for (let j = i + 1; j < itemIds.length; j += 1) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const row of rows) {
        const x = row.get(itemIds[i]);
        const y = row.get(itemIds[j]);
        if (x !== undefined && y !== undefined) {
          xs.push(x);
          ys.push(y);
        }
      }
      if (xs.length < MIN_PAIR_OVERLAP) continue;
      // Пара, где одно из заданий у всех решено одинаково, связи не показывает — пропускаем.
      const r = pearson(xs, ys);
      if (r === null) continue;
      weightedSum += r * xs.length;
      weight += xs.length;
      pairs += 1;
    }
  }
  if (pairs < MIN_PAIRS) return "random-delivery";

  const meanR = weightedSum / weight;
  // Длина варианта — сколько заданий обычно получает участник (медиана): для неё и нужна
  // надёжность, а не для банка целиком.
  const lengths = rows.map(row => row.size).sort((a, b) => a - b);
  const length = lengths[Math.floor(lengths.length / 2)];
  const denominator = 1 + (length - 1) * meanR;
  if (!(denominator > 0)) return "no-variance";

  // Разброс суммы — по участникам с вариантом этой длины: SEM и интервал у порога живут в той
  // же шкале, что и итог участника.
  const totals = rows
    .filter(row => row.size === length)
    .map(row => [...row.values()].reduce((sum, value) => sum + value, 0));
  const totalSd = standardDeviation(totals);
  if (totalSd === null) return "no-variance";

  return {
    alpha: (length * meanR) / denominator,
    items: length,
    respondents: rows.length,
    totalSd,
    dichotomous: values.every(v => v.value === 0 || v.value === 1),
    method: "pairwise",
    pairs,
  };
}

/**
 * Внутренняя согласованность набора пунктов.
 *
 * @param values значения пунктов по респондентам
 * @returns коэффициент с составом выборки либо причина, по которой его нет
 */
/**
 * Суммы баллов по ПОЛНЫМ наборам — то распределение, на котором стоят альфа, SEM и интервал.
 *
 * Вынесено отдельно, потому что правило «полный набор» нужно и там, где считается, скольких
 * участников задел интервал у порога (FR-21a). Вторая реализация того же отбора разошлась бы с
 * первой, и два числа на одном экране стали бы считаться по разным выборкам.
 */
function completeRows(values: readonly ItemValue[]): {
  itemIds: string[];
  rows: Array<Map<string, number>>;
} {
  const itemIds = [...new Set(values.map(v => v.itemId))];

  const byRespondent = new Map<string, Map<string, number>>();
  for (const entry of values) {
    let row = byRespondent.get(entry.respondentId);
    if (!row) {
      row = new Map<string, number>();
      byRespondent.set(entry.respondentId, row);
    }
    row.set(entry.itemId, entry.value);
  }

  // Полные наборы, и только они: неполный респондент попал бы в дисперсию одних пунктов и не
  // попал в дисперсию других, а отношение таких дисперсий не значит ничего.
  return { itemIds, rows: [...byRespondent.values()].filter(row => row.size === itemIds.length) };
}

/** Суммы баллов по наборам — то распределение, на котором стоят SEM и интервал. */
function totalsOf(rows: ReadonlyArray<Map<string, number>>, itemIds: readonly string[]): number[] {
  return rows.map(row => itemIds.reduce((sum, itemId) => sum + row.get(itemId)!, 0));
}

/**
 * Скольких участников задел интервал ошибки вокруг проходного балла (FR-21a).
 *
 * Границы считаются ВНУТРИ: у участника ровно на границе исход определяется ошибкой измерения
 * ничуть не меньше, чем у соседа внутри.
 *
 * @param values значения пунктов по респондентам
 * @param band интервал вокруг порога
 * @param variantLength для оценки по связям заданий (FR-20): считать участников с вариантом
 *   этой длины, а не с полным набором — полного набора при случайной выдаче нет ни у кого
 * @returns число участников, чья сумма попала в интервал
 */
export function countWithinBand(values: readonly ItemValue[], band: CutScoreBand, variantLength?: number): number {
  if (variantLength !== undefined) {
    const totals = new Map<string, { size: number; sum: number }>();
    for (const entry of values) {
      const acc = totals.get(entry.respondentId) ?? { size: 0, sum: 0 };
      acc.size += 1;
      acc.sum += entry.value;
      totals.set(entry.respondentId, acc);
    }
    return [...totals.values()]
      .filter(t => t.size === variantLength && t.sum >= band.low && t.sum <= band.high).length;
  }
  const { itemIds, rows } = completeRows(values);
  return totalsOf(rows, itemIds).filter(total => total >= band.low && total <= band.high).length;
}

/**
 * Альфа по общему ядру — заданиям, которые видели ВСЕ участники выборки (FR-20).
 *
 * При случайной выдаче полного набора нет, но у теста может быть фиксированная часть; на ней
 * классическая альфа законна. `null` — ядра нет (меньше двух общих заданий).
 *
 * @param values значения пунктов по респондентам
 */
export function coreReliability(values: readonly ItemValue[]): Reliability | ReliabilityGap | null {
  const seenBy = new Map<string, Set<string>>();
  const respondents = new Set<string>();
  for (const entry of values) {
    respondents.add(entry.respondentId);
    const set = seenBy.get(entry.itemId) ?? new Set<string>();
    set.add(entry.respondentId);
    seenBy.set(entry.itemId, set);
  }
  const core = new Set([...seenBy].filter(([, who]) => who.size === respondents.size).map(([itemId]) => itemId));
  if (core.size < 2) return null;
  const result = alphaOf(values.filter(v => core.has(v.itemId)));
  return typeof result === "string" ? result : { ...result, method: "core" };
}

export function alphaOf(values: readonly ItemValue[]): Reliability | ReliabilityGap {
  const { itemIds, rows: complete } = completeRows(values);
  if (itemIds.length < 2) return "too-few-items";
  if (complete.length < 2) return "too-few-respondents";

  let sumOfItemVariances = 0;
  for (const itemId of itemIds) {
    const column = complete.map(row => row.get(itemId)!);
    sumOfItemVariances += variance(column)!;
  }

  const totals = totalsOf(complete, itemIds);
  const totalVariance = variance(totals)!;
  // Все набрали поровну — сравнивать разбросы не с чем. Ноль здесь был бы не «низкой
  // надёжностью», а делением на ноль, выданным за факт.
  if (totalVariance === 0) return "no-variance";

  const k = itemIds.length;
  const alpha = (k / (k - 1)) * (1 - sumOfItemVariances / totalVariance);

  return {
    alpha,
    items: k,
    respondents: complete.length,
    totalSd: standardDeviation(totals)!,
    dichotomous: complete.every(row => [...row.values()].every(value => value === 0 || value === 1)),
  };
}

/**
 * Стандартная ошибка измерения (FR-21).
 *
 * ```text
 * SEM = SD_total * sqrt(1 - alpha)
 * ```
 *
 * Величина в баллах теста: насколько наблюдаемый балл участника может отличаться от его
 * «истинного». Она и решает, можно ли доверять вердикту у порога.
 */
export function standardErrorOfMeasurement(totalSd: number, alpha: number): number {
  // Альфа бывает и отрицательной (пункты гасят друг друга) — тогда под корнем больше единицы,
  // и ошибка ЗАКОННО превышает разброс: набор, где пункты противоречат друг другу, не измеряет
  // ничего, и притворяться, что ошибка мала, нельзя.
  return totalSd * Math.sqrt(Math.max(0, 1 - alpha));
}

/** Интервал вокруг порога и то, кого он фактически затронул (FR-21a). */
export interface CutScoreBand {
  /** Границы интервала в тех же единицах, что и порог. */
  low: number;
  high: number;
  /** Множитель ошибки: 1 — около 68 % случаев, 1,96 — около 95 %. */
  z: number;
}

/**
 * Интервал неопределённости вокруг проходного балла.
 *
 * Решение «сдал / не сдал» у участника, чей балл попал в этот интервал, ненадёжно: сдвиг
 * порога на величину ошибки измерения поменял бы вердикт. Это и есть та величина, ради которой
 * психометрику чаще всего и заводят.
 *
 * @param cut проходной балл
 * @param sem стандартная ошибка измерения
 * @param z множитель ошибки; по умолчанию 1,96 — около 95 % случаев
 */
export function cutScoreBand(cut: number, sem: number, z = 1.96): CutScoreBand {
  return { low: cut - z * sem, high: cut + z * sem, z };
}

/**
 * Прогноз Спирмена-Брауна (FR-22): во сколько раз удлинить тест ради целевой надёжности.
 *
 * ```text
 * factor = target * (1 - alpha) / (alpha * (1 - target))
 * ```
 *
 * `null` — прогноз невозможен: при нулевой или отрицательной альфе удлинять нечего (пункты не
 * согласованы вовсе, и добавление таких же не поможет), а целевая надёжность в единицу
 * недостижима никаким числом заданий.
 *
 * @param alpha текущая надёжность
 * @param target желаемая надёжность
 * @param items текущее число пунктов
 * @returns множитель длины и число пунктов, которое нужно добавить (отрицательное — снять)
 */
export function spearmanBrown(
  alpha: number,
  target: number,
  items: number,
): { factor: number; itemsDelta: number } | null {
  if (!(alpha > 0) || !(target > 0) || target >= 1 || items < 1) return null;
  const factor = (target * (1 - alpha)) / (alpha * (1 - target));
  // Округление вверх — с допуском на шум последнего разряда: ровно двукратная длина выходит в
  // двоичной дроби как 2,0000000000000004, и «добавить 4 задания» превращалось в «добавить 5».
  // Совет автору нельзя брать из погрешности вычислений.
  return { factor, itemsDelta: Math.ceil(items * factor - 1e-9) - items };
}
