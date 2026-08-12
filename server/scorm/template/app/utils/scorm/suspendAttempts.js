// PRD-31 barrier B: the interval between attempts is decided against the PORTAL
// clock, so the instant an attempt FINISHED must come from the same source —
// otherwise moving the system clock forward once would both open the barrier and
// poison the mark that the next decision reads back.
//
// Resolved once per launch and then carried forward by a MONOTONIC offset: a long
// session must not re-fetch the portal on every attempt, and re-reading Date.now()
// as an absolute value would reintroduce the very clock the resolution avoided.
// Degrades silently to the machine clock — a package whose portal is unreachable
// keeps working exactly as before, and `completedAtSource` records which clock won
// so a live run can be diagnosed from suspend_data alone.
var trustedNowMs = null;
var trustedNowAt = null;

function primeTrustedNow() {
  if (typeof TrustedNow === 'undefined') return Promise.resolve();
  return TrustedNow.resolveNowMs('/')
    .then(function (ms) {
      trustedNowMs = ms;
      trustedNowAt = Date.now();
    })
    .catch(function () { /* stay on the machine clock */ });
}

function trustedNowSource() {
  if (trustedNowMs == null || typeof TrustedNow === 'undefined') return 'client';
  return TrustedNow.lastSource();
}

/** Current instant as ISO, from the portal clock when it was resolved. */
function nowIso() {
  if (trustedNowMs == null || trustedNowAt == null) return new Date().toISOString();
  return new Date(trustedNowMs + (Date.now() - trustedNowAt)).toISOString();
}

/**
 * PRD-31 barrier B: is a NEW attempt open inside THIS assignment (= this SCORM
 * registration)? Reads the previous attempt's instant from suspend_data — available
 * post-Initialize, which is where every caller runs — and compares it against the
 * trusted clock. No policy => open, so a package without the barrier behaves exactly
 * as it did before.
 */
function attemptIntervalState() {
  var policy = (typeof TEST_DATA !== 'undefined' && TEST_DATA.retakePolicy)
    ? TEST_DATA.retakePolicy.attemptInterval : null;
  if (!policy || policy.enabled !== true || !policy.hours) return { allowed: true, availableAt: null };
  if (typeof EligibilityEngine === 'undefined') return { allowed: true, availableAt: null };
  var last = getLastAttempt();
  var decision = EligibilityEngine.attemptIntervalDecision(
    last ? last.completedAt : null,
    nowIso(),
    policy.hours
  );
  return { allowed: decision.allowed, availableAt: decision.availableAt };
}

/** «01.08.2026 в 14:30» — the instant barrier B opens at, in the learner's own zone. */
function fmtInstantHuman(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  function p(n) { return n < 10 ? '0' + n : String(n); }
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() +
    ' в ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function readSuspendObj() {
  try {
    var raw = SCORM.getValue('cmi.suspend_data') || '';
    if (!raw) return { attemptsUsed: 0, attempts: [] };
    var obj = JSON.parse(raw);
    // Миграция со старого формата
    if (!obj.attempts) {
      obj.attempts = [];
    }
    return obj;
  } catch (e) {
    return { attemptsUsed: 0, attempts: [] };
  }
}

function writeSuspendObj(obj) {
  try {
    var raw = JSON.stringify(obj || {});
    SCORM.setValue('cmi.suspend_data', raw);
    SCORM.commit();
    console.log('🔵 writeSuspendObj: сохранено', obj.attempts ? obj.attempts.length : 0, 'попыток, attemptsUsed:', obj.attemptsUsed);
  } catch (e) {
    console.log('⚠️ Ошибка writeSuspendObj:', e);
  }
}

// PRD-20 phase 2: active-time anchor persisted in suspend_data.timer.
// Shape: { limitMinutes, baselineTotalSec, sig } | null. Absence/failure = the
// runtime degrades to the phase-1 (session-only) timer.
//
// PRD-20 phase 2f: obfuscation-grade tamper-evidence. The key ships inside the
// package, so this detects a CASUAL suspend_data edit (e.g. bumping
// baselineTotalSec to regain time), not a prepared attacker. On a signature
// mismatch the anchor is treated as absent -> no resume, so editing it forfeits
// the session rather than granting free time.
function timerSignatureKey() {
  return (typeof TEST_DATA !== 'undefined' && TEST_DATA.integritySecret) || 'tb-prd20-anchor-v1';
}

