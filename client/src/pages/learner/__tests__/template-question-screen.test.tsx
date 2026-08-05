// @vitest-environment jsdom
/**
 * @module client/pages/learner/template-question-screen.test
 *
 * Verifies the shared question screen host (PRD-12): it renders the chrome + the
 * interaction slot from the design layout, and the props that make it reusable for
 * BOTH the standard and the adaptive flow — the nav row printed from `state.nav`
 * INSIDE the scene (no host-rendered footer), the `feedbackHtml` slot, and `locked`
 * (read-only interaction).
 */

import { describe, it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TemplateQuestionScreen } from "../template-question-screen";
import type { Question } from "@shared/schema";

// The footer mirrors the real `question.html`: the row is the TEMPLATE's, built
// from `state.nav` — that is where both hosts' navigation lives.
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
  <footer class="tb-scene__foot">
    {{#if state.nav.showBack}}<button type="button" data-action="answer-back" {{#unless state.nav.canPrev}}disabled{{/unless}}>← Назад</button>{{/if}}
    {{#if state.nav.showSkip}}<button type="button" data-action="answer-skip">Пропустить</button>{{/if}}
    <button type="button" data-action="{{state.nav.primaryAction}}" {{#unless state.nav.primaryEnabled}}disabled{{/unless}} data-path="state.nav.primaryLabel"></button>
  </footer>
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

/** Strict-linear row with a usable answer (the adaptive shape too). */
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
  tpl,
  testTitle: "Тест",
  counterLabel: "Тема: Сети · Вопрос 1 из 5",
  progressPercent: 20,
  question,
  answer: undefined,
  shuffleMapping: undefined,
  nav: NAV,
};

describe("TemplateQuestionScreen", () => {
  it("renders chrome + interaction from the layout", () => {
    const { container } = render(<TemplateQuestionScreen {...baseProps} onAnswer={() => {}} />);
    const shadow = shadowOf(container);
    expect(shadow.querySelector(".question-meta")?.textContent).toContain("Тема: Сети · Вопрос 1 из 5");
    expect(shadow.querySelector('[data-slot="question-text"]')?.textContent).toContain("Столица Франции?");
    expect(shadow.querySelectorAll(".ou-radio-card").length).toBe(2);
    cleanup();
  });

  it("prints the nav row INSIDE the scene, never as host chrome", () => {
    const { container } = render(<TemplateQuestionScreen {...baseProps} onAnswer={() => {}} />);
    const foot = shadowOf(container).querySelector(".tb-scene__foot");
    // Strict-linear adaptive/standard row: one forward button, no «Назад»/«Пропустить».
    expect(foot?.querySelector('[data-action="answer-next"]')?.textContent).toBe("Далее");
    expect(foot?.querySelector('[data-action="answer-back"]')).toBeNull();
    // Nothing is rendered next to the shadow host — the scene owns the footer.
    expect(container.textContent).toBe("");
    cleanup();
  });

  it("gates the forward button on the answer and reports its action", () => {
    const onNavAction = vi.fn();
    const { container } = render(
      <TemplateQuestionScreen
        {...baseProps}
        onAnswer={() => {}}
        nav={{ ...NAV, answerReady: false, showAccept: true }}
        onNavAction={onNavAction}
      />,
    );
    const primary = shadowOf(container).querySelector('.tb-scene__foot [data-action="answer-submit"]') as HTMLButtonElement;
    expect(primary.textContent).toBe("Принять");
    expect(primary.disabled).toBe(true);
    primary.disabled = false; // a jsdom click on a disabled button never fires
    primary.click();
    expect(onNavAction).toHaveBeenCalledWith("answer-submit");
    cleanup();
  });

  it("fills the question-feedback slot with feedbackHtml", () => {
    const { container } = render(
      <TemplateQuestionScreen
        {...baseProps}
        onAnswer={() => {}}
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
      <TemplateQuestionScreen {...baseProps} onAnswer={onAnswer} locked />,
    );
    (shadowOf(container).querySelector('.ou-radio-card[data-action="select:0"]') as HTMLElement)?.click();
    expect(onAnswer).not.toHaveBeenCalled();
    cleanup();
  });

  it("applies an answer on interaction when not locked", () => {
    const onAnswer = vi.fn();
    const { container } = render(
      <TemplateQuestionScreen {...baseProps} onAnswer={onAnswer} />,
    );
    (shadowOf(container).querySelector('.ou-radio-card[data-action="select:1"]') as HTMLElement)?.click();
    expect(onAnswer).toHaveBeenCalledWith(1);
    cleanup();
  });
});
