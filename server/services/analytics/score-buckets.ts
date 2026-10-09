/**
 * @module server/services/analytics/score-buckets
 * @description PRD-56 FR-13a: распределение результатов корзинами одной ширины.
 *
 * Корзина включает нижнюю границу и не включает верхнюю, последняя берёт 100: иначе результат
 * ровно 70 попадает сразу в две, а стопроцентный — ни в одну.
 *
 * Цвет задаёт проходной балл, а не порядок полос. Корзина, ВНУТРИ которой проходит порог,
 * красится жёлтым целиком: делить столбик пополам значило бы утверждать, что интервал делится по
 * сдаваемости, — он не делится, в нём есть и сдавшие, и нет. Порог рисуется вертикалью внутри
 * неё, и это работа экрана: расчёт лишь говорит, какая корзина его держит.
 */

/** Ширина корзины в процентных пунктах. Число одно на всю гистограмму — в этом и смысл. */
const WIDTH = 10;

/** Сколько корзин: от нуля до ста. */
const COUNT = 100 / WIDTH;

/** Цвет столбика: что он говорит о сдаваемости. */
export type BucketTone = "error" | "warning" | "success" | "neutral";

export interface ScoreBucket {
  /** Нижняя граница включительно. */
  from: number;
  /** Верхняя граница: не включается, кроме последней корзины. */
  to: number;
  label: string;
  count: number;
  /** Доля от прохождений с результатом, в процентах. */
  share: number;
  tone: BucketTone;
  /** Порог проходит внутри этой корзины — экран рисует в ней вертикаль. */
  holdsThreshold: boolean;
}

/** Номер корзины, которой принадлежит результат. Сто идёт в последнюю. */
function bucketIndexOf(percent: number): number {
  if (percent >= 100) return COUNT - 1;
  if (percent < 0) return 0;
  return Math.floor(percent / WIDTH);
}

/**
 * Разложить результаты по корзинам.
 *
 * @param percents результаты прохождений; прохождения БЕЗ результата сюда не попадают —
 *   у них нет процента, а не ноль (PRD-29 §6.7), и вызывающий отсеивает их до расчёта
 * @param threshold проходной балл теста; `null` — тест не оценивает, и цвета у корзин нет
 */
export function scoreBuckets(
  percents: readonly number[],
  threshold: number | null,
): ScoreBucket[] {
  const counts = new Array<number>(COUNT).fill(0);
  for (const percent of percents) counts[bucketIndexOf(percent)] += 1;

  return counts.map((count, index) => {
    const from = index * WIDTH;
    const last = index === COUNT - 1;
    const to = last ? 100 : from + WIDTH;
    /** Верхняя граница отбора: у последней корзины сто включается. */
    const upper = last ? Number.POSITIVE_INFINITY : to;

    /**
     * Цвет говорит правду о сдаваемости корзины, а не о её месте в ряду:
     * вся ниже порога — красная, вся не ниже — зелёная, а та, где порог проходит ВНУТРИ,
     * содержит и сдавших, и нет — она жёлтая целиком.
     */
    let tone: BucketTone = "neutral";
    let holdsThreshold = false;
    if (threshold !== null) {
      if (threshold <= from) tone = "success";
      else if (threshold >= upper) tone = "error";
      else {
        tone = "warning";
        holdsThreshold = true;
      }
    }

    return {
      from,
      to,
      // Подпись говорит о ЦЕЛЫХ процентах, которые читатель видит в строках: «70–79».
      label: `${from}–${index === COUNT - 1 ? 100 : to - 1}`,
      count,
      share: percents.length > 0 ? (count / percents.length) * 100 : 0,
      tone,
      holdsThreshold,
    };
  });
}
