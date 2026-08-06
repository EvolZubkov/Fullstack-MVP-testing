/**
 * @module shared/template/results-nav
 *
 * Footer STATE of the results screen — data, not markup.
 *
 * The row itself belongs to `results.html`, like every other piece of the design.
 * Until now the package REPLACED that footer at runtime (`wireFinishResultsFooter`
 * overwrote `innerHTML` with «Скачать отчёт» + «Пройти заново» + «Далее»), while
 * the web host rendered the layout as written — one button. Same test, same
 * template, different offers.
 *
 * Both hosts now resolve this state and let the layout draw it.
 */

/** Actions the results footer carries; each host binds them to its own handler. */
export const RESULTS_NAV_ACTIONS = {
  /** Export the attempt report (the template's `report` variant). */
  report: "download-report",
  /** Start the test over. */
  retry: "restart",
  /** Walk on to the post-test content pages. */
  next: "results-next",
  /** Close the run (LMS) / leave the results screen (web). */
  finish: "results-finish",
  /**
   * Leave the results for the test list — the ADAPTIVE layout's exit, since its
   * footer carries no closing action (the standard one ends with `primaryAction`).
   * WEB ONLY: a package has nowhere to go back to, so the layout gates the button on
   * `result.showBack`, which only the web host sets (the same split as the start
   * screen's `showBack`). It lives in the scene footer because the alternative — a
   * row of host chrome under the scene — is a second footer on one screen, and
   * outside the shadow root it gets neither the scene surface nor the DS palette.
   */
  back: "results-back",
} as const;

/** Run state the footer is built from — resolved by the host. */
export interface ResultsNavState {
  /** The template offers a report variant AND the host can produce it. */
  canReport: boolean;
  /** The attempt failed and attempts remain. */
  canRetry: boolean;
  /** Content pages follow the results screen («После теста»). */
  hasPostPages: boolean;
  /** Caption of the closing action when nothing follows. Host wording. */
  finishLabel?: string;
}

/** What the layout binds against (`result.nav`). */
export interface ResultsNav {
  showReport: boolean;
  canRetry: boolean;
  primaryAction: string;
  primaryLabel: string;
}

/**
 * Resolve the results footer state.
 *
 * @param state See {@link ResultsNavState}.
 * @returns The `result.nav` block the results layout renders from.
 */
export function buildResultsNav(state: ResultsNavState): ResultsNav {
  const A = RESULTS_NAV_ACTIONS;
  return {
    showReport: !!state.canReport,
    canRetry: !!state.canRetry,
    ...(state.hasPostPages
      ? { primaryAction: A.next, primaryLabel: "Далее" }
      : { primaryAction: A.finish, primaryLabel: state.finishLabel || "Завершить" }),
  };
}
