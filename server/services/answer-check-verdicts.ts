/**
 * @module server/services/answer-check-verdicts
 *
 * Предпроход перед оценкой попытки (PRD-57 FR-28q): авторские выражения считаются В
 * РАБОЧЕМ ПОТОКЕ с бюджетом, и в движок уходят уже готовые вердикты.
 *
 * Почему предпроходом, а не внутри движка: `scoreAnswer` синхронный, и таким он нужен —
 * его же исполняет ES5-двойник в пакете и читают снимок с аналитикой. Асинхронный бюджет
 * внутрь такого движка не помещается, а разделять их на «серверный» и «пакетный» значит
 * получить две оценки одного ответа.
 *
 * Считаются ТОЛЬКО правила-выражения: обычное сравнение и число стоят доли микросекунды,
 * и гонять их через поток значит платить за пересылку больше, чем за саму проверку.
 */
import type { AnswerRuleSet, RuleVerdict } from "@shared/answer-check";
import { isTextEntry } from "@shared/questions/question-type";

import { checkExpressions, type ExpressionJob } from "./regex-runner";

/** Вопрос попытки в том виде, в каком его собрал маршрут завершения. */
export interface VerdictTarget {
  type: string;
  correct: unknown;
  answer: unknown;
  ruleVerdicts?: readonly (RuleVerdict | undefined)[];
}

/** Правила набора, если это вообще набор. */
function rulesOf(correct: unknown): AnswerRuleSet["rules"] {
  const set = correct as AnswerRuleSet | null | undefined;
  return set && Array.isArray(set.rules) ? set.rules : [];
}

/**
 * Посчитать выражения всех написанных ответов и разложить вердикты по вопросам.
 *
 * Вопросы ИЗМЕНЯЮТСЯ на месте: они только что собраны маршрутом, копировать секции целиком
 * ради одного поля значит удвоить память попытки без единого выигрыша.
 *
 * @param questions Вопросы попытки вместе с ответами участника.
 * @param budgetMs  Бюджет одного сравнения.
 */
export async function attachRegexVerdicts(
  questions: VerdictTarget[],
  budgetMs: number,
): Promise<void> {
  const jobs: ExpressionJob[] = [];
  /** Куда положить вердикт очередного задания: вопрос и место правила в наборе. */
  const slots: Array<{ question: VerdictTarget; index: number }> = [];

  for (const question of questions) {
    if (!isTextEntry(question.type as never) || typeof question.answer !== "string") continue;
    rulesOf(question.correct).forEach((rule, index) => {
      if (rule.kind !== "text" || rule.match !== "regex") return;
      jobs.push({ source: rule.value, answer: question.answer as string });
      slots.push({ question, index });
    });
  }

  if (jobs.length === 0) return;

  const verdicts = await checkExpressions(jobs, budgetMs);
  verdicts.forEach((verdict, at) => {
    const { question, index } = slots[at];
    const filled = (question.ruleVerdicts ?? []).slice() as Array<RuleVerdict | undefined>;
    filled[index] = verdict;
    question.ruleVerdicts = filled;
  });
}
