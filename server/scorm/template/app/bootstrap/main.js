// app/bootstrap/main.js
(function () {
  // The normal course launch: SCORM.Initialize + telemetry + recovery + render.
  // For tests without a retake policy this runs immediately on boot (unchanged
  // behaviour). For gated tests it runs only after the gate allows AND the
  // learner clicks «Начать курс» (PRD-6 NFR-01).
  function runCourse() {
    // SCORM runtime должен быть уже загружен (runtime.js)
    SCORM.init();

    // Initialize telemetry if configured
    if (TEST_DATA.telemetry) {
      Telemetry.init(TEST_DATA.telemetry);
    }

    window.addEventListener("beforeunload", function (e) {
      if (typeof scormFinished === 'undefined' || !scormFinished) {
        // Тест завершён (submit), но "Завершить и закрыть" не нажали — сохраняем попытку
        if (state.submitted) {
          try {
            var isAdaptive = TEST_DATA.mode === 'adaptive' && state.adaptiveState;
            var _r = isAdaptive ? getAdaptiveResultForScorm() : calculateResults();
            saveAttemptResult(_r);
            clearCurrentSession();
          } catch (e) {
            console.log('⚠️ beforeunload: ошибка сохранения попытки:', e);
          }
        }

        // Сохраняем текущую сессию если тест в процессе.
        // PRD-4 v1.1 / Phase 4f: router-mode sessions persist `routerTopicStates`
        // + `sectionResults` regardless of phase, so the learner can resume
        // with completed topics intact. Legacy linear sessions still only
        // persist mid-question state (timer/adaptive guarded inside save).
        var _isRouterMode =
          TEST_DATA.flowPolicy && TEST_DATA.flowPolicy.mode === 'router_by_topics';
        var _shouldSave = !state.submitted && (
          _isRouterMode ||
          (state.phase === 'question' && state.flatQuestions && state.flatQuestions.length > 0)
        );
        if (_shouldSave) {
          saveCurrentSession();
        }

        // Отправляем лучший результат в LMS
        if (typeof getBestAttempt === 'function') {
          var bestAttempt = getBestAttempt();
          if (bestAttempt) {
            var percentScore = Math.round(bestAttempt.percent);
            var passed = !!bestAttempt.passed;
            try {
              SCORM.setValue('cmi.score.raw', percentScore);
              SCORM.setValue('cmi.score.min', 0);
              SCORM.setValue('cmi.score.max', 100);
              SCORM.setValue('cmi.score.scaled', percentScore / 100);
              SCORM.setValue('cmi.completion_status', 'completed');
              SCORM.setValue('cmi.success_status', passed ? 'passed' : 'failed');
              SCORM.setValue('cmi.exit', 'suspend');
            } catch (err) {
              console.log('⚠️ beforeunload ошибка SCORM:', err);
            }
          }
        }
      }

      try { SCORM.commit(); } catch (e) { }
      try { SCORM.terminate(); } catch (e) { }
    });

    var templateReady = typeof loadDesignTemplate === "function"
      ? loadDesignTemplate()
      : Promise.resolve(null);

    templateReady.then(function () {
      // биндинги DnD
      bindMatchingDnDOnce();
      bindRankingDnDOnce();

      // ===== ВОССТАНОВЛЕНИЕ СЕССИИ =====
      var recovery = determineRecovery();
      console.log('🔄 Recovery decision:', recovery.action);

      if (recovery.action === 'restore') {
        // Восстанавливаем незавершённую попытку
        restoreSession(recovery.session);
        if (typeof rebuildPageSequence === 'function') {
          rebuildPageSequence();
          var qIndex = state.currentIndex || 0;
          var itemIndex = state.pageSequence.findIndex(function (item) {
            return item.kind === 'question' && item.questionIndex === qIndex;
          });
          goToPageSequenceIndex(itemIndex >= 0 ? itemIndex : 0);
        }
        // PRD-20 (5.6/5.12): resume the test timer from the active-time anchor.
        // initTimer expires-and-submits if the limit was exhausted while away.
        if (TEST_DATA.timeLimitMinutes && typeof initTimer === 'function') initTimer();
        if (!state.submitted) render();
      } else if (recovery.action === 'restore_router') {
        // PRD-4 v1.1 §3.2 / Phase 4f — router-mode recovery: re-apply the
        // completed-topics snapshot, generate a fresh variant (questions
        // pool stays section-ordered), build the pageSequence (which in
        // router mode is just test-before + router page), then render.
        // The router page now shows previously-completed topics as
        // «Пройдена» so the learner picks up exactly where they left off.
        restoreRouterSession(recovery.session);
        generateVariant();
        if (typeof rebuildPageSequence === 'function') rebuildPageSequence();
        // PRD-20 (5.6): resume the test timer from the active-time anchor
        // (may expire-and-submit if the limit ran out while away).
        if (TEST_DATA.timeLimitMinutes && typeof initTimer === 'function') initTimer();
        var _sess = recovery.session;
        var _resumed = false;
        if (!state.submitted && _sess.currentRouterTopic && TEST_DATA.mode !== 'adaptive' &&
            typeof RouterFlow !== 'undefined' && RouterFlow.resumeRouterTopic) {
          // PRD-20 (2e): resume INSIDE the unfinished topic. Restore the saved
          // question pool + answers so the topic chunk and saved position line up.
          if (_sess.flatQuestions && _sess.flatQuestions.length) {
            state.flatQuestions = _sess.flatQuestions;
          }
          state.answers = _sess.answers || {};
          state.questionStatuses = _sess.questionStatuses || {};
          state.sectionCommitted = _sess.sectionCommitted || {};
          _resumed = RouterFlow.resumeRouterTopic(_sess.currentRouterTopic, _sess.currentPageIndex);
        }
        if (!_resumed && !state.submitted) {
          // Fall back to the router page (previous behaviour): completed topics
          // show «Пройдена», the unfinished topic is re-enterable.
          if (state.pageSequence) {
            var routerIdx = state.pageSequence.findIndex(function (it) {
              return it && it.isRouter;
            });
            if (routerIdx >= 0) goToPageSequenceIndex(routerIdx);
          }
          render();
        }
      } else if (recovery.action === 'show_last_attempt') {
        // Показываем результат последней попытки, сбрасываем незавершённую сессию
        clearCurrentSession();
        // PRD-4 v1.1 §3.1.2 / §4.6: legacy (adaptive, linear_flat) keeps the
        // multi-topic adaptive auto-init for backward compat. Sectional modes
        // (linear_by_topics / router_by_topics) launch per-topic adaptive
        // sessions on demand from contentFlow / routerFlow — auto-init here
        // would short-circuit those flows and bypass content pages / router.
        var _adaptiveAutoInit_a =
          TEST_DATA.mode === 'adaptive' &&
          TEST_DATA.adaptiveTopics &&
          ((TEST_DATA.flowPolicy && TEST_DATA.flowPolicy.mode) || 'linear_flat') === 'linear_flat';
        if (_adaptiveAutoInit_a) {
          initAdaptiveTest();
        } else {
          generateVariant();
        }
        state.phase = 'viewResults';
        state.viewedAttempt = recovery.attempt;
        render();
      } else {
        // start_fresh — обычная инициализация
        clearCurrentSession();
        var _adaptiveAutoInit_b =
          TEST_DATA.mode === 'adaptive' &&
          TEST_DATA.adaptiveTopics &&
          ((TEST_DATA.flowPolicy && TEST_DATA.flowPolicy.mode) || 'linear_flat') === 'linear_flat';
        if (_adaptiveAutoInit_b) {
          initAdaptiveTest();
        } else {
          generateVariant();
          state.phase = 'start';
        }
        render();
      }

      window.addEventListener("resize", function () {
        syncMatchingHeights();
      });
    });
  }

  // PRD-6: the retake gate runs BEFORE SCORM.Initialize for tests with a policy
  // (NFR-01/02). Blocked => block-wall (no init, no cmi). Allowed (PRD-19 FR-19)
  // => runs the normal course directly (no gate-shell). Non-gated tests run
  // directly too.
  function boot() {
    if (typeof RetakeGate !== "undefined" && RetakeGate.isGated(TEST_DATA)) {
      RetakeGate.run(TEST_DATA, runCourse);
    } else {
      runCourse();
    }
  }

  // чтобы работало и в обычной загрузке, и если скрипт подцепился поздно
  if (document.readyState === "loading") {
    window.addEventListener("load", boot);
  } else {
    setTimeout(boot, 0);
  }
})();

// ===== ОТПРАВКА ЛУЧШЕЙ ПОПЫТКИ В LMS =====
function sendBestAttemptToLMS(bestAttempt) {
  if (!bestAttempt) return;
  
  var percentScore = Math.round(bestAttempt.percent);
  var passed = !!bestAttempt.passed;
  
  // Objectives
  var objectives = [];
  if (bestAttempt.topicResults) {
    objectives = bestAttempt.topicResults.map(function(tr) {
      return {
        id: 'topic_' + tr.topicId,
        score: Math.round(tr.percent || 0),
        status: tr.passed === null ? 'unknown' : (tr.passed ? 'passed' : 'failed')
      };
    });
  }
  
  // Отправляем в SCORM
  try {
    SCORM.finish(percentScore, 100, passed, objectives, []);
  } catch (e) {
    console.log('⚠️ Ошибка отправки в LMS:', e);
  }
}

window.sendBestAttemptToLMS = sendBestAttemptToLMS;
