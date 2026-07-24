/**
 * @module client/pages/learner/template-question-screen
 *
 * Renders the test-taking question screen from the design template (PRD-12 #3):
 * single (radio), multiple (checkbox) and ranking (↑/↓ reorder). The shadow-isolated
 * template provides the chrome (header / progress / question card); the interaction
 * is HTML filled into the `question-interaction` slot — styled by the template's own
 * `.option`/`.rank-item` CSS and wired back to React via `data-action` click
 * delegation (mirrors the SCORM runtime). React keeps the answer state; navigation
 * is rendered on the template surface below. All four question types render via the
 * template; matching drags left chips onto right slots using the SHARED pointer
 * engine and the SHARED rich pool model ({@link module:shared/template/dnd/matching-model}),
 * the same engine the SCORM host runs — so both hosts compute drops identically.
 */

import { useState, type ReactNode } from "react";
import { TemplateScreen } from "@/components/template-screen";
import type { Question } from "@shared/schema";
import type { CtxQuestionsProgress } from "@shared/template/context";
import {
  normalizePool,
  dropOnRight,
  dropOnPoolSlot,
  returnToPool,
  type MatchingState,
} from "@shared/template/dnd/matching-model";

function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** True when option `oi` is currently chosen (single = equals, multiple = in array). */
function isChosen(answer: unknown, oi: number): boolean {
  return Array.isArray(answer) ? answer.includes(oi) : answer === oi;
}

/**
 * Answer key for review highlighting — mirrors the server `correctAnswer` payload
 * and SCORM's `q.correct` shape (single/multiple/matching/ranking).
 */
type ReviewCorrect = {
  correctIndex?: number;
  correctIndices?: number[];
  pairs?: { left: number; right: number }[];
  correctOrder?: number[];
};

/**
 * Build choice options HTML (single → radio, multiple → checkbox). The template's
 * `.option` CSS styles both; clicks are delegated via `data-action="select:N"`.
 * In review mode (`review` set) options get `.correct-answer`/`.incorrect-answer`
 * classes — the SAME classes the SCORM runtime emits (server/scorm .../single.js,
 * multiple.js), so both hosts highlight review identically.
 */
function optionsHtml(question: Question, answer: unknown, shuffleMapping?: number[], review?: ReviewCorrect): string {
  const data = (question.dataJson as { options?: unknown[] }) || {};
  const options = data.options || [];
  const order =
    shuffleMapping && shuffleMapping.length === options.length
      ? shuffleMapping
      : options.map((_, i) => i);
  const inputType = question.type === "multiple" ? "checkbox" : "radio";
  const correctIndices =
    question.type === "multiple" && Array.isArray(review?.correctIndices) ? review!.correctIndices : null;
  const correctIndex =
    question.type !== "multiple" && typeof review?.correctIndex === "number" ? review!.correctIndex : null;
  return order
    .map((oi) => {
      const chosen = isChosen(answer, oi);
      let cls = `option${chosen ? " selected" : ""}`;
      if (review) {
        if (correctIndices) {
          if (correctIndices.includes(oi)) cls += " correct-answer";
          else if (chosen) cls += " incorrect-answer";
        } else if (correctIndex !== null) {
          if (oi === correctIndex) cls += " correct-answer";
          else if (chosen) cls += " incorrect-answer";
        }
      }
      return (
        `<div class="${cls}" data-action="select:${oi}" data-index="${oi}" role="button" tabindex="0">` +
        `<input type="${inputType}" ${chosen ? "checked" : ""} tabindex="-1" aria-hidden="true">` +
        `<span>${esc(options[oi])}</span></div>`
      );
    })
    .join("");
}

/** Compute the next answer when option `oi` is toggled, by question type. */
function nextAnswer(question: Question, answer: unknown, oi: number): unknown {
  if (question.type === "multiple") {
    const arr = Array.isArray(answer) ? (answer as number[]) : [];
    return arr.includes(oi) ? arr.filter((x) => x !== oi) : [...arr, oi];
  }
  return oi;
}

