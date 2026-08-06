/**
 * @module render/questions/scale
 * @description Scale (Likert) input for the SCORM runtime. Delegates to the SHARED
 * emission (`TBTemplate.renderScale`) so the DS `.ou-stepper--choice` markup is
 * byte-identical to the web host; selection is delegated via `data-action="select:N"`
 * (wired once in actions/answers). Review highlight applies only when showReview
 * (showCorrectAnswers shown), mirroring the web.
 *
 * No shuffle mapping is passed: the order of graduations is content, not presentation
 * (PRD-26 FR-04), and `shuffleMappingFor` refuses a scale for the same reason.
 *
 * Depends on globals: window.TBTemplate.
 */
function renderScaleQuestionInput(q, answer, showReview, correct) {
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (!TB || !TB.renderScale) return '';
  return TB.renderScale({ type: 'scale', dataJson: q.data }, answer, showReview ? correct : undefined);
}
