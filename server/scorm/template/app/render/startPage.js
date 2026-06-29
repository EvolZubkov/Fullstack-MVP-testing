/**
 * Renders the start screen. Primary path renders the shared `start` layout via the
 * SHARED renderer (the SAME layout + renderer the web host mounts) from a public
 * context; the SCORM-richer actions (resume-with-position, "Начать заново", "Мой
 * результат") are gated layout blocks the web context does not set, and the
 * web-only "back to list" action is likewise gated off here. Falls back to the
 * bespoke chrome for adaptive mode or when the design template is absent.
 */
function renderStartPage() {
  // PRD-7 G21: `systemLayout('start')` is the bundled default's start when the
  // active template doesn't declare a `start` contentTemplate.
  var layout = (typeof systemLayout === 'function') ? systemLayout('start') : (state && state.templateLayouts && state.templateLayouts['start']);
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (layout && TB && TB.renderScreenInto && TEST_DATA.mode !== 'adaptive') {
    renderStartPageTemplated();
    return;
  }
  renderStartPageFallback();
}

/**
 * Gathers the SCORM start facts (incl. resume eligibility — session staleness /
 * time-limit / adaptive checks) and delegates the action-flag assembly to the
 * SHARED builder (TBTemplate.buildStartState), so the SCORM and web start screens
 * produce the identical model. Returns the full `{ course, state }` context.
 */
function buildScormStartContext() {
  var used = getAttemptsUsed();
  var hasLimit = !!TEST_DATA.maxAttempts;
  var hasCompleted = !!getAllAttempts() && getAllAttempts().length > 0;
  var canStartNew = hasAttemptsLeft();

  var suspendObj = readSuspendObj();
  var pendingSession = suspendObj.currentSession;
  var canResume = !!(
    pendingSession &&
    !TEST_DATA.timeLimitMinutes &&
    TEST_DATA.mode !== 'adaptive' &&
    pendingSession.flatQuestions &&
    pendingSession.flatQuestions.length > 0 &&
    !isSessionStale(pendingSession)
  );

  return window.TBTemplate.buildStartState({
    info: {
      title: TEST_DATA.title,
      description: TEST_DATA.description || '',
      questionCount: TEST_DATA.totalQuestions,
      passPercent: TEST_DATA.passPercent,
      timeLimitMinutes: TEST_DATA.timeLimitMinutes,
      maxAttempts: TEST_DATA.maxAttempts,
      // PRD-7 S10: startPageContent migrated to an intro content page; not shown here.
      startPageContent: ''
    },
    maxAttempts: hasLimit ? TEST_DATA.maxAttempts : null,
    completedAttempts: used,
    resume: canResume ? { index: (pendingSession.currentIndex || 0), total: pendingSession.flatQuestions.length } : null,
    hasCompletedResults: hasCompleted,
    canStartNew: canStartNew,
    showBack: false
  });
}

/** Wire a data-action button (if present) to a runtime handler. */
function wireStartAction(root, action, fn) {
  var btn = root.querySelector('[data-action="' + action + '"]');
  if (btn) btn.onclick = fn;
}

/**
 * Resolve per-test branding for the render context (`design.*`, PRD-7). The logo
 * param is baked into TEST_DATA as a media envelope `{ url, name, … }` (or a bare
 * string for legacy values); the layout binds a plain URL string, so `.url` is
 * unwrapped here — mirroring the web host's server-side `resolveLogoUrl`.
 */
function scormDesignContext() {
  var p = (typeof TEST_DATA !== 'undefined' && TEST_DATA.designSettings) ? TEST_DATA.designSettings.params : null;
  var logo = p ? p.logoUrl : null;
  var url = '';
  if (logo && typeof logo === 'object' && typeof logo.url === 'string') url = logo.url;
  else if (typeof logo === 'string') url = logo;
  return url ? { logoUrl: url } : {};
}

/** Build the start context (shared builder) and mount the shared layout (standard mode). */
function renderStartPageTemplated() {
  var app = document.getElementById('app');
  var ctx = buildScormStartContext();
  ctx.design = scormDesignContext();
  // PRD-7 G21: when `start` falls back to default, mount default's layout AND
  // activate default's stylesheet so the screen is fully styled.
  var layout = (typeof systemLayout === 'function') ? systemLayout('start') : state.templateLayouts['start'];
  if (typeof applySystemScreenStyles === 'function') applySystemScreenStyles('start');
  app.innerHTML = '';
  var wrap = document.createElement('div');
  app.appendChild(wrap);
  window.TBTemplate.renderScreenInto(wrap, { layout: layout, context: ctx });
  wireStartAction(wrap, 'start-test', startTest);
  wireStartAction(wrap, 'resume', continueSession);
  wireStartAction(wrap, 'restart', startTest);
  wireStartAction(wrap, 'view-results', viewSavedResults);
}

function renderStartPageFallback() {
  var app = document.getElementById('app');
  var used = getAttemptsUsed();
  var hasLimit = !!TEST_DATA.maxAttempts;
  var left = hasLimit ? Math.max(0, TEST_DATA.maxAttempts - used) : null;

  function pluralizeTopics(n) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 19) return 'тем';
    if (mod10 === 1) return 'тема';
    if (mod10 >= 2 && mod10 <= 4) return 'темы';
    return 'тем';
  }

  function pluralizeLevels(n) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 19) return 'уровней';
    if (mod10 === 1) return 'уровень';
    if (mod10 >= 2 && mod10 <= 4) return 'уровня';
    return 'уровней';
  }

  var iconQuestions = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>';
  var iconPass = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  var iconTime = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  var iconAttempts = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>';

  var html = '<div class="start-page" style="max-width:600px;margin:40px auto;padding:0 18px;">';

  // Header card
  html += '<div class="card" style="padding:32px;text-align:center;margin-bottom:24px;background:hsl(var(--card));border:1px solid hsl(var(--border));">';
  html += '<h1 style="color:hsl(var(--foreground));margin:0;font-size:28px;font-weight:700;">' + escapeHtml(TEST_DATA.title) + '</h1>';
  if (TEST_DATA.description) {
    html += '<p style="color:hsl(var(--muted-foreground));margin-top:12px;margin-bottom:0;font-size:15px;">' + escapeHtml(TEST_DATA.description) + '</p>';
  }
  html += '</div>';

  // Info section
  html += '<div class="card" style="padding:24px;background:hsl(var(--card));border:1px solid hsl(var(--border));">';
  html += '<h2 style="margin:0 0 20px 0;font-size:18px;font-weight:700;color:hsl(var(--foreground));">Информация о тесте</h2>';

  html += '<div style="display:grid;gap:12px;">';

  // Количество вопросов / тем
  html += '<div style="display:flex;align-items:center;gap:12px;padding:16px;background:hsl(var(--muted));border-radius:12px;border:1px solid hsl(var(--border));">';
  html += '<div style="flex-shrink:0;color:#4f46e5;">' + iconQuestions + '</div>';
  if (TEST_DATA.mode === 'adaptive' && TEST_DATA.adaptiveTopics) {
    var topicCount = TEST_DATA.adaptiveTopics.length;
    var levelCount = TEST_DATA.adaptiveTopics.reduce(function (sum, t) { return sum + (t.levels ? t.levels.length : 0); }, 0);
    html += '<div style="flex:1;"><div style="font-weight:600;color:hsl(var(--foreground));font-size:14px;">Адаптивный тест</div><div style="color:hsl(var(--muted-foreground));font-size:13px;margin-top:2px;">' + topicCount + ' ' + pluralizeTopics(topicCount) + ', ' + levelCount + ' ' + pluralizeLevels(levelCount) + '</div></div>';
  } else {
    html += '<div style="flex:1;"><div style="font-weight:600;color:hsl(var(--foreground));font-size:14px;">Количество вопросов</div><div style="color:hsl(var(--muted-foreground));font-size:13px;margin-top:2px;">' + TEST_DATA.totalQuestions + '</div></div>';
  }
  html += '</div>';

  // Проходной балл (только для стандартного теста)
  if (TEST_DATA.mode !== 'adaptive') {
    html += '<div style="display:flex;align-items:center;gap:12px;padding:16px;background:hsl(var(--muted));border-radius:12px;border:1px solid hsl(var(--border));">';
    html += '<div style="flex-shrink:0;color:#16a34a;">' + iconPass + '</div>';
    html += '<div style="flex:1;"><div style="font-weight:600;color:hsl(var(--foreground));font-size:14px;">Проходной балл</div><div style="color:hsl(var(--muted-foreground));font-size:13px;margin-top:2px;">' + TEST_DATA.passPercent + '%</div></div>';
    html += '</div>';
  }

  // Ограничение времени
  if (TEST_DATA.timeLimitMinutes) {
    html += '<div style="display:flex;align-items:center;gap:12px;padding:16px;background:hsl(var(--muted));border-radius:12px;border:1px solid hsl(var(--border));">';
    html += '<div style="flex-shrink:0;color:#f59e0b;">' + iconTime + '</div>';
    html += '<div style="flex:1;"><div style="font-weight:600;color:hsl(var(--foreground));font-size:14px;">Ограничение времени</div><div style="color:hsl(var(--muted-foreground));font-size:13px;margin-top:2px;">' + TEST_DATA.timeLimitMinutes + ' минут</div></div>';
    html += '</div>';
  }

  // Количество попыток
  if (TEST_DATA.maxAttempts) {
    html += '<div style="display:flex;align-items:center;gap:12px;padding:16px;background:hsl(var(--muted));border-radius:12px;border:1px solid hsl(var(--border));">';
    html += '<div style="flex-shrink:0;color:#8b5cf6;">' + iconAttempts + '</div>';
    html += '<div style="flex:1;"><div style="font-weight:600;color:hsl(var(--foreground));font-size:14px;">Попытки</div><div style="color:hsl(var(--muted-foreground));font-size:13px;margin-top:2px;">'
      + (hasLimit ? ('осталось ' + left + ' из ' + TEST_DATA.maxAttempts) : 'без ограничений')
      + '</div></div>';
    html += '</div>';
  }

  html += '</div>';

  // PRD-7 S10: legacy `startPageContent` is no longer rendered here. Its content
  // is migrated to a `content_pages` 'intro' page (migration 003 §4.2) and played
  // as the first item of the page sequence by the content-flow runtime, so the
  // start overview no longer duplicates it.

  // ===== ЛОГИКА КНОПОК =====
  var noAttempts = hasLimit && left <= 0;
  var hasCompletedAttempts = !!getAllAttempts() && getAllAttempts().length > 0;
  var canStartNewAttempt = hasAttemptsLeft();

  if (noAttempts && !hasCompletedAttempts) {
    app.innerHTML = '<div class="card" data-layout="system.blocked" role="status" style="max-width:560px;margin:40px auto;text-align:center;">'
      + '<h1>Доступ к тесту ограничен</h1>'
      + '<p style="color:hsl(var(--muted-foreground));">Для этого теста больше нет доступных попыток.</p>'
      + '</div>';
    return;
  }

  // Проверяем есть ли незавершённая сессия для продолжения
  var suspendObj = readSuspendObj();
  var pendingSession = suspendObj.currentSession;
  var canResume = !!(
    pendingSession &&
    !TEST_DATA.timeLimitMinutes &&
    TEST_DATA.mode !== 'adaptive' &&
    pendingSession.flatQuestions &&
    pendingSession.flatQuestions.length > 0 &&
    !isSessionStale(pendingSession)
  );
  var resumeIndex = canResume ? (pendingSession.currentIndex || 0) : 0;
  var resumeTotal = canResume ? pendingSession.flatQuestions.length : 0;

  html += '<div style="margin-top:24px;">';

  // Случай 1: Попытки закончились, есть результаты — только "Мой результат"
  if (noAttempts && hasCompletedAttempts) {
    html += '<div style="text-align:center;">';
    html += '<button class="btn" onclick="viewSavedResults()" style="padding:14px 40px;font-size:16px;font-weight:600;">Мой результат</button>';
    html += '</div>';
  }
  // Случай 2: Есть незавершённая сессия — предлагаем продолжить
  else if (canResume) {
    html += '<div style="background:hsl(var(--muted));border-radius:12px;padding:16px;margin-bottom:16px;border:1px solid hsl(var(--border));text-align:center;">';
    html += '<div style="font-size:13px;color:hsl(var(--muted-foreground));margin-bottom:4px;">Незавершённый тест</div>';
    html += '<div style="font-size:14px;font-weight:600;color:hsl(var(--foreground));">Вопрос ' + (resumeIndex + 1) + ' из ' + resumeTotal + '</div>';
    html += '</div>';
    html += '<div style="display:flex;gap:12px;flex-direction:column;align-items:center;">';
    html += '<button class="btn" onclick="continueSession()" style="padding:14px 40px;font-size:16px;font-weight:600;">Продолжить с места остановки</button>';
    html += '<button class="btn" style="padding:14px 40px;font-size:16px;font-weight:600;background:hsl(var(--muted));color:hsl(var(--foreground));" onclick="startTest()">Начать заново</button>';
    if (hasCompletedAttempts) {
      html += '<button class="btn" style="padding:14px 40px;font-size:16px;font-weight:600;background:transparent;color:hsl(var(--muted-foreground));" onclick="viewSavedResults()">Мой результат</button>';
    }
    html += '</div>';
  }
  // Случай 3: Есть попытки И есть завершённые результаты — две кнопки
  else if (canStartNewAttempt && hasCompletedAttempts) {
    html += '<div style="display:flex;gap:12px;flex-direction:column;align-items:center;">';
    html += '<button class="btn" onclick="startTest()" style="padding:14px 40px;font-size:16px;font-weight:600;">Начать тестирование заново</button>';
    html += '<button class="btn" style="padding:14px 40px;font-size:16px;font-weight:600;background:hsl(var(--muted));color:hsl(var(--foreground));" onclick="viewSavedResults()">Мой результат</button>';
    html += '</div>';
  }
  // Случай 4: Первый вход или нет завершённых попыток
  else {
    html += '<div style="text-align:center;">';
    html += '<button class="btn" '
      + (noAttempts ? 'disabled ' : '')
      + 'onclick="' + (noAttempts ? 'return false;' : 'startTest()') + '" '
      + 'style="padding:14px 40px;font-size:16px;font-weight:600;'
      + (noAttempts ? 'opacity:.55;cursor:not-allowed;' : '')
      + '">'
      + (noAttempts ? 'Попытки закончились' : 'Начать тестирование')
      + '</button>';
    html += '</div>';
  }

  html += '</div>';

  // закрываем карточку и обёртку страницы
  html += '</div></div>';

  app.innerHTML = html;
}

