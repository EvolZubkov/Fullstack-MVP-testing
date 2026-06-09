/**
 * @module client/pages/learner/use-section-timer
 *
 * Per-topic (section) time-limit timer for the web learner runtime — the web
 * counterpart of the SCORM package's `startSectionTimer` (PRD-4 v1.1 §3.2).
 *
 * Agreed behaviour:
 *   - Each topic carrying a positive `sectionTimeLimitMinutes` gets a wall-clock
 *     deadline the FIRST time the learner enters it:
 *     `deadline = Date.now() + budgetMinutes * 60_000`.
 *   - The deadline is fixed and runs in real time. Navigation (back/forward)
 *     never pauses, resets or extends it — going back keeps the timer ticking.
 *   - When `Date.now() >= deadline` the topic is "locked": its questions become
 *     inaccessible (navigation skips it) and, if it is the topic currently being
 *     viewed, the caller force-advances to the next non-locked topic.
 *   - Because the deadline never pauses, a topic the learner leaves forward keeps
 *     counting down; by the time they navigate back it has usually expired and is
 *     locked. The budget is a fixed real-time window from first entry (anti-gaming).
 *
 * Network resilience: deadlines are persisted to `localStorage` (keyed by attempt
 * id), so ticking and expiry are fully client-side and survive reloads and
 * disconnects with no server round-trip. The test-level timer remains the
 * server-anchored bound on total time. Trade-off: clearing localStorage resets an
 * unexpired topic's window (lenient — never shortens it); a server-anchored
 * first-entry timestamp would close that gap at the cost of a network call.
 */
import { useEffect, useRef, useState } from "react";

/** Minimal shape the timer needs from a flattened question. */
export interface SectionTimerQuestion {
  topicId: string;
  /** Per-topic budget in minutes, or null when the topic has no custom limit. */
  sectionTimeLimitMinutes: number | null;
}

/** Map of topicId -> wall-clock deadline (epoch ms). */
export type DeadlineMap = Record<string, number>;

const STORAGE_PREFIX = "tb:section-deadlines:";

/** localStorage key holding the deadline map for a given attempt. */
export function storageKey(attemptId: string): string {
  return STORAGE_PREFIX + attemptId;
}

