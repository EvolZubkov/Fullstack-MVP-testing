/**
 * @module shared/template/question-nav.test
 * @description Состояние навигационной строки вопроса. Саму строку рисует МАКЕТ
 * шаблона (`question.html` → `.tb-scene__foot`), а хосты кладут в контекст только
 * эти данные — поэтому проверяется контракт полей, а не разметка.
 */
import { describe, it, expect } from "vitest";
import { buildQuestionNav, QUESTION_NAV_ACTIONS, type QuestionNavState } from "./question-nav";

const flexible: QuestionNavState = {
  flexible: true,
  committed: false,
  canPrev: true,
  answerReady: true,
  hasNext: true,
  showAccept: false,
  showReview: false,
};

describe("buildQuestionNav", () => {
  it("гибкий режим до фиксации: назад, пропустить и отправка ответа", () => {
    const nav = buildQuestionNav(flexible);
    expect(nav).toMatchObject({
      showBack: true,
      canPrev: true,
      showSkip: true,
      showReview: false,
      primaryAction: QUESTION_NAV_ACTIONS.submit,
      primaryLabel: "Отправить ответ",
      primaryEnabled: true,
    });
  });

  it("гасит отправку, пока ответ непригоден", () => {
    expect(buildQuestionNav({ ...flexible, answerReady: false }).primaryEnabled).toBe(false);
  });

  it("гасит «Назад» без доступного предыдущего вопроса", () => {
    expect(buildQuestionNav({ ...flexible, canPrev: false })).toMatchObject({ showBack: true, canPrev: false });
  });

  it("после фиксации — «Далее», без пропуска и без завершения теста", () => {
    const nav = buildQuestionNav({ ...flexible, committed: true });
    expect(nav).toMatchObject({
      showSkip: false,
      primaryAction: QUESTION_NAV_ACTIONS.next,
      primaryLabel: "Далее",
      primaryEnabled: true,
    });
  });

  it("показывает «К обзору», когда в области есть пропущенные", () => {
    expect(buildQuestionNav({ ...flexible, showReview: true }).showReview).toBe(true);
  });

  it("строгий режим: только основная кнопка, без «Назад» и «Пропустить»", () => {
    expect(buildQuestionNav({ ...flexible, flexible: false })).toMatchObject({
      showBack: false,
      showSkip: false,
      showReview: false,
      primaryAction: QUESTION_NAV_ACTIONS.next,
      primaryLabel: "Далее",
    });
  });

  it("строгий режим: «Принять» при показе верного ответа, «Завершить тест» на последнем шаге", () => {
    expect(buildQuestionNav({ ...flexible, flexible: false, showAccept: true })).toMatchObject({
      primaryAction: QUESTION_NAV_ACTIONS.submit,
      primaryLabel: "Принять",
    });
    expect(buildQuestionNav({ ...flexible, flexible: false, hasNext: false })).toMatchObject({
      primaryAction: QUESTION_NAV_ACTIONS.finish,
      primaryLabel: "Завершить тест",
    });
  });
});
