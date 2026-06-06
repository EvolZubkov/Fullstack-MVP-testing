/**
 * @module shared/template/dnd/matching-model
 *
 * Framework-free state model for the matching question interaction (PRD-12 DnD
 * unification). It is the single authoritative source of matching drag/drop
 * semantics, shared by both runtime hosts: imported directly by the web host and
 * compiled into the SCORM package via {@link module:shared/template/runtime-entry}
 * (exposed on the `TBTemplate` global), replacing the hand-written plain-JS model
 * that used to live in the SCORM runtime (`app/dnd/matching.js`).
 *
 * The model is the RICH variant (the agreed reconciliation: the SCORM behaviour
 * wins, the web host adopts it). It keeps an explicit, ORDERED pool of unmatched
 * left items, so a chip returned to the pool lands at a specific slot and a
 * displaced chip goes back to its original slot — behaviour the previous derived
 * web pool could not express.
 *
 * Every function is pure: it takes a {@link MatchingState} and returns a NEW one,
 * never mutating its input. No DOM, no globals, no framework — so it is a
 * unit-testable value transform and safe to bundle for the browser.
 */

/**
 * Matching interaction state for a single question.
 *
 * - `pairs` maps a left item index to the right item index it is matched with
 *   (this IS the stored answer).
 * - `pool` is the ordered list of left item indices that are not yet matched;
 *   its order is meaningful (it is the on-screen order of the unmatched chips).
 */
export interface MatchingState {
  pairs: Record<number, number>;
  pool: number[];
}

/**
 * Describes the chip being dragged.
 *
 * - `leftIdx` — the left item index carried by the chip.
 * - `from` — where the drag started: `"pool"` (an unmatched chip) or `"match"`
 *   (a chip already paired with a right item).
 * - `poolIndex` — when `from === "pool"`, the chip's index within the pool, used
 *   to remove it precisely and to restore a displaced chip to that same slot.
 */
export interface MatchingDragPayload {
  leftIdx: number;
  from: "pool" | "match";
  poolIndex?: number;
}

/** Shallow-clones the pairs map with numeric keys. */
function clonePairs(pairs: Record<number, number>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const k of Object.keys(pairs || {})) {
    const li = parseInt(k, 10);
    if (!Number.isNaN(li)) out[li] = pairs[k as unknown as number];
  }
  return out;
}

/** Deletes a left index from the pairs map (tolerates string/number keys). */
function removeLeft(pairs: Record<number, number>, leftIdx: number): void {
  delete pairs[leftIdx];
  delete pairs[String(leftIdx) as unknown as number];
}

/**
 * Returns the left index currently matched to `rightIdx`, or `null` when the
 * right slot is empty.
 */
function leftForRight(pairs: Record<number, number>, rightIdx: number): number | null {
  for (const k of Object.keys(pairs || {})) {
    if (pairs[k as unknown as number] === rightIdx) {
      const li = parseInt(k, 10);
      return Number.isNaN(li) ? null : li;
    }
  }
  return null;
}

/**
 * Removes `leftIdx` from `pool`. When `poolIndex` is supplied and matches, the
 * removal is precise; otherwise it falls back to the first occurrence. Returns
 * the index the item was removed from, or `-1` when it was not present.
 */
function removeFromPool(pool: number[], leftIdx: number, poolIndex?: number): number {
  if (
    typeof poolIndex === "number" &&
    poolIndex >= 0 &&
    poolIndex < pool.length &&
    pool[poolIndex] === leftIdx
  ) {
    pool.splice(poolIndex, 1);
    return poolIndex;
  }
  const idx = pool.indexOf(leftIdx);
  if (idx >= 0) {
    pool.splice(idx, 1);
    return idx;
  }
  return -1;
}

/** Inserts `leftIdx` into `pool` at `index` (clamped to the valid range). */
function insertIntoPool(pool: number[], leftIdx: number, index?: number): void {
  let i = typeof index === "number" ? index : pool.length;
  if (i < 0) i = 0;
  if (i > pool.length) i = pool.length;
  pool.splice(i, 0, leftIdx);
}

