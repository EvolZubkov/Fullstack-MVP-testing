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
import { renderInlineMarkdown } from "../text/markdown";

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
 *
 * The copy must not name a POSITION: the matching grid stands the two columns up on a
 * narrow scene (theme.css step S2), so «карточка справа» is simply false on a phone —
 * there the chip sits under its prompt, not beside it. Naming the object instead of its
 * place is true at every width.
 */
const QUESTION_HINTS: Readonly<Record<string, string>> = {
  single: "Выберите один вариант ответа",
  multiple: "Выберите один или несколько вариантов",
  ranking: "Расставьте элементы в правильном порядке — перетащите или кнопками ↑/↓",
  matching: "Перетащите карточку на нужную строку",
  scale: "Выберите ответ на шкале",
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

/**
 * Render one answer text: the markdown subset an author may type, with the
 * typography pass applied ({@link module:shared/text/markdown}).
 *
 * Inline rendering, never block: an option is a `.ou-radio-card__title`, and a
 * `<p>` inside it would break the card. Escaping happens inside the renderer,
 * before any tag is generated, so markup the author typed still cannot reach the
 * DOM as markup — the safety property of the plain `esc()` this replaced is kept.
 */
function answerHtml(text: unknown): string {
  return renderInlineMarkdown(text === null || text === undefined ? "" : String(text));
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
 *  - correct & chosen   → `" correct-answer"` (green, ✓)      — правильно выбранный
 *  - correct & !chosen  → `" missed-answer"`  (yellow, red ✗) — ошибочно пропущенный
 *  - wrong & chosen     → `" incorrect-answer"` (red, ✗)      — ошибочно выбранный
 *  - wrong & !chosen    → `" correct-skip"` (green, no mark)  — правильно пропущенный
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

/** The trailing mark for a review class: a check ONLY on a correctly chosen option
 *  (`" correct-answer"` green ✓). Both mistakes get a cross — a wrongly chosen option
 *  (`" incorrect-answer"`, red ✗) AND a missed correct one (`" missed-answer"`): the
 *  learner got that option wrong too, so a check would falsely read as «верно здесь»;
 *  its cross is coloured red by the scene layer while the card stays yellow. A
 *  correctly-skipped wrong option (`" correct-skip"`) stays green but unmarked. */
function reviewMark(review: string): string {
  if (review === " correct-answer") return `<span class="ou-radio-card__mark">${MARK_CHECK}</span>`;
  if (review === " incorrect-answer" || review === " missed-answer") return `<span class="ou-radio-card__mark">${MARK_CROSS}</span>`;
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
      return optionCard(control, answerHtml(options[oi]), chosen, reviewClass(multiple, oi, chosen, review), oi);
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

// ─── Scale (Likert) ──────────────────────────────────────────────────────────

/**
 * Graduation count above which the scale lays out vertically (PRD-26 FR-16). Up to
 * seven points stay side by side; beyond that the labels get too narrow to read. A
 * NARROW scene switches to the same vertical layout through the template's `theme.css`
 * media query, so this constant is only the «too many points» half of the rule.
 */
const SCALE_HORIZONTAL_MAX = 7;

/** Status class of one graduation. Verdict wins over the plain selection state. */
function scaleStatus(index: number, chosen: number | null, correct: number | null): string {
  if (correct !== null) {
    if (index === correct) return " is-success";
    if (index === chosen) return " is-error";
    return chosen !== null && index < chosen ? " is-done" : "";
  }
  if (chosen === null) return "";
  if (index === chosen) return " is-current";
  return index < chosen ? " is-done" : "";
}

/**
 * A scale question as the DS `Stepper` in choice mode — the SAME component the author
 * UI uses for process steps, with the `ou-stepper--choice` modifier that turns it into
 * an answer control (empty bullets, wrapping labels, the fill reading as «position on
 * the scale»). No bespoke scale component exists, and none is needed.
 *
 * Graduations before the chosen one carry `is-done`, so the DS tints the CONNECTOR up
 * to the answer; the chosen one carries `is-current`. In review the right graduation is
 * `is-success` and a wrongly chosen one `is-error`, and the root gains
 * `ou-stepper--review` so the accent fill is muted and only the verdict has colour.
 *
 * There is no `shuffleMapping` parameter on purpose: the order of graduations is
 * content, not presentation, and must never be shuffled (see `hasFixedOptionOrder` in
 * {@link module:shared/questions/question-type}).
 *
 * Clicks are delegated exactly like the other types — `data-action="select:<index>"` —
 * so the hosts wire nothing special.
 */
export function renderScale(
  question: InteractionQuestion,
  answer: unknown,
  review?: ReviewCorrect,
): string {
  const options = fields(question).options;
  const chosen = typeof answer === "number" ? answer : null;
  // Measurement-only questions have no `correctIndex`, so review simply produces no
  // verdict classes — the same call works for both modes.
  const correct = review && typeof review.correctIndex === "number" ? review.correctIndex : null;

  const rootCls =
    "ou-stepper ou-stepper--choice" +
    (options.length > SCALE_HORIZONTAL_MAX ? " ou-stepper--vertical" : "") +
    (correct !== null ? " ou-stepper--review" : "");

  const steps = options
    .map((label, i) => {
      const status = scaleStatus(i, chosen, correct);
      return (
        `<button type="button" class="ou-stepper__step ou-stepper__step--btn${status}" ` +
        `role="radio" aria-checked="${chosen === i ? "true" : "false"}" ` +
        `data-action="select:${i}" data-index="${i}">` +
        `<span class="ou-stepper__bullet"></span>` +
        `<span class="ou-stepper__label"><span class="ou-stepper__title">${answerHtml(label)}</span></span>` +
        `</button>`
      );
    })
    .join("");

  return `<div class="${rootCls}" role="radiogroup">${steps}</div>`;
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
        `${answerHtml(items[oi])}</span></span>` +
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
    `style="font-size:var(--tb-answer-fs,1.125rem)">${answerHtml(left[li])}</span></span></div>`;

  // Adaptive column ratio. The LEFT column shows the prompts (`right` items), the
  // RIGHT column the answer chips (`left` items). When one side's LONGEST text
  // noticeably exceeds the other's, give that side more room (≈66/33) instead of an
  // even 50/50. «Noticeable» = at least half again as long (1.5×) AND at least 25
  // characters longer, so a handful of extra characters never shifts the layout.
  const maxLen = (arr: unknown[]): number =>
    arr.reduce((m: number, s) => Math.max(m, String(s ?? "").length), 0);
  const leftTextLen = maxLen(right);
  const rightTextLen = maxLen(left);
  const longer = Math.max(leftTextLen, rightTextLen);
  const shorter = Math.min(leftTextLen, rightTextLen);
  const skew = longer >= shorter * 1.5 && longer - shorter >= 25;
  const gapCol = "var(--ou-match-gap-w)";
  const columns = !skew
    ? `minmax(0, 1fr) ${gapCol} minmax(0, 1fr)`
    : leftTextLen > rightTextLen
      ? `minmax(0, 2fr) ${gapCol} minmax(0, 1fr)`
      : `minmax(0, 1fr) ${gapCol} minmax(0, 2fr)`;

  let poolSlot = 0;
  // The ratio goes out as a CUSTOM PROPERTY, never as `grid-template-columns` itself.
  // An inline track list outranks every stylesheet, so the narrow-screen fold could not
  // touch it — the grid kept three tracks while the gap column was hidden and the cards
  // auto-placed into the wrong ones, overlapping on a phone. The DS base rule reads this
  // variable (`.ou-match`), so the ratio still applies while a rule can still override
  // the whole track list.
  let html = `<div class="ou-match ou-match--gap-wide ou-match--side-r ou-match--icon-dots" style="--ou-match-cols:${columns}">`;
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
      `style="font-size:var(--tb-answer-fs,1.125rem)">${answerHtml(right[ri])}</span></span></div>`;
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
