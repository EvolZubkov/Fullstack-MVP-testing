// @vitest-environment jsdom
/**
 * @module client/pages/learner/template-question-screen.markdown.test
 *
 * The question prompt carries the markdown subset an author may type. The web
 * host must render it exactly as the SCORM package does — both fill the same
 * `question-text` slot through the same shared renderer.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TemplateQuestionScreen } from "../template-question-screen";
import type { Question } from "@shared/schema";

const LAYOUT = `
<div class="layout-question-wrap">
  <div class="question-card">
    <div class="question-text" data-slot="question-text"></div>
    <div data-slot="question-interaction"></div>
  </div>
</div>`;

function makeQuestion(prompt: string): Question {
  return {
    id: "q1",
    type: "single",
    prompt,
    dataJson: { options: ["А", "Б"] },
    mediaUrl: null,
    mediaType: null,
  } as unknown as Question;
}

function promptHtml(prompt: string): string {
  const { container } = render(
    <TemplateQuestionScreen
      tpl={{ layout: LAYOUT, css: "" }}
      testTitle="Тест"
      counterLabel="Вопрос 1 из 5"
      progressPercent={20}
      question={makeQuestion(prompt)}
      answer={undefined}
      shuffleMapping={undefined}
      onAnswer={() => {}}
      nav={{
        flexible: false,
        committed: false,
        canPrev: false,
        answerReady: true,
        hasNext: true,
        showAccept: false,
        showReview: false,
      }}
    />,
  );
  const host = container.querySelector("[data-template-screen]") as HTMLElement;
  const shadow = host.shadowRoot as ShadowRoot;
  return shadow.querySelector('[data-slot="question-text"]')?.innerHTML ?? "";
}

describe("TemplateQuestionScreen — prompt markdown", () => {
  // «Что» is a hanging word, so the typography pass binds it to the next word;
  // the DOM serialises that non-breaking space as `&nbsp;`.
  it("renders bold in the prompt", () => {
    expect(promptHtml("Что такое **замыкание**?")).toContain(
      "Что&nbsp;такое <strong>замыкание</strong>?",
    );
  });

  it("applies typography to the prompt", () => {
    expect(promptHtml('Что такое "замыкание"?')).toContain("Что&nbsp;такое «замыкание»?");
  });

  it("shows markup the author typed as text, never as tags", () => {
    const html = promptHtml("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
