/**
 * @module features/analytics/test/question-analytics-link
 * @description Адресная ссылка на разбор вопроса в аналитике теста и вкладки уровня теста.
 *
 * «Вопросы теста» в редакторе ведут кнопкой «Открыть в аналитике» прямо на разбор вопроса. С Э2
 * разбор — уровень вопроса со своим адресом, а вкладка уровня теста — параметр `?tab=` (см.
 * `levels/use-analytics-tab`), поэтому разбирать адрес при входе здесь больше нечего.
 */
import { questionHref } from "../levels/analytics-routes";

/** Вкладки уровня теста, на которые можно сослаться. Первая — по умолчанию. */
// Э3.1: «Прохождения» — вторая, сразу за «Обзором» (эскиз approved/e3-test-and-question.html).
// Э3.2: «Срезы» — за «Качеством вопросов»: сравнение срезов там и переехало.
export const TEST_ANALYTICS_TABS = ["overview", "passages", "questions", "quality", "slices", "delivery", "scales"] as const;

/** Вкладка уровня теста. */
export type TestAnalyticsTab = (typeof TEST_ANALYTICS_TABS)[number];

/**
 * Адрес разбора вопроса — уровень вопроса в тесте (Э2): `/author/analytics/tests/:testId/questions/:qId`.
 *
 * @param testId тест
 * @param questionId вопрос
 * @returns относительный адрес уровня вопроса
 */
export function questionAnalyticsHref(testId: string, questionId: string): string {
  return questionHref(testId, questionId);
}
