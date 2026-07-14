/**
 * @module shared/topics/naming
 *
 * Topic-name normalization for the PRD-15 FR-27 same-name policy. Both hosts use
 * it: the server enforces per-owner uniqueness and emits the cross-owner
 * warning, the client surfaces the warning live as the author types.
 * Normalization folds case, collapses whitespace and treats `ё` as `е`, so
 * "Финансы ", "финансы" and "Финансы" all collide.
 */

/**
 * Normalize a topic name for same-name comparison (FR-27): trim, collapse inner
 * whitespace to a single space, lowercase, and fold `ё` -> `е`.
 *
 * @param name - the raw topic name.
 * @returns the normalized comparison key.
 */
export function normalizeTopicName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/ё/g, "е");
}
