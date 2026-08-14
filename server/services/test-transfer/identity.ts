/**
 * @module server/services/test-transfer/identity
 *
 * Which identifier an imported row gets on THIS installation.
 *
 * The rule is: keep the source identifier. It is then its own evidence of origin — a repeat
 * import of the same package recognises the rows it created last time and updates them,
 * with no provenance column and no guessing by text. (Matching by content was measured and
 * rejected: `content_hash` is present on 990 of 1334 questions in dev and yields only 812
 * distinct values, so it would both pair unrelated questions and split identical ones.)
 *
 * A fresh identifier is issued ONLY where the source one is genuinely occupied by something
 * else. That is vanishingly rare for UUIDs and is always reported, because a silently
 * renumbered row is a row the NEXT import will duplicate instead of update.
 *
 * Pure: the set of occupied identifiers is collected by the caller in one query per table,
 * never one lookup per row.
 */
import { randomUUID } from "node:crypto";

/** What happened to one source identifier. */
export interface IdentityDecision {
  id: string;
  /** True when the source id was taken and a new one had to be issued. */
  remapped: boolean;
}

export interface IdentityOptions {
  /** Identifiers already occupied on this installation by OTHER entities. */
  taken: Set<string>;
  /** Identifier factory; injected so tests can predict the result. */
  newId?: () => string;
}

/**
 * Returns a resolver for source identifiers.
 *
 * The resolver is stable — asked twice about the same source id it answers identically —
 * and it reserves what it hands out, so two collisions in one import cannot receive the
 * same fresh identifier even from a generator that repeats itself.
 */
export function makeIdentityResolver(opts: IdentityOptions): (sourceId: string) => IdentityDecision {
  const newId = opts.newId ?? randomUUID;
  const taken = new Set(opts.taken);
  const decided = new Map<string, IdentityDecision>();

  return (sourceId: string): IdentityDecision => {
    const already = decided.get(sourceId);
    if (already) return already;

    let decision: IdentityDecision;
    if (!taken.has(sourceId)) {
      decision = { id: sourceId, remapped: false };
    } else {
      let candidate = newId();
      while (taken.has(candidate)) candidate = newId();
      decision = { id: candidate, remapped: true };
    }

    taken.add(decision.id);
    decided.set(sourceId, decision);
    return decision;
  };
}

/**
 * Builds the substitution map for a whole package.
 *
 * Only COLLIDING identifiers appear in it. An identifier that stays as it is must be absent:
 * the substitution walk in `plan.ts` replaces any string it finds in the map, and mapping an
 * id onto itself would be pointless work on every string of the package.
 */
export function buildIdMap(sourceIds: string[], opts: IdentityOptions): Map<string, string> {
  const resolve = makeIdentityResolver(opts);
  const map = new Map<string, string>();
  for (const sourceId of sourceIds) {
    const decision = resolve(sourceId);
    if (decision.remapped) map.set(sourceId, decision.id);
  }
  return map;
}
