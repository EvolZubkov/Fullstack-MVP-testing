/**
 * @module shared/template/__tests__/question-interaction.markdown.test
 * @description Answer texts carry the same markdown subset the question prompt
 * does, and they carry it on BOTH hosts: the emission tested here is the single
 * source the web player and the SCORM package share, so an option cannot render
 * one way in the browser and another inside an LMS.
 */
import { describe, it, expect } from "vitest";
import {
  renderSingleChoice,
  renderMultiple,
  renderRanking,
  renderMatching,
} from "../question-interaction";

describe("answer options — markdown", () => {
  it("renders bold in an option", () => {
    const html = renderSingleChoice({ type: "single", dataJson: { options: ["Ответ **верный**"] } }, undefined);
    expect(html).toContain("Ответ <strong>верный</strong>");
  });

  it("renders italic in an option", () => {
    const html = renderMultiple({ type: "multiple", dataJson: { options: ["Ответ *важен*"] } }, undefined);
    expect(html).toContain("Ответ <em>важен</em>");
  });

  it("applies typography to an option", () => {
    const html = renderSingleChoice({ type: "single", dataJson: { options: ['Слово "важное"'] } }, undefined);
    expect(html).toContain("Слово «важное»");
  });

  it("renders bold in a ranking item", () => {
    const html = renderRanking({ type: "ranking", dataJson: { items: ["Шаг **первый**"] } }, undefined);
    expect(html).toContain("Шаг <strong>первый</strong>");
  });

  it("renders bold on both sides of a matching question", () => {
    const html = renderMatching(
      { type: "matching", dataJson: { left: ["Лево **A**"], right: ["Право **Б**"] } },
      undefined,
    );
    expect(html).toContain("Лево <strong>A</strong>");
    expect(html).toContain("Право <strong>Б</strong>");
  });
});

describe("answer options — safety", () => {
  it("shows markup the author typed as text, never as tags", () => {
    const html = renderSingleChoice(
      { type: "single", dataJson: { options: ["<script>alert(1)</script>"] } },
      undefined,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("keeps the card markup intact around the rendered text", () => {
    const html = renderSingleChoice({ type: "single", dataJson: { options: ["Ответ **верный**"] } }, undefined);
    expect(html).toContain('class="ou-radio-card"');
    expect(html).toContain('data-action="select:0"');
  });
});
