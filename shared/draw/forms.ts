/**
 * @module shared/draw/forms
 *
 * Pure variant-selection core (PRD-17, BR-12). When a section runs in "variants
 * mode" (`form_set_json` present), ONE author-curated variant is picked at topic
 * start and delivered WHOLE, in random order (FR-04/FR-15). This is the
 * authoritative implementation; the server-side attempt builder
 * (server/routes/attempts.ts) calls {@link selectForm} directly, and a plain-JS
 * twin in the SCORM package will be kept in parity by a golden test (PRD-17 Фаза 5).
 *
 * Selection (PRD-17 §5; FR-07):
 * - candidates = variants NOT used in the learner's prior COMPLETED attempts on
 *   this topic — rotation, keyed on the stable `formId` (not list position, R-3).
 *   Web only; in the SCORM package `previousFormIds` is always empty (no
 *   cross-attempt store, NFR-17) → effectively a random pick.
 * - all variants already used (attempts > variant count) → exclusion resets (cycle).
 * - pick one candidate at random; deliver its `questionIds` filtered to the topic's
 *   current bank (a removed question is dropped, NOT duplicated — soft shortfall,
 *   FR-17), shuffled into a random presentation order (FR-15).
 *
 * `shuffle` is injected (the runtime passes Fisher-Yates; tests pass a
 * deterministic permutation) so both selection and ordering are testable.
 */

import type { Form } from "../schema";
import type { ShuffleFn } from "./blueprint";

export interface SelectFormResult {
  /** Stable id of the chosen variant — pinned in the attempt for rotation (FR-08). */
  formId: string;
  /** Delivered question ids: the variant's content, filtered to the live bank, shuffled. */
  questionIds: string[];
}

export interface SelectFormOptions {
  /** Variant ids used in the learner's prior COMPLETED attempts on this topic (FR-07). */
  previousFormIds: string[];
  /**
   * Ids of questions currently in the topic's bank. A variant question absent
   * here was removed from the bank → it is dropped (soft shortfall, FR-17). When
   * omitted/null, all variant questions are kept (no bank filtering).
   */
  availableIds?: ReadonlySet<string> | null;
  /** Injected shuffle (Fisher-Yates at runtime; deterministic permutation in tests). */
  shuffle: ShuffleFn;
}

/**
 * Pick one variant from `forms` and return its delivered question ids. `forms` is
 * the validated `formSetJson.forms` (>= 2 variants by `formSetSchema`); the caller
 * only invokes this when the section is in variants mode.
 */
export function selectForm(forms: Form[], opts: SelectFormOptions): SelectFormResult {
  const { previousFormIds, availableIds, shuffle } = opts;

  const used = new Set(previousFormIds);
  // Rotation: prefer variants not seen in prior completed attempts; when all have
  // been seen (attempts exceed variant count), reset and cycle (FR-07).
  let candidates = forms.filter((f) => !used.has(f.id));
  if (candidates.length === 0) candidates = forms.slice();

  const chosen = shuffle(candidates.slice())[0];

  // Deliver the whole variant; drop questions no longer in the bank (FR-17), then
  // randomise presentation order (FR-15).
  const present = availableIds
    ? chosen.questionIds.filter((id) => availableIds.has(id))
    : chosen.questionIds.slice();
  const questionIds = shuffle(present.slice());

  return { formId: chosen.id, questionIds };
}
