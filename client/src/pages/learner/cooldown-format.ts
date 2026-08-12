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
 * decision (`server/services/retake-gate.ts`, `shared/eligibility/engine.ts`'s
 * `daysUntilDate`) sourced from the server's own clock and delivered ready-made
 * as `retakeGate.daysUntil`, so the web host never reads the learner's local
 * clock for it.
 */

/** Format a `YYYY-MM-DD` (optionally with a time suffix) ISO date as ДД.ММ.ГГГГ. */
export function fmtIsoDateHuman(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

/**
 * PRD-31 (FR-11): human form of the INSTANT barrier B opens at — «01.08.2026 в 14:30».
 * An hour interval cannot be expressed as a calendar date, so this one carries a
 * time; it is rendered in the learner's own zone, because a UTC time would be
 * meaningless to the person reading it.
 *
 * This does not weaken the rule above: the DECISION still comes from the server
 * (`decideRetake` sends `availableAt`), and the local clock is used only to display
 * an instant the server already chose — never to decide whether access is open.
 */
export function fmtIsoInstantHuman(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `${date} в ${time}`;
}
