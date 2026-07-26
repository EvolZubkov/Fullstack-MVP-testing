/**
 * @module render/questions/multiple
 * @description Multiple-choice input for the SCORM runtime. Delegates to the SHARED
 * emission (`TBTemplate.renderMultiple`) so the `.ou-*` markup matches the web host;
 * toggling is delegated via `data-action="select:N"` (wired once in actions/answers).
 * Review highlight applies only when the answer is locked (feedback shown).
 *
 * Depends on globals: window.TBTemplate.
 */
function renderMultipleQuestionInput(q, answer, locked, correct, shuffleMapping) {
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (!TB || !TB.renderMultiple) return '';
  return TB.renderMultiple({ type: 'multiple', dataJson: q.data }, answer, shuffleMapping, locked ? correct : undefined);
}
