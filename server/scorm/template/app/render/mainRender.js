/**
 * Fallback helpers (PRD-1 §4.3.2, PRD-3 NFR-06). When the active template doesn't
 * declare a system screen, the exporter bundles the `default` template under
 * `template-default/` + `styles-default.css`; these helpers let each system renderer
 * mount default's layout with default's CSS, so the SCORM package matches
 * «Структура» / the editor preview («Из стандартного шаблона»).
 *
 * Keyed by LAYOUT KEY (`start`, `results`, `question`, `section-intro`, `review`,
 * `section-results`) — the same key the renderers pass to `systemLayout`.
 */
function isFallbackLayout(layoutKey) {
    var ds = (typeof TEST_DATA !== 'undefined' && TEST_DATA.designSettings) || null;
    var list = (ds && ds.fallbackLayoutKeys) || [];
    return !!layoutKey && list.indexOf(layoutKey) >= 0;
}

/** Layout HTML for a system screen — the bundled default's when it's a fallback. */
function systemLayout(layoutKey) {
    if (isFallbackLayout(layoutKey) && state.fallbackLayouts && state.fallbackLayouts[layoutKey]) {
        return state.fallbackLayouts[layoutKey];
    }
    return state.templateLayouts && state.templateLayouts[layoutKey];
}

/**
 * Activates the bundled default stylesheet while a fallback system screen is shown
 * and restores the active template's stylesheet otherwise. Safe no-op when the
 * package ships no fallback (the `styles-fallback` link is absent). The package
 * shows one full screen at a time, so a global stylesheet swap is conflict-free.
 */
function applySystemScreenStyles(layoutKey) {
    if (typeof document === 'undefined') return;
    var alt = document.getElementById('styles-fallback');
    if (!alt) return;
    var useFallback = isFallbackLayout(layoutKey);
    var main = document.getElementById('styles-main');
    alt.disabled = !useFallback;
    if (main) main.disabled = useFallback;
}

