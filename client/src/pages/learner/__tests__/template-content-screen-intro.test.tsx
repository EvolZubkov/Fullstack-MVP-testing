// @vitest-environment jsdom
/**
 * @module client/pages/learner/template-content-screen-intro.test
 *
 * «Введение раздела» prints the author instruction through its own `instruction` slot. The
 * web host used to fill only `page-content`, which the section-intro layout does not have,
 * so the instruction the package showed never reached the web learner — the card rendered
 * empty (found in browser acceptance, 2026-09-30).
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TemplateContentScreen, type ContentScreenTemplate } from "../template-content-screen";

const LAYOUT = '<div class="tb-card"><span class="tb-card__body" data-slot="instruction"></span></div>';

const template = { layout: LAYOUT, css: "", contentTemplates: [] } as unknown as ContentScreenTemplate;

function shadowText(container: HTMLElement): string {
  const host = container.querySelector("[data-template-screen]") as HTMLElement;
  return host.shadowRoot?.querySelector('[data-slot="instruction"]')?.innerHTML ?? "";
}

afterEach(() => cleanup());

describe("TemplateContentScreen — section intro instruction", () => {
  it("fills the instruction slot of an intro page", () => {
    const page = { id: "p1", kind: "intro", valuesJson: { values: { instruction: "<b>Цель</b> раздела" } } };
    const { container } = render(
      <TemplateContentScreen page={page as never} template={template} courseTitle="T" onNext={() => {}} />,
    );
    expect(shadowText(container)).toBe("<b>Цель</b> раздела");
  });

  it("leaves the slot alone on any other page", () => {
    const page = { id: "p2", kind: "content", valuesJson: { values: { instruction: "x" } } };
    const { container } = render(
      <TemplateContentScreen page={page as never} template={template} courseTitle="T" onNext={() => {}} />,
    );
    expect(shadowText(container)).toBe("");
  });
});
