/**
 * @module shared/draw/order-questions
 *
 * Pure delivery-ORDER core (PRD-30). Selection and ordering are deliberately
 * separate concerns: {@link module:shared/draw/blueprint drawSection} (PRD-11)
 * and {@link module:shared/draw/forms selectForm} (PRD-17) decide WHICH
 * questions a topic delivers, this module decides in WHAT ORDER they are shown.
 * Keeping them apart leaves the tag-quota selection and the feasibility check
 * (`shared/draw/feasibility.ts`) untouched by the ordering rule.
 *
 * It is the authoritative implementation; a plain-JS twin in the SCORM package
 * (`server/scorm/assets/app.js`) is kept in parity by a golden test, and the
 * server-side attempt builder (`server/routes/attempts.ts`) calls this directly.
 *
 * Rule (PRD-30 §4.2; FR-03/04/05):
 * - mode `random` (the default, and everything that is not `fixed`) — today's
 *   behaviour: the whole list goes through `shuffle`.
 * - mode `fixed` — ascending `orderIndex`; questions WITHOUT an index (null or
 *   absent) come last; questions SHARING an index form a group that is shuffled
 *   inside itself. The last part is the point of the design: an author writes
 *   «these three first, then those five», and inside a group the order is
 *   undefined by definition — a stable tie-break by id would fake an order the
 *   author never chose.
 *
 * `shuffle` is injected (the runtime passes Fisher-Yates; tests pass a
 * deterministic permutation) so both the sort and the in-group shuffle are
 * testable. The input array is never mutated.
 */

import type { ShuffleFn } from "./blueprint";

/** How a topic orders its delivered questions (`test_sections.question_order`). */
export type QuestionOrderMode = "random" | "fixed";

/** A question the ordering can see — only the id and the author's index matter. */
export interface OrderableQuestion {
  id: string;
  /** PRD-30 FR-01: author-defined index inside the topic; null/absent = not set. */
  orderIndex?: number | null;
}

/** True when the value is a usable index (0 and negatives are ordinary values). */
function hasIndex(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Order the questions a topic delivers. `questions` is the ALREADY SELECTED
 * list (draw or variant); the result is a new array in presentation order.
 */
export function orderQuestions<Q extends OrderableQuestion>(
  questions: Q[],
  mode: QuestionOrderMode,
  shuffle: ShuffleFn,
): Q[] {
  // Anything that is not an explicit `fixed` keeps the pre-PRD-30 behaviour:
  // an unknown value must never silently freeze the delivery order.
  if (mode !== "fixed") return shuffle(questions.slice());

  // Group by index; questions without one collect in `unindexed` and are
  // appended after every group (FR-04).
  const groups = new Map<number, Q[]>();
  const unindexed: Q[] = [];
  for (const question of questions) {
    const index = question.orderIndex;
    if (!hasIndex(index)) {
      unindexed.push(question);
      continue;
    }
    const group = groups.get(index);
    if (group) group.push(question);
    else groups.set(index, [question]);
  }

  const ordered: Q[] = [];
  for (const index of [...groups.keys()].sort((a, b) => a - b)) {
    // Every group goes through the shuffle, including single-member ones: the
    // injected function is the only source of order INSIDE a group (FR-05).
    ordered.push(...shuffle(groups.get(index)!.slice()));
  }
  ordered.push(...shuffle(unindexed.slice()));
  return ordered;
}
