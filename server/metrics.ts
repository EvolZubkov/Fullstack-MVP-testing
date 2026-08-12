/**
 * @module server/metrics
 * @description Minimal, dependency-free in-process counter registry. It exists so
 * operational signals (e.g. `auth.legacy_bcrypt_rehash`, PRD-9) can be incremented
 * from anywhere and read back by an operator without pulling in a full metrics
 * stack. Counters are process-local and reset on restart — they track rates/trends,
 * not durable state. Values are non-negative integers keyed by a dotted name.
 */

const counters = new Map<string, number>();

/**
 * Increment a named counter, creating it at zero on first use.
 * @param name - Dotted counter name, e.g. `auth.legacy_bcrypt_rehash`.
 * @param by - Amount to add (defaults to 1).
 * @returns The new counter value.
 */
export function incrementCounter(name: string, by = 1): number {
  const next = (counters.get(name) ?? 0) + by;
  counters.set(name, next);
  return next;
}

/**
 * Read the current value of a named counter.
 * @param name - The counter name.
 * @returns The counter value, or 0 when the counter has never been incremented.
 */
export function getCounter(name: string): number {
  return counters.get(name) ?? 0;
}

/**
 * Snapshot all counters as a plain object, for operator-facing readouts.
 * @returns A copy of every counter keyed by name.
 */
export function getCounters(): Record<string, number> {
  return Object.fromEntries(counters);
}