function computeAnchorSignature(anchor) {
  var payload = timerSignatureKey() + '|' + anchor.limitMinutes + '|' + anchor.baselineTotalSec;
  var hash = 5381; // djb2 (ES5-safe: no Math.imul / SubtleCrypto)
  for (var i = 0; i < payload.length; i++) {
    hash = ((hash << 5) + hash + payload.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function readTimerAnchor() {
  var s = readSuspendObj();
  var a = s.timer;
  if (!a) return null;
  if (a.sig !== computeAnchorSignature(a)) {
    // Tampered or legacy (unsigned): degrade to a fresh timer and flag it.
    if (typeof state !== 'undefined' && state) state.timerAnchorTampered = true;
    return null;
  }
  return a;
}

function writeTimerAnchor(anchor) {
  var s = readSuspendObj();
  var a = { limitMinutes: anchor.limitMinutes, baselineTotalSec: anchor.baselineTotalSec };
  a.sig = computeAnchorSignature(a);
  s.timer = a;
  writeSuspendObj(s);
}

function clearTimerAnchor() {
  var s = readSuspendObj();
  if (s.timer) {
    s.timer = null;
    writeSuspendObj(s);
  }
}

function getAttemptsUsed() {
  var s = readSuspendObj();
  return typeof s.attemptsUsed === 'number' ? s.attemptsUsed : 0;
}

function setAttemptsUsed(n) {
  var s = readSuspendObj();
  s.attemptsUsed = n;
  s.lastUpdated = nowIso();
  // ✅ ВАЖНО: Не трогаем attempts и currentSession!
  writeSuspendObj(s);
  console.log('🔵 Установлены использованные попытки:', n);
}

function hasAttemptsLeft() {
  if (!TEST_DATA.maxAttempts) return true; // если лимит не задан — не ограничиваем
  return getAttemptsUsed() < TEST_DATA.maxAttempts;
}

// Увеличиваем попытку 1 раз на запуск теста
function registerAttemptStart() {
  console.log('🔵 registerAttemptStart вызван, maxAttempts:', TEST_DATA.maxAttempts);
  
  if (!TEST_DATA.maxAttempts) {
    console.log('🔵 maxAttempts не задан, лимит не применяется');
    return true;
  }

  var used = getAttemptsUsed();
  console.log('🔵 Использовано попыток:', used, 'из', TEST_DATA.maxAttempts);
  
  if (used >= TEST_DATA.maxAttempts) {
    console.log('🔴 Попытки исчерпаны!');
    return false;
  }

  setAttemptsUsed(used + 1);
  console.log('🔵 Попытка зарегистрирована, новое значение:', used + 1);
  return true;
}

// ===== НОВЫЕ ФУНКЦИИ ДЛЯ СОХРАНЕНИЯ РЕЗУЛЬТАТОВ =====

// Сохранить результат попытки
function saveAttemptResult(resultData) {
  console.log('🔵 saveAttemptResult вызван, percent:', resultData.percent);
  
  var s = readSuspendObj();
  if (!s.attempts) s.attempts = [];
  
  var attemptRecord = {
    attemptNumber: s.attemptsUsed,
    // PRD-31: the portal clock, not the machine's — this mark is what barrier B
    // measures the next attempt against.
    completedAt: nowIso(),
    completedAtSource: trustedNowSource(),
    percent: resultData.percent,
    totalCorrect: resultData.correct,
    totalQuestions: resultData.totalQuestions,
    earnedPoints: parseFloat(resultData.earnedPoints) || 0,
    possiblePoints: parseFloat(resultData.possiblePoints) || 0,
    passed: resultData.passed,
    // PRD-2 (A7): persisted result.* values + per-formula errors for this attempt,
    // so a recovered session restores the same computed variables (NFR-04).
    resultValues: (resultData.resultComputation && resultData.resultComputation.values) || {},
    formulaErrors: (resultData.resultComputation && resultData.resultComputation.errors) || [],
    // PRD-5 (B5): persisted scale.* values + per-scale errors for this attempt
    // (suspend_data.custom.scale, §8.1); recomputed deterministically on recovery.
    scaleValues: (resultData.scaleComputation && resultData.scaleComputation.values) || {},
    scaleErrors: (resultData.scaleComputation && resultData.scaleComputation.errors) || [],
    topicResults: resultData.topicResults,
    answers: JSON.parse(JSON.stringify(state.answers)),
    flatQuestions: JSON.parse(JSON.stringify(state.flatQuestions))
  };
  
  s.attempts.push(attemptRecord);
  console.log('🔵 Сохранена попытка #' + attemptRecord.attemptNumber + ', всего попыток:', s.attempts.length);
  
  writeSuspendObj(s);
  
  console.log('🔵 suspend_data обновлен. Текущие попытки:', s.attempts.map(function(a) { return Math.round(a.percent) + '%'; }));
}

// Получить все попытки
function getAllAttempts() {
  var s = readSuspendObj();
  return s.attempts || [];
}

// Получить лучшую попытку (по %, потом по дате)
function getBestAttempt() {
  var attempts = getAllAttempts();
  console.log('📊 Все попытки для выбора:', attempts.length);
  attempts.forEach(function(a, i) {
    console.log('  Попытка ' + (i+1) + ': ' + Math.round(a.percent) + '%');
  });
  
  if (attempts.length === 0) return null;
  
  var sorted = attempts.slice().sort(function(a, b) {
    if (a.percent !== b.percent) {
      return b.percent - a.percent;
    }
    return new Date(b.completedAt) - new Date(a.completedAt);
  });
  
  console.log('✅ Лучшая попытка: ' + Math.round(sorted[0].percent) + '%');
  return sorted[0];
}

// Получить последнюю попытку
function getLastAttempt() {
  var attempts = getAllAttempts();
  if (attempts.length === 0) return null;
  return attempts[attempts.length - 1];
}

// Есть ли завершенные попытки?
function hasCompletedAttempts() {
  return getAllAttempts().length > 0;
}