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

  /**
   * Carries an answer list in `data.options` — 'single', 'multiple', 'scale' and
   * 'allocation'. The allocation's STATEMENTS live in that same field (PRD-44 FR-02),
   * so every existing reader of `data.options` keeps working unchanged.
   */
  function hasOptionList(type) {
    return type === 'single' || type === 'multiple' || type === 'scale' || type === 'allocation';
  }

  /**
   * The learner splits a fixed BUDGET across the options (PRD-44): the answer is a
   * per-option amount and the SIZE of that amount is what a measurement reads. Branch
   * on this, never on `type === 'allocation'`.
   */
  function distributesBudget(type) {
    return type === 'allocation';
  }

  /** Option order is content, not presentation: never shuffle it. */
  function hasFixedOptionOrder(type) {
    return type === 'scale';
  }

  /**
   * Measurement-only question: never checked, earns no points, contributes only to
   * the scales (PRD-26 FR-08). Two ways in: a scale with no correct graduation (the
   * author's choice), and an allocation ALWAYS (PRD-44 FR-09 — the method has no
   * reference distribution, so a stray key must not make it checkable). The answer
   * key reaches the runtime as `q.correct`.
   */
  function isMeasurementOnly(q) {
    if (!q) return false;
    if (distributesBudget(q.type)) return true;
    if (q.type !== 'scale') return false;
    // The key travels as `correctJson` on the server and as `correct` in the baked
    // payload; accept both so no caller has to reshape its question first.
    var key = (q.correctJson !== undefined && q.correctJson !== null) ? q.correctJson : q.correct;
    return !key || typeof key.correctIndex !== 'number';
  }

  return {
    isSingleIndexChoice: isSingleIndexChoice,
    hasOptionList: hasOptionList,
    hasFixedOptionOrder: hasFixedOptionOrder,
    distributesBudget: distributesBudget,
    isMeasurementOnly: isMeasurementOnly,
  };
}());

if (typeof window !== 'undefined') window.TBQType = TBQType;