/** Current ranking order: the answer if set, else identity/shuffle. */
function rankingOrder(question: Question, answer: unknown, shuffleMapping?: number[]): number[] {
  const items = (question.dataJson as { items?: unknown[] })?.items || [];
  if (Array.isArray(answer) && answer.length === items.length) return answer as number[];
  return shuffleMapping && shuffleMapping.length === items.length ? shuffleMapping : items.map((_, i) => i);
}

const RANK_GRIP =
  '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
  '<path d="M2.5 4.99524H17.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>' +
  '<path d="M14.1667 9.9952H2.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>' +
  '<path d="M2.5 14.9951H10.8333" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

/** Drag marker for matching chips — dots glyph (distinct from ranking's burger; mirrors ui-kit `dots`). */
const MATCH_GRIP =
  '<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">' +
  '<circle cx="7" cy="5" r="1.4"></circle><circle cx="13" cy="5" r="1.4"></circle>' +
  '<circle cx="7" cy="10" r="1.4"></circle><circle cx="13" cy="10" r="1.4"></circle>' +
  '<circle cx="7" cy="15" r="1.4"></circle><circle cx="13" cy="15" r="1.4"></circle></svg>';

/** Build ranking HTML — draggable rows (HTML5 DnD via shadow delegation), mirrors SCORM. */
function rankingHtml(question: Question, answer: unknown, shuffleMapping?: number[], review?: ReviewCorrect): string {
  const items = (question.dataJson as { items?: unknown[] })?.items || [];
  const order = rankingOrder(question, answer, shuffleMapping);
  const correctOrder = review && Array.isArray(review.correctOrder) ? review.correctOrder : null;
  return (
    '<div class="ranking-board">' +
    order
      .map((oi, pos) => {
        let cls = "rank-item rank-draggable";
        if (correctOrder) cls += oi === correctOrder[pos] ? " correct-answer" : " incorrect-answer";
        return (
          `<div class="${cls}" data-drag="${pos}" data-drop="${pos}">` +
          `<span class="rank-grip">${RANK_GRIP}</span>` +
          `<span class="rank-text">${esc(items[oi])}</span></div>`
        );
      })
      .join("") +
    "</div>"
  );
}

/** Reorder ranking by moving the item from `fromPos` to `toPos` (drop). */
function reorderRanking(
  question: Question,
  answer: unknown,
  shuffleMapping: number[] | undefined,
  fromPos: number,
  toPos: number,
): number[] {
  const order = [...rankingOrder(question, answer, shuffleMapping)];
  if (fromPos === toPos || fromPos < 0 || toPos < 0 || fromPos >= order.length || toPos >= order.length) {
    return order;
  }
  const [moved] = order.splice(fromPos, 1);
  order.splice(toPos, 0, moved);
  return order;
}

/** Per-type shuffle mapping: array for choice/ranking, {left,right} for matching. */
type ShuffleMapping = number[] | { left: number[]; right: number[] };

/** The left item indices in display order (shuffle mapping when present, else identity). */
function matchingLeftMapping(question: Question, shuffleMapping?: { left: number[]; right: number[] }): number[] {
  const left = (question.dataJson as { left?: unknown[] })?.left || [];
  return shuffleMapping?.left?.length === left.length ? shuffleMapping.left : left.map((_, i) => i);
}

/**
 * Build matching HTML — left chips dragged onto right slots via the shared pointer
 * engine. The pool of unmatched chips is kept in EXPLICIT order (the rich model)
 * and reconciled with the answer through {@link normalizePool}. Each left slot is a
 * drop zone (`data-drop="pool:<slot>"` so a chip can return to a precise slot); the
 * right tile is `data-drop="r<rightIdx>"`; chips carry `data-drag="<leftIdx>"`.
 */
