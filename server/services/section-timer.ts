/**
 * @module server/services/section-timer
 *
 * Server-side arbiter of the per-section time budget (PRD-4 §3.2, agreed
 * 2026-07-29).
 *
 * The rules live in the SHARED {@link module:shared/flow/section-budget} module —
 * the countdown runs only inside the section, leaving freezes the remainder,
 * returning resumes from it. What this module adds is WHERE the remainder is kept
 * and WHOSE clock decides: the attempt row and the server's clock.
 *
 * That is the whole point of moving it off `localStorage`: the remaining time
 * decides whether an answer still counts, so the learner must not be able to edit
 * it, and «closed the tab, came back tomorrow» must not buy a fresh limit.
 *
 * Active time, not wall clock: each ping reports that the learner is (still) in a
 * section. Between two pings we credit the elapsed time, but never more than
 * {@link GRACE_MS} — so a closed tab costs at most that grace, not the hours until
 * the learner returns. It is the server-side twin of the package's
 * `cmi.total_time` anchor.
 *
 * PRD-67 «Закрывать раздел при выходе»: the freeze above still let a learner read a
 * question, close the tab, look the answer up and come back. With the test setting on,
 * leaving a started section CLOSES it. A leave is recognised by the SESSION changing,
 * not by a timeout: the page mints a `runId` per load and sends it with every ping, and
 * a ping carrying a different `runId` while a section is open means the page was
 * reloaded, closed and reopened, or opened a second time. A timeout remains only for
 * the one case the session cannot see — the SAME page going silent (a laptop asleep):
 * a gap up to {@link CLOSE_GAP_MS} is charged in full, a longer one closes the section.
 */

import { storage } from "../storage";
import {
  enterSection,
  leaveSection,
  lockedSections,
  openSection,
  readGate,
  remainingSeconds,
  isClosed,
  WHOLE_TEST_SECTION,
  type SectionBudgets,
  type SectionGate,
} from "@shared/flow/section-budget";

/**
 * How much time a silent client may still be credited with. The learner pings
 * every ~10s; a gap longer than this means they were not in the section (tab
 * closed, network down), so only the grace is charged and the budget freezes.
 */
export const GRACE_MS = 30_000;

/**
 * PRD-67: under the close-on-leave setting, how long the SAME page may stay silent
 * before the open section counts as left. Shorter gaps are a network hiccup and are
 * charged IN FULL; a longer one (a laptop asleep, a long outage) closes the section.
 */
export const CLOSE_GAP_MS = 120_000;

/** What the attempt row stores under `sectionTimerJson`. */
export interface SectionTimerState {
  /** Per-topic budgets (see the shared module). */
  budgets: SectionBudgets;
  /** Server time of the last ping — the base for crediting the next interval. */
  lastSeenAt: number;
  /** Monotonic active-time counter this attempt has accrued, in ms. */
  activeMs: number;
  /** PRD-67: identity of the page run that pinged last; null before the first ping. */
  runId: string | null;
  /** PRD-67: the section the learner is in and the sections closed by a leave. */
  gate: SectionGate;
}

/** One ping's answer: what the host paints and what it must lock. */
export interface SectionTimerView {
  /** Seconds left in the section the learner is in, or null (no limit / outside). */
  remainingSeconds: number | null;
  /** Topics whose budget is spent or that were closed — their questions are read-only. */
  lockedTopics: string[];
  /**
   * PRD-67: sections closed by a leave (a subset of `lockedTopics`, which also holds the
   * ones whose time ran out). The host tells the learner why the section is shut. Holds
   * {@link WHOLE_TEST_SECTION} when a test without sections was left — the attempt is over.
   */
  closedTopics: string[];
}

/**
 * PRD-67: how the setting applies to this attempt. `closesOnLeave(unit)` says whether
 * leaving `unit` closes it; `unitOf(topicId)` maps a topic to the unit a leave closes —
 * the topic itself, or {@link WHOLE_TEST_SECTION} for a test without sections.
 */
export interface LeavePolicy {
  closesOnLeave: (unit: string) => boolean;
  unitOf: (topicId: string) => string;
}

/** The pre-PRD-67 policy: nothing ever closes, every topic is its own unit. */
export const FREEZE_ONLY: LeavePolicy = {
  closesOnLeave: () => false,
  unitOf: (topicId) => topicId,
};

