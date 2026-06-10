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

/** Navigation row HTML (Принять / Далее / Завершить), onclick-wired. */
function buildQuestionNavHtml(current, total) {
    var html = '<div class="navigation" style="justify-content:flex-end">';
    if (TEST_DATA.showCorrectAnswers && !state.feedbackShown) {
        html += '<button class="btn" data-action="answer-submit" onclick="confirmAnswer()">Принять</button>';
    } else if (current < total - 1 || (state.pageSequence && state.currentPageIndex < state.pageSequence.length - 1)) {
        html += '<button class="btn" data-nav="next" onclick="next()">Далее</button>';
    } else {
        html += '<button class="btn" data-action="test-finish" onclick="submit()">Завершить тест</button>';
    }
    html += '</div>';
    return html;
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
        var context = { course: { title: TEST_DATA.title }, state: { questionCounterLabel: counterLabel } };
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