/** Read the persisted deadline map for an attempt; `{}` when absent/unreadable. */
export function loadDeadlines(attemptId: string): DeadlineMap {
  try {
    const raw = localStorage.getItem(storageKey(attemptId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as DeadlineMap;
  } catch {
    // Malformed JSON or storage unavailable (private mode / SSR) — start fresh.
  }
  return {};
}

/** Persist the deadline map; silently ignores storage errors (quota/private). */
export function saveDeadlines(attemptId: string, deadlines: DeadlineMap): void {
  try {
    localStorage.setItem(storageKey(attemptId), JSON.stringify(deadlines));
  } catch {
    // Storage unavailable — ticking still works from the in-memory map.
  }
}

/** Topic ids whose deadline is at or before `nowMs`. */
export function expiredTopics(deadlines: DeadlineMap, nowMs: number): Set<string> {
  const out = new Set<string>();
  for (const [topicId, deadline] of Object.entries(deadlines)) {
    if (nowMs >= deadline) out.add(topicId);
  }
  return out;
}

/** Remaining whole seconds for `topicId`, or null when it has no deadline. */
export function remainingSecondsFor(
  topicId: string | null,
  deadlines: DeadlineMap,
  nowMs: number,
): number | null {
  if (!topicId) return null;
  const deadline = deadlines[topicId];
  if (typeof deadline !== "number") return null;
  return Math.max(0, Math.ceil((deadline - nowMs) / 1000));
}

/** First index `>= from` whose topic is not locked, or null if none. */
export function nextAccessibleIndex(
  questions: SectionTimerQuestion[],
  from: number,
  locked: Set<string>,
): number | null {
  for (let i = Math.max(0, from); i < questions.length; i++) {
    if (!locked.has(questions[i].topicId)) return i;
  }
  return null;
}

/** Last index `<= from` whose topic is not locked, or null if none. */
export function prevAccessibleIndex(
  questions: SectionTimerQuestion[],
  from: number,
  locked: Set<string>,
): number | null {
  for (let i = Math.min(questions.length - 1, from); i >= 0; i--) {
    if (!locked.has(questions[i].topicId)) return i;
  }
  return null;
}

/** First index at/after `from` whose topic differs from `topicId`. */
export function firstIndexAfterTopic(
  questions: SectionTimerQuestion[],
  topicId: string,
  from: number,
): number {
  let i = Math.max(0, from);
  while (i < questions.length && questions[i].topicId === topicId) i++;
  return i;
}

/**
 * Where to land after `expiredTopicId` times out: the first non-locked index
 * past that topic's block, or null when nothing accessible remains (→ finish).
 */
export function forceAdvanceTarget(
  questions: SectionTimerQuestion[],
  expiredTopicId: string,
  fromIndex: number,
  locked: Set<string>,
): number | null {
  const after = firstIndexAfterTopic(questions, expiredTopicId, fromIndex);
  return nextAccessibleIndex(questions, after, locked);
}

/** Structural equality for two string sets (avoids needless re-renders). */
function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export interface UseSectionTimerArgs {
  /** Attempt id; deadlines are namespaced by it. Null disables persistence. */
  attemptId: string | null;
  /** Flattened questions in display order. */
  questions: SectionTimerQuestion[];
  /** Index of the question currently shown. */
  currentIndex: number;
  /** When false the timer is idle (no ticking, no expiry). */
  enabled: boolean;
  /** Called once per topic when the viewed topic expires; caller advances. */
  onExpire: (expiredTopicId: string) => void;
}

export interface UseSectionTimerResult {
  /** Remaining seconds for the current topic, or null when it has no limit. */
  sectionRemainingSeconds: number | null;
  /** Topics whose deadline has passed (read-only / skipped in navigation). */
  lockedTopics: Set<string>;
}

/**
 * Drive a per-topic wall-clock countdown for the standard learner flow.
 * See the module doc for the timing/locking contract.
 */
export function useSectionTimer({
  attemptId,
  questions,
  currentIndex,
  enabled,
  onExpire,
}: UseSectionTimerArgs): UseSectionTimerResult {
  const deadlinesRef = useRef<DeadlineMap>({});
  const [sectionRemainingSeconds, setSectionRemainingSeconds] = useState<number | null>(null);
  const [lockedTopics, setLockedTopics] = useState<Set<string>>(new Set());
  // Topics whose expiry was already signalled, so onExpire fires at most once each.
  const signaledRef = useRef<Set<string>>(new Set());
  // Always call the freshest onExpire closure (parent reads live state/answers).
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  // Hydrate persisted deadlines when the attempt becomes known (handles resume).
  useEffect(() => {
    if (!attemptId) return;
    deadlinesRef.current = loadDeadlines(attemptId);
    setLockedTopics(expiredTopics(deadlinesRef.current, Date.now()));
  }, [attemptId]);

  // Set the current topic's deadline on first entry (any direction).
  useEffect(() => {
    if (!enabled || !attemptId) return;
    const q = questions[currentIndex];
    if (!q || !q.sectionTimeLimitMinutes || q.sectionTimeLimitMinutes <= 0) return;
    if (deadlinesRef.current[q.topicId] != null) return;
    deadlinesRef.current = {
      ...deadlinesRef.current,
      [q.topicId]: Date.now() + q.sectionTimeLimitMinutes * 60_000,
    };
    saveDeadlines(attemptId, deadlinesRef.current);
  }, [enabled, attemptId, questions, currentIndex]);

  // Wall-clock tick: refresh remaining/locked and fire expiry for the viewed topic.
  useEffect(() => {
    if (!enabled) {
      setSectionRemainingSeconds(null);
      return;
    }
    const tick = () => {
      const now = Date.now();
      const deadlines = deadlinesRef.current;
      const locked = expiredTopics(deadlines, now);
      setLockedTopics((prev) => (sameSet(prev, locked) ? prev : locked));

      const currentTopicId = questions[currentIndex]?.topicId ?? null;
      setSectionRemainingSeconds(remainingSecondsFor(currentTopicId, deadlines, now));

      if (
        currentTopicId &&
        locked.has(currentTopicId) &&
        !signaledRef.current.has(currentTopicId)
      ) {
        signaledRef.current.add(currentTopicId);
        onExpireRef.current(currentTopicId);
      }
    };
    tick(); // run immediately so resume/expiry reflects without a 1s delay
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [enabled, questions, currentIndex]);

  return { sectionRemainingSeconds, lockedTopics };
}

export interface UseAdaptiveSectionTimerArgs {
  attemptId: string | null;
  /** Current adaptive topic id (server-driven), or null between transitions. */
  topicId: string | null;
  /** Current topic's budget in minutes, or null when it has no limit. */
  limitMinutes: number | null;
  /** When false the timer is idle (finished / not in the question phase). */
  enabled: boolean;
  /** Fired once per topic when its budget runs out; caller asks the server to advance. */
  onExpire: (topicId: string) => void;
}

/**
 * Adaptive-flow variant of {@link useSectionTimer}: the adaptive runtime shows
 * one server-chosen topic at a time (forward-only, no back navigation), so this
 * tracks a single active topic's wall-clock deadline. Same persistence and
 * never-pause contract as the standard hook; expiry asks the server to force the
 * topic transition rather than jumping a local index.
 */
export function useAdaptiveSectionTimer({
  attemptId,
  topicId,
  limitMinutes,
  enabled,
  onExpire,
}: UseAdaptiveSectionTimerArgs): { sectionRemainingSeconds: number | null } {
  const deadlinesRef = useRef<DeadlineMap>({});
  const [sectionRemainingSeconds, setSectionRemainingSeconds] = useState<number | null>(null);
  const signaledRef = useRef<Set<string>>(new Set());
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!attemptId) return;
    deadlinesRef.current = loadDeadlines(attemptId);
  }, [attemptId]);

  // Set the active topic's deadline on first entry.
  useEffect(() => {
    if (!enabled || !attemptId || !topicId || !limitMinutes || limitMinutes <= 0) return;
    if (deadlinesRef.current[topicId] != null) return;
    deadlinesRef.current = {
      ...deadlinesRef.current,
      [topicId]: Date.now() + limitMinutes * 60_000,
    };
    saveDeadlines(attemptId, deadlinesRef.current);
  }, [enabled, attemptId, topicId, limitMinutes]);

  // Wall-clock tick for the active topic.
  useEffect(() => {
    if (!enabled || !topicId) {
      setSectionRemainingSeconds(null);
      return;
    }
    const tick = () => {
      const now = Date.now();
      setSectionRemainingSeconds(remainingSecondsFor(topicId, deadlinesRef.current, now));
      const deadline = deadlinesRef.current[topicId];
      if (typeof deadline === "number" && now >= deadline && !signaledRef.current.has(topicId)) {
        signaledRef.current.add(topicId);
        onExpireRef.current(topicId);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [enabled, topicId]);

  return { sectionRemainingSeconds };
}
