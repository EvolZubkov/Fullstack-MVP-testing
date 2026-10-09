/**
 * @module shared/psychometrics/item-metrics
 *
 * Метрики ЗАДАНИЯ: трудность, поправка на угадывание, дискриминативность (FR-13 — FR-18).
 *
 * Все величины считаются от ДОЛИ БАЛЛА `score/maxScore`, а не от бинарного «верно/неверно»
 * (PA-17). Порог `=== 1` теряет частичный кредит: задание, где половина участников набрала
 * половину баллов, выглядело бы при нём полностью проваленным. Тот же порог живёт сегодня в
 * семи местах старой аналитики, и новый движок его не наследует.
 *
 * Способность респондента — доля балла на ЕГО СОБСТВЕННОЙ форме (FR-15), а не сырая сумма.
 * Выдача неоднородна: случайный набор с квотами (PRD-11), варианты (PRD-17), адаптив — люди
 * видят разные наборы разной длины, и сырые суммы у них несопоставимы по построению.
 */

import { mean, pearson } from "./stats";

/** Один ответ в матрице «респондент × задание» — вход всего движка. */
export interface ItemResponse {
  respondentId: string;
  itemId: string;
  /**
   * Доля балла `score / maxScore`, от 0 до 1; `null` — оценивать было нечего.
   *
   * Наблюдения без доли в расчёт не идут ВООБЩЕ: измерительное задание ничего не проверяет, и
   * приписать ему ноль значит утянуть трудность вниз ответами, которые ничего не измеряли.
   */
  ratio: number | null;
}

/** Способности респондентов: доля балла каждого на его собственной форме. */
export type AbilityByRespondent = ReadonlyMap<string, number>;

/**
 * Способность каждого респондента — средняя доля балла по ВСЕМ его оценённым ответам.
 *
 * Респондент без единого оценённого ответа в карту не попадает: способности у него нет, а ноль
 * поставил бы человека, отвечавшего только на измерительные задания, в самый низ рейтинга.
 */
export function abilities(responses: readonly ItemResponse[]): AbilityByRespondent {
  const byRespondent = new Map<string, number[]>();
  for (const response of responses) {
    if (response.ratio === null) continue;
    const list = byRespondent.get(response.respondentId);
    if (list) list.push(response.ratio);
    else byRespondent.set(response.respondentId, [response.ratio]);
  }

  const out = new Map<string, number>();
  for (const [respondentId, ratios] of byRespondent) {
    const value = mean(ratios);
    if (value !== null) out.set(respondentId, value);
  }
  return out;
}

/**
 * Эмпирическая трудность задания `p` — средняя доля балла среди тех, кто его ВИДЕЛ (FR-13).
 *
 * `null` — наблюдений нет вовсе. Ноль означал бы «задание не решил никто», а это совсем другое
 * утверждение, и путать их нельзя: первое — отсутствие данных, второе — тяжёлый диагноз.
 */
export function difficulty(responses: readonly ItemResponse[]): number | null {
  return mean(responses.map(r => r.ratio).filter((ratio): ratio is number => ratio !== null));
}

/**
 * Трудность с поправкой на угадывание (FR-17); `null` — поправка к этому заданию неприменима.
 *
 * ```text
 * p_corrected = (p - c) / (1 - c),  c = 1/k
 * ```
 *
 * Считается ТОЛЬКО для заданий с одним верным ответом из `k` вариантов: там и только там
 * вероятность случайного попадания вычислима. У «нескольких ответов», сопоставления,
 * ранжирования и распределения баллов такой вероятности нет — пустое место честнее нуля
 * (FR-17a).
 *
 * Модель исходит из «знает или выбирает наугад равновероятно» и частичного знания не описывает
 * (FR-17b); ограничение подписывается на экране, а не прячется в числе.
 *
 * @param p наблюдаемая трудность
 * @param optionCount число вариантов ответа `k`
 */
export function guessingCorrectedDifficulty(p: number | null, optionCount: number): number | null {
  if (p === null) return null;
  // Один вариант — выбора нет, и делить на ноль пришлось бы буквально.
  if (!Number.isFinite(optionCount) || optionCount < 2) return null;
  const chance = 1 / optionCount;
  return (p - chance) / (1 - chance);
}