function matchingHtml(
  question: Question,
  answer: unknown,
  shuffleMapping: { left: number[]; right: number[] } | undefined,
  poolOrder: number[],
  review?: ReviewCorrect,
): string {
  const data = (question.dataJson as { left?: unknown[]; right?: unknown[] }) || {};
  const left = data.left || [];
  const right = data.right || [];
  const leftMapping = matchingLeftMapping(question, shuffleMapping);
  const rightMapping = shuffleMapping?.right?.length === right.length ? shuffleMapping.right : right.map((_, i) => i);
  const pairs = (answer && typeof answer === "object" ? answer : {}) as Record<number, number>;
  const rightToLeft: Record<number, number> = {};
  Object.keys(pairs).forEach((k) => {
    rightToLeft[pairs[Number(k)]] = Number(k);
  });
  const pool = normalizePool(poolOrder, pairs, leftMapping);

  // Review: correct right→left pairs (mirrors SCORM feedback.js highlightMatching).
  const correctRightToLeft: Record<number, number> = {};
  if (review && Array.isArray(review.pairs)) {
    review.pairs.forEach((p) => {
      correctRightToLeft[p.right] = p.left;
    });
  }

  const chip = (li: number) =>
    `<div class="match-chip" data-drag="${li}"><span class="match-grip" aria-hidden="true">${MATCH_GRIP}</span>` +
    `<span class="match-chip-text">${esc(left[li])}</span></div>`;

  let poolSlot = 0;
  let html = '<div class="matching-board">';
  for (const ri of rightMapping) {
    const matchedLeft = rightToLeft[ri];
    const isJoined = matchedLeft !== undefined;
    let lineCls = `matching-line${isJoined ? " is-joined" : ""}`;
    if (review && isJoined) {
      lineCls += Number(matchedLeft) === Number(correctRightToLeft[ri]) ? " correct-answer" : " incorrect-answer";
    }
    html += `<div class="${lineCls}">`;
    // A matched row's left pairs to THIS right (drop another chip = displace); an
    // unmatched row's left is a pool slot. poolSlot advances ONLY on unmatched rows.
    if (isJoined) {
      html += `<div class="match-tile match-left-slot match-drop-left" data-drop="r${ri}">${chip(matchedLeft)}</div>`;
    } else {
      const poolLeft = poolSlot < pool.length ? pool[poolSlot] : null;
      if (poolLeft !== null && poolLeft !== undefined) {
        html += `<div class="match-tile match-left-slot match-drop-left" data-drop="pool:${poolSlot}">${chip(poolLeft)}</div>`;
      } else {
        html += `<div class="match-empty match-left-slot match-drop-left" data-drop="pool:${poolSlot}"><span class="slot-placeholder">Перетащите вариант</span></div>`;
      }
      poolSlot++;
    }
    html += `<div class="matching-gap"></div>`;
    html += `<div class="match-tile match-right-tile match-drop-right" data-drop="r${ri}">${esc(right[ri])}</div>`;
    html += `</div>`;
  }
  html += "</div>";
  return html;
}

/** Interaction HTML for the `question-interaction` slot, by question type. */
function interactionHtml(
  question: Question,
  answer: unknown,
  shuffleMapping: ShuffleMapping | undefined,
  poolOrder: number[],
  review?: ReviewCorrect,
): string {
  const arr = Array.isArray(shuffleMapping) ? shuffleMapping : undefined;
  if (question.type === "ranking") return rankingHtml(question, answer, arr, review);
  if (question.type === "matching") {
    return matchingHtml(question, answer, !Array.isArray(shuffleMapping) ? shuffleMapping : undefined, poolOrder, review);
  }
  return optionsHtml(question, answer, arr, review);
}

function mediaHtml(question: Question): string {
  const url = question.mediaUrl;
  const type = question.mediaType;
  if (!url || !type) return "";
  if (type === "image")
    return `<img src="${esc(url)}" alt="" style="max-height:260px;object-fit:contain;margin:8px auto;display:block;border-radius:8px;">`;
  if (type === "audio") return `<audio controls style="width:100%"><source src="${esc(url)}"></audio>`;
  if (type === "video")
    return `<video controls style="max-height:260px;width:100%;border-radius:8px"><source src="${esc(url)}"></video>`;
  return "";
}

