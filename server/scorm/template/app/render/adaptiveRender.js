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
  // Mount directly into #app so .tb-pad > .tb-scene fills the fixed
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
// Dead last-resort safety net: reached only if neither the active template nor the
// bundled standard template supplies this layout — the package always bundles the
// standard scene layout as the fallback, so it never fires. Renders a
// minimal, stylesheet-independent notice instead of a competing hardcoded design
// (the standard scene IS the fallback; PRD-12).
  var el = app || document.getElementById('app');
  if (el) el.innerHTML = '<div style="padding:24px;font:16px/1.5 system-ui,sans-serif">Экран вопроса недоступен: шаблон не предоставил макет.</div>';
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
  // Shared header (course.title + subtitle) + branding, like every learner screen.
  ctx.course = { title: TEST_DATA.title, subtitle: (typeof scormCourseSubtitle === 'function') ? scormCourseSubtitle() : '' };
  ctx.design = (typeof scormDesignContext === 'function') ? scormDesignContext() : {};
  app.innerHTML = '';
  // Mount directly into #app so .tb-pad > .transition-page fills the fixed stage —
  // mirrors renderGalleryPage (no wrapper div).
  window.TBTemplate.renderScreenInto(app, { layout: state.templateLayouts['system.transition'], context: ctx });
  var cont = app.querySelector('[data-action="continue"]');
  if (cont) cont.onclick = continueAfterTransition;
}

function renderAdaptiveTransitionFallback(app, result) {
// Dead last-resort safety net: reached only if neither the active template nor the
// bundled standard template supplies this layout — the package always bundles the
// standard scene layout as the fallback, so it never fires. Renders a
// minimal, stylesheet-independent notice instead of a competing hardcoded design
// (the standard scene IS the fallback; PRD-12).
  var el = app || document.getElementById('app');
  if (el) el.innerHTML = '<div style="padding:24px;font:16px/1.5 system-ui,sans-serif">Экран перехода недоступен: шаблон не предоставил макет.</div>';
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
  // Header subtitle «Попытка N из M» — same builder as every learner screen (parity).
  if (typeof scormCourseSubtitle === 'function') ctx.course.subtitle = scormCourseSubtitle();
  // Per-test branding so the shared header logo renders here too.
  ctx.design = (typeof scormDesignContext === 'function') ? scormDesignContext() : {};
  app.innerHTML = '';
  // Mount directly into #app so .tb-pad > .tb-scene fills the fixed stage —
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
// Dead last-resort safety net: reached only if neither the active template nor the
// bundled standard template supplies this layout — the package always bundles the
// standard scene layout as the fallback, so it never fires. Renders a
// minimal, stylesheet-independent notice instead of a competing hardcoded design
// (the standard scene IS the fallback; PRD-12).
  var el = app || document.getElementById('app');
  if (el) el.innerHTML = '<div style="padding:24px;font:16px/1.5 system-ui,sans-serif">Экран результатов недоступен: шаблон не предоставил макет.</div>';
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