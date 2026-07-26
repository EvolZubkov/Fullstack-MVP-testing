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

/** Question shape this module reads (a subset of the shared `Question`). */
export interface InteractionQuestion {
  type: string;
  dataJson?: { options?: unknown[] } | null;
}

/**
 * Answer key for review highlighting — mirrors the server `correctAnswer` payload and
 * the SCORM `q.correct` shape, so both hosts mark review identically.
 */
export interface ReviewCorrect {
  correctIndex?: number;
  correctIndices?: number[];
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
 * Review class suffix for an option: `" correct-answer"` for a right option, or
 * `" incorrect-answer"` for a chosen wrong one (the SAME class names the SCORM runtime
 * emits). Empty outside review mode.
 */
function reviewClass(multiple: boolean, oi: number, chosen: boolean, review?: ReviewCorrect): string {
  if (!review) return "";
  const correctSet = multiple && Array.isArray(review.correctIndices) ? review.correctIndices : null;
  const correctOne = !multiple && typeof review.correctIndex === "number" ? review.correctIndex : null;
  if (correctSet) {
    if (correctSet.includes(oi)) return " correct-answer";
    if (chosen) return " incorrect-answer";
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

/** One option card: control + title, with `is-on`/review classes and the delegated action. */
function optionCard(control: string, title: string, chosen: boolean, review: string, oi: number): string {
  return (
    `<label class="ou-radio-card${chosen ? " is-on" : ""}${review}" ` +
    `data-action="select:${oi}" data-index="${oi}" role="button" tabindex="0">${control}` +
    `<span class="ou-radio-card__text">` +
    `<span class="ou-radio-card__title" style="font-weight:400;font-size:var(--tb-answer-fs,1.25rem);` +
    `line-height:1.35;text-wrap:pretty">${title}</span></span></label>`
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
  const options = question.dataJson?.options ?? [];
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
