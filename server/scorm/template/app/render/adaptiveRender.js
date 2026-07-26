// app/render/adaptiveRender.js
// Rendering for adaptive test mode

/**
 * Render adaptive question page
 */
function renderAdaptiveQuestion() {
  var app = document.getElementById('app');
  var qData = getCurrentAdaptiveQuestion();
  if (!qData) {
    renderAdaptiveResults();
    return;
  }
  ensureAdaptiveShuffleMapping(qData.question);

  var layouts = (typeof state !== 'undefined' && state) ? state.templateLayouts : null;
  var layout = layouts && layouts['question'];
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (layout && TB && TB.renderScreenInto) {
    renderAdaptiveQuestionTemplated(app, qData);
    return;
  }
  renderAdaptiveQuestionFallback(app, qData);
}

/** Seed the per-question shuffle mapping for an adaptive question (idempotent). */
function ensureAdaptiveShuffleMapping(q) {
  if (state.shuffleMappings[q.id]) return;
  if (q.type === 'single' || q.type === 'multiple') {
    var optCount = q.data.options ? q.data.options.length : 0;
    if (optCount > 0) state.shuffleMappings[q.id] = createShuffleMapping(optCount);
  } else if (q.type === 'matching') {
    var leftCount = q.data.left ? q.data.left.length : 0;
    var rightCount = q.data.right ? q.data.right.length : 0;
    if (leftCount > 0 && rightCount > 0) {
      state.shuffleMappings[q.id] = { left: createShuffleMapping(leftCount), right: createShuffleMapping(rightCount) };
    }
  } else if (q.type === 'ranking') {
    var itemCount = q.data.items ? q.data.items.length : 0;
    if (itemCount > 0) {
      // Guaranteed non-correct delivery order (see createRankingOrder).
      state.shuffleMappings[q.id] = createRankingOrder(itemCount, q.correct && q.correct.correctOrder);
      if (!state.answers[q.id]) state.answers[q.id] = state.shuffleMappings[q.id].slice();
    }
  }
}

/** Adaptive feedback block HTML (uses lastAdaptiveResult; binary, no partial credit).
 *  Emits the shared DS `.ou-banner` — same component as the standard mode. */
function buildAdaptiveFeedbackHtml(q) {
  var isCorrect = state.lastAdaptiveResult.isCorrect;
  var statusText = isCorrect ? 'Правильно!' : 'Неверно';
  var feedbackText = (q.feedbackMode === 'conditional') ? (isCorrect ? q.feedbackCorrect : q.feedbackIncorrect) : q.feedback;
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (!TB || !TB.feedbackBanner) return '';
  return TB.feedbackBanner(isCorrect ? 'success' : 'error', statusText, feedbackText ? TB.feedbackDesc(feedbackText) : '');
}

/** Adaptive navigation HTML (Принять / Далее), onclick-wired. */
function buildAdaptiveNavHtml() {
  // Gate «Принять» on a usable answer for the current adaptive question (same rule
  // as the standard flow; refreshSubmitEnabled keeps it in sync on selection).
  var aq = typeof currentAnsweringQuestion === 'function' ? currentAnsweringQuestion() : null;
  var aReady = !aq || typeof hasAnswer !== 'function' ? true : hasAnswer(aq, state.answers[aq.id]);
  var aDisabled = aReady ? '' : ' disabled';
  var html = '<div class="navigation" style="justify-content:flex-end">';
  if (TEST_DATA.showCorrectAnswers) {
    if (!state.feedbackShown) html += '<button class="ou-btn ou-btn--primary ou-btn--m" data-action="answer-submit" onclick="confirmAdaptiveAnswer()"' + aDisabled + '>Принять</button>';
    else html += '<button class="ou-btn ou-btn--primary ou-btn--m" data-nav="next" onclick="continueAfterFeedback()">Далее</button>';
  } else {
    html += '<button class="ou-btn ou-btn--primary ou-btn--m" data-nav="next" onclick="submitAdaptiveAnswerAndContinue()">Далее</button>';
  }
  html += '</div>';
  return html;
}

