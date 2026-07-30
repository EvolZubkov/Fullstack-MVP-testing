// SCORM Telemetry Module
var Telemetry = (function() {
  var config = null;
  var sessionId = null;
  var currentAttemptNumber = 1;  // НОВОЕ: номер текущей попытки
  // True once the number came from the SERVER (start response or its cached copy).
  // Without telemetry it stays false and the number above is just a placeholder —
  // screens must not present it as the learner's real attempt.
  var attemptNumberKnown = false;
  var offlineBuffer = [];
  var sending = false;

  // Retry budget. The buffer is a best-effort safety net for a flaky link and must
  // never become a load source itself: a permanently failing endpoint has to go quiet,
  // and a refusal has to stop delivery outright. An open-ended retry every few seconds
  // reads to a corporate perimeter as a flood and gets the host blocked.
  var MAX_RETRIES = 3;
  var MAX_BUFFER = 50;
  var RETRY_BASE_MS = 5000;
  var RETRY_FACTOR = 3;
  var RETRY_MAX_MS = 300000;
  var retryTimer = null;
  var retryRound = 0;
  // Set once a refusal (4xx) or an unusable signer is seen: nothing more goes out this
  // session. Telemetry is analytics — losing it must never cost the learner anything.
  var stopped = false;

  // Endpoints that have to outlive the page. The attempt result is the one payload that
  // cannot be re-derived later, and it is sent exactly when the LMS tends to navigate
  // away from the SCO — an ordinary fetch is cancelled together with the document, and
  // the lost request is what fed the retry buffer in the first place.
  var UNLOAD_SAFE_ENDPOINTS = { '/api/scorm-telemetry/finish': true };
  // `keepalive` bodies share a 64 KiB per-page budget and the browser rejects the call
  // outright above it, so an oversized result goes out as an ordinary request instead:
  // sent while the page is alive beats not sent at all.
  var KEEPALIVE_MAX_BYTES = 60000;
  var keepaliveSupported = null;

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

  // Feature test rather than version sniffing: some embedded browsers LMS platforms
  // ship have a `fetch` without `keepalive`, and there the beacon queue is the only way
  // a request survives the document.
  function canKeepalive() {
    if (keepaliveSupported === null) {
      try {
        keepaliveSupported = typeof Request === 'function' &&
          'keepalive' in new Request('/', { method: 'POST' });
      } catch (e) {
        keepaliveSupported = false;
      }
    }
    return keepaliveSupported;
  }

  function byteLength(s) {
    try { return new Blob([s]).size; } catch (e) { return String(s).length; }
  }

  // Hand the payload to the browser's beacon queue. Returns whether it was accepted, or
  // null when the API is absent so the caller can fall back to an ordinary request.
  function queueBeacon(url, body) {
    try {
      if (typeof navigator === 'undefined' || !navigator ||
          typeof navigator.sendBeacon !== 'function') {
        return null;
      }
      return navigator.sendBeacon(url, new Blob([body], { type: 'application/json' })) === true;
    } catch (e) {
      return null;
    }
  }

  // ONE delivery attempt. Returns 'ok' | 'retry' | 'stop'; what to do with the item is
  // the caller's decision, so an item is queued in exactly ONE place. The earlier
  // version queued both here and in processBuffer: the copy that went to the tail got
  // the incremented counter while the original stayed at the head with its counter
  // untouched, so the "max 3 retries" budget was never actually spent.
  async function attempt(endpoint, data) {
    var signed;
    try {
      signed = await sign(data);
    } catch (e) {
      signed = null;
    }
    if (!signed) {
      // Signing fails when SubtleCrypto is unavailable or broken (an insecure origin,
      // for one). That does not fix itself mid-session, so retrying is pure noise.
      console.warn('[Telemetry] Failed to sign request');
      return 'stop';
    }

    var payload = {
      packageId: config.packageId,
      sessionId: sessionId,
      signature: signed.signature,
      timestamp: signed.timestamp,
      data: data
    };

    var body = JSON.stringify(payload);
    var url = config.apiBaseUrl + endpoint;
    var unloadSafe = UNLOAD_SAFE_ENDPOINTS[endpoint] === true &&
      byteLength(body) <= KEEPALIVE_MAX_BYTES;

    if (unloadSafe && !canKeepalive()) {
      // The beacon reports QUEUEING, not delivery. A `true` therefore counts as sent:
      // there is nothing further to observe, and re-sending would double-count the
      // attempt. A `null` means the API is missing — fall through to a normal request.
      var queued = queueBeacon(url, body);
      if (queued === true) {
        console.log('[Telemetry] Queued via sendBeacon:', endpoint);
        return 'ok';
      }
      if (queued === false) {
        console.warn('[Telemetry] sendBeacon refused:', endpoint);
        return 'retry';
      }
    }

    var response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        // Unknown fields are ignored by older browsers; where it IS understood, the
        // request is detached from the document, so closing the page cannot cancel it.
        keepalive: unloadSafe
      });
    } catch (e) {
      console.warn('[Telemetry] Send failed:', endpoint, e.message);
      return 'retry';
    }

    if (response.ok) {
      // НОВОЕ: обработка ответа от /start
      if (endpoint === '/api/scorm-telemetry/start') {
        try {
          var result = await response.clone().json();
          if (result.attemptNumber) {
            currentAttemptNumber = result.attemptNumber;
            attemptNumberKnown = true;
            saveAttemptNumber();
          }
        } catch (e) {}
      }

      console.log('[Telemetry] Sent:', endpoint, 'attemptNumber:', currentAttemptNumber);
      return 'ok';
    }

    console.warn('[Telemetry] Send failed:', endpoint, 'HTTP ' + response.status);
    // A 4xx is a refusal: malformed, unauthenticated, too large, rate-limited, or held
    // by a perimeter. Repeating it cannot help and is precisely what gets scored as
    // abuse. 408 is the exception — a request timeout is worth one more try. 5xx and
    // transport errors are transient by nature.
    if (response.status >= 400 && response.status < 500 && response.status !== 408) {
      return 'stop';
    }
    return 'retry';
  }

  // Give up for the whole session: drop what is queued and disarm the timer.
  function halt(reason) {
    stopped = true;
    offlineBuffer.length = 0;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    console.warn('[Telemetry] Delivery stopped for this session:', reason);
  }

  // Queue one item for a later try. The counter lives ON the item, so the budget is
  // really spent; an over-budget item is dropped for good.
  function enqueue(endpoint, data, retryCount) {
    if (stopped) return;
    if (retryCount > MAX_RETRIES) {
      console.warn('[Telemetry] Dropped after ' + MAX_RETRIES + ' retries:', endpoint);
      return;
    }
    offlineBuffer.push({ endpoint: endpoint, data: data, retryCount: retryCount });
    // Bounded queue: a long offline stretch must not grow it without limit. Oldest go
    // first — the tail is what still describes where the learner ended up.
    if (offlineBuffer.length > MAX_BUFFER) {
      offlineBuffer.splice(0, offlineBuffer.length - MAX_BUFFER);
    }
    scheduleRetry();
  }

  // Exponential backoff with jitter, armed only while something is queued and disarmed
  // when the queue drains — no standing interval. The jitter matters at scale: a whole
  // training campaign retrying in lockstep is what produces the traffic spike.
  function scheduleRetry() {
    if (retryTimer || sending || stopped || offlineBuffer.length === 0) return;
    var delay = Math.min(RETRY_BASE_MS * Math.pow(RETRY_FACTOR, retryRound), RETRY_MAX_MS);
    delay = Math.round(delay * (0.5 + Math.random()));
    retryTimer = setTimeout(function () {
      retryTimer = null;
      processBuffer();
    }, delay);
  }

  // Drain the buffer. The FIRST failure ends the round: the rest waits for the next
  // backoff window instead of walking the whole queue against an endpoint that is
  // already refusing.
  async function processBuffer() {
    if (sending || stopped || offlineBuffer.length === 0) return;

    sending = true;
    try {
      while (offlineBuffer.length > 0 && !stopped) {
        var item = offlineBuffer.shift();
        var verdict = await attempt(item.endpoint, item.data);
        if (verdict === 'stop') {
          halt(item.endpoint);
          return;
        }
        if (verdict === 'retry') {
          retryRound++;
          enqueue(item.endpoint, item.data, item.retryCount + 1);
          break;
        }
        retryRound = 0;
        // Small delay between requests
        await new Promise(function(r) { setTimeout(r, 100); });
      }
    } finally {
      sending = false;
    }
    scheduleRetry();
  }

  // Send request to API; on a transient failure the item enters the retry buffer.
  async function send(endpoint, data) {
    if (!config || !config.enabled || stopped) return false;

    // НОВОЕ: добавляем attemptNumber во все запросы
    data = data || {};
    data.attemptNumber = currentAttemptNumber;

    var verdict = await attempt(endpoint, data);
    if (verdict === 'ok') return true;
    if (verdict === 'stop') {
      halt(endpoint);
      return false;
    }
    enqueue(endpoint, data, 1);
    return false;
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
          attemptNumberKnown = true;
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

      // No standing interval: a retry arms its own timer while the buffer holds
      // something and disarms it once the buffer drains (see scheduleRetry). A ticking
      // interval against a dead endpoint is what produced the request flood.

      // Try to send on online event
      window.addEventListener('online', function() {
        console.log('[Telemetry] Online - processing buffer');
        retryRound = 0;
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
    },

    /** Whether the number above actually came from the server (see attemptNumberKnown). */
    hasAttemptNumber: function() {
      return attemptNumberKnown;
    }
  };
})();