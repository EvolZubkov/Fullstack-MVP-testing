/**
 * @module shared/template/protection/spec
 *
 * PRD-34 (FR-06, FR-08, FR-09, FR-16, FR-30): the ONE place that decides what a
 * learner screen protects, hides and stamps. Pure — no DOM and no host globals —
 * so the web host and the SCORM package derive the SAME decision from the same
 * inputs and the perimeter cannot drift between them.
 *
 * Two lists live here and are deliberately NOT derived from one another: the copy
 * perimeter (FR-06/FR-08) and the watermark screens (FR-16). The results screen
 * carries the mark but is not copy-protected.
 *
 * WHERE the mark is drawn is NOT decided here: the layout declares an anchor and the
 * DOM pass resolves it ({@link module:shared/template/protection/watermark}), so no
 * screen-to-position table exists that could drift from the templates.
 */

/** Learner screens the builder knows about; anything else is protected by nothing (FR-09). */
export type ProtectedScreen = "question" | "review" | "section-results" | "results";

/** The three per-test settings (FR-01) as the host delivers them. */
export interface ProtectionSettings {
  copyProtection: boolean;
  watermark: boolean;
  hideOnBlur: boolean;
}

/** Who a screenshot belongs to (FR-17, FR-18). Anonymised on purpose: no name, no email. */
export interface WatermarkStamp {
  /** Attempt id on the web host, `cmi.learner_id` in the package; may be empty. */
  id: string;
  /** The moment printed on the mark. */
  at: Date;
}

/** Where a measure applies: either named regions, or the whole scene (FR-08). */
export interface RegionTarget {
  selectors: string[];
  wholeScene: boolean;
}

/** The render-time decision for one screen. `null` means "this measure does not apply here". */
export interface ProtectionSpec {
  copy: RegionTarget | null;
  hide: RegionTarget | null;
  watermarkText: string | null;
}

export interface BuildProtectionInput {
  /** Screen key; unknown values are legal and protect nothing. */
  screen: string;
  settings: ProtectionSettings;
  /** Absent ⇒ no mark can be drawn even when the setting is on. */
  stamp: WatermarkStamp | null;
  /** False in the PRD-18 debug run and the admin preview (FR-25). Default true. */
  active?: boolean;
}

/**
 * Core-owned region selectors of the question screen (FR-06). They address slots the
 * CORE fills and a context path the CORE binds — never template classes, so an
 * externally loaded template (PRD-3) is covered without declaring anything (FR-34).
 */
export const QUESTION_REGIONS: readonly string[] = [
  '[data-slot="question-text"]',
  '[data-slot="question-interaction"]',
  '[data-slot="question-feedback"]',
  '[data-slot="question-media"]',
  '[data-path="state.questionHint"]',
];

/**
 * Screens carrying the watermark (FR-16) — deliberately NOT derived from the copy
 * perimeter: the results screen wears the mark and is not copy-protected.
 */
const WATERMARK_SCREENS: readonly string[] = ["question", "review", "section-results", "results"];

function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

/**
 * Format the mark as «ID <id> · ДД.ММ.ГГГГ ЧЧ:ММ». An empty identifier (some LMS
 * return no `cmi.learner_id`) degrades to date and time — never to a blank gap (FR-18).
 */
export function formatWatermarkText(stamp: WatermarkStamp): string {
  const d = stamp.at;
  const when =
    pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear() +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  const id = stamp.id.trim();
  return id ? "ID " + id + " · " + when : when;
}

/** The bank-bearing screens: what a measure covers there. */
function targetFor(screen: string): RegionTarget | null {
  if (screen === "question") return { selectors: [...QUESTION_REGIONS], wholeScene: false };
  // FR-08: on the review screen the LAYOUT prints the prompt via `{{prompt}}`, so no
  // core-owned region exists to hook — and nothing but prompts and navigation lives there.
  if (screen === "review") return { selectors: [], wholeScene: true };
  return null;
}

/**
 * Decide what one screen protects, hides and stamps.
 *
 * @param input Screen key, the test's settings, the stamp and the debug flag.
 * @returns The render-time decision; `null` members mean the measure does not apply.
 */
export function buildProtectionSpec(input: BuildProtectionInput): ProtectionSpec {
  const active = input.active !== false;
  const target = targetFor(input.screen);
  // FR-19: the mark is NOT gated by `active` — the debug run shows it on purpose, so the
  // author sees what the learner will see.
  const showMark =
    input.settings.watermark &&
    input.stamp !== null &&
    WATERMARK_SCREENS.indexOf(input.screen) >= 0;
  return {
    copy: active && input.settings.copyProtection ? target : null,
    hide: active && input.settings.hideOnBlur ? target : null,
    watermarkText: showMark ? formatWatermarkText(input.stamp as WatermarkStamp) : null,
  };
}
