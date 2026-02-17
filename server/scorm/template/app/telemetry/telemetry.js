// SCORM Telemetry Module
var Telemetry = (function() {
  var config = null;
  var sessionId = null;
  var currentAttemptNumber = 1;  // НОВОЕ: номер текущей попытки
  var offlineBuffer = [];
  var sending = false;

  // Generate unique session ID
  function generateSessionId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // HMAC-SHA256 signature using SubtleCrypto
  async function sign(data) {
    var timestamp = Date.now().toString();
    var dataToSign = config.packageId + ':' + sessionId + ':' + timestamp + ':' + JSON.stringify(data || {});

    var encoder = new TextEncoder();
    var keyData = encoder.encode(config.secretKey);
    var msgData = encoder.encode(dataToSign);

    try {
      var key = await crypto.subtle.importKey(
        'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      );

      var signatureBuffer = await crypto.subtle.sign('HMAC', key, msgData);
      var signatureHex = Array.from(new Uint8Array(signatureBuffer))
        .map(function(b) { return b.toString(16).padStart(2, '0'); })
        .join('');

      return { signature: signatureHex, timestamp: timestamp };
    } catch (e) {
      console.error('[Telemetry] Sign error:', e);
      return null;
    }
  }

  // Send request to API
  async function send(endpoint, data, retryCount) {
    if (!config || !config.enabled) return;
    retryCount = retryCount || 0;

    // НОВОЕ: добавляем attemptNumber во все запросы
    data = data || {};
    data.attemptNumber = currentAttemptNumber;

    try {
      var signed = await sign(data);
      if (!signed) {
        console.warn('[Telemetry] Failed to sign request');
        return false;
      }

      var payload = {
        packageId: config.packageId,
        sessionId: sessionId,
        signature: signed.signature,
        timestamp: signed.timestamp,
        data: data
      };

      var response = await fetch(config.apiBaseUrl + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }

      // НОВОЕ: обработка ответа от /start
      if (endpoint === '/api/scorm-telemetry/start') {
        try {
          var result = await response.clone().json();
          if (result.attemptNumber) {
            currentAttemptNumber = result.attemptNumber;
            saveAttemptNumber();
          }
        } catch (e) {}
      }

      console.log('[Telemetry] Sent:', endpoint, 'attemptNumber:', currentAttemptNumber);
      return true;
    } catch (e) {
      console.warn('[Telemetry] Send failed:', endpoint, e.message);

      // Buffer for retry (max 3 retries)
      if (retryCount < 3) {
        offlineBuffer.push({ endpoint: endpoint, data: data, retryCount: retryCount + 1 });
      }

      return false;
    }
  }

  // Process offline buffer
  async function processBuffer() {
    if (sending || offlineBuffer.length === 0) return;
    
    sending = true;
    while (offlineBuffer.length > 0) {
      var item = offlineBuffer.shift();
      var success = await send(item.endpoint, item.data, item.retryCount);
      if (!success && item.retryCount < 3) {
        // Put back if still failing
        offlineBuffer.unshift(item);
        break;
      }
      // Small delay between requests
      await new Promise(function(r) { setTimeout(r, 100); });
    }
    sending = false;
  }

  // НОВОЕ: сохранение attemptNumber в localStorage
  function saveAttemptNumber() {
    try {
      if (config && sessionId) {
        localStorage.setItem('telemetry_attempt_' + config.packageId + '_' + sessionId, currentAttemptNumber.toString());
      }
    } catch (e) {}
  }

  // НОВОЕ: загрузка attemptNumber из localStorage
  function loadAttemptNumber() {
    try {
      if (config && sessionId) {
        var saved = localStorage.getItem('telemetry_attempt_' + config.packageId + '_' + sessionId);
        if (saved) {
          currentAttemptNumber = parseInt(saved, 10) || 1;
        }
      }
    } catch (e) {}
  }

  // Get LMS user data
  function getLmsUserData() {
    var data = {
      lmsUserId: null,
      lmsUserName: null,
      lmsUserEmail: null,
      lmsUserOrg: null
    };

    try {
      // Try SCORM 2004 API
      var api2004 = null;
      var win = window;
      var attempts = 0;
      while (win && attempts < 10) {
        if (win.API_1484_11) {
          api2004 = win.API_1484_11;
          break;
        }
        if (win.parent === win) break;
        win = win.parent;
        attempts++;
      }

      if (api2004) {
        data.lmsUserId = api2004.GetValue('cmi.learner_id') || null;
        data.lmsUserName = api2004.GetValue('cmi.learner_name') || null;
        // WebTutor extensions
        try {
          data.lmsUserEmail = api2004.GetValue('cmi.student_email') || null;
        } catch (e) {}
        try {
          data.lmsUserOrg = api2004.GetValue('cmi.student_org') || null;
        } catch (e) {}
      }

      // Try SCORM 1.2 API as fallback
      var api12 = null;
      win = window;
      attempts = 0;
      while (win && attempts < 10) {
        if (win.API) {
          api12 = win.API;
          break;
        }
        if (win.parent === win) break;
        win = win.parent;
        attempts++;
      }

      if (api12) {
        if (!data.lmsUserId) data.lmsUserId = api12.LMSGetValue('cmi.core.student_id') || null;
        if (!data.lmsUserName) data.lmsUserName = api12.LMSGetValue('cmi.core.student_name') || null;
        try {
          if (!data.lmsUserEmail) data.lmsUserEmail = api12.LMSGetValue('cmi.core.student_email') || null;
        } catch (e) {}
      }
    } catch (e) {
      console.warn('[Telemetry] Failed to get LMS data:', e);
    }

    return data;
  }

  return {
    init: function(telemetryConfig) {
      if (!telemetryConfig || !telemetryConfig.packageId || !telemetryConfig.enabled) {
        console.log('[Telemetry] Disabled or no config');
        config = null;
        return;
      }

      config = telemetryConfig;
      sessionId = generateSessionId();
      currentAttemptNumber = 1;  // НОВОЕ: сброс при инициализации

      console.log('[Telemetry] Initialized, sessionId:', sessionId);

      // Retry buffer periodically
      setInterval(processBuffer, 5000);

      // Try to send on online event
      window.addEventListener('online', function() {
        console.log('[Telemetry] Online - processing buffer');
        processBuffer();
      });
    },

    start: function() {
      if (!config || !config.enabled) return;

      var data = getLmsUserData();
      send('/api/scorm-telemetry/start', data);
    },

    // НОВОЕ: начать новую попытку (вызывать при рестарте теста)
    startNewAttempt: function() {
      if (!config || !config.enabled) return;

      currentAttemptNumber++;
      saveAttemptNumber();
      console.log('[Telemetry] Starting new attempt:', currentAttemptNumber);

      var data = getLmsUserData();
      send('/api/scorm-telemetry/start', data);
    },

    answer: function(questionData) {
      if (!config || !config.enabled) return;

      send('/api/scorm-telemetry/answer', {
        questionId: questionData.questionId,
        questionPrompt: questionData.questionPrompt,
        questionType: questionData.questionType,
        topicId: questionData.topicId,
        topicName: questionData.topicName,
        difficulty: questionData.difficulty,
        userAnswer: questionData.userAnswer,
        correctAnswer: questionData.correctAnswer,
        isCorrect: questionData.isCorrect,
        points: questionData.points,
        maxPoints: questionData.maxPoints,
        levelIndex: questionData.levelIndex,
        levelName: questionData.levelName,
        // Варианты ответов для отображения в аналитике
        options: questionData.options || null,
        leftItems: questionData.leftItems || null,
        rightItems: questionData.rightItems || null,
        items: questionData.items || null
      });
    },

    finish: function(results) {
      if (!config || !config.enabled) return;

      send('/api/scorm-telemetry/finish', {
        percent: results.percent,
        passed: results.passed,
        earnedPoints: results.earnedPoints,
        possiblePoints: results.possiblePoints,
        totalQuestions: results.totalQuestions,
        correctAnswers: results.correct,
        achievedLevels: results.achievedLevels || null,
        failedTopicCourses: results.failedTopicCourses || null
      });
    },

    isEnabled: function() {
      return !!(config && config.enabled);
    },

    getSessionId: function() {
      return sessionId;
    },

    // НОВОЕ: получить текущий номер попытки
    getAttemptNumber: function() {
      return currentAttemptNumber;
    }
  };
})();