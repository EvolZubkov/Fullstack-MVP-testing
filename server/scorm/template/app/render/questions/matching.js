/**
 * @module render/questions/matching
 * @description Matching input for the SCORM runtime. Delegates to the SHARED emission
 * (`TBTemplate.renderMatching`) so the `.ou-match` markup matches the web host. The
 * pool order is read from `state.matchingPools` (maintained by dnd/matching on each
 * drop through the shared rich pool model); the render itself does not mutate state —
 * the DnD adapter reconciles the pool. Drag/drop uses the shared pointer engine
 * (`data-drag`/`data-drop`), the same contract both hosts consume.
 *
 * Depends on globals: state, window.TBTemplate.
 */
function renderMatchingQuestionInput(q, answer, showReview, correct, shuffleMapping) {
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (!TB || !TB.renderMatching) return '';
  var pool = (state.matchingPools && Array.isArray(state.matchingPools[q.id])) ? state.matchingPools[q.id] : [];
  return TB.renderMatching({ type: 'matching', dataJson: q.data }, answer, shuffleMapping, pool, showReview ? correct : undefined);
}
