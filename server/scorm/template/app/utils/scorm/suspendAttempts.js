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

function getAttemptsUsed() {
  var s = readSuspendObj();
  return typeof s.attemptsUsed === 'number' ? s.attemptsUsed : 0;
}

function setAttemptsUsed(n) {
  var s = readSuspendObj();
  s.attemptsUsed = n;
  s.lastUpdated = new Date().toISOString();
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
    completedAt: new Date().toISOString(),
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