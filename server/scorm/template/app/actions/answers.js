function showToast(message, kind) {
  // kind: 'warn' | 'info' | 'ok' (как раньше, можно использовать в className)
  var id = 'center-toast';
  var existing = document.getElementById(id);

  // если уже показано — обновим текст и перезапустим таймер
  if (existing) {
    existing.querySelector('.center-toast__box').textContent = message;
    existing.className = 'center-toast' + (kind ? (' ' + kind) : '');
    existing.style.display = 'flex';
    if (existing._timeout) clearTimeout(existing._timeout);
    existing._timeout = setTimeout(hide, 3000);
    return;
  }

  var overlay = document.createElement('div');
  overlay.id = id;
  overlay.className = 'center-toast' + (kind ? (' ' + kind) : '');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.background = 'rgba(0,0,0,0.35)';
  overlay.style.zIndex = '99999';
  overlay.style.padding = '16px';

  var box = document.createElement('div');
  box.className = 'center-toast__box';
  box.textContent = message;
  box.style.maxWidth = '90vw';
  box.style.padding = '14px 16px';
  box.style.borderRadius = '12px';
  box.style.fontSize = '16px';
  box.style.fontWeight = '100';
  box.style.boxShadow = '0 10px 30px rgba(0,0,0,0.25)';

  // цвета по kind
  if (kind === 'warn') {
    box.style.background = '#3c55d6ff';
    box.style.color = '#f2f2f2ff';
    
  } else if (kind === 'ok') {
    box.style.background = '#d1e7dd';
    box.style.color = '#0f5132';
    box.style.border = '1px solid #badbcc';
  } else {
    box.style.background = 'white';
    box.style.color = '#111';
    box.style.border = '1px solid rgba(0,0,0,0.08)';
  }

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function hide() {
    if (!overlay) return;
    overlay.style.display = 'none';
  }

  // закрыть по клику в любом месте
  overlay.addEventListener('click', function () {
    hide();
  });

  // закрыть по Esc
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      hide();
    }
  });

  overlay._timeout = setTimeout(hide, 3000);
}


function hasAnswer(q, answer) {
  if (!q) return true;

  if (q.type === 'single') return typeof answer === 'number';
  if (q.type === 'multiple') return Array.isArray(answer) && answer.length > 0;

  if (q.type === 'matching') {
    if (!answer || typeof answer !== 'object') return false;
    var need = (q.data && Array.isArray(q.data.left)) ? q.data.left.length : 0;
    var keys = Object.keys(answer);
    return keys.length === need && keys.every(function(k) {
      return typeof answer[k] === 'number';
    });
  }

  // ranking: порядок всегда есть (дефолтный тоже), считаем ответом
  if (q.type === 'ranking') return true;

  return answer !== undefined && answer !== null;
}

function requireAnswerOrToast() {
  var fq = state.flatQuestions[state.currentIndex];
  if (!fq) return true;

  var q = fq.question;
  var answer = state.answers[q.id];

  if (!hasAnswer(q, answer)) {
    showToast('Сначала ответьте на вопрос', 'warn');
    return false;
  }
  return true;
}

function selectSingle(qId, idx) {
  if (TEST_DATA.showCorrectAnswers && state.feedbackShown) return;
  state.answers[qId] = idx;
  
  // Убрать selected у всех опций этого вопроса
  var allOptions = document.querySelectorAll('input[name="q_' + qId + '"]');
  allOptions.forEach(function(radio) {
    radio.checked = false;
    radio.parentElement.classList.remove('selected');
  });
  
  // Добавить selected к выбранному
  var selectedOption = document.querySelector('.option[data-index="' + idx + '"]');
  if (selectedOption) {
    selectedOption.classList.add('selected');
    var radio = selectedOption.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
  }
}

function toggleMultiple(qId, idx) {
  if (TEST_DATA.showCorrectAnswers && state.feedbackShown) return;

  var current = Array.isArray(state.answers[qId]) ? state.answers[qId].slice() : [];
  var pos = current.indexOf(idx);

  if (pos === -1) current.push(idx);
  else current.splice(pos, 1);

  state.answers[qId] = current;

  // точечное обновление DOM через data-index
  var opt = document.querySelector('.option[data-index="' + idx + '"]');
  if (opt) {
    var cb = opt.querySelector('input[type="checkbox"]');
    var checked = current.indexOf(idx) !== -1;
    if (cb) cb.checked = checked;
    opt.classList.toggle('selected', checked);
  }
}

function setMatch(qId, leftIdx, rightVal) {
  if (TEST_DATA.showCorrectAnswers && state.feedbackShown) return;

  var pairs = state.answers[qId] || {};

  if (rightVal === '' || rightVal === null || rightVal === undefined) {
    delete pairs[leftIdx];
  } else {
    var n = parseInt(rightVal, 10);
    if (Number.isNaN(n)) delete pairs[leftIdx];
    else pairs[leftIdx] = n;
  }

  state.answers[qId] = pairs;
}


function next() {
  if (state.phase === 'content') {
    if (typeof advancePageSequence === 'function') advancePageSequence();
    return;
  }

  if (!requireAnswerOrToast()) return;

  if (state.pageSequence && state.pageSequence.length > 0 && typeof advancePageSequence === 'function') {
    // ✅ НОВОЕ: Сохраняем текущее состояние перед переходом
    saveSessionState();

    state.feedbackShown = false;
    advancePageSequence();
    return;
  }

  if (state.currentIndex < state.flatQuestions.length - 1) {
    // ✅ НОВОЕ: Сохраняем текущее состояние перед переходом
    saveSessionState();
    
    state.currentIndex++;
    state.feedbackShown = false;
    render();
  }
}


function submit(force) {
  if (state.submitted) return;

  // если не форс — требуем ответ на текущий вопрос
  if (!force) {
    if (!requireAnswerOrToast()) return;
  }

  // ✅ НОВОЕ: Сохраняем финальное состояние перед завершением
  saveSessionState();

  state.submitted = true;

  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  state.currentIndex = state.flatQuestions.length;
  state.currentPageIndex = state.pageSequence ? state.pageSequence.length : state.currentPageIndex;
  render();
}

function restart() {
  console.log('🔄 restart() вызван');
  if (!hasAttemptsLeft()) {
    showToast('Попытки закончились', 'warn');
    return;
  }

  // Попытка считается использованной только если тест был явно завершён через submit().
  // Прерванные (восстановленные) сессии не расходуют попытку.
  if (state.submitted) {
    console.log('💾 Сохраняем завершённую попытку перед перезапуском');
    var results = calculateResults();
    saveAttemptResult(results);

    var currentAttemptNum = Telemetry.getAttemptNumber();
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

  state.phase = 'start';
  state.currentIndex = 0;
  state.currentPageIndex = 0;
  state.answers = {};
  state.variant = null;
  state.flatQuestions = [];
  state.pageSequence = [];
  state.submitted = false;
  state.feedbackShown = false;
  state.timeExpired = false;

  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  state.remainingSeconds = null;

  generateVariant();
  
  // Телеметрия: новая попытка
  console.log('🆕 Вызываем Telemetry.startNewAttempt()');
  Telemetry.startNewAttempt();
  
  render();
}

function saveSessionState() {
  saveCurrentSession();
}
