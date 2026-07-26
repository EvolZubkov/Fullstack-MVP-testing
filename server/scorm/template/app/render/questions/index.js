function renderQuestionInput(q) {
  var answer = state.answers[q.id];
  // PRD-19 (Block B): render inputs read-only when feedback is shown OR the
  // question is committed/frozen (isAnswerLocked keys off the PERSISTED status,
  // so a returned-to committed answer renders disabled — FR-04 / web parity).
  var fqCur = (state.flatQuestions || [])[state.currentIndex];
  var locked = (TEST_DATA.showCorrectAnswers && state.feedbackShown) ||
    (typeof isAnswerLocked === 'function' && isAnswerLocked(fqCur));
  var correct = q.correct || {};
  var shuffleMapping = state.shuffleMappings[q.id];

  // The type hint is the question subtitle (state.questionHint in the layout, both
  // hosts) — not prepended here, so the package matches the web exactly.
  if (q.type === 'single')   return renderSingleQuestionInput(q, answer, locked, correct, shuffleMapping);
  if (q.type === 'multiple') return renderMultipleQuestionInput(q, answer, locked, correct, shuffleMapping);
  if (q.type === 'matching') return renderMatchingQuestionInput(q, answer, locked, correct, shuffleMapping);
  if (q.type === 'ranking')  return renderRankingQuestionInput(q, answer, locked, correct, shuffleMapping);
  return '<div>Неизвестный тип вопроса</div>';
}
