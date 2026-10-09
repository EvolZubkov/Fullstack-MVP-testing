/**
 * @module shared/questions/question-time
 *
 * Time spent on each question, accumulated across visits — the same counter on BOTH hosts.
 *
 * The figure is the base material of item analysis: how long an item takes is what separates
 * an item people think about from one they click past without reading (PRD-66 FR-34, FR-35).
 * The LMS report also has a «Продолжительность (сек.)» column per interaction, which used to
 * be empty always because nothing measured anything.
 *
 * SUM, not last visit: with «возврат к неотвеченным» enabled a learner leaves a question and
 * comes back, and reporting only the last visit would claim two seconds for an item they
 * thought about for a minute.
 *
 * ONE implementation for the package and the web host (PRD-66 FR-37): a per-host copy would
 * drift, and two hosts measuring «time on question» differently make the two sources
 * incomparable — which is precisely what the psychometric layer puts side by side.
 *
 * SCOPE is one session of the run. The totals live in memory and are deliberately NOT written
 * into `cmi.suspend_data` — that budget is what PRD-36 spent a whole track reclaiming, and the
 * run state is read by packages already in the field. A learner who closes the SCO and resumes
 * therefore reports the time of the resumed session; the figure stays honest about what it
 * measured, and the alternative (an unbounded per-question map in a 64 KB budget) is the very
 * failure mode PRD-36 removed. The web host measures a session of the page for the same
 * reason: a reopened attempt keeps the answers, not the stopwatch.
 */

/** The counter's public surface — what both hosts call. */
export interface QuestionTime {
  /** The learner is now looking at this question. Re-showing the SAME one is a no-op. */
  show(id: string): void;
  /** The learner left the question screen (moved on, opened the обзор, finished). */
  leave(): void;
  /** Total milliseconds on this question, INCLUDING the visit still open. */
  totalMsFor(id: string): number;
  /** Everything measured so far, as «question id -> milliseconds»; open visit included. */
  totals(): Record<string, number>;
  /** Forget everything — a new attempt starts its own measurement. */
  reset(): void;
}

/**
 * A fresh counter.
 *
 * A FACTORY rather than a module-level singleton: the web host runs several attempts in one
 * page session, and a shared counter would carry one attempt's seconds into the next.
 *
 * @param now - Clock, injectable so the measurement can be tested without waiting.
 * @returns The counter.
 */
export function createQuestionTime(now: () => number = Date.now): QuestionTime {
  /** questionId -> accumulated milliseconds of CLOSED visits. */
  let closedTotals: Record<string, number> = {};
  /** The question currently on screen, or null. */
  let openId: string | null = null;
  /** When the open visit started. */
  let openAt = 0;

  /** Milliseconds since `openAt`, never negative — the learner's clock can jump back. */
  function openMs(): number {
    if (openId === null) return 0;
    const delta = now() - openAt;
    return delta > 0 ? delta : 0;
  }

  /** Close the open visit into its total. */
  function close(): void {
    if (openId === null) return;
    closedTotals[openId] = (closedTotals[openId] || 0) + openMs();
    openId = null;
    openAt = 0;
  }

  return {
    show(id: string): void {
      if (!id) return;
      // `render()` runs on every redraw (feedback shown, timer tick, theme switch), not only
      // on a move, so closing and reopening the same visit would be equivalent but pointless.
      if (openId === id) return;
      close();
      openId = id;
      openAt = now();
    },

    leave(): void {
      close();
    },

    totalMsFor(id: string): number {
      // The open visit counts: an attempt is often finished straight from the question, and
      // that last visit belongs in the report.
      const closed = closedTotals[id] || 0;
      return openId === id ? closed + openMs() : closed;
    },

    totals(): Record<string, number> {
      const all: Record<string, number> = { ...closedTotals };
      if (openId !== null) all[openId] = (all[openId] || 0) + openMs();
      return all;
    },

    reset(): void {
      closedTotals = {};
      openId = null;
      openAt = 0;
    },
  };
}