/**
 * Reconciles a pool against the current answer and the question's left mapping:
 * drops any left index that is now matched, and appends (in `leftMapping` order)
 * any unmatched index that is missing. Use this to initialise or repair the pool
 * before rendering.
 *
 * @param pool        Current ordered pool (may be empty on first render).
 * @param pairs       Current answer (left -> right).
 * @param leftMapping The question's left item indices, in display order.
 * @returns A new ordered pool of unmatched left indices.
 */
export function normalizePool(
  pool: number[],
  pairs: Record<number, number>,
  leftMapping: number[],
): number[] {
  const used: Record<number, boolean> = {};
  for (const k of Object.keys(pairs || {})) {
    const li = parseInt(k, 10);
    if (!Number.isNaN(li)) used[li] = true;
  }
  const next: number[] = [];
  for (let i = 0; i < pool.length; i++) {
    if (!used[pool[i]]) next.push(pool[i]);
  }
  for (let j = 0; j < leftMapping.length; j++) {
    const li = leftMapping[j];
    if (used[li]) continue;
    if (next.indexOf(li) === -1) next.push(li);
  }
  return next;
}

/**
 * Drops the dragged chip onto a right slot. Detaches the chip from its source
 * (pool or an existing match), displaces whatever currently occupies the target
 * right slot back into the pool (to the dragged chip's original pool slot when it
 * came from the pool, otherwise to the end), then records the new match and
 * de-dupes any stale mapping to the same right slot.
 *
 * @param state       Current matching state.
 * @param payload     The dragged chip.
 * @param targetRight The right item index of the drop target.
 * @returns A new {@link MatchingState}.
 */
export function dropOnRight(
  state: MatchingState,
  payload: MatchingDragPayload,
  targetRight: number,
): MatchingState {
  const pairs = clonePairs(state.pairs);
  const pool = (state.pool || []).slice();
  const { leftIdx, from, poolIndex } = payload;

  if (from === "pool") removeFromPool(pool, leftIdx, poolIndex);
  else removeLeft(pairs, leftIdx);

  const oldLeft = leftForRight(pairs, targetRight);
  if (oldLeft !== null) {
    removeLeft(pairs, oldLeft);
    if (from === "pool" && typeof poolIndex === "number") {
      insertIntoPool(pool, oldLeft, poolIndex);
    } else {
      insertIntoPool(pool, oldLeft, pool.length);
    }
  }

  pairs[leftIdx] = targetRight;
  for (const k of Object.keys(pairs)) {
    const li = parseInt(k, 10);
    if (li !== leftIdx && pairs[k as unknown as number] === targetRight) {
      delete pairs[k as unknown as number];
    }
  }

  return { pairs, pool };
}

/**
 * Drops the dragged chip into a specific pool slot. When the chip came from the
 * pool, the target slot is shifted to compensate for the chip's own removal so it
 * lands where the user aimed. When it came from a match, the pairing is cleared.
 *
 * @param state      Current matching state.
 * @param payload    The dragged chip.
 * @param targetSlot The pool slot index to insert at.
 * @returns A new {@link MatchingState}.
 */
export function dropOnPoolSlot(
  state: MatchingState,
  payload: MatchingDragPayload,
  targetSlot: number,
): MatchingState {
  const pairs = clonePairs(state.pairs);
  const pool = (state.pool || []).slice();
  const { leftIdx, from, poolIndex } = payload;

  let slot = targetSlot;
  if (from === "pool") {
    const removedAt = removeFromPool(pool, leftIdx, poolIndex);
    if (removedAt >= 0 && removedAt < slot) slot = slot - 1;
  } else {
    removeLeft(pairs, leftIdx);
  }

  insertIntoPool(pool, leftIdx, slot);
  return { pairs, pool };
}

/**
 * Returns a matched chip to the end of the pool (the dblclick / pull-away gesture).
 * No-op semantics are preserved for an already-pooled index: it is removed from
 * pairs (if present) and appended once.
 *
 * @param state   Current matching state.
 * @param leftIdx The left item index to release.
 * @returns A new {@link MatchingState}.
 */
export function returnToPool(state: MatchingState, leftIdx: number): MatchingState {
  const pairs = clonePairs(state.pairs);
  const pool = (state.pool || []).slice();
  removeLeft(pairs, leftIdx);
  if (pool.indexOf(leftIdx) === -1) insertIntoPool(pool, leftIdx, pool.length);
  return { pairs, pool };
}
