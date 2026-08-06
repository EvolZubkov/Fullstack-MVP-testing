/**
 * @module shared/template/feedback-banner
 * @description Single source of the after-answer feedback banner (revision «Стандартный»
 * on ui-kit). Both hosts and both delivery modes — standard and adaptive — emit the SAME
 * DS `.ou-banner` for the answer-check verdict, so the feedback chrome cannot drift between
 * the web question screen and the SCORM package (before this it was four inline-styled
 * `.feedback-block` copies with literal hex colours). The verdict tone drives the DS banner
 * variant (`success` / `warning` / `error`) and its icon; the colour therefore flows through
 * DS tokens instead of literals.
 *
 * The banner keeps `feedback-block` as a marker class so the existing dedup / teardown hooks
 * (`document.querySelector('.feedback-block')`) still match. The verdict title is escaped
 * here; `bodyHtml` is a pre-composed, already-escaped fragment the caller supplies (the
 * feedback text and, for adaptive, the correct-answer line), placed under the title.
 *
 * Pure/framework-free — no DOM, no Node — safe to bundle into the SCORM runtime.
 */

/** DS banner tone for a verdict: a right answer, partial credit, or a miss. */
export type FeedbackTone = "success" | "warning" | "error";

/** HTML-escape user text (same convention as {@link module:shared/template/renderers}). */
function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Verdict icons, one per tone (wireframe `question — проверка`): check / alert-triangle /
 * cross. Stroke colour is inherited from the DS banner tone via `currentColor`.
 */
const ICONS: Readonly<Record<FeedbackTone, string>> = {
  success:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>',
  error:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"></path></svg>',
  warning:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 ' +
    '1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>',
};

/**
 * A single `.ou-banner__desc` line from plain text (escaped). Convenience for callers that
 * compose a multi-line body, so the class name stays single-sourced.
 */
export function feedbackDesc(text: unknown): string {
  return `<div class="ou-banner__desc">${esc(text)}</div>`;
}

/**
 * The after-answer feedback banner as a DS `.ou-banner`. `tone` selects the variant + icon,
 * `title` is the verdict line (escaped), and `bodyHtml` is optional pre-built inner markup
 * (already-escaped `.ou-banner__desc` fragments) rendered under the title.
 */
export function feedbackBanner(tone: FeedbackTone, title: unknown, bodyHtml?: string): string {
  return (
    `<div class="ou-banner ou-banner--${tone} ou-banner--sm feedback-block">` +
    `<span class="ou-banner__ico" aria-hidden="true">${ICONS[tone]}</span>` +
    `<div class="ou-banner__body">` +
    `<div class="ou-banner__title">${esc(title)}</div>` +
    (bodyHtml || "") +
    `</div></div>`
  );
}
