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
  /** Prompt font range (px). Defaults to the width profile: 32/16 wide, 22/18 narrow. */
  questionMax?: number;
  questionMin?: number;
  /** Option font range (px). Defaults to the width profile: 22/14 wide, 17/15 narrow. */
  answerMax?: number;
  answerMin?: number;
  /** Max share of the field height the header may occupy. Default 1/3. */
  headerFraction?: number;
  /** Floor the header may shrink to when yielding space to the options. Default 1/4. */
  headerFractionMin?: number;
}

/**
 * Field width (px) at or below which the NARROW font profile applies — the phone
 * step. Must stay equal to the S3 container step in the standard template's
 * `styles/theme.css`: below it the stylesheet clamps the same two custom
 * properties, and a profile that disagreed with the clamp would spend its whole
 * search in a range CSS then discards. `tests/template-scene-mobile-css.test.ts`
 * asserts the two stay in step.
 */
export const NARROW_FIELD_PX = 520;

/**
 * Font ranges per profile. The narrow one is deliberately shallow: on a phone the
 * field is small enough that SOME scrolling is unavoidable, and shrinking a prompt
 * to 16px to avoid it trades the wrong thing. Mirrors the `clamp()` bounds in the
 * template's S3 block.
 */
const PROFILES = {
  wide: { qMax: 32, qMin: 16, aMax: 22, aMin: 14 },
  narrow: { qMax: 22, qMin: 18, aMax: 17, aMin: 15 },
} as const;

/**
 * How many answer options the phone layout guarantees on screen. Shrinking the type
 * cannot deliver this on its own: a several-hundred-word prompt still fills the field
 * once the font hits its floor, and the learner then sees a wall of text with no sign
 * that anything follows it — measured at 77% of the field, one option visible as a
 * 35px sliver.
 */
const KEEP_OPTIONS_VISIBLE = 3;

/**
 * Bounds for the prompt's share of the field when it has to be capped. The floor stops
 * a short option list from squeezing a long prompt into a keyhole; the ceiling is what
 * actually guarantees the options are reachable.
 */
const PROMPT_SHARE_MIN = 0.3;
const PROMPT_SHARE_MAX = 0.55;

/** Answer rows the cap measures against, in the order the renderers emit them. */
const OPTION_SELECTOR = ".ou-radio-card, .ou-rank__item, .ou-match__row, .ou-stepper__step";

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
  // Pick the profile from the FIELD width, so the search runs in the same range
  // the stylesheet will clamp to. Without this the loops walk 32 -> 16 and 22 -> 14
  // on a phone, forcing a reflow per step, only for `clamp()` to pull the result
  // back up — up to 24 wasted layout passes per render and per resize.
  const profile = field.clientWidth <= NARROW_FIELD_PX ? PROFILES.narrow : PROFILES.wide;
  const qMax = options?.questionMax ?? profile.qMax;
  const qMin = options?.questionMin ?? profile.qMin;
  const aMax = options?.answerMax ?? profile.aMax;
  const aMin = options?.answerMin ?? profile.aMin;
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

  // Phase 4 (narrow fields only) — cap the prompt BOX. Phases 1-3 have one lever, the
  // font size, and once it is at its floor a long prompt simply keeps the field. This
  // phase enforces what `headerFraction` always intended by height instead of by type:
  // the prompt gets its own scroll and the options stay on screen.
  if (profile === PROFILES.narrow) capPrompt(field, col, headerEnd, fieldH);
}

/**
 * Caps the prompt block so the first {@link KEEP_OPTIONS_VISIBLE} options remain within
 * the field, and hands the CSS two custom properties: the height limit and a fade mask
 * that signals the text continues. Both are cleared when no cap is needed, so a short
 * prompt is never given a scrollbar or a faded last line.
 *
 * @param field     the scrolling field (`.tb-scene__body`)
 * @param col       the column carrying the scene's custom properties
 * @param headerEnd the prompt block (`.tb-scene__q`) — the element being capped
 * @param fieldH    the field's visible height, already measured by the caller
 */
function capPrompt(field: HTMLElement, col: HTMLElement, headerEnd: HTMLElement, fieldH: number): void {
  const clear = () => {
    col.style.removeProperty("--tb-prompt-max-h");
    col.style.removeProperty("--tb-prompt-mask");
  };
  clear();

  const cards = Array.from(field.querySelectorAll<HTMLElement>(OPTION_SELECTOR));
  if (cards.length === 0) return;

  // What the guaranteed options occupy, gaps included: measuring the span from the first
  // row's top to the last kept row's bottom counts the real gaps without assuming them.
  const kept = cards.slice(0, KEEP_OPTIONS_VISIBLE);
  const first = kept[0].getBoundingClientRect();
  const last = kept[kept.length - 1].getBoundingClientRect();
  const optionsH = Math.max(first.height, last.bottom - first.top);

  // Everything ABOVE the prompt and between it and the options has to come out of the
  // budget too — the meta row (counter + section chip), the field's own padding and the
  // column gap. Deriving them from geometry rather than from the stylesheet keeps this
  // correct when a template changes its spacing: `promptTop` is the prompt's offset
  // inside the field, `gap` the space before the first option.
  const fieldRect = field.getBoundingClientRect();
  const promptRect = headerEnd.getBoundingClientRect();
  const promptTop = promptRect.top - fieldRect.top + field.scrollTop;
  const gap = Math.max(0, first.top - promptRect.bottom);

  const promptH = promptRect.height;
  const room = fieldH - promptTop - gap - optionsH;
  const cap = Math.round(Math.min(Math.max(room, fieldH * PROMPT_SHARE_MIN), fieldH * PROMPT_SHARE_MAX));

  // Only cap when it actually buys something — a prompt already shorter than the limit
  // must keep its natural height.
  if (!(promptH > cap + 1)) return;
  col.style.setProperty("--tb-prompt-max-h", `${cap}px`);
  col.style.setProperty(
    "--tb-prompt-mask",
    "linear-gradient(to bottom, #000 calc(100% - 28px), transparent 100%)",
  );
}