/**
 * Дискриминативность `r` — корреляция задание-остаток (FR-14).
 *
 * Доля балла ЗА ЭТО задание против средней доли балла респондента на ОСТАЛЬНЫХ заданиях его
 * формы. Именно «остаток», а не полный балл: задание, входящее в собственный критерий, коррелирует
 * само с собой и получает завышенную оценку — тем сильнее, чем короче тест.
 *
 * `null` — считать не на чем: меньше двух респондентов, либо один из рядов без разброса. Задание,
 * которое решили все, никого не различает, и «нулевая дискриминативность» была бы о нём ложью:
 * оно просто ничего не измеряет.
 */
export function itemRestCorrelation(
  itemId: string,
  responses: readonly ItemResponse[],
): number | null {
  const byRespondent = new Map<string, { item: number | null; rest: number[] }>();
  for (const response of responses) {
    if (response.ratio === null) continue;
    let bucket = byRespondent.get(response.respondentId);
    if (!bucket) {
      bucket = { item: null, rest: [] };
      byRespondent.set(response.respondentId, bucket);
    }
    if (response.itemId === itemId) bucket.item = response.ratio;
    else bucket.rest.push(response.ratio);
  }

  const itemValues: number[] = [];
  const restValues: number[] = [];
  for (const bucket of byRespondent.values()) {
    // Респондент, не видевший задания, в корреляцию не идёт: у него нет левой части пары.
    // Респондент, у которого нет ОСТАЛЬНЫХ заданий, — тоже: остатка у него не существует.
    if (bucket.item === null || bucket.rest.length === 0) continue;
    const rest = mean(bucket.rest);
    if (rest === null) continue;
    itemValues.push(bucket.item);
    restValues.push(rest);
  }

  return pearson(itemValues, restValues);
}

/** Крайние группы задания: сколько человек в каждой и какая в них трудность. */
export interface ExtremeGroups {
  /** Доля выборки в каждой группе — 27 % по Келли. */
  share: number;
  size: number;
  /** Средняя доля балла в сильной и слабой группах. */
  topDifficulty: number;
  bottomDifficulty: number;
  /** `D = p_top - p_bottom`. */
  index: number;
}

/**
 * Индекс дискриминации `D` по крайним 27 % (FR-14).
 *
 * 27 % — не «четверть» и не круглое число из головы: при нормальном распределении способностей
 * эта доля даёт максимальную устойчивость контраста между крайними группами (Kelley, 1939).
 * Поэтому и на экране группы называются своим размером, а не «четвертями» (FR-26).
 *
 * `null` — respondentов слишком мало, чтобы в каждой группе оказался хоть один человек, либо
 * задание видели не все из них.
 *
 * @param itemId задание
 * @param responses матрица наблюдений
 * @param ability способности респондентов — общие для всех заданий выборки
 */
export function discriminationIndex(
  itemId: string,
  responses: readonly ItemResponse[],
  ability: AbilityByRespondent,
): ExtremeGroups | null {
  const share = 0.27;

  const seen: Array<{ ability: number; ratio: number }> = [];
  for (const response of responses) {
    if (response.itemId !== itemId || response.ratio === null) continue;
    const value = ability.get(response.respondentId);
    if (value === undefined) continue;
    seen.push({ ability: value, ratio: response.ratio });
  }

  const size = Math.floor(seen.length * share);
  // Пустая группа не даёт контраста: с нулём человек в крайней четверти сравнивать нечего.
  if (size < 1) return null;

  const sorted = [...seen].sort((a, b) => a.ability - b.ability);
  const bottom = sorted.slice(0, size).map(r => r.ratio);
  const top = sorted.slice(sorted.length - size).map(r => r.ratio);

  const topDifficulty = mean(top)!;
  const bottomDifficulty = mean(bottom)!;
  return {
    share,
    size,
    topDifficulty,
    bottomDifficulty,
    index: topDifficulty - bottomDifficulty,
  };
}
