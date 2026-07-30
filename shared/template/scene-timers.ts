/**
 * @module shared/template/scene-timers
 *
 * The scene's countdown displays — ONE renderer for both hosts.
 *
 * Every flow layout ships two DS timers in the header (`#timer-display` for the
 * test limit, `#section-timer-display` for the section one), hidden behind
 * `q-timer--hidden`. The SCORM runtime reveals and paints them as the countdown
 * runs; the web host did not, and instead appended «· Время темы 9:51» to the
 * question counter — so the same test showed a DS timer chip in the package and a
 * grey run-on text on the web (PRD-12 parity defect, 2026-07-29).
 *
 * DOM-based but framework-free, exactly like `fit-question`: the package calls it
 * after mounting a screen, the web host from its render effect, and `root` is the
 * document in one case and the shadow tree in the other.
 */

/** Seconds left at which a display starts reading as critical. */
export const TIMER_WARN_AT = 60;

/** `M:SS` — the format both hosts print (negative time clamps to zero). */
export function formatTimerValue(seconds: number): string {
  const total = seconds > 0 ? seconds : 0;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

/** Countdown state of a screen; `null` = that countdown is not running. */
export interface SceneTimersState {
  /** Seconds left on the whole-test limit. */
  testSeconds?: number | null;
  /** Seconds left on the current section's limit. */
  sectionSeconds?: number | null;
}

/** Reveal + paint one timer element, or hide it when its countdown is off. */
function paintOne(el: Element | null, seconds: number | null | undefined): void {
  if (!el) return;
  if (seconds === null || seconds === undefined) {
    el.classList.add("q-timer--hidden");
    return;
  }
  el.classList.remove("q-timer--hidden");
  const num = el.querySelector(".ou-timer__num") ?? el;
  num.textContent = formatTimerValue(seconds);
  el.classList.toggle("is-critical", seconds <= TIMER_WARN_AT);
}

/**
 * Paints the header countdowns inside `root`.
 *
 * @param root  Scene root — the document (package) or the shadow tree (web).
 * @param state Which countdowns run and how much is left (see {@link SceneTimersState}).
 */
export function paintSceneTimers(
  root: ParentNode | null | undefined,
  state: SceneTimersState,
): void {
  if (!root) return;
  paintOne(root.querySelector("#timer-display"), state.testSeconds);
  paintOne(root.querySelector("#section-timer-display"), state.sectionSeconds);
}
