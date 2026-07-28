/**
 * @module shared/template/question-interaction
 *
 * The SINGLE source of the learner question-interaction HTML (revision «Стандартный»
 * on ui-kit). Both hosts call these pure functions so the `.ou-*` answer markup cannot
 * drift between the web preview/renderer and the SCORM package: the web question screen
 * ({@link module:client/pages/learner/template-question-screen}) and the in-package
 * renderer (`server/scorm/template/app/render/*`) emit byte-identical options.
 *
 * Interaction stays delegated, as everywhere else in the unified renderer: the option
 * card carries `data-action="select:<originalIndex>"` and the host wires the click (web
 * via {@link module:client/components/template-screen}, package via its render layer).
 * Selection is therefore CLASS-driven (`is-on`), not native input state — the controls
 * are decorative, so there is no real `<input>` to desync from the delegated answer.
 *
 * Markup is ported from the approved wireframes
 * (`docs/wireframes/prohozhdenie/Прохождение теста[ - множественный выбор].html`):
 * `label.ou-radio-card` + `ou-radio`/`ou-check` + `ou-radio-card__title`. Layout that is
 * a property of the SCENE (card fill, the 8px inter-option gap, the multiple-choice
 * `is-on` tick) lives in the template `theme.css` scene layer, not inline here — this
 * file emits semantic DS markup only. The per-option answer font size is the variable
 * `--tb-answer-fs` (computed by the fit-font pass); never a magic literal.
 *
 * Pure/framework-free — no DOM, no Node — safe to bundle into the SCORM runtime.
 */
import { normalizePool } from "./dnd/matching-model";

/**
 * Question shape this module reads. `dataJson` is untyped (a jsonb column reaches the
 * host as `unknown`), so both hosts can pass their own question object without a cast.
 */
export interface InteractionQuestion {
  type: string;
  dataJson?: unknown;
}

/** The answer collections a question may carry, read defensively from `dataJson`. */
function fields(q: InteractionQuestion): {
  options: unknown[];
  items: unknown[];
  left: unknown[];
  right: unknown[];
} {
  const d = (q.dataJson ?? {}) as {
    options?: unknown[];
    items?: unknown[];
    left?: unknown[];
    right?: unknown[];
  };
  return { options: d.options ?? [], items: d.items ?? [], left: d.left ?? [], right: d.right ?? [] };
}

/**
 * Answer key for review highlighting — mirrors the server `correctAnswer` payload and
 * the SCORM `q.correct` shape, so both hosts mark review identically.
 */
export interface ReviewCorrect {
  correctIndex?: number;
  correctIndices?: number[];
  correctOrder?: number[];
  pairs?: { left: number; right: number }[];
}

/**
 * The learner guidance shown as the question subtitle, by type — the SAME copy on both
 * hosts (the wireframe places it under the question title). Empty for unknown types.
 */
const QUESTION_HINTS: Readonly<Record<string, string>> = {
  single: "Выберите один вариант ответа",
  multiple: "Выберите один или несколько вариантов",
  ranking: "Расставьте элементы в правильном порядке — перетащите или кнопками ↑/↓",
  matching: "Перетащите карточку справа на нужную строку",
};

/** Guidance subtitle for a question type (empty when the type has none). */
export function questionHint(type: string): string {
  return QUESTION_HINTS[type] ?? "";
}

/**
 * All answer texts of a question, by type — the strings the options/items/cards show.
 * Used to size the option font to the longest one (see fit-font). Reads the same
 * `dataJson` collections the render functions do.
 */
export function answerTexts(question: InteractionQuestion): unknown[] {
  const f = fields(question);
  if (question.type === "ranking") return f.items;
  if (question.type === "matching") return [...f.left, ...f.right];
  return f.options;
}

/** HTML-escape user text (same convention as {@link module:shared/template/renderers}). */
function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** True when option `oi` is chosen (single = equals, multiple = in the array). */
function isChosen(answer: unknown, oi: number): boolean {
  return Array.isArray(answer) ? answer.includes(oi) : answer === oi;
}

/** Display order: the shuffle mapping when it matches the option count, else identity. */
function displayOrder(count: number, shuffleMapping?: number[]): number[] {
  return shuffleMapping && shuffleMapping.length === count
    ? shuffleMapping
    : Array.from({ length: count }, (_, i) => i);
}

