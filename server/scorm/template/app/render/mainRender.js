function render() {
    // Check for adaptive mode
    if (TEST_DATA.mode === 'adaptive' && state.adaptiveState) {
      renderAdaptive();
      return;
    }
    
    // Standard mode rendering
    if (state.phase === 'start') {
        renderStartPage();
        return;
    }

    if (state.phase === 'viewResults') {
        renderViewResults();
        return;
    }

    if (state.phase === 'postResults') {
        renderPostResults();
        return;
    }

    if (state.phase === 'content' || state.phase === 'router') {
        var item = typeof currentPageItem === 'function' ? currentPageItem() : null;
        var manifest = state.templateManifest || {};
        if (item && item.kind === 'content') {
            // PRD-4 v1.1 §4.7: router pages get a topic-card overlay on top
            // of the standard renderContentPage output (handled by
            // RouterFlow.renderRouterPage). Falls back to plain content
            // rendering when RouterFlow is unavailable.
            if (item.isRouter && typeof RouterFlow !== 'undefined') {
                RouterFlow.renderRouterPage(item.page);
                return;
            }
            renderContentPage(item.page, manifest.contentTemplates || []);
            return;
        }
    }

    var app = document.getElementById('app');
    var total = state.flatQuestions.length;
    var current = state.currentIndex;

    if (current >= total) {
        renderResults();
        return;
    }

    var qData = state.flatQuestions[current];
    var q = qData.question;
    var progress = ((current + 1) / total) * 100;

    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    html += '<h1 style="margin:0">' + escapeHtml(TEST_DATA.title) + '</h1>';
    if (state.remainingSeconds !== null) {
        var timerClass = state.remainingSeconds <= 60 ? 'style="color:#dc2626;font-weight:bold;font-size:18px;"' : 'style="color:#666;font-size:18px;"';
        html += '<div id="timer-display" ' + timerClass + '>' + formatTime(state.remainingSeconds) + '</div>';
    }
    html += '</div>';
    var progressMode = typeof getProgressMode === 'function' ? getProgressMode() : 'questions';
    if (progressMode !== 'hidden') {
        var progressValue = progressMode === 'pages' && typeof pageProgressPercent === 'function'
            ? pageProgressPercent()
            : progress;
        html += '<div class="progress-bar"><div class="progress-fill" style="width:' + progressValue + '%"></div></div>';
    }
    html += '<div class="card">';
    html += '<div style="color:#666;margin-bottom:8px;">Вопрос ' + (current + 1) + ' из ' + total + ' | ' + escapeHtml(qData.topicName) + '</div>';
    html += '<div class="question-text">' + escapeHtml(q.prompt) + '</div>';
    html += renderQuestionMedia(q);
    html += '<div id="question-input">';
    html += renderQuestionInput(q);
    html += '</div>';


    if (TEST_DATA.showCorrectAnswers && state.feedbackShown) {
        var answer = state.answers[q.id];
        var scoreRatio = checkAnswer(q, answer);
        var isCorrect = scoreRatio === 1;
        var statusColor = isCorrect ? '#16a34a' : '#dc2626';
        var statusText = isCorrect ? 'Правильно!' : (scoreRatio > 0 ? 'Частично правильно' : 'Неправильно');

        html += '<div style="margin-top:16px;padding:12px;border-radius:8px;background:' + (isCorrect ? '#dcfce7' : '#fee2e2') + ';border:1px solid ' + statusColor + ';">';
        html += '<div style="font-weight:600;color:' + statusColor + ';margin-bottom:4px;">' + statusText + '</div>';

        var feedbackText = null;
        if (q.feedbackMode === 'conditional') {
            feedbackText = isCorrect ? q.feedbackCorrect : q.feedbackIncorrect;
        } else {
            feedbackText = q.feedback;
        }

        if (feedbackText) {
            html += '<div style="color:#333;font-size:14px;">' + escapeHtml(feedbackText) + '</div>';
        }
        html += '</div>';
    }

    html += '</div>';
    html += '<div class="navigation" style="justify-content:flex-end">';

    if (TEST_DATA.showCorrectAnswers && !state.feedbackShown) {
        html += '<button class="btn" data-action="answer-submit" onclick="confirmAnswer()">Принять</button>';
    } else if (current < total - 1 || (state.pageSequence && state.currentPageIndex < state.pageSequence.length - 1)) {
        html += '<button class="btn" data-nav="next" onclick="next()">Далее</button>';
    } else {
        html += '<button class="btn" data-action="test-finish" onclick="submit()">Завершить тест</button>';
    }
    html += '</div>';

    app.innerHTML = html;
    syncMatchingHeights();
}

/**
 * Render adaptive mode
 */
function renderAdaptive() {
  if (state.phase === 'start') {
    renderStartPage();
    return;
  }

  if (state.phase === 'viewResults') {
    renderViewResults();
    return;
  }

  if (state.adaptiveState.isFinished) {
    renderAdaptiveResults();
    return;
  }

  renderAdaptiveQuestion();
}

function rerenderCurrentQuestionInput() {
  var q = null;
  
  // Check if adaptive mode
  if (TEST_DATA.mode === 'adaptive' && state.adaptiveState) {
    var qData = getCurrentAdaptiveQuestion();
    if (qData) {
      q = qData.question;
    }
  } else {
    // Standard mode
    var fq = state.flatQuestions[state.currentIndex];
    if (fq) {
      q = fq.question;
    }
  }
  
  if (!q) return;

  var container = document.getElementById('question-input');
  if (!container) return;

  container.innerHTML = renderQuestionInput(q);
  syncMatchingHeights();
}

function burgerSvgInline() {
    return ''
        + '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
        + '<path d="M2.5 4.99524H17.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>'
        + '<path d="M14.1667 9.9952H2.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>'
        + '<path d="M2.5 14.9951H10.8333" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>'
        + '</svg>';
}
