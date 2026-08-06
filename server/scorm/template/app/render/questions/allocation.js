/**
 * @module render/questions/allocation
 * @description Budget-allocation input for the SCORM runtime (PRD-44). Delegates to the
 * SHARED emission (`TBTemplate.renderAllocation`) so the DS `.ou-alloc` markup is
 * byte-identical to the web host — this wrapper owns no markup of its own.
 *
 * `showReview` here means READ-ONLY, not «show the correct answer»: the type has no
 * reference distribution, so there is nothing to mark and no verdict class is emitted.
 *
 * Depends on globals: window.TBTemplate.
 */
function renderAllocationQuestionInput(q, answer, showReview) {
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (!TB || !TB.renderAllocation) return '';
  return TB.renderAllocation({ type: 'allocation', dataJson: q.data }, answer, !!showReview);
}
