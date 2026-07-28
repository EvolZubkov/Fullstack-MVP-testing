/**
 * @module shared/template/fit-question
 *
 * Runtime, HEIGHT-based fit for the question scene (revision «Стандартный») — balancing
 * the room given to the PROMPT and to the ANSWER options so the whole card fits the
 * field without scrolling.
 *
 * The length-based {@link module:shared/template/fit-font} sets the INITIAL
 * `--tb-question-fs` / `--tb-answer-fs` from character counts, but that ignores the
 * space actually available: a long prompt was shrunk to the floor even with empty room
 * below, and long option lists scrolled. This pass measures the real layout and:
 *
 *  1. gives the header (meta + title + hint) the LARGEST prompt font that keeps it within
 *     `headerFraction` of the field (default 1/4) — so the prompt is never shrunk merely
 *     because the text is long, only when it would exceed its quarter;
 *  2. gives the options the LARGEST answer font that still fits them all without
 *     scrolling the field;
 *  3. as a last resort, if the options still overflow at their floor, lets the prompt
 *     yield space below its quarter (down to its floor) so everything fits — the balance
 *     point between the two areas.
 *
 * DOM-based but framework-free: the SCORM runtime calls it after rendering a question,
 * the web host from a layout effect on the shadow-mounted scene. Both write the two
 * font custom properties on the column, which the title / option cards bind to.
 */

/** Tuning for {@link fitQuestionScene}; all optional with design defaults. */
export interface FitQuestionOptions {
  /** Prompt font range (px). Default 32 / 18. */
  questionMax?: number;
  questionMin?: number;
  /** Option font range (px). Default 22 / 14. */
  answerMax?: number;
  answerMin?: number;
  /** Share of the field height the header may occupy. Default 0.25 (a quarter). */
  headerFraction?: number;
}

/** True when `field` scrolls its content (overflows its visible box). */
function overflows(field: HTMLElement): boolean {
  return field.scrollHeight > field.clientHeight + 1;
}

/**
 * Balances the prompt and option font sizes so the question card fits `field` without
 * scrolling, with the header capped at `headerFraction` of the field.
 *
 * @param field     The scrolling field — `.tb-scene__body` (its visible height is the
 *                  budget and its overflow is the no-scroll test).
 * @param col       The `.tb-scene__col` — where `--tb-question-fs` / `--tb-answer-fs`
 *                  are written (the title and option cards bind to them).
 * @param headerEnd The element whose bottom marks the end of the header — `.tb-scene__q`
 *                  (title + hint), which sits directly above the answers.
 * @param options   See {@link FitQuestionOptions}.
 */
export function fitQuestionScene(
  field: HTMLElement | null | undefined,
  col: HTMLElement | null | undefined,
  headerEnd: HTMLElement | null | undefined,
  options?: FitQuestionOptions,
): void {
  if (!field || !col || !headerEnd) return;
  const qMax = options?.questionMax ?? 32;
  const qMin = options?.questionMin ?? 18;
  const aMax = options?.answerMax ?? 22;
  const aMin = options?.answerMin ?? 14;
  const frac = options?.headerFraction ?? 0.25;

  const fieldH = field.clientHeight;
  if (!(fieldH > 0)) return;
  const colTop = col.getBoundingClientRect().top;
  const headerH = (): number => headerEnd.getBoundingClientRect().bottom - colTop;
  const setQ = (px: number) => col.style.setProperty("--tb-question-fs", `${px}px`);
  const setA = (px: number) => col.style.setProperty("--tb-answer-fs", `${px}px`);

  // Phase 1 — prompt: largest font that keeps the header within its quarter.
  let q = qMax;
  setQ(q);
  let guard = 0;
  while (q > qMin && headerH() > fieldH * frac && guard++ < 128) setQ(--q);

  // Phase 2 — options: largest answer font that fits them all without scrolling.
  let a = aMax;
  setA(a);
  guard = 0;
  while (a > aMin && overflows(field) && guard++ < 128) setA(--a);

  // Phase 3 — balance: if the options still overflow at their floor, let the prompt give
  // up space below its quarter (down to its floor) until the field no longer scrolls.
  guard = 0;
  while (q > qMin && overflows(field) && guard++ < 128) setQ(--q);
}
