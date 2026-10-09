/**
 * @module shared/psychometrics/question-flag
 * @description Э4б UX-аудита аналитики: признак вопроса «что не так» — ОДНО правило на сервер и
 * клиент.
 *
 * Правило жило в двух местах: клиентский `flagOf` вкладки «Качество вопросов» (с эвристиками
 * ревизии PRD-56) и серверный `suspiciousByPsychometrics` фонового пересчёта Э3.4 (без них). Два
 * экземпляра одного правила расходятся на первом новом признаке — и число в корзине «Тесты с
 * вопросами под подозрением» перестаёт совпадать со списком, который откроется. Теперь оба
 * экрана берут признак отсюда; сервер просто не передаёт эвристики.
 *
 * Порядок проверок — это и есть «сила подозрения» (FR-48): прямой дефект вперёд, спокойный вопрос
 * в конец. Первой идёт отрицательная дискриминативность: сильные, ошибающиеся чаще слабых, почти
 * всегда означают испорченный ключ.
 */

/** Наблюдений, начиная с которых коэффициент вообще выводится (движок: COEFFICIENT_MIN). */
const COEFFICIENT_MIN = 30;

/** Психометрические признаки вопроса — то, что ставит движок. */
export interface QuestionFlagSet {
  negativeDiscrimination: boolean;
  atChanceLevel: boolean;
  /** Может отсутствовать у ответов сервера до PRD-66 FR-16a. */
  weakDiscrimination?: boolean;
  tooHard: boolean;
  tooEasy: boolean;
}

/** Вопрос, как его видит правило: числа и признаки психометрики. */
export interface FlagSource {
  observations: number;
  difficulty: number | null;
  correctedDifficulty: number | null;
  itemRest: number | null;
  discrimination: number | null;
  coefficientConfidence: "insufficient" | "tentative" | "reliable";
  flags: QuestionFlagSet;
  timingFlags: { rushed: boolean; slow: boolean };
  /** Вопрос пула, которого в выборке нет ни у кого: не подозрителен и не здоров. */
  neverDelivered?: boolean;
}

/**
 * Эвристики PRD-56 «Требуют ревизии» одного вопроса и числа, которые их вызвали (FR-05).
 *
 * Считает их сервер по статистике выдачи (`question-review.ts`); здесь они только складываются
 * с психометрикой в один признак.
 */
export interface ReviewHeuristic {
  /** Виды сработавших эвристик: `hard-and-frequent`, `fast-and-wrong`. */
  kinds: string[];
  exposurePercent: number | null;
  correctPercent: number | null;
  latencyMedianMs: number | null;
}

/** Признак словами: тон, симптом и числа, которые его вызвали. */
export interface QuestionFlag {
  tone: "error" | "warning" | "info";
  title: string;
  detail: string;
}

/** Число с запятой и двумя знаками, минус типографский; прочерк, где величины нет. */
function num(value: number | null): string {
  return value === null ? "—" : value.toFixed(2).replace(".", ",").replace("-", "−");
}

