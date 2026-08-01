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

import type { Form, FormSet } from "../schema";
import type { ShuffleFn } from "./blueprint";
import type { QuestionOrderMode } from "./order-questions";

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
  /**
   * PRD-30 FR-07: how the delivered variant is ordered. `random` (the default,
   * and PRD-17's original behaviour) shuffles the presentation order; `fixed`
   * delivers the variant's OWN list order — the author already sequenced it
   * there, so `questions.order_index` is NOT applied on top.
   */
  order?: QuestionOrderMode;
}

/**
 * Pick one variant from `forms` and return its delivered question ids. `forms` is
 * the validated `formSetJson.forms` (>= 2 variants by `formSetSchema`); the caller
 * only invokes this when the section is in variants mode.
 */
export function selectForm(forms: Form[], opts: SelectFormOptions): SelectFormResult {
  const { previousFormIds, availableIds, shuffle, order = "random" } = opts;

  const used = new Set(previousFormIds);
  // Rotation: prefer variants not seen in prior completed attempts; when all have
  // been seen (attempts exceed variant count), reset and cycle (FR-07).
  let candidates = forms.filter((f) => !used.has(f.id));
  if (candidates.length === 0) candidates = forms.slice();

  const chosen = shuffle(candidates.slice())[0];

  // Deliver the whole variant; drop questions no longer in the bank (FR-17), then
  // randomise presentation order (FR-15) — unless the topic runs in `fixed`
  // order, where the variant's own list IS the order (PRD-30 FR-07). A dropped
  // question simply falls out; the remaining ones keep their relative places.
  const present = availableIds
    ? chosen.questionIds.filter((id) => availableIds.has(id))
    : chosen.questionIds.slice();
  const questionIds = order === "fixed" ? present : shuffle(present.slice());

  return { formId: chosen.id, questionIds };
}

// ── Excel «Варианты» column (PRD-17 FR-13) ──────────────────────────────────────

/**
 * Parse a workbook «Варианты» cell into variant NUMBERS (1-based). Variants are
 * positional (the editor auto-numbers them «Вариант 1/2/3»), so the cell carries
 * numbers, not free-text labels. Delimiter `;` or `,` (like «Теги»); a token may
 * be a bare number ("1") or "Вариант 1" — the first run of digits wins. Deduped;
 * blanks and non-positive values dropped.
 */
export function parseVariantNumbers(cell: unknown): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of String(cell ?? "").split(/[;,]/)) {
    const m = raw.match(/\d+/);
    if (!m) continue;
    const n = parseInt(m[0], 10);
    if (!Number.isFinite(n) || n < 1 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** One question and the variant numbers it was tagged with on the «Вопросы» sheet. */
export interface VariantMembership {
  questionId: string;
  numbers: number[];
}

/**
 * Build a section's {@link FormSet} from per-question variant numbers (Excel
 * import). Variants are taken in ascending number order and labelled positionally
 * «Вариант 1…N» (so non-contiguous input like 1,3 normalises to 1,2); each form's
 * `questionIds` are the questions that listed its number (deduped, membership
 * order). `makeId(index)` mints the stable form id. Returns null when no question
 * carries any number. The caller enforces the ">= 2 variants" rule.
 */
export function buildFormSet(
  memberships: VariantMembership[],
  makeId: (index: number) => string,
): FormSet | null {
  const byNumber = new Map<number, string[]>();
  for (const m of memberships) {
    for (const n of m.numbers) {
      const list = byNumber.get(n) ?? [];
      if (!list.includes(m.questionId)) list.push(m.questionId);
      byNumber.set(n, list);
    }
  }
  if (byNumber.size === 0) return null;
  const forms: Form[] = [...byNumber.keys()]
    .sort((a, b) => a - b)
    .map((n, i) => ({ id: makeId(i), label: `Вариант ${i + 1}`, questionIds: byNumber.get(n)! }));
  return { forms };
}
