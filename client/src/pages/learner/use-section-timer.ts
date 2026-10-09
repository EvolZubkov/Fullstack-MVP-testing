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
 *
 * PRD-67 «Закрывать раздел при выходе»: every ping carries the identity of THIS page run
 * (`runId`, minted once per mount). The server treats a ping from a different run while
 * a section is open as the learner having left it — a reload, a closed and reopened
 * browser, a second tab — and, when the test says so, closes the section for good. The
 * sections closed that way come back in `closedTopics` so the host can say why.
 */
import { useEffect, useRef, useState } from "react";
import { WHOLE_TEST_SECTION } from "@shared/flow/section-budget";

/**
 * Why a section stopped taking answers: its time ran out, it was closed by a leave
 * (PRD-67), or — in a test without sections — the whole test was closed by a leave.
 */
export type SectionStopReason = "time" | "closed" | "test-closed";

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
  /** PRD-67: sections closed by a leave (absent from a pre-PRD-67 server). */
  closedTopics?: string[];
}

/**
 * PRD-67: a fresh identity for one page run. `crypto.randomUUID` where the browser has
 * it (secure contexts), a random string otherwise — it only has to differ between runs.
 */
export function newRunId(): string {
  const c = typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Report the learner's position to the server and read back the section state.
 * Network failures resolve to null — the display then keeps interpolating, and the
 * next successful ping re-syncs it.
 *
 * @param runId PRD-67: identity of this page run; omitted by callers that predate it.
 */
export async function pingSectionTimer(
  attemptId: string,
  topicId: string | null,
  runId?: string,
): Promise<SectionTimerView | null> {
  try {
    const res = await fetch(`/api/attempts/${attemptId}/section-timer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(runId ? { topicId, runId } : { topicId }),
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
  /**
   * Called once per topic when the viewed topic stops taking answers; caller advances.
   * `reason` (PRD-67) tells a spent budget from a section closed by a leave.
   */
  onExpire: (expiredTopicId: string, reason: SectionStopReason) => void;
}

export interface UseSectionTimerResult {
  /** Remaining seconds for the current topic, or null when it has no limit. */
  sectionRemainingSeconds: number | null;
  /** Topics whose deadline has passed (read-only / skipped in navigation). */
  lockedTopics: Set<string>;
  /**
   * PRD-67: sections closed by a leave — a subset of `lockedTopics`. Holds
   * `WHOLE_TEST_SECTION` once a test without sections was left: the attempt is over.
   */
  closedTopics: Set<string>;
  /**
   * PRD-67: true once the server has answered for this page run. Before that the host
   * cannot know whether the section it shows was closed while the learner was away.
   */
  synced: boolean;
  /**
   * The topic `sectionRemainingSeconds` was last answered FOR by the server. A host that must read
   * the remainder once and keep it — the scenario player takes its limit at mount — waits until it
   * names the topic on screen; before that the number is unknown or belongs to the previous one.
   */
  syncedTopicId: string | null;
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
  const [closedTopics, setClosedTopics] = useState<Set<string>>(new Set());
  const [synced, setSynced] = useState(false);
  const [syncedTopicId, setSyncedTopicId] = useState<string | null>(null);
  // PRD-67: one identity per page run — the initializer runs once per mount, so a reload
  // (a new mount) is the ONLY thing that changes it.
  const [runId] = useState(newRunId);
  // Topics whose expiry was already signalled, so onExpire fires at most once each.
  const signaledRef = useRef<Set<string>>(new Set());
  // Always call the freshest onExpire closure (parent reads live state/answers).
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  // Local interpolation between pings: the server's number and when we got it.
  const syncedRef = useRef<{ seconds: number | null; at: number }>({ seconds: null, at: 0 });

  const topicId = enabled ? (questions[currentIndex]?.topicId ?? null) : null;

  /** Absorb a server answer: it wins over whatever we were interpolating. */
  const absorb = (view: SectionTimerView | null) => {
    if (!view) return;
    syncedRef.current = { seconds: view.remainingSeconds, at: Date.now() };
    setSectionRemainingSeconds(view.remainingSeconds);
    setLockedTopics((prev) => {
      const locked = new Set(view.lockedTopics);
      return sameSet(prev, locked) ? prev : locked;
    });
    const closedList = view.closedTopics ?? [];
    setClosedTopics((prev) => {
      const closed = new Set(closedList);
      return sameSet(prev, closed) ? prev : closed;
    });
    setSynced(true);
    setSyncedTopicId(topicId);
    if (
      topicId &&
      view.remainingSeconds !== null &&
      view.remainingSeconds <= 0 &&
      !signaledRef.current.has(topicId)
    ) {
      signaledRef.current.add(topicId);
      // The reason is read from THIS answer, not from state: the state update above lands
      // on the next render, after the caller has already acted.
      const reason: SectionStopReason = closedList.includes(WHOLE_TEST_SECTION)
        ? "test-closed"
        : closedList.includes(topicId)
          ? "closed"
          : "time";
      onExpireRef.current(topicId, reason);
    }
  };

  // Tell the server where the learner is: on entering/leaving a section and every
  // PING_INTERVAL_MS while inside. Leaving (topicId null) is what freezes the
  // remainder, so it is reported too — including on unmount.
  useEffect(() => {
    if (!attemptId) return;
    let alive = true;
    const ping = async () => {
      const view = await pingSectionTimer(attemptId, topicId, runId);
      if (alive) absorb(view);
    };
    void ping();
    const id = topicId ? setInterval(ping, PING_INTERVAL_MS) : null;
    return () => {
      alive = false;
      if (id) clearInterval(id);
      // Report the exit so the section stops being charged. Fire-and-forget: the
      // server also caps a silent client by its grace window.
      if (topicId) void pingSectionTimer(attemptId, null, runId);
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

  return { sectionRemainingSeconds, lockedTopics, closedTopics, synced, syncedTopicId };
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
  // PRD-67: same per-run identity as the standard hook — a closed topic comes back with
  // zero seconds, and the existing expiry path asks the server to move on.
  const [runId] = useState(newRunId);

  const active = enabled ? topicId : null;

  // Same server-owned model as the standard flow (`limitMinutes` is resolved from
  // the test server-side, so it is not sent from here).
  useEffect(() => {
    if (!attemptId) return;
    let alive = true;
    const ping = async () => {
      const view = await pingSectionTimer(attemptId, active, runId);
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
      if (active) void pingSectionTimer(attemptId, null, runId);
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
