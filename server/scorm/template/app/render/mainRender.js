/**
 * PRD-7 G21 fallback helpers. When the active template doesn't declare a system
 * kind (start/results), the exporter bundles the `default` template under
 * `template-default/` + `styles-default.css`; these helpers let the start/results
 * renderers mount default's layout with default's CSS so the SCORM package matches
 * «Структура» / the editor preview («Из стандартного шаблона»).
 */
function isFallbackKind(kind) {
    var ds = (typeof TEST_DATA !== 'undefined' && TEST_DATA.designSettings) || null;
    var list = (ds && ds.fallbackKinds) || [];
    return !!kind && list.indexOf(kind) >= 0;
}

/** Layout HTML for a system kind — the bundled default's when it's a fallback kind. */
function systemLayout(kind) {
    if (isFallbackKind(kind) && state.fallbackLayouts && state.fallbackLayouts[kind]) {
        return state.fallbackLayouts[kind];
    }
    return state.templateLayouts && state.templateLayouts[kind];
}

/**
 * Activates the bundled default stylesheet while a fallback system screen is shown
 * and restores the active template's stylesheet otherwise. Safe no-op when the
 * package ships no fallback (the `styles-fallback` link is absent). The package
 * shows one full screen at a time, so a global stylesheet swap is conflict-free.
 */
