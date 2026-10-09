/**
 * @module shared/review/anchor
 *
 * PRD-52: якорь комментария рецензирования и резолвер «якорь — цель перехода».
 *
 * Якорь — СУЩНОСТЬ (вопрос, страница контента, тема, экран, тест целиком), а не
 * позиция в прогоне: выборка вопросов меняется от запуска к запуску, и позиционный
 * якорь потерял бы смысл на следующем же прогоне.
 *
 * Резолвер живёт в `shared/`, потому что его зовут три потребителя — панель во
 * вкладке ящика теста, панель в отладчике и разбор ссылки `?review=<id>`. Второй
 * копии правила быть не должно: расхождение проявилось бы как «переход ведёт не
 * туда» только у одного из входов.
 */

import type { ReviewAnchorKind } from "../schema";

export type { ReviewAnchorKind };

/** Куда указывает комментарий. Идентификаторы заполнены по виду якоря. */
export interface ReviewAnchor {
  kind: ReviewAnchorKind;
  questionId?: string | null;
  topicId?: string | null;
  contentPageId?: string | null;
}

/**
 * Вкладка ящика теста, на которую ведёт якорь.
 *
 * Ключи — дерево вкладок редактора после перестройки 2026-09-03 (шесть вкладок по
 * вопросу автора плюс «Комментарии»). Список держится ЗДЕСЬ, а не импортируется из
 * клиента, потому что резолвер общий для клиента и сервера; при следующей смене
 * дерева правится одно это место.
 */
export type TestEditorTab = "main" | "composition" | "rules" | "scoring" | "feedback" | "design";

/**
 * Цель перехода. Клиент открывает по ней нужный редактор — ящиком ПОВЕРХ панели,
 * так что список комментариев остаётся на месте и возвращаться некуда.
 */
export type AnchorTarget =
  | { target: "question-editor"; questionId: string }
  | { target: "content-page-editor"; contentPageId: string }
  | { target: "test-editor"; tab: TestEditorTab; topicId?: string };

/**
 * Разрешает якорь в цель перехода. Возвращает `null`, если якорь неполон —
 * например, вид `question` без идентификатора вопроса. Молчание здесь лучше
 * догадки: открыть «какой-нибудь» вопрос хуже, чем не открыть ничего.
 */
export function resolveAnchorTarget(anchor: ReviewAnchor): AnchorTarget | null {
  switch (anchor.kind) {
    case "question":
      return anchor.questionId ? { target: "question-editor", questionId: anchor.questionId } : null;
    case "content-page":
      return anchor.contentPageId
        ? { target: "content-page-editor", contentPageId: anchor.contentPageId }
        : null;
    case "topic":
      // Раздел живёт в «Составе и сценарии» — там его выборка, квоты и место в полотне.
      return anchor.topicId
        ? { target: "test-editor", tab: "composition", topicId: anchor.topicId }
        : { target: "test-editor", tab: "composition" };
    case "start":
      // Стартовая страница — узел полотна, а не оформление: правят её там же, где
      // остальную структуру прохождения.
      return { target: "test-editor", tab: "composition" };
    case "results":
      // Экран итогов собирается на «Обратной связи и итогах»: состав подблоков,
      // надписи, тексты после теста. «Оформление» отвечает только за шаблон.
      return { target: "test-editor", tab: "feedback" };
    case "test":
      return { target: "test-editor", tab: "main" };
  }
}

/**
 * Можно ли перейти по якорю. Удалённый объект оставляет комментарий читаемым —
 * его контекст хранится снимком, — но переход гасит: вести некуда.
 */
export function isAnchorNavigable(anchor: ReviewAnchor, state: { orphaned: boolean }): boolean {
  if (state.orphaned) return false;
  return resolveAnchorTarget(anchor) !== null;
}
