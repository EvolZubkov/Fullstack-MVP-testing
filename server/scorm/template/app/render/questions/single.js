/**
 * @module render/questions/single
 * @description Single-choice input for the SCORM runtime. Delegates to the SHARED
 * emission (`TBTemplate.renderSingleChoice`) so the `.ou-*` markup is byte-identical to
 * the web host; selection is delegated via `data-action="select:N"` (wired once in
 * actions/answers). Review highlight applies only when showReview (showCorrectAnswers
 * shown), mirroring the web.
 *
 * Depends on globals: window.TBTemplate.
 */
function renderSingleQuestionInput(q, answer, showReview, correct, shuffleMapping) {
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (!TB || !TB.renderSingleChoice) return '';
  return TB.renderSingleChoice({ type: 'single', dataJson: q.data }, answer, shuffleMapping, showReview ? correct : undefined);
}