/** Процент целым, с неразрывным пробелом: «62 %». */
function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} %`;
}

/** «наблюдение / наблюдения / наблюдений». */
function observationsWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "наблюдение";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "наблюдения";
  return "наблюдений";
}

/**
 * Признак-эвристика словами и числами; подписи — из эскизов PRD-66 и PRD-56.
 *
 * @param heuristic эвристики вопроса; нет — признака нет
 * @returns признак или `null`
 */
export function heuristicFlag(heuristic: ReviewHeuristic | undefined): QuestionFlag | null {
  if (!heuristic) return null;
  if (heuristic.kinds.includes("hard-and-frequent")) {
    return {
      tone: "warning",
      title: "Заезжено и трудно",
      detail: `${percent(heuristic.exposurePercent)} показов, ${percent(heuristic.correctPercent)} верных`,
    };
  }
  if (heuristic.kinds.includes("fast-and-wrong")) {
    const latency = heuristic.latencyMedianMs === null ? "—" : `${Math.round(heuristic.latencyMedianMs / 1000)} с`;
    return {
      tone: "warning",
      title: "Слишком быстрые ответы",
      detail: `медиана ${latency} при ${percent(heuristic.correctPercent)} верных`,
    };
  }
  return null;
}

/** Числа дискриминативности подписью: `r = 0,11, D = 0,08`; без `D` — только `r`. */
function discriminationDetail(row: FlagSource): string {
  return row.discrimination === null
    ? `r = ${num(row.itemRest)}`
    : `r = ${num(row.itemRest)}, D = ${num(row.discrimination)}`;
}

/**
 * Признак вопроса: симптом и числа, которые его вызвали (FR-50).
 *
 * @param row числа и признаки психометрики вопроса
 * @param heuristic эвристики ревизии; сервер фонового пересчёта их не передаёт
 * @returns признак или `null` — «ничего не сошлось»
 */
export function questionFlag(row: FlagSource, heuristic?: ReviewHeuristic): QuestionFlag | null {
  if (row.flags.negativeDiscrimination) {
    return {
      tone: "error",
      title: "Сильные ошибаются чаще",
      // FR-16a: заголовок — симптом, подпись — вероятная причина и числа, на которых она стоит.
      detail: `вероятна ошибка в ключе: r = ${num(row.itemRest)}, D = ${num(row.discrimination)}`,
    };
  }
  if (row.flags.atChanceLevel) {
    return { tone: "error", title: "На уровне угадывания", detail: `с поправкой ${num(row.correctedDifficulty)}` };
  }
  // FR-05, FR-48: эвристики PRD-56 — сразу за прямыми дефектами. На малой выборке они стоят
  // вместо «мало данных»: там это единственное, что можно сказать о вопросе.
  const byHeuristic = heuristicFlag(heuristic);
  if (byHeuristic) return byHeuristic;
  if (row.flags.weakDiscrimination) {
    return { tone: "warning", title: "Сильные и слабые отвечают одинаково", detail: discriminationDetail(row) };
  }
  if (row.timingFlags.rushed) {
    return { tone: "warning", title: "Отвечают не читая", detail: "ответ быстрее, чем вопрос можно прочесть" };
  }
  if (row.flags.tooHard) return { tone: "warning", title: "Слишком трудный", detail: `трудность ${num(row.difficulty)}` };
  if (row.flags.tooEasy) return { tone: "warning", title: "Слишком лёгкий", detail: `трудность ${num(row.difficulty)}` };
  if (row.timingFlags.slow) {
    return { tone: "warning", title: "Тормозит прогон", detail: "время заметно выше медианы теста" };
  }
  if (row.coefficientConfidence === "insufficient") {
    // Сколько СОБРАНО и сколько НУЖНО — оба числа, иначе «мало данных» не подсказывает действия.
    const needed = COEFFICIENT_MIN - row.observations;
    return {
      tone: "info",
      title: "Мало данных",
      detail: `${row.observations} из ${COEFFICIENT_MIN} · нужно ещё ${needed} ${observationsWord(needed)}`,
    };
  }
  return null;
}

/**
 * Под подозрением ли вопрос: есть признак, и это не «мало данных».
 *
 * Одна функция на плитку, счётчик вида, сам отбор и фоновый пересчёт.
 *
 * @param row числа и признаки психометрики вопроса
 * @param heuristic эвристики ревизии
 * @returns под подозрением ли
 */
export function isSuspicious(row: FlagSource, heuristic?: ReviewHeuristic): boolean {
  if (row.neverDelivered) return false;
  const flag = questionFlag(row, heuristic);
  return flag !== null && flag.tone !== "info";
}

/** Попадает ли вопрос в «Мало данных»: коэффициенты не считаются или вопрос не выдавался. */
export function isThin(row: FlagSource): boolean {
  return row.neverDelivered === true || row.coefficientConfidence === "insufficient";
}

/** Ранг вопроса «мало данных» без эвристики: последние в любом порядке (FR-48a). */
export const THIN_RANK = 90;

/**
 * Ранг признака — порядок FR-48: сначала прямые дефекты, потом эвристики, потом спокойные.
 *
 * @param row вопрос
 * @param heuristic его эвристики
 * @returns чем меньше, тем выше в списке
 */
export function suspicionRank(row: FlagSource, heuristic?: ReviewHeuristic): number {
  const hasHeuristic = heuristicFlag(heuristic) !== null;
  if (row.coefficientConfidence === "insufficient") return hasHeuristic ? 3 : THIN_RANK;
  if (row.flags.negativeDiscrimination) return 1;
  if (row.flags.atChanceLevel) return 2;
  if (hasHeuristic) return 3;
  // Решение владельца 2026-09-25: слабая дискриминативность — сразу за эвристиками PRD-56.
  if (row.flags.weakDiscrimination) return 4;
  if (row.timingFlags.rushed) return 5;
  if (row.flags.tooHard) return 6;
  if (row.flags.tooEasy) return 7;
  if (row.timingFlags.slow) return 8;
  return 50;
}

/**
 * Порядок внутри одного ранга — по числу, которое вызвало признак.
 *
 * @param row вопрос
 * @param heuristic его эвристики
 * @returns ключ сортировки внутри ранга
 */
export function withinRank(row: FlagSource, heuristic?: ReviewHeuristic): number {
  if (row.flags.negativeDiscrimination) return row.itemRest ?? 0;
  if (row.flags.atChanceLevel) return row.correctedDifficulty ?? 0;
  // У эвристики признак вызвала доля верных: чем она ниже, тем раньше строка.
  if (heuristicFlag(heuristic)) return (heuristic?.correctPercent ?? 0) / 100;
  if (row.flags.weakDiscrimination) return row.itemRest ?? 0;
  return row.difficulty ?? 0;
}
