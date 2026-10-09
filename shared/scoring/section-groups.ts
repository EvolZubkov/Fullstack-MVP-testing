/**
 * @module shared/scoring/section-groups
 * @description PRD-50 §7 (FR-11, FR-12, FR-24 - FR-27): the ONE rule that turns the test's
 * declared groups plus each section's `group_key` into printable groups with the counter
 * «пройдено N из M».
 *
 * It is pure and framework-free, like the rest of `shared/scoring`, and deliberately does
 * NOT import `shared/schema`: the same code travels into the SCORM package through the
 * `shared-runtime` bundle, where drizzle and zod cannot follow (the very reason
 * `shared/breakdown/types` restates its shapes as plain interfaces).
 *
 * TWO callers, ONE implementation, on purpose:
 *   - {@link module:shared/scoring/aggregate} stamps the counters onto the aggregated
 *     result, so they are computed once per attempt and can be stored with it;
 *   - {@link module:shared/template/result-context} groups the topic CARDS for the render
 *     context on both hosts.
 * A second copy of «what counts as passed and what counts at all» is exactly the drift
 * that would show up as the screen and the stored result disagreeing about one number.
 *
 * The verdict is READ, never recomputed: since PRD-50 Э2 a section's verdict is decided in
 * the SECOND pass of `aggregateStandardResult` (FR-16), after the breakdown records exist,
 * because a key threshold can fail a section that met its own rule. Anything that derived
 * the counter from the percent and the rule would count such a section as passed.
 */

/** One declared group of the test (`tests.section_groups_json`, FR-11). */
export interface SectionGroup {
  key: string;
  label: string;
  /** Author order; absent = the element's position in the list. */
  order?: number;
}

/** What {@link groupSections} needs to know about a section — verdict and membership. */
export interface GroupableSection {
  /** `test_sections.group_key`; absent/null/unknown = no group (FR-12, FR-25). */
  groupKey?: string | null;
  /** The section's verdict as the core PRONOUNCED it. `null` = no verdict (FR-26). */
  passed: boolean | null;
}

/** One group ready to print: its sections in delivery order plus the two counts. */
export interface GroupedSections<T> {
  key: string;
  label: string;
  sections: T[];
  /** Sections of this group with a PASSED verdict. */
  passedCount: number;
  /** Sections of this group with ANY pronounced verdict — the denominator (FR-26). */
  totalCount: number;
}

/**
 * Read the stored group list into a clean, ordered array.
 *
 * `unknown` in and not `SectionGroup[]`: the value arrives from a jsonb column, from a
 * frozen publication snapshot and from `TEST_DATA` baked into a package built by an older
 * release, so this is the boundary where its shape is actually established. A malformed
 * entry is dropped rather than thrown on — a broken group must not cost the learner the
 * whole results screen.
 *
 * Duplicate keys keep the FIRST occurrence: the sections referencing that key have to land
 * somewhere, and the first declaration is the one the author sees at the top of the list.
 * (The editor cannot create a duplicate — `sectionGroupsSchema` rejects it — so this only
 * ever meets hand-written or imported data.)
 */
export function normalizeSectionGroups(raw: unknown): SectionGroup[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Array<{ group: SectionGroup; sortKey: number; position: number }> = [];
  raw.forEach((entry, position) => {
    if (!entry || typeof entry !== "object") return;
    const g = entry as { key?: unknown; label?: unknown; order?: unknown };
    const key = typeof g.key === "string" ? g.key.trim() : "";
    if (!key || seen.has(key)) return;
    seen.add(key);
    const order = typeof g.order === "number" && Number.isFinite(g.order) ? g.order : undefined;
    out.push({
      group: { key, label: typeof g.label === "string" ? g.label.trim() : "", ...(order === undefined ? {} : { order }) },
      // No `order` = the position in the list, which is what «упорядоченный список» means
      // for data written by an importer that never filled the number in.
      sortKey: order === undefined ? position : order,
      position,
    });
  });
  // Stable: equal orders keep their declared sequence.
  out.sort((a, b) => a.sortKey - b.sortKey || a.position - b.position);
  return out.map((o) => o.group);
}

/**
 * Split sections into the test's groups, counting verdicts per group.
 *
 * Rules, all of them from §7 of the spec:
 * - a group nobody references is dropped — an empty group does not print (FR-12);
 * - a `groupKey` no group declares means «no group», so deleting a group never hides a
 *   section (FR-12);
 * - sections without a group come back separately, in their own order, for the layout to
 *   print AFTER all groups (FR-25);
 * - `passedCount` counts `passed === true`, `totalCount` counts every PRONOUNCED verdict —
 *   a section with `passed === null` is in neither (FR-26);
 * - no declared groups at all gives an empty `groups` and every section in `ungrouped`,
 *   i.e. today's flat list (FR-27).
 */
export function groupSections<T extends GroupableSection>(
  groups: unknown,
  sections: readonly T[],
): { groups: Array<GroupedSections<T>>; ungrouped: T[] } {
  const declared = normalizeSectionGroups(groups);
  const ungrouped: T[] = [];
  if (declared.length === 0) return { groups: [], ungrouped: sections.slice() };

  const buckets = new Map<string, GroupedSections<T>>();
  for (const g of declared) {
    buckets.set(g.key, { key: g.key, label: g.label, sections: [], passedCount: 0, totalCount: 0 });
  }
  for (const section of sections) {
    const bucket = section.groupKey ? buckets.get(section.groupKey) : undefined;
    if (!bucket) {
      ungrouped.push(section);
      continue;
    }
    bucket.sections.push(section);
    if (section.passed !== null && section.passed !== undefined) {
      bucket.totalCount++;
      if (section.passed === true) bucket.passedCount++;
    }
  }
  return { groups: declared.map((g) => buckets.get(g.key)!).filter((b) => b.sections.length > 0), ungrouped };
}