const EMPTY: SectionTimerState = {
  budgets: {},
  lastSeenAt: 0,
  activeMs: 0,
  runId: null,
  gate: { open: null, closed: [] },
};

/** Read the stored state of an attempt, tolerating legacy/NULL rows. */
export function readState(raw: unknown): SectionTimerState {
  const s = raw as Partial<SectionTimerState> | null;
  if (!s || typeof s !== "object") return { ...EMPTY, gate: { open: null, closed: [] } };
  return {
    budgets: (s.budgets && typeof s.budgets === "object" ? s.budgets : {}) as SectionBudgets,
    lastSeenAt: typeof s.lastSeenAt === "number" ? s.lastSeenAt : 0,
    activeMs: typeof s.activeMs === "number" ? s.activeMs : 0,
    runId: typeof s.runId === "string" ? s.runId : null,
    gate: readGate(s.gate),
  };
}

/**
 * Advance the attempt's active-time counter to `now`, crediting at most `capMs` for
 * the gap since the last ping ({@link GRACE_MS} unless the caller says otherwise).
 */
export function advance(state: SectionTimerState, now: number, capMs: number = GRACE_MS): SectionTimerState {
  if (!state.lastSeenAt) return { ...state, lastSeenAt: now };
  const elapsed = Math.max(0, now - state.lastSeenAt);
  return {
    ...state,
    activeMs: state.activeMs + Math.min(elapsed, capMs),
    lastSeenAt: now,
  };
}

/** Close the open unit when the policy says leaving it closes it; otherwise freeze. */
function leave(state: SectionTimerState, policy: LeavePolicy): SectionTimerState {
  const open = state.gate.open;
  const closeOpen = open !== null && policy.closesOnLeave(open);
  const left = leaveSection(state.gate, state.budgets, state.activeMs, closeOpen);
  return { ...state, gate: left.gate, budgets: left.budgets };
}

/**
 * Apply one ping: the learner is in `topicId` (or nowhere when null) at `now`.
 * Pure — the caller persists the returned state.
 *
 * @param state    Stored state of the attempt.
 * @param topicId  Section the learner is in, or null when outside every section.
 * @param limitMinutes Limit of that section (ignored when it already has a budget).
 * @param now      Server time in ms.
 * @param runId    PRD-67: identity of the pinging page run; null from an old client.
 * @param policy   PRD-67: whether leaving a unit closes it ({@link FREEZE_ONLY} by default).
 */
export function applyPing(
  state: SectionTimerState,
  topicId: string | null,
  limitMinutes: number | null,
  now: number,
  runId: string | null = null,
  policy: LeavePolicy = FREEZE_ONLY,
): { state: SectionTimerState; view: SectionTimerView } {
  let next = state;
  const openUnit = next.gate.open;
  const guarded = openUnit !== null && policy.closesOnLeave(openUnit);

  // PRD-67: a different page run while a guarded unit is open — the page was reloaded,
  // reopened or opened twice. That run broke off inside the unit: close it BEFORE crediting
  // anything, so the silent stretch between the two runs is never charged as presence.
  if (guarded && runId && next.runId && runId !== next.runId) {
    next = leave({ ...next, lastSeenAt: now }, policy);
  } else if (guarded && next.lastSeenAt && now - next.lastSeenAt > CLOSE_GAP_MS) {
    // The same page went silent for longer than a network hiccup (a laptop asleep).
    next = leave(advance(next, now), policy);
  } else {
    // Under the setting a short gap is charged in full; without it the old grace cap holds.
    next = advance(next, now, guarded ? CLOSE_GAP_MS : GRACE_MS);
  }
  if (runId) next = { ...next, runId };

  const unit = topicId ? policy.unitOf(topicId) : null;
  if (next.gate.open !== null && next.gate.open !== unit) next = leave(next, policy);

  if (topicId && unit && !isClosed(next.gate, unit)) {
    next = {
      ...next,
      budgets: enterSection(next.budgets, topicId, limitMinutes, next.activeMs),
      gate: openSection(next.gate, unit),
    };
  } else if (!topicId) {
    next = { ...next, budgets: leaveSection(next.gate, next.budgets, next.activeMs, false).budgets };
  }

  const closedNow = unit !== null && isClosed(next.gate, unit);
  return {
    state: next,
    view: {
      // A closed unit reports zero, so every host's existing «time ran out» path moves the
      // learner past it — the same way a spent budget does.
      remainingSeconds: closedNow ? 0 : remainingSeconds(next.budgets, topicId, next.activeMs),
      lockedTopics: lockedSections(next.gate, next.budgets, next.activeMs),
      closedTopics: [...next.gate.closed],
    },
  };
}