/** Render the adaptive question via the shared `question` layout (mirrors the standard path). */
function renderAdaptiveQuestionTemplated(app, qData) {
  var q = qData.question;
  var showFeedback = TEST_DATA.showCorrectAnswers && state.feedbackShown && state.lastAdaptiveResult;
  var counter = 'Тема: ' + qData.topicName + ' · Вопрос ' + qData.questionNumber + ' из ' + qData.totalInLevel;
  if (TEST_DATA.showDifficultyLevel && qData.levelName) counter += ' · ' + qData.levelName;
  var slots = {
    'question-text': escapeHtml(q.prompt),
    'question-media': renderQuestionMedia(q),
    'question-interaction': '<div id="question-input">' + renderQuestionInput(q) + '</div>',
    'question-feedback': showFeedback ? buildAdaptiveFeedbackHtml(q) : ''
  };
  app.innerHTML = '';
  // Mount directly into #app so .tb-pad > .layout-question-wrap fills the fixed
  // stage and the appended nav anchors — mirrors renderGalleryPage (no wrapper div).
  window.TBTemplate.renderScreenInto(app, {
    layout: (typeof systemLayout === 'function') ? systemLayout('question') : state.templateLayouts['question'],
    context: {
      course: { title: TEST_DATA.title },
      state: {
        questionCounterLabel: counter,
        questionHint: (window.TBTemplate && window.TBTemplate.questionHint) ? window.TBTemplate.questionHint(q.type) : '',
        questionFont: (window.TBTemplate && window.TBTemplate.questionFont) ? window.TBTemplate.questionFont(q.prompt) : '',
        optionFont: (window.TBTemplate && window.TBTemplate.optionFont && window.TBTemplate.answerTexts) ? window.TBTemplate.optionFont(window.TBTemplate.answerTexts({ type: q.type, dataJson: q.data })) : ''
      },
      design: (typeof scormDesignContext === 'function') ? scormDesignContext() : {}
    },
    slots: slots
  });
  var fill = app.querySelector('#q-progress-fill');
  if (fill) fill.style.width = ((qData.questionNumber / qData.totalInLevel) * 100) + '%';
  var timerEl = app.querySelector('#timer-display');
  if (timerEl && state.remainingSeconds !== null) {
    timerEl.classList.remove('q-timer--hidden');
    timerEl.textContent = formatTime(state.remainingSeconds);
    if (state.remainingSeconds <= 60) { timerEl.style.color = '#dc2626'; timerEl.style.fontWeight = 'bold'; }
  }
  var navWrap = document.createElement('div');
  navWrap.innerHTML = buildAdaptiveNavHtml();
  if (navWrap.firstChild) app.appendChild(navWrap.firstChild);
  syncMatchingHeights();
}

