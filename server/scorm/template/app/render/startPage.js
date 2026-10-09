/**
 * Renders the start screen. Primary path renders the shared `start` layout via the
 * SHARED renderer (the SAME layout + renderer the web host mounts) from a public
 * context; the SCORM-richer actions (resume-with-position, "Начать заново", "Мой
 * результат") are gated layout blocks the web context does not set, and the
 * web-only "back to list" action is likewise gated off here. Falls back to the
 * last-resort notice only when the design template supplies no layout at all.
 *
 * ADAPTIVE renders here too. The templated path used to be gated off for it
 * (`mode !== 'adaptive'`) because adaptive had bespoke chrome of its own; that
 * chrome is gone (PRD-12 — one screen, one template), so the guard outlived its
 * fallback and left an adaptive package with NO start screen, just the notice. The
 * shared context is already adaptive-aware: `canResume` stays false for it
 * (an adaptive session cannot be resumed), see buildScormStartContext.
 */
function renderStartPage() {
  // PRD-7 G21: `systemLayout('start')` is the bundled default's start when the
  // active template doesn't declare a `start` contentTemplate.
  var layout = resolveStartLayout();
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (layout && TB && TB.renderScreenInto) {
    renderStartPageTemplated();
    return;
  }
  renderStartPageFallback();
}

/**
 * Скрыт ли экран этого вида автором (решение владельца 2026-09-20).
 *
 * Спрашивает ОБЩИЙ хелпер — тот же, которым пользуется веб-хост: разойдясь здесь,
 * пакет показал бы экран, которого в вебе нет. Локальная проверка остаётся запасной —
 * пакет, собранный старой сборкой без этой функции в бандле, не должен падать.
 */
function screenHidden(kind) {
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  var pages = TEST_DATA.contentPages || [];
  if (TB && typeof TB.isSystemScreenHidden === 'function') {
    return TB.isSystemScreenHidden(pages, kind);
  }
  for (var i = 0; i < pages.length; i++) {
    if (pages[i] && pages[i].kind === kind) return pages[i].hidden === true;
  }
  return false;
}

/** Скрыт ли стартовый экран — прохождение тогда начинается сразу. */
function startScreenHidden() {
  return screenHidden('start');
}

/**
 * Resolve the start screen's layout HTML, honouring the author's chosen start
 * VARIANT (PRD-1 §4.3). The `start` content page's `templateKey` selects a
 * contentTemplate whose own `layoutFile` (e.g. `start.image-right`) is preferred
 * over the generic `start` layout, so switching the start variant in «Структура»
 * takes effect at runtime. Falls back to `systemLayout('start')` when no variant
 * is chosen, the template declares none, or its layout was not bundled.
 */
function resolveStartLayout() {
  var base = (typeof systemLayout === 'function')
    ? systemLayout('start')
    : (state && state.templateLayouts && state.templateLayouts['start']);
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  var layouts = (state && state.templateLayouts) || {};
  var manifest = (state && state.templateManifest) || {};
  var startPage = (TEST_DATA.contentPages || []).filter(function (p) { return p && p.kind === 'start'; })[0];
  if (startPage && TB && typeof TB.resolveContentTemplate === 'function') {
    var ct = TB.resolveContentTemplate(startPage, manifest.contentTemplates || []).template;
    if (ct && ct.layoutFile && layouts[ct.layoutFile]) return layouts[ct.layoutFile];
  }
  return base;
}

/** «11.10.2026» — the calendar day barrier A reopens (the cooldown is counted in days). */
function fmtIsoDateHuman(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? (m[3] + '.' + m[2] + '.' + m[1]) : '';
}

/**
 * The wait card of the start screen, or null when nothing holds the next attempt back.
 * The shared builder renders one card for both barriers:
 *   - barrier A (between assignments) is decided by the retake gate before the course
 *     runs and lands in `state.retake`; a calendar date and a «через N дн.» countdown;
 *   - barrier B (hours inside one assignment) is decided here, post-Initialize, from
 *     suspend_data; a moment with a time and no day countdown. It only matters while
 *     attempts remain — with the limit spent there is nothing to wait for.
 * Reading the gate's verdict HERE is what makes the blocked screen the ordinary one:
 * the gate no longer assembles a copy of its own.
 */
