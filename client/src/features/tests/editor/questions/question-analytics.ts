/**
 * @module features/tests/editor/questions/question-analytics
 * @description Данные прохождений в строке «Вопросов теста» (эскиз
 * `s-composition-questions-analytics`).
 *
 * Строка называет величины психометрики теста теми же словами, что вкладка аналитики
 * «Качество вопросов», а признак вопроса берёт её же функцией `flagOf` с теми же эвристиками
 * ревизии PRD-56 (`reviewHeuristicsOf`) — второй копии правил нет, и признак в редакторе
 * совпадает с признаком во вкладке.
 */
import { pluralize } from "@/lib/i18n";
import {
  flagOf,
  type ItemQualityRow,
  type ReviewHeuristic,
} from "@/features/analytics/test/item-quality";
import { num } from "@/features/analytics/test/psychometrics-format";

/** Что строка вопроса показывает из аналитики. */
export type QuestionAnalytics = {
  /** Строка величин; `null` — по вопросу нет данных, строки нет. */
  line: string | null;
  /** Признак вопроса; `null` — признака нет. */
  flag: { tone: "error" | "warning" | "info"; title: string; detail: string } | null;
  /** Есть ли что открыть в разборе: у вопроса есть наблюдения. */
  canOpen: boolean;
};

const NONE: QuestionAnalytics = { line: null, flag: null, canOpen: false };

/**
 * Собрать данные прохождений для строки вопроса.
 *
 * @param item строка психометрики вопроса; нет — по вопросу нечего сказать
 * @param heuristic эвристики ревизии вопроса из сводки теста, если сработали
 * @returns строка величин, признак и доступность разбора
 */
export function questionAnalytics(
  item: ItemQualityRow | undefined,
  heuristic?: ReviewHeuristic,
): QuestionAnalytics {
  if (!item) return NONE;
  if (item.neverDelivered) return { line: "Вопрос ещё не выдавался", flag: null, canOpen: false };
  // Ниже порога наблюдений вкладка «Качество вопросов» пишет вместо числа «мало данных»:
  // «дискриминативность −1,00» на двух ответах ничего не утверждает, но пугает. Строка
  // показывает число только там, где его показывает вкладка; о нехватке говорит признак.
  const parts: string[] = [];
  if (item.difficulty !== null && item.difficultyConfidence !== "insufficient") {
    parts.push(`трудность ${num(item.difficulty)}`);
  }
  if (item.itemRest !== null && item.coefficientConfidence !== "insufficient") {
    parts.push(`дискриминативность ${num(item.itemRest)}`);
  }
  const n = item.observations;
  parts.push(`${n} ${pluralize(n, "наблюдение", "наблюдения", "наблюдений")}`);
  return { line: parts.join(" · "), flag: flagOf(item, heuristic), canOpen: n > 0 };
}
