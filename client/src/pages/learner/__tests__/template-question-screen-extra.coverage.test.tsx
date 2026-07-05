// @vitest-environment jsdom
/**
 * @module client/pages/learner/__tests__/template-question-screen-extra.coverage.test
 *
 * Supplemental branch coverage for the shared question screen host
 * ({@link module:client/pages/learner/template-question-screen}). The base suite
 * (`template-question-screen.test.tsx`) covers the single-choice chrome + custom
 * footer + feedback + lock; this file adds the remaining question types and the
 * `onAction` delegation branches that the base suite does not reach:
 *   - review highlighting for single / multiple / ranking / matching,
 *   - the `multiple` toggle in `nextAnswer` (select + deselect),
 *   - ranking board render + the ranking seed effect + the drag reorder action,
 *   - matching board render (chips, empty pool slot, review) + every
 *     `applyMatchingDrop` branch (right tile / pool slot / detach / early returns),
 *   - media rendering (image / audio / video),
 *   - the copy/cut/contextMenu guards and pill `goto:` navigation (even when locked).
 *
 * The interaction is driven the way the real renderer drives it: clicks on
 * `[data-action]` elements inside the shadow root are delegated to the host's
 * `onAction`, so hard-coded action buttons in the layout exercise the same branch
 * a pointer drop or a pill click would — deterministically, without pointer DnD.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { TemplateQuestionScreen } from "../template-question-screen";
import type { Question } from "@shared/schema";

// The layout keeps the standard chrome + interaction/feedback slots AND a fixed
// bank of `[data-action]` buttons. Clicking one delegates the exact action string
// to the host's onAction, exercising the goto:/drop:/select: switch deterministically.
const LAYOUT = `
<div class="layout-question-wrap">
  <div class="q-header"><h1 class="q-title" data-path="course.title"></h1></div>
  <div class="question-card">
    <div class="question-meta" data-path="state.questionCounterLabel"></div>
    <div class="question-text" data-slot="question-text"></div>
    <div data-slot="question-media"></div>
    <div data-slot="question-interaction"></div>
    <div data-slot="question-feedback"></div>
  </div>
  <div class="action-bank">
    <button data-action="goto:1" data-testid="a-goto">goto1</button>
    <button data-action="goto:x" data-testid="a-goto-nan">gotoNaN</button>
    <button data-action="drop:1:0" data-testid="a-rank-drop">rankDrop</button>
    <button data-action="drop:r1:0" data-testid="a-match-right">matchRight</button>
    <button data-action="drop:rx:0" data-testid="a-match-right-nan">matchRightNaN</button>
    <button data-action="drop:pool:1" data-testid="a-match-pool">matchPool</button>
    <button data-action="drop::0" data-testid="a-match-detach">matchDetach</button>
    <button data-action="drop:zz:0" data-testid="a-match-other">matchOther</button>
    <button data-action="drop:r1:x" data-testid="a-match-drag-nan">matchDragNaN</button>
  </div>
</div>`;

const tpl = { layout: LAYOUT, css: "" };

function shadowOf(container: HTMLElement): ShadowRoot {
  const host = container.querySelector("[data-template-screen]") as HTMLElement;
  return host.shadowRoot as ShadowRoot;
}

function clickAction(container: HTMLElement, action: string) {
  (shadowOf(container).querySelector(`[data-action="${action}"]`) as HTMLElement)?.click();
}

const single = (over: Partial<Question> = {}) =>
  ({
    id: "q-single",
    type: "single",
    prompt: "Одиночный?",
    dataJson: { options: ["A", "B", "C"] },
    mediaUrl: null,
    mediaType: null,
    ...over,
  }) as unknown as Question;

const multiple = (over: Partial<Question> = {}) =>
  ({
    id: "q-multi",
    type: "multiple",
    prompt: "Множественный?",
    dataJson: { options: ["A", "B", "C"] },
    mediaUrl: null,
    mediaType: null,
    ...over,
  }) as unknown as Question;

const ranking = (over: Partial<Question> = {}) =>
  ({
    id: "q-rank",
    type: "ranking",
    prompt: "Ранжирование?",
    dataJson: { items: ["i0", "i1", "i2"] },
    mediaUrl: null,
    mediaType: null,
    ...over,
  }) as unknown as Question;

const matching = (over: Partial<Question> = {}) =>
  ({
    id: "q-match",
    type: "matching",
    prompt: "Сопоставление?",
    dataJson: { left: ["l0", "l1"], right: ["r0", "r1"] },
    mediaUrl: null,
    mediaType: null,
    ...over,
  }) as unknown as Question;

const base = {
  tpl,
  testTitle: "Тест",
  counterLabel: "Вопрос 1 из 3",
  progressPercent: 33,
  shuffleMapping: undefined,
};

afterEach(() => cleanup());

// ─── choice review highlighting + multiple toggle ─────────────────────────────

describe("TemplateQuestionScreen — choice review + multiple toggle", () => {
  it("marks the correct + incorrect option in single review mode", () => {
    const { container } = render(
      <TemplateQuestionScreen
        {...base}
        question={single()}
        answer={1}
        onAnswer={() => {}}
        footer={<span />}
        reviewMode
        correctAnswer={{ correctIndex: 0 }}
      />,
    );
    const shadow = shadowOf(container);
    expect(shadow.querySelector('.option[data-index="0"]')?.className).toContain("correct-answer");
    expect(shadow.querySelector('.option[data-index="1"]')?.className).toContain("incorrect-answer");
  });

  it("marks all correct indices + the wrong pick in multiple review mode", () => {
    const { container } = render(
      <TemplateQuestionScreen
        {...base}
        question={multiple()}
        answer={[0, 2]}
        onAnswer={() => {}}
        footer={<span />}
        reviewMode
        correctAnswer={{ correctIndices: [0, 1] }}
      />,
    );
    const shadow = shadowOf(container);
    expect(shadow.querySelector('.option[data-index="0"]')?.className).toContain("correct-answer");
    expect(shadow.querySelector('.option[data-index="1"]')?.className).toContain("correct-answer");
    expect(shadow.querySelector('.option[data-index="2"]')?.className).toContain("incorrect-answer");
  });

  it("adds then removes an index for a multiple-choice question (nextAnswer toggle)", () => {
    const onAnswer = vi.fn();
    // From no answer, selecting index 1 adds it.
    const first = render(
      <TemplateQuestionScreen {...base} question={multiple()} answer={undefined} onAnswer={onAnswer} footer={<span />} />,
    );
    (shadowOf(first.container).querySelector('.option[data-action="select:1"]') as HTMLElement)?.click();
    expect(onAnswer).toHaveBeenLastCalledWith([1]);
    cleanup();

    // With index 1 already selected, selecting it again removes it.
    const second = render(
      <TemplateQuestionScreen {...base} question={multiple()} answer={[1]} onAnswer={onAnswer} footer={<span />} />,
    );
    (shadowOf(second.container).querySelector('.option[data-action="select:1"]') as HTMLElement)?.click();
    expect(onAnswer).toHaveBeenLastCalledWith([]);
  });
});

// ─── ranking: render, seed effect, review, reorder drop ───────────────────────

describe("TemplateQuestionScreen — ranking", () => {
  it("seeds the identity order once when a ranking question has no answer", () => {
    const onAnswer = vi.fn();
    render(
      <TemplateQuestionScreen {...base} question={ranking()} answer={undefined} onAnswer={onAnswer} footer={<span />} />,
    );
    // The mount effect seeds the ranking answer (submit-without-reorder accepted).
    expect(onAnswer).toHaveBeenCalledWith([0, 1, 2]);
  });

  it("renders the ranking board with a draggable row per item", () => {
    const { container } = render(
      <TemplateQuestionScreen {...base} question={ranking()} answer={[0, 1, 2]} onAnswer={() => {}} footer={<span />} />,
    );
    const shadow = shadowOf(container);
    expect(shadow.querySelector(".ranking-board")).toBeTruthy();
    expect(shadow.querySelectorAll(".rank-item.rank-draggable").length).toBe(3);
  });

  it("highlights correct/incorrect positions in ranking review mode", () => {
    const { container } = render(
      <TemplateQuestionScreen
        {...base}
        question={ranking()}
        answer={[1, 0, 2]}
        onAnswer={() => {}}
        footer={<span />}
        reviewMode
        correctAnswer={{ correctOrder: [0, 1, 2] }}
      />,
    );
    const shadow = shadowOf(container);
    expect(shadow.querySelector(".rank-item.incorrect-answer")).toBeTruthy();
    expect(shadow.querySelector(".rank-item.correct-answer")).toBeTruthy();
  });

  it("reorders the ranking on a drop action", () => {
    const onAnswer = vi.fn();
    const { container } = render(
      <TemplateQuestionScreen {...base} question={ranking()} answer={[0, 1, 2]} onAnswer={onAnswer} footer={<span />} />,
    );
    onAnswer.mockClear();
    // drop:1:0 → move the row at position 0 to position 1.
    clickAction(container, "drop:1:0");
    expect(onAnswer).toHaveBeenCalledWith([1, 0, 2]);
  });
});

// ─── matching: render, empty slot, review, every drop branch ──────────────────

describe("TemplateQuestionScreen — matching", () => {
  it("renders the matching board with chips + right tiles", () => {
    const { container } = render(
      <TemplateQuestionScreen {...base} question={matching()} answer={{}} onAnswer={() => {}} footer={<span />} />,
    );
    const shadow = shadowOf(container);
    expect(shadow.querySelector(".matching-board")).toBeTruthy();
    expect(shadow.querySelectorAll(".match-chip").length).toBe(2);
    expect(shadow.querySelectorAll(".match-right-tile").length).toBe(2);
  });

  it("renders an empty pool placeholder when chips run out before the rows", () => {
    // One left, two rights → the second (unmatched) row has no chip left in the pool.
    const { container } = render(
      <TemplateQuestionScreen
        {...base}
        question={matching({ dataJson: { left: ["l0"], right: ["r0", "r1"] } })}
        answer={{}}
        onAnswer={() => {}}
        footer={<span />}
      />,
    );
    expect(shadowOf(container).querySelector(".match-empty .slot-placeholder")?.textContent).toContain(
      "Перетащите вариант",
    );
  });

  it("highlights joined lines correct/incorrect in matching review mode", () => {
    const { container } = render(
      <TemplateQuestionScreen
        {...base}
        question={matching()}
        answer={{ 0: 0, 1: 1 }}
        onAnswer={() => {}}
        footer={<span />}
        reviewMode
        // Right 0 → left 0 (correct); right 1's correct left is 0, but 1 is placed (incorrect).
        correctAnswer={{ pairs: [{ left: 0, right: 0 }, { left: 0, right: 1 }] }}
      />,
    );
    const shadow = shadowOf(container);
    expect(shadow.querySelector(".matching-line.correct-answer")).toBeTruthy();
    expect(shadow.querySelector(".matching-line.incorrect-answer")).toBeTruthy();
  });

  it("attaches a pooled chip to a right tile (dropOnRight)", () => {
    const onAnswer = vi.fn();
    const { container } = render(
      <TemplateQuestionScreen {...base} question={matching()} answer={{}} onAnswer={onAnswer} footer={<span />} />,
    );
    clickAction(container, "drop:r1:0"); // chip 0 → right 1
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ 0: 1 }));
  });

  it("moves a chip to a pool slot (dropOnPoolSlot)", () => {
    const onAnswer = vi.fn();
    const { container } = render(
      <TemplateQuestionScreen {...base} question={matching()} answer={{}} onAnswer={onAnswer} footer={<span />} />,
    );
    clickAction(container, "drop:pool:1"); // parsed dropId "pool" → pool-slot drop
    expect(onAnswer).toHaveBeenCalled();
  });

  it("detaches a matched chip back to the pool on a drop-to-nowhere", () => {
    const onAnswer = vi.fn();
    const { container } = render(
      <TemplateQuestionScreen {...base} question={matching()} answer={{ 0: 1 }} onAnswer={onAnswer} footer={<span />} />,
    );
    clickAction(container, "drop::0"); // empty dropId → returnToPool (chip 0 was matched)
    expect(onAnswer).toHaveBeenCalledWith({});
  });

  it("ignores matching drops with an unparsable drag id or unknown drop zone", () => {
    const onAnswer = vi.fn();
    const { container } = render(
      <TemplateQuestionScreen {...base} question={matching()} answer={{}} onAnswer={onAnswer} footer={<span />} />,
    );
    clickAction(container, "drop:r1:x"); // NaN leftIdx → early return
    clickAction(container, "drop:rx:0"); // NaN rightIdx → early return
    clickAction(container, "drop:zz:0"); // unknown drop zone → return
    expect(onAnswer).not.toHaveBeenCalled();
  });
});

// ─── media, copy guards, pill navigation ──────────────────────────────────────

describe("TemplateQuestionScreen — media + guards + pills", () => {
  it("renders image / audio / video media into the media slot", () => {
    for (const [type, sel] of [
      ["image", "img"],
      ["audio", "audio"],
      ["video", "video"],
    ] as const) {
      const { container } = render(
        <TemplateQuestionScreen
          {...base}
          question={single({ mediaUrl: "/uploads/media/x", mediaType: type })}
          answer={undefined}
          onAnswer={() => {}}
          footer={<span />}
        />,
      );
      expect(shadowOf(container).querySelector(`[data-slot="question-media"] ${sel}`)).toBeTruthy();
      cleanup();
    }
  });

  it("prevents copy / cut / context-menu on the screen (anti-cheat guards)", () => {
    const { container } = render(
      <TemplateQuestionScreen {...base} question={single()} answer={undefined} onAnswer={() => {}} footer={<span />} />,
    );
    const root = container.querySelector(".tbh-minh-screen") as HTMLElement;
    for (const type of ["copy", "cut", "contextMenu"] as const) {
      const ev = fireEvent[type](root);
      expect(ev).toBe(false); // preventDefault() was called → dispatchEvent returns false
    }
  });

  it("navigates via a pill even when the interaction is locked, and ignores a NaN pill", () => {
    const onNavigate = vi.fn();
    const onAnswer = vi.fn();
    const { container } = render(
      <TemplateQuestionScreen
        {...base}
        question={single()}
        answer={undefined}
        onAnswer={onAnswer}
        footer={<span />}
        locked
        onNavigateToQuestion={onNavigate}
      />,
    );
    clickAction(container, "goto:1");
    clickAction(container, "goto:x"); // NaN → ignored
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(1);
    // Locked: a select action is swallowed (interaction read-only).
    (shadowOf(container).querySelector('.option[data-action="select:0"]') as HTMLElement)?.click();
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