/**
 * Review class suffix for an option (the SAME class names the SCORM runtime emits).
 * Empty outside review mode.
 *
 * Single choice is binary: `" correct-answer"` (green) on the right option,
 * `" incorrect-answer"` (red) on a chosen wrong one.
 *
 * Multiple choice is a per-option traffic light on the learner's HANDLING of each
 * option, not just the answer key:
 *  - correct & chosen   → `" correct-answer"` (green, ✓)   — правильно выбранный
 *  - correct & !chosen  → `" missed-answer"`  (yellow, ✓)  — ошибочно пропущенный
 *  - wrong & chosen     → `" incorrect-answer"` (red, ✗)   — ошибочно выбранный
 *  - wrong & !chosen    → `" correct-skip"` (green, no ✓)  — правильно пропущенный
 */
function reviewClass(multiple: boolean, oi: number, chosen: boolean, review?: ReviewCorrect): string {
  if (!review) return "";
  const correctSet = multiple && Array.isArray(review.correctIndices) ? review.correctIndices : null;
  const correctOne = !multiple && typeof review.correctIndex === "number" ? review.correctIndex : null;
  if (correctSet) {
    if (correctSet.includes(oi)) return chosen ? " correct-answer" : " missed-answer";
    return chosen ? " incorrect-answer" : " correct-skip";
  } else if (correctOne !== null) {
    if (oi === correctOne) return " correct-answer";
    if (chosen) return " incorrect-answer";
  }
  return "";
}

/** Radio control (single choice) — ring + dot, filled via `.ou-radio.is-on`. */
function radioControl(on: boolean): string {
  return (
    `<span class="ou-radio ou-radio--m${on ? " is-on" : ""}">` +
    `<span class="ou-radio__ring"><span class="ou-radio__dot"></span></span></span>`
  );
}

/**
 * Check control (multiple choice) — square box + tick. The tick is shown by the scene
 * rule `.ou-radio-card.is-on .ou-check__box` (theme.css), matching the class-driven card.
 */
function checkControl(): string {
  return (
    `<span class="ou-check ou-check--m"><span class="ou-check__box">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path>` +
    `</svg></span></span>`
  );
}

/** Trailing verdict icon shown on a reviewed option card (wireframe `question — проверка`):
 *  a check on the right option, a cross on a chosen wrong one. Colour is inherited from
 *  the card's `.correct-answer`/`.incorrect-answer` class (theme.css), so no literal here. */
const MARK_CHECK =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';
const MARK_CROSS =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>';

/** The trailing mark for a review class: a check on the answer-key options
 *  (`" correct-answer"` green / `" missed-answer"` yellow), a cross on a chosen wrong
 *  one (`" incorrect-answer"`); a correctly-skipped wrong option (`" correct-skip"`)
 *  stays green but unmarked, since it is not itself a correct answer. */
function reviewMark(review: string): string {
  if (review === " correct-answer" || review === " missed-answer") return `<span class="ou-radio-card__mark">${MARK_CHECK}</span>`;
  if (review === " incorrect-answer") return `<span class="ou-radio-card__mark">${MARK_CROSS}</span>`;
  return "";
}

/** One option card: control + title, with `is-on`/review classes, verdict mark and the delegated action. */
function optionCard(control: string, title: string, chosen: boolean, review: string, oi: number): string {
  return (
    `<label class="ou-radio-card${chosen ? " is-on" : ""}${review}" ` +
    `data-action="select:${oi}" data-index="${oi}" role="button" tabindex="0">${control}` +
    `<span class="ou-radio-card__text">` +
    `<span class="ou-radio-card__title" style="font-weight:400;font-size:var(--tb-answer-fs,1.25rem);` +
    `line-height:1.35;text-wrap:pretty">${title}</span></span>${reviewMark(review)}</label>`
  );
}

/** Shared body for single/multiple — same card, differing control and review arity. */
function renderChoice(
  question: InteractionQuestion,
  answer: unknown,
  shuffleMapping: number[] | undefined,
  review: ReviewCorrect | undefined,
  multiple: boolean,
): string {
  const options = fields(question).options;
  const items = displayOrder(options.length, shuffleMapping)
    .map((oi) => {
      const chosen = isChosen(answer, oi);
      const control = multiple ? checkControl() : radioControl(chosen);
      return optionCard(control, esc(options[oi]), chosen, reviewClass(multiple, oi, chosen, review), oi);
    })
    .join("");
  return `<div class="ou-radio-group ou-radio-group--vertical"><div class="ou-radio-group__items">${items}</div></div>`;
}

/**
 * Single-choice options as `ou-radio-card`s. The chosen option carries `is-on`; clicks
 * are delegated via `data-action="select:<originalIndex>"`. `shuffleMapping` maps display
 * position to the original option index; `review` adds correct/incorrect highlight classes.
 */
