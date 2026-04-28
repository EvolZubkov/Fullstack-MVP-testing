// app/bootstrap/main.js
(function () {
  function boot() {
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

        // Сохраняем текущую сессию если тест в процессе (только для тестов без таймера)
        if (state.phase === 'question' && !state.submitted && state.flatQuestions && state.flatQuestions.length > 0) {
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

    // биндинги DnD
    bindMatchingDnDOnce();
    bindRankingDnDOnce();

    // ===== ВОССТАНОВЛЕНИЕ СЕССИИ =====
    var recovery = determineRecovery();
    console.log('🔄 Recovery decision:', recovery.action);

    if (recovery.action === 'restore') {
      // Восстанавливаем незавершённую попытку
      restoreSession(recovery.session);
      render();
    } else if (recovery.action === 'show_last_attempt') {
      // Показываем результат последней попытки, сбрасываем незавершённую сессию
      clearCurrentSession();
      if (TEST_DATA.mode === 'adaptive' && TEST_DATA.adaptiveTopics) {
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
      if (TEST_DATA.mode === 'adaptive' && TEST_DATA.adaptiveTopics) {
        initAdaptiveTest();
      } else {
        generateVariant();
      }
      render();
    }

    window.addEventListener("resize", function () {
      syncMatchingHeights();
    });
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