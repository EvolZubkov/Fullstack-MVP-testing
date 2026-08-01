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
 * PRD-29: design params the measures block reads (level scheme, ramp colours, render
 * kinds), resolved the way the WEB host resolves them for the very same screen — base
 * params plus the colours of the PINNED palette (`readScreenTemplate`). A themed
 * template keeps its colours in `paramsByTheme`, and under «Авто» no palette is pinned,
 * so only the palette-independent params travel — exactly as on the web.
 * Degrades to the flat baked params when the shared resolver is unavailable.
 */
function resultsDesignParams() {
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  var design = (typeof TEST_DATA !== 'undefined' && TEST_DATA.designSettings) || {};
  var flat = design.params || {};
  if (!TB || typeof TB.resolveThemeParams !== 'function') return flat;
  var manifest = (typeof state !== 'undefined' && state && state.templateManifest) || null;
  var resolved = TB.resolveThemeParams(design, manifest);
  var pinned = (typeof TB.sceneThemeAttribute === 'function') ? TB.sceneThemeAttribute(design, manifest) : null;
  var out = {};
  var key;
  for (key in resolved.base) {
    if (Object.prototype.hasOwnProperty.call(resolved.base, key)) out[key] = resolved.base[key];
  }
  var themed = (pinned && resolved.byTheme && resolved.byTheme[pinned]) || {};
  for (key in themed) {
    if (Object.prototype.hasOwnProperty.call(themed, key)) out[key] = themed[key];
  }
  return out;
}

/**
 * PRD-29: the level colour ramp — a named scheme, or the author's three triples when
 * «Своя» is chosen. A missing custom colour falls back to the traffic scheme's own end,
 * so a half-filled form still paints a sane ramp (mirrors `resolveRamp` on the web).
 */
function resultsLevelRamp(params) {
  var schemes = window.TBTemplate.LEVEL_SCHEMES;
  var scheme = String(params.levelScheme || 'traffic');
  if (scheme !== 'custom') return schemes[scheme === 'neutral' ? 'neutral' : 'traffic'];
  return {
    favorable: String(params.levelColorFavorable || schemes.traffic.favorable),
    mid: params.levelColorMid ? String(params.levelColorMid) : null,
    unfavorable: String(params.levelColorUnfavorable || schemes.traffic.unfavorable)
  };
}

/**
 * PRD-29: settings of the «Итоги» variant — the three-position show/hide/auto switches
 * of the score summary, the indicators and the scales. No `results` page, or a page
 * without settings: everything stays on «Автоматически» (mirrors `measuresForAttempt`).
 */
function resultsBlockSettings() {
  var pages = (typeof TEST_DATA !== 'undefined' && TEST_DATA.contentPages) || [];
  for (var i = 0; i < pages.length; i++) {
    if (pages[i] && pages[i].kind === 'results') return pages[i].settings || {};
  }
  return {};
}

/** Rows in the author's order — the same ORDER BY the web host reads them with. */
function measuresBySortOrder(rows) {
  return rows.slice().sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
}

/**
 * PRD-29: the measures input for the SHARED results builder, assembled to the very
 * shape `server/services/result-context.buildMeasuresInput` assembles on the web host —
 * that is what keeps the two players drawing the same cards.
 *
 * Returns null for a test with neither scales nor indicators, so `opts.measures` stays
 * absent and such a test keeps EXACTLY the results context it has always had (the
 * score summary is suppressed only when the builder is actually handed measures).
 *
 * @param {object|null} scaleComputation `{ values }` — this attempt's scale values.
 * @param {object|null} varComputation   `{ values }` — this attempt's indicator values.
 * @returns {object|null} MeasuresInput for `buildResultContext`, or null.
 */
function buildResultsMeasures(scaleComputation, varComputation) {
  var TD = (typeof TEST_DATA !== 'undefined' && TEST_DATA) || {};
  var rawScales = TD.scales || [];
  var rawVars = TD.resultVariables || [];
  if (!rawScales.length && !rawVars.length) return null;
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (!TB || typeof TB.parseScaleInterpretation !== 'function') return null;

  var params = resultsDesignParams();
  var scaleValues = (scaleComputation && scaleComputation.values) || {};
  var varValues = (varComputation && varComputation.values) || {};

  var scales = measuresBySortOrder(rawScales).map(function (s) {
    var computed = scaleValues[s.key];
    return {
      key: s.key,
      name: s.label || s.key,
      value: computed ? computed.raw : null,
      visibility: s.learnerVisibility || 'hidden',
      // The BAKED scale carries its interpretation flat (domainMin/domainMax/valence/
      // bands) and the shared parser reads exactly those keys, so the package ends up
      // with the identical interpretation object the web host parses from config_json.
      interpretation: TB.parseScaleInterpretation(s)
    };
  });

  var indicators = measuresBySortOrder(rawVars).map(function (v) {
    return {
      key: v.name,
      name: v.label || v.name,
      value: varValues[v.name],
      visibility: v.learnerVisibility || 'hidden',
      interpretation: TB.parseIndicatorInterpretation(v.configJson)
    };
  });

  var passRule = TD.overallPassRule;
  return {
    ramp: resultsLevelRamp(params),
    scaleKind: String(params.scaleRenderKind || 'band_ruler'),
    indicatorKind: String(params.indicatorRenderKind || 'label'),
    scales: scales,
    indicators: indicators,
    // The stored block addresses its PDF assets through `scormHref`, the builder
    // consumes `{ title, url }`. Normalising is NOT idempotent (a normalised block has
    // no `scormHref` left), so the TEST-level block is normalised here — exactly once —
    // while the fired band/outcome blocks are normalised inside the builder.
    testFeedback: TB.normalizeFeedback(TD.testFeedbackJson || null),
    hasPassThreshold: !!(passRule && passRule.type && passRule.type !== 'none'),
    blockSettings: resultsBlockSettings()
  };
}

/**
 * PRD-29 measures of the attempt being finished. `renderResults` computes scale.* and
 * result.* before persisting the attempt, so screen and record agree; recomputing here
 * is the fallback for any other entry into this renderer and is deterministic — the
 * same answers yield the same values (NFR-04).
 */
function currentAttemptMeasures(results) {
  var scaleComp = results.scaleComputation ||
    ((typeof computeTestScales === 'function') ? computeTestScales() : null);
  var varComp = results.resultComputation ||
    ((typeof computeTestResultVariables === 'function') ? computeTestResultVariables(results, scaleComp) : null);
  return buildResultsMeasures(scaleComp, varComp);
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
  // PRD-29: a SAVED attempt renders from the values persisted WITH it and never from a
  // recomputation — regrading a finished attempt against today's interpretation would
  // change what the learner already scored (the rule the web host follows too).
  var opts = {
    withTopicPoints: true,
    recommendedCourses: rec.courses,
    recommendedEvents: rec.events
  };
  var measures = buildResultsMeasures(
    { values: results.scaleValues || {} },
    { values: results.resultValues || {} }
  );
  if (measures) opts.measures = measures;
  var ctx = window.TBTemplate.buildResultContext(input, TEST_DATA.title || '', opts);
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
  var opts = {
    withTopicPoints: true,
    recommendedCourses: rec.courses,
    recommendedEvents: rec.events
  };
  // PRD-29: scales and indicators of THIS attempt (null for a test that declares none,
  // which leaves the context byte-identical to what it has always been).
  var measures = currentAttemptMeasures(results);
  if (measures) opts.measures = measures;
  var ctx = window.TBTemplate.buildResultContext(input, TEST_DATA.title || '', opts);
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