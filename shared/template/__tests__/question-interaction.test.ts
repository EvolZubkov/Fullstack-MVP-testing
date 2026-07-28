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
    // Straight quotes now become guillemets: answer texts go through the shared
    // author-text pipeline (markdown subset + typography), and the option is
    // rendered from it. The security property is unchanged — markup the author
    // typed is still escaped before any tag is generated.
    const html = renderSingleChoice({ type: "single", dataJson: { options: ['<b>"x"</b>'] } }, undefined);
    expect(html).toContain("&lt;b&gt;«x»&lt;/b&gt;");
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
    //  A correct+chosen   → correct-answer (green, check)
    //  B wrong+chosen      → incorrect-answer (red, cross)
    //  C correct+missed    → missed-answer (yellow card, RED cross — a miss, not a tick)
    //  D wrong+skipped     → correct-skip (green, no mark)
    const MULTI4 = { type: "multiple", dataJson: { options: ["A", "B", "C", "D"] } };
    const html = renderMultiple(MULTI4, [0, 1], undefined, { correctIndices: [0, 2] });
    expect(html).toMatch(/ou-radio-card is-on correct-answer[^>]*>[\s\S]*?A/);
    expect(html).toMatch(/ou-radio-card is-on incorrect-answer[^>]*>[\s\S]*?B/);
    expect(html).toMatch(/ou-radio-card missed-answer[^>]*>[\s\S]*?C/);
    expect(html).toMatch(/ou-radio-card correct-skip[^>]*>[\s\S]*?D/);
    // Marks: A, B, C carry one; D (correctly skipped) does not.
    const marks = html.match(/<span class="ou-radio-card__mark">[\s\S]*?<\/span>/g) || [];
    expect(marks).toHaveLength(3);
    // Only the correctly-chosen option gets a CHECK; both mistakes (wrong pick AND
    // missed correct) get a CROSS — a missed correct answer must not read as «верно».
    // (The check path is scoped to the mark span: the checkbox control reuses it.)
    const CROSS = "M18 6 6 18M6 6l12 12";
    expect(marks.filter((m) => m.includes(CROSS))).toHaveLength(2); // B (wrong pick) + C (missed)
    expect(marks.filter((m) => !m.includes(CROSS))).toHaveLength(1); // A only (check)
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
    // The whole ROW is a drop target — both the fixed prompt and the row's slot carry
    // data-drop="r<rightIdx>", so a chip released anywhere on the row pairs with that
    // row's prompt. Chips are also drag sources (data-drag).
    expect(html).toContain('data-drag="0"');
    expect(html).toMatch(/ou-match__card--fixed" data-drop="r0"/);
    expect(html).toMatch(/ou-match__card--drag" data-drag="\d+" data-drop="r\d+"/);
    expect(html).not.toContain('data-drop="pool:');
  });

  it("joins a matched pair and marks review", () => {
    // pairs: left 0 -> right 0 (x). correct pairs: {left:0,right:0} -> correct.
    const html = renderMatching(Q, { 0: 0 }, undefined, [], { pairs: [{ left: 0, right: 0 }] });
    expect(html).toContain("is-connected");
    expect(html).toMatch(/ou-match__row[^"]*correct-answer/);
    // the joined row's drop zone is the right id, not a pool slot
    expect(html).toContain('data-drop="r0"');
  });

  it("adapts the column ratio to the longer side (66/33), else keeps 50/50", () => {
    const long = "x".repeat(80);
    // LEFT column = prompts (`right`); RIGHT column = answers (`left`).
    const leftHeavy = { type: "matching", dataJson: { left: ["a", "b"], right: [long, "y"] } };
    expect(renderMatching(leftHeavy, {}, undefined)).toContain("minmax(0, 2fr) var(--ou-match-gap-w) minmax(0, 1fr)");
    const rightHeavy = { type: "matching", dataJson: { left: [long, "b"], right: ["x", "y"] } };
    expect(renderMatching(rightHeavy, {}, undefined)).toContain("minmax(0, 1fr) var(--ou-match-gap-w) minmax(0, 2fr)");
    // similar lengths → balanced (a few extra chars must NOT skew it)
    const even = { type: "matching", dataJson: { left: ["abcde", "fg"], right: ["abcdefg", "hi"] } };
    expect(renderMatching(even, {}, undefined)).toContain("minmax(0, 1fr) var(--ou-match-gap-w) minmax(0, 1fr)");
  });
});