/**
 * Build the attempt's leave policy from the test (PRD-67). The setting acts on a unit
 * that has a clock to dodge: its own section limit or the test-wide one.
 *
 * @param closeSectionOnLeave The test setting.
 * @param testLimitMinutes    The test-wide limit, if any.
 * @param sectionLimits       Own limit per topic id.
 * @param flat                True for a test without sections (`linear_flat`).
 */
export function buildLeavePolicy(opts: {
  closeSectionOnLeave: boolean;
  testLimitMinutes: number | null | undefined;
  sectionLimits: Map<string, number | null | undefined>;
  flat: boolean;
}): LeavePolicy {
  if (!opts.closeSectionOnLeave) return FREEZE_ONLY;
  const testLimited = (opts.testLimitMinutes ?? 0) > 0;
  return {
    unitOf: (topicId) => (opts.flat ? WHOLE_TEST_SECTION : topicId),
    closesOnLeave: (unit) => {
      if (unit === WHOLE_TEST_SECTION) {
        return testLimited || [...opts.sectionLimits.values()].some((m) => (m ?? 0) > 0);
      }
      return testLimited || (opts.sectionLimits.get(unit) ?? 0) > 0;
    },
  };
}

/**
 * Ping for a live attempt: loads, applies and stores the state.
 *
 * @param attemptId    The attempt being played.
 * @param topicId      Section the learner is in, or null when outside.
 * @param limitMinutes That section's limit in minutes (null = no limit).
 * @param runId        PRD-67: identity of the pinging page run.
 * @param policy       PRD-67: the attempt's leave policy.
 * @returns The view for the host, or null when the attempt is gone/finished.
 */
export async function pingSection(
  attemptId: string,
  topicId: string | null,
  limitMinutes: number | null,
  runId: string | null = null,
  policy: LeavePolicy = FREEZE_ONLY,
): Promise<SectionTimerView | null> {
  const attempt = await storage.getAttempt(attemptId);
  if (!attempt || attempt.finishedAt) return null;
  const { state, view } = applyPing(
    readState(attempt.sectionTimerJson),
    topicId,
    limitMinutes,
    Date.now(),
    runId,
    policy,
  );
  await storage.updateAttempt(attemptId, { sectionTimerJson: state });
  return view;
}

/**
 * FR-10 (PRD-67): the answers of a locked section are FROZEN at what the server already
 * holds. The lock used to be advisory — the server computed it, handed it to the client,
 * and then accepted whatever answers the next request carried. A section whose time ran
 * out or that was closed by a leave keeps the answers stored before the lock.
 *
 * @param incoming  Answers from the request body, keyed by question id.
 * @param stored    Answers already on the attempt row.
 * @param sections  The delivered variant: which questions belong to which topic.
 * @param timerJson The attempt's `sectionTimerJson`.
 * @returns The answers to store / grade.
 */
export function freezeLockedAnswers<T = unknown>(
  incoming: Record<string, T> | null | undefined,
  stored: Record<string, T> | null | undefined,
  sections: ReadonlyArray<{ topicId: string; questionIds?: readonly string[] }>,
  timerJson: unknown,
): Record<string, T> {
  const out: Record<string, T> = { ...(incoming ?? {}) };
  const state = readState(timerJson);
  const locked = new Set(lockedSections(state.gate, state.budgets, state.activeMs));
  if (locked.size === 0) return out;
  const wholeTest = locked.has(WHOLE_TEST_SECTION);
  const before = stored ?? {};
  for (const section of sections) {
    if (!wholeTest && !locked.has(section.topicId)) continue;
    for (const qid of section.questionIds ?? []) {
      if (Object.prototype.hasOwnProperty.call(before, qid)) out[qid] = before[qid];
      else delete out[qid];
    }
  }
  return out;
}
