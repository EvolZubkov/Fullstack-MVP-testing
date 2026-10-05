/**
 * @module features/analytics/levels/analytics-routes
 * @description Адреса трёх уровней аналитики и перенос условий отбора между ними (этап Э2
 * UX-аудита, решения владельца 2026-10-03; эскиз `docs/wireframes/approved/e2-analytics-levels.html`).
 *
 * ```text
 * /author/analytics                                   общая
 * /author/analytics/tests/:testId                     тест
 * /author/analytics/tests/:testId/questions/:qId      вопрос в тесте
 * /author/analytics/questions/:qId                    вопрос банка (PRD-70)
 * ```
 *
 * Модуль чистый: сборка адресов, разбор старого адреса и правила переноса фильтра проверяются
 * без DOM. С историей браузера встречаются хуки уровня.
 */
import { filterToSearch, parseFilter, type RegistryFilter } from "../registry/filter-state";

/** Общий уровень. */
export const ANALYTICS_ROUTE = "/author/analytics";
/** Уровень теста. */
export const ANALYTICS_TEST_ROUTE = "/author/analytics/tests/:testId";
/** Уровень вопроса в тесте. */
export const ANALYTICS_QUESTION_ROUTE = "/author/analytics/tests/:testId/questions/:questionId";
/** PRD-70 FR-40: уровень «вопрос банка» — вопрос по всем тестам читателя. */
export const ANALYTICS_BANK_QUESTION_ROUTE = "/author/analytics/questions/:questionId";
/** Прежний адрес уровня теста — перенаправляется на новый, на него ведут закладки. */
export const LEGACY_TEST_ANALYTICS_ROUTE = "/author/tests/:testId/analytics";

/** Параметр вкладки в адресе. Фильтр его не читает, и вкладка не меняет выборку. */
export const TAB_PARAM = "tab";

/** Добавить к адресу вкладку; пустая вкладка не пишется. */
function withTab(search: string, tab?: string | null): string {
  if (!tab) return search;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set(TAB_PARAM, tab);
  return `?${params.toString()}`;
}

/**
 * Адрес общего уровня.
 *
 * @param filter условия отбора; без них — общий уровень целиком
 * @param tab вкладка
 */
export function generalHref(filter: Partial<RegistryFilter> = {}, tab?: string | null): string {
  return `${ANALYTICS_ROUTE}${withTab(filterToSearch(filter), tab)}`;
}

/**
 * Адрес уровня теста.
 *
 * @param testId тест
 * @param filter условия отбора уровня теста (тест в них не пишется: он задан адресом)
 * @param tab вкладка
 */
export function testHref(testId: string, filter: Partial<RegistryFilter> = {}, tab?: string | null): string {
  const conditions = { ...filter, testIds: [] };
  return `${ANALYTICS_ROUTE}/tests/${encodeURIComponent(testId)}${withTab(filterToSearch(conditions), tab)}`;
}

/**
 * Адрес уровня вопроса в тесте.
 *
 * @param testId тест
 * @param questionId вопрос
 * @param filter условия отбора уровня теста
 */
export function questionHref(testId: string, questionId: string, filter: Partial<RegistryFilter> = {}): string {
  const conditions = { ...filter, testIds: [] };
  return `${ANALYTICS_ROUTE}/tests/${encodeURIComponent(testId)}/questions/${encodeURIComponent(questionId)}${filterToSearch(conditions)}`;
}

/**
 * Адрес страницы вопроса банка (PRD-70 FR-40): условий отбора у неё нет — строки по тестам.
 *
 * @param questionId вопрос
 */
export function bankQuestionHref(questionId: string): string {
  return `${ANALYTICS_ROUTE}/questions/${encodeURIComponent(questionId)}`;
}

/**
 * Куда вести со старого адреса `/author/tests/:testId/analytics?…`.
 *
 * Условия отбора и вкладка сохраняются; `?tab=quality&questionId=…` — ссылка «Открыть в аналитике»
 * из редактора — ведёт на адрес вопроса.
 *
 * @param testId тест
 * @param search строка запроса старого адреса
 */
export function legacyTestRedirect(testId: string, search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const filter = parseFilter(search);
  const questionId = params.get("questionId");
  const tab = params.get(TAB_PARAM);
  if (questionId && (tab === "quality" || !tab)) return questionHref(testId, questionId, filter);
  return testHref(testId, filter, tab);
}

/**
 * Условия общего уровня, перенесённые на уровень теста.
 *
 * Применимое на уровне теста идёт с переходом: группа, период, источник, исход, оргполя. Тест
 * задан страницей и в условия не входит. Варианты и версии публикации принадлежат тесту, поэтому
 * переносятся, только когда общий уровень был отобран ровно по этому тесту, — иначе они говорили
 * бы о другом тесте. Отбор «ошиблись на вопросе» — условие реестра, на уровне теста его нет.
 *
 * @param filter условия общего уровня
 * @param testId тест, в который переходят
 */
export function filterIntoTest(filter: RegistryFilter, testId: string): RegistryFilter {
  const sameTest = filter.testIds.length === 1 && filter.testIds[0] === testId;
  return {
    ...filter,
    testIds: [],
    formIds: sameTest ? filter.formIds : [],
    snapshotIds: sameTest ? filter.snapshotIds : [],
    wrongQuestionIds: undefined,
  };
}

/**
 * Условия, с которыми уровень теста уходит на общий, когда на тест пришли не с общего уровня
 * (ссылка из редактора, закладка): условия уровня теста, отобранные по этому тесту.
 *
 * Пришли с общего — крошка возвращает тот фильтр, с которым с него ушли (см. {@link ReturnState}).
 *
 * @param filter условия уровня теста
 * @param testId тест
 */
export function filterOutOfTest(filter: RegistryFilter, testId: string): RegistryFilter {
  return { ...filter, testIds: [testId] };
}

/**
 * Состояние истории, с которым переходят вниз: куда вести крошку «Аналитика».
 *
 * Лежит в `history.state` записи уровня теста или вопроса. «Назад» и «Вперёд» его сохраняют, а
 * присланная ссылка — нет: по ней крошка ведёт на условия самого уровня.
 */
export interface ReturnState {
  /** Адрес общего уровня, с которого ушли вниз, со всеми его условиями и вкладкой. */
  analyticsReturn: string;
}

/** Достать адрес возврата из состояния записи истории, если он там есть. */
export function returnHrefOf(state: unknown): string | null {
  const value = (state as Partial<ReturnState> | null)?.analyticsReturn;
  return typeof value === "string" && value.startsWith(ANALYTICS_ROUTE) ? value : null;
}
