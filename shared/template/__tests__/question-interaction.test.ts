/**
 * @module shared/template/__tests__/question-interaction
 * @description Общий рендер вариантов ответа: разметка DS-эталона (ou-radio-card),
 * делегирование select:N, class-driven is-on, порядок по shuffleMapping, разметка
 * ревью и множественный выбор на ou-check.
 */
import { describe, it, expect } from "vitest";
import { renderSingleChoice, renderMultiple } from "../question-interaction";

const SINGLE = { type: "single", dataJson: { options: ["A", "B", "C"] } };
const MULTI = { type: "multiple", dataJson: { options: ["A", "B", "C"] } };

describe("renderSingleChoice", () => {
  it("emits ou-radio-card options with select data-action and is-on on the chosen", () => {
    const html = renderSingleChoice(SINGLE, 1, undefined);
    expect(html).toContain("ou-radio-card");
    expect(html).toContain('data-action="select:1"');
    // выбранный вариант помечен is-on
    expect(html).toMatch(/ou-radio-card is-on[^>]*>[\s\S]*?B/);
    // цена шрифта — переменная (Фаза 5 её вычислит), не литерал-магия
    expect(html).toContain("--tb-answer-fs");
    // одиночный выбор — кольцо радио, не чекбокс
    expect(html).toContain("ou-radio__ring");
    expect(html).not.toContain("ou-check__box");
  });

  it("only the chosen card is is-on", () => {
    const html = renderSingleChoice(SINGLE, 0, undefined);
    expect(html.match(/ou-radio-card is-on/g)).toHaveLength(1);
    expect(html.match(/ou-radio ou-radio--m is-on/g)).toHaveLength(1);
  });

  it("orders options by the shuffle mapping and delegates the ORIGINAL index", () => {
    // Display order [2,0,1]: first card is original option C with data-action select:2.
    const html = renderSingleChoice(SINGLE, undefined, [2, 0, 1]);
    const firstCard = html.slice(0, html.indexOf("</label>"));
    expect(firstCard).toContain('data-action="select:2"');
    expect(firstCard).toContain("C");
  });

  it("marks correct/incorrect in review mode", () => {
    // Chose B (1); correct is A (0): A -> correct-answer, chosen B -> incorrect-answer.
    const html = renderSingleChoice(SINGLE, 1, undefined, { correctIndex: 0 });
    expect(html).toMatch(/ou-radio-card[^"]*correct-answer[^>]*>[\s\S]*?A/);
    expect(html).toMatch(/ou-radio-card is-on incorrect-answer[^>]*>[\s\S]*?B/);
  });

  it("escapes option text", () => {
    const html = renderSingleChoice({ type: "single", dataJson: { options: ['<b>"x"</b>'] } }, undefined);
    expect(html).toContain("&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });
});

describe("renderMultiple", () => {
  it("emits check controls and is-on for every chosen option", () => {
    const html = renderMultiple(MULTI, [0, 2], undefined);
    expect(html).toContain("ou-check__box");
    expect(html).not.toContain("ou-radio__ring");
    // both chosen cards is-on
    expect(html.match(/ou-radio-card is-on/g)).toHaveLength(2);
    expect(html).toContain('data-action="select:0"');
    expect(html).toContain('data-action="select:2"');
  });

  it("uses correctIndices (array) for review, not correctIndex", () => {
    const html = renderMultiple(MULTI, [1], undefined, { correctIndices: [0, 2] });
    expect(html).toMatch(/correct-answer[^>]*>[\s\S]*?A/);
    expect(html).toMatch(/incorrect-answer[^>]*>[\s\S]*?B/);
  });
});
