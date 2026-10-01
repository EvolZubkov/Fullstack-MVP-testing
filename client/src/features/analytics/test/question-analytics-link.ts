/**
 * @module features/analytics/test/question-analytics-link
 * @description Адресная ссылка на разбор вопроса в аналитике теста.
 *
 * До неё вкладка страницы аналитики и выбранный вопрос жили только в её состоянии, и сослаться
 * на разбор снаружи было нельзя. Теперь «Вопросы теста» в редакторе ведут кнопкой «Открыть в
 * аналитике» прямо на карточку вопроса во вкладке «Качество вопросов».
 *
 * Параметры `tab` и `questionId` делят адрес с фильтром реестра (`registry/filter-state`), и
 * фильтр их не читает, поэтому ссылка не меняет выборку, по которой считается разбор.
 */

/** Вкладки страницы аналитики теста, на которые можно сослаться. */
const TABS = ["overview", "questions", "quality", "delivery", "scales"] as const;

/** Вкладка страницы аналитики теста. */
export type TestAnalyticsTab = (typeof TABS)[number];

/** Что ссылка просит открыть. */
export type QuestionAnalyticsLink = {
  tab: TestAnalyticsTab | "overview";
  /** Вопрос, чей разбор раскрыть; только на вкладке «Качество вопросов». */
  questionId: string | null;
};

/**
 * Адрес разбора вопроса во вкладке «Качество вопросов».
 *
 * @param testId тест
 * @param questionId вопрос
 * @returns относительный адрес страницы аналитики теста
 */
export function questionAnalyticsHref(testId: string, questionId: string): string {
  const params = new URLSearchParams({ tab: "quality", questionId });
  return `/author/tests/${encodeURIComponent(testId)}/analytics?${params.toString().replace(/\+/g, "%20")}`;
}

/**
 * Прочитать ссылку из строки поиска адреса.
 *
 * @param search `window.location.search`, с `?` или без
 * @returns вкладка (неизвестная — «Обзор») и вопрос (только при «Качестве вопросов»)
 */
export function readQuestionAnalyticsLink(search: string): QuestionAnalyticsLink {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = params.get("tab");
  const tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as TestAnalyticsTab) : "overview";
  const questionId = tab === "quality" ? params.get("questionId") || null : null;
  return { tab, questionId };
}
