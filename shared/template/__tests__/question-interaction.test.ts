/**
 * @module shared/template/__tests__/question-interaction
 * @description Общий рендер вариантов ответа: разметка DS-эталона (ou-radio-card),
 * делегирование select:N, class-driven is-on, порядок по shuffleMapping, разметка
 * ревью и множественный выбор на ou-check.
 */
import { describe, it, expect } from "vitest";
import { renderSingleChoice, renderMultiple, renderRanking, renderMatching } from "../question-interaction";

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

  it("per-option traffic light in review: green/yellow/red by handling", () => {
    // Options A,B,C,D; correct = A,C; learner chose A,B.
    //  A correct+chosen   → correct-answer (green, ✓)
    //  B wrong+chosen      → incorrect-answer (red, ✗)
    //  C correct+missed    → missed-answer (yellow, ✓)
    //  D wrong+skipped     → correct-skip (green, no mark)
    const MULTI4 = { type: "multiple", dataJson: { options: ["A", "B", "C", "D"] } };
    const html = renderMultiple(MULTI4, [0, 1], undefined, { correctIndices: [0, 2] });
    expect(html).toMatch(/ou-radio-card is-on correct-answer[^>]*>[\s\S]*?A/);
    expect(html).toMatch(/ou-radio-card is-on incorrect-answer[^>]*>[\s\S]*?B/);
    expect(html).toMatch(/ou-radio-card missed-answer[^>]*>[\s\S]*?C/);
    expect(html).toMatch(/ou-radio-card correct-skip[^>]*>[\s\S]*?D/);
    // A correct answer key carries a check even when missed; a correctly-skipped
    // wrong option is green but unmarked.
    expect(html.match(/ou-radio-card__mark/g)).toHaveLength(3); // A, B, C — not D
  });
});

describe("renderRanking", () => {
  it("uses ou-rank items with grip/index/controls and position-based DnD", () => {
    const html = renderRanking({ type: "ranking", dataJson: { items: ["1", "2"] } }, undefined, undefined);
    expect(html).toContain("ou-rank__item");
    expect(html).toContain("ou-rank__index");
    expect(html).toContain('data-drag="0"');
    expect(html).toContain('data-drop="1"');
    // keyboard reorder controls with delegated actions
    expect(html).toContain('data-action="rank-up:1"');
    expect(html).toContain('data-action="rank-down:0"');
    // first row cannot move up, last cannot move down
    expect(html).toMatch(/rank-up:0"[^>]*disabled/);
    expect(html).toMatch(/rank-down:1"[^>]*disabled/);
    expect(html).toContain("--tb-answer-fs");
  });

  it("renders the answer order when set and marks review", () => {
    // answer [1,0] shows item 2 first (index 1), item 1 second; correctOrder [0,1].
    const html = renderRanking(
      { type: "ranking", dataJson: { items: ["one", "two"] } },
      [1, 0],
      undefined,
      { correctOrder: [0, 1] },
    );
    const firstRow = html.slice(0, html.indexOf("</div></div>"));
    expect(firstRow).toContain("two");
    // position 0 holds item 1 but correct is 0 -> incorrect
    expect(html).toMatch(/ou-rank__item incorrect-answer[\s\S]*?two/);
  });
});

describe("renderMatching", () => {
  const Q = { type: "matching", dataJson: { left: ["a", "b"], right: ["x", "y"] } };

  it("uses ou-match rows with a fixed prompt and a draggable answer", () => {
    const html = renderMatching(Q, {}, undefined);
    expect(html).toContain("ou-match__row");
    expect(html).toContain("ou-match__card--fixed");
    expect(html).toContain("ou-match__card--drag");
    // side-r layout (fixed prompt left, drag answer right)
    expect(html).toContain("ou-match--side-r");
    // draggable chips carry the left index; open rows are pool drop zones
    expect(html).toContain('data-drag="0"');
    expect(html).toContain('data-drop="pool:0"');
  });

  it("joins a matched pair and marks review", () => {
    // pairs: left 0 -> right 0 (x). correct pairs: {left:0,right:0} -> correct.
    const html = renderMatching(Q, { 0: 0 }, undefined, [], { pairs: [{ left: 0, right: 0 }] });
    expect(html).toContain("is-connected");
    expect(html).toMatch(/ou-match__row[^"]*correct-answer/);
    // the joined row's drop zone is the right id, not a pool slot
    expect(html).toContain('data-drop="r0"');
  });
});
