/**
 * @module features/tests/editor/questions/question-analytics
 * @description Данные прохождений в строке «Вопросов теста» (эскиз
 * `s-composition-questions-analytics`).
 *
 * Строка называет величины психометрики теста теми же словами, что вкладка аналитики
 * «Качество вопросов», а признак вопроса берёт её же функцией `flagOf` — второй копии правил
 * нет. Эвристики ревизии PRD-56 сюда не приходят: их считает сводка теста, отдельный и
 * тяжёлый запрос, и строка показывает следующий по силе признак психометрики.
 */
import { pluralize } from "@/lib/i18n";
import { flagOf, type ItemQualityRow } from "@/features/analytics/test/item-quality";
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
 * @returns строка величин, признак и доступность разбора
 */
export function questionAnalytics(item: ItemQualityRow | undefined): QuestionAnalytics {
  if (!item) return NONE;
  if (item.neverDelivered) return { line: "Вопрос ещё не выдавался", flag: null, canOpen: false };
  const parts: string[] = [];
  if (item.difficulty !== null) parts.push(`трудность ${num(item.difficulty)}`);
  if (item.itemRest !== null) parts.push(`дискриминативность ${num(item.itemRest)}`);
  const n = item.observations;
  parts.push(`${n} ${pluralize(n, "наблюдение", "наблюдения", "наблюдений")}`);
  return { line: parts.join(" · "), flag: flagOf(item), canOpen: n > 0 };
}
