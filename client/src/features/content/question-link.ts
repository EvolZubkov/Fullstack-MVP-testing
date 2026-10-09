/**
 * @module features/content/question-link
 * @description Ссылка на вопрос в разделе «Темы и вопросы».
 *
 * Аналитика ставит диагноз («Сильные ошибаются чаще»), а чинят вопрос в его теме. Переход
 * между ними — адрес `/author/content?questionId=<id>`: раздел по нему раскрывает тему вопроса
 * и открывает его редактор. Имя параметра живёт здесь одно на обе стороны, иначе ссылка и её
 * читатель разошлись бы при первой же правке.
 */

/** Имя параметра адреса, по которому раздел «Темы и вопросы» открывает вопрос. */
export const QUESTION_PARAM = "questionId";

/** Путь раздела «Темы и вопросы». */
export const CONTENT_PATH = "/author/content";

/**
 * Адрес раздела «Темы и вопросы», открытого на вопросе.
 *
 * @param questionId идентификатор вопроса
 * @returns путь с параметром `questionId`
 */
export function questionInTopicHref(questionId: string): string {
  return `${CONTENT_PATH}?${new URLSearchParams({ [QUESTION_PARAM]: questionId }).toString()}`;
}

/**
 * Вопрос, на котором раздел просят открыть, — из строки запроса адреса.
 *
 * @param search строка запроса (`location.search`)
 * @returns идентификатор вопроса или `null`, если его нет
 */
export function questionFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(QUESTION_PARAM);
  return value && value.trim() ? value.trim() : null;
}

/**
 * Строка запроса без параметра вопроса: остальные параметры сохраняются как были.
 *
 * Раздел убирает параметр, как только открыл вопрос, — иначе перезагрузка или «Назад»
 * снова открыли бы редактор, который автор уже закрыл.
 *
 * @param search строка запроса (`location.search`), с `?` или без
 * @returns строка запроса с ведущим `?` или пустая строка, если параметров не осталось
 */
export function searchWithoutQuestion(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(QUESTION_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
