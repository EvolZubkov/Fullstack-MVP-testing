/**
 * @module render/questions/short
 * @description Typed-answer input for the SCORM runtime (PRD-57 §6.5). Delegates to the
 * SHARED emission (`TBTemplate.renderShortAnswer`) so the field is byte-identical to the
 * web host — this wrapper owns no markup of its own (FR-30).
 *
 * `showReview` here means READ-ONLY, not «show the correct answer»: the reference of a
 * typed answer is the author's rule set, and printing it beside the field would hand the
 * learner the answer.
 *
 * The numeric flavour and the display unit come from the rule set, which travels in the
 * baked payload as `q.correct` — the same place every other type keeps its answer key.
 *
 * Depends on globals: window.TBTemplate.
 */
function renderShortQuestionInput(q, answer, showReview) {
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (!TB || !TB.renderShortAnswer) return '';
  var rules = q.correct || {};
  return TB.renderShortAnswer({ type: q.type, dataJson: q.data }, answer, {
    numeric: rules.answerKind === 'number',
    unit: rules.unit,
    readonly: !!showReview,
  });
}
