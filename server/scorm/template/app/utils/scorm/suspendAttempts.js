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

// PRD-36 FR-24: outcome of the last read ('empty' | 'parsed' | 'corrupt') and the sacrifices
// applied by the last write (§6.2). Both are surfaced to the debug player: a state that had to
// be cut, or one that came back unreadable, must be VISIBLE — the failure mode this work ends
// is precisely the silent one.
var lastReadOutcome = 'empty';
var lastWriteSacrifices = [];

function runStateDiagnostics() {
  return { readOutcome: lastReadOutcome, sacrifices: lastWriteSacrifices.slice() };
}

function readSuspendObj() {
  var raw = '';
  try {
    raw = SCORM.getValue('cmi.suspend_data') || '';
  } catch (e) {
    raw = '';
  }
  var parsed = TBRunState.parseState(raw);
  lastReadOutcome = parsed.outcome;
  if (parsed.outcome === 'corrupt') {
    console.log('⚠️ suspend_data повреждён (' + raw.length + ' симв.) — состояние не восстановлено');
  }
  // FR-12: whatever the LMS hands back is brought to format 2 before anyone reads it —
  // one place, so no consumer ever branches on the format version.
  return TBRunState.migrate(parsed.state, TEST_DATA);
}

function writeSuspendObj(obj) {
  try {
    var budget = TBRunState.budgetFor(TEST_DATA);
    var fitted = TBRunState.fitToBudget(obj || {}, budget);
    lastWriteSacrifices = fitted.sacrifices;
    if (fitted.sacrifices.length) {
      console.log('⚠️ Бюджет suspend_data исчерпан, пожертвовано:', fitted.sacrifices.join(', '));
    }
    var raw = JSON.stringify(fitted.state);
    SCORM.setValue('cmi.suspend_data', raw);
    SCORM.commit();
    // Проектная цель 4096 печатается рядом: по ней судят, влезет ли тест в профиль 1.2.
    console.log('🔵 writeSuspendObj: ' + raw.length + ' из ' + budget + ' симв. (цель ' +
      TBRunState.DESIGN_BUDGET + ')');
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

/**
 * PRD-54 BR-54-35: метка РЕГИСТРАЦИИ SCO для блока `meta_registration` отчёта LMS.
 *
 * Одна на регистрацию, а не на попытку: строка отчёта LMS соответствует регистрации, и внутри неё
 * пакет проводит несколько попыток, отдавая в LMS одну. Создаётся при первом обращении и живёт в
 * `suspend_data` (`rk`) — поэтому одинакова у всех попыток и сессий регистрации и переживает
 * пересборку пакета. Новая регистрация приходит с пустым `suspend_data` и получает новую метку.
 *
 * Время по часам машины и случайный хвост в base36: метке нужна только неповторимость, а не
 * доверенное время. Пустая строка — состояние недоступно; отчёт тогда идёт без метки, и импорт
 * различит строку по отпечатку содержимого.
 *
 * @returns {string} метка регистрации или пустая строка
 */
function registrationMark() {
  try {
    var s = readSuspendObj();
    if (typeof s.rk === 'string' && s.rk) return s.rk;
    var tail = '';
    for (var i = 0; i < 4; i++) tail += Math.floor(Math.random() * 36).toString(36);
    s.rk = Date.now().toString(36) + tail;
    writeSuspendObj(s);
    return s.rk;
  } catch (e) {
    return '';
  }
}

// ===== НОВЫЕ ФУНКЦИИ ДЛЯ СОХРАНЕНИЯ РЕЗУЛЬТАТОВ =====

/**
 * PRD-36 FR-03/FR-05/FR-22: persist a FINISHED attempt. The state keeps a counter, the best
 * summary and the last one — never a list: every consumer reads a maximum, a tail or a length,
 * and the unbounded array is what silently blew the 64000-character limit on the third attempt
 * of a long test. The summary itself is built in ONE place (TBRunState.buildSummary) no matter
 * which of the five finish paths got here, so «лучшая» cannot depend on how the test ended.
 */
function saveAttemptResult(resultData) {
  var s = readSuspendObj();
  var summary = TBRunState.buildSummary(resultData, TEST_DATA, {
    attemptNumber: s.attemptsUsed,
    // PRD-31: the portal clock, not the machine's — this mark is what barrier B
    // measures the next attempt against.
    completedAt: nowIso(),
    source: trustedNowSource(),
    deliveredForms: (typeof state !== 'undefined' && state.deliveredForms) || {},
  });
  // PRD-2 (A7) / PRD-5 (B5): formula and scale errors are diagnostic and belong with the
  // result that is actually shown — i.e. only with the best attempt.
  summary.fe = (resultData.resultComputation && resultData.resultComputation.errors) || undefined;
  summary.se = (resultData.scaleComputation && resultData.scaleComputation.errors) || undefined;
  if (summary.fe && !summary.fe.length) summary.fe = undefined;
  if (summary.se && !summary.se.length) summary.se = undefined;
  // Повопросные ряды нужны РОВНО одному потребителю — сборке interactions по ЛУЧШЕЙ
  // попытке. Когда тест настроен отдавать в LMS последнюю, отчёт строится по прогону,
  // который ещё в памяти, и хранить детализацию не для кого.
  if (TEST_DATA.lmsAttemptResult !== 'last') {
    summary.d = TBRunState.buildDetail(state);
  }

  var best = TBRunState.pickBest(TBRunState.bestOf(s), summary);
  // FR-06: only the best keeps its per-question rows; the last one is a summary alone.
  if (best !== summary) delete summary.d;
  s.best = best;
  s.last = (best === summary) ? 0 : summary;
  writeSuspendObj(s);
  console.log('🔵 Попытка #' + summary.n + ' сохранена: ' + Math.round(summary.pc) + '%');
}

/**
 * PRD-36 FR-03/FR-09: the BEST attempt in the shape every screen and the LMS builder already
 * speak. No list is scanned and no maximum recomputed — the best is decided once, when an
 * attempt finishes (FR-05), and the summary is expanded back against TEST_DATA on read.
 */
function getBestAttempt() {
  var s = readSuspendObj();
  return s.best ? TBRunState.expandSummary(s.best, TEST_DATA) : null;
}

/** FR-03: the LAST attempt; `last: 0` means it IS the best one (the common case). */
function getLastAttempt() {
  var s = readSuspendObj();
  if (!s.best) return null;
  var summary = (s.last === 0 || !s.last) ? s.best : s.last;
  return TBRunState.expandSummary(summary, TEST_DATA);
}

/** The RAW best summary, rows included — the LMS interactions builder needs them. */
function getBestAttemptDetail() {
  var s = readSuspendObj();
  return (s.best && s.best.d) || null;
}

/**
 * Whether a FINISHED attempt exists — «Мой результат» has something to show. Judged by the
 * best summary (written only when an attempt finishes, PRD-36 FR-03), not by the counter: the
 * counter grows on START so an abandoned attempt still spends the limit, and it is not kept
 * at all for a test without `maxAttempts`.
 */
function hasCompletedAttempts() {
  return !!readSuspendObj().best;
}