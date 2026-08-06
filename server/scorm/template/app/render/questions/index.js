function renderQuestionInput(q) {
  var answer = state.answers[q.id];
  // Answer-review highlighting (correct/wrong/partial) is shown ONLY when the test
  // enables «показывать правильность ответа» (showCorrectAnswers) — NEVER on the mere
  // fact that an answer is committed/frozen, which would leak the key with the setting
  // off (web parity: take-test gates reviewMode on showCorrectAnswers). Interaction is
  // guarded separately by the delegated handlers (isAnswerLocked), so read-only after
  // commit still holds without this flag.
  var fqCur = (state.flatQuestions || [])[state.currentIndex];
  var showReview = TEST_DATA.showCorrectAnswers &&
    (state.feedbackShown || (typeof isAnswerLocked === 'function' && isAnswerLocked(fqCur)));
  var correct = q.correct || {};
  var shuffleMapping = state.shuffleMappings[q.id];

  // The type hint is the question subtitle (state.questionHint in the layout, both
  // hosts) — not prepended here, so the package matches the web exactly.
  if (q.type === 'single')   return renderSingleQuestionInput(q, answer, showReview, correct, shuffleMapping);
  // The scale takes no shuffle mapping: its graduation order is content (PRD-26 FR-04).
  if (q.type === 'scale')    return renderScaleQuestionInput(q, answer, showReview, correct);
  if (q.type === 'multiple') return renderMultipleQuestionInput(q, answer, showReview, correct, shuffleMapping);
  if (q.type === 'matching') return renderMatchingQuestionInput(q, answer, showReview, correct, shuffleMapping);
  if (q.type === 'ranking')  return renderRankingQuestionInput(q, answer, showReview, correct, shuffleMapping);
  // PRD-44: у распределения нет эталона, поэтому showReview означает «только чтение».
  if (typeof TBQType !== 'undefined' && TBQType.distributesBudget(q.type)) {
    // Предзаполнение минимумом (FR-30) — зеркало веб-хоста. Без него учащийся с
    // ненулевым минимумом распределит бюджет и застрянет с утверждением, которое
    // уже нечем поднять.
    var TBa = (typeof window !== 'undefined') ? window.TBTemplate : null;
    if (TBa && TBa.seedAllocation && (answer === undefined || answer === null)) {
      var seed = TBa.seedAllocation(TBa.allocationSpec(q.data));
      if (Object.keys(seed).length > 0) {
        state.answers[q.id] = seed;
        answer = seed;
      }
    }
    return renderAllocationQuestionInput(q, answer, showReview);
  }
  return '<div>Неизвестный тип вопроса</div>';
}
