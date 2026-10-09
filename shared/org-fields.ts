/**
 * @module shared/org-fields
 * @description Org-structure values of a person — organisation, unit, position —
 * as one engine for every host that reads or compares them.
 *
 * The values are free text that arrives from two directions: an operator types
 * it into a profile, an LMS export brings it in whatever spelling the LMS keeps.
 * Compared literally, «Отдел продаж» and «ОТДЕЛ ПРОДАЖ» would be two units, and
 * the analytics would silently split one department into two slices. So there are
 * two operations, deliberately separate:
 *  - {@link normalizeOrgValue} — what is STORED: edges trimmed, whitespace runs
 *    collapsed, case kept (the value is shown to people as it was entered);
 *  - {@link orgValueKey} — what is COMPARED: the normalised value in lower case.
 *
 * The profile form, the users list filters, the bulk import and the analytics
 * axes all go through this module, so a value that matches in one place matches
 * in all of them (org-structure plan, decision Р-4).
 */

/** The three org-structure fields of a profile, in the order they are shown. */
export const ORG_FIELDS = ["organization", "unit", "position"] as const;

/** One of {@link ORG_FIELDS}. */
export type OrgField = (typeof ORG_FIELDS)[number];

/** Any run of whitespace, the no-break space included (it comes with pasted text). */
const WHITESPACE = /[\s ]+/g;

/**
 * The stored form of an org-structure value.
 *
 * An empty value becomes `null`, never `""`: an empty string would be a value in
 * its own right and would match every other empty one.
 *
 * @param raw Value from a form, a workbook cell or an import row.
 * @returns The trimmed value with single spaces, or `null` when nothing is left.
 */
export function normalizeOrgValue(raw: unknown): string | null {
  const s = String(raw ?? "").replace(WHITESPACE, " ").trim();
  return s === "" ? null : s;
}

/**
 * The comparison key of an org-structure value: two values with the same key are
 * the same unit (organisation, position) whatever their spelling.
 *
 * @param raw Value in any spelling.
 * @returns Lower-cased normalised value, or `null` for an empty one.
 */
export function orgValueKey(raw: unknown): string | null {
  const s = normalizeOrgValue(raw);
  return s === null ? null : s.toLowerCase();
}

/** How often one value occurs: in profiles and in passages. */
export interface OrgValueCount {
  /** The spelling shown for the value. */
  value: string;
  /** Profiles that carry it. */
  users: number;
  /** Passages that carry it (imported ones — telemetry has no unit or position). */
  attempts: number;
}

/**
 * Fold raw per-spelling counts into one entry per value.
 *
 * The label of a folded entry is its most frequent spelling (profiles and
 * passages counted together); ties go to the spelling with more profiles, then
 * to the alphabetically first, so the label does not flicker between loads.
 *
 * @param rows Counts per exact spelling, from any number of sources.
 * @returns One entry per distinct value, empty values dropped, sorted by label.
 */
export function foldOrgValues(rows: readonly OrgValueCount[]): OrgValueCount[] {
  const groups = new Map<string, { users: number; attempts: number; spellings: Map<string, OrgValueCount> }>();

  for (const row of rows) {
    const key = orgValueKey(row.value);
    const spelling = normalizeOrgValue(row.value);
    if (key === null || spelling === null) continue;

    const group = groups.get(key) ?? { users: 0, attempts: 0, spellings: new Map() };
    group.users += row.users;
    group.attempts += row.attempts;
    const seen = group.spellings.get(spelling) ?? { value: spelling, users: 0, attempts: 0 };
    seen.users += row.users;
    seen.attempts += row.attempts;
    group.spellings.set(spelling, seen);
    groups.set(key, group);
  }

  const folded: OrgValueCount[] = [];
  for (const group of groups.values()) {
    const [label] = [...group.spellings.values()].sort((a, b) =>
      (b.users + b.attempts) - (a.users + a.attempts)
      || b.users - a.users
      || a.value.localeCompare(b.value, "ru"));
    folded.push({ value: label.value, users: group.users, attempts: group.attempts });
  }
  return folded.sort((a, b) => a.value.localeCompare(b.value, "ru"));
}
