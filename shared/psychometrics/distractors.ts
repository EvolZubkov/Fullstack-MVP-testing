/**
 * @module shared/psychometrics/distractors
 *
 * Анализ вариантов ответа (FR-24 — FR-26): кто и как часто выбирал каждый вариант.
 *
 * Трудность и дискриминативность говорят, что с заданием не так; дистракторный анализ говорит,
 * ГДЕ именно. Вариант, которого не выбирает никто, место занимает, а работы не делает; вариант,
 * который выбирают сильные, либо частично верен, либо указывает на ошибку в ключе.
 *
 * Применяется к заданиям с выбором — одним и несколькими ответами. Для сопоставления и
 * ранжирования не применяется вовсе (FR-27): там «вариантов» нет, а есть порядок и пары, и по
 * ним работают трудность с дискриминацией.
 *
 * Разрез по крайним группам — не украшение: именно он показывает, ЧЕМ дистрактор привлекателен.
 * Доли в нём считаются ОТ СВОЕЙ ГРУППЫ (FR-26b), а не от всей выборки: иначе колонка сильных у
 * трудного задания выглядела бы пустой просто потому, что сильных меньше.
 */

import { mean, pearson } from "./stats";
import type { AbilityByRespondent } from "./item-metrics";

/** Выбор одного респондента в одном задании. */
export interface ChoiceResponse {
  respondentId: string;
  /**
   * Индексы выбранных вариантов. Пустой список — задание видели, но ничего не выбрали.
   *
   * Приведение ответа к индексам делает вызывающий: у одиночного выбора это один индекс, у
   * множественного — несколько, а у импорта их восстанавливает кодек строки ответа (FR-28).
   */
  chosen: readonly number[];
}

/** Что известно про один вариант ответа. */
export interface OptionStats {
  index: number;
  /** Верен ли вариант по эталону задания. */
  correct: boolean;
  /** Доля ВСЕХ наблюдений, где вариант выбрали. */
  share: number;
  /** Доля выбравших внутри слабой и сильной крайних групп; `null` — группа пуста. */
  bottomShare: number | null;
  topShare: number | null;
  /**
   * Корреляция выбора этого варианта с баллом-остатком респондента; `null` — считать не на чем.
   *
   * У верного варианта она положительна по построению. У ДИСТРАКТОРА положительная корреляция —
   * симптом: его выбирают сильные, значит вариант либо частично верен, либо ключ неверен.
   */
  restCorrelation: number | null;
}

/** Выводы по варианту, которые делает движок. Причину они не называют — только симптом. */
export interface OptionFlags {
  /** Вариант не выбирает почти никто: работы не делает, место занимает. */
  dead: boolean;
  /** Неверный вариант, который выбирают сильные. */
  inverted: boolean;
  /**
   * ВЕРНЫЙ вариант, который выбирают слабые (отрицательная связь с баллом).
   *
   * Самый яркий симптом испорченного ключа, и до приёмки экран о нём молчал: у верного
   * варианта стоял нейтральный ярлык «Верный ответ», хотя рядом висела корреляция −0,78.
   * Нейтральный ярлык на таком варианте читается как «здесь всё в порядке».
   */
  correctButWeak: boolean;
}

export interface DistractorAnalysis {
  options: OptionStats[];
  /** Сколько наблюдений вошло в разбор. */
  observations: number;
}

/** Порог «мёртвого» варианта: доля выбора, ниже которой вариант считается неработающим. */
export const DEAD_OPTION_SHARE = 0.05;

/**
 * Разобрать варианты одного задания.
 *
 * @param responses выборы респондентов
 * @param correctIndexes индексы верных вариантов по эталону
 * @param optionCount сколько вариантов у задания — чтобы невыбранные тоже попали в разбор
 * @param ability способности респондентов, посчитанные на всей выборке
 */
export function analyseOptions(
  responses: readonly ChoiceResponse[],
  correctIndexes: readonly number[],
  optionCount: number,
  ability: AbilityByRespondent,
): DistractorAnalysis {
  const correct = new Set(correctIndexes);
  const observations = responses.length;
  if (observations === 0 || optionCount < 1) return { options: [], observations };

  // Крайние 27 % — те же группы, по которым считается индекс дискриминации: два разных деления
  // выборки дали бы два разных ответа на один вопрос «кто здесь сильный».
  const ranked = responses
    .map(r => ({ response: r, ability: ability.get(r.respondentId) }))
    .filter((row): row is { response: ChoiceResponse; ability: number } => row.ability !== undefined)
    .sort((a, b) => a.ability - b.ability);
  const groupSize = Math.floor(ranked.length * 0.27);
  const bottom = groupSize >= 1 ? ranked.slice(0, groupSize).map(r => r.response) : null;
  const top = groupSize >= 1 ? ranked.slice(ranked.length - groupSize).map(r => r.response) : null;

  const options: OptionStats[] = [];
  for (let index = 0; index < optionCount; index += 1) {
    const picked = (list: readonly ChoiceResponse[]) => list.filter(r => r.chosen.includes(index)).length;

    // Остаток считается по способности: она и есть доля балла на собственной форме, то есть
    // тот самый балл за вычетом вклада этого задания, приведённый к сопоставимому виду.
    const withAbility = responses
      .map(r => ({ chose: r.chosen.includes(index) ? 1 : 0, ability: ability.get(r.respondentId) }))
      .filter((row): row is { chose: number; ability: number } => row.ability !== undefined);

    options.push({
      index,
      correct: correct.has(index),
      share: picked(responses) / observations,
      bottomShare: bottom ? picked(bottom) / bottom.length : null,
      topShare: top ? picked(top) / top.length : null,
      restCorrelation: pearson(withAbility.map(r => r.chose), withAbility.map(r => r.ability)),
    });
  }

  return { options, observations };
}

/**
 * Симптомы варианта.
 *
 * Именно симптомы, а не причины: положительная корреляция дистрактора значит ровно то, что его
 * выбирают сильные. Частично верен он, двусмысленно сформулирован или ключ ошибочен — по числам
 * не различить, и приписывать расчёту такое знание нельзя (то же правило, что у FR-31a).
 */
export function flagsOf(option: OptionStats): OptionFlags {
  return {
    dead: !option.correct && option.share < DEAD_OPTION_SHARE,
    inverted: !option.correct && option.restCorrelation !== null && option.restCorrelation > 0,
    correctButWeak: option.correct && option.restCorrelation !== null && option.restCorrelation < 0,
  };
}

/** Средняя доля выбора варианта — служебная величина для проверок и отчётов. */
export function meanShare(options: readonly OptionStats[]): number | null {
  return mean(options.map(o => o.share));
}
