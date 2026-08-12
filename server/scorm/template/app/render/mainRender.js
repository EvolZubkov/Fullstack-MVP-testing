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

    var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
    if (!TB || !TB.feedbackBanner) return '';
    // issue #34: общий/условный режим разбирает ОБЩЕЕ правило (см. feedback.js).
    var feedbackText = TB.feedbackTextFor(q, isCorrect);
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
        // Авторское «когда отвечено всё, обзор не нужен». Отсутствие в пакете,
        // собранном до этой настройки, читается как прежнее поведение.
        skipReviewWhenComplete: TEST_DATA.skipReviewWhenComplete,
    };
    if (TB && typeof TB.shouldShowReview === 'function') return TB.shouldShowReview(input);
    // Bundle missing (defensive): fall back to the same rule inline.
    if (input.skipReviewWhenComplete && !input.hasUnanswered) return false;
    if (input.allowAnswerChange) return true;
    return input.allowReturnToUnanswered !== false && input.hasUnanswered;
}

// PRD-19 (Block D): open the обзор screen (section-finish / test-finish).
// `fromButton` = opened via «К обзору» MID-flow (not the end-of-flow обзор): remember
// the origin question so the обзор can offer an accented «Назад» back to it and demote
// «Завершить …» (cut accidental finishes). End-of-flow entry passes nothing → null.
function goToReview(fromButton) {
    state.phase = 'review';
    state.feedbackShown = false;
    state.reviewOrigin = fromButton ? state.currentIndex : null;
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
    // Opened via «К обзору» mid-flow? Then offer «Назад» to the origin question and
    // highlight it as «текущий». Only questions the learner has actually reached
    // (flat index <= the current position) or committed are «delivered» — the обзор
    // must not reveal not-yet-issued questions.
    var fromButton = (state.reviewOrigin !== null && state.reviewOrigin !== undefined);
    var frontier = state.currentIndex;
    var statusMap = state.questionStatuses || {};
    var built = TB.buildReviewContext({
        questions: state.flatQuestions.map(function (fq, i) {
            var st = statusMap[fq.question.id];
            return {
                id: fq.question.id, topicId: fq.topicId, prompt: fq.question.prompt,
                delivered: (i <= frontier) || st === 'answered' || st === 'skipped'
            };
        }),
        statuses: statusMap,
        commitScope: sectionScope ? 'section' : 'test',
        scopeTopicId: scopeTopicId,
        isTest: !sectionScope,
        scopeLabel: sectionScope ? ('Раздел «' + scopeName + '» · обзор') : 'Обзор теста',
        finishLabel: finishLabel,
        currentIndex: fromButton ? state.currentIndex : -1,
        canReturn: fromButton,
        backLabel: 'Назад'
    });
    var context = {
        course: {
            title: TEST_DATA.title,
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
    // PRD-34 (FR-08): экран обзора защищается СЦЕНОЙ ЦЕЛИКОМ — текст задания там
    // печатает сам макет, зацепиться за регион ядра не за что.
    TB.renderScreenInto(app, {
        layout: layout,
        context: context,
        protection: buildScormProtection('review')
    });
    // Reveal + paint the running countdowns (the обзор is mid-test).
    if (typeof revealSceneTimers === 'function') revealSceneTimers(app);
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
        } else if (a === 'review-back') {
            // «Назад» (mid-flow обзор): return to the question the learner came from.
            el.addEventListener('click', function () {
                var origin = state.reviewOrigin;
                state.reviewOrigin = null;
                state.phase = 'question';
                goToQuestionIndex((typeof origin === 'number' && origin >= 0) ? origin : state.currentIndex);
            });
        } else if (a === 'finish-review') {
            el.addEventListener('click', function () {
                state.reviewOrigin = null;
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
    // PRD-49: заголовки этого экрана (`section.eyebrow`/`facts.*`) — the SAME reader as
    // the results screens (`vrApplyLabelOptions`, viewResults.js — flat runtime bundle,
    // reused across render files the same way `vrTestFeedback` already is). The
    // section-results screen carries no sub-blocks of its own, so only `labels` is ever
    // set here — `vrLabelOptions` still looks up `templateBlockOrder['section-results']`,
    // which the package never bakes (build-export-data.ts resolves order for `results`/
    // `results.adaptive` only), so `sectionResultsOpts.templateBlockOrder` stays absent
    // and `buildSectionResultContext` — which reads only `opts.labels` — ignores it anyway.
    var sectionResultsOpts = {};
    if (typeof vrApplyLabelOptions === 'function') vrApplyLabelOptions(sectionResultsOpts, 'section-results');
    var built = TB.buildSectionResultContext({
        topicName: sr.topicName,
        correct: sr.correct,
        total: sr.total,
        percent: sr.percent,
        passed: sr.passed,
        courseTitle: TEST_DATA.title,
        sectionIndex: secPos || undefined,
        sectionsTotal: secList.length,
        continueLabel: (isLast && !isRouterMode) ? 'Завершить тест' : 'Продолжить'
    }, sectionResultsOpts);
    var context = {
        course: built.course,
        design: (typeof scormDesignContext === 'function') ? scormDesignContext() : {},
        sectionResult: built.sectionResult
    };
    // PRD-49: the resolved labels TREE the builder attached above (`built.labels`,
    // present only when `sectionResultsOpts.labels` was set) — the layout addresses it
    // as `labels.section.eyebrow` / `labels.facts.*`. Absent for a package built before
    // this PRD, so such a package renders byte-identical to before.
    if (built.labels) context.labels = built.labels;
    app.innerHTML = '';
    // Mount directly into #app so .tb-pad > .tb-scene fills the fixed stage
    // (section-results ring centered) — mirrors renderGalleryPage (no wrapper div).
    TB.renderScreenInto(app, {
        layout: layout,
        context: context,
        protection: buildScormProtection('section-results')
    });
    // Section-results is mid-test — reveal + paint the running countdowns.
    if (typeof revealSceneTimers === 'function') revealSceneTimers(app);
    var btn = app.querySelector('[data-action="section-continue"]');
    if (btn) btn.addEventListener('click', advance);
}

/**
 * Navigation STATE for the question layout's footer (`state.nav`). The row itself
 * is drawn by the TEMPLATE — this runtime no longer builds buttons, it only
 * resolves the run state the layout binds against (PRD-19 Block B: strict-linear
 * vs flexible, fixation, «К обзору»), exactly as the web host does.
 *
 * The layout's buttons carry `data-action` and no inline handlers;
 * {@link wireQuestionNav} binds them to this runtime's functions.
 */
function buildQuestionNavState(current, total) {
    var hasNext = current < total - 1 ||
        (state.pageSequence && state.currentPageIndex < state.pageSequence.length - 1);

    // «Отправить ответ»/«Принять» is available only when the current question has
    // a usable answer (same gate as requireAnswerOrToast). The selection handlers
    // keep this in sync at runtime via refreshSubmitEnabled.
    var navFq = state.flatQuestions[current];
    var submitReady = !navFq || typeof hasAnswer !== 'function'
        ? true
        : hasAnswer(navFq.question, state.answers[navFq.question.id]);
    var fq = state.flatQuestions[current];
    var committed = state.feedbackShown ||
        !!(fq && state.questionStatuses && state.questionStatuses[fq.question.id] === 'answered');
    var prevIdx = typeof prevAccessibleQuestionIndex === 'function' ? prevAccessibleQuestionIndex() : -1;

    return window.TBTemplate.buildQuestionNav({
        flexible: !!TEST_DATA.allowReturnToUnanswered,
        // PRD-43: independent of `flexible` — see shared/template/question-nav.ts.
        quickAdvance: !!TEST_DATA.quickAdvance,
        committed: committed,
        canPrev: prevIdx >= 0,
        answerReady: submitReady,
        hasNext: hasNext,
        showAccept: !!TEST_DATA.showCorrectAnswers && !state.feedbackShown,
        showReview: hasSkippedInScope() || !!state.fromReview
    });
}

/**
 * Binds the shared nav row's action attributes to this runtime's navigation
 * functions. Replaces the inline `onclick`s the row used to carry — the markup is
 * shared with the web host now, and behaviour is per host.
 *
 * @param {Element} row The `.tb-scene__foot` element just mounted.
 */
function wireQuestionNav(row) {
    if (!row) return;
    var handlers = {
        'answer-back': function () { if (typeof goBack === 'function') goBack(); },
        'answer-skip': function () { if (typeof skipQuestion === 'function') skipQuestion(); },
        'answer-submit': function () { if (typeof confirmAnswer === 'function') confirmAnswer(); },
        'answer-return': function () { if (typeof goToReview === 'function') goToReview(true); },
        'answer-next': function () { if (typeof next === 'function') next(); },
        'test-finish': function () { if (typeof submit === 'function') submit(); }
    };
    row.querySelectorAll('button').forEach(function (btn) {
        var action = btn.getAttribute('data-action');
        var handler = action ? handlers[action] : null;
        if (handler) btn.addEventListener('click', handler);
    });
}

/**
 * Attempt line ("Попытка N из M") via the shared builder, so the SCORM and web
 * screens read identically (parity, PRD-12). Used by the retake WALL only: the
 * results header no longer carries the counter (run parameters are not header
 * material), and the in-run header never did.
 *
 * The attempt number is REPORTED ONLY WHEN IT IS KNOWN. A package has no
 * cross-attempt storage of its own (`suspend_data` is per attempt and WebTutor
 * offers nothing else), so the number can only come from our telemetry endpoint.
 * With telemetry off — the normal state of an LMS upload — the counter is a
 * placeholder `1`, and printing it would tell a learner on their third attempt
 * that it is their first. In that case the header stays title-only.
 *
 * @returns {string} "Попытка N из M", or "" when the number is not known.
 */
function scormCourseSubtitle() {
    var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
    if (!TB || !TB.buildCourseSubtitle) return '';
    var known = typeof Telemetry !== 'undefined' && Telemetry.hasAttemptNumber && Telemetry.hasAttemptNumber();
    if (!known) return '';
    return TB.buildCourseSubtitle({
        attemptNumber: Telemetry.getAttemptNumber(),
        maxAttempts: TEST_DATA.maxAttempts || null
    });
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
                timeLimitMinutes: TEST_DATA.timeLimitMinutes || null,
                maxAttempts: TEST_DATA.maxAttempts || null
            },
            state: {
                questionCounterLabel: counterLabel,
                sectionName: (qData.topicName || ''),
                nav: buildQuestionNavState(current, total),
                questionHint: (TB && TB.questionHint) ? TB.questionHint(q.type, { type: q.type, dataJson: q.data }) : '',
                questionFont: (TB && TB.questionFont) ? TB.questionFont(q.prompt) : '',
                optionFont: (TB && TB.optionFont && TB.answerTexts) ? TB.optionFont(TB.answerTexts({ type: q.type, dataJson: q.data })) : ''
            },
            design: (typeof scormDesignContext === 'function') ? scormDesignContext() : {}
        };
        if (qProgress) context.state.questionsProgress = qProgress;
        var slots = {
            'question-text': authorTextHtml(q.prompt),
            'question-media': renderQuestionMedia(q),
            'question-interaction': '<div id="question-input">' + renderQuestionInput(q) + '</div>',
            'question-feedback': showFeedback ? buildQuestionFeedbackHtml(q) : ''
        };
        app.innerHTML = '';
        // Mount directly into #app so .tb-pad > .tb-scene fills the
        // fixed stage and the appended nav row anchors at the bottom — mirrors
        // renderGalleryPage (a wrapper div would defeat the child-combinator rule).
        TB.renderScreenInto(app, {
            layout: layout,
            context: context,
            slots: slots,
            protection: buildScormProtection('question')
        });

        // PRD-19 Block C: wire pill clicks → goToQuestionIndex (frontier enforced
        // by the `disabled` attribute the builder set on non-reachable pills). The map
        // pills are `.ou-quiz__dot` (revision «Стандартный»); the old `.tb-pill`
        // selector matched nothing, so the navigator was dead on the question screen.
        var pills = app.querySelectorAll('.ou-quiz__dot[data-action]');
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
        if (typeof revealSceneTimers === 'function') revealSceneTimers(app);

        // The nav row came from the LAYOUT (state.nav); bind its buttons here.
        wireQuestionNav(app.querySelector('.tb-scene__foot'));

        syncMatchingHeights();
        // The length-based questionFont/optionFont set the INITIAL --tb-question-fs /
        // --tb-answer-fs; a HEIGHT-based pass then balances them: the header takes up to
        // 1/4 of the field at the largest size that fits, the options take the largest
        // size that keeps them all on screen without scrolling. Re-run on resize.
        if (TB && TB.fitQuestionScene) {
            var fitCol = function () {
                TB.fitQuestionScene(app.querySelector('.tb-scene__body'), app.querySelector('.tb-scene__col'), app.querySelector('.tb-scene__q'));
            };
            fitCol();
            requestAnimationFrame(fitCol); // after fonts/layout settle
            if (state._fitQ) window.removeEventListener('resize', state._fitQ);
            state._fitQ = fitCol;
            window.addEventListener('resize', fitCol);
        }
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
    html += '<div class="question-text">' + authorTextHtml(q.prompt) + '</div>';
    html += renderQuestionMedia(q);
    html += '<div id="question-input">';
    html += renderQuestionInput(q);
    html += '</div>';
    if (showFeedback) {
        html += buildQuestionFeedbackHtml(q);
    }
    html += '</div>';

    app.innerHTML = html;
    // Same shared row here, so the no-template fallback keeps working navigation.
    wireQuestionNav(app.querySelector('.tb-scene__foot'));
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