function applySystemScreenStyles(kind) {
    if (typeof document === 'undefined') return;
    var alt = document.getElementById('styles-fallback');
    if (!alt) return;
    var useFallback = isFallbackKind(kind);
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

/** Feedback block HTML shown under a question once the answer is accepted. */
function buildQuestionFeedbackHtml(q) {
    var answer = state.answers[q.id];
    var scoreRatio = checkAnswer(q, answer);
    var isCorrect = scoreRatio === 1;
    var statusColor = isCorrect ? '#16a34a' : '#dc2626';
    var statusText = isCorrect ? 'Правильно!' : (scoreRatio > 0 ? 'Частично правильно' : 'Неправильно');

    var html = '<div class="feedback-block" style="margin-top:16px;padding:12px;border-radius:8px;background:' + (isCorrect ? '#dcfce7' : '#fee2e2') + ';border:1px solid ' + statusColor + ';">';
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
    return html;
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
    back.className = 'tb-modal-backdrop';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.innerHTML =
        '<div class="tb-modal">' +
          '<div class="tb-modal__head">' +
            '<div class="tb-modal__icon" aria-hidden="true">!</div>' +
            '<div><h2 class="tb-modal__title">' + escapeHtml(finishLabel) + '?</h2>' +
            '<p class="tb-modal__desc">Вопросов без ответа: ' + unansweredCount +
              '. Они будут засчитаны как неверные. После завершения вернуться к ним нельзя.</p></div>' +
          '</div>' +
          '<div class="tb-modal__foot">' +
            '<button type="button" class="btn btn-outline" data-modal="cancel">Отмена</button>' +
            '<button type="button" class="btn" data-modal="confirm">' + escapeHtml(finishLabel) + '</button>' +
          '</div>' +
        '</div>';
    document.body.appendChild(back);
    function close() { if (back.parentNode) back.parentNode.removeChild(back); }
    back.querySelector('[data-modal="cancel"]').addEventListener('click', close);
    back.querySelector('[data-modal="confirm"]').addEventListener('click', function () { close(); onConfirm(); });
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
}

/**
 * PRD-19 (Block D): render the обзор screen from the SHARED `review` template
 * layout (pills + explicit unanswered list + «Завершить»). Wires pill/row `goto`
 * jumps and the finish action. Оформление — через шаблон (FR-16/контракт §5);
 * this is NOT a non-template UI. Staged per-section finish + section-results is a
 * later step — here «Завершить» finishes the test (submit()).
 */
function renderReviewScreen() {
    var app = document.getElementById('app');
    var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
    var layout = state.templateLayouts && state.templateLayouts['review'];
    if (!layout || !TB || !TB.renderScreenInto || !TB.buildReviewContext) {
        submit(); // no review layout — fall through to finishing
        return;
    }
    var sectionScope = TEST_DATA.answerCommitScope === 'section';
    var curFq = state.flatQuestions[state.currentIndex];
    var scopeTopicId = sectionScope && curFq ? curFq.topicId : null;
    var scopeName = curFq ? (curFq.topicName || '') : '';
    var built = TB.buildReviewContext({
        questions: state.flatQuestions.map(function (fq) {
            return { id: fq.question.id, topicId: fq.topicId, prompt: fq.question.prompt };
        }),
        statuses: state.questionStatuses || {},
        commitScope: sectionScope ? 'section' : 'test',
        scopeTopicId: scopeTopicId,
        isTest: true,
        scopeLabel: sectionScope ? ('Раздел «' + scopeName + '» · обзор') : 'Обзор теста',
        finishLabel: 'Завершить тест'
    });
    var context = {
        course: { title: TEST_DATA.title },
        design: (typeof scormDesignContext === 'function') ? scormDesignContext() : {},
        state: { questionsProgress: built.questionsProgress },
        review: built.review
    };
    app.innerHTML = '';
    var wrap = document.createElement('div');
    app.appendChild(wrap);
    TB.renderScreenInto(wrap, { layout: layout, context: context });
    var actionEls = wrap.querySelectorAll('[data-action]');
    Array.prototype.forEach.call(actionEls, function (el) {
        var a = el.getAttribute('data-action') || '';
        if (a.indexOf('goto:') === 0) {
            el.addEventListener('click', function () {
                if (el.disabled) return;
                var idx = parseInt(a.slice(5), 10);
                if (!isNaN(idx)) { state.phase = 'question'; goToQuestionIndex(idx); }
            });
        } else if (a === 'finish-review') {
            el.addEventListener('click', function () {
                // FR-09: confirm when finishing with unanswered questions.
                if (built.review.unansweredCount > 0) {
                    showFinishConfirm(built.review.unansweredCount, built.review.finishLabel, function () { submit(); });
                } else {
                    submit();
                }
            });
        }
    });
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

    if (!TEST_DATA.allowReturnToUnanswered) {
        var sh = '<div class="navigation" style="justify-content:flex-end">';
        if (TEST_DATA.showCorrectAnswers && !state.feedbackShown) {
            sh += '<button class="btn" data-action="answer-submit" onclick="confirmAnswer()">Принять</button>';
        } else if (hasNext) {
            sh += '<button class="btn" data-nav="next" onclick="next()">Далее</button>';
        } else {
            sh += '<button class="btn" data-action="test-finish" onclick="submit()">Завершить тест</button>';
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
    if (!committed) {
        left += '<button class="btn btn-outline" data-action="answer-skip" onclick="skipQuestion()">Пропустить</button>';
        right += '<button class="btn" data-action="answer-submit" onclick="confirmAnswer()">Отправить ответ</button>';
    } else if (hasNext) {
        right += '<button class="btn" data-nav="next" onclick="next()">Далее</button>';
    } else {
        right += '<button class="btn" data-action="test-finish" onclick="submit()">Завершить тест</button>';
    }
    // PRD-19 (Block D / FR-04c): «Вернуться» → обзор, only when skipped questions
    // exist in scope (the obvious navigation path alongside the quick pills).
    if (hasSkippedInScope()) {
        left += '<button class="btn btn-outline" data-action="answer-return" onclick="goToReview()">Вернуться</button>';
    }

    return '<div class="navigation">' +
        '<div class="navigation__left" style="display:flex;gap:12px">' + left + '</div>' +
        '<div class="navigation__right" style="display:flex;gap:12px">' + right + '</div>' +
        '</div>';
}

/**
 * Renders the standard question screen. Primary path renders the shared template
 * `question` layout via the SHARED renderer (TBTemplate.renderScreenInto) — the
 * SAME layout + renderer the web host mounts — filling the question chrome from a
 * public context + controlled slots; progress/timer are applied imperatively
 * (the layout ships #timer-display hidden). The nav row is appended below. Falls
 * back to the original hardcoded chrome if the design template failed to load.
 */
function renderStandardQuestion(qData, current, total, progress) {
    var app = document.getElementById('app');
    var q = qData.question;
    var layouts = (typeof state !== 'undefined' && state) ? state.templateLayouts : null;
    var layout = layouts && layouts['question'];
    var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
    var showFeedback = TEST_DATA.showCorrectAnswers && state.feedbackShown;
    var progressMode = typeof getProgressMode === 'function' ? getProgressMode() : 'questions';

    if (layout && TB && TB.renderScreenInto) {
        var counterLabel = 'Вопрос ' + (current + 1) + ' из ' + total + ' | ' + qData.topicName;
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
            course: { title: TEST_DATA.title },
            state: { questionCounterLabel: counterLabel },
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
        var wrap = document.createElement('div');
        app.appendChild(wrap);
        TB.renderScreenInto(wrap, { layout: layout, context: context, slots: slots });

        // PRD-19 Block C: wire pill clicks → goToQuestionIndex (frontier enforced
        // by the `disabled` attribute the builder set on non-reachable pills).
        var pills = wrap.querySelectorAll('.tb-pill[data-action]');
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
        var pb = wrap.querySelector('.progress-bar');
        if (progressMode === 'hidden') {
            if (pb) pb.style.display = 'none';
        } else {
            var fill = wrap.querySelector('#q-progress-fill');
            if (fill) {
                var pv = progressMode === 'pages' && typeof pageProgressPercent === 'function' ? pageProgressPercent() : progress;
                fill.style.width = pv + '%';
            }
        }

        // Timer — the layout ships #timer-display hidden; reveal when a timer runs.
        var timerEl = wrap.querySelector('#timer-display');
        if (timerEl && state.remainingSeconds !== null) {
            timerEl.classList.remove('q-timer--hidden');
            timerEl.textContent = formatTime(state.remainingSeconds);
            if (state.remainingSeconds <= 60) { timerEl.style.color = '#dc2626'; timerEl.style.fontWeight = 'bold'; }
        }

        // Nav row below the card (kept onclick-wired; no global delegator needed).
        var navWrap = document.createElement('div');
        navWrap.innerHTML = buildQuestionNavHtml(current, total);
        if (navWrap.firstChild) app.appendChild(navWrap.firstChild);

        syncMatchingHeights();
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
