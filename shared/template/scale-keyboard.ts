/**
 * @module shared/template/scale-keyboard
 *
 * Keyboard navigation for the PRD-26 scale interaction, shared by both hosts so the
 * web run and the SCORM package answer the same keys (the web wires it in
 * {@link module:client/components/template-screen}, the package in
 * `app/actions/answers.js`).
 *
 * The scale is a radio group, so it follows the native radio convention: an arrow key
 * both MOVES and SELECTS, and the group is a single tab stop. Both axes are accepted
 * regardless of layout — left/up step towards the first graduation, right/down towards
 * the last — so the horizontal and the vertical (narrow screen, many graduations)
 * layouts need no separate handling.
 *
 * Pure and framework-free — no DOM — safe to bundle into the SCORM runtime.
 */

/** Keys that move along the scale, mapped to their step. */
const STEP_KEYS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1,
};

/**
 * Target graduation for a key press, or `null` when the key is not a scale key or the
 * move would run past an end (so the host leaves the event alone and does not
 * needlessly re-emit the current answer).
 *
 * @param key - `KeyboardEvent.key`.
 * @param current - Currently selected graduation, or `null` when unanswered.
 * @param count - Number of graduations.
 */
export function nextScaleIndex(key: string, current: number | null, count: number): number | null {
  if (count <= 0) return null;

  if (key === "Home") return current === 0 ? null : 0;
  if (key === "End") return current === count - 1 ? null : count - 1;

  const step = STEP_KEYS[key];
  if (step === undefined) return null;

  // Unanswered: the first key press enters the scale at the end the key points to,
  // rather than silently doing nothing.
  if (current === null) return step < 0 ? count - 1 : 0;

  const target = current + step;
  return target < 0 || target >= count ? null : target;
}