function startCooldownCard(attemptsLeft) {
  var retake = (typeof state !== 'undefined' && state) ? state.retake : null;
  if (retake && retake.checked && retake.allowed === false) {
    return {
      availableDateHuman: fmtIsoDateHuman(retake.availableDate),
      daysUntil: (typeof EligibilityEngine !== 'undefined')
        ? EligibilityEngine.daysUntilDate(retake.availableDate, retake.effectiveToday || retake.todayDate)
        : null
    };
  }
  if (!attemptsLeft) return null;
  var interval = attemptIntervalState();
  return interval.allowed ? null : { availableDateHuman: fmtInstantHuman(interval.availableAt), daysUntil: null };
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
  // PRD-36 FR-03: «есть завершённые» — это счётчик, а не длина списка: списка больше нет.
  var hasCompleted = hasCompletedAttempts();
  var attemptsLeft = hasAttemptsLeft();
  var cooldown = startCooldownCard(attemptsLeft);
  var canStartNew = attemptsLeft && !cooldown;
  // PRD-19 FR-19 «повтор: можно»: prior-attempt summary + downloadable report from
  // the best saved attempt. Runs post-Initialize (suspend_data available); the
  // pre-Initialize cooldown gate builds its own minimal context without this.
  var best = (typeof getBestAttempt === 'function') ? getBestAttempt() : null;

  var suspendObj = readSuspendObj();
  var pendingSession = suspendObj.currentSession;
  // PRD-36 FR-10: the checkpoint stores the delivery as POSITIONS, so «есть что продолжать»
  // is the length of that row — the question objects it used to carry are gone.
  var pendingCount = pendingSession
    ? TBRunState.decodeDelivery(pendingSession.dl || '').length
    : 0;
  var canResume = !!(
    pendingSession &&
    !TEST_DATA.timeLimitMinutes &&
    TEST_DATA.mode !== 'adaptive' &&
    pendingCount > 0 &&
    !isSessionStale(pendingSession)
  );

  return window.TBTemplate.buildStartState({
    info: {
      title: TEST_DATA.title,
      description: TEST_DATA.description || '',
      // PRD-59: absent in every package built before the field existed — the shared
      // builder reads that as 'plain', which is those packages' current behaviour.
      descriptionFormat: TEST_DATA.descriptionFormat,
      // «Сценарий в ИС»: у теста «Сценарий» задание одно — число вопросов не показывается, как на вебе.
      questionCount: TEST_DATA.mode === 'scenario' ? undefined : TEST_DATA.totalQuestions,
      passPercent: TEST_DATA.passPercent,
      // Absent in every package built before the flag existed, and in every package
      // of a test that does grade — `!== false` is what keeps both showing it.
      hasGradedContent: TEST_DATA.hasGradedContent !== false,
      // «Тест пройден, если»: when the topics decide, the overall threshold is not shown.
      passDecisionPolicy: TEST_DATA.passDecisionPolicy,
      // …and the cover names the topic condition instead, counted from the same rules.
      overallPassRule: TEST_DATA.overallPassRule,
      // An adaptive test passes by its levels, not by topic thresholds.
      sections: TEST_DATA.mode === 'adaptive' ? [] : (TEST_DATA.sections || []),
      timeLimitMinutes: TEST_DATA.timeLimitMinutes,
      maxAttempts: TEST_DATA.maxAttempts,
      // PRD-7 S10: startPageContent migrated to an intro content page; not shown here.
      startPageContent: '',
      // PRD-67: `course.closesOnLeave` for a layout that warns before the start.
      closesOnLeave: (typeof packageClosesOnLeave === 'function') ? packageClosesOnLeave() : false
    },
    maxAttempts: hasLimit ? TEST_DATA.maxAttempts : null,
    completedAttempts: used,
    resume: canResume ? { index: (pendingSession.i || 0), total: pendingCount } : null,
    hasCompletedResults: hasCompleted,
    canStartNew: canStartNew,
    cooldown: cooldown,
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
 *
 * PRD-22: the start ILLUSTRATION is a property of the start page itself
 * (`settings.image` of the `start.image-right` variant), so it is resolved through
 * the shared `TBTemplate.resolveStartImageUrl` — the page's own picture wins, the
 * branding param stays the fallback for tests filled before the property existed.
 */
function scormDesignContext() {
  var p = (typeof TEST_DATA !== 'undefined' && TEST_DATA.designSettings) ? TEST_DATA.designSettings.params : null;
  // Unwrap a media envelope { url, name, … } (or a bare string) to a plain URL.
  var mediaUrl = function (v) {
    if (v && typeof v === 'object' && typeof v.url === 'string') return v.url;
    if (typeof v === 'string') return v;
    return '';
  };
  var out = {};
  var logo = mediaUrl(p ? p.logoUrl : null);
  if (logo) out.logoUrl = logo;
  var startImg = resolveStartImage(p);
  if (startImg) out.startImageUrl = startImg;
  return out;
}

/**
 * The start screen's illustration. Belongs to the start VARIANT that declares it
 * (`settings[].image`): its own page value first, the branding param as the
 * fallback. A variant without the property shows no illustration at all — the
 * shared `startImageForVariant` is the single rule for both hosts.
 */
function resolveStartImage(designParams) {
  var startPage = ((typeof TEST_DATA !== 'undefined' && TEST_DATA.contentPages) || [])
    .filter(function (pg) { return pg && pg.kind === 'start'; })[0];
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (TB && typeof TB.startImageForVariant === 'function') {
    var manifest = (typeof state !== 'undefined' && state && state.templateManifest) || {};
    var variant = null;
    if (startPage && startPage.templateKey) {
      variant = (manifest.contentTemplates || []).filter(function (ct) {
        return ct && ct.key === startPage.templateKey;
      })[0] || null;
    }
    return TB.startImageForVariant(variant, startPage ? startPage.settings : null, designParams);
  }
  // Bundle without the shared helper (older package): the branding param alone.
  var v = designParams ? designParams.startImageUrl : null;
  if (v && typeof v === 'object' && typeof v.url === 'string') return v.url;
  return typeof v === 'string' ? v : '';
}

/** Build the start context (shared builder) and mount the shared layout (standard mode). */
function renderStartPageTemplated() {
  var app = document.getElementById('app');
  var ctx = buildScormStartContext();
  ctx.design = scormDesignContext();
  // PRD-7 G21: when `start` falls back to default, mount default's layout AND
  // activate default's stylesheet so the screen is fully styled. The chosen start
  // VARIANT (e.g. `start.image-right`) wins over the generic `start` layout.
  var layout = resolveStartLayout();
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

  // «Сценарий в ИС»: у теста «Сценарий» за «Начать» сразу идёт задание во весь экран, а полный
  // экран браузер даёт только в самом щелчке — позже, после отрисовки плеера, просьба опоздала бы.
  if (TEST_DATA.mode === 'scenario' && typeof TBSimRun !== 'undefined') TBSimRun.requestFullscreen();

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
    // PA-12f: прерванная попытка уходит с тем же нулём за неотвеченное, что и в её баллы.
    if (typeof reportPendingAnswerTelemetry === 'function') reportPendingAnswerTelemetry();
    Telemetry.finish({
      percent: results.percent,
      passed: results.passed,
      earnedPoints: results.earnedPoints,
      possiblePoints: results.possiblePoints,
      totalQuestions: results.totalQuestions,
      correct: results.correct,
      achievedLevels: results.achievedLevels || null
    }, currentAttemptNum);

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
  // A new attempt starts with clean section budgets and no closed sections (PRD-67).
  if (typeof resetSectionRunState === 'function') resetSectionRunState();

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
    // PA-12f: прерванная попытка уходит с тем же нулём за неотвеченное, что и в её баллы.
    if (typeof reportPendingAnswerTelemetry === 'function') reportPendingAnswerTelemetry();
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
  // A new attempt starts with clean section budgets and no closed sections (PRD-67).
  if (typeof resetSectionRunState === 'function') resetSectionRunState();

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
