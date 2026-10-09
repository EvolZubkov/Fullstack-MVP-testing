/**
 * @module shared/breakdown/compute
 * @description THE single PRD-50 breakdown algorithm, called by `aggregateStandardResult`
 * and therefore by BOTH hosts (the web grader and the SCORM runtime, which reaches it
 * through the `TBTemplate` bundle). Pure: no host types, no I/O, deterministic order.
 *
 * Two scopes per key — the delivering section and the whole test (FR-04). The test scope
 * is a separate pass over the items, not a sum of section records: a question delivered in
 * two sections counts twice, which is a property of the delivery, not an error.
 */
import type { BreakdownEntry, BreakdownItem } from "./types";

export const TEST_SCOPE = "test";

/** Scope string of a section. The section is the DELIVERING one (решение 2). */
export function sectionScope(sectionId: string): string {
  return "section:" + sectionId;
}

interface Acc {
  scope: string;
  axis: string;
  key: string;
  items: number;
  answered: number;
  earned: number;
  possible: number;
  unitEarned: number;
}

function percent(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/**
 * Compute every breakdown record of one attempt.
 *
 * Order is deterministic and follows first appearance: an item's section record is
 * emitted before its test record, so a host that renders the array as-is gets a stable
 * layout and a package rebuilt from unchanged data stays byte-identical.
 */
export function computeBreakdowns(items: readonly BreakdownItem[]): BreakdownEntry[] {
  const order: string[] = [];
  const acc = new Map<string, Acc>();

  const bump = (scope: string, axis: string, key: string, item: BreakdownItem): void => {
    const id = scope + " " + axis + " " + key;
    let row = acc.get(id);
    if (!row) {
      row = { scope, axis, key, items: 0, answered: 0, earned: 0, possible: 0, unitEarned: 0 };
      acc.set(id, row);
      order.push(id);
    }
    row.items += 1;
    if (item.answered) row.answered += 1;
    row.earned += item.earned;
    row.possible += item.possible;
    // FR-02: the question's own share, so every question weighs exactly 1.
    row.unitEarned += item.possible > 0 ? item.earned / item.possible : 0;
  };

  for (const item of items) {
    // FR-02: nothing to grade — nothing to show. A measurement-only question would
    // otherwise drag a bar to zero on a scale it never belonged to.
    if (!(item.possible > 0)) continue;
    const keys = item.axisKeys;
    if (!keys) continue;
    for (const axis of Object.keys(keys)) {
      const seen = new Set<string>();
      for (const key of keys[axis] || []) {
        // A question repeating a key does not count twice.
        if (!key || seen.has(key)) continue;
        seen.add(key);
        bump(sectionScope(item.sectionId), axis, key, item);
        bump(TEST_SCOPE, axis, key, item);
      }
    }
  }

  return order.map((id) => {
    const row = acc.get(id)!;
    return {
      scope: row.scope,
      axis: row.axis,
      key: row.key,
      items: row.items,
      answered: row.answered,
      earned: row.earned,
      possible: row.possible,
      unitEarned: row.unitEarned,
      unitPossible: row.items,
      percentPoints: percent(row.earned, row.possible),
      percentUnits: percent(row.unitEarned, row.items),
    };
  });
}
