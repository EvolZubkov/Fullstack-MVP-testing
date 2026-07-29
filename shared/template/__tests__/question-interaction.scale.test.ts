/**
 * @module shared/template/__tests__/question-interaction.scale
 * @description PRD-26 scale (Likert) interaction: the DS `Stepper` in choice mode —
 * status mapping (`is-done` up to the answer, `is-current` on it), verdict statuses,
 * the vertical fallback for many graduations, delegated `select:N`, fixed graduation
 * order and escaping of author markup.
 */
import { describe, it, expect } from "vitest";
import { renderScale, questionHint, answerTexts } from "../question-interaction";

const GRADES = ["Никогда", "Очень редко", "Редко", "Часто", "Очень часто", "Постоянно"];
const SCALE = { type: "scale", dataJson: { options: GRADES } };

/** Status classes of every step, in display order. */
function statuses(html: string): string[] {
  return Array.from(html.matchAll(/class="ou-stepper__step ou-stepper__step--btn([^"]*)"/g)).map(
    (m) => m[1].trim(),
  );
}

describe("renderScale", () => {
  it("emits the DS Stepper in choice mode, not a bespoke component", () => {
    const html = renderScale(SCALE, null);
    expect(html).toContain("ou-stepper ou-stepper--choice");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    // The bullet is empty: no step number and no icon (a number would read as a score).
    expect(html).toContain('<span class="ou-stepper__bullet"></span>');
    expect(html).not.toContain("ou-stepper__num");
    // No invented classes outside the DS namespace.
    expect(html).not.toContain("ou-scale");
  });

  it("renders one step per graduation in the authored order", () => {
    const html = renderScale(SCALE, null);
    expect(statuses(html)).toHaveLength(GRADES.length);
    const titles = Array.from(html.matchAll(/ou-stepper__title">([^<]*)</g)).map((m) => m[1]);
    expect(titles).toEqual(GRADES);
  });

  it("has no status classes and no checked step before an answer is given", () => {
    const html = renderScale(SCALE, null);
    expect(statuses(html)).toEqual(["", "", "", "", "", ""]);
    expect(html).not.toContain('aria-checked="true"');
  });

  it("marks graduations before the answer is-done and the answer is-current", () => {
    const html = renderScale(SCALE, 2);
    expect(statuses(html)).toEqual(["is-done", "is-done", "is-current", "", "", ""]);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toMatch(/data-index="2"[\s\S]*?Редко/);
  });

  it("treats the first graduation as an answer, not as «unanswered»", () => {
    const html = renderScale(SCALE, 0);
    expect(statuses(html)).toEqual(["is-current", "", "", "", "", ""]);
    expect(html).toContain('aria-checked="true"');
  });

  it("delegates selection through data-action, like every other type", () => {
    const html = renderScale(SCALE, null);
    GRADES.forEach((_, i) => expect(html).toContain(`data-action="select:${i}"`));
  });

  it("shows the verdict when the answer is wrong: is-error on the pick, is-success on the key", () => {
    const html = renderScale(SCALE, 2, { correctIndex: 3 });
    expect(statuses(html)).toEqual(["is-done", "is-done", "is-error", "is-success", "", ""]);
    // The accent fill is muted so only the verdict colours carry meaning.
    expect(html).toContain("ou-stepper--review");
  });

  it("shows a single is-success when the answer is right", () => {
    const html = renderScale(SCALE, 3, { correctIndex: 3 });
    const cls = statuses(html);
    expect(cls[3]).toBe("is-success");
    expect(cls.filter((c) => c === "is-success")).toHaveLength(1);
    expect(cls).not.toContain("is-error");
  });

  it("shows the key even when the learner skipped the question", () => {
    const html = renderScale(SCALE, null, { correctIndex: 1 });
    expect(statuses(html)).toEqual(["", "is-success", "", "", "", ""]);
    expect(html).not.toContain("is-error");
  });

  it("emits no verdict for a measurement-only question: review carries no correctIndex", () => {
    const html = renderScale(SCALE, 2, {});
    expect(statuses(html)).toEqual(["is-done", "is-done", "is-current", "", "", ""]);
    expect(html).not.toContain("is-success");
    expect(html).not.toContain("is-error");
    expect(html).not.toContain("ou-stepper--review");
  });

  it("stays horizontal up to seven graduations and goes vertical beyond", () => {
    const seven = { type: "scale", dataJson: { options: ["1", "2", "3", "4", "5", "6", "7"] } };
    const eight = { type: "scale", dataJson: { options: ["1", "2", "3", "4", "5", "6", "7", "8"] } };
    expect(renderScale(seven, null)).not.toContain("ou-stepper--vertical");
    expect(renderScale(eight, null)).toContain("ou-stepper--vertical");
  });

  it("escapes markup an author typed into a graduation label", () => {
    const html = renderScale({ type: "scale", dataJson: { options: ["<b>жирно</b>"] } }, null);
    expect(html).not.toContain("<b>жирно</b>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("survives a question without graduations", () => {
    const html = renderScale({ type: "scale", dataJson: {} }, 0);
    expect(html).toContain("ou-stepper--choice");
    expect(statuses(html)).toEqual([]);
  });
});

describe("scale question metadata", () => {
  it("carries its own guidance subtitle", () => {
    expect(questionHint("scale")).toBe("Выберите ответ на шкале");
  });

  it("exposes graduation labels to the font-fit pass", () => {
    expect(answerTexts(SCALE)).toEqual(GRADES);
  });
});
