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

/**
 * Finds a free variant of a topic name for an owner who already uses it.
 *
 * `(owner_id, name_normalized)` is unique, so an importer who owns «Лидерство» cannot receive
 * a second one. Renaming keeps the import whole and is reported; joining the existing topic
 * silently would attach the incoming questions to content the author did not choose, which is
 * the more expensive mistake to discover later.
 *
 * One rule in one place: the import plan SHOWS the name it is about to create, and the writer
 * CREATES it — a second, drifting rule would make the plan lie.
 *
 * @param name - the wanted name.
 * @param taken - normalized names already used by the owner.
 * @returns `name` itself when it is free, otherwise the first free «name (импорт N)».
 */
export function freeTopicName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(normalizeTopicName(name))) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (импорт ${n})`;
    if (!taken.has(normalizeTopicName(candidate))) return candidate;
  }
}
