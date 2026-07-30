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
 */

import { storage } from "../storage";
import {
  enterSection,
  pauseAll,
  remainingSeconds,
  spentTopics,
  type SectionBudgets,
} from "@shared/flow/section-budget";

/**
 * How much time a silent client may still be credited with. The learner pings
 * every ~10s; a gap longer than this means they were not in the section (tab
 * closed, network down), so only the grace is charged and the budget freezes.
 */
export const GRACE_MS = 30_000;

/** What the attempt row stores under `sectionTimerJson`. */
export interface SectionTimerState {
  /** Per-topic budgets (see the shared module). */
  budgets: SectionBudgets;
  /** Server time of the last ping — the base for crediting the next interval. */
  lastSeenAt: number;
  /** Monotonic active-time counter this attempt has accrued, in ms. */
  activeMs: number;
}

/** One ping's answer: what the host paints and what it must lock. */
export interface SectionTimerView {
  /** Seconds left in the section the learner is in, or null (no limit / outside). */
  remainingSeconds: number | null;
  /** Topics whose budget is spent — their questions are read-only. */
  lockedTopics: string[];
}

const EMPTY: SectionTimerState = { budgets: {}, lastSeenAt: 0, activeMs: 0 };

/** Read the stored state of an attempt, tolerating legacy/NULL rows. */
export function readState(raw: unknown): SectionTimerState {
  const s = raw as Partial<SectionTimerState> | null;
  if (!s || typeof s !== "object") return { ...EMPTY };
  return {
    budgets: (s.budgets && typeof s.budgets === "object" ? s.budgets : {}) as SectionBudgets,
    lastSeenAt: typeof s.lastSeenAt === "number" ? s.lastSeenAt : 0,
    activeMs: typeof s.activeMs === "number" ? s.activeMs : 0,
  };
}

/**
 * Advance the attempt's active-time counter to `now`, crediting at most
 * {@link GRACE_MS} for the gap since the last ping.
 */
export function advance(state: SectionTimerState, now: number): SectionTimerState {
  if (!state.lastSeenAt) return { ...state, lastSeenAt: now };
  const elapsed = Math.max(0, now - state.lastSeenAt);
  return {
    ...state,
    activeMs: state.activeMs + Math.min(elapsed, GRACE_MS),
    lastSeenAt: now,
  };
}

/**
 * Apply one ping: the learner is in `topicId` (or nowhere when null) at `now`.
 * Pure — the caller persists the returned state.
 *
 * @param state    Stored state of the attempt.
 * @param topicId  Section the learner is in, or null when outside every section.
 * @param limitMinutes Limit of that section (ignored when it already has a budget).
 * @param now      Server time in ms.
 */
export function applyPing(
  state: SectionTimerState,
  topicId: string | null,
  limitMinutes: number | null,
  now: number,
): { state: SectionTimerState; view: SectionTimerView } {
  const advanced = advance(state, now);
  const budgets = topicId
    ? enterSection(advanced.budgets, topicId, limitMinutes, advanced.activeMs)
    : pauseAll(advanced.budgets, advanced.activeMs);
  const next: SectionTimerState = { ...advanced, budgets };
  return {
    state: next,
    view: {
      remainingSeconds: remainingSeconds(budgets, topicId, advanced.activeMs),
      lockedTopics: spentTopics(budgets, advanced.activeMs),
    },
  };
}

/**
 * Ping for a live attempt: loads, applies and stores the state.
 *
 * @param attemptId    The attempt being played.
 * @param topicId      Section the learner is in, or null when outside.
 * @param limitMinutes That section's limit in minutes (null = no limit).
 * @returns The view for the host, or null when the attempt is gone/finished.
 */
export async function pingSection(
  attemptId: string,
  topicId: string | null,
  limitMinutes: number | null,
): Promise<SectionTimerView | null> {
  const attempt = await storage.getAttempt(attemptId);
  if (!attempt || attempt.finishedAt) return null;
  const { state, view } = applyPing(
    readState(attempt.sectionTimerJson),
    topicId,
    limitMinutes,
    Date.now(),
  );
  await storage.updateAttempt(attemptId, { sectionTimerJson: state });
  return view;
}
