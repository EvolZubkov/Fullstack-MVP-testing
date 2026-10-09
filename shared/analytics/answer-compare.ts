/**
 * @module shared/analytics/answer-compare
 * @description PRD-56 FR-07m, FR-07n: сравнение разброса ответов между срезами.
 *
 * Модуль чистый и живёт в `shared`, потому что «Расхождение» зависит от того, КАКИЕ срезы стоят
 * в слотах: сервер отдаёт разброс каждого доступного среза, а сводит выбранные экран — по тому
 * же правилу, что проверяет тест.
 *
 * Доли — в процентах (0–100), как у «Разброса ответов» вкладки «Вопросы», поэтому разность двух
 * долей — сразу процентные пункты. Доли округляются до целых здесь, до любой разности: экран
 * показывает целые проценты, и разница, посчитанная по точным долям, не сходилась бы с видимыми
 * числами — «13 %» и «7 %» с «Разницей +7 п.п.» (найдено приёмкой).
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
  /**
   * Вариант, на котором размах наибольший. Без расхождения — тот же выбор по всем срезам с
   * ответами, включая тонкие: строке есть что показать, а в расхождение тонкий срез не входит.
   * `null` — ответов меньше чем в двух срезах.
   */
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
        return Math.round(spread.options.find(option => option.label === label)?.share ?? 0);
      }),
    }));

    // В расхождение идут только срезы с ответами не меньше минимума: доля от шести ответов
    // прыгает на 17 п.п. от одного человека, и такой «размах» был бы шумом, а не различием.
    const eligible = answered.map((count, index) => count > 0 && !thin[index]);
    const widest = (within: boolean[]): { range: number; index: number } | null => {
      if (within.filter(Boolean).length < 2) return null;
      let best: { range: number; index: number } | null = null;
      options.forEach((option, index) => {
        const values = option.shares.filter((share, slot): share is number => within[slot] && share !== null);
        const range = Math.max(...values) - Math.min(...values);
        if (!best || range > best.range) best = { range, index };
      });
      return best;
    };
    const counted = widest(eligible);
    // Тонкий срез в расхождение не входит, но строке без расхождения всё равно есть что показать.
    const shown = counted ?? widest(answered.map(count => count > 0));
    rows.push({
      questionId, answered, thin, options,
      spread: counted ? counted.range : null,
      topIndex: shown ? shown.index : null,
    });
  }
  return rows;
}

/** С какого расхождения оно выделяется тегом, в процентных пунктах (FR-07n). */
export const NOTABLE_SPREAD = 10;
