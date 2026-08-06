// @vitest-environment jsdom
/**
 * @module client/pages/learner/__tests__/question-meta-parity
 *
 * Parity of the question meta row with the SCORM package (PRD-12): the package's
 * runtime passes the section separately (`state.sectionName`) and keeps the counter
 * label bare, so the shipped `question.html` prints «Вопрос N из M» plus an
 * `ou-tag` with the section. The web host used to fold the section INTO the counter
 * («Вопрос 1 из 64 · Тема: …»), which rendered a different meta row from the same
 * layout — the host, not the template, decided how the section reads.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TemplateQuestionScreen } from "../template-question-screen";
import type { Question } from "@shared/schema";

/** The meta row exactly as the shipped question layout declares it. */
const LAYOUT = `
<div class="tb-scene">
  <div class="tb-scene__meta">
    <span data-path="state.questionCounterLabel"></span>
    {{#if state.sectionName}}<span class="ou-tag ou-tag--neutral" data-path="state.sectionName"></span>{{/if}}
  </div>
  <div data-slot="question-interaction"></div>
</div>`;

const question = {
  id: "q1",
  type: "single",
  prompt: "Столица Франции?",
  dataJson: { options: ["Париж", "Берлин"] },
  mediaUrl: null,
  mediaType: null,
} as unknown as Question;

const props = {
  tpl: { layout: LAYOUT, css: "" },
  testTitle: "Тест",
  counterLabel: "Вопрос 1 из 64",
  progressPercent: 2,
  question,
  answer: undefined,
  onAnswer: () => {},
  // The nav row is part of the scene (`state.nav`) — a strict-linear row here.
  nav: {
    flexible: false,
    committed: false,
    canPrev: false,
    answerReady: true,
    hasNext: true,
    showAccept: false,
    showReview: false,
  },
};

function shadowOf(container: HTMLElement): ShadowRoot {
  return (container.querySelector("[data-template-screen]") as HTMLElement).shadowRoot as ShadowRoot;
}

afterEach(cleanup);

describe("мета-строка вопроса совпадает с пакетом", () => {
  it("название раздела печатается тегом, а не текстом счётчика", () => {
    const { container } = render(<TemplateQuestionScreen {...props} sectionName="Корпоративные компетенции" />);
    const shadow = shadowOf(container);
    const tag = shadow.querySelector(".tb-scene__meta .ou-tag");
    expect(tag?.textContent).toBe("Корпоративные компетенции");
    expect(shadow.querySelector(".tb-scene__meta span")?.textContent).toBe("Вопрос 1 из 64");
  });

  it("без раздела тег не рендерится", () => {
    const { container } = render(<TemplateQuestionScreen {...props} />);
    expect(shadowOf(container).querySelector(".tb-scene__meta .ou-tag")).toBeNull();
  });
});