export interface TemplateQuestionScreenProps {
  tpl: {
    layout: string;
    css: string;
    theme?: { background: string; foreground: string };
    /** Per-test design-param CSS-var overrides (PRD-7 branding); applied on the shadow host. */
    cssVars?: Record<string, string>;
    /** PRD-23: per-theme colour overrides, printed as CSS. */
    themeCss?: string;
    /** PRD-23: palette pinned by the author; absent means «Авто». */
    dataTheme?: "light" | "dark";
    /** Per-test branding for the render context (logo). */
    design?: { logoUrl?: string };
  };
  testTitle: string;
  counterLabel: string;
  progressPercent: number;
  question: Question;
  answer: unknown;
  shuffleMapping?: ShuffleMapping;
  onAnswer: (answer: unknown) => void;
  /** Controlled HTML for the `question-feedback` slot (e.g. after-answer feedback). */
  feedbackHtml?: string;
  /** When true, the interaction is read-only (clicks/drags don't change the answer). */
  locked?: boolean;
  /** When true, render answer-review highlighting (correct/wrong) from `correctAnswer`. */
  reviewMode?: boolean;
  /** Correct-answer key (correctIndex/correctIndices/pairs/correctOrder) for review. */
  correctAnswer?: ReviewCorrect;
  /** Custom footer; when provided, replaces the default standard Назад/Далее nav. */
  footer?: ReactNode;
  /** When false, the default footer's «Далее»/«Завершить» is disabled (no usable
   *  answer yet) — parity with the custom footer's «Отправить ответ» gate. */
  answerReady?: boolean;
  // Standard-mode nav (used only when `footer` is not provided):
  canPrev?: boolean;
  onPrev?: () => void;
  /** PRD-19 (Block B): «Пропустить» — flexible-mode skip, shown when `canSkip`. */
  canSkip?: boolean;
  onSkip?: () => void;
  isLast?: boolean;
  isSubmitting?: boolean;
  onNext?: () => void;
  onSubmit?: () => void;
  /** PRD-19 Block C: progress-pills map (Core-prepared); renders the pill row. */
  questionsProgress?: CtxQuestionsProgress;
  /** PRD-19 Block C: jump to an absolute question index from a pill click. */
  onNavigateToQuestion?: (index: number) => void;
}

