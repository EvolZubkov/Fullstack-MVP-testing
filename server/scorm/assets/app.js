// Initialize

function generateVariant() {
  state.variant = { sections: [] };
  state.flatQuestions = [];
  state.shuffleMappings = {}; // Store shuffle mappings for each question

  var usedIds = {}; // Track used question IDs across all sections to prevent duplicates

  TEST_DATA.sections.forEach(function(section) {
    var available = section.questions.filter(function(q) { return !usedIds[q.id]; });
    var questions = shuffle(available.slice()).slice(0, section.drawCount);
    questions.forEach(function(q) { usedIds[q.id] = true; });
    state.variant.sections.push({
      topicId: section.topicId,
      topicName: section.topicName,
      questionIds: questions.map(function(q) { return q.id; })
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
          state.shuffleMappings[q.id] = createShuffleMapping(itemCount);
          // Initialize ranking with shuffled order
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
  state.flatQuestions = shuffle(state.flatQuestions);
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

  // "Завершить" — всегда
  html += '<button class="btn" onclick="finishAndClose()">Завершить тест</button>';

  html += '</div>';

  app.innerHTML = html;
  //finishScorm(results);
}


function downloadPDF() {
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
    if (noAttempts) {
      // Попытки кончились — лучшая попытка
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
