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

  reportAnswerTelemetry(fq, answer);

  // Re-render the input from the SHARED emission so the locked state and (when
  // showCorrectAnswers) the correct/incorrect highlight are painted on the `.ou-*`
  // markup — the render reads the committed status (isAnswerLocked) + review key.
  // This replaces the legacy point-wise class mutation on `.option`/`.rank-item`/
  // `.matching-line`, which no longer exist. Interaction is guarded by the delegated
  // handlers (isAnswerLocked), so a locked answer ignores clicks even with data-action.
  if (typeof rerenderCurrentQuestionInput === 'function') rerenderCurrentQuestionInput();

  // PRD-19 (Block B): reveal the feedback text only when showCorrectAnswers. The
  // explicit fixation itself works without feedback — flexible-mode «Отправить ответ»
  // with showCorrectAnswers off just commits and advances.
  if (TEST_DATA.showCorrectAnswers) {
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
  // Already inserted? The DS banner keeps `feedback-block` as its marker class so
  // this dedup hook (and any teardown that clears `.feedback-block`) still matches.
  if (document.querySelector('.feedback-block')) return;

  // Verdict → DS banner tone (revision «Стандартный»: the answer-check feedback is
  // the shared `.ou-banner`, not inline-styled chrome). Partial credit reads as a
  // warning, a full miss as an error.
  var tone = isCorrect ? 'success' : (scoreRatio > 0 ? 'warning' : 'error');
  var statusText = isCorrect ? 'Правильно!' : (scoreRatio > 0 ? 'Частично правильно' : 'Неверно');

  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (!TB || !TB.feedbackBanner) return;
  // issue #34: ветку общего/условного режима выбирает ОБЩЕЕ правило — веб-хост
  // зовёт его же, поэтому четвёртой копии не появится.
  var feedbackText = TB.feedbackTextFor(q, isCorrect);
  var html = TB.feedbackBanner(tone, statusText, feedbackText ? TB.feedbackDesc(feedbackText) : '');

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
  // The revised «Стандартный» question nav row IS the scene footer
  // (buildQuestionNavHtml → `.tb-scene__foot`); `.navigation` is only the legacy
  // fallback chrome. Without this the post-commit «Отправить ответ»/«Принять» →
  // «Далее» swap silently no-oped and the learner was stuck with no forward button.
  var nav = document.querySelector('.tb-scene__foot') || document.querySelector('.navigation');
  if (!nav) return;

  var total = state.flatQuestions.length;
  var current = state.currentIndex;

  // PRD-19 (Block B): re-render the WHOLE nav row from buildQuestionNavHtml so a
  // two-button flexible row (Отправить ответ / Пропустить) is replaced cleanly by
  // the post-commit Далее/Завершить — a textContent swap on a single .btn would
  // leave the «Пропустить» button stranded.
  if (typeof render === 'function') {
    render();
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

/**
 * Строка ответа в телеметрию — ОДНА на выданный вопрос оцениваемой попытки (PA-12f BRD
 * психометрики).
 *
 * Раньше её слал только `confirmAnswer`. Но ответ фиксирует и «Далее» в строгом режиме с
 * быстрым переходом (PRD-43), где кнопки «Отправить ответ» нет вовсе, — у таких тестов
 * телеметрия не получала НИ ОДНОГО ответа. А пропуск и неотвеченный вопрос не фиксируются
 * никогда, и строки по ним не было: сервер не видел ноль, который этот же вопрос приносит в
 * балл и в отчёт LMS (`finishScormLmsOnly` пишет его `incorrect`). Трудность по телеметрии
 * из-за этого расходилась с вебом и с импортом на долю пропусков.
 *
 * Поэтому отправка вынесена сюда и зовётся из каждой точки фиксации, а пропущенное досылает
 * {@link reportPendingAnswerTelemetry} при завершении.
 *
 * @param {object} fq элемент `state.flatQuestions` — вопрос с темой
 * @param {*} answer ответ, который засчитан
 */
function reportAnswerTelemetry(fq, answer) {
  if (typeof Telemetry === 'undefined' || !fq || !fq.question) return;
  var q = fq.question;
  var scoreRatio = checkAnswer(q, answer);
  var isCorrect = scoreRatio === 1;

  // Подготавливаем данные о вариантах ответов
  var answerOptions = null;
  var leftItems = null;
  var rightItems = null;
  var rankingItems = null;

  // A scale carries its graduations in the same `options` list, so telemetry reports
  // its answer texts through this branch too (TBQType.hasOptionList).
  if (typeof TBQType !== 'undefined' ? TBQType.hasOptionList(q.type) : (q.type === 'single' || q.type === 'multiple')) {
    answerOptions = q.data && q.data.options ? q.data.options : null;
  } else if (q.type === 'matching') {
    leftItems = q.data && q.data.left ? q.data.left : null;
    rightItems = q.data && q.data.right ? q.data.right : null;
  } else if (q.type === 'ranking') {
    rankingItems = q.data && q.data.items ? q.data.items : null;
  }

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
    items: rankingItems,
    // Время на задании — сумма заходов, тот же источник, что и у `latency` в LMS.
    latencyMs: (typeof TBQuestionTime !== 'undefined') ? TBQuestionTime.totalMsFor(q.id) : null
  });
}

/**
 * Дослать в телеметрию вопросы, ответ на которые так и не был зафиксирован.
 *
 * Зовётся перед `Telemetry.finish` стандартной попытки. Берёт ровно то, что уходит в отчёт LMS
 * (`gradedAnswerFor`): пропуск и неотвеченный — пустой ответ, оценённый нулём; черновик
 * строгого режима — засчитанный черновик. Зафиксированные (`answered`) уже отправлены в момент
 * фиксации и повторно не уходят — иначе одна выдача дала бы два наблюдения.
 *
 * Измерительный вопрос без ответа не досылается: ответа нет, и шкале сообщить нечего.
 */
function reportPendingAnswerTelemetry() {
  if (typeof Telemetry === 'undefined' || !state.flatQuestions) return;
  // Адаптивный прогон выдаёт вопросы уровня по ходу и шлёт ответ на каждом шаге: «выдано, но
  // не отвечено» у него значит «уровень до вопроса не дошёл», и ноль тут был бы выдумкой.
  if (TEST_DATA.mode === 'adaptive') return;
  var statuses = state.questionStatuses || {};
  state.flatQuestions.forEach(function (fq) {
    var q = fq && fq.question;
    if (!q || statuses[q.id] === 'answered') return;
    var answer = typeof gradedAnswerFor === 'function' ? gradedAnswerFor(q) : state.answers[q.id];
    var measurementOnly = typeof TBQType !== 'undefined' && TBQType.isMeasurementOnly(q);
    if (measurementOnly && answer === undefined) return;
    reportAnswerTelemetry(fq, answer);
  });
}
