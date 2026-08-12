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
  // Same seam as the standard mode (see shuffleMappingFor): honours the
  // question's «Случайный порядок вариантов» switch, always shuffles ranking.
  var mapping = shuffleMappingFor(q);
  if (!mapping) return;
  state.shuffleMappings[q.id] = mapping;
  if (q.type === 'ranking' && !state.answers[q.id]) state.answers[q.id] = mapping.slice();
}

/** Adaptive feedback block HTML (uses lastAdaptiveResult; binary, no partial credit).
 *  Emits the shared DS `.ou-banner` — same component as the standard mode. */
function buildAdaptiveFeedbackHtml(q) {
  var isCorrect = state.lastAdaptiveResult.isCorrect;
  var statusText = isCorrect ? 'Правильно!' : 'Неверно';
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (!TB || !TB.feedbackBanner) return '';
  // issue #34: общий/условный режим разбирает ОБЩЕЕ правило (см. feedback.js).
  var feedbackText = TB.feedbackTextFor(q, isCorrect);
  return TB.feedbackBanner(isCorrect ? 'success' : 'error', statusText, feedbackText ? TB.feedbackDesc(feedbackText) : '');
}

/**
 * Navigation STATE of the adaptive question (`state.nav`) — the row itself comes
 * from the template's `question.html` footer, exactly as in the standard mode
 * (buildQuestionNavState). Adaptive is strictly sequential, so the row is the
 * strict-linear one: no «Назад» / «Пропустить» / «К обзору», and the next step is
 * always unknown to the client — hence `hasNext: true` (never «Завершить тест»,
 * the server decides when the session ends).
 *
 * @returns {Object|null} The `state.nav` block, or null when the shared builder
 *   is unavailable (the layout then prints no usable row and the caller falls back).
 */
function buildAdaptiveNavState() {
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (!TB || !TB.buildQuestionNav) return null;
  // Gate «Принять»/«Далее» on a usable answer for the current adaptive question
  // (same rule as the standard flow; refreshSubmitEnabled keeps it in sync).
  var aq = typeof currentAnsweringQuestion === 'function' ? currentAnsweringQuestion() : null;
  var aReady = (!aq || typeof hasAnswer !== 'function') ? true : hasAnswer(aq, state.answers[aq.id]);
  return TB.buildQuestionNav({
    flexible: false,
    committed: !!state.feedbackShown,
    canPrev: false,
    // After the feedback is shown the answer is fixed — «Далее» is always available.
    answerReady: state.feedbackShown ? true : aReady,
    hasNext: true,
    showAccept: !!TEST_DATA.showCorrectAnswers && !state.feedbackShown,
    showReview: false
  });
}

/**
 * Binds the adaptive question footer (the layout's `.tb-scene__foot`) to the
 * adaptive handlers. The standard `wireQuestionNav` cannot be reused: its
 * `answer-submit`/`answer-next` point at the standard flow's confirmAnswer/next.
 *
 * @param {Element} row The `.tb-scene__foot` element just mounted.
 */
function wireAdaptiveNav(row) {
  if (!row) return;
  var handlers = {
    // «Принять» — fix the answer and show the feedback (showCorrectAnswers only).
    'answer-submit': confirmAdaptiveAnswer,
    // «Далее» — either continue past the shown feedback, or submit and advance.
    'answer-next': function () {
      if (TEST_DATA.showCorrectAnswers && state.feedbackShown) continueAfterFeedback();
      else submitAdaptiveAnswerAndContinue();
    }
  };
  row.querySelectorAll('button').forEach(function (btn) {
    var handler = handlers[btn.getAttribute('data-action')];
    if (handler) btn.addEventListener('click', handler);
  });
}

