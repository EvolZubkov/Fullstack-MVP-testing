/**
 * @module shared/template/question-nav.test
 * @description Состояние навигационной строки вопроса. Саму строку рисует МАКЕТ
 * шаблона (`question.html` → `.tb-scene__foot`), а хосты кладут в контекст только
 * эти данные — поэтому проверяется контракт полей, а не разметка.
 */
import { describe, it, expect } from "vitest";
import { buildQuestionNav, QUESTION_NAV_ACTIONS, type QuestionNavState } from "./question-nav";

// twoStep base: flexible, NOT quick — today's flexible two-click behaviour.
const flexible: QuestionNavState = {
  flexible: true,
  quickAdvance: false,
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

  it("строгий режим (сегодняшнее поведение — быстрый переход ВКЛ по умолчанию): только основная кнопка, без «Назад» и «Пропустить»", () => {
    expect(buildQuestionNav({ ...flexible, flexible: false, quickAdvance: true })).toMatchObject({
      showBack: false,
      showSkip: false,
      showReview: false,
      primaryAction: QUESTION_NAV_ACTIONS.next,
      primaryLabel: "Далее",
    });
  });

  it("строгий режим: «Принять» при показе верного ответа, «Завершить тест» на последнем шаге", () => {
    expect(buildQuestionNav({ ...flexible, flexible: false, quickAdvance: true, showAccept: true })).toMatchObject({
      primaryAction: QUESTION_NAV_ACTIONS.submit,
      primaryLabel: "Принять",
    });
    expect(buildQuestionNav({ ...flexible, flexible: false, quickAdvance: true, hasNext: false })).toMatchObject({
      primaryAction: QUESTION_NAV_ACTIONS.finish,
      primaryLabel: "Завершить тест",
    });
  });

  // ─── PRD-43: quickAdvance × flexible — all 4 combinations ────────────────────

  it("строгий + быстрый переход (сегодняшнее строгое поведение): один клик «Далее» фиксирует и переходит", () => {
    const nav = buildQuestionNav({ ...flexible, flexible: false, quickAdvance: true });
    expect(nav).toMatchObject({
      showBack: false,
      showSkip: false,
      primaryAction: QUESTION_NAV_ACTIONS.next,
      primaryLabel: "Далее",
      primaryEnabled: true,
    });
  });

  it("строгий + быстрый переход, последний вопрос: один клик «Завершить тест»", () => {
    expect(
      buildQuestionNav({ ...flexible, flexible: false, quickAdvance: true, hasNext: false }),
    ).toMatchObject({
      primaryAction: QUESTION_NAV_ACTIONS.finish,
      primaryLabel: "Завершить тест",
    });
  });

  it("строгий + БЕЗ быстрого перехода (новая комбинация): «Отправить ответ», затем отдельно «Далее»", () => {
    const beforeCommit = buildQuestionNav({ ...flexible, flexible: false, quickAdvance: false });
    expect(beforeCommit).toMatchObject({
      showBack: false,
      showSkip: false,
      primaryAction: QUESTION_NAV_ACTIONS.submit,
      primaryLabel: "Отправить ответ",
    });
    const afterCommit = buildQuestionNav({
      ...flexible,
      flexible: false,
      quickAdvance: false,
      committed: true,
    });
    expect(afterCommit).toMatchObject({
      primaryAction: QUESTION_NAV_ACTIONS.next,
      primaryLabel: "Далее",
      primaryEnabled: true,
    });
  });

  it("строгий + БЕЗ быстрого перехода, уже зафиксированный последний вопрос: «Завершить тест», не «Далее»", () => {
    const nav = buildQuestionNav({
      ...flexible,
      flexible: false,
      quickAdvance: false,
      committed: true,
      hasNext: false,
    });
    expect(nav).toMatchObject({
      primaryAction: QUESTION_NAV_ACTIONS.finish,
      primaryLabel: "Завершить тест",
    });
  });

  it("гибкий + быстрый переход (новая комбинация): Назад/Пропустить остаются, но один клик «Далее» фиксирует и переходит", () => {
    const nav = buildQuestionNav({ ...flexible, flexible: true, quickAdvance: true });
    expect(nav).toMatchObject({
      showBack: true,
      showSkip: true,
      primaryAction: QUESTION_NAV_ACTIONS.next,
      primaryLabel: "Далее",
      primaryEnabled: true,
    });
  });

  it("гибкий + быстрый переход, уже зафиксированный вопрос (возврат назад): просто «Далее», без повторной фиксации", () => {
    const nav = buildQuestionNav({ ...flexible, flexible: true, quickAdvance: true, committed: true });
    expect(nav).toMatchObject({
      showSkip: false,
      primaryAction: QUESTION_NAV_ACTIONS.next,
      primaryLabel: "Далее",
      primaryEnabled: true,
    });
  });

  it("показ правильного ответа блокирует быстрый переход даже если quickAdvance=true (двухшаговая «Принять» → «Далее»)", () => {
    const nav = buildQuestionNav({
      ...flexible,
      flexible: false,
      quickAdvance: true,
      showAccept: true,
    });
    expect(nav).toMatchObject({
      primaryAction: QUESTION_NAV_ACTIONS.submit,
      primaryLabel: "Принять",
    });
  });
});
