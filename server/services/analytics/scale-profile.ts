/**
 * @module server/services/analytics/scale-profile
 * @description PRD-56 FR-21, FR-21a, FR-21b: профиль измерительного теста по шкалам.
 *
 * Две величины на шкалу: среднее значение с объёмом выборки и распределение по полосам
 * толкования. Данные копятся давно (`result_json.scaleResults` у веба, `scales_json` у LMS) и
 * до этой работы не читались никем.
 *
 * УРОВЕНЬ СЧИТАЕТСЯ ПО ПОЛОСАМ САМОЙ ШКАЛЫ, а не берётся из записи прохождения: импорт выгрузки
 * подписи уровня не хранит вовсе, и читать её у одного источника, а считать у другого значит
 * получить два разных распределения на одних и тех же данных.
 *
 * ЦВЕТ НЕ ИЗОБРЕТАЕТСЯ (FR-21a). У шкалы с направлением — рампа уровней теста с учётом
 * валентности; у шкалы без направления — категориальная палитра утверждённого эскиза
 * (`category-colors`). Раздавать цвет по порядку полос запрещено:
 * иначе «Риск» окажется красным в итогах участника и другого цвета в аналитике, а «высокий»
 * покрасится одинаково у шкалы, где выше лучше, и у той, где выше хуже.
 */

import {
  findBand,
  parseScaleInterpretation,
  type InterpretationBand,
  type LevelTone,
  type Valence,
} from "@shared/scales/interpretation";
import { zoneColors, type LevelRamp } from "@shared/template/level-ramp";
import type { ScaleValuesRow } from "../../storage/analytics-repository";
import { categoryColor, LEVEL_CATEGORY_COLORS } from "./category-colors";

/** Шкала теста в том виде, в каком её читает профиль. */
export interface ProfileScale {
  key: string;
  label: string;
  configJson: unknown;
}

export interface ScaleBandShare {
  level: string;
  label: string;
  count: number;
  /** Доля прохождений, попавших в полосу, в процентах. */
  share: number;
  /**
   * ГОТОВЫЙ CSS-цвет полосы (`hsl(142 76% 36%)`), а не тройка.
   *
   * Обёртка живёт здесь, потому что цвет решается здесь же: экран его только печатает и о
   * формате хранения троек знать не должен. Заодно в клиенте не появляется того, что гард
   * цветов ДС читает как литерал, — и правильно читает: место для литерала цвета в
   * приложении одно, и оно не в компоненте.
   */
  color: string;
  /** Тон, заданный АВТОРОМ; `null` — цвет пришёл из рампы теста. */
  tone: LevelTone | null;
}

export interface ScaleProfile {
  key: string;
  label: string;
  average: number | null;
  /** Сколько прохождений дали значение этой шкале — знаменатель среднего. */
  sampleSize: number;
  domainMin: number | null;
  domainMax: number | null;
  /** Полосы толкования есть не у всякой шкалы (FR-21b). */
  hasBands: boolean;
  bands: ScaleBandShare[];
}

export interface ScaleProfileOptions {
  /** Рампа уровней теста (`rampFromParams`) — по ней красится полоса без авторского тона. */
  ramp: LevelRamp;
}

/**
 * Shares of the values in each interpretation band, coloured by the test's level ramp.
 *
 * Shared by scales and numeric indicators (PRD-56 FR-21d): a band of an indicator must take the
 * same colour as the same band of a scale, or the two cards of one tab would contradict each
 * other.
 *
 * @param values the measured values (only runs that produced one)
 * @param interpretation the bands and the valence of the scale or indicator
 * @param ramp the test's level ramp
 * @returns one share per band, in the author's band order
 */
export function bandShares(
  values: readonly number[],
  interpretation: { bands: InterpretationBand[]; valence: Valence },
  ramp: LevelRamp,
): ScaleBandShare[] {
  // Without a direction the levels carry no «better» or «worse»: they take the categorical
  // palette agreed in the approved wireframe, not the ramp (whose neutral form is a grey that
  // makes the levels indistinguishable). With a direction — the ramp, as in the learner's results.
  const colors = interpretation.valence === "none"
    ? interpretation.bands.map((_, index) => categoryColor(LEVEL_CATEGORY_COLORS, index))
    : zoneColors(ramp, interpretation.bands.length, interpretation.valence).map(triple => `hsl(${triple})`);
  return interpretation.bands.map((band, index) => {
    const count = values.filter(value => findBand(interpretation.bands, value) === band).length;
    return {
      level: band.level,
      label: band.label ?? band.level,
      count,
      share: values.length > 0 ? (count / values.length) * 100 : 0,
      color: colors[index],
      // Тон автора печатается как есть; цвет полосы при этом остаётся из рампы, а тон
      // говорит экрану, что оценка ЗАДАНА, а не выведена из порядка.
      tone: band.tone ?? null,
    };
  });
}

/**
 * Профиль по каждой шкале теста.
 *
 * @param rows значения шкал прохождений (оба источника)
 * @param scales шкалы теста
 * @param opts рампа уровней теста
 */
export function summariseScales(
  rows: readonly ScaleValuesRow[],
  scales: readonly ProfileScale[],
  opts: ScaleProfileOptions,
): ScaleProfile[] {
  return scales.map(scale => {
    const interpretation = parseScaleInterpretation(scale.configJson);
    // Прохождение без значения этой шкалы в знаменатель не идёт: иначе среднее занижается
    // ровно на число тех, кто до её вопросов не дошёл.
    const values = rows
      .map(row => row.values[scale.key])
      .filter((value): value is number => typeof value === "number");

    const bands = bandShares(values, interpretation, opts.ramp);

    return {
      key: scale.key,
      label: scale.label || scale.key,
      // Ноль прохождений — среднего нет, а не ноль: ноль означал бы измеренный ноль.
      average: values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null,
      sampleSize: values.length,
      domainMin: interpretation.domainMin,
      domainMax: interpretation.domainMax,
      hasBands: interpretation.bands.length > 0,
      // Распределение строится только там, где есть по чему: у шкалы без полос его нет, и
      // пустая полоса читалась бы как «никто никуда не попал».
      bands: values.length > 0 ? bands : [],
    };
  });
}
