/**
 * @module shared/psychometrics/timing
 *
 * Время на задании как психометрическая величина (FR-34 — FR-36).
 *
 * МЕДИАНА И РАЗМАХ, а не среднее (FR-34). Распределение времени тяжелохвостое по природе
 * прохождения: вкладку оставляют открытой, прогон продолжают после обеда, и одно такое
 * наблюдение сдвигает среднее сильнее, чем полсотни обычных. Медиана его просто не замечает.
 *
 * Метрика всегда несёт СВОЙ объём выборки, отличный от `n` трудности (FR-37b): у наблюдений,
 * собранных до появления замера, времени нет вовсе, и считать их «нулём секунд» нельзя.
 */

/** Медиана и межквартильный размах — то, чем описывается тяжелохвостое распределение. */
export interface TimingSummary {
  medianMs: number;
  /** Границы межквартильного размаха: середина половины наблюдений. */
  q1Ms: number;
  q3Ms: number;
  /** Сколько наблюдений НЕСЛИ время — своя выборка, меньшая общей. */
  measured: number;
}

/** Квантиль по методу линейной интерполяции — тот же, что у большинства статистических пакетов. */
function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * Сводка времени по наблюдениям задания.
 *
 * @param latencies времена наблюдений; `null` означает «не измерялось» и в расчёт не идёт
 * @returns сводка либо `null`, когда измеренных наблюдений нет вовсе
 */
export function summariseTiming(latencies: ReadonlyArray<number | null>): TimingSummary | null {
  const measured = latencies.filter((ms): ms is number => ms !== null && Number.isFinite(ms) && ms >= 0);
  if (measured.length === 0) return null;

  const sorted = [...measured].sort((a, b) => a - b);
  return {
    medianMs: quantile(sorted, 0.5),
    q1Ms: quantile(sorted, 0.25),
    q3Ms: quantile(sorted, 0.75),
    measured: sorted.length,
  };
}

/** Порог доли, с которого «отвечают не читая» становится признаком, а не шумом. */
export const RUSHED_SHARE_THRESHOLD = 0.15;
/** Во сколько раз медиана задания должна превысить медиану теста, чтобы считаться тормозящей. */
export const SLOW_ITEM_FACTOR = 2;
/**
 * Сколько миллисекунд на знак текста задания достаточно, чтобы его успели прочесть.
 *
 * Оценка грубая и намеренно щедрая: взрослый читает 200 - 300 знаков в секунду глазами по
 * диагонали, и 15 мс на знак (около 65 знаков в секунду) — это ниже любого осмысленного чтения.
 * Порог служит признаком «ответили, не читая», а не измерением скорости чтения.
 */
export const MS_PER_CHARACTER = 15;

/**
 * Доля наблюдений, где ответ дан быстрее, чем задание можно было прочесть (FR-35).
 *
 * Порог правдоподобия соотносится с ОБЪЁМОМ ТЕКСТА: три секунды на однострочный вопрос —
 * нормально, на абзац с условием — нет. Поэтому длина текста входит в расчёт, а не берётся
 * единая константа на все задания.
 *
 * @param latencies времена наблюдений
 * @param promptLength длина текста задания в знаках
 * @returns доля от измеренных наблюдений; `null` — измеренных нет
 */
export function rushedShare(
  latencies: ReadonlyArray<number | null>,
  promptLength: number,
): number | null {
  const measured = latencies.filter((ms): ms is number => ms !== null && Number.isFinite(ms) && ms >= 0);
  if (measured.length === 0) return null;
  const floorMs = Math.max(1000, promptLength * MS_PER_CHARACTER);
  return measured.filter(ms => ms < floorMs).length / measured.length;
}

/** Признаки задания по времени — симптомы, которые экран показывает только при срабатывании. */
export interface TimingFlags {
  /**
   * «Отвечают не читая»: доля слишком быстрых ответов выше порога.
   *
   * Сам по себе он причины не называет. При ВЫСОКОЙ трудности это скорее утечка ключа, при
   * низкой — что задание пролистывают; различает их трудность, стоящая рядом, а не флаг.
   */
  rushed: boolean;
  /** «Задание тормозит прогон»: время заметно выше медианы теста при нормальной трудности. */
  slow: boolean;
}

/**
 * Признаки задания по времени (FR-35, FR-36).
 *
 * @param summary сводка времени задания
 * @param rushed доля слишком быстрых ответов
 * @param testMedianMs медиана времени по тесту
 * @param difficulty наблюдаемая трудность задания
 */
export function timingFlags(
  summary: TimingSummary | null,
  rushed: number | null,
  testMedianMs: number | null,
  difficulty: number | null,
): TimingFlags {
  const slow = summary !== null
    && testMedianMs !== null
    && testMedianMs > 0
    && summary.medianMs > testMedianMs * SLOW_ITEM_FACTOR
    // Трудное задание и должно занимать больше времени — это не дефект формулировки, а
    // предмет. Признак ищет перегруженный ТЕКСТ, поэтому трудность обязана быть обычной.
    && difficulty !== null
    && difficulty >= 0.2;

  return {
    rushed: rushed !== null && rushed > RUSHED_SHARE_THRESHOLD,
    slow,
  };
}
