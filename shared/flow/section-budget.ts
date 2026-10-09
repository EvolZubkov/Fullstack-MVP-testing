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
 * PRD-67 «Закрывать раздел при выходе»: the pause in rule 2 is exactly what makes the
 * cheat above POSSIBLE in a milder form — read a question, close the tab, look the answer
 * up while the clock stands still, come back. With the test setting on, leaving a started
 * section CLOSES it instead of freezing it: its budget drops to zero and it joins the
 * closed list for good. A test without sections is one implicit section
 * ({@link WHOLE_TEST_SECTION}); closing it means the attempt is over. The gate state
 * ({@link SectionGate}) lives next to the budgets on both hosts.
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

// ─── PRD-67: open / closed sections ──────────────────────────────────────────

/**
 * Key of the single implicit section of a test WITHOUT sections (`linear_flat`). Closing
 * it closes the attempt. Chosen so it cannot collide with a topic id (UUIDs).
 */
export const WHOLE_TEST_SECTION = "__test__";

/**
 * Which section the learner is in and which ones are closed for good. `open` is the
 * started, not-yet-left section: for a section with its own limit it mirrors the running
 * budget, for one under the TEST limit it is the only trace of «the learner was inside».
 */
export interface SectionGate {
  /** Section the learner is inside right now, or null. */
  open: string | null;
  /** Sections the learner left while the setting was on — never re-entered. */
  closed: string[];
}

/** Gate of a run that has not entered anything yet. */
export const EMPTY_GATE: SectionGate = Object.freeze({ open: null, closed: [] }) as SectionGate;

/** Read a stored gate, tolerating legacy/absent/garbled values (absent = nothing closed). */
export function readGate(raw: unknown): SectionGate {
  const g = raw as Partial<SectionGate> | null | undefined;
  if (!g || typeof g !== "object") return { open: null, closed: [] };
  return {
    open: typeof g.open === "string" ? g.open : null,
    closed: Array.isArray(g.closed) ? g.closed.filter((id): id is string => typeof id === "string") : [],
  };
}

/** True when `sectionId` was closed by a leave. */
export function isClosed(gate: SectionGate, sectionId: string): boolean {
  return gate.closed.includes(sectionId);
}

/**
 * Does the PRD-67 setting act on this section? Only where a clock could be dodged: a
 * section with its own limit, or any section while the whole test has one.
 */
export function closesOnLeave(opts: {
  /** The test setting `closeSectionOnLeave`. */
  enabled: boolean;
  /** The test-wide limit in minutes, if any. */
  testLimitMinutes: number | null | undefined;
  /** This section's own limit in minutes, if any. */
  sectionLimitMinutes: number | null | undefined;
}): boolean {
  if (!opts.enabled) return false;
  return (opts.testLimitMinutes ?? 0) > 0 || (opts.sectionLimitMinutes ?? 0) > 0;
}

/**
 * Does the setting act on ANY part of this test? True when it is on and some limit exists
 * — the test-wide one or a section's own. What the start screen tells the learner.
 */
export function testClosesOnLeave(opts: {
  enabled: boolean;
  testLimitMinutes: number | null | undefined;
  sectionLimitMinutes: ReadonlyArray<number | null | undefined>;
}): boolean {
  if (!opts.enabled) return false;
  if ((opts.testLimitMinutes ?? 0) > 0) return true;
  return opts.sectionLimitMinutes.some((m) => (m ?? 0) > 0);
}

/**
 * Mark `sectionId` as the section the learner is in. A closed section is never reopened —
 * the gate comes back unchanged. Returns the SAME object when nothing changes.
 */
export function openSection(gate: SectionGate, sectionId: string): SectionGate {
  if (gate.open === sectionId || isClosed(gate, sectionId)) return gate;
  return { open: sectionId, closed: gate.closed };
}

/**
 * Close `sectionId` for good: it joins the closed list, stops being open, and its budget
 * (when it has one) drops to zero — from here on every host treats it exactly like a
 * section whose limit ran out.
 */
export function closeSection(
  gate: SectionGate,
  budgets: SectionBudgets,
  sectionId: string,
): { gate: SectionGate; budgets: SectionBudgets } {
  const nextGate: SectionGate = {
    open: gate.open === sectionId ? null : gate.open,
    closed: isClosed(gate, sectionId) ? gate.closed : [...gate.closed, sectionId],
  };
  const nextBudgets = budgets[sectionId]
    ? { ...budgets, [sectionId]: { remainingMs: 0, runningSince: null } }
    : budgets;
  return { gate: nextGate, budgets: nextBudgets };
}

/**
 * The learner left the open section (or the run broke off inside it). With the setting
 * on for that section it is CLOSED; otherwise it is merely paused, the pre-PRD-67 rule.
 * Every running budget is frozen either way — nothing runs outside a section.
 *
 * @param closeOpen Whether the open section falls under the setting ({@link closesOnLeave}).
 */
export function leaveSection(
  gate: SectionGate,
  budgets: SectionBudgets,
  activeMs: number,
  closeOpen: boolean,
): { gate: SectionGate; budgets: SectionBudgets; closed: string | null } {
  const paused = pauseAll(budgets, activeMs);
  if (!gate.open) return { gate, budgets: paused, closed: null };
  if (!closeOpen) return { gate: { open: null, closed: gate.closed }, budgets: paused, closed: null };
  const id = gate.open;
  const done = closeSection(gate, paused, id);
  return { ...done, closed: id };
}

/** Sections a host must keep locked: spent by time or closed by a leave. */
export function lockedSections(gate: SectionGate, budgets: SectionBudgets, activeMs: number): string[] {
  const out = spentTopics(budgets, activeMs);
  for (const id of gate.closed) if (!out.includes(id)) out.push(id);
  return out;
}