export function renderSingleChoice(
  question: InteractionQuestion,
  answer: unknown,
  shuffleMapping?: number[],
  review?: ReviewCorrect,
): string {
  return renderChoice(question, answer, shuffleMapping, review, false);
}

/**
 * Multiple-choice options as `ou-radio-card`s with a check box. Chosen options carry
 * `is-on` (the scene shows the tick); clicks are delegated via `data-action="select:N"`.
 */
export function renderMultiple(
  question: InteractionQuestion,
  answer: unknown,
  shuffleMapping?: number[],
  review?: ReviewCorrect,
): string {
  return renderChoice(question, answer, shuffleMapping, review, true);
}

// ─── Ranking ─────────────────────────────────────────────────────────────────

/** Six-dot drag grip (ranking rows). */
const RANK_GRIP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">' +
  '<path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01"></path></svg>';
const CHEVRON_UP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"></path></svg>';
const CHEVRON_DOWN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>';

/** Current ranking order: the answer if complete, else the shuffle/identity order. */
function rankingOrder(count: number, answer: unknown, shuffleMapping?: number[]): number[] {
  if (Array.isArray(answer) && answer.length === count) return answer as number[];
  return displayOrder(count, shuffleMapping);
}

/**
 * Ranking as `ou-rank` rows. Rows are drag-reorderable (`data-drag`/`data-drop` on the
 * display POSITION, so the shared pointer engine reorders them; the host maps the drop to
 * a reorder) and also carry keyboard up/down controls (`data-action="rank-up|rank-down:pos"`).
 * `review.correctOrder` marks each position correct/incorrect.
 */
export function renderRanking(
  question: InteractionQuestion,
  answer: unknown,
  shuffleMapping?: number[],
  review?: ReviewCorrect,
): string {
  const items = fields(question).items;
  const order = rankingOrder(items.length, answer, shuffleMapping);
  const correctOrder = review && Array.isArray(review.correctOrder) ? review.correctOrder : null;
  const rows = order
    .map((oi, pos) => {
      let cls = "ou-rank__item";
      if (correctOrder) cls += oi === correctOrder[pos] ? " correct-answer" : " incorrect-answer";
      const up =
        `<button type="button" class="ou-rank__btn" aria-label="Выше" data-action="rank-up:${pos}"` +
        `${pos === 0 ? " disabled" : ""}>${CHEVRON_UP}</button>`;
      const down =
        `<button type="button" class="ou-rank__btn" aria-label="Ниже" data-action="rank-down:${pos}"` +
        `${pos === order.length - 1 ? " disabled" : ""}>${CHEVRON_DOWN}</button>`;
      return (
        // No `draggable="true"` — the shared pointer engine drives the drag; the native
        // flag would start a browser drag that cancels the pointer gesture (see dragCard).
        `<div class="${cls}" data-drag="${pos}" data-drop="${pos}">` +
        `<span class="ou-rank__grip" aria-hidden="true">${RANK_GRIP}</span>` +
        `<span class="ou-rank__index ou-rank__index--round ou-rank__index--accent">${pos + 1}</span>` +
        `<span class="ou-rank__text"><span class="ou-rank__title" ` +
        `style="font-weight:400;font-size:var(--tb-answer-fs,1.25rem);line-height:1.35;text-wrap:pretty">` +
        `${esc(items[oi])}</span></span>` +
        `<span class="ou-rank__controls">${up}${down}</span></div>`
      );
    })
    .join("");
  return `<div class="ou-rank">${rows}</div>`;
}

// ─── Matching ────────────────────────────────────────────────────────────────

/** Left indices in display order (shuffle mapping when it matches, else identity). */
function matchingLeftMapping(count: number, shuffleMapping?: { left: number[]; right: number[] }): number[] {
  return shuffleMapping?.left?.length === count ? shuffleMapping.left : displayOrder(count, undefined);
}

/**
 * Matching as an `ou-match` grid: a FIXED prompt (the right item) and a DRAGgable answer
 * (the left item) per row (`ou-match--side-r`). The draggable chip carries `data-drag=<leftIdx>`
 * and its cell is a drop zone — `data-drop="r<rightIdx>"` on a joined row (drop displaces),
 * `data-drop="pool:<slot>"` on an open row (drop fills). The unplaced-chip order is the rich
 * pool, reconciled with the answer via {@link module:shared/template/dnd/matching-model normalizePool}
 * — the SAME model both hosts drive. `review.pairs` marks each joined row correct/incorrect.
 */
