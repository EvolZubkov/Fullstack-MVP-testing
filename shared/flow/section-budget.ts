/**
 * @module shared/flow/section-budget
 *
 * Section (topic) time budget — ONE model for both hosts.
 *
 * Agreed rules (2026-07-29):
 *   1. The countdown runs ONLY while the learner is inside the section. Standing
 *      on the router hub, the обзор or the results screen costs nothing.
 *   2. Leaving the section FREEZES the remainder instead of resetting it. Coming
 *      back — including «Продолжить с места остановки» after closing the browser —
 *      resumes from what was left. This is what stops the obvious cheat: open a
 *      section, read the questions, close the tab, return prepared with the full
 *      limit again.
 *   3. When the remainder hits zero the section is spent: it locks, and no further
 *      entry gives it more time.
 *
 * The web host persists these budgets server-side/localStorage per attempt; the
 * SCORM package keeps them in `suspend_data`. Both call the functions here, so a
 * package and a web run answer «сколько осталось» identically.
 *
 * TIME UNIT: the host's ACTIVE time, not wall clock — the same basis the test-wide
 * timer already anchors to (`cmi.total_time` in the package, the attempt's active
 * time on the server for the web). That is what makes a reload, a closed tab or a
 * changed system clock irrelevant: only time the learner actually spent in the run
 * counts against the section.
 *
 * Pure: no DOM, no storage, no clock of its own — every function takes `activeMs`.
 */

/** One section's budget: what is left, and since when it is running. */
export interface SectionBudget {
  /** Milliseconds of the limit left as of the last pause. */
  remainingMs: number;
  /** ACTIVE-time reading when the current stay began, or null while paused. */
  runningSince: number | null;
}

/** Budgets by topic id. */
export type SectionBudgets = Record<string, SectionBudget>;

/** Milliseconds left at `activeMs` — a running budget keeps draining, a paused one does not. */
export function remainingMs(budget: SectionBudget | undefined, activeMs: number): number | null {
  if (!budget) return null;
  const spent = budget.runningSince === null ? 0 : Math.max(0, activeMs - budget.runningSince);
  return Math.max(0, budget.remainingMs - spent);
}

/** Whole seconds left for `topicId`, or null when it has no budget. */
export function remainingSeconds(
  budgets: SectionBudgets,
  topicId: string | null,
  activeMs: number,
): number | null {
  if (!topicId) return null;
  const ms = remainingMs(budgets[topicId], activeMs);
  return ms === null ? null : Math.ceil(ms / 1000);
}

/** True when the section has no time left. */
export function isSpent(budgets: SectionBudgets, topicId: string, activeMs: number): boolean {
  const ms = remainingMs(budgets[topicId], activeMs);
  return ms !== null && ms <= 0;
}

/** Topic ids whose budget is spent — the sections that lock. */
export function spentTopics(budgets: SectionBudgets, activeMs: number): string[] {
  return Object.keys(budgets).filter((id) => isSpent(budgets, id, activeMs));
}

/**
 * Enter `topicId`: resume its countdown (or open it at `limitMinutes` on the very
 * first entry) and pause every other section. Returns the SAME object when nothing
 * changes, so callers can skip a write.
 *
 * A section with no limit contributes no budget: it simply never appears here.
 */
export function enterSection(
  budgets: SectionBudgets,
  topicId: string,
  limitMinutes: number | null | undefined,
  activeMs: number,
): SectionBudgets {
  const next = pauseAll(budgets, activeMs);
  const current = next[topicId];
  if (current) {
    // Already open: resume it unless it is already running.
    if (current.runningSince !== null) return budgets === next ? budgets : next;
    return { ...next, [topicId]: { remainingMs: current.remainingMs, runningSince: activeMs } };
  }
  if (!limitMinutes || limitMinutes <= 0) return next;
  return { ...next, [topicId]: { remainingMs: limitMinutes * 60_000, runningSince: activeMs } };
}

/** Leave every section: freeze the remainders (nothing runs outside a section). */
export function pauseAll(budgets: SectionBudgets, activeMs: number): SectionBudgets {
  let changed = false;
  const next: SectionBudgets = {};
  for (const [id, b] of Object.entries(budgets)) {
    if (b.runningSince === null) {
      next[id] = b;
      continue;
    }
    next[id] = { remainingMs: remainingMs(b, activeMs) ?? 0, runningSince: null };
    changed = true;
  }
  return changed ? next : budgets;
}
