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
  // PRD-19 FR-19 «повтор: можно»: prior-attempt summary + downloadable report from
  // the best saved attempt. Runs post-Initialize (suspend_data available); the
  // pre-Initialize cooldown gate builds its own minimal context without this.
  var best = (typeof getBestAttempt === 'function') ? getBestAttempt() : null;

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
    priorResult: best ? {
      percent: best.percent,
      passed: best.passed,
      attemptNumber: best.attemptNumber != null ? best.attemptNumber : null,
      maxAttempts: hasLimit ? TEST_DATA.maxAttempts : null
    } : null,
    canDownloadReport: !!best,
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
  // Mount directly into #app so .tb-pad > .cover fills the fixed stage — mirrors
  // renderGalleryPage (a wrapper div would defeat the child-combinator fill rule).
  window.TBTemplate.renderScreenInto(app, { layout: layout, context: ctx });
  wireStartAction(app, 'start-test', startTest);
  wireStartAction(app, 'resume', continueSession);
  wireStartAction(app, 'restart', startTest);
  wireStartAction(app, 'view-results', viewSavedResults);
  // PRD-19 FR-19 «повтор: можно»: «Скачать отчёт» exports the BEST saved attempt
  // (not the empty in-progress one) — the same PDF as the results view.
  wireStartAction(app, 'download-report', function () {
    if (typeof downloadPDF === 'function') downloadPDF(true);
  });
}

function renderStartPageFallback() {
// Dead last-resort safety net: reached only if neither the active template nor the
// bundled standard template supplies this layout — the package always bundles the
// standard scene layout as the fallback, so it never fires. Renders a
// minimal, stylesheet-independent notice instead of a competing hardcoded design
// (the standard scene IS the fallback; PRD-12).
  var app = document.getElementById('app');
  if (app) app.innerHTML = '<div style="padding:24px;font:16px/1.5 system-ui,sans-serif">Стартовый экран недоступен: шаблон не предоставил макет.</div>';
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
    state.rankingTouched = {};

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
  state.rankingTouched = {};

  // Сброс таймера
  stopTestTimer();
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
