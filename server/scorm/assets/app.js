// Initialize

// PRD-11 stratified draw — plain-JS port of shared/draw/blueprint.ts. No
// blueprint => uniform draw (FR-02). Kept in golden parity with the TS source
// by tests/draw-blueprint-port.test.ts.
function drawSection(questions, drawCount, blueprint, shuffleFn) {
  if (!blueprint || !blueprint.strata || blueprint.strata.length === 0) {
    return { selected: shuffleFn(questions.slice()).slice(0, drawCount), warnings: [] };
  }
  var selected = [];
  var used = {};
  var warnings = [];
  // Per-tag mode, default 'exact' (PRD-11 §3a). Match on the normalized tag key
  // (trim + collapse spaces + lowercase) so "Финансы" matches "финансы".
  function tagKey(t) { return String(t).replace(/\s+/g, ' ').trim().toLowerCase(); }
  function effMode(s) { return s.mode || 'exact'; }
  var qKeys = {};
  questions.forEach(function (q) { qKeys[q.id] = (q.tags || []).map(tagKey); });
  function hasTag(q, key) { return (qKeys[q.id] || []).indexOf(key) !== -1; }
  var exactKeys = {};
  blueprint.strata.forEach(function (s) { if (effMode(s) === 'exact') exactKeys[tagKey(s.tag)] = true; });

  blueprint.strata.forEach(function (stratum) {
    var stratumKey = tagKey(stratum.tag);
    var pool = questions.filter(function (q) { return !used[q.id] && hasTag(q, stratumKey); });
    var take = shuffleFn(pool.slice()).slice(0, stratum.count);
    if (take.length < stratum.count) {
      warnings.push({ tag: stratum.tag, requested: stratum.count, available: take.length });
    }
    take.forEach(function (q) { used[q.id] = true; selected.push(q); });
  });

  var remainder = drawCount - selected.length;
  if (remainder > 0) {
    var free = questions.filter(function (q) {
      return !used[q.id] && !(qKeys[q.id] || []).some(function (k) { return exactKeys[k]; });
    });
    shuffleFn(free.slice()).slice(0, remainder).forEach(function (q) { used[q.id] = true; selected.push(q); });
  }
  return { selected: selected.slice(0, drawCount), warnings: warnings };
}

// PRD-17 (BR-12) variant selection — plain-JS port of shared/draw/forms.ts. When a
// section runs in "variants mode" (formSet present) ONE author-curated variant is
// picked and delivered WHOLE, in random order (FR-04/FR-15). The SCORM package has
// no cross-attempt store (NFR-17), so previousFormIds is always empty here →
// rotation degrades to a random pick (a known web/SCORM parity gap, R-6). Kept in
// golden parity with the TS source by tests/forms-port.test.ts.
function selectForm(forms, previousFormIds, availableIds, shuffleFn) {
  var used = {};
  (previousFormIds || []).forEach(function (id) { used[id] = true; });
  // Rotation: prefer variants not seen before; when all seen, reset and cycle.
  var candidates = forms.filter(function (f) { return !used[f.id]; });
  if (candidates.length === 0) candidates = forms.slice();
  var chosen = shuffleFn(candidates.slice())[0];
  // Deliver the whole variant; drop questions no longer in the bank (FR-17), then
  // randomise presentation order (FR-15).
  var present = availableIds
    ? chosen.questionIds.filter(function (id) { return availableIds[id]; })
    : chosen.questionIds.slice();
  return { formId: chosen.id, questionIds: shuffleFn(present.slice()) };
}

