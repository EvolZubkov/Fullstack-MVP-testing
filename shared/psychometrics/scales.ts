/**
 * @module shared/psychometrics/scales
 *
 * Аппарат измерительных ШКАЛ (FR-29 — FR-32).
 *
 * У заданий без эталона нет ни трудности, ни дискриминации: проверять нечего. Единица анализа
 * для них — шкала PRD-5, а не тест, и вопросы считаются согласованными между собой, а не
 * верными или неверными.
 *
 * Значение пункта здесь — ВКЛАД ответа в шкалу со знаком и весом, а не номер выбранной градации
 * (FR-19a). Отсюда и вычислимость «а что, если вклад перевернуть» (FR-31b): переворот меняет
 * знак значения, а наблюдения остаются те же, и пересчёт делается тем же движком.
 */

import { alphaOf, type ItemValue, type Reliability, type ReliabilityGap } from "./reliability";

/** Ответ на пункт шкалы: выбранная градация и вклад этого выбора в шкалу. */
export interface ScaleResponse {
  respondentId: string;
  itemId: string;
  /** Номер градации, начиная с нуля: 0 — крайняя левая. */
  grade: number;
  /** Вклад ответа в шкалу со знаком и весом. */
  value: number;
}

/**
 * Распределение ответов по градациям пункта (FR-30a).
 *
 * Возвращает доли — по одной на каждую градацию, включая невыбранные: гистограмма без пустых
 * столбиков врала бы о форме распределения, а мёртвый пункт узнаётся именно по ней.
 *
 * @param responses ответы на ОДИН пункт
 * @param gradeCount число градаций ВОПРОСА, а не пять: шкалу задаёт автор (PRD-26), и бывает
 *   она четырёх-, семи- и десятибалльной (FR-30b)
 */
export function gradeDistribution(
  responses: readonly ScaleResponse[],
  gradeCount: number,
): number[] {
  const counts = new Array<number>(Math.max(0, gradeCount)).fill(0);
  let total = 0;
  for (const response of responses) {
    if (response.grade < 0 || response.grade >= counts.length) continue;
    counts[response.grade] += 1;
    total += 1;
  }
  if (total === 0) return counts;
  return counts.map(count => count / total);
}

/** Доля одной градации, с которой пункт считается мёртвым: почти все ответили одинаково. */
export const DEAD_ITEM_SHARE = 0.9;

/**
 * Мёртвый пункт: ответы собрались в одной градации (FR-30).
 *
 * Такой пункт ничего не различает — все отвечают одинаково, и в шкале он занимает место, не
 * добавляя информации. На гистограмме он виден мгновенно: один столбик почти во всю высоту.
 */
export function isDeadItem(distribution: readonly number[]): boolean {
  return distribution.some(share => share >= DEAD_ITEM_SHARE);
}

/** Значения пунктов шкалы в виде, пригодном для расчёта надёжности. */
export function scaleValues(responses: readonly ScaleResponse[]): ItemValue[] {
  return responses.map(r => ({ respondentId: r.respondentId, itemId: r.itemId, value: r.value }));
}

/**
 * Альфа шкалы, какой она стала бы с ПЕРЕВЁРНУТЫМ вкладом одного пункта (FR-31b).
 *
 * Отрицательная корреляция пункта с остатком своей шкалы означает ровно одно: пункт ведёт себя
 * противоположно шкале. Причин у этого минимум четыре — обратная формулировка с неперевёрнутым
 * вкладом, пункт не из этой шкалы, перепутанный знак, случайность на малой выборке, — и
 * различить их можно только прочитав формулировку, чего расчёт не делает (FR-31a).
 *
 * Поэтому подпись даёт не догадку о причине, а ВЫЧИСЛИМОЕ следствие: вот какой стала бы альфа.
 * Это проверяемое утверждение, оно подсказывает автору действие и не приписывает системе
 * понимания текста.
 *
 * @param responses ответы на все пункты шкалы
 * @param itemId пункт, вклад которого переворачивается
 */
export function alphaIfMirrored(
  responses: readonly ScaleResponse[],
  itemId: string,
): Reliability | ReliabilityGap {
  return alphaOf(scaleValues(responses).map(value =>
    value.itemId === itemId ? { ...value, value: -value.value } : value,
  ));
}

/**
 * Ипсативная методика: сумма вкладов респондента фиксирована по построению (FR-32).
 *
 * Так устроено распределение баллов (PRD-44): участник раздаёт фиксированный запас между
 * утверждениями, поэтому высокий балл одному пункту НЕИЗБЕЖНО означает низкий другому. Вклады
 * связаны отрицательно не потому, что пункты плохи, а потому, что иначе не бывает, — и альфа
 * там систематически занижена.
 *
 * Число всё равно выводится, но с оговоркой: молча показать заниженный коэффициент как дефект
 * шкалы значит обвинить методику в свойстве её же конструкции.
 *
 * @param responses ответы на пункты шкалы
 * @returns признак того, что суммы респондентов совпадают между собой
 */
export function looksIpsative(responses: readonly ScaleResponse[]): boolean {
  const totals = new Map<string, number>();
  for (const response of responses) {
    totals.set(response.respondentId, (totals.get(response.respondentId) ?? 0) + response.value);
  }
  // Одного респондента мало: совпадать там нечему, и объявлять методику ипсативной по одному
  // человеку значило бы выдать отсутствие данных за вывод.
  if (totals.size < 2) return false;

  const values = [...totals.values()];
  const first = values[0];
  return values.every(total => Math.abs(total - first) < 1e-9);
}
