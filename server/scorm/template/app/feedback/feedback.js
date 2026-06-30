function confirmAnswer() {
  if (!requireAnswerOrToast()) return;
  state.feedbackShown = true;
  
  // Вместо render() - обновляем DOM точечно
  var fq = state.flatQuestions[state.currentIndex];
  var q = fq.question;
  // PRD-19 (Block B): confirmAnswer is the single canonical fixation point —
  // mark the question 'answered' here, NOT on option selection (a selection is
  // not a commit). skipQuestion sets 'skipped'; everything else stays 'unanswered'.
  state.questionStatuses[q.id] = 'answered';
  var answer = state.answers[q.id];
  var scoreRatio = checkAnswer(q, answer);
  var isCorrect = scoreRatio === 1;
  
  // Подготавливаем данные о вариантах ответов
  var answerOptions = null;
  var leftItems = null;
  var rightItems = null;
  var rankingItems = null;
  
  if (q.type === 'single' || q.type === 'multiple') {
    answerOptions = q.data && q.data.options ? q.data.options : null;
  } else if (q.type === 'matching') {
    leftItems = q.data && q.data.left ? q.data.left : null;
    rightItems = q.data && q.data.right ? q.data.right : null;
  } else if (q.type === 'ranking') {
    rankingItems = q.data && q.data.items ? q.data.items : null;
  }
  
  // Send answer to telemetry
  Telemetry.answer({
    questionId: q.id,
    questionPrompt: q.prompt,
    questionType: q.type,
    topicId: fq.topicId,
    topicName: fq.topicName,
    difficulty: q.difficulty || 50,
    userAnswer: answer,
    correctAnswer: q.correct,
    isCorrect: isCorrect,
    points: isCorrect ? (q.points || 1) : (scoreRatio * (q.points || 1)),
    maxPoints: q.points || 1,
    levelIndex: null,
    levelName: null,
    // Добавляем варианты ответов для отображения в аналитике
    options: answerOptions,
    leftItems: leftItems,
    rightItems: rightItems,
    items: rankingItems
  });
  
  // PRD-19 (Block B): lock the inputs only when the answer is frozen. With
  // allowAnswerChange the learner may re-open and re-confirm, so keep the inputs
  // live (re-selecting resets the fixation, see reopenIfCommitted in answers.js).
  if (!TEST_DATA.allowAnswerChange) {
    lockAnswerOptions(q);
  }

  // Committed accent: mark matching/ranking boards as submitted so a drag-based
  // answer is VISIBLY fixed right after «Отправить ответ» — parity with the
  // persistent `.option.selected` on single/multiple. Done point-wise because this
  // commit path updates the DOM in place (no full re-render). When showCorrectAnswers
  // is on, the green/red correctness states below win (CSS :not()).
  document.querySelectorAll('.matching-board, .ranking-board').forEach(function (b) {
    b.classList.add('is-locked');
  });

  // PRD-19 (Block B): reveal correctness + feedback only when showCorrectAnswers.
  // The explicit fixation itself works without feedback — flexible-mode
  // «Отправить ответ» with showCorrectAnswers off just commits and advances.
  if (TEST_DATA.showCorrectAnswers) {
    highlightCorrectAnswers(q, answer);
    insertFeedback(q, isCorrect, scoreRatio);
  }

  // PRD-19 (Block B): persist the 'answered' fixation immediately.
  if (typeof saveSessionState === 'function') saveSessionState();

  // Перерисовываем строку навигации: «Отправить ответ»/«Принять» → «Далее»/«Завершить».
  updateNavigationButton();
}

function lockAnswerOptions(q) {
  // кликабельные .option
  var options = document.querySelectorAll('.option');
  options.forEach(function(opt) {
    opt.style.cursor = 'default';
    opt.onclick = null;
  });

  // все инпуты
  var inputs = document.querySelectorAll('input');
  inputs.forEach(function(input) {
    input.disabled = true;
  });

  // все селекты (matching)
  var selects = document.querySelectorAll('select');
  selects.forEach(function(sel) {
    sel.disabled = true;
  });

  // ranking buttons
  var rankButtons = document.querySelectorAll('.ranking-controls button');
  rankButtons.forEach(function(btn) {
    btn.disabled = true;
  });

    // ranking DnD
  var rankItems = document.querySelectorAll('.rank-draggable');
  rankItems.forEach(function(el) {
    el.setAttribute('draggable', 'false');
    el.style.cursor = 'default';
  });

}


function highlightCorrectAnswers(q, answer) {
  var correct = q.correct || {};
  
  if (q.type === 'single') {
    var correctIndex = correct.correctIndex;
    var options = document.querySelectorAll('.option');
    options.forEach(function(opt) {
      var dataIndex = opt.getAttribute('data-index');
      if (dataIndex !== null) {
        var idx = parseInt(dataIndex, 10);
        if (idx === correctIndex) {
          opt.classList.add('correct-answer');
        } else if (idx === answer) {
          opt.classList.add('incorrect-answer');
        }
      }
    });
  }
  
  if (q.type === 'multiple') {
    var correctSet = correct.correctIndices || [];
    var selectedSet = Array.isArray(answer) ? answer : [];
    var options = document.querySelectorAll('.option');
    options.forEach(function(opt) {
      var dataIndex = opt.getAttribute('data-index');
      if (dataIndex !== null) {
        var idx = parseInt(dataIndex, 10);
        var isCorrect = correctSet.indexOf(idx) !== -1;
        var isSelected = selectedSet.indexOf(idx) !== -1;
        
        if (isCorrect) {
          opt.classList.add('correct-answer');
        } else if (isSelected && !isCorrect) {
          opt.classList.add('incorrect-answer');
        }
      }
    });
  }
  
  // MATCHING
  if (q.type === 'matching') {
    highlightMatching(q, answer);
    return;
  }

  // RANKING
  if (q.type === 'ranking') {
    highlightRanking(q, answer);
    return;
  }
}

