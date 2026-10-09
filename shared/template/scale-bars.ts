/**
 * @module shared/template/scale-bars
 *
 * Линейчатая диаграмма шкал: горизонтальные столбики всех шкал в ОДНОЙ фигуре, с числом
 * у каждого. Печатается вместо списка карточек и уживается с розой или радаром рядом —
 * это другой способ показать те же шкалы, а не другая диаграмма.
 *
 * Масштаб задаёт САМЫЙ БОЛЬШОЙ БАЛЛ этой попытки: он занимает всю ширину поля, остальные
 * столбики короче ровно во столько раз, во сколько меньше их баллы. Это не линейка
 * прогресса: доли домена здесь не показываются, дорожки до максимума шкалы нет, и вопрос,
 * на который отвечает фигура, — «какая шкала выражена сильнее и насколько», а не «сколько
 * набрано из возможного». Поэтому домен шкале и не нужен: диаграмма строится и там, где
 * методика границ не объявила.
 *
 * Числа печатаются сырыми баллами методики. Проценты были бы вторым, не существующим у
 * методики показателем, а длина столбика и так сообщает соотношение.
 *
 * Чистый — ни DOM, ни Node; бандлится в SCORM-пакет как есть.
 */

import { measureBarColor, type CtxMeasureView } from "./measure-view";
import type { HslTriple, LevelRamp } from "./level-ramp";
import type { ScaleInterpretation, IndicatorInterpretation } from "../scales/interpretation";

/** Одна строка диаграммы: имя, столбик, число. */
export interface CtxScaleBar {
  key: string;
  name: string;
  /** Печатается ли имя — тумблер слота карточки (PRD-49) действует и здесь. */
  hideName?: boolean;
  /** Балл как число: «21». */
  valueText: string;
  /** Балл с максимумом, когда автор его показывает: «21 из 98», иначе «21». */
  valueLabel: string;
  /** Печатать ли число: скрытое значение (видимость «уровень») его не раскрывает. */
  showValue: boolean;
  /** Длина столбика в процентах от САМОГО БОЛЬШОГО балла фигуры. */
  widthPercent: number;
  /** Цвет столбика — HSL-тройка, как везде в оформлении (`hsl(var(--tb-zone))`). */
  color: HslTriple;
  /** Метка уровня, когда методика её даёт и автор её показывает. */
  levelLabel: string;
  hideLevel?: boolean;
  toneClass: string;
}

/** Диаграмма целиком. `null` — печатать нечего, список карточек остаётся за старшего. */
export interface CtxScaleBars {
  rows: CtxScaleBar[];
  ariaLabel: string;
}

/** Мера с её интерпретацией — то же, что читает карточка. */
export interface ScaleBarInput {
  key: string;
  name: string;
  value: number | string | boolean | null | undefined;
  interpretation: ScaleInterpretation | IndicatorInterpretation;
  /** Цвет шкалы из «Оформления шкал», если автор его задал. */
  color?: HslTriple;
}

export interface ScaleBarsInput {
  /** Меры в порядке печати. Карточки уже построены — из них берутся готовые надписи. */
  measures: ScaleBarInput[];
  /** Карточки тех же мер, той же длины и в том же порядке. */
  views: CtxMeasureView[];
  ramp: LevelRamp;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function numeric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Положение балла в СВОЁМ домене, 0..1 — этим красится столбик. Домена нет — середина
 * рампы: цвет обязан что-то значить, а без границ сказать «высоко» или «низко» не о чем.
 */
function ownRatio(interpretation: ScaleInterpretation | IndicatorInterpretation, value: number): number {
  const { domainMin, domainMax } = interpretation;
  if (domainMin === null || domainMax === null) return 0.5;
  const span = domainMax - domainMin;
  if (!(span > 0)) return 0.5;
  const r = (value - domainMin) / span;
  return r < 0 ? 0 : r > 1 ? 1 : r;
}

/**
 * Построить диаграмму, или `null`, когда её не из чего собрать.
 *
 * Отказ — не ошибка, а обычный ход: измерений может не быть числовых вовсе, либо все баллы
 * равны нулю, и тогда рисовать нечего — ни один столбик не имел бы длины. Макет в этом
 * случае печатает карточки, как раньше.
 */
export function buildScaleBars(input: ScaleBarsInput): CtxScaleBars | null {
  const values: number[] = [];
  input.measures.forEach((m, i) => {
    if (input.views[i] && numeric(m.value)) values.push(m.value);
  });
  if (!values.length) return null;

  // Ось — самый большой балл фигуры. Отрицательные и нулевые баллы длины не дают: столбик
  // растёт вправо от общего начала, и рисовать влево здесь нечем.
  const top = Math.max(...values);
  if (!(top > 0)) return null;

  const rows: CtxScaleBar[] = [];
  input.measures.forEach((m, i) => {
    const view = input.views[i];
    if (!view || !numeric(m.value)) return;
    const share = m.value / top;
    rows.push({
      key: m.key,
      name: m.name,
      ...(view.hideName ? { hideName: true } : {}),
      valueText: view.valueText,
      valueLabel: view.valueLabel,
      showValue: view.showValue,
      widthPercent: round1((share < 0 ? 0 : share > 1 ? 1 : share) * 100),
      // Цвет — от положения в СВОЁМ домене, а не от доли на фигуре: он говорит об уровне
      // шкалы, и на общем масштабе высокий балл короткой шкалы выглядел бы низким.
      color: measureBarColor(m.interpretation.valence, input.ramp, m.color, ownRatio(m.interpretation, m.value)),
      levelLabel: view.levelLabel,
      ...(view.hideLevel ? { hideLevel: true } : {}),
      toneClass: view.toneClass,
    });
  });
  if (!rows.length) return null;

  return {
    rows,
    // Стопка полос ничего не говорит читалке сама по себе — то же соображение, что у
    // линейки в карточке: подпись собирается ядром, потому что макету не из чего.
    ariaLabel: `Шкалы: ${rows.map((r) => `${r.name} — ${r.valueText}`).join(", ")}`,
  };
}
