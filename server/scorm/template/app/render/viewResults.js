// app/render/viewResults.js

/**
 * Renders the saved-results view ("Мой результат"). Primary path renders the
 * shared `results` layout via the SHARED renderer (TBTemplate.renderScreenInto) —
 * the SAME layout + renderer the web host mounts — from a public context; the
 * recommended courses/events, per-topic points/threshold/feedback and the
 * "back" action are gated layout blocks the web context simply does not set.
 * Falls back to the original hardcoded chrome if the design template is absent.
 */
function renderViewResults() {
  var app = document.getElementById('app');
  var attempt = state.viewedAttempt;
  if (!attempt) {
    app.innerHTML = '<div style="padding:20px;"><p>Нет данных о попытке</p></div>';
    return;
  }
  // PRD-7 G21: `systemLayout('results')` is the bundled default's results layout
  // when the active template declares no `results` contentTemplate.
  var layout = (typeof systemLayout === 'function') ? systemLayout('results') : (state && state.templateLayouts && state.templateLayouts['results']);
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (layout && TB && TB.renderScreenInto) {
    renderViewResultsTemplated(app, attempt);
    return;
  }
  renderViewResultsFallback();
}

/**
 * Per-topic pass threshold label (SCORM-extra). PRD-24: read from the RESOLVED rule
 * computed at grading time (`resolvedPassRule`) — for a `by_variant` topic that is the
 * threshold of the variant THIS attempt was given. It is persisted with the attempt's
 * topicResults, so viewing a past attempt shows the threshold that actually applied
 * back then, not one recomputed from the current session's variant.
 * Attempts saved before PRD-24 carry no resolved rule → fall back to the raw one.
 */
function vrRequiredLabel(tr) {
  var resolved = tr && tr.resolvedPassRule;
  if (!resolved) {
    var raw = tr && tr.passRule;
    return (raw && raw.type === 'percent') ? 'Требуется: ' + raw.value + '%' : undefined;
  }
  return resolved.type === 'percent' ? 'Требуется: ' + resolved.value + '%' : undefined;
}

/** Deduped recommended courses/events across failed topics (failed-topic guidance). */
function vrRecommended(results) {
  var seenC = {}, seenE = {}, courses = [], events = [];
  results.topicResults.forEach(function (tr) {
    if (tr.passed !== false) return;
    var section = TEST_DATA.sections.find(function (s) { return s.topicId === tr.topicId; });
    var cs = (section && section.recommendedCourses && section.recommendedCourses.length > 0) ? section.recommendedCourses : (tr.recommendedCourses || []);
    var es = (section && section.recommendedEvents) ? section.recommendedEvents : [];
    cs.forEach(function (c) { if (!seenC[c.title]) { seenC[c.title] = true; courses.push({ title: c.title, url: c.url }); } });
    es.forEach(function (e) { if (!seenE[e.title]) { seenE[e.title] = true; events.push({ title: e.title }); } });
  });
  return { courses: courses, events: events };
}

/**
 * Build the results context via the SHARED builder (TBTemplate.buildResultContext)
 * and mount the shared layout. SCORM adapts its runtime result into the builder's
 * normalized input; the shaping (passClass/ring/topic rows) lives in shared/.
 *
 * Footer: «Скачать отчёт» + the closing action, through the SAME `result.nav` block
 * the finish screen fills (see shared/template/results-nav) — the report is available
 * for every saved attempt, «Пройти заново» is not (this screen shows a PAST attempt,
 * a retry belongs to the start screen), and closing here means going back to the
 * start screen rather than ending the SCO.
 */
function renderViewResultsTemplated(app, results) {
  var rec = vrRecommended(results);
  var input = {
    passed: !!results.passed,
    percent: results.percent,
    totalQuestions: results.totalQuestions,
    correct: (results.totalCorrect != null ? results.totalCorrect : results.correct),
    earnedPoints: results.earnedPoints,
    possiblePoints: results.possiblePoints,
    topicResults: (results.topicResults || []).map(function (tr) {
      return {
        topicId: tr.topicId,
        topicName: tr.topicName,
        correct: tr.correct,
        total: tr.total,
        percent: tr.percent,
        earnedPoints: tr.earnedPoints,
        possiblePoints: tr.possiblePoints,
        passed: (tr.passed === null || tr.passed === undefined) ? null : !!tr.passed,
        requiredLabel: vrRequiredLabel(tr),
        topicFeedback: tr.topicFeedback
      };
    })
  };
  var ctx = window.TBTemplate.buildResultContext(input, TEST_DATA.title || '', {
    withTopicPoints: true,
    recommendedCourses: rec.courses,
    recommendedEvents: rec.events
  });
  ctx.design = (typeof scormDesignContext === 'function') ? scormDesignContext() : {};
  // NB: no attempt counter in the header — the scene header names the test, run
  // parameters belong to the screen's own content (parity with the web host).

  ctx.result.nav = window.TBTemplate.buildResultsNav({
    canReport: true,
    canRetry: false,
    hasPostPages: false,
    finishLabel: 'Вернуться к тесту'
  });

  // PRD-7 G21: mount default's results layout + activate default's stylesheet
  // when `results` falls back to the default template.
  var layout = (typeof systemLayout === 'function') ? systemLayout('results') : state.templateLayouts['results'];
  if (typeof applySystemScreenStyles === 'function') applySystemScreenStyles('results');
  app.innerHTML = '';
  // Mount directly into #app so .tb-pad > .tb-scene fills the fixed stage —
  // mirrors renderGalleryPage (a wrapper div would defeat the child-combinator rule).
  window.TBTemplate.renderScreenInto(app, { layout: layout, context: ctx });
  wireFinishResultsFooter(app, {
    // The screen shows the BEST saved attempt, so the report must be that attempt —
    // not whatever `downloadPDF()` would pick for the CURRENT run.
    'download-report': function () { if (typeof downloadPDF === 'function') downloadPDF(true); },
    'results-finish': backToStart
  });
}

/**
 * PRD-12: the FINISH results screen (rendered once the learner passes the last
 * question) via the SHARED `results` layout + renderer — the SAME scene as
 * «Мой результат» ({@link renderViewResultsTemplated}) and the web host. Replaces
 * the legacy hand-built `results-page` markup (renderResultsLegacy), which the
 * revised «Стандартный» theme no longer styles. Differs from the saved-results view
 * only in its FOOTER: the finish flow keeps its own actions (report / retry /
 * finish|next), wired after mount since the shared layout carries one button.
 */
function renderResultsTemplated(app, results) {
  var rec = vrRecommended(results);
  var input = {
    passed: !!results.passed,
    percent: results.percent,
    totalQuestions: results.totalQuestions,
    correct: (results.totalCorrect != null ? results.totalCorrect : results.correct),
    earnedPoints: results.earnedPoints,
    possiblePoints: results.possiblePoints,
    topicResults: (results.topicResults || []).map(function (tr) {
      return {
        topicId: tr.topicId,
        topicName: tr.topicName,
        correct: tr.correct,
        total: tr.total,
        percent: tr.percent,
        earnedPoints: tr.earnedPoints,
        possiblePoints: tr.possiblePoints,
        passed: (tr.passed === null || tr.passed === undefined) ? null : !!tr.passed,
        requiredLabel: vrRequiredLabel(tr),
        topicFeedback: tr.topicFeedback
      };
    })
  };
  var ctx = window.TBTemplate.buildResultContext(input, TEST_DATA.title || '', {
    withTopicPoints: true,
    recommendedCourses: rec.courses,
    recommendedEvents: rec.events
  });
  ctx.design = (typeof scormDesignContext === 'function') ? scormDesignContext() : {};

  ctx.result.nav = window.TBTemplate.buildResultsNav({
    canReport: true,
    canRetry: !results.passed && (typeof hasAttemptsLeft === 'function') && hasAttemptsLeft(),
    hasPostPages: !!(state.postResultsPages && state.postResultsPages.length > 0)
  });

  var layout = (typeof systemLayout === 'function') ? systemLayout('results') : state.templateLayouts['results'];
  if (typeof applySystemScreenStyles === 'function') applySystemScreenStyles('results');
  app.innerHTML = '';
  window.TBTemplate.renderScreenInto(app, { layout: layout, context: ctx });
  wireFinishResultsFooter(app);
}

/**
 * Binds the results footer the LAYOUT rendered to this runtime's handlers. The row
 * itself (which buttons, in what order, with what classes) is the template's — this
 * only reacts to its `data-action` values.
 *
 * @param {Element} app The mounted screen root.
 * @param {Object} [overrides] Per-screen handlers replacing the finish-flow defaults
 *   («Мой результат» downloads the saved attempt and closes back to the start screen).
 */
function wireFinishResultsFooter(app, overrides) {
  var foot = app.querySelector('.tb-scene__foot');
  if (!foot) return;
  var handlers = {
    'download-report': function () { if (typeof downloadPDF === 'function') downloadPDF(); },
    'restart': function () { if (typeof restart === 'function') restart(); },
    'results-next': function () { if (typeof enterPostResults === 'function') enterPostResults(); },
    'results-finish': function () { if (typeof finishAndClose === 'function') finishAndClose(); }
  };
  if (overrides) {
    for (var key in overrides) {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) handlers[key] = overrides[key];
    }
  }
  Array.prototype.forEach.call(foot.querySelectorAll('button[data-action]'), function (b) {
    var handler = handlers[b.getAttribute('data-action')];
    if (handler) b.addEventListener('click', handler);
  });
}

function renderViewResultsFallback() {
// Dead last-resort safety net: reached only if neither the active template nor the
// bundled standard template supplies this layout — the package always bundles the
// standard scene layout as the fallback, so it never fires. Renders a
// minimal, stylesheet-independent notice instead of a competing hardcoded design
// (the standard scene IS the fallback; PRD-12).
  var app = document.getElementById('app');
  if (app) app.innerHTML = '<div style="padding:24px;font:16px/1.5 system-ui,sans-serif">Экран результатов недоступен: шаблон не предоставил макет.</div>';
}

function backToStart() {
  state.phase = 'start';
  state.viewedAttempt = null;
  render();
}