function startTest() {
  if (!hasAttemptsLeft()) {
    showToast('Попытки закончились', 'warn');
    return;
  }

  // ===== СОХРАНЯЕМ ПРЕДЫДУЩУЮ ПОПЫТКУ ЕСЛИ ПОЛЬЗОВАТЕЛЬ РЕАЛЬНО ОТВЕЧАЛ =====
  // Проверяем что:
  // 1. Есть вопросы в текущем варианте
  // 2. Пользователь прошёл хотя бы один вопрос (currentIndex > 0)
  // 3. Была зарегистрирована попытка (attemptsUsed > 0)
  var hasRealProgress = state.flatQuestions &&
    state.flatQuestions.length > 0 &&
    state.currentIndex > 0 &&
    getAttemptsUsed() > 0;

  if (hasRealProgress) {
    console.log('💾 Сохраняем предыдущую попытку перед новым стартом');
    var results = calculateResults();
    saveAttemptResult(results);

    // Сохраняем текущий номер попытки ДО любых изменений
    var currentAttemptNum = Telemetry.getAttemptNumber();

    // ===== ОТПРАВЛЯЕМ ТЕЛЕМЕТРИЮ FINISH ДЛЯ ЭТОЙ ПОПЫТКИ =====
    Telemetry.finish({
      percent: results.percent,
      passed: results.passed,
      earnedPoints: results.earnedPoints,
      possiblePoints: results.possiblePoints,
      totalQuestions: results.totalQuestions,
      correct: results.correct,
      achievedLevels: results.achievedLevels || null
    }, currentAttemptNum);
    console.log('📤 Телеметрия finish отправлена для попытки:', currentAttemptNum);

    // Сбрасываем state для новой попытки
    state.answers = {};
    state.currentIndex = 0;
    state.submitted = false;
    state.feedbackShown = false;
    state.timeExpired = false;
    state.variant = null;
    state.flatQuestions = [];
    state.shuffleMappings = {};

    // Генерируем новый вариант
    generateVariant();
  }

  // фиксируем начало попытки
  var ok = registerAttemptStart();
  if (!ok) {
    showToast('Попытки закончились', 'warn');
    return;
  }

  // Send telemetry start
  Telemetry.start();

  if (typeof goToPageSequenceIndex === 'function') goToPageSequenceIndex(0);
  else state.phase = 'question';
  initTimer();
  render();
}

