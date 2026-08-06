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
 *     `headerFraction` of the field (default 1/3) — so the prompt is never shrunk merely
 *     because the text is long, only when it would exceed its third;
 *  2. gives the options the LARGEST answer font that still fits them all without
 *     scrolling the field;
 *  3. as a last resort, if the options still overflow, lets the prompt yield space —
 *     but only from its third DOWN TO `headerFractionMin` (default 1/4), never below —
 *     so everything fits: the balance point between the two areas.
 *
 * DOM-based but framework-free: the SCORM runtime calls it after rendering a question,
 * the web host from a layout effect on the shadow-mounted scene. Both write the two
 * font custom properties on the column, which the title / option cards bind to.
 */

/** Tuning for {@link fitQuestionScene}; all optional with design defaults. */
export interface FitQuestionOptions {
  /** Prompt font range (px). Default 32 / 16. */
  questionMax?: number;
  questionMin?: number;
  /** Option font range (px). Default 22 / 14. */
  answerMax?: number;
  answerMin?: number;
  /** Max share of the field height the header may occupy. Default 1/3. */
  headerFraction?: number;
  /** Floor the header may shrink to when yielding space to the options. Default 1/4. */
  headerFractionMin?: number;
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
  const qMin = options?.questionMin ?? 16;
  const aMax = options?.answerMax ?? 22;
  const aMin = options?.answerMin ?? 14;
  const fracMax = options?.headerFraction ?? 1 / 3;
  const fracMin = options?.headerFractionMin ?? 1 / 4;

  const fieldH = field.clientHeight;
  if (!(fieldH > 0)) return;
  const colTop = col.getBoundingClientRect().top;
  const headerH = (): number => headerEnd.getBoundingClientRect().bottom - colTop;
  const setQ = (px: number) => col.style.setProperty("--tb-question-fs", `${px}px`);
  const setA = (px: number) => col.style.setProperty("--tb-answer-fs", `${px}px`);

  // Phase 1 — prompt: largest font that keeps the header within its third (max share).
  let q = qMax;
  setQ(q);
  let guard = 0;
  while (q > qMin && headerH() > fieldH * fracMax && guard++ < 128) setQ(--q);

  // Phase 2 — options: largest answer font that fits them all without scrolling.
  let a = aMax;
  setA(a);
  guard = 0;
  while (a > aMin && overflows(field) && guard++ < 128) setA(--a);

  // Phase 3 — balance: if the options still overflow, let the prompt give up space, but
  // only from its third DOWN TO the min share (a quarter), never below — stop as soon as
  // the field fits or the header reaches that floor.
  guard = 0;
  while (q > qMin && overflows(field) && headerH() > fieldH * fracMin && guard++ < 128) setQ(--q);
}
