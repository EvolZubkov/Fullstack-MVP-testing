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

/** Per-topic pass threshold label from the section's pass rule (SCORM-extra). */
function vrRequiredLabel(topicId) {
  var section = TEST_DATA.sections.find(function (s) { return s.topicId === topicId; });
  if (section && section.topicPassRule && section.topicPassRule.type === 'percent') {
    return 'Требуется: ' + section.topicPassRule.value + '%';
  }
  return undefined;
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
        requiredLabel: vrRequiredLabel(tr.topicId),
        topicFeedback: tr.topicFeedback
      };
    })
  };
  var ctx = window.TBTemplate.buildResultContext(input, TEST_DATA.title || '', {
    withTopicPoints: true,
    recommendedCourses: rec.courses,
    recommendedEvents: rec.events,
    backAction: 'back-to-start',
    backLabel: 'Вернуться к тесту'
  });
  ctx.design = (typeof scormDesignContext === 'function') ? scormDesignContext() : {};

  // PRD-7 G21: mount default's results layout + activate default's stylesheet
  // when `results` falls back to the default template.
  var layout = (typeof systemLayout === 'function') ? systemLayout('results') : state.templateLayouts['results'];
  if (typeof applySystemScreenStyles === 'function') applySystemScreenStyles('results');
  app.innerHTML = '';
  var wrap = document.createElement('div');
  app.appendChild(wrap);
  window.TBTemplate.renderScreenInto(wrap, { layout: layout, context: ctx });
  var backBtn = wrap.querySelector('[data-action="back-to-start"]');
  if (backBtn) backBtn.onclick = backToStart;
}

