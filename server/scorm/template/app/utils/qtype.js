/**
 * @module utils/qtype
 * @description Question-type traits for the in-package runtime — the ES5 mirror of
 * `shared/questions/question-type.ts`. The runtime cannot import TypeScript modules,
 * so the predicates are duplicated here; the two files MUST stay in sync, and the
 * shared module is the source of truth.
 *
 * Branch on a TRAIT, never on a type literal: `TBQType.isSingleIndexChoice(q.type)`
 * instead of `q.type === 'single'`. Adding a type then keeps every branch correct.
 *
 * Exposes the global `TBQType`.
 */
var TBQType = (function () {
  /** Answered by picking exactly ONE option index — 'single' and 'scale'. */
  function isSingleIndexChoice(type) {
    return type === 'single' || type === 'scale';
  }

  /** Carries an answer list in `data.options` — 'single', 'multiple' and 'scale'. */
  function hasOptionList(type) {
    return type === 'single' || type === 'multiple' || type === 'scale';
  }

  /** Option order is content, not presentation: never shuffle it. */
  function hasFixedOptionOrder(type) {
    return type === 'scale';
  }

  /**
   * Measurement-only question: a scale with no correct graduation. Never checked,
   * earns no points, contributes only to the scales (PRD-26 FR-08). The answer key
   * reaches the runtime as `q.correct`.
   */
  function isMeasurementOnly(q) {
    if (!q || q.type !== 'scale') return false;
    var correct = q.correct;
    return !correct || typeof correct.correctIndex !== 'number';
  }

  return {
    isSingleIndexChoice: isSingleIndexChoice,
    hasOptionList: hasOptionList,
    hasFixedOptionOrder: hasFixedOptionOrder,
    isMeasurementOnly: isMeasurementOnly,
  };
}());

if (typeof window !== 'undefined') window.TBQType = TBQType;
