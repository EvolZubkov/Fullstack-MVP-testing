/**
 * @module tests/debug-player-reference
 * @description PRD-18 Phase 4 — the «Эталон» overlay (§5.4). Loads the REAL shared
 * compute IIFE (`inspector-compute.js`) into jsdom so `window.TBInspector` is the
 * production object, builds the package's real question DOM (the SAME markup the
 * SCORM render emits — `.option[data-index]`, `.ranking-board`, `.matching-board`)
 * and asserts the correct-answer markers land on the right elements: ✓ on correct
 * options, the correct ordinal on ranking items, paired letters on matching.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

interface RefApi {
  applyReference(win: { document: Document; state: unknown } | null): void;
  clearReference(win: { document: Document } | null): void;
}

beforeAll(() => {
  // Run the production IIFE — it installs window.TBInspector on the jsdom window.
  const src = fs.readFileSync(path.resolve("server/scorm/debug-player/assets/inspector-compute.js"), "utf8");
  new Function(src)();
});

function ref(): RefApi {
  return (window as unknown as { TBInspector: RefApi }).TBInspector;
}

beforeEach(() => { document.body.innerHTML = ""; });

function fakeWin(state: unknown) {
  return { document, state };
}

const marks = () => document.querySelectorAll('[data-tb-ref="1"]');

describe("Эталон overlay — applyReference", () => {
  it("marks the correct single/multiple options with ✓ (by data-index)", () => {
    document.body.innerHTML =
      '<div class="option" data-index="0" onclick="selectSingle(\'q1\',0)"><input name="q_q1"></div>' +
      '<div class="option" data-index="1" onclick="selectSingle(\'q1\',1)"><input name="q_q1"></div>' +
      '<div class="option" data-index="2" onclick="selectSingle(\'q1\',2)"><input name="q_q1"></div>';
    ref().applyReference(fakeWin({
      flatQuestions: [{ question: { id: "q1", type: "single", correct: { correctIndex: 1 } } }],
    }));
    const all = marks();
    expect(all).toHaveLength(1);
    expect(all[0].textContent).toBe("✓");
    expect(all[0].closest(".option")?.getAttribute("data-index")).toBe("1");
  });

  it("marks every correct option for multiple choice", () => {
    document.body.innerHTML =
      '<div class="option" data-index="0" onclick="toggleMultiple(\'q2\',0)"><input></div>' +
      '<div class="option" data-index="1" onclick="toggleMultiple(\'q2\',1)"><input></div>' +
      '<div class="option" data-index="2" onclick="toggleMultiple(\'q2\',2)"><input></div>';
    ref().applyReference(fakeWin({
      flatQuestions: [{ question: { id: "q2", type: "multiple", correct: { correctIndices: [0, 2] } } }],
    }));
    expect(marks()).toHaveLength(2);
  });

  it("marks ranking items with their correct 1-based position", () => {
    // Items currently displayed in order 0,1,2; correct order is [2,0,1].
    document.body.innerHTML =
      '<div class="ranking-board" data-qid="q3">' +
      '<div class="rank-item" data-item="0"><span class="rank-text">A</span></div>' +
      '<div class="rank-item" data-item="1"><span class="rank-text">B</span></div>' +
      '<div class="rank-item" data-item="2"><span class="rank-text">C</span></div>' +
      "</div>";
    ref().applyReference(fakeWin({
      flatQuestions: [{ question: { id: "q3", type: "ranking", correct: { correctOrder: [2, 0, 1] } } }],
    }));
    const m = Array.from(marks()).map((n) => [n.closest(".rank-item")?.getAttribute("data-item"), n.textContent]);
    // item 0 → correct pos 2; item 1 → pos 3; item 2 → pos 1
    expect(m).toEqual([["0", "2"], ["1", "3"], ["2", "1"]]);
  });

  it("marks matching pairs with the same letter on the chip and the right tile", () => {
    document.body.innerHTML =
      '<div class="matching-board" data-qid="q4">' +
      '<div class="matching-line" data-right="0"><div class="match-chip" data-drag="1"></div><div class="match-right-tile">R0</div></div>' +
      '<div class="matching-line" data-right="1"><div class="match-chip" data-drag="0"></div><div class="match-right-tile">R1</div></div>' +
      "</div>";
    // Correct: left 0 ↔ right 0 (letter A), left 1 ↔ right 1 (letter B).
    ref().applyReference(fakeWin({
      flatQuestions: [{ question: { id: "q4", type: "matching", correct: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }] } } }],
    }));
    expect(marks()).toHaveLength(4); // 2 pairs × (chip + tile)
    // The right tile of data-right=0 and the chip data-drag=0 must share letter "A".
    const tileA = document.querySelector('.matching-line[data-right="0"] .match-right-tile [data-tb-ref]')?.textContent;
    const chipA = document.querySelector('.match-chip[data-drag="0"] [data-tb-ref]')?.textContent;
    expect(tileA).toBe("A");
    expect(chipA).toBe("A");
  });

  it("is idempotent — re-applying does not stack markers", () => {
    document.body.innerHTML = '<div class="option" data-index="0" onclick="selectSingle(\'q1\',0)"><input></div>';
    const win = fakeWin({ flatQuestions: [{ question: { id: "q1", type: "single", correct: { correctIndex: 0 } } }] });
    ref().applyReference(win);
    ref().applyReference(win);
    expect(marks()).toHaveLength(1);
  });

  it("clearReference removes every marker", () => {
    document.body.innerHTML = '<div class="option" data-index="0" onclick="selectSingle(\'q1\',0)"><input></div>';
    const win = fakeWin({ flatQuestions: [{ question: { id: "q1", type: "single", correct: { correctIndex: 0 } } }] });
    ref().applyReference(win);
    expect(marks()).toHaveLength(1);
    ref().clearReference(win);
    expect(marks()).toHaveLength(0);
  });
});
