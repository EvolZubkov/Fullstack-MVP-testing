/**
 * @module client/src/pages/learner/cooldown-format
 *
 * PRD-19 Block F (FR-20): web-host date helpers for the retake cooldown card on
 * the start screen. The cooldown state renders ON the standard start page (no
 * separate block-wall), and the shared `buildStartState` consumes an
 * already-formatted date string — formatting is a host responsibility. These are
 * the web counterparts of the SCORM gate's `fmtDateHuman` / `daysUntilIso`, kept
 * byte-identical in behaviour so both hosts show the next-available date in the
 * same numeric form (ДД.ММ.ГГГГ) and the optional «через N дн.» line agrees.
 */

/** Format a `YYYY-MM-DD` (optionally with a time suffix) ISO date as ДД.ММ.ГГГГ. */
export function fmtIsoDateHuman(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

/** Whole days from today until the ISO date (UTC granularity), or null when not future. */
export function daysUntilIsoDate(iso: string | null | undefined): number | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return null;
  const target = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const d = Math.ceil((target - today) / 86400000);
  return d > 0 ? d : null;
}
