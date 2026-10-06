/**
 * @module shared/sim/replay
 *
 * Re-derive a run result from its protocol.
 *
 * On the web the player runs in the participant's browser and posts its result. A posted
 * `"outcome": "success"` costs one request to forge, while every other question type is graded
 * against a key the browser never sees. So the server does not trust the posted outcome: it
 * replays the protocol (`events`) through the same engine on the stored scenario and grades the
 * result THAT produces. A forged outcome without a protocol leading to it grades as nothing.
 *
 * What the protocol records is enough to replay: actions and refusals by id, misses by
 * coordinates, committed values, exit and timeout. Entering scenes, hints and goals are not
 * inputs — the engine derives them itself. Time is taken from the protocol, so durations and
 * trap times are reproduced.
 *
 * Pure and framework-free.
 */
import { createRun } from "./engine";
import type { Scenario, SimEvent, SimResult } from "./contract";

/** What a replay produced. */
export interface ReplayVerdict {
  /** The result the engine derived from the protocol — the one to grade. */
  result: SimResult;
  /**
   * The protocol replayed cleanly and leads to what was posted (same outcome and counts). `false`
   * means the posted result is not what its own protocol produces: tampered or from another
   * scenario.
   */
  consistent: boolean;
}

/**
 * Replay a posted run against the stored scenario.
 *
 * @param scenario The scenario of the question, as stored.
 * @param posted The result the browser posted (anything — it is not trusted).
 */
export function replayRun(scenario: Scenario, posted: unknown): ReplayVerdict {
  let clock = 0;
  const run = createRun(scenario, { now: () => clock });
  const claimed = posted as Partial<SimResult> | null;
  const events: SimEvent[] = Array.isArray(claimed?.events) ? (claimed!.events as SimEvent[]) : [];
  let consistent = true;

  for (const event of events) {
    if (!event || typeof event !== "object" || typeof (event as { t?: unknown }).t !== "number") {
      consistent = false;
      break;
    }
    if (run.done()) {
      // After the end only what the engine itself derives may follow (entering the goal
      // scene, the goal); an INPUT after the end was never possible.
      if (event.type === "enter" || event.type === "goal" || event.type === "hint") continue;
      consistent = false;
      break;
    }
    clock = Math.max(clock, event.t);
    switch (event.type) {
      case "action":
      case "blocked": {
        const reaction = run.trigger(event.id);
        const expected = event.type === "blocked" ? "blocked" : null;
        if (!reaction || (expected === "blocked") !== (reaction.kind === "blocked")) consistent = false;
        break;
      }
      case "miss":
        run.missAt(event.x, event.y);
        break;
      case "value":
        if (run.commitField(event.field, String(event.value)).kind === "none") consistent = false;
        break;
      case "exit":
        run.exit();
        break;
      case "timeout":
        run.timeout();
        break;
      // Derived by the engine itself, or with no bearing on the grade.
      case "enter":
      case "hint":
      case "goal":
      case "copy":
        break;
      default:
        consistent = false;
    }
    if (!consistent) break;
  }

  // A run the protocol leaves unfinished ended without a goal: the participant left.
  if (!run.done()) run.exit();
  const result = run.result();
  if (consistent && claimed) {
    const sameCounts = JSON.stringify(result.counts) === JSON.stringify(claimed.counts ?? null);
    consistent = result.outcome === claimed.outcome && sameCounts;
  }
  // The start time is the one fact a protocol cannot carry; keep the posted one when present.
  if (typeof claimed?.startedAt === "string") result.startedAt = claimed.startedAt;
  return { result, consistent };
}