function renderViewResultsFallback() {
  var app = document.getElementById('app');
  var attempt = state.viewedAttempt;

  if (!attempt) {
    app.innerHTML = '<div style="padding:20px;"><p>Нет данных о попытке</p></div>';
    return;
  }

  // Используем сохраненные данные результатов
  var results = attempt;
  var pct = Math.round(results.percent);
  var passed = !!results.passed;

  // ring
  var size = 140;
  var stroke = 14;
  var r = (size - stroke) / 2;
  var c = 2 * Math.PI * r;
  var offset = c - (pct / 100) * c;

  var html = '';
  html += '<div class="results-page">';

  // Top hero
  html +=   '<div class="results-hero">';
  html +=     '<div class="results-hero-icon ' + (passed ? 'is-pass' : 'is-fail') + '">';
  html +=       '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">';
  html +=         passed
    ? '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10"/><path d="M17 4v5a5 5 0 0 1-10 0V4"/><path d="M5 6h2"/><path d="M17 6h2"/>'
    : '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6"/><path d="M15 9l-6 6"/>';
  html +=       '</svg>';
  html +=     '</div>';
  html +=     '<div class="results-hero-title">' + (passed ? 'Поздравляем!' : 'Тест не пройден') + '</div>';
  html +=     '<div class="results-hero-sub">' + (passed ? 'Вы успешно прошли тест.' : 'Попробуйте ещё раз.') + '</div>';
  html +=   '</div>';

  // Main card
  html +=   '<div class="card results-main-card">';
  html +=     '<div class="results-main-title">' + escapeHtml(TEST_DATA.title || '') + '</div>';
  html +=     '<div class="results-main-sub">Результаты теста</div>';

  html +=     '<div class="results-ring">';
  html +=       '<svg viewBox="0 0 ' + size + ' ' + size + '">';
  html +=         '<circle cx="' + (size/2) + '" cy="' + (size/2) + '" r="' + r + '" class="ring-bg" stroke-width="' + stroke + '" fill="none"></circle>';
  html +=         '<circle cx="' + (size/2) + '" cy="' + (size/2) + '" r="' + r + '" class="ring-fg ' + (passed ? 'is-pass' : 'is-fail') + '" stroke-width="' + stroke + '" fill="none" stroke-linecap="round"';
  html +=           ' style="stroke-dasharray:' + c.toFixed(2) + ';stroke-dashoffset:' + offset.toFixed(2) + '"></circle>';
  html +=       '</svg>';
  html +=       '<div class="results-ring-center">';
  html +=         '<div class="results-ring-pct">' + pct + '%</div>';
  html +=         '<div class="results-ring-label">Баллы</div>';
  html +=       '</div>';
  html +=     '</div>';

  html +=     '<div class="results-stats">';
  html +=       '<div class="results-stat"><div class="v">' + results.totalQuestions + '</div><div class="l">Вопросов</div></div>';
  html +=       '<div class="results-stat"><div class="v">' + (results.totalCorrect || results.correct) + '/' + results.totalQuestions + '</div><div class="l">Верно</div></div>';
  html +=       '<div class="results-stat"><div class="v">' + (parseFloat(results.earnedPoints) || 0).toFixed(1) + '</div><div class="l">Баллов</div></div>';
  html +=       '<div class="results-pill ' + (passed ? 'is-pass' : 'is-fail') + '">' + (passed ? 'Пройден' : 'Не пройден') + '</div>';
  html +=     '</div>';
  html +=   '</div>';

  // Topics
  html +=   '<div class="results-section-title">Результаты по темам</div>';
  html +=   '<div class="results-topics-grid">';

  results.topicResults.forEach(function(tr) {
    var tpct = Math.round(tr.percent || 0);
    var tpass = (tr.passed === null) ? null : !!tr.passed;

    html += '<div class="card topic-card">';
    html +=   '<div class="topic-head">';
    html +=     '<div class="topic-left">';
    html +=       '<div class="topic-icon ' + (tpass ? 'is-pass' : 'is-fail') + '">';
    html +=         '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">';
    html +=           tpass ? '<path d="M20 6 9 17l-5-5"/>' : '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>';
    html +=         '</svg>';
    html +=       '</div>';
    html +=       '<div class="topic-name">' + escapeHtml(tr.topicName || '') + '</div>';
    html +=     '</div>';
    if (tpass !== null) {
      html +=   '<div class="results-pill ' + (tpass ? 'is-pass' : 'is-fail') + '">' + (tpass ? 'Пройден' : 'Нет') + '</div>';
    }
    html +=   '</div>';

    html +=   '<div class="topic-row">';
    html +=     '<div class="k">Вопросов</div>';
    html +=     '<div class="val">' + tr.total + ' / ' + tr.total + ' (' + tpct + '%)</div>';
    html +=   '</div>';

    html +=   '<div class="topic-row">';
    html +=     '<div class="k">Баллов</div>';
    html +=     '<div class="val">' + tr.earnedPoints.toFixed(1) + ' / ' + tr.possiblePoints.toFixed(1) + '</div>';
    html +=   '</div>';

    html +=   '<div class="topic-bar ' + (tpass ? 'is-pass' : 'is-fail') + '"><div style="width:' + Math.min(100, Math.max(0, tpct)) + '%"></div></div>';

    // если у темы есть passRule percent — покажем "Требуется: X%"
    var section = TEST_DATA.sections.find(function(s) { return s.topicId === tr.topicId; });
    if (section && section.topicPassRule && section.topicPassRule.type === 'percent') {
      html += '<div class="topic-required">Требуется: ' + section.topicPassRule.value + '%</div>';
    }

    // Обратная связь по теме
    if (tr.topicFeedback && tr.topicFeedback.trim()) {
      html += '<div class="topic-feedback">';
      html += '<div class="topic-feedback-icon">💬</div>';
      html += '<div class="topic-feedback-text">' + escapeHtml(tr.topicFeedback) + '</div>';
      html += '</div>';
    }

    html += '</div>';
  });

  html +=   '</div>';

  // Recommended Courses & Events Section — with deduplication across failed topics
  var seenCourseTitles = {};
  var seenEventTitles = {};
  var allFailedCourses = [];
  var allFailedEvents = [];

  results.topicResults.forEach(function(tr) {
    if (tr.passed !== false) return;
    var section = TEST_DATA.sections.find(function(s) { return s.topicId === tr.topicId; });
    var courses = (section && section.recommendedCourses && section.recommendedCourses.length > 0)
      ? section.recommendedCourses
      : (tr.recommendedCourses || []);
    var events = (section && section.recommendedEvents) ? section.recommendedEvents : [];

    courses.forEach(function(course) {
      if (!seenCourseTitles[course.title]) {
        seenCourseTitles[course.title] = true;
        allFailedCourses.push(course);
      }
    });
    events.forEach(function(ev) {
      if (!seenEventTitles[ev.title]) {
        seenEventTitles[ev.title] = true;
        allFailedEvents.push(ev);
      }
    });
  });

  if (allFailedCourses.length > 0) {
    html += '<div class="results-section-title">Рекомендуемые курсы</div>';
    html += '<div style="margin-bottom:14px;color:hsl(var(--muted-foreground));font-size:14px;">';
    html += 'Изучите эти материалы для улучшения знаний по темам, которые требуют внимания.';
    html += '</div>';

    allFailedCourses.forEach(function(course) {
      html += '<div style="display:flex;align-items:center;gap:10px;padding:10px;background:hsl(var(--muted)/.5);border-radius:8px;margin-bottom:8px;">';
      html += '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary))" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
      html += '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>';
      html += '</svg>';
      html += '<a href="' + escapeHtml(course.url) + '" target="_blank" rel="noopener noreferrer" style="flex:1;color:hsl(var(--primary));text-decoration:none;font-weight:500;font-size:14px;">';
      html += escapeHtml(course.title);
      html += '</a>';
      html += '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--muted-foreground))" stroke-width="2">';
      html += '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/>';
      html += '</svg>';
      html += '</div>';
    });
  }

  if (allFailedEvents.length > 0) {
    html += '<div class="results-section-title" style="margin-top:20px;">Рекомендуемые мероприятия</div>';
    html += '<div style="margin-bottom:14px;color:hsl(var(--muted-foreground));font-size:14px;">';
    html += 'Посетите очные мероприятия для углублённого изучения материала.';
    html += '</div>';

    allFailedEvents.forEach(function(ev) {
      html += '<div style="display:flex;align-items:center;gap:10px;padding:10px;background:hsl(var(--muted)/.5);border-radius:8px;margin-bottom:8px;">';
      html += '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary))" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
      html += '<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>';
      html += '</svg>';
      html += '<span style="flex:1;font-weight:500;font-size:14px;color:hsl(var(--foreground));">';
      html += escapeHtml(ev.title);
      html += '</span>';
      html += '</div>';
    });
  }

  // Back button
  html += '<div class="results-actions">';
  html += '<button class="btn" onclick="backToStart()" style="padding:12px 32px;font-size:15px;">';
  html += 'Вернуться к тесту';
  html += '</button>';
  html += '</div>';

  html += '</div>';
  
  app.innerHTML = html;
}

function backToStart() {
  state.phase = 'start';
  state.viewedAttempt = null;
  render();
}