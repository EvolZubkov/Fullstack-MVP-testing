var QUESTION_HINTS = {
  single:   'Выберите только один правильный ответ.',
  multiple: 'Выберите один или несколько правильных ответов.',
  ranking:  'Расставьте элементы в правильной последовательности. Для этого зажмите нужный элемент и передвиньте.',
  matching: 'Расставьте элементы в правильной последовательности. Для этого зажмите нужный элемент и передвиньте.'
};

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

  var hint = QUESTION_HINTS[q.type] || '';
  var hintHtml = hint ? '<p class="question-hint">' + escapeHtml(hint) + '</p>' : '';

  var inputHtml = '';
  if (q.type === 'single')   inputHtml = renderSingleQuestionInput(q, answer, locked, correct, shuffleMapping);
  else if (q.type === 'multiple') inputHtml = renderMultipleQuestionInput(q, answer, locked, correct, shuffleMapping);
  else if (q.type === 'matching') inputHtml = renderMatchingQuestionInput(q, answer, locked, correct, shuffleMapping);
  else if (q.type === 'ranking')  inputHtml = renderRankingQuestionInput(q, answer, locked, correct, shuffleMapping);
  else return '<div>Неизвестный тип вопроса</div>';

  return hintHtml + inputHtml;
}
