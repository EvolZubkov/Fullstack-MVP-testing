/**
 * @module shared/analytics/answer-compare
 * @description PRD-56 FR-07m, FR-07n: сравнение разброса ответов между срезами.
 *
 * Модуль чистый и живёт в `shared`, потому что «Расхождение» зависит от того, КАКИЕ срезы стоят
 * в слотах: сервер отдаёт разброс каждого доступного среза, а сводит выбранные экран — по тому
 * же правилу, что проверяет тест.
 *
 * Доли — в процентах (0–100), как у «Разброса ответов» вкладки «Вопросы», поэтому разность двух
 * долей — сразу процентные пункты.
 */

/** Разброс одного вопроса в одном срезе — то, что сервер отдаёт по срезу. */
export interface SliceQuestionSpread {
  questionId: string;
  /** Сколько ответов легло в основу. */
  answered: number;
  options: ReadonlyArray<{ label: string; share: number }>;
}

/** Строка вопроса в сравнении выбранных срезов. */
export interface CompareQuestionRow {
  questionId: string;
  /** Ответов по каждому выбранному срезу, в порядке слотов. */
  answered: number[];
  /** Срез ниже минимума наблюдений: его доли показываются, но в расхождение не входят. */
  thin: boolean[];
  /**
   * Варианты в порядке первого появления; доля по каждому срезу, `null` — срез на вопрос не
   * отвечал вовсе (а не «ноль процентов»).
   */
  options: Array<{ label: string; shares: Array<number | null> }>;
  /**
   * Наибольший по вариантам размах долей между срезами, в процентных пунктах. `null` — срезов,
   * годных к сравнению (ответы есть и их не меньше минимума), меньше двух: сравнивать не с чем.
   */
  spread: number | null;
  /** Вариант, на котором размах наибольший; `null` вместе с `spread`. */
  topIndex: number | null;
}

/**
 * Свести разброс выбранных срезов по каждому вопросу.
 *
 * @param slices разброс каждого выбранного среза по вопросам, в порядке слотов
 * @param questionIds вопросы, которые нужно показать, в порядке теста
 * @param minObservations минимум ответов, с которого срез входит в расхождение
 * @returns строка на каждый вопрос, на который ответил хотя бы один срез
 */
export function compareAnswerSpreads(
  slices: ReadonlyArray<ReadonlyMap<string, SliceQuestionSpread>>,
  questionIds: readonly string[],
  minObservations: number,
): CompareQuestionRow[] {
  const rows: CompareQuestionRow[] = [];
  for (const questionId of questionIds) {
    const perSlice = slices.map(slice => slice.get(questionId));
    if (perSlice.every(spread => !spread || spread.answered === 0)) continue;

    const labels: string[] = [];
    for (const spread of perSlice) {
      for (const option of spread?.options ?? []) {
        if (!labels.includes(option.label)) labels.push(option.label);
      }
    }
    const answered = perSlice.map(spread => spread?.answered ?? 0);
    const thin = answered.map(count => count < minObservations);
    const options = labels.map(label => ({
      label,
      shares: perSlice.map(spread => {
        if (!spread || spread.answered === 0) return null;
        // Варианта нет в разбросе среза — его не выбрал никто: это ноль, а не «не известно».
        return spread.options.find(option => option.label === label)?.share ?? 0;
      }),
    }));

    // В расхождение идут только срезы с ответами не меньше минимума: доля от шести ответов
    // прыгает на 17 п.п. от одного человека, и такой «размах» был бы шумом, а не различием.
    const eligible = answered.map((count, index) => count > 0 && !thin[index]);
    let spread: number | null = null;
    let topIndex: number | null = null;
    if (eligible.filter(Boolean).length >= 2) {
      options.forEach((option, index) => {
        const values = option.shares.filter((share, slot): share is number => eligible[slot] && share !== null);
        const range = Math.max(...values) - Math.min(...values);
        if (spread === null || range > spread) {
          spread = range;
          topIndex = index;
        }
      });
    }
    rows.push({ questionId, answered, thin, options, spread, topIndex });
  }
  return rows;
}

/** С какого расхождения оно выделяется тегом, в процентных пунктах (FR-07n). */
export const NOTABLE_SPREAD = 10;