/** Render the adaptive question via the shared `question` layout (mirrors the standard path). */
function renderAdaptiveQuestionTemplated(app, qData) {
  var q = qData.question;
  var showFeedback = TEST_DATA.showCorrectAnswers && state.feedbackShown && state.lastAdaptiveResult;
  var counter = 'Тема: ' + qData.topicName + ' · Вопрос ' + qData.questionNumber + ' из ' + qData.totalInLevel;
  if (TEST_DATA.showDifficultyLevel && qData.levelName) counter += ' · ' + qData.levelName;
  var slots = {
    'question-text': authorTextHtml(q.prompt),
    'question-media': renderQuestionMedia(q),
    'question-interaction': '<div id="question-input">' + renderQuestionInput(q) + '</div>',
    'question-feedback': showFeedback ? buildAdaptiveFeedbackHtml(q) : ''
  };
  app.innerHTML = '';
  // Mount directly into #app so .tb-pad > .tb-scene fills the fixed
  // stage and the footer anchors at its bottom — mirrors renderGalleryPage (no wrapper div).
  window.TBTemplate.renderScreenInto(app, {
    protection: buildScormProtection('question'),
    layout: (typeof systemLayout === 'function') ? systemLayout('question') : state.templateLayouts['question'],
    context: {
      course: { title: TEST_DATA.title },
      state: {
        questionCounterLabel: counter,
        // The nav row comes from the LAYOUT (`.tb-scene__foot`), like the standard
        // mode's — the runtime no longer appends a footer of its own next to the
        // scene, where neither the scene surface nor the DS palette reach it.
        nav: buildAdaptiveNavState(),
        questionHint: (window.TBTemplate && window.TBTemplate.questionHint) ? window.TBTemplate.questionHint(q.type, { type: q.type, dataJson: q.data }) : '',
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
  wireAdaptiveNav(app.querySelector('.tb-scene__foot'));
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

  // PRD-44 FR-31: распределение готово, только когда сумма ровно равна бюджету.
  // Адаптивный поток идёт своей проверкой, поэтому без этой ветки он пускал бы
  // дальше с недобором — там, где обычный поток не пускает.
  if (typeof TBQType !== 'undefined' && TBQType.distributesBudget(question.type)) {
    var TBv = (typeof window !== 'undefined') ? window.TBTemplate : null;
    if (TBv && TBv.isAllocationComplete && !TBv.isAllocationComplete(TBv.allocationSpec(question.data), answer)) {
      showToast('Распределите все баллы', 'warn');
      return false;
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
  // Shared header (course.title) + branding, like every learner screen. No «Попытка N»
  // in-run: without telemetry the package cannot know the number and would print «1».
  ctx.course = { title: TEST_DATA.title };
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
  // PRD-31 barrier B: a closed interval between attempts withdraws the retry here
  // too, so the adaptive results screen cannot offer a run the start would refuse.
  var intervalOpen = (typeof attemptIntervalState !== 'function') || attemptIntervalState().allowed;
  var canRetry = hasAttemptsLeft() && intervalOpen;
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
        recommendedEvents: tr.recommendedEvents || [],
        // Feedback texts and PRD-32 attachments of the topic and of this test's section
        // over it, for the ONE recommendations block. The very readers the standard
        // results screens use (viewResults.js) — the package bundles both files flat, so
        // reusing them is what keeps the two modes reading the same baked section. Handed
        // over for EVERY topic; the shared builder is what gates them by the topic's
        // verdict (in this mode: whether any level was confirmed).
        feedbackTexts: vrTopicFeedbackTexts(tr),
        recommendedAssets: vrTopicAssets(tr)
      };
    })
  };
  // PRD-29 / issue #33: scales and indicators of THIS run, through the SAME assembler the
  // standard results screen goes through (`currentAttemptMeasures`, viewResults.js — the
  // runtime is concatenated flat, so it is in scope). It wants the result in the STANDARD
  // shape, which is what `getAdaptiveResultForScorm` restates the level ladder into; the
  // computation is deterministic, so the values it produces here are the ones
  // `finishAndClose` later persists and ships to the LMS. Null for a test that declares
  // no scales and no indicators — the context then stays exactly as it was.
  var flatResult = (typeof getAdaptiveResultForScorm === 'function') ? getAdaptiveResultForScorm() : null;
  var measures = (flatResult && typeof currentAttemptMeasures === 'function')
    ? currentAttemptMeasures(flatResult)
    : null;
  var ctx = window.TBTemplate.buildAdaptiveResultContext(input, TEST_DATA.title || '', {
    hasScormActions: true,
    // The test's OWN feedback (`TEST_DATA.testFeedbackJson`) — the widest source of the
    // block and its first one. A property of the TEST, not of the flow mode: an author
    // who wrote a closing word for an adaptive test owes it to the learner just the same,
    // and the web host hands over the very same block on this screen.
    testFeedback: vrTestFeedback(),
    // Вводный блок ЭКРАНА — тот же, что у обычного режима: он свойство теста, а не
    // способа выдачи. Читатель у него один и тот же.
    intro: (typeof vrScreenIntro === 'function') ? vrScreenIntro() : null,
    // Absent for a test without measurements — `undefined` and not `null`, so the shared
    // builder's `if (opts.measures)` reads it the same way the web host's spread does.
    measures: measures || undefined,
    // `showPdf` is the LEGACY report flag, kept for external templates whose adaptive
    // layout predates the unified contract; the shipped layouts read `result.nav`.
    showPdf: true,
    // `(!hasLimit) || canRetry` used to be written out here, but it was already
    // redundant — `hasAttemptsLeft()` returns true whenever no limit is set — and
    // with PRD-31 it became WRONG: an unlimited test would keep offering the retry
    // straight through a closed interval. The flag now says what it means.
    canRetry: canRetry,
    showFinish: !canRetry
  });
  // One report contract for BOTH results layouts (shared/template/results-nav): the
  // adaptive footer used to spell it `showPdf`/`download-pdf`, which the web host never
  // sets — so the same template offered a report in the LMS and none in the browser.
  // Retry/finish stay adaptive-specific (`restart-adaptive` is not `restart`).
  ctx.result.nav = window.TBTemplate.buildResultsNav({
    canReport: (typeof vrReportEnabled === 'function') ? vrReportEnabled() : true,
    canRetry: false,
    hasPostPages: false
  });
  // No attempt counter in the header (parity with the web host): the scene header
  // names the test, run parameters are not header material.
  // Per-test branding so the shared header logo renders here too.
  ctx.design = (typeof scormDesignContext === 'function') ? scormDesignContext() : {};
  app.innerHTML = '';
  // Mount directly into #app so .tb-pad > .tb-scene fills the fixed stage —
  // mirrors renderGalleryPage (no wrapper div).
  window.TBTemplate.renderScreenInto(app, {
    layout: state.templateLayouts['results.adaptive'],
    context: ctx,
    protection: buildScormProtection('results')
  });
  // Both spellings are bound: `download-report` (unified) and the legacy `download-pdf`,
  // so an external template on either contract still produces the report.
  var report = app.querySelector('[data-action="download-report"]') || app.querySelector('[data-action="download-pdf"]');
  if (report) report.onclick = function () { if (typeof downloadPDF === 'function') downloadPDF(); };
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