// @vitest-environment jsdom
/**
 * @module client/pages/learner/template-question-screen.test
 *
 * Verifies the shared question screen host (PRD-12): it renders the chrome + the
 * interaction slot from the design layout, and the props that make it reusable for
 * BOTH the standard and the adaptive flow — a custom `footer` (replaces the default
 * Назад/Далее nav), the `feedbackHtml` slot, and `locked` (read-only interaction).
 */

import { describe, it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TemplateQuestionScreen } from "../template-question-screen";
import type { Question } from "@shared/schema";

const LAYOUT = `
<div class="layout-question-wrap">
  <div class="q-header"><h1 class="q-title" data-path="course.title"></h1><div id="timer-display" class="q-timer q-timer--hidden"></div></div>
  <div class="progress-bar"><div class="progress-fill" id="q-progress-fill"></div></div>
  <div class="question-card">
    <div class="question-meta" data-path="state.questionCounterLabel"></div>
    <div class="question-text" data-slot="question-text"></div>
    <div data-slot="question-media"></div>
    <div data-slot="question-interaction"></div>
    <div data-slot="question-feedback"></div>
  </div>
</div>`;

const tpl = { layout: LAYOUT, css: "" };
const question = {
  id: "q1",
  type: "single",
  prompt: "Столица Франции?",
  dataJson: { options: ["Париж", "Берлин"] },
  mediaUrl: null,
  mediaType: null,
} as unknown as Question;

function shadowOf(container: HTMLElement): ShadowRoot {
  const host = container.querySelector("[data-template-screen]") as HTMLElement;
  return host.shadowRoot as ShadowRoot;
}

const baseProps = {
  tpl,
  testTitle: "Тест",
  counterLabel: "Тема: Сети · Вопрос 1 из 5",
  progressPercent: 20,
  question,
  answer: undefined,
  shuffleMapping: undefined,
};

describe("TemplateQuestionScreen", () => {
  it("renders chrome + interaction from the layout", () => {
    const { container } = render(<TemplateQuestionScreen {...baseProps} onAnswer={() => {}} footer={<span />} />);
    const shadow = shadowOf(container);
    expect(shadow.querySelector(".question-meta")?.textContent).toContain("Тема: Сети · Вопрос 1 из 5");
    expect(shadow.querySelector('[data-slot="question-text"]')?.textContent).toContain("Столица Франции?");
    expect(shadow.querySelectorAll(".ou-radio-card").length).toBe(2);
    cleanup();
  });

  it("renders a custom footer instead of the default standard nav", () => {
    const { container } = render(
      <TemplateQuestionScreen
        {...baseProps}
        onAnswer={() => {}}
        footer={<button type="button" data-testid="adaptive-accept">Принять</button>}
      />,
    );
    expect(container.querySelector('[data-testid="adaptive-accept"]')?.textContent).toBe("Принять");
    // Default standard nav is absent when a footer is supplied.
    expect(container.textContent).not.toContain("Назад");
    expect(container.textContent).not.toContain("Завершить тест");
    cleanup();
  });

  it("shows the default standard nav when no footer is supplied", () => {
    const { container } = render(
      <TemplateQuestionScreen {...baseProps} onAnswer={() => {}} canPrev isLast={false} isSubmitting={false} onPrev={() => {}} onNext={() => {}} onSubmit={() => {}} />,
    );
    expect(container.textContent).toContain("Назад");
    expect(container.textContent).toContain("Далее");
    cleanup();
  });

  it("fills the question-feedback slot with feedbackHtml", () => {
    const { container } = render(
      <TemplateQuestionScreen
        {...baseProps}
        onAnswer={() => {}}
        footer={<span />}
        feedbackHtml={'<div class="feedback-block">Неправильно</div>'}
      />,
    );
    const slot = shadowOf(container).querySelector('[data-slot="question-feedback"]');
    expect(slot?.querySelector(".feedback-block")?.textContent).toBe("Неправильно");
    cleanup();
  });

  it("ignores interaction clicks when locked", () => {
    const onAnswer = vi.fn();
    const { container } = render(
      <TemplateQuestionScreen {...baseProps} onAnswer={onAnswer} footer={<span />} locked />,
    );
    (shadowOf(container).querySelector('.ou-radio-card[data-action="select:0"]') as HTMLElement)?.click();
    expect(onAnswer).not.toHaveBeenCalled();
    cleanup();
  });

  it("applies an answer on interaction when not locked", () => {
    const onAnswer = vi.fn();
    const { container } = render(
      <TemplateQuestionScreen {...baseProps} onAnswer={onAnswer} footer={<span />} />,
    );
    (shadowOf(container).querySelector('.ou-radio-card[data-action="select:1"]') as HTMLElement)?.click();
    expect(onAnswer).toHaveBeenCalledWith(1);
    cleanup();
  });
});
