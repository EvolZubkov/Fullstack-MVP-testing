/**
 * @module shared/template/protection/watermark
 *
 * PRD-34 (FR-16 — FR-19): the anonymised mark BUILT INTO the scene. A screenshot stays
 * possible — the browser gives no way to forbid it (spec §2.2) — but it becomes
 * attributable, and attribution is the working deterrent.
 *
 * The mark is a readable line, not a diagonal tile over the content: reading the prompt
 * is the learner's actual work and must not be obstructed.
 *
 * WHERE it goes is DECLARED by the layout — an empty `[data-slot="protection-mark"]`
 * anchor — and never guessed from the markup's shape. Guessing (walk up from the options
 * slot until an ancestor also holds the prompt) is correct only for a vertical layout; on
 * a two-column one the line becomes a third column and breaks it. Templates are arbitrary
 * (PRD-3), so a layout that declares nothing gets the fallback: a line at the start of the
 * scene. The mark never disappears — a missing mark is a silent loss of attribution.
 *
 * What the layout does NOT get is the mark's appearance: markup, type size and contrast
 * come from the core and its injected stylesheet ({@link module:shared/template/protection/apply}).
 * Otherwise a template could render the attribution at 4 px or in the background colour
 * and the measure would exist only on paper.
 */

const MARK_CLASS = "tb-protection-mark";

/** The anchor a layout declares to place the mark itself (FR-16). */
export const MARK_SLOT = '[data-slot="protection-mark"]';

/**
 * Build (or lift) the watermark on a rendered scene.
 *
 * @param root Scene container the host rendered into.
 * @param text Prepared mark text; `null` removes the mark.
 */
export function applyWatermark(root: HTMLElement, text: string | null): void {
  root.querySelectorAll("." + MARK_CLASS).forEach((el) => el.remove());
  if (!text) return;
  const mark = root.ownerDocument.createElement("div");
  mark.className = MARK_CLASS;
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = text;
  const anchor = root.querySelector(MARK_SLOT);
  if (anchor) {
    anchor.appendChild(mark);
    return;
  }
  const scene = root.firstElementChild ?? root;
  scene.insertBefore(mark, scene.firstElementChild);
}