export function renderMatching(
  question: InteractionQuestion,
  answer: unknown,
  shuffleMapping?: { left: number[]; right: number[] },
  poolOrder: number[] = [],
  review?: ReviewCorrect,
): string {
  const { left, right } = fields(question);
  const leftMapping = matchingLeftMapping(left.length, shuffleMapping);
  const rightMapping = shuffleMapping?.right?.length === right.length ? shuffleMapping.right : displayOrder(right.length, undefined);
  const pairs = (answer && typeof answer === "object" ? answer : {}) as Record<number, number>;
  const rightToLeft: Record<number, number> = {};
  Object.keys(pairs).forEach((k) => {
    rightToLeft[pairs[Number(k)]] = Number(k);
  });
  const pool = normalizePool(poolOrder, pairs, leftMapping);

  const correctRightToLeft: Record<number, number> = {};
  if (review && Array.isArray(review.pairs)) {
    review.pairs.forEach((p) => {
      correctRightToLeft[p.right] = p.left;
    });
  }

  // A draggable answer chip (left item). The whole ROW is a drop target (both the
  // fixed prompt and this slot carry data-drop="r<ri>"), so a chip released anywhere
  // on «нужную строку» pairs with that row's prompt — the learner drags a right chip
  // up/down onto a row, exactly the wireframe gesture. Only the LEFT prompt lights up
  // (see the `:has(.is-over)` rule), so the right column is not itself a visible
  // receiving zone. No `draggable="true"`: the native HTML5 flag would start a browser
  // drag that fires pointercancel and kill the pointer gesture (real-mouse dragging
  // then silently did nothing).
  const dragCard = (li: number, dropId: string): string =>
    `<div class="ou-match__card ou-match__card--drag" data-drag="${li}" data-drop="${dropId}">` +
    `<span class="ou-match__icon" aria-hidden="true"></span>` +
    `<span class="ou-match__card-text"><span class="ou-match__card-title" ` +
    `style="font-size:var(--tb-answer-fs,1.125rem)">${esc(left[li])}</span></span></div>`;

  let poolSlot = 0;
  let html = '<div class="ou-match ou-match--gap-wide ou-match--side-r ou-match--icon-dots">';
  for (const ri of rightMapping) {
    const matchedLeft = rightToLeft[ri];
    const isJoined = matchedLeft !== undefined;
    let rowCls = `ou-match__row${isJoined ? " is-connected" : ""}`;
    if (review && isJoined) {
      // Same review classes as choice/ranking (and the SCORM feedback pass), styled
      // per-component in the scene layer — one convention across all question types.
      rowCls += Number(matchedLeft) === Number(correctRightToLeft[ri]) ? " correct-answer" : " incorrect-answer";
    }
    html += `<div class="${rowCls}">`;
    // Fixed prompt (the right item) on the left — a drop zone for this row so a chip
    // released over the prompt pairs with it; it is also the ONLY side that lights up.
    html +=
      `<div class="ou-match__card ou-match__card--fixed" data-drop="r${ri}">` +
      `<span class="ou-match__card-text"><span class="ou-match__card-title" ` +
      `style="font-size:var(--tb-answer-fs,1.125rem)">${esc(right[ri])}</span></span></div>`;
    // Connection indicator in the gap: a chevron-left «‹» pointing from the answer
    // toward its prompt. Dashed grey hint by default, solid + accent once the row is
    // connected (the DS `ou-match__gap-arrow` styling). The path is drawn pointing
    // right; the DS's `.ou-match--side-r` `scaleX(-1)` flips it to a left chevron.
    html +=
      '<div class="ou-match__gap" aria-hidden="true">' +
      '<svg class="ou-match__gap-arrow" viewBox="0 0 28 12"><path d="M10 2 L18 6 L10 10"></path></svg>' +
      '</div>';
    if (isJoined) {
      html += dragCard(matchedLeft, `r${ri}`);
    } else {
      const poolLeft = poolSlot < pool.length ? pool[poolSlot] : null;
      if (poolLeft !== null && poolLeft !== undefined) {
        html += dragCard(poolLeft, `r${ri}`);
      } else {
        html +=
          `<div class="ou-match__card ou-match__card--drag ou-match__card--empty" data-drop="r${ri}">` +
          `<span class="ou-match__placeholder">Перетащите вариант</span></div>`;
      }
      poolSlot++;
    }
    html += `</div>`;
  }
  html += "</div>";
  return html;
}
