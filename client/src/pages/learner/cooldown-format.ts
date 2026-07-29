/**
 * @module client/src/pages/learner/cooldown-format
 *
 * PRD-19 Block F (FR-20): web-host date formatting for the retake cooldown card
 * on the start screen. The cooldown state renders ON the standard start page (no
 * separate block-wall), and the shared `buildStartState` consumes an
 * already-formatted date string — formatting is a host responsibility. This is
 * the web counterpart of the SCORM gate's `fmtDateHuman`, kept byte-identical in
 * behaviour so both hosts show the next-available date in the same numeric form
 * (ДД.ММ.ГГГГ).
 *
 * The «через N дн.» countdown is NOT computed here (PRD-6): it is a server
 * decision (`server/services/retake-gate.ts`, `shared/eligibility/engine.
 * daysUntilDate`) sourced from the server's own clock and delivered ready-made as
 * `retakeGate.daysUntil`, so the web host never reads the learner's local clock
 * for it.
 */

/** Format a `YYYY-MM-DD` (optionally with a time suffix) ISO date as ДД.ММ.ГГГГ. */
export function fmtIsoDateHuman(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}