function highlightMatching(q, answer) {
  var pairs = (answer && typeof answer === 'object') ? answer : {};
  var correctPairsArr = Array.isArray((q.correct || {}).pairs) ? q.correct.pairs : [];

  // correct: rightIdx -> leftIdx
  var correctRightToLeft = {};
  correctPairsArr.forEach(function(p) { correctRightToLeft[p.right] = p.left; });

  // user: rightIdx -> leftIdx
  var userRightToLeft = {};
  Object.keys(pairs).forEach(function(k){
    var l = parseInt(k, 10);
    var r = pairs[k];
    if (typeof r === 'number') userRightToLeft[r] = l;
  });

  document.querySelectorAll('.matching-line[data-qid="' + q.id + '"]').forEach(function(line) {
    line.classList.remove('correct-answer', 'incorrect-answer');

    var rightAttr = line.getAttribute('data-right');
    if (rightAttr === null) return;

    var rightIdx = parseInt(rightAttr, 10);
    if (Number.isNaN(rightIdx)) return;

    if (!userRightToLeft.hasOwnProperty(rightIdx)) return;

    var userLeft = userRightToLeft[rightIdx];
    var correctLeft = correctRightToLeft[rightIdx];

    if (Number(userLeft) === Number(correctLeft)) {
      line.classList.add('correct-answer');
    } else {
      line.classList.add('incorrect-answer');
    }
  });
}

function highlightRanking(q, answer) {
  var correctOrder = Array.isArray((q.correct || {}).correctOrder) ? q.correct.correctOrder : [];
  if (!correctOrder.length) return;

  var rows = document.querySelectorAll('.ranking-board[data-qid="' + q.id + '"] .rank-item');
  if (!rows || !rows.length) return;

  rows.forEach(function(row, pos) {
    row.classList.remove('correct-answer', 'incorrect-answer');

    var itemIdx = parseInt(row.getAttribute('data-item'), 10);
    if (Number.isNaN(itemIdx)) return;

    var ok = (itemIdx === correctOrder[pos]);

    if (ok) {
      row.classList.add('correct-answer');
    } else {
      row.classList.add('incorrect-answer');
    }
  });
}


function insertFeedback(q, isCorrect, scoreRatio) {
  // Проверяем что feedback ещё не вставлен
  var existing = document.querySelector('.feedback-block');
  if (existing) return;
  
  var statusColor = isCorrect ? '#16a34a' : '#dc2626';
  var statusBg = isCorrect ? '#dcfce7' : '#fee2e2';
  var statusText = isCorrect ? 'Правильно!' : (scoreRatio > 0 ? 'Частично правильно' : 'Неправильно');
  
  var feedbackText = null;
  if (q.feedbackMode === 'conditional') {
    feedbackText = isCorrect ? q.feedbackCorrect : q.feedbackIncorrect;
  } else {
    feedbackText = q.feedback;
  }
  
  var html = '<div class="feedback-block" style="margin-top:16px;padding:12px;border-radius:8px;background:' + statusBg + ';border:1px solid ' + statusColor + ';">';
  html += '<div style="font-weight:600;color:' + statusColor + ';margin-bottom:4px;">' + statusText + '</div>';
  
  if (feedbackText) {
    html += '<div style="color:#333;font-size:14px;">' + escapeHtml(feedbackText) + '</div>';
  }
  html += '</div>';

  // Prefer the template's dedicated feedback slot (question.html); fall back to
  // appending after the card (hardcoded chrome / older layouts).
  var slot = document.querySelector('[data-slot="question-feedback"]');
  if (slot) {
    slot.innerHTML = html;
    return;
  }
  var card = document.querySelector('.question-card, .card');
  if (card) {
    card.insertAdjacentHTML('beforeend', html);
  }
}

function updateNavigationButton() {
  var nav = document.querySelector('.navigation');
  if (!nav) return;

  var total = state.flatQuestions.length;
  var current = state.currentIndex;

  // PRD-19 (Block B): re-render the WHOLE nav row from buildQuestionNavHtml so a
  // two-button flexible row (Отправить ответ / Пропустить) is replaced cleanly by
  // the post-commit Далее/Завершить — a textContent swap on a single .btn would
  // leave the «Пропустить» button stranded.
  if (typeof buildQuestionNavHtml === 'function') {
    nav.outerHTML = buildQuestionNavHtml(current, total);
    return;
  }

  // Fallback (legacy chrome without buildQuestionNavHtml): point-swap the button.
  var navBtn = nav.querySelector('.btn');
  if (!navBtn) return;
  if (current < total - 1) {
    navBtn.textContent = 'Далее';
    navBtn.onclick = next;
  } else {
    navBtn.textContent = 'Завершить тест';
    navBtn.onclick = submit;
  }
}