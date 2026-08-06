/**
 * @module client/src/lib/magic-scope
 * @description A one-way flag raised when the server refuses a request with
 * `403 MAGIC_SCOPE`. Routing already keeps a magic-link session inside its test,
 * so this is the safety net for the case where the client and the server-side rule
 * table disagree: the flag flips once and routing sends the learner to the login
 * form instead of failing silently. Cleared only by a full page load (or by tests).
 */

type Listener = () => void;

let violated = false;
const listeners = new Set<Listener>();

/** Whether a scope violation has been observed in this page session. */
export function isScopeViolation(): boolean {
  return violated;
}

/** Raise the flag; subscribers are notified once, on the transition. */
export function raiseScopeViolation(): void {
  if (violated) return;
  violated = true;
  for (const listener of listeners) listener();
}

/** Subscribe to the transition; returns the unsubscribe function. */
export function subscribeScopeViolation(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset. Production code never lowers the flag. */
export function resetScopeViolation(): void {
  violated = false;
  listeners.clear();
}
