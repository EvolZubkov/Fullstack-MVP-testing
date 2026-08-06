/**
 * @module server/storage/shared
 * @description Cross-cutting helpers shared by the domain repositories and the
 * `DatabaseStorage` facade (`server/storage.ts`). Kept free of table/domain
 * specifics so any repository can depend on it without introducing cross-domain
 * coupling — the one deliberate exception is {@link touchTopics}, whose whole
 * purpose is to be called from OUTSIDE the topic domain (the questions
 * repository), so it cannot live in either repository without creating the
 * coupling it is meant to avoid.
 */
import { inArray, sql } from "drizzle-orm";
import { topics } from "@shared/schema";
import type { db } from "../db";

/**
 * Copy ONLY the whitelisted keys that are actually present (`null` is a valid
 * value, `undefined` is skipped). Used by the `update*` methods so a broad
 * `Partial<Row>` cannot mass-assign columns the caller must not touch
 * (passwordHash, emailHash, ownership/audit fields, foreign keys, …).
 */
export function pickDefined<T, K extends keyof T>(src: Partial<T>, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) {
    const v = src[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Anything that can run a query: the module-level database handle OR an already
 * open transaction (drizzle gives both the same query-builder surface).
 */
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Refresh `topics.updated_at` for the given topics (PRD-25 FR-20).
 *
 * The column is the recency key the home-page section «Мои темы и вопросы»
 * orders by, and it must move on a change to the topic itself OR to any of its
 * questions. The executor is a PARAMETER rather than the imported `db` on
 * purpose: the caller has to be able to hand in its own open transaction so the
 * stamp is written in the SAME unit of work as the mutation that caused it. A
 * separate connection would let a rolled-back mutation leave a topic wrongly
 * marked as recently changed (and would race with the mutation's own locks).
 *
 * The stamp is `now()` — evaluated by the database, i.e. the caller's
 * transaction timestamp — so every row touched by one mutation gets the exact
 * same value regardless of client clock skew.
 *
 * @param executor The `db` handle or an open transaction to run the update on.
 * @param topicIds Topic ids to stamp; empty is a no-op, duplicates and nullish
 *   entries are collapsed (callers routinely pass "old and new topic of the
 *   question", which are usually the same id).
 */
export async function touchTopics(
  executor: DbExecutor,
  topicIds: readonly (string | null | undefined)[],
): Promise<void> {
  const ids = [...new Set(topicIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return;
  await executor.update(topics).set({ updatedAt: sql`now()` }).where(inArray(topics.id, ids));
}
