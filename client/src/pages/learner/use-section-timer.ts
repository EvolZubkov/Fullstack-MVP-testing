/**
 * @module client/pages/learner/use-section-timer
 *
 * Per-topic (section) time-limit timer for the web learner runtime.
 *
 * The remaining time is NOT owned here: the server keeps it on the attempt row and
 * this hook only reports where the learner is (`POST /attempts/:id/section-timer`)
 * and paints what comes back. That is deliberate — the remainder decides whether an
 * answer still counts, so a value the learner could edit (it used to live in
 * `localStorage`) was not a limit but a suggestion.
 *
 * The agreed rules are enforced server-side by the shared
 * {@link module:shared/flow/section-budget} model:
 *   - the countdown runs only while the learner is inside the section;
 *   - leaving it — hub, обзор, results, closed tab — freezes the remainder;
 *   - «Продолжить с места остановки» resumes from that remainder, so reading the
 *     questions and coming back later buys no fresh limit;
 *   - at zero the section is spent and locks.
 *
 * Between pings the countdown is interpolated locally so the display ticks every
 * second; the server's answer always wins.
 */
import { useEffect, useRef, useState } from "react";

/** Minimal shape the timer needs from a flattened question. */
export interface SectionTimerQuestion {
  topicId: string;
  /** Per-topic budget in minutes, or null when the topic has no custom limit. */
  sectionTimeLimitMinutes: number | null;
}

/** How often the host tells the server it is still inside the section. */
export const PING_INTERVAL_MS = 10_000;

/** One server answer. */
interface SectionTimerView {
  remainingSeconds: number | null;
  lockedTopics: string[];
}

/**
 * Report the learner's position to the server and read back the section state.
 * Network failures resolve to null — the display then keeps interpolating, and the
 * next successful ping re-syncs it.
 */
export async function pingSectionTimer(
  attemptId: string,
  topicId: string | null,
): Promise<SectionTimerView | null> {
  try {
    const res = await fetch(`/api/attempts/${attemptId}/section-timer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ topicId }),
    });
    if (!res.ok) return null;
    return (await res.json()) as SectionTimerView;
  } catch {
    return null;
  }
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
  const [sectionRemainingSeconds, setSectionRemainingSeconds] = useState<number | null>(null);
  const [lockedTopics, setLockedTopics] = useState<Set<string>>(new Set());
  // Topics whose expiry was already signalled, so onExpire fires at most once each.
  const signaledRef = useRef<Set<string>>(new Set());
  // Always call the freshest onExpire closure (parent reads live state/answers).
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  // Local interpolation between pings: the server's number and when we got it.
  const syncedRef = useRef<{ seconds: number | null; at: number }>({ seconds: null, at: 0 });

  const topicId = enabled ? (questions[currentIndex]?.topicId ?? null) : null;

  /** Absorb a server answer: it wins over whatever we were interpolating. */
  const absorb = (view: { remainingSeconds: number | null; lockedTopics: string[] } | null) => {
    if (!view) return;
    syncedRef.current = { seconds: view.remainingSeconds, at: Date.now() };
    setSectionRemainingSeconds(view.remainingSeconds);
    setLockedTopics((prev) => {
      const locked = new Set(view.lockedTopics);
      return sameSet(prev, locked) ? prev : locked;
    });
    if (
      topicId &&
      view.remainingSeconds !== null &&
      view.remainingSeconds <= 0 &&
      !signaledRef.current.has(topicId)
    ) {
      signaledRef.current.add(topicId);
      onExpireRef.current(topicId);
    }
  };

  // Tell the server where the learner is: on entering/leaving a section and every
  // PING_INTERVAL_MS while inside. Leaving (topicId null) is what freezes the
  // remainder, so it is reported too — including on unmount.
  useEffect(() => {
    if (!attemptId) return;
    let alive = true;
    const ping = async () => {
      const view = await pingSectionTimer(attemptId, topicId);
      if (alive) absorb(view);
    };
    void ping();
    const id = topicId ? setInterval(ping, PING_INTERVAL_MS) : null;
    return () => {
      alive = false;
      if (id) clearInterval(id);
      // Report the exit so the section stops being charged. Fire-and-forget: the
      // server also caps a silent client by its grace window.
      if (topicId) void pingSectionTimer(attemptId, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, topicId]);

  // Smooth display between pings — interpolated, never authoritative.
  useEffect(() => {
    if (!enabled || !topicId) {
      setSectionRemainingSeconds(null);
      return;
    }
    const id = setInterval(() => {
      const synced = syncedRef.current;
      if (synced.seconds === null) return;
      const elapsed = Math.floor((Date.now() - synced.at) / 1000);
      setSectionRemainingSeconds(Math.max(0, synced.seconds - elapsed));
    }, 1000);
    return () => clearInterval(id);
  }, [enabled, topicId]);

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
  const [sectionRemainingSeconds, setSectionRemainingSeconds] = useState<number | null>(null);
  const signaledRef = useRef<Set<string>>(new Set());
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const syncedRef = useRef<{ seconds: number | null; at: number }>({ seconds: null, at: 0 });

  const active = enabled ? topicId : null;

  // Same server-owned model as the standard flow (`limitMinutes` is resolved from
  // the test server-side, so it is not sent from here).
  useEffect(() => {
    if (!attemptId) return;
    let alive = true;
    const ping = async () => {
      const view = await pingSectionTimer(attemptId, active);
      if (!alive || !view) return;
      syncedRef.current = { seconds: view.remainingSeconds, at: Date.now() };
      setSectionRemainingSeconds(view.remainingSeconds);
      if (
        active &&
        view.remainingSeconds !== null &&
        view.remainingSeconds <= 0 &&
        !signaledRef.current.has(active)
      ) {
        signaledRef.current.add(active);
        onExpireRef.current(active);
      }
    };
    void ping();
    const id = active ? setInterval(ping, PING_INTERVAL_MS) : null;
    return () => {
      alive = false;
      if (id) clearInterval(id);
      if (active) void pingSectionTimer(attemptId, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, active]);

  // Smooth display between pings.
  useEffect(() => {
    if (!active) {
      setSectionRemainingSeconds(null);
      return;
    }
    const id = setInterval(() => {
      const synced = syncedRef.current;
      if (synced.seconds === null) return;
      const elapsed = Math.floor((Date.now() - synced.at) / 1000);
      setSectionRemainingSeconds(Math.max(0, synced.seconds - elapsed));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  return { sectionRemainingSeconds };
}