function render() {
    // Reset to the active template's stylesheet on every render; fallback system
    // screens (start/results) re-activate the default stylesheet from their own
    // templated renderers below.
    applySystemScreenStyles(null);

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

    // PRD-19 (Block D): review/обзор screen (section-finish / test-finish).
    if (state.phase === 'review') {
        renderReviewScreen();
        return;
    }

    // PRD-19 (Block D / D5, FR-05a): computed section-results (итоги раздела).
    if (state.phase === 'sectionResults') {
        renderSectionResults(state.sectionResultsTopicId, state.sectionResultsIsLast);
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
    var progress = ((current + 1) / total) * 100;

    renderStandardQuestion(qData, current, total, progress);
}

/** Feedback block HTML shown under a question once the answer is accepted.
 *  Emits the shared DS `.ou-banner` (revision «Стандартный»), so standard and adaptive
 *  answer-check verdicts share one component. */
function buildQuestionFeedbackHtml(q) {
    var answer = state.answers[q.id];
    var scoreRatio = checkAnswer(q, answer);
    var isCorrect = scoreRatio === 1;
    var tone = isCorrect ? 'success' : (scoreRatio > 0 ? 'warning' : 'error');
    var statusText = isCorrect ? 'Правильно!' : (scoreRatio > 0 ? 'Частично правильно' : 'Неверно');

    var feedbackText = null;
    if (q.feedbackMode === 'conditional') {
        feedbackText = isCorrect ? q.feedbackCorrect : q.feedbackIncorrect;
    } else {
        feedbackText = q.feedback;
    }

    var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
    if (!TB || !TB.feedbackBanner) return '';
    return TB.feedbackBanner(tone, statusText, feedbackText ? TB.feedbackDesc(feedbackText) : '');
}

// PRD-19 (Block D): true when the current scope has ≥1 skipped question — drives
// the «Вернуться» button (the obvious navigation path to the обзор screen, FR-04c).
function hasSkippedInScope() {
    if (!TEST_DATA.allowReturnToUnanswered || !state.flatQuestions) return false;
    var sectionScope = TEST_DATA.answerCommitScope === 'section';
    var curFq = state.flatQuestions[state.currentIndex];
    var curTopic = sectionScope && curFq ? curFq.topicId : null;
    for (var i = 0; i < state.flatQuestions.length; i++) {
        var fq = state.flatQuestions[i];
        if (!fq) continue;
        if (sectionScope && fq.topicId !== curTopic) continue;
        if (state.questionStatuses && state.questionStatuses[fq.question.id] === 'skipped') return true;
    }
    return false;
}

// PRD-19: does the scope still hold a question without a committed answer — the
// input of the SHARED обзор gate (TBTemplate.shouldShowReview). `topicId` null =
// the whole test (flat flow).
function hasUnansweredInScope(topicId) {
    if (!state.flatQuestions) return false;
    for (var i = 0; i < state.flatQuestions.length; i++) {
        var fq = state.flatQuestions[i];
        if (!fq || !fq.question) continue;
        if (topicId && fq.topicId !== topicId) continue;
        if (!state.questionStatuses || state.questionStatuses[fq.question.id] !== 'answered') return true;
    }
    return false;
}

// PRD-19: the shared gate — shown only while the learner can still act there
// (return to a skipped question, or revise an answer). Otherwise the flow goes
// straight to the section results.
function reviewIsWorthShowing(topicId) {
    var TB = typeof TBTemplate !== 'undefined' ? TBTemplate : null;
    var input = {
        allowReturnToUnanswered: TEST_DATA.allowReturnToUnanswered,
        allowAnswerChange: TEST_DATA.allowAnswerChange,
        hasUnanswered: hasUnansweredInScope(topicId),
    };
    if (TB && typeof TB.shouldShowReview === 'function') return TB.shouldShowReview(input);
    // Bundle missing (defensive): fall back to the same rule inline.
    if (input.allowAnswerChange) return true;
    return input.allowReturnToUnanswered !== false && input.hasUnanswered;
}

// PRD-19 (Block D): open the обзор screen (section-finish / test-finish).
function goToReview() {
    state.phase = 'review';
    state.feedbackShown = false;
    render();
}

/**
 * PRD-19 (Block D / FR-09): finish-confirm modal — host-chrome overlay (agreed),
 * styled with template tokens (.tb-modal). Shown when finishing with unanswered
 * questions; «Отмена» dismisses, the confirm button runs `onConfirm`.
 */
function showFinishConfirm(unansweredCount, finishLabel, onConfirm) {
    var prev = document.getElementById('tb-finish-modal');
    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
    var back = document.createElement('div');
    back.id = 'tb-finish-modal';
    // DS ou-modal; <html> is the .ou theme provider, so DS tokens resolve here.
    back.className = 'ou-modal-root';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.innerHTML =
        '<div class="ou-modal__backdrop" data-modal="cancel"></div>' +
        '<div class="ou-modal ou-modal--s">' +
          '<div class="ou-modal__head ou-modal__head--icon">' +
            '<span class="ou-modal__icon ou-modal__icon--warning" aria-hidden="true">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>' +
            '</span>' +
            '<div class="ou-modal__head-text">' +
              '<h2 class="ou-modal__title">' + escapeHtml(finishLabel) + '?</h2>' +
              '<p class="ou-modal__desc">Вопросов без ответа: ' + unansweredCount +
                '. Они будут засчитаны как неверные. После завершения вернуться к ним нельзя.</p>' +
            '</div>' +
          '</div>' +
          '<div class="ou-modal__foot">' +
            '<button type="button" class="ou-btn ou-btn--ghost ou-btn--m" data-modal="cancel">Отмена</button>' +
            '<button type="button" class="ou-btn ou-btn--primary ou-btn--m" data-modal="confirm">' + escapeHtml(finishLabel) + '</button>' +
          '</div>' +
        '</div>';
    document.body.appendChild(back);
    function close() { if (back.parentNode) back.parentNode.removeChild(back); }
    Array.prototype.forEach.call(back.querySelectorAll('[data-modal="cancel"]'), function (el) { el.addEventListener('click', close); });
    back.querySelector('[data-modal="confirm"]').addEventListener('click', function () { close(); onConfirm(); });
}

// PRD-19 (Block D / D5): true when `topicId` is the LAST section in delivery order
// (no later flatQuestions belong to a different topic). Drives «Завершить раздел»
// vs «Завершить тест» labelling and the separate test-finish step.
function isLastSectionTopic(topicId) {
    if (!state.flatQuestions || !state.flatQuestions.length) return true;
    var last = state.flatQuestions[state.flatQuestions.length - 1];
    return !!last && last.topicId === topicId;
}

/**
 * PRD-19 (Block D / D5): render the обзор screen from the SHARED `review` template
 * layout (pills + explicit unanswered list + «Завершить …»). Оформление — через
 * шаблон (FR-16 / контракт §5). Scope-aware (FR-05/05b):
 *   - flat (commitScope 'test'): «Завершить тест» → submit() (single test finish);
 *   - sectional: scoped to the CURRENT section, «Завершить раздел» → finishSection()
 *     (freeze → optional section-results → next section). The last section without
 *     section-results merges into «Завершить тест» (no extra locked-review screen).
 */
function renderReviewScreen() {
    var app = document.getElementById('app');
    var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
    var layout = systemLayout('review');
    applySystemScreenStyles('review');
    var sectionScope = TEST_DATA.answerCommitScope === 'section';
    var isRouterMode = (typeof RouterFlow !== 'undefined' && RouterFlow.isRouterMode());
    var curFq = state.flatQuestions[state.currentIndex];
    var scopeTopicId = sectionScope && curFq ? curFq.topicId : null;
    var scopeName = curFq ? (curFq.topicName || '') : '';
    // Router free-order has no «last section» — «Завершить тест» lives on the hub
    // (FR-05b); the per-topic обзор is always «Завершить раздел». Linear sectional
    // computes the last section to merge the test-finish step.
    var isLast = !sectionScope ? true : (isRouterMode ? false : isLastSectionTopic(scopeTopicId));
    // «Завершить раздел» unless this section also IS the test finish (last section
    // with no section-results screen to follow) or the flow is flat.
    var finishLabel = (!sectionScope || (isLast && !TEST_DATA.showSectionResults))
        ? 'Завершить тест'
        : 'Завершить раздел';
    if (!layout || !TB || !TB.renderScreenInto || !TB.buildReviewContext) {
        // No review layout — fall through to finishing (section or whole test).
        if (sectionScope && scopeTopicId) { finishSection(scopeTopicId, isLast, 0, true); }
        else { submit(); }
        return;
    }
    var built = TB.buildReviewContext({
        questions: state.flatQuestions.map(function (fq) {
            return { id: fq.question.id, topicId: fq.topicId, prompt: fq.question.prompt };
        }),
        statuses: state.questionStatuses || {},
        commitScope: sectionScope ? 'section' : 'test',
        scopeTopicId: scopeTopicId,
        isTest: !sectionScope,
        scopeLabel: sectionScope ? ('Раздел «' + scopeName + '» · обзор') : 'Обзор теста',
        finishLabel: finishLabel
    });
    var context = {
        course: {
            title: TEST_DATA.title,
            subtitle: scormCourseSubtitle(),
            timeLimitMinutes: TEST_DATA.timeLimitMinutes || null,
            maxAttempts: TEST_DATA.maxAttempts || null
        },
        design: (typeof scormDesignContext === 'function') ? scormDesignContext() : {},
        state: { questionsProgress: built.questionsProgress },
        review: built.review
    };
    app.innerHTML = '';
    // Mount directly into #app so .tb-pad > .review-page fills the fixed stage
    // and the bottom nav anchors — mirrors renderGalleryPage (no wrapper div).
    TB.renderScreenInto(app, { layout: layout, context: context });
    // Reveal + paint the DS timers the shared header ships hidden (same as the
    // question screen) — the обзор is mid-test, so a running countdown shows.
    var rvTimer = app.querySelector('#timer-display');
    if (rvTimer && state.remainingSeconds !== null) {
        rvTimer.classList.remove('q-timer--hidden');
        paintTimer('timer-display', state.remainingSeconds);
    }
    var rvSecTimer = app.querySelector('#section-timer-display');
    if (rvSecTimer && state.sectionTimer) {
        rvSecTimer.classList.remove('q-timer--hidden');
        paintTimer('section-timer-display', state.sectionTimer.remainingSeconds);
    }
    var actionEls = app.querySelectorAll('[data-action]');
    Array.prototype.forEach.call(actionEls, function (el) {
        var a = el.getAttribute('data-action') || '';
        if (a.indexOf('goto:') === 0) {
            el.addEventListener('click', function () {
                if (el.disabled) return;
                var idx = parseInt(a.slice(5), 10);
                // Mark that this question was opened FROM the обзор, so its nav
                // offers «К обзору» to return (the обзор itself has no «back»).
                if (!isNaN(idx)) { state.fromReview = true; state.phase = 'question'; goToQuestionIndex(idx); }
            });
        } else if (a === 'finish-review') {
            el.addEventListener('click', function () {
                var unanswered = built.review.unansweredCount;
                if (sectionScope && scopeTopicId) {
                    // Section finish (D5): confirm-if-unanswered handled inside finishSection.
                    finishSection(scopeTopicId, isLast, unanswered, false);
                } else if (unanswered > 0) {
                    // Flat test finish (FR-09): confirm when unanswered remain.
                    showFinishConfirm(unanswered, built.review.finishLabel, function () { submit(); });
                } else {
                    submit();
                }
            });
        }
    });
}

// PRD-19 (D5 / FR-05b): resume after a section is committed. Router mode returns
// to the router hub (RouterFlow gates «Завершить тест» until all topics are done);
// linear sectional advances past the section (submits the attempt on the last).
function advanceAfterSection(topicId) {
    if (typeof RouterFlow !== 'undefined' && RouterFlow.isRouterMode()) {
        RouterFlow.returnFromTopic();
    } else if (typeof skipSectionFromCurrent === 'function') {
        skipSectionFromCurrent(topicId);
    } else {
        submit(true);
    }
}

/**
 * PRD-19 (Block D / D5, FR-05/06): commit a section from its обзор and proceed.
 * Freezes the section (no more edits/return, FR-06), then shows the computed
 * section-results screen (FR-05a, when `showSectionResults`) or advances straight
 * to the next section / router hub. `unansweredCount > 0` raises the finish-confirm
 * modal first (FR-09) unless `skipConfirm` (degraded no-layout path).
 */
function finishSection(topicId, isLast, unansweredCount, skipConfirm) {
    function proceed() {
        if (!state.sectionCommitted) state.sectionCommitted = {};
        state.sectionCommitted[topicId] = true; // FR-06: freeze the section.
        state.fromReview = false; // leaving the section — clear the «К обзору» flag.
        if (typeof saveSessionState === 'function') saveSessionState();
        if (TEST_DATA.showSectionResults) {
            state.sectionResultsTopicId = topicId;
            state.sectionResultsIsLast = isLast;
            state.phase = 'sectionResults';
            renderSectionResults(topicId, isLast);
        } else {
            advanceAfterSection(topicId); // → next section / router hub / submit
        }
    }
    var finishLabel = (isLast && !TEST_DATA.showSectionResults) ? 'Завершить тест' : 'Завершить раздел';
    if (!skipConfirm && unansweredCount > 0) {
        showFinishConfirm(unansweredCount, finishLabel, proceed);
    } else {
        proceed();
    }
}

/**
 * PRD-19 (FR-05a): render the COMPUTED section-results (итоги раздела) screen from
 * the SHARED `section-results` layout — the section's score ring + summary + verdict
 * + «Продолжить» (or «Завершить тест» on the last section). «Продолжить» advances
 * past the section (submits the attempt on the last section — the separate
 * test-finish step). Falls through to advancing when the layout is unavailable.
 */
function renderSectionResults(topicId, isLast) {
    var app = document.getElementById('app');
    var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
    var layout = systemLayout('section-results');
    applySystemScreenStyles('section-results');
    var sr = (typeof computeSectionResult === 'function') ? computeSectionResult(topicId) : null;
    var advance = function () { advanceAfterSection(topicId); };
    if (!sr || !layout || !TB || !TB.renderScreenInto || !TB.buildSectionResultContext) {
        advance();
        return;
    }
    // Router mode returns to the hub («Продолжить»); the «Завершить тест» step lives
    // on the hub (FR-05b). Linear sectional uses «Завершить тест» only on the last.
    var isRouterMode = (typeof RouterFlow !== 'undefined' && RouterFlow.isRouterMode());
    // Section position among the test's sections — drives the header «Раздел N из M»
    // tag + progress (matching the wireframe). Absent order simply drops both.
    var secList = (typeof TEST_DATA !== 'undefined' && TEST_DATA.sections) ? TEST_DATA.sections : [];
    var secPos = 0;
    for (var si = 0; si < secList.length; si++) { if (secList[si].topicId === topicId) { secPos = si + 1; break; } }
    var built = TB.buildSectionResultContext({
        topicName: sr.topicName,
        correct: sr.correct,
        total: sr.total,
        percent: sr.percent,
        passed: sr.passed,
        courseTitle: TEST_DATA.title,
        subtitle: scormCourseSubtitle(),
        sectionIndex: secPos || undefined,
        sectionsTotal: secList.length,
        continueLabel: (isLast && !isRouterMode) ? 'Завершить тест' : 'Продолжить'
    });
    var context = {
        course: built.course,
        design: (typeof scormDesignContext === 'function') ? scormDesignContext() : {},
        sectionResult: built.sectionResult
    };
    app.innerHTML = '';
    // Mount directly into #app so .tb-pad > .tb-scene fills the fixed stage
    // (section-results ring centered) — mirrors renderGalleryPage (no wrapper div).
    TB.renderScreenInto(app, { layout: layout, context: context });
    var btn = app.querySelector('[data-action="section-continue"]');
    if (btn) btn.addEventListener('click', advance);
}

/**
 * Navigation row HTML, onclick-wired. PRD-19 (Block B):
 * - strict-linear (allowReturnToUnanswered=false, B2): original single-button
 *   flow verbatim — «Принять» (showCorrectAnswers only) → «Далее»/«Завершить»;
 * - flexible (allowReturnToUnanswered=true, B3): before fixation two buttons —
 *   «Пропустить» (left) + «Отправить ответ» (right); after fixation «Далее»/
 *   «Завершить тест».
 */
function buildQuestionNavHtml(current, total) {
    var hasNext = current < total - 1 ||
        (state.pageSequence && state.currentPageIndex < state.pageSequence.length - 1);

    // «Отправить ответ»/«Принять» is available only when the current question has
    // a usable answer (same gate as requireAnswerOrToast). The selection handlers
    // keep this in sync at runtime via refreshSubmitEnabled.
    var navFq = state.flatQuestions[current];
    var submitReady = !navFq || typeof hasAnswer !== 'function'
        ? true
        : hasAnswer(navFq.question, state.answers[navFq.question.id]);
    var submitDisabledAttr = submitReady ? '' : ' disabled';

    if (!TEST_DATA.allowReturnToUnanswered) {
        var sh = '<div class="tb-scene__foot"><div class="tb-scene__foot-spacer"></div>';
        if (TEST_DATA.showCorrectAnswers && !state.feedbackShown) {
            sh += '<button class="ou-btn ou-btn--primary ou-btn--l" data-action="answer-submit" onclick="confirmAnswer()"' + submitDisabledAttr + '>Принять</button>';
        } else if (hasNext) {
            sh += '<button class="ou-btn ou-btn--primary ou-btn--l" data-nav="next" onclick="next()">Далее</button>';
        } else {
            sh += '<button class="ou-btn ou-btn--primary ou-btn--l" data-action="test-finish" onclick="submit()">Завершить тест</button>';
        }
        sh += '</div>';
        return sh;
    }

    // Flexible mode. «Вернуться» → обзор (Block D) and the clickable progress
    // pills (Block C) are layered on later; goToNextUnanswered() already backs them.
    var fq = state.flatQuestions[current];
    var committed = state.feedbackShown ||
        !!(fq && state.questionStatuses && state.questionStatuses[fq.question.id] === 'answered');

    var left = '';
    var right = '';
    // PRD-19 (Block B): «Назад» — return to the previous accessible question
    // (bounded to the current section in sectional flows). Parity with the web
    // host (take-test.tsx); rendered always in flexible mode, disabled when no
    // accessible previous question exists (first question of the test/section).
    var prevIdx = typeof prevAccessibleQuestionIndex === 'function' ? prevAccessibleQuestionIndex() : -1;
    left += '<button class="ou-btn ou-btn--ghost ou-btn--m" data-action="answer-back" onclick="goBack()"' + (prevIdx < 0 ? ' disabled' : '') + '>← Назад</button>';
    if (!committed) {
        left += '<button class="ou-btn ou-btn--ghost ou-btn--m" data-action="answer-skip" onclick="skipQuestion()">Пропустить</button>';
        right += '<button class="ou-btn ou-btn--primary ou-btn--l" data-action="answer-submit" onclick="confirmAnswer()"' + submitDisabledAttr + '>Отправить ответ</button>';
    } else {
        // PRD-19 (Block D / FR-16): the question page has NO finish button — «Далее»
        // always advances; завершение happens on the обзор (section-finish/test-finish).
        // On the last item «Далее» → advancePageSequence reaches the обзор (D5).
        right += '<button class="ou-btn ou-btn--primary ou-btn--l" data-nav="next" onclick="next()">Далее</button>';
    }
    // PRD-19 (Block D / FR-04c): «К обзору» → обзор. Shown when skipped questions
    // exist in scope (the obvious navigation path alongside the quick pills) OR the
    // learner jumped here FROM the обзор (a review jump must always be able to return —
    // the обзор itself has no «back»). Cleared when the section is finished.
    if (hasSkippedInScope() || state.fromReview) {
        left += '<button class="ou-btn ou-btn--ghost ou-btn--m" data-action="answer-return" onclick="goToReview()">К обзору</button>';
    }

    // The nav row IS the scene footer panel (appended below the layout in #app).
    return '<div class="tb-scene__foot">' + left +
        '<div class="tb-scene__foot-spacer"></div>' + right +
        '</div>';
}

/**
 * Header subtitle ("Попытка N из M") via the shared builder, so the SCORM and web
 * headers read identically (parity, PRD-12). The attempt number comes from
 * Telemetry (defaults to 1 when telemetry is off — e.g. the debug player's fresh
 * preview run); the cap from TEST_DATA. Empty string -> title-only header.
 * @returns {string}
 */
function scormCourseSubtitle() {
    var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
    if (!TB || !TB.buildCourseSubtitle) return '';
    var n = (typeof Telemetry !== 'undefined' && Telemetry.getAttemptNumber) ? Telemetry.getAttemptNumber() : 1;
    return TB.buildCourseSubtitle({ attemptNumber: n, maxAttempts: TEST_DATA.maxAttempts || null });
}

/**
 * Renders the standard question screen. Primary path renders the shared template
 * `question` layout via the SHARED renderer (TBTemplate.renderScreenInto) — the
 * SAME layout + renderer the web host mounts — filling the question chrome from a
 * public context + controlled slots; progress/timer are applied imperatively
 * (the layout ships the DS timers hidden). The nav row is appended below. Falls
 * back to the original hardcoded chrome if the design template failed to load.
 */
function renderStandardQuestion(qData, current, total, progress) {
    var app = document.getElementById('app');
    var q = qData.question;
    var layout = systemLayout('question');
    applySystemScreenStyles('question');
    var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
    var showFeedback = TEST_DATA.showCorrectAnswers && state.feedbackShown;
    var progressMode = typeof getProgressMode === 'function' ? getProgressMode() : 'questions';

    if (layout && TB && TB.renderScreenInto) {
        var counterLabel = 'Вопрос ' + (current + 1) + ' из ' + total;
        // PRD-19 Block C: progress-pills map for the current scope (replaces the bar).
        var sectionScope = TEST_DATA.answerCommitScope === 'section';
        var qProgress = (TB.buildQuestionProgress) ? TB.buildQuestionProgress({
            questions: state.flatQuestions.map(function (fq) { return { id: fq.question.id, topicId: fq.topicId }; }),
            statuses: state.questionStatuses || {},
            currentIndex: current,
            commitScope: sectionScope ? 'section' : 'test',
            sectionCommitted: state.sectionCommitted || {},
            allowReturn: !!TEST_DATA.allowReturnToUnanswered,
            scopeLabel: sectionScope ? ('Вопросы раздела «' + (qData.topicName || '') + '»') : 'Вопросы теста'
        }) : null;
        var context = {
            course: {
                title: TEST_DATA.title,
                subtitle: scormCourseSubtitle(),
                timeLimitMinutes: TEST_DATA.timeLimitMinutes || null,
                maxAttempts: TEST_DATA.maxAttempts || null
            },
            state: {
                questionCounterLabel: counterLabel,
                sectionName: (qData.topicName || ''),
                questionHint: (TB && TB.questionHint) ? TB.questionHint(q.type) : '',
                questionFont: (TB && TB.questionFont) ? TB.questionFont(q.prompt) : '',
                optionFont: (TB && TB.optionFont && TB.answerTexts) ? TB.optionFont(TB.answerTexts({ type: q.type, dataJson: q.data })) : ''
            },
            design: (typeof scormDesignContext === 'function') ? scormDesignContext() : {}
        };
        if (qProgress) context.state.questionsProgress = qProgress;
        var slots = {
            'question-text': escapeHtml(q.prompt),
            'question-media': renderQuestionMedia(q),
            'question-interaction': '<div id="question-input">' + renderQuestionInput(q) + '</div>',
            'question-feedback': showFeedback ? buildQuestionFeedbackHtml(q) : ''
        };
        app.innerHTML = '';
        // Mount directly into #app so .tb-pad > .tb-scene fills the
        // fixed stage and the appended nav row anchors at the bottom — mirrors
        // renderGalleryPage (a wrapper div would defeat the child-combinator rule).
        TB.renderScreenInto(app, { layout: layout, context: context, slots: slots });

        // PRD-19 Block C: wire pill clicks → goToQuestionIndex (frontier enforced
        // by the `disabled` attribute the builder set on non-reachable pills).
        var pills = app.querySelectorAll('.tb-pill[data-action]');
        Array.prototype.forEach.call(pills, function (btn) {
            btn.addEventListener('click', function () {
                if (btn.disabled) return;
                var a = btn.getAttribute('data-action') || '';
                if (a.indexOf('goto:') !== 0) return;
                var idx = parseInt(a.slice(5), 10);
                if (!isNaN(idx) && typeof goToQuestionIndex === 'function') goToQuestionIndex(idx);
            });
        });

        // Progress fill (or hide the bar when progress is suppressed).
        var pb = app.querySelector('.progress-bar');
        if (progressMode === 'hidden') {
            if (pb) pb.style.display = 'none';
        } else {
            var fill = app.querySelector('#q-progress-fill');
            if (fill) {
                var pv = progressMode === 'pages' && typeof pageProgressPercent === 'function' ? pageProgressPercent() : progress;
                fill.style.width = pv + '%';
            }
        }

        // Timers — the layout ships both DS timers hidden; reveal + paint whichever
        // countdown is running (presence thus follows the test/section time-limit
        // settings). paintTimer drives the DS __num + is-critical state.
        var timerEl = app.querySelector('#timer-display');
        if (timerEl && state.remainingSeconds !== null) {
            timerEl.classList.remove('q-timer--hidden');
            paintTimer('timer-display', state.remainingSeconds);
        }
        var secTimerEl = app.querySelector('#section-timer-display');
        if (secTimerEl && state.sectionTimer) {
            secTimerEl.classList.remove('q-timer--hidden');
            paintTimer('section-timer-display', state.sectionTimer.remainingSeconds);
        }

        // Nav row below the card (kept onclick-wired; no global delegator needed).
        var navWrap = document.createElement('div');
        navWrap.innerHTML = buildQuestionNavHtml(current, total);
        if (navWrap.firstChild) app.appendChild(navWrap.firstChild);

        syncMatchingHeights();
        // Font sizing is length-based (questionFont/optionFont → --tb-question-fs /
        // --tb-answer-fs): each card grows to fit its text at that size, and the
        // scene body (overflow:auto) scrolls when the content exceeds the space
        // between the fixed header and footer — no height-fit shrink needed.
        return;
    }

    // Fallback: design template unavailable — original hardcoded chrome.
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    html += '<h1 style="margin:0">' + escapeHtml(TEST_DATA.title) + '</h1>';
    if (state.remainingSeconds !== null) {
        var timerClass = state.remainingSeconds <= 60 ? 'style="color:#dc2626;font-weight:bold;font-size:18px;"' : 'style="color:#666;font-size:18px;"';
        html += '<div id="timer-display" ' + timerClass + '>' + formatTime(state.remainingSeconds) + '</div>';
    }
    html += '</div>';
    if (progressMode !== 'hidden') {
        var progressValue = progressMode === 'pages' && typeof pageProgressPercent === 'function' ? pageProgressPercent() : progress;
        html += '<div class="progress-bar"><div class="progress-fill" style="width:' + progressValue + '%"></div></div>';
    }
    html += '<div class="card">';
    html += '<div style="color:#666;margin-bottom:8px;">Вопрос ' + (current + 1) + ' из ' + total + ' | ' + escapeHtml(qData.topicName) + '</div>';
    html += '<div class="question-text">' + escapeHtml(q.prompt) + '</div>';
    html += renderQuestionMedia(q);
    html += '<div id="question-input">';
    html += renderQuestionInput(q);
    html += '</div>';
    if (showFeedback) {
        html += buildQuestionFeedbackHtml(q);
    }
    html += '</div>';
    html += buildQuestionNavHtml(current, total);

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