// ============================================
// ЗАМЕНИ функцию restart() в startPage.js на эту:
// ============================================

function restart() {
  if (!hasAttemptsLeft()) {
    showToast('Попытки закончились', 'warn');
    return;
  }

  // ===== СОХРАНЯЕМ ТЕКУЩУЮ ПОПЫТКУ ЕСЛИ ПОЛЬЗОВАТЕЛЬ РЕАЛЬНО ОТВЕЧАЛ =====
  var hasRealProgress = state.flatQuestions &&
    state.flatQuestions.length > 0 &&
    state.currentIndex > 0 &&
    getAttemptsUsed() > 0;

  if (hasRealProgress) {
    console.log('💾 Сохраняем текущую попытку перед перезапуском');
    var results = calculateResults();
    saveAttemptResult(results);

    // Сохраняем текущий номер попытки ДО увеличения
    var currentAttemptNum = Telemetry.getAttemptNumber();

    // Отправляем телеметрию finish с явным номером попытки
    Telemetry.finish({
      percent: results.percent,
      passed: results.passed,
      earnedPoints: results.earnedPoints,
      possiblePoints: results.possiblePoints,
      totalQuestions: results.totalQuestions,
      correct: results.correct,
      achievedLevels: results.achievedLevels || null
    }, currentAttemptNum);
  }

  // ===== ПОЛНЫЙ СБРОС STATE =====
  state.answers = {};
  state.currentIndex = 0;
  state.phase = 'start';
  state.timeExpired = false;
  state.submitted = false;
  state.answerConfirmed = false;
  state.feedbackShown = false;  // <-- ЭТО КЛЮЧЕВОЕ!
  state.variant = null;
  state.flatQuestions = [];
  state.shuffleMappings = {};
  state.matchingPools = {};

  // Сброс таймера
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  state.remainingSeconds = null;

  // Сброс adaptive state если есть
  if (state.adaptiveState) {
    state.adaptiveState = null;
  }

  // ===== ОЧИСТКА DOM от старого фидбека =====
  var feedbackBlock = document.querySelector('.feedback-block');
  if (feedbackBlock) {
    feedbackBlock.remove();
  }

  // Удаляем классы подсветки ответов
  document.querySelectorAll('.correct-answer, .incorrect-answer').forEach(function (el) {
    el.classList.remove('correct-answer', 'incorrect-answer');
  });

  // ===== ГЕНЕРАЦИЯ НОВОГО ВАРИАНТА =====
  generateVariant();

  // ===== ТЕЛЕМЕТРИЯ: НОВАЯ ПОПЫТКА =====
  Telemetry.startNewAttempt();

  // ===== РЕГИСТРАЦИЯ ПОПЫТКИ В SCORM =====
  var ok = registerAttemptStart();
  if (!ok) {
    showToast('Попытки закончились', 'warn');
    return;
  }

  // ===== ЗАПУСК ТЕСТА =====
  if (typeof goToPageSequenceIndex === 'function') goToPageSequenceIndex(0);
  else state.phase = 'question';
  initTimer();
  render();
}

