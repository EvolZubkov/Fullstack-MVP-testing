// @vitest-environment jsdom
/**
 * @module client/pages/learner/template-question-screen.short-answer.test
 *
 * PRD-57 §6.5: the web host draws the typed-answer field from the SHARED renderer and
 * hands the raw string back. Both halves are checked here — the markup in the
 * interaction slot, and the answer travelling up on every keystroke, untrimmed.
 */

import { describe, it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TemplateQuestionScreen } from "../template-question-screen";
import type { Question } from "@shared/schema";

const LAYOUT = `
<div class="layout-question-wrap">
  <div class="question-card">
    <div class="question-text" data-slot="question-text"></div>
    <div data-slot="question-media"></div>
    <div data-slot="question-interaction"></div>
    <div data-slot="question-feedback"></div>
  </div>
</div>`;

const question = {
  id: "q1",
  type: "short",
  prompt: "Кто выдаёт наряд-допуск?",
  dataJson: {},
  correctJson: {
    answerKind: "text",
    join: "any",
    rules: [{ kind: "text", match: "wildcard", value: "Ростехнадзор" }],
  },
  mediaUrl: null,
  mediaType: null,
} as unknown as Question;

const NAV = {
  flexible: false,
  quickAdvance: true,
  committed: false,
  canPrev: false,
  answerReady: true,
  hasNext: true,
  showAccept: false,
  showReview: false,
};

const baseProps = {
  tpl: { layout: LAYOUT, css: "" },
  testTitle: "Тест",
  counterLabel: "Вопрос 1 из 1",
  progressPercent: 100,
  question,
  answer: undefined,
  shuffleMapping: undefined,
  nav: NAV,
};

function shadowOf(container: HTMLElement): ShadowRoot {
  const host = container.querySelector("[data-template-screen]") as HTMLElement;
  return host.shadowRoot as ShadowRoot;
}

describe("TemplateQuestionScreen — короткий ответ", () => {
  it("рисует одно поле ввода вместо вариантов", () => {
    const { container } = render(<TemplateQuestionScreen {...baseProps} onAnswer={() => {}} />);
    const shadow = shadowOf(container);
    expect(shadow.querySelectorAll('[data-action="short-answer"]').length).toBe(1);
    expect(shadow.querySelectorAll(".ou-radio-card").length).toBe(0);
    cleanup();
  });

  it("отдаёт набранную строку как есть", () => {
    const onAnswer = vi.fn();
    const { container } = render(<TemplateQuestionScreen {...baseProps} onAnswer={onAnswer} />);
    const input = shadowOf(container).querySelector('[data-action="short-answer"]') as HTMLInputElement;

    input.value = "  Ростехнадзор ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onAnswer).toHaveBeenCalledWith("  Ростехнадзор ");
    cleanup();
  });

  it("показывает сохранённый ответ при возврате к вопросу", () => {
    const { container } = render(<TemplateQuestionScreen {...baseProps} answer="РТН" onAnswer={() => {}} />);
    const input = shadowOf(container).querySelector('[data-action="short-answer"]') as HTMLInputElement;
    expect(input.getAttribute("value")).toBe("РТН");
    cleanup();
  });

  it("набор не выбивает поле из-под курсора", () => {
    // Приёмка 2026-09-20 (AC-04b). Экран управляемый: набранное уходит наверх и
    // возвращается пропсом. Пока значение поля участвовало в разметке слотов, каждый
    // символ пересобирал сцену — поле подменялось новым узлом, фокус пропадал, и
    // участник набирал по одному символу на щелчок. Проверяется не разметка, а
    // ЖИВУЧЕСТЬ узла: тот же элемент и тот же фокус после возврата ответа.
    const { container, rerender } = render(
      <TemplateQuestionScreen {...baseProps} answer="" onAnswer={() => {}} />,
    );
    const shadow = shadowOf(container);
    const before = shadow.querySelector('[data-action="short-answer"]') as HTMLInputElement;
    before.focus();

    before.value = "Р";
    before.dispatchEvent(new Event("input", { bubbles: true }));
    rerender(<TemplateQuestionScreen {...baseProps} answer="Р" onAnswer={() => {}} />);

    const after = shadow.querySelector('[data-action="short-answer"]') as HTMLInputElement;
    expect(after).toBe(before);
    expect(shadow.activeElement).toBe(after);
    expect(after.value).toBe("Р");
    cleanup();
  });

  it("смена вопроса поле всё-таки пересоздаёт: это другой ответ", () => {
    const { container, rerender } = render(
      <TemplateQuestionScreen {...baseProps} answer="РТН" onAnswer={() => {}} />,
    );
    const shadow = shadowOf(container);
    const before = shadow.querySelector('[data-action="short-answer"]') as HTMLInputElement;

    const other = { ...question, id: "q2", prompt: "Второй вопрос" } as unknown as Question;
    rerender(
      <TemplateQuestionScreen {...baseProps} question={other} answer="" onAnswer={() => {}} />,
    );

    const after = shadow.querySelector('[data-action="short-answer"]') as HTMLInputElement;
    expect(after).not.toBe(before);
    expect(after.getAttribute("value")).toBe("");
    cleanup();
  });

  it("не принимает ввод, пока ответ заперт", () => {
    const onAnswer = vi.fn();
    const { container } = render(<TemplateQuestionScreen {...baseProps} locked onAnswer={onAnswer} />);
    const input = shadowOf(container).querySelector('[data-action="short-answer"]') as HTMLInputElement;

    input.value = "поздно";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onAnswer).not.toHaveBeenCalled();
    cleanup();
  });
});