// PRD-18 (debug player only): read the per-topic variant PINS the in-service debug
// player passes via the stage launch-URL hash (`#tbff=<encodeURIComponent(JSON)>`,
// a `{ topicId: formId }` map). Lets the methodologist force an exact variant instead
// of the random draw. Read under a guard: a production LMS launch carries no such
// hash (and runs on another origin), so this returns null and selection stays random
// — fully inert in production. Returns the parsed map or null.
function tbDebugForcedForms() {
  try {
    var h = (typeof window !== 'undefined' && window.location && window.location.hash) || '';
    var m = /(?:^#|[#&])tbff=([^&]+)/.exec(h);
    if (!m) return null;
    var map = JSON.parse(decodeURIComponent(m[1]));
    return (map && typeof map === 'object') ? map : null;
  } catch (e) { return null; }
}

function generateVariant() {
  state.variant = { sections: [] };
  state.flatQuestions = [];
  state.shuffleMappings = {}; // Store shuffle mappings for each question

  var usedIds = {}; // Track used question IDs across all sections to prevent duplicates
  // PRD-18 debug: per-topic pinned variants (null in production — inert).
  var tbForcedForms = tbDebugForcedForms();

  TEST_DATA.sections.forEach(function(section) {
    var available = section.questions.filter(function(q) { return !usedIds[q.id]; });
    var questions;
    // PRD-24: stable id of the variant delivered for this topic. Pinned into the
    // attempt state so grading can gate the topic by ITS variant's threshold
    // (`by_variant` rule). Stays null for non-variant topics.
    var deliveredFormId = null;
    if (section.formSet && section.formSet.forms && section.formSet.forms.length) {
      // PRD-17 variants mode (BR-12): deliver ONE curated variant whole, in random
      // order. No cross-attempt store in SCORM (NFR-17) → previousFormIds empty, so
      // the pick is effectively random. Map the chosen variant's ids back to the
      // live bank objects; a removed question is dropped (soft shortfall, FR-17).
      var availIds = {};
      var byId = {};
      available.forEach(function (q) { availIds[q.id] = true; byId[q.id] = q; });
      // PRD-18 debug: if this topic's variant is pinned, deliver EXACTLY that form
      // (still whole + bank-filtered + order-shuffled), bypassing the random pick.
      var forcedId = tbForcedForms ? tbForcedForms[section.topicId] : null;
      var forcedForm = forcedId
        ? section.formSet.forms.filter(function (f) { return f.id === forcedId; })[0]
        : null;
      var picked;
      if (forcedForm) {
        var present = forcedForm.questionIds.filter(function (id) { return availIds[id]; });
        picked = { formId: forcedForm.id, questionIds: shuffle(present.slice()) };
      } else {
        picked = selectForm(section.formSet.forms, [], availIds, shuffle);
      }
      questions = picked.questionIds.map(function (id) { return byId[id]; }).filter(Boolean);
      deliveredFormId = picked.formId;
    } else {
      var drawn = drawSection(available, section.drawCount, section.drawBlueprint, shuffle);
      questions = drawn.selected;
      if (drawn.warnings.length && typeof console !== 'undefined' && console.warn) {
        drawn.warnings.forEach(function (w) {
          console.warn('PRD-11 quota shortfall: tag "' + w.tag + '" requested ' + w.requested + ', available ' + w.available);
        });
      }
    }
    questions.forEach(function(q) { usedIds[q.id] = true; });
    state.variant.sections.push({
      topicId: section.topicId,
      topicName: section.topicName,
      questionIds: questions.map(function(q) { return q.id; }),
      // PRD-24 (FR-08): pin the delivered variant so grading, the «Требуется» label
      // and the debug inspector all read the SAME variant this run actually got.
      formId: deliveredFormId
    });
    questions.forEach(function(q) {
      // Generate shuffle mappings for each question type
      if (q.type === 'single' || q.type === 'multiple') {
        var optCount = q.data.options ? q.data.options.length : 0;
        if (optCount > 0) {
          state.shuffleMappings[q.id] = createShuffleMapping(optCount);
        }
      } else if (q.type === 'matching') {
        var leftCount = q.data.left ? q.data.left.length : 0;
        var rightCount = q.data.right ? q.data.right.length : 0;
        if (leftCount > 0 && rightCount > 0) {
          state.shuffleMappings[q.id] = {
            left: createShuffleMapping(leftCount),
            right: createShuffleMapping(rightCount)
          };
        }
      } else if (q.type === 'ranking') {
        var itemCount = q.data.items ? q.data.items.length : 0;
        if (itemCount > 0) {
          // Guaranteed non-correct delivery order: an untouched arrangement can
          // never score correct by luck (see createRankingOrder).
          state.shuffleMappings[q.id] = createRankingOrder(itemCount, q.correct && q.correct.correctOrder);
          // Initialize ranking with the (non-correct) delivered order
          if (!state.answers[q.id]) {
            state.answers[q.id] = state.shuffleMappings[q.id].slice();
          }
        }
      }

      state.flatQuestions.push({
        question: q,
        topicId: section.topicId,
        topicName: section.topicName
      });
    });
  });
  // PRD-4 v1.1: global shuffle only applies to legacy_flat mode. For sectional
  // modes (linear_by_topics / router_by_topics) the section boundary must be
  // preserved — questions stay grouped by topic in the order sections were
  // listed by the author. Questions within a section are still shuffled at
  // selection time (see `shuffle(available)` above), but no cross-section
  // mixing.
  var flowMode =
    TEST_DATA.flowPolicy && TEST_DATA.flowPolicy.mode
      ? TEST_DATA.flowPolicy.mode
      : 'linear_flat';
  if (flowMode === 'linear_flat') {
    state.flatQuestions = shuffle(state.flatQuestions);
  }
  // PRD-19 (Block B): seed per-question status for the freshly built variant.
  // Every delivered question starts 'unanswered'; confirmAnswer / skipQuestion
  // transition it. Done here (post-shuffle) so the keys match flatQuestions.
  state.questionStatuses = {};
  state.sectionCommitted = {};
  state.flatQuestions.forEach(function (fq) {
    if (fq && fq.question) state.questionStatuses[fq.question.id] = 'unanswered';
  });
  if (typeof rebuildPageSequence === 'function') {
    rebuildPageSequence();
    goToPageSequenceIndex(0);
  }
}

function renderResults() {
  var results = calculateResults();

  // ✅ Сразу сохраняем результат попытки при показе результатов
  if (typeof saveAttemptResult === 'function' && !state.attemptSavedForThisSession) {
    saveAttemptResult(results);
    state.attemptSavedForThisSession = true;
    console.log('💾 renderResults: результат попытки сохранён', Math.round(results.percent) + '%');
  }

  var app = document.getElementById('app');
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  var resultsLayout = (typeof systemLayout === 'function')
    ? systemLayout('results')
    : (state.templateLayouts && state.templateLayouts['results']);

  // Revised «Стандартный»: render the FINISH results through the SHARED `results`
  // layout + renderer (TBTemplate.renderScreenInto) — the SAME scene «Мой результат»
  // (renderViewResults) and the web host show. The legacy hand-built `results-page`
  // markup below is a last-resort fallback only: the revised theme no longer styles
  // those classes, so on the default template it collapsed to an empty card.
  if (resultsLayout && TB && TB.renderScreenInto && TB.buildResultContext &&
      typeof renderResultsTemplated === 'function') {
    renderResultsTemplated(app, results);
    return;
  }
  renderResultsLegacy(app, results);
}

function renderResultsLegacy(app, results) {
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

  // PRD-7 branding: logo at the top of the LIVE results screen — parity with the
  // templated results.html (web + «Мой результат»), which this legacy hand-built
  // renderer mirrors. Reuses the shared extractor (startPage.js) via a typeof guard.
  var resultsLogoUrl = (typeof scormDesignContext === 'function' && scormDesignContext().logoUrl) || '';
  if (resultsLogoUrl) {
    html +=   '<div class="tb-brand"><img class="tb-brand__logo" src="' + escapeHtml(resultsLogoUrl) + '" alt=""></div>';
  }

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
  html +=       '<div class="results-stat"><div class="v">' + results.correct + '/' + results.totalQuestions + '</div><div class="l">Верно</div></div>';
  html +=       '<div class="results-stat"><div class="v">' + results.earnedPoints.toFixed(1) + '</div><div class="l">Баллов</div></div>';
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

  // Actions
  var noAttempts = TEST_DATA.maxAttempts && !hasAttemptsLeft();

  html += '<div class="results-actions">';

  // PDF — всегда
  html += '<button class="btn btn-outline" onclick="downloadPDF()">📄 Скачать результаты (PDF)</button>';

  // "Пройти заново" — только если попытки остались И тест не пройден
  if (!results.passed && hasAttemptsLeft()) {
    html += '<button class="btn btn-outline" onclick="restart()">Пройти заново</button>';
  }

  // Test-scope «После теста» content pages declared after the summary render
  // after this screen — show «Далее» instead of finishing immediately.
  if (state.postResultsPages && state.postResultsPages.length > 0) {
    html += '<button class="btn" data-nav="next" onclick="enterPostResults()">Далее</button>';
  } else {
    // "Завершить" — всегда
    html += '<button class="btn" onclick="finishAndClose()">Завершить тест</button>';
  }

  html += '</div>';

  app.innerHTML = html;
  //finishScorm(results);
}


function downloadPDF(preferBest) {
  // PRD-19 FR-19: `preferBest` forces the BEST saved attempt (the start screen's
  // «Скачать отчёт» — there is no current attempt yet), else the usual rules apply.
  var noAttempts = TEST_DATA.maxAttempts && !hasAttemptsLeft();

  // ФИО из LMS (SCORM 2004: cmi.learner_name, часто "Фамилия, Имя")
  var rawName = (typeof SCORM !== 'undefined' ? SCORM.getValue('cmi.learner_name') : '') || '';
  var learnerName = '';
  if (rawName.trim()) {
    var parts = rawName.split(',');
    if (parts.length === 2) {
      learnerName = parts[1].trim() + ' ' + parts[0].trim();
    } else {
      learnerName = rawName.trim();
    }
  }

  var resultsToExport;
  var timestamp;

  if (TEST_DATA.mode === 'adaptive' && state.adaptiveState && state.adaptiveState.result) {
    // Адаптивный режим — всегда текущий результат
    var adaptiveResult = state.adaptiveState.result;
    resultsToExport = {
      topicResults: adaptiveResult.topicResults.map(function(tr) {
        return {
          topicName: tr.topicName,
          topicId: tr.topicId,
          achievedLevelIndex: tr.achievedLevelIndex,
          achievedLevelName: tr.achievedLevelName,
          totalQuestionsAnswered: tr.totalQuestionsAnswered,
          totalCorrect: tr.totalCorrect,
          feedback: tr.feedback,
          recommendedLinks: tr.recommendedLinks || []
        };
      })
    };
    timestamp = new Date().toISOString();
  } else {
    // Стандартный режим
    if (noAttempts || preferBest) {
      // Попытки кончились ИЛИ запрошен отчёт со старта — лучшая попытка
      var bestAttempt = getBestAttempt();
      resultsToExport = bestAttempt || calculateResults();
      timestamp = bestAttempt ? bestAttempt.completedAt : new Date().toISOString();
    } else {
      // Попытки остались — текущая попытка
      var lastAttempt = getLastAttempt();
      resultsToExport = lastAttempt || calculateResults();
      timestamp = lastAttempt ? lastAttempt.completedAt : new Date().toISOString();
    }
  }

  exportResultsToPDF(resultsToExport, TEST_DATA.title || 'Результаты теста', learnerName, timestamp);
}

// ✅ НОВАЯ ФУНКЦИЯ: Просмотр сохраненных результатов
function viewSavedResults() {
  var bestAttempt = getBestAttempt();
  if (!bestAttempt) {
    showToast('Нет сохраненных результатов', 'warn');
    return;
  }
  
  renderSavedResults(bestAttempt);
}

function renderSavedResults(attempt) {
  var app = document.getElementById('app');
  var percent = Math.round(attempt.percent);
  var passed = !!attempt.passed;
  
  // ring
  var size = 140;
  var stroke = 14;
  var r = (size - stroke) / 2;
  var c = 2 * Math.PI * r;
  var offset = c - (percent / 100) * c;

  var html = '';
  html += '<div class="results-page">';

  // PRD-7 branding: logo on the saved-results screen too, for parity with the live
  // results screen and the templated results.html.
  var savedLogoUrl = (typeof scormDesignContext === 'function' && scormDesignContext().logoUrl) || '';
  if (savedLogoUrl) {
    html +=   '<div class="tb-brand"><img class="tb-brand__logo" src="' + escapeHtml(savedLogoUrl) + '" alt=""></div>';
  }

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
  html +=     '<div class="results-hero-sub">Лучший результат из ' + getAllAttempts().length + ' попыток</div>';
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
  html +=         '<div class="results-ring-pct">' + percent + '%</div>';
  html +=         '<div class="results-ring-label">Баллы</div>';
  html +=       '</div>';
  html +=     '</div>';

  html +=     '<div class="results-stats">';
  html +=       '<div class="results-stat"><div class="v">' + attempt.totalQuestions + '</div><div class="l">Вопросов</div></div>';
  html +=       '<div class="results-stat"><div class="v">' + attempt.totalCorrect + '/' + attempt.totalQuestions + '</div><div class="l">Верно</div></div>';
  html +=       '<div class="results-stat"><div class="v">' + attempt.earnedPoints.toFixed(1) + '</div><div class="l">Баллов</div></div>';
  html +=       '<div class="results-pill ' + (passed ? 'is-pass' : 'is-fail') + '">' + (passed ? 'Пройден' : 'Не пройден') + '</div>';
  html +=     '</div>';
  html +=   '</div>';

  // Topics
  html +=   '<div class="results-section-title">Результаты по темам</div>';
  html +=   '<div class="results-topics-grid">';

  attempt.topicResults.forEach(function(tr) {
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

    html += '</div>';
  });

  html +=   '</div>';

  // Recommended Courses & Events — with deduplication across failed topics
  var seenCourseTitles2 = {};
  var seenEventTitles2 = {};
  var allFailedCourses2 = [];
  var allFailedEvents2 = [];

  attempt.topicResults.forEach(function(tr) {
    if (tr.passed !== false) return;
    var section = TEST_DATA.sections.find(function(s) { return s.topicId === tr.topicId; });
    var courses = (section && section.recommendedCourses && section.recommendedCourses.length > 0)
      ? section.recommendedCourses
      : (tr.recommendedCourses || []);
    var events = (section && section.recommendedEvents) ? section.recommendedEvents : [];

    courses.forEach(function(course) {
      if (!seenCourseTitles2[course.title]) {
        seenCourseTitles2[course.title] = true;
        allFailedCourses2.push(course);
      }
    });
    events.forEach(function(ev) {
      if (!seenEventTitles2[ev.title]) {
        seenEventTitles2[ev.title] = true;
        allFailedEvents2.push(ev);
      }
    });
  });

  if (allFailedCourses2.length > 0) {
    html += '<div class="results-section-title">Рекомендуемые курсы</div>';
    html += '<div style="margin-bottom:14px;color:hsl(var(--muted-foreground));font-size:14px;">';
    html += 'Изучите эти материалы для улучшения знаний по темам, которые требуют внимания.';
    html += '</div>';

    allFailedCourses2.forEach(function(course) {
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

  if (allFailedEvents2.length > 0) {
    html += '<div class="results-section-title" style="margin-top:20px;">Рекомендуемые мероприятия</div>';
    html += '<div style="margin-bottom:14px;color:hsl(var(--muted-foreground));font-size:14px;">';
    html += 'Посетите очные мероприятия для углублённого изучения материала.';
    html += '</div>';

    allFailedEvents2.forEach(function(ev) {
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

  // Actions
  html += '<div class="results-actions">';
  html += '<button class="btn btn-outline" onclick="downloadPDF()">📄 Скачать результаты (PDF)</button>';
  html += '<button class="btn" onclick="backToStart()">Назад</button>';
  html += '</div>';

  app.innerHTML = html;
}

function backToStart() {
  state.phase = 'start';
  renderStartPage();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