window.restart = restart;

// ===== ПРОСМОТР СОХРАНЁННЫХ РЕЗУЛЬТАТОВ =====
function viewSavedResults() {
  var bestAttempt = getBestAttempt();
  if (!bestAttempt) {
    showToast('Нет завершённых попыток', 'warn');
    return;
  }

  console.log('📊 Просмотр лучшей попытки:', Math.round(bestAttempt.percent) + '%');

  state.phase = 'viewResults';
  state.viewedAttempt = bestAttempt;
  render();
}

window.viewSavedResults = viewSavedResults;

// ===== ПРОДОЛЖЕНИЕ НЕЗАВЕРШЁННОЙ СЕССИИ =====
function continueSession() {
  var recovery = determineRecovery();
  if (recovery.action !== 'restore') {
    showToast('Нет незавершённой сессии', 'warn');
    return;
  }
  restoreSession(recovery.session);
  // PRD-19 (Block B): mirror the bootstrap restore path — rebuild the page
  // sequence and jump to the resumed question item so syncPhaseToCurrentPage
  // re-establishes state.activeSectionTopic and the timer/freeze hooks. Without
  // this the first post-restore section boundary fails to freeze the prior
  // section (answerCommitScope='section').
  if (typeof rebuildPageSequence === 'function') {
    rebuildPageSequence();
    var qIndex = state.currentIndex || 0;
    var itemIndex = (state.pageSequence || []).findIndex(function (item) {
      return item && item.kind === 'question' && item.questionIndex === qIndex;
    });
    if (typeof goToPageSequenceIndex === 'function') {
      goToPageSequenceIndex(itemIndex >= 0 ? itemIndex : 0);
    }
  }
  render();
}

window.continueSession = continueSession;