export function TemplateQuestionScreen(props: TemplateQuestionScreenProps) {
  const { tpl, testTitle, counterLabel, progressPercent, question, answer, shuffleMapping } = props;
  const onAnswer = props.onAnswer;

  // Matching keeps the ordered pool as UI state (separate from the graded answer,
  // mirroring the SCORM runtime's `state.matchingPools`), keyed by question id.
  const [poolByQ, setPoolByQ] = useState<Record<string, number[]>>({});
  const poolOrder = poolByQ[question.id] || [];

  // Ranking is NOT auto-seeded as an answer: the delivered order is guaranteed
  // non-correct (createRankingMapping), so an untouched arrangement must not count
  // and «Отправить ответ» stays disabled until the learner actually reorders (the
  // answer is `undefined` until the first drag). The board still displays the
  // shuffled order via rankingOrder's fallback to shuffleMapping.

  const css = `${tpl.css}\n#q-progress-fill{width:${Math.round(progressPercent)}%}`;
  const slots = {
    "question-text": esc(question.prompt),
    "question-media": mediaHtml(question),
    "question-interaction": interactionHtml(
      question,
      answer,
      shuffleMapping,
      poolOrder,
      props.reviewMode ? props.correctAnswer : undefined,
    ),
    "question-feedback": props.feedbackHtml ?? "",
  };

  /** Apply a matching drop through the shared rich model, persisting pool + answer. */
  const applyMatchingDrop = (dropId: string, dragId: string) => {
    const leftIdx = Number(dragId);
    if (Number.isNaN(leftIdx)) return;
    const sm = !Array.isArray(shuffleMapping) ? shuffleMapping : undefined;
    const leftMapping = matchingLeftMapping(question, sm);
    const pairs = (answer && typeof answer === "object" ? (answer as Record<number, number>) : {});
    const pool = normalizePool(poolOrder, pairs, leftMapping);
    const state: MatchingState = { pairs, pool };
    const from: "pool" | "match" = leftIdx in pairs ? "match" : "pool";
    const payload = { leftIdx, from, poolIndex: from === "pool" ? pool.indexOf(leftIdx) : undefined };

    let next: MatchingState;
    if (dropId === "") {
      // Released away from every zone: a matched chip detaches; a pooled chip stays put.
      if (from !== "match") return;
      next = returnToPool(state, leftIdx);
    } else if (dropId.startsWith("r")) {
      const rightIdx = Number(dropId.slice(1));
      if (Number.isNaN(rightIdx)) return;
      next = dropOnRight(state, payload, rightIdx);
    } else if (dropId.startsWith("pool")) {
      const slot = dropId.indexOf(":") >= 0 ? Number(dropId.slice(dropId.indexOf(":") + 1)) : pool.length;
      next = dropOnPoolSlot(state, payload, Number.isNaN(slot) ? pool.length : slot);
    } else {
      return;
    }

    setPoolByQ((p) => ({ ...p, [question.id]: next.pool }));
    onAnswer(next.pairs);
  };

  return (
    <div
      className="tbh-minh-screen tbh-col tbh-noselect"
      // The chrome OUTSIDE the template's shadow root needs the same palette the
      // screen inside got, or its buttons ignore the test's branding.
      style={{ background: tpl.theme?.background, ...(tpl.cssVars as React.CSSProperties | undefined) }}
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <TemplateScreen
        className="tbh-fill"
        layout={tpl.layout}
        css={css}
        cssVars={tpl.cssVars}
        themeCss={tpl.themeCss}
        dataTheme={tpl.dataTheme}
        context={{ course: { title: testTitle }, state: { questionCounterLabel: counterLabel, questionsProgress: props.questionsProgress }, design: tpl.design }}
        slots={slots}
        onAction={(action) => {
          // PRD-19 Block C: pill navigation works even when the question is locked
          // (the lock guards answer editing, not navigating away).
          if (action.startsWith("goto:")) {
            const i = Number(action.slice("goto:".length));
            if (!Number.isNaN(i)) props.onNavigateToQuestion?.(i);
            return;
          }
          if (props.locked) return; // read-only while feedback is shown
          if (action.startsWith("select:")) {
            const i = Number(action.slice("select:".length));
            if (!Number.isNaN(i)) onAnswer(nextAnswer(question, answer, i));
            return;
          }
          if (action.startsWith("drop:")) {
            const sep = action.indexOf(":", 5);
            const dropId = action.slice(5, sep);
            const dragId = action.slice(sep + 1);
            if (question.type === "ranking") {
              const from = Number(dragId);
              const to = Number(dropId);
              const map = Array.isArray(shuffleMapping) ? shuffleMapping : undefined;
              if (!Number.isNaN(from) && !Number.isNaN(to)) {
                onAnswer(reorderRanking(question, answer, map, from, to));
              }
            } else if (question.type === "matching") {
              applyMatchingDrop(dropId, dragId);
            }
          }
        }}
      />

      <div
        className="tbh-foot"
        style={{ color: tpl.theme?.foreground }}
      >
        {props.footer !== undefined ? (
          props.footer
        ) : (
          <>
            <button
              type="button"
              onClick={props.onPrev}
              disabled={!props.canPrev}
              className="tbh-navbtn"
            >
              ← Назад
            </button>
            {props.canSkip && (
              <button type="button" onClick={props.onSkip} className="tbh-navbtn">
                Пропустить
              </button>
            )}
            <button
              type="button"
              onClick={props.isLast ? props.onSubmit : props.onNext}
              disabled={props.isSubmitting || props.answerReady === false}
              className="tbh-primarybtn"
             
            >
              {props.isLast ? (props.isSubmitting ? "Отправка..." : "Завершить тест") : "Далее →"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