function renderAdaptiveQuestionFallback(app, qData) {
  var q = qData.question;

  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
  html += '<h1 style="margin:0">' + escapeHtml(TEST_DATA.title) + '</h1>';
  if (state.remainingSeconds !== null) {
    var timerClass = state.remainingSeconds <= 60 ? 'style="color:#dc2626;font-weight:bold;font-size:18px;"' : 'style="color:#666;font-size:18px;"';
    html += '<div id="timer-display" ' + timerClass + '>' + formatTime(state.remainingSeconds) + '</div>';
  }
  html += '</div>';

  // Topic and level info
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
  html += '<div style="color:#666;font-size:14px;">Тема: <span style="color:hsl(var(--foreground));font-weight:500;">' + escapeHtml(qData.topicName) + '</span></div>';
  if (TEST_DATA.showDifficultyLevel) {
    html += '<div style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;background:hsl(var(--primary));color:hsl(var(--primary-foreground));border-radius:20px;font-size:13px;font-weight:500;">';
    html += escapeHtml(qData.levelName);
    html += '</div>';
  }
  html += '</div>';

  // Progress for current level
  var progress = (qData.questionNumber / qData.totalInLevel) * 100;
  html += '<div class="progress-bar"><div class="progress-fill" style="width:' + progress + '%"></div></div>';

  // Question card
  html += '<div class="card">';
  html += '<div style="color:#666;margin-bottom:8px;">Вопрос ' + qData.questionNumber + ' из ' + qData.totalInLevel + '</div>';
  html += '<div class="question-text">' + escapeHtml(q.prompt) + '</div>';
  html += renderQuestionMedia(q);
  html += '<div id="question-input">';
  html += renderQuestionInput(q);
  html += '</div>';

  // Feedback after answer (if showCorrectAnswers and feedback is shown)
  if (TEST_DATA.showCorrectAnswers && state.feedbackShown && state.lastAdaptiveResult) {
    var isCorrect = state.lastAdaptiveResult.isCorrect;
    var statusColor = isCorrect ? '#16a34a' : '#dc2626';
    var statusText = isCorrect ? 'Правильно!' : 'Неправильно';

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

  // Navigation
  html += '<div class="navigation" style="justify-content:flex-end">';
  if (TEST_DATA.showCorrectAnswers) {
    if (!state.feedbackShown) {
      html += '<button class="ou-btn ou-btn--primary ou-btn--m" onclick="confirmAdaptiveAnswer()">Принять</button>';
    } else {
      html += '<button class="ou-btn ou-btn--primary ou-btn--m" onclick="continueAfterFeedback()">Далее</button>';
    }
  } else {
    // Без показа правильных ответов - сразу переходим (с валидацией)
    html += '<button class="ou-btn ou-btn--primary ou-btn--m" onclick="submitAdaptiveAnswerAndContinue()">Далее</button>';
  }
  html += '</div>';

  app.innerHTML = html;
  syncMatchingHeights();
}

/**
 * Confirm answer (for showCorrectAnswers mode) - shows feedback without moving to next question
 */
function confirmAdaptiveAnswer() {
  var qData = getCurrentAdaptiveQuestion();
  if (!qData) return;

  var answer = state.answers[qData.id];
  if (answer === undefined || answer === null) {
    showToast('Пожалуйста, ответьте на вопрос', 'warn');
    return;
  }

  // Validate answer completeness
  if (!validateAdaptiveAnswer(qData.question, answer)) {
    return;
  }

  // Check answer correctness but DON'T submit yet - just show feedback
  var isCorrect = checkAnswer(qData.question, answer) === 1;

  state.lastAdaptiveResult = {
    isCorrect: isCorrect,
    questionId: qData.id
  };
  state.feedbackShown = true;

  // Re-render to show feedback on CURRENT question
  renderAdaptiveQuestion();
}

/**
 * Continue after viewing feedback - now actually submit and move forward
 */
function continueAfterFeedback() {
  var qData = getCurrentAdaptiveQuestion();
  if (!qData) return;

  var answer = state.answers[qData.id];

  // Now actually submit the answer
  var result = submitAdaptiveAnswer(qData.id, answer);

  // Reset feedback state
  state.feedbackShown = false;
  state.lastAdaptiveResult = null;

  // PRD-4 v1.1 §4.7: when a single-topic adaptive session signals isFinished,
  // AdaptiveSession.maybeFinishSingleTopic already cleared state.adaptiveState
  // and invoked the caller's onComplete (returnFromTopic / contentFlow next).
  // Skip the legacy renderAdaptiveResults — adaptiveState is null and the
  // caller has already re-rendered the next phase (router page or content).
  if (result && result.singleTopicHandled) return;

  // Check for transitions - only show if showDifficultyLevel is enabled
  if (TEST_DATA.showDifficultyLevel && (result.levelTransition || result.topicTransition)) {
    state.pendingTransition = result;
    renderAdaptiveTransition(result);
  } else if (result.isFinished) {
    renderAdaptiveResults();
  } else {
    renderAdaptiveQuestion();
  }
}

/**
 * Submit answer and continue (when showCorrectAnswers is OFF)
 */
function submitAdaptiveAnswerAndContinue() {
  var qData = getCurrentAdaptiveQuestion();
  if (!qData) return;

  var answer = state.answers[qData.id];
  if (answer === undefined || answer === null) {
    showToast('Пожалуйста, ответьте на вопрос', 'warn');
    return;
  }

  // Validate answer completeness
  if (!validateAdaptiveAnswer(qData.question, answer)) {
    return;
  }

  var result = submitAdaptiveAnswer(qData.id, answer);

  // PRD-4 v1.1 §4.7: single-topic session done — callback already handled
  // the next phase, don't render adaptive results (state.adaptiveState is
  // null by now).
  if (result && result.singleTopicHandled) return;

  // Check for transitions - only show if showDifficultyLevel is enabled
  if (TEST_DATA.showDifficultyLevel && (result.levelTransition || result.topicTransition)) {
    state.pendingTransition = result;
    renderAdaptiveTransition(result);
  } else if (result.isFinished) {
    renderAdaptiveResults();
  } else {
    renderAdaptiveQuestion();
  }
}

/**
 * Validate answer completeness
 */
function validateAdaptiveAnswer(question, answer) {
  if (question.type === 'multiple' && Array.isArray(answer) && answer.length === 0) {
    showToast('Выберите хотя бы один вариант', 'warn');
    return false;
  }

  if (question.type === 'matching') {
    var leftItems = question.data.left || [];
    var pairs = answer || {};
    for (var i = 0; i < leftItems.length; i++) {
      if (pairs[i] === undefined || pairs[i] === null) {
        showToast('Сопоставьте все элементы', 'warn');
        return false;
      }
    }
  }

  return true;
}

/**
 * Render transition screen between levels/topics
 */
function renderAdaptiveTransition(result) {
  var app = document.getElementById('app');
  var layouts = (typeof state !== 'undefined' && state) ? state.templateLayouts : null;
  var layout = layouts && layouts['system.transition'];
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (layout && TB && TB.renderScreenInto && TB.buildTransitionContext) {
    renderAdaptiveTransitionTemplated(app, result);
  } else {
    renderAdaptiveTransitionFallback(app, result);
  }
  // Auto-continue after delay (both paths).
  setTimeout(function () {
    if (state.pendingTransition) continueAfterTransition();
  }, 2500);
}

/** Render the transition via the shared `system.transition` layout. */
function renderAdaptiveTransitionTemplated(app, result) {
  // Plan 6.2: a level-change screen for the CURRENT topic — not a verdict, not a topic
  // move. Name the topic the level is determined for.
  var qd = (typeof getCurrentAdaptiveQuestion === 'function') ? getCurrentAdaptiveQuestion() : null;
  var ctx = window.TBTemplate.buildTransitionContext({
    topicName: (result && result.topicName) || (qd && qd.topicName) || '',
    levelTransition: result.levelTransition || null,
    showContinue: true
  });
  app.innerHTML = '';
  // Mount directly into #app so .tb-pad > .transition-page fills the fixed stage —
  // mirrors renderGalleryPage (no wrapper div).
  window.TBTemplate.renderScreenInto(app, { layout: state.templateLayouts['system.transition'], context: ctx });
  var cont = app.querySelector('[data-action="continue"]');
  if (cont) cont.onclick = continueAfterTransition;
}

function renderAdaptiveTransitionFallback(app, result) {
  var isCorrect = result.isCorrect;
  var transition = result.levelTransition;
  var topicTransition = result.topicTransition;

  var html = '<div style="max-width:500px;margin:80px auto;text-align:center;">';

  // Icon
  if (isCorrect) {
    html += '<div style="width:80px;height:80px;margin:0 auto 24px;background:#166534;border-radius:50%;display:flex;align-items:center;justify-content:center;">';
    html += '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>';
    html += '</div>';
  } else {
    html += '<div style="width:80px;height:80px;margin:0 auto 24px;background:#991b1b;border-radius:50%;display:flex;align-items:center;justify-content:center;">';
    html += '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" stroke-width="2.5"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>';
    html += '</div>';
  }

  html += '<h2 style="margin:0 0 24px;font-size:28px;color:#fff;">' + (isCorrect ? 'Правильно!' : 'Неправильно') + '</h2>';

  // Level transition message
  if (transition) {
    var bgColor, borderColor, textColor, iconSvg;
    if (transition.type === 'up') {
      bgColor = '#166534';
      borderColor = '#22c55e';
      textColor = '#bbf7d0';
      iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    } else if (transition.type === 'down') {
      bgColor = '#991b1b';
      borderColor = '#ef4444';
      textColor = '#fecaca';
      iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
    } else {
      // complete
      bgColor = '#1e40af';
      borderColor = '#3b82f6';
      textColor = '#bfdbfe';
      iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';
    }

    html += '<div style="padding:20px 24px;background:' + bgColor + ';border:2px solid ' + borderColor + ';border-radius:16px;margin-bottom:20px;">';
    html += '<div style="display:flex;align-items:center;justify-content:center;gap:12px;">';
    html += iconSvg;
    html += '<span style="font-size:18px;font-weight:500;color:' + textColor + ';">' + escapeHtml(transition.message) + '</span>';
    html += '</div>';
    html += '</div>';
  }

  // Topic transition message
  if (topicTransition) {
    html += '<p style="color:#9ca3af;font-size:16px;margin-top:16px;">Переход к теме: <strong style="color:#fff;">' + escapeHtml(topicTransition.toTopic) + '</strong></p>';
  }

  html += '<button class="ou-btn ou-btn--primary ou-btn--m" onclick="continueAfterTransition()" style="margin-top:32px;padding:14px 40px;font-size:16px;">Продолжить</button>';
  html += '</div>';

  app.innerHTML = html;
}

/**
 * Continue after transition screen
 */
function continueAfterTransition() {
  state.pendingTransition = null;

  if (state.adaptiveState.isFinished) {
    renderAdaptiveResults();
  } else {
    renderAdaptiveQuestion();
  }
}

/**
 * Render adaptive test results. Primary path renders the shared `results.adaptive`
 * layout via the SHARED renderer (the SAME layout the web host mounts) from a public
 * context matching the web's buildAdaptiveResultContext (per-topic level pill +
 * feedback + links); the SCORM-richer actions (Скачать PDF / Пройти заново /
 * Завершить) are gated layout blocks the web context does not set. Falls back to
 * the bespoke chrome when the design template is absent.
 */
function renderAdaptiveResults() {
  var app = document.getElementById('app');
  var result = state.adaptiveState.result;
  if (!result) {
    result = buildAdaptiveResult();
    state.adaptiveState.result = result;
  }

  var layouts = (typeof state !== 'undefined' && state) ? state.templateLayouts : null;
  var layout = layouts && layouts['results.adaptive'];
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (layout && TB && TB.renderScreenInto) {
    renderAdaptiveResultsTemplated(app, result);
    return;
  }
  renderAdaptiveResultsFallback(app, result);
}

/**
 * Build the adaptive results context via the SHARED builder
 * (TBTemplate.buildAdaptiveResultContext) and mount the shared layout. SCORM adapts
 * its runtime result into the normalized input; the SCORM action flags (PDF / retry
 * / finish — gated layout blocks the web omits) go through opts.
 */
function renderAdaptiveResultsTemplated(app, result) {
  var hasLimit = !!TEST_DATA.maxAttempts;
  var canRetry = hasAttemptsLeft();
  var input = {
    passed: !!result.overallPassed,
    topicResults: (result.topicResults || []).map(function (tr) {
      return {
        topicName: tr.topicName,
        achievedLevelIndex: (tr.achievedLevelIndex === undefined ? null : tr.achievedLevelIndex),
        achievedLevelName: tr.achievedLevelName,
        // Unified per-topic feedback (plan 6.1): courses (was recommendedLinks) + events.
        feedback: tr.feedback,
        recommendedCourses: tr.recommendedCourses || tr.recommendedLinks || [],
        recommendedEvents: tr.recommendedEvents || []
      };
    })
  };
  var ctx = window.TBTemplate.buildAdaptiveResultContext(input, TEST_DATA.title || '', {
    hasScormActions: true,
    showPdf: true,
    canRetry: (!hasLimit) || canRetry,
    showFinish: (!hasLimit) || (!canRetry)
  });
  app.innerHTML = '';
  // Mount directly into #app so .tb-pad > .results-page fills the fixed stage —
  // mirrors renderGalleryPage (no wrapper div).
  window.TBTemplate.renderScreenInto(app, { layout: state.templateLayouts['results.adaptive'], context: ctx });
  var pdf = app.querySelector('[data-action="download-pdf"]');
  if (pdf) pdf.onclick = function () { if (typeof downloadPDF === 'function') downloadPDF(); };
  var retry = app.querySelector('[data-action="restart-adaptive"]');
  if (retry) retry.onclick = restartAdaptive;
  var finish = app.querySelector('[data-action="finish"]');
  if (finish) finish.onclick = finishAndClose;
}

function renderAdaptiveResultsFallback(app, result) {
  var html = '<div class="results-page">';

  // Hero section
  html += '<div class="results-hero">';
  html += '<div class="results-hero-icon" style="background:#1e40af;border-color:#3b82f6;">';
  html += '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><path d="M9 12l2 2 4-4"/><path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9-9-1.8-9-9 1.8-9 9-9z"/></svg>';
  html += '</div>';
  html += '<div class="results-hero-title">Результаты теста</div>';
  html += '<div class="results-hero-sub">' + escapeHtml(TEST_DATA.title) + '</div>';
  html += '</div>';

  // Topic results
  html += '<div class="results-section-title">Результаты по темам</div>';
  var topicCount = result.topicResults.length;
  var gridStyle = 'display:grid;gap:16px;';
  if (topicCount === 1) {
    gridStyle += 'grid-template-columns:1fr;';
  } else if (topicCount === 2) {
    gridStyle += 'grid-template-columns:repeat(2,1fr);';
  } else {
    gridStyle += 'grid-template-columns:repeat(3,1fr);';
  }
  gridStyle += 'max-width:100%;';
  html += '<div style="' + gridStyle + '" class="results-topics-adaptive">';

  result.topicResults.forEach(function (tr) {
    var achieved = tr.achievedLevelIndex !== null;

    html += '<div class="card topic-card">';

    // Topic header (без иконки)
    html += '<div class="topic-head">';
    html += '<div class="topic-name" style="font-weight:600;font-size:16px;">' + escapeHtml(tr.topicName) + '</div>';

    // Achieved level badge (нейтральный стиль)
    if (achieved) {
      html += '<div class="results-pill" style="background:#1e40af;color:#bfdbfe;font-size:15px;padding:6px 16px;">' + escapeHtml(tr.achievedLevelName) + '</div>';
    } else {
      html += '<div class="results-pill" style="background:#374151;color:#9ca3af;font-size:15px;padding:6px 16px;">Не достигнут</div>';
    }
    html += '</div>';

    // // Stats
    // html += '<div class="topic-row">';
    // html += '<div class="k">Вопросов</div>';
    // html += '<div class="val">' + tr.totalQuestionsAnswered + '</div>';
    // html += '</div>';

    // html += '<div class="topic-row">';
    // html += '<div class="k">Правильных</div>';
    // html += '<div class="val">' + tr.totalCorrect + ' (' + Math.round(tr.levelPercent) + '%)</div>';
    // html += '</div>';

    // Feedback
    if (tr.feedback) {
      html += '<div style="margin-top:12px;padding:10px;background:hsl(var(--muted));border-radius:8px;font-size:13px;color:hsl(var(--muted-foreground));">';
      html += escapeHtml(tr.feedback);
      html += '</div>';
    }

    // Recommended links
    if (tr.recommendedLinks && tr.recommendedLinks.length > 0) {
      html += '<div style="margin-top:12px;">';
      html += '<div style="font-size:12px;color:hsl(var(--muted-foreground));margin-bottom:6px;">Рекомендуемые материалы:</div>';
      tr.recommendedLinks.forEach(function (link) {
        html += '<a href="' + escapeHtml(link.url) + '" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:6px;padding:8px;background:hsl(var(--muted)/.5);border-radius:6px;margin-top:4px;text-decoration:none;color:hsl(var(--primary));font-size:13px;">';
        html += '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>';
        html += escapeHtml(link.title);
        html += '</a>';
      });
      html += '</div>';
    }

    html += '</div>';
  });

  html += '</div>';

  // Actions
  html += '<div class="results-actions">';
  html += '<button class="ou-btn ou-btn--ghost ou-btn--m" onclick="downloadPDF()">📄 Скачать PDF</button>';

  var hasLimit = !!TEST_DATA.maxAttempts;
  var canRetry = hasAttemptsLeft();

  if (!hasLimit) {
    // Нет лимита - обе кнопки
    html += '<button class="ou-btn ou-btn--ghost ou-btn--m" onclick="restartAdaptive()">Пройти заново</button>';
    html += '<button class="ou-btn ou-btn--primary ou-btn--m" onclick="finishAndClose()">Завершить тест</button>';
  } else if (canRetry) {
    // Есть лимит и есть попытки - только "Пройти заново"
    html += '<button class="ou-btn ou-btn--primary ou-btn--m" onclick="restartAdaptive()">Пройти заново</button>';
  } else {
    // Попытки исчерпаны - только "Завершить"
    html += '<button class="ou-btn ou-btn--primary ou-btn--m" onclick="finishAndClose()">Завершить тест</button>';
  }
  html += '</div>';

  app.innerHTML = html;
}

// Restart adaptive test
function restartAdaptive() {
  if (!hasAttemptsLeft()) {
    showToast('Попытки закончились', 'warn');
    return;
  }

  // Сохраняем текущую попытку если ещё не сохранена
  if (state.adaptiveState && state.adaptiveState.result) {
    var results = getAdaptiveResultForScorm();
    results.achievedLevels = state.adaptiveState.result.topicResults.map(function (tr) {
      return {
        topicId: tr.topicId,
        topicName: tr.topicName,
        levelIndex: tr.achievedLevelIndex,
        levelName: tr.achievedLevelName
      };
    });

    // Телеметрия finish для текущей попытки
    Telemetry.finish(results);
  }

  // Сброс adaptive state
  state.adaptiveState = null;
  state.answers = {};

  // Новая попытка в телеметрии
  Telemetry.startNewAttempt();

  // Регистрация попытки в SCORM
  registerAttemptStart();

  // Переинициализация адаптивного теста
  initAdaptiveTest();

  // Запуск
  state.phase = 'question';
  render();
}

window.restartAdaptive = restartAdaptive;