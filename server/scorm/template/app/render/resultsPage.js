var scormFinished = false;

// PRD-31 barrier B: Commit()/Terminate() return as soon as the LMS API accepts
// the call, not once the LMS has actually written cmi.suspend_data to its own
// backend — that write can still be in flight. Closing the SCO window right
// after races it: a fast relaunch (observed live on testuniver.rt.ru — the
// portal re-created the course session immediately after «Завершить и
// закрыть») can read suspend_data BEFORE the just-finished attempt's
// completedAt landed, so attemptIntervalState() sees no qualifying attempt and
// the interval barrier silently opens onto the router/start flow instead of
// blocking. A short grace delay before close costs nothing visible (the
// results screen just stays up a moment longer) and gives that write time to
// land.
var RESULTS_CLOSE_DELAY_MS = 500;

// ─── PRD-5 (B5): scales ───────────────────────────────────────────────────────
// Build the scale-engine input from TEST_DATA + the current attempt's answers.
// `questionTypes` is taken from the full question set (standard sections and
// adaptive topics) so percent-normalization ranges are correct even for measured
// questions the learner did not draw; answers come from `state.answers`.
function buildScaleInputs() {
  var scales = (typeof TEST_DATA !== 'undefined' && TEST_DATA.scales) || [];
  var measurements = (typeof TEST_DATA !== 'undefined' && TEST_DATA.measurements) || [];
  var questionTypes = {};
  if (typeof TEST_DATA !== 'undefined') {
    (TEST_DATA.sections || []).forEach(function (sec) {
      (sec.questions || []).forEach(function (q) { if (q && q.id) questionTypes[q.id] = q.type; });
    });
    (TEST_DATA.adaptiveTopics || []).forEach(function (t) {
      (t.questions || []).forEach(function (q) { if (q && q.id) questionTypes[q.id] = q.type; });
    });
  }
  var answers = (typeof state !== 'undefined' && state.answers) || {};
  return { scales: scales, measurements: measurements, answers: answers, questionTypes: questionTypes };
}

// Compute scale.* for this attempt. Deterministic — a recovered attempt with the
// same answers recomputes identically (NFR-04). No-op (empty) when the test has
// no scales or the engine is absent.
function computeTestScales() {
  if (typeof TEST_DATA === 'undefined' || !TEST_DATA.scales || !TEST_DATA.scales.length) {
    return { values: {}, errors: [] };
  }
  if (typeof ScaleEngine === 'undefined') return { values: {}, errors: [] };
  var inp = buildScaleInputs();
  return ScaleEngine.computeScales(inp.scales, inp.measurements, inp.answers, inp.questionTypes);
}

// Pseudo-interactions for scales published to the LMS report (scorm_target
// interaction/both, PRD-5 §8.2): `scale_{key}` carries the raw value, and — only
// for scales with bands — `scale_{key}_level` carries the band label. Mirrors
// buildResultVarInteractions. Scales default to scorm_target "none" (opt-in).
function buildScaleInteractions(scaleComputation) {
  var out = [];
  var scales = (typeof TEST_DATA !== 'undefined' && TEST_DATA.scales) || [];
  var values = (scaleComputation && scaleComputation.values) || {};
  scales.forEach(function (sc) {
    var target = sc.scormTarget || 'none';
    if (target !== 'interaction' && target !== 'both') return;
    var v = values[sc.key];
    var hasVal = !!(v && v.hasValue);
    out.push({
      id: 'scale_' + sc.key,
      type: 'other',
      result: 'neutral',
      response: hasVal ? String(v.raw) : '',
      correct: '',
      description: sc.label || sc.key
    });
    if (sc.bands && sc.bands.length > 0) {
      out.push({
        id: 'scale_' + sc.key + '_level',
        type: 'other',
        result: 'neutral',
        response: hasVal ? String(v.label || v.level || '') : '',
        correct: '',
        description: (sc.label || sc.key) + ' — уровень'
      });
    }
  });
  return out;
}

// ─── PRD-2 (A7): result variables ────────────────────────────────────────────
// Build the formula evaluation context from standard scoring. Этап A wires
// percent + per-topic results; PRD-5 scales fill `scales` (B5); PRD-50 fills
// `tags` from the attempt's breakdown records and `sections` from the topic
// results. Mirrors server/services/result-compute.ts key for key — the two hosts
// must hand the evaluator the SAME maps.
function buildResultVarContext(results, scaleComputation) {
  // Topic name/code come from TEST_DATA.sections so `topicByName("<name>")` and
  // `topicById("<code>")` resolve (PRD-2 §4.2); fall back to topicResult fields.
  var meta = {};
  var secs = (typeof TEST_DATA !== "undefined" && TEST_DATA.sections) || [];
  for (var i = 0; i < secs.length; i++) meta[secs[i].topicId] = secs[i];
  var topics = {};
  var topicsByName = {};
  var sections = {};
  var sectionAliases = {};
  var totalScore = 0;
  (results.topicResults || []).forEach(function (tr) {
    var r = { percent: tr.percent || 0, passed: tr.passed === true, score: tr.earnedPoints || 0 };
    topics[tr.topicId] = r;
    totalScore += tr.earnedPoints || 0;
    var m = meta[tr.topicId] || {};
    var code = m.topicCode || tr.code || null;
    var name = m.topicName || tr.topicName || null;
    if (code) topics[code] = r;
    if (name) topicsByName[name] = r;
    // `sectionById(...)` is the delivered section = the topic result, keyed by UUID and
    // by the author's code. `completed` is true by construction: a section that produced
    // a result was played to its end in the standard flow.
    var sec = { percent: tr.percent || 0, passed: tr.passed === true, completed: true };
    sections[tr.topicId] = sec;
    if (code) sections[code] = sec;
    sectionAliases[tr.topicId] = code ? [tr.topicId, code] : [tr.topicId];
  });
  // PRD-50 FR-35/FR-36: `tag(...)` reads this attempt's breakdown records. The test scope
  // keeps the plain key; a section scope is addressed by the COMPOSITE key
  // «<section>::<key>», whose left part accepts the same two spellings `topicById` does.
  // The DSL grammar is untouched.
  var tags = {};
  var entries = results.breakdowns || [];
  for (var b = 0; b < entries.length; b++) {
    var e = entries[b];
    // `percent` is the POINTS-based ratio: it is the verdict currency (FR-21) and must
    // not depend on which basis the author chose to display on screen.
    var value = { percent: e.percentPoints, score: e.earned, maxScore: e.possible, count: e.items };
    if (e.scope === 'test') {
      tags[e.key] = value;
      continue;
    }
    var sectionId = e.scope.slice('section:'.length);
    var aliases = Object.prototype.hasOwnProperty.call(sectionAliases, sectionId)
      ? sectionAliases[sectionId]
      : [sectionId];
    for (var a = 0; a < aliases.length; a++) tags[aliases[a] + '::' + e.key] = value;
  }
  var scales = (scaleComputation && scaleComputation.values) || {};
  // Overall earned points across the test = Σ of per-topic earned points.
  return {
    percent: results.percent || 0,
    score: totalScore,
    topics: topics,
    topicsByName: topicsByName,
    tags: tags,
    scales: scales,
    sections: sections,
  };
}

function computeTestResultVariables(results, scaleComputation) {
  var defs = (typeof TEST_DATA !== 'undefined' && TEST_DATA.resultVariables) || [];
  if (!defs.length || typeof FormulaDSL === 'undefined') return { values: {}, errors: [], status: {} };
  return FormulaDSL.computeResultVariables(defs, buildResultVarContext(results, scaleComputation));
}

// Pseudo-interactions var_{name} for variables published to the LMS report
// (scorm_target interaction/both). learner_response carries the computed value.
function buildResultVarInteractions(computation) {
  var out = [];
  var defs = (typeof TEST_DATA !== 'undefined' && TEST_DATA.resultVariables) || [];
  defs.forEach(function (rv) {
    var target = rv.scormTarget || 'both';
    if (target !== 'interaction' && target !== 'both') return;
    var value = (computation && computation.values) ? computation.values[rv.name] : undefined;
    out.push({
      id: 'var_' + rv.name,
      type: 'other',
      result: 'neutral',
      response: (value === null || value === undefined) ? '' : String(value),
      correct: '',
      description: rv.label || rv.name
    });
  });
  return out;
}

/**
 * Значения шкал прохождения для телеметрии — «ключ -> число» (PRD-56 FR-21).
 *
 * Та же форма, в какой их пишет импорт выгрузки в `scorm_attempts.scales_json` (PRD-54): у
 * одной величины не должно оказаться двух представлений в одной колонке. Шкала без значения
 * (ни один её вопрос не отвечен) ключа не получает — ноль означал бы измеренный ноль.
 */
function telemetryScaleValues(scaleComputation) {
  var out = {};
  var values = (scaleComputation && scaleComputation.values) || {};
  for (var key in values) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
    var v = values[key];
    if (v && v.hasValue && typeof v.raw === 'number') out[key] = v.raw;
  }
  return out;
}

/**
 * Значения показателей прохождения для телеметрии — «имя -> строка» (PRD-56 FR-21).
 *
 * Строкой, а не числом: показатель бывает и числом, и кодом исхода, и выгрузка хранит его
 * так же. Непосчитанный показатель ключа не получает.
 */
function telemetryVariableValues(resultComputation) {
  var out = {};
  var values = (resultComputation && resultComputation.values) || {};
  for (var name in values) {
    if (!Object.prototype.hasOwnProperty.call(values, name)) continue;
    var value = values[name];
    if (value === null || value === undefined) continue;
    out[name] = String(value);
  }
  return out;
}

function pushAll(target, items) {
  for (var i = 0; i < items.length; i++) target.push(items[i]);
}

// Disables every rendered finish-action control (whichever screen produced it —
// standard/adaptive/post-results) the instant the learner triggers finishAndClose.
// Without this the button stays fully clickable until SCORM.terminate()/window.close()
// land, which can take a moment (RESULTS_CLOSE_DELAY_MS) or never happen at all on a
// host that embeds the SCO instead of opening a script-closable popup (e.g. Moodle) —
// a still-enabled button reads as "nothing happened" and invites a re-click.
function disableFinishButtons() {
  var els = document.querySelectorAll(
    '[data-action="test-finish"],[data-action="results-finish"],[data-action="finish"]'
  );
  for (var i = 0; i < els.length; i++) els[i].disabled = true;
}

function finishAndClose() {
  // A viewing of a finished learning grades and reports nothing (main.js).
  if (typeof state !== 'undefined' && state && state.reviewLaunch) {
    closeReviewLaunch();
    return;
  }
  if (scormFinished) return;
  scormFinished = true;
  try { disableFinishButtons(); } catch (e) { }

  // Определяем режим и получаем результаты
  var isAdaptive = TEST_DATA.mode === 'adaptive' && state.adaptiveState;
  var results;

  if (isAdaptive) {
    // Адаптивный режим - строим результат если ещё не построен
    if (!state.adaptiveState.result) {
      state.adaptiveState.result = buildAdaptiveResult();
    }
    results = getAdaptiveResultForScorm();

    // Добавляем achievedLevels для телеметрии
    results.achievedLevels = state.adaptiveState.result.topicResults.map(function (tr) {
      return {
        topicId: tr.topicId,
        topicName: tr.topicName,
        levelIndex: tr.achievedLevelIndex,
        levelName: tr.achievedLevelName
      };
    });
  } else {
    // Стандартный режим
    results = calculateResults();
  }

  // PRD-5 (B5): compute scale.* once for this attempt, BEFORE result.*, so
  // result-variable formulas can read scaleById()/countScales(). Carried into the
  // suspend_data record and the LMS scale_* pseudo-interactions.
  results.scaleComputation = computeTestScales();

  // PRD-2 (A7): compute result.* once for this attempt; carried into the
  // suspend_data record, the LMS pseudo-interactions and the status override.
  results.resultComputation = computeTestResultVariables(results, results.scaleComputation);

  console.log('🎯 Завершение теста (' + (isAdaptive ? 'адаптивный' : 'стандартный') + '), процент:', Math.round(results.percent));

  saveAttemptResult(results);
  clearCurrentSession(); // тест завершён — незавершённая сессия больше не нужна

  console.log('💾 Результат сохранен в suspend_data');

  // ===== ТЕЛЕМЕТРИЯ: отправляем РЕАЛЬНЫЙ результат текущей попытки =====
  var failedTopicCourses = collectFailedTopicCourses(
    isAdaptive ? state.adaptiveState.result : results
  );
  console.log('📚 failedTopicCourses:', JSON.stringify(failedTopicCourses));

  // PA-12f: пропущенные и неотвеченные вопросы уходят в телеметрию ДО завершения — тем же
  // нулём, что и в балл, и в отчёт LMS. Адаптивный путь шлёт ответ на каждом шаге и
  // невыданных уровнем вопросов не знает, поэтому досылка только у стандартной попытки.
  if (!isAdaptive && typeof reportPendingAnswerTelemetry === 'function') reportPendingAnswerTelemetry();

  Telemetry.finish({
    percent: results.percent,
    passed: results.passed,
    earnedPoints: results.earnedPoints,
    possiblePoints: results.possiblePoints,
    totalQuestions: results.totalQuestions,
    correct: results.correct,
    achievedLevels: results.achievedLevels || null,
    failedTopicCourses: failedTopicCourses,
    // PRD-56 FR-21: шкалы и показатели этой попытки. Считаются выше по этому же пути
    // (`results.scaleComputation` / `results.resultComputation`) — второго расчёта ради
    // телеметрии не заводится.
    scales: telemetryScaleValues(results.scaleComputation),
    variables: telemetryVariableValues(results.resultComputation)
  });

  // ===== LMS: отправляем лучшую попытку с хаком если нужно =====
  var attemptsExhausted = !!TEST_DATA.maxAttempts && !hasAttemptsLeft();

  // PRD-2 (A7): a boolean controls_status="success" variable decides the verdict instead of
  // the pass rule (several of them combine with OR, see FormulaDSL.computeResultVariables).
  // It is resolved FIRST, so the forced close below sees the verdict that will actually be
  // sent: applied after it, the variable used to overwrite the forced «passed» back to
  // «failed», and a course whose attempts were spent stayed open in the LMS for good.
  var rcStatus = (results.resultComputation && results.resultComputation.status) || {};
  var realPassed = (typeof rcStatus.success === 'boolean') ? rcStatus.success : !!results.passed;

  var forcePassedHack = false;
  if (attemptsExhausted && !realPassed && !state.timeExpired) {
    console.log('🔴 Попытки кончились, принудительно закрываем с passed=true');
    forcePassedHack = true;
    try {
      // cmi.comments_from_learner is a COLLECTION in SCORM 2004: the bare element was
      // rejected by the LMS (SetValue -> false), so the note was never written.
      SCORM.setValue('cmi.comments_from_learner.0.comment', 'ATTEMPTS_EXHAUSTED: FAILED (forced close)');
      SCORM.commit();
      console.log('✅ Comments установлены успешно');
    } catch (e) {
      console.log('⚠️ Ошибка установки comments:', e);
    }
  }

  // Какой результат уходит в LMS при нескольких попытках — решает АВТОР теста.
  // Стандарт этого не задаёт: SCORM ничего не требует от LMS о хранении истории, и
  // платформы (Moodle, Blackboard, Teachbase) держат выбор «лучшая / последняя» у себя,
  // ожидая от содержимого данные ТЕКУЩЕЙ попытки. Но LMS, хранящая только снимок, при
  // «последней» безвозвратно перекроет удачную попытку неудачной — поэтому выбор остаётся
  // за автором. Отсутствие поля = «лучшая»: так ведут себя все уже выданные пакеты.
  var lmsWantsLast = TEST_DATA.lmsAttemptResult === 'last';
  var bestAttempt = lmsWantsLast ? null : getBestAttempt();
  console.log(lmsWantsLast
    ? '🏁 В LMS уходит текущая попытка (настройка теста)'
    : '🏆 Лучшая попытка: ' + (bestAttempt ? Math.round(bestAttempt.percent) + '%' : 'none'));

  var resultsForLms = bestAttempt || results;
  var bestPassed = !!resultsForLms.passed;

  // PRD-2 (A7): the controls_status verdict overrides the LMS pass flag
  // (cmi.success_status); completion is applied after SCORM.finish.
  if (typeof rcStatus.success === 'boolean') {
    console.log('🎚️ controls_status переопределяет passed:', rcStatus.success);
    bestPassed = rcStatus.success;
  }

  // The package's own verdict, before the forced close replaces it: the points sent to the
  // LMS are aligned with THIS, so a forced «passed» still records «Не пройден» in WebTutor.
  var verdictForLms = bestPassed;

  // The forced close goes LAST: nothing after it may take the «passed» back.
  if (forcePassedHack) {
    console.log('🔓 Хак активирован - переопределяем passed на true');
    bestPassed = true;
  }

  console.log('📤 Отправляем в LMS:', Math.round(resultsForLms.percent) + '%, passed:', bestPassed);

  // result.*/scale.* are computed for this attempt; the LMS report carries their
  // var_*/scale_* pseudo-interactions regardless of which attempt supplies the
  // headline score.
  var resultComputation = results.resultComputation;
  var scaleComputation = results.scaleComputation;

  // Отправляем в LMS
  if (isAdaptive) {
    console.log('🔵 Адаптивный тест: принудительно passed=true для LMS');
    finishScormAdaptive(resultsForLms, true, resultComputation, scaleComputation);
  } else {
    var bestDetail = (typeof getBestAttemptDetail === 'function') ? getBestAttemptDetail() : null;
    if (bestAttempt && bestAttempt !== results && bestDetail) {
      // PRD-36 FR-07/FR-08: the LMS report is built from the BEST attempt's OWN rows —
      // delivery positions, answers AND statuses. Before this the attempt carried answers
      // and question copies but no statuses, so `gradedAnswerFor` filtered a past attempt's
      // interactions by the CURRENT run's statuses (§8, defect 1).
      console.log('🔄 Восстанавливаем состояние лучшей попытки для LMS');
      var savedAnswers = state.answers;
      var savedFlatQuestions = state.flatQuestions;
      var savedStatuses = state.questionStatuses;

      var positions = TBRunState.decodeDelivery(bestDetail.dl || '');
      var bestFlat = [], bestQuestions = [];
      for (var bi = 0; bi < positions.length; bi++) {
        var bsec = TEST_DATA.sections[positions[bi].s];
        var bq = (bsec && bsec.questions) ? bsec.questions[positions[bi].q] : null;
        if (!bq) continue;
        bestQuestions.push(bq);
        bestFlat.push({ question: bq, topicId: bsec.topicId, topicName: bsec.topicName });
      }
      var bestAnswers = TBRunState.decodeAnswers(bestDetail.an || '', bestQuestions);
      var bestStatuses = TBRunState.decodeStatuses(bestDetail.st || '');
      state.answers = {};
      state.questionStatuses = {};
      for (var bj = 0; bj < bestQuestions.length; bj++) {
        if (bestAnswers[bj] !== undefined) state.answers[bestQuestions[bj].id] = bestAnswers[bj];
        state.questionStatuses[bestQuestions[bj].id] = bestStatuses[bj] || 'unanswered';
      }
      state.flatQuestions = bestFlat;

      finishScormLmsOnly(resultsForLms, bestPassed, resultComputation, scaleComputation, verdictForLms);

      state.answers = savedAnswers;
      state.flatQuestions = savedFlatQuestions;
      state.questionStatuses = savedStatuses;
    } else {
      finishScormLmsOnly(resultsForLms, bestPassed, resultComputation, scaleComputation, verdictForLms);
    }
  }

  // PRD-2 (A7): a boolean controls_status="completion" variable overrides
  // cmi.completion_status (which SCORM.finish set to completed by default).
  if (resultComputation && typeof resultComputation.status.completion === 'boolean') {
    try {
      SCORM.setValue('cmi.completion_status', resultComputation.status.completion ? 'completed' : 'incomplete');
      console.log('🎚️ controls_status переопределяет completion:', resultComputation.status.completion);
    } catch (e) { }
  }

  try { SCORM.commit(); } catch (e) { }
  try { SCORM.terminate(); } catch (e) { }
  setTimeout(function () {
    try { window.close(); } catch (e) { }
  }, RESULTS_CLOSE_DELAY_MS);
}

/**
 * Finish SCORM for adaptive mode
 */
function finishScormAdaptive(results, passedForLms, resultComputation, scaleComputation) {
  // Тот же сборщик, что и в обычном режиме. У адаптивного пути `percent` — это доля
  // внутри ПОДТВЕРЖДЁННОГО уровня, а баллы (1 вопрос = 1 балл) считаются по всей
  // лестнице, поэтому `scaled` намеренно берётся от баллов: внутри одной записи
  // raw/max/scaled обязаны быть согласованы.
  var objectives = results.topicResults.map(buildTopicObjective);

  var percentScore = Math.round(results.percent);

  // Вычисляем максимальный достигнутый уровень (числом)
  var maxAchievedLevel = 0;
  if (state.adaptiveState && state.adaptiveState.result) {
    state.adaptiveState.result.topicResults.forEach(function (tr) {
      if (tr.achievedLevelIndex !== null && tr.achievedLevelIndex + 1 > maxAchievedLevel) {
        maxAchievedLevel = tr.achievedLevelIndex + 1;
      }
    });
  }

  var interactions = [];

  // --- Блок 1: детальные ответы на вопросы ---
  if (state.adaptiveState && state.adaptiveState.topics) {
    state.adaptiveState.topics.forEach(function (topic) {
      var topicData = TEST_DATA.adaptiveTopics.find(function (t) {
        return t.topicId === topic.topicId;
      });
      if (!topicData) return;

      topic.levelsState.forEach(function (level) {
        level.answeredQuestionIds.forEach(function (qId) {
          var question = topicData.questions.find(function (q) { return q.id === qId; });
          if (!question) return;

          var answer = state.answers[qId];
          var isCorrect = checkAnswer(question, answer) === 1;

          // Тот же сборщик, что и в обычном режиме: адаптивный путь раньше нёс свою
          // версию и репортил ЛЮБОЙ вопрос как `other` с ответом в виде JSON.
          interactions.push(buildQuestionInteraction(question, answer, isCorrect));
        });
      });
    });
  }

  // --- Блок 2: достигнутый уровень по каждой теме ---
  var topicResults = (state.adaptiveState && state.adaptiveState.result)
    ? state.adaptiveState.result.topicResults
    : (results.topicResults || []);

  topicResults.forEach(function (tr) {
    var levelValue = tr.achievedLevelName ? tr.achievedLevelName : 'Уровень не достигнут';
    interactions.push({
      id: 'topic_' + tr.topicId + '_level',
      type: 'other',
      result: 'neutral',
      response: levelValue,
      correct: '',
      description: tr.topicName + ': уровень'
    });
  });

  // --- Блок 3: рекомендованные курсы для тем без достигнутого уровня ---
  topicResults.forEach(function (tr) {
    if (tr.achievedLevelIndex === null && tr.recommendedLinks && tr.recommendedLinks.length > 0) {
      tr.recommendedLinks.forEach(function (link, i) {
        var objectId = '';
        try {
          var match = link.url.match(/object_id=([^&]+)/);
          if (match) objectId = match[1];
        } catch (e) {}
        if (!objectId) return;

        interactions.push({
          id: 'topic_' + tr.topicId + '_course_' + i,
          type: 'other',
          result: 'neutral',
          response: objectId,
          correct: '',
          description: tr.topicName + ': рекомендованный курс'
        });
      });
    }
  });

  // Отправляем в LMS
  // PRD-5 (B5): append scale_{key}[_level] pseudo-interactions for published scales.
  pushAll(interactions, buildScaleInteractions(scaleComputation));
  // PRD-2 (A7): append var_{name} pseudo-interactions for published variables.
  pushAll(interactions, buildResultVarInteractions(resultComputation));
  // Версия формата строк ответа: без неё разбор выгрузки не отличит новый формат от старого.
  interactions.push(buildResponseFormatInteraction());
  // PRD-56 FR-19a: версия публикации и выданные варианты — о самом прохождении, а не о ответах.
  pushAll(interactions, buildRunMetaInteractions());
  // PRD-54 BR-54-35: метка регистрации — по ней импорт различает попытки одного дня.
  pushAll(interactions, buildRegistrationInteraction());

  // A run with nothing to grade reports NO score (shared `lmsScoreFor`): «Пройден, 0 баллов»
  // is a verdict we mean and a number we do not.
  var lmsScore = window.TBTemplate.lmsScoreFor({ percent: percentScore, possiblePoints: results.possiblePoints });
  SCORM.finish(
    lmsScore ? lmsScore.raw : null,
    lmsScore ? lmsScore.max : null,
    // PRD-57 FR-40: попытка, в которой есть непроверенный ответ, отправляет `unknown`,
    // а не `failed`. «Не сдал» по работе, которую никто не смотрел, — претензия
    // участника, а не неточность данных.
    results.gradingComplete === false ? null : passedForLms,
    objectives,
    interactions
  );

  // Записываем уровень ПОСЛЕ finish
  try {
    SCORM.setValue('cmi.location', 'level:' + maxAchievedLevel);
    SCORM.commit();
  } catch (e) { }
}

window.finishAndClose = finishAndClose;


/**
 * PRD-4 v1.1 §4.4: compute the result of a single section (topic) using the
 * same scoring math as {@link calculateResults} but scoped to questions of
 * the given topicId. Called from the page-sequence navigation when the
 * learner enters the first `after_topic` content page for a topic, so
 * templates can bind `data-path="section.current.result.percent"` etc.
 * The result is cached in `state.sectionResults[topicId]` and returned.
 */
// PRD-19 Block E (FR-07/FR-13): the answer that COUNTS for grading. In flexible
// mode (allowReturnToUnanswered) a question counts only if it was explicitly
// submitted ('answered'); a surviving draft (selected but never «Отправить», kept
// for resume per FR-03b), a skipped or an unreached question scores 0 (incorrect).
// Strict mode grades as-is — it has no navigable drafts («Далее»/«Завершить» IS the
// explicit submission), so leaving it untouched avoids any scoring regression.
function gradedAnswerFor(q) {
  if (
    TEST_DATA.allowReturnToUnanswered &&
    state.questionStatuses &&
    state.questionStatuses[q.id] !== "answered"
  ) {
    return undefined;
  }
  return state.answers[q.id];
}

/**
 * PRD-24: stable id of the PRD-17 variant delivered for `topicId` in THIS run
 * (pinned into `state.variant.sections` by generateVariant). Returns null for a
 * non-variant topic and for sessions saved BEFORE the pin existed — the pass-rule
 * resolver then degrades a `by_variant` rule to the overall one instead of failing.
 */
function deliveredFormId(topicId) {
  var sections = (state.variant && state.variant.sections) || [];
  for (var i = 0; i < sections.length; i++) {
    if (sections[i].topicId === topicId) return sections[i].formId || null;
  }
  return null;
}

function computeSectionResult(topicId) {
  if (state.sectionResults && state.sectionResults[topicId]) {
    return state.sectionResults[topicId];
  }
  var earnedPoints = 0;
  var possiblePoints = 0;
  var fullyCorrect = 0;
  var total = 0;
  var breakdownItems = [];
  var section = TEST_DATA.sections.find(function (s) { return s.topicId === topicId; }) || null;

  state.flatQuestions.forEach(function (fq) {
    if (fq.topicId !== topicId) return;
    var q = fq.question;
    var answer = gradedAnswerFor(q);
    var scoreRatio = checkAnswer(q, answer);
    // PRD-18: preserve a legitimate 0-point price (don't coerce 0 -> 1); only an
    // ABSENT price falls back to the system default of 1, matching the web grader.
    var qPoints = q.points != null ? q.points : 1;
    total++;
    possiblePoints += qPoints;
    earnedPoints += qPoints * scoreRatio;
    if (scoreRatio === 1) fullyCorrect++;
    // PRD-50 FR-19: тот же гейт, что у итогов теста. Измерительный вопрос в разрез не
    // попадает — то же исключение, что делает `aggregateStandardResult` (FR-02).
    if (!(typeof TBQType !== 'undefined' && TBQType.isMeasurementOnly(q))) {
      breakdownItems.push({
        sectionId: topicId,
        axisKeys: q.tags && q.tags.length ? { tag: q.tags } : null,
        earned: qPoints * scoreRatio,
        possible: qPoints,
        answered: answer !== undefined && answer !== null
      });
    }
  });

  var percent = possiblePoints > 0 ? (earnedPoints / possiblePoints) * 100 : 0;
  // PRD-18: resolve the topic rule via the SAME shared engine as calculateResults
  // (inherit_overall -> overall, none -> null), not the local pass-check.
  var passRule = section ? section.topicPassRule : null;
  // PRD-24: pass the delivered variant so a `by_variant` rule gates this topic by ITS
  // threshold. State saved before PRD-24 has no pin → null → degrades to the overall rule.
  var resolvedRule = window.TBTemplate.resolveTopicRule(
    passRule,
    window.TBTemplate.resolveOverallRule(TEST_DATA.overallPassRule),
    { formId: deliveredFormId(topicId) }
  );
  var passed = resolvedRule ? window.TBTemplate.checkPassRule(resolvedRule, percent, earnedPoints) : null;

  // Строки разреза раздела: только счёт, без вердикта. Пороги подтем ничего не судят
  // (решение владельца 2026-09-03) — вердикт раздела дало его собственное правило выше.
  var sectionEntries = window.TBTemplate.computeBreakdowns(breakdownItems).filter(function (e) {
    return e.scope !== 'test';
  });

  var result = {
    topicId: topicId,
    topicName: section ? section.topicName : "",
    correct: fullyCorrect,
    total: total,
    earnedPoints: earnedPoints,
    possiblePoints: possiblePoints,
    percent: percent,
    passed: passed,
    passRule: passRule,
    // PRD-24: same as in calculateResults — the section screen must be able to show
    // the threshold that actually applied to the delivered variant.
    resolvedPassRule: resolvedRule,
    recommendedCourses: section ? (section.recommendedCourses || []) : [],
    recommendedEvents: section ? (section.recommendedEvents || []) : [],
    breakdown: sectionEntries,
  };

  if (!state.sectionResults) state.sectionResults = {};
  state.sectionResults[topicId] = result;
  return result;
}

function calculateResults() {
  // PRD-18: the STANDARD result aggregation + pass-rule evaluation is the SINGLE
  // shared engine (window.TBTemplate.aggregateStandardResult) — the SAME one the
  // web grader (attempts.ts) runs. No per-host pass-rule logic lives here anymore;
  // this only groups the delivered questions by topic (delivery order) and maps the
  // shared result back into the runtime's existing shape.
  var order = [];
  var byTopic = {};
  state.flatQuestions.forEach(function (fq) {
    var q = fq.question;
    if (!byTopic[fq.topicId]) {
      var section = TEST_DATA.sections.find(function (s) { return s.topicId === fq.topicId; });
      byTopic[fq.topicId] = {
        topicId: fq.topicId,
        topicName: fq.topicName,
        topicPassRule: section ? section.topicPassRule : null,
        // PRD-24: the delivered variant decides which threshold gates this topic.
        formId: deliveredFormId(fq.topicId),
        // «Тест пройден, если»: the `*_required_topics*` policies gate on this flag.
        required: section ? section.required !== false : true,
        // PRD-50 FR-11: блок разделов, в который автор поместил ЭТОТ раздел; выпечен в
        // TEST_DATA как section.groupKey. Отсутствие = раздел вне блоков.
        groupKey: section ? (section.groupKey || null) : null,
        questions: [],
        extra: {
          recommendedCourses: (section && section.recommendedCourses) || [],
          recommendedEvents: (section && section.recommendedEvents) || []
        }
      };
      order.push(fq.topicId);
    }
    byTopic[fq.topicId].questions.push({
      // PRD-57 (#43): исход каждого ответа попадает в результат — пакету он нужен ровно
      // так же, как вебу: телеметрия отдаёт его аналитике.
      id: q.id,
      type: q.type,
      correct: q.correct || {},
      scoring: q.scoring,
      points: q.points != null ? q.points : 1,
      // PRD-19 Block E (FR-07/FR-13): drafts/skipped/unanswered score 0 in flexible mode.
      answer: gradedAnswerFor(q),
      // PRD-50 FR-15: this question's breakdown axis keys; baked into TEST_DATA as q.tags.
      axisKeys: q.tags && q.tags.length ? { tag: q.tags } : null
    });
  });

  var sections = order.map(function (tid) { return byTopic[tid]; });
  var agg = window.TBTemplate.aggregateStandardResult({
    sections: sections,
    overallPassRule: TEST_DATA.overallPassRule,
    // «Тест пройден, если»: baked with the package. Absent in a package built before
    // the setting shipped — the shared engine then keeps the pre-policy verdict.
    passDecisionPolicy: TEST_DATA.passDecisionPolicy,
    // PRD-50 FR-53: учитывать ли подтемы в вердикте темы. Выпекается только когда автор
    // включил; в пакете, собранном раньше, поля нет — ядро читает это как «выключено».
    breakdownGateEnabled: TEST_DATA.breakdownGateEnabled
  });

  // PRD-50 FR-35/FR-36: both scopes in ONE flat array — its and only its `buildResultVarContext`
  // reads, so `tag()` can reach any scope.
  var breakdowns = (agg.breakdowns || []).slice();
  for (var bi = 0; bi < agg.topicResults.length; bi++) {
    var secEntries = agg.topicResults[bi].breakdown || [];
    for (var bj = 0; bj < secEntries.length; bj++) breakdowns.push(secEntries[bj]);
  }

  return {
    correct: agg.correct,
    totalQuestions: agg.totalQuestions,
    earnedPoints: agg.earnedPoints,
    possiblePoints: agg.possiblePoints,
    percent: agg.percent,
    passed: agg.passed,
    breakdowns: breakdowns,
    topicResults: agg.topicResults.map(function (t) {
      return {
        topicId: t.topicId,
        topicName: t.topicName,
        correct: t.correct,
        total: t.total,
        earnedPoints: t.earnedPoints,
        possiblePoints: t.possiblePoints,
        percent: t.percent,
        passed: t.passed,
        passRule: t.passRule,
        // PRD-24: the rule that actually gated the topic (the delivered variant's
        // threshold for a `by_variant` rule). The «Требуется…» label reads THIS, and
        // it is persisted with the attempt, so dropping it here would silently blank
        // the label — including for past attempts.
        resolvedPassRule: t.resolvedPassRule,
        recommendedCourses: t.extra.recommendedCourses,
        recommendedEvents: t.extra.recommendedEvents,
        // PRD-50: this topic's breakdown records. Kept ON the topic on purpose:
        // `saveAttemptResult` persists `topicResults` verbatim, and this is the ONLY
        // path a breakdown record has into a saved attempt — without it, «Мой результат»
        // and the report downloaded from it would print nothing where the web host on
        // the same attempt prints bars (§14, item 5). Cost: ~3KB per attempt against the
        // 30-55KB `flatQuestions` already weighs.
        //
        // Omitted (not `[]`) when empty: `aggregateStandardResult` always returns an
        // array on `t.breakdown`, even for a topic with no keyed questions, so writing
        // it unconditionally would put `"breakdown":[]` on every topic of every attempt
        // — a few bytes each, on every test, whether or not it uses PRD-50 at all.
        // `JSON.stringify` drops an `undefined` value's key outright, which is the one
        // way to add nothing for a test that carries no keys.
        breakdown: (t.breakdown && t.breakdown.length) ? t.breakdown : undefined,
        // PRD-50 FR-11: блок раздела уходит в suspend_data вместе с темой — попытка
        // помнит принадлежность, с которой её оценивали. `aggregateStandardResult`
        // ставит поле ТОЛЬКО у раздела с блоком, а `JSON.stringify` гасит `undefined`,
        // поэтому попытка теста без блоков не весит ни байтом больше.
        groupKey: t.groupKey
      };
    })
  };
}

// Returns a score between 0 and 1 (supports partial credit)
function checkAnswer(q, answer) {
  if (answer === undefined || answer === null) return 0;

  // PRD-10: delegate to the graded scoring engine when joined (package runtime).
  // Returns s/sMax in [0,1]; absent q.scoring => exact 0/1 (FR-02). Falls back to
  // the inline exact logic when the engine is not present (e.g. isolated tests).
  if (typeof ScoringEngine !== 'undefined') {
    return ScoringEngine.scoreAnswer({
      type: q.type, correct: q.correct || {}, answer: answer, scoring: q.scoring,
    }).ratio;
  }

  var correct = q.correct || {};

  if (TBQType.isSingleIndexChoice(q.type)) {
    return answer === correct.correctIndex ? 1 : 0;
  }

  if (q.type === 'multiple') {
    var correctIndices = Array.isArray(correct.correctIndices) ? correct.correctIndices.slice() : [];
    var user = Array.isArray(answer) ? answer.slice() : [];

    if (correctIndices.length === 0) return 0;
    if (user.length !== correctIndices.length) return 0;

    correctIndices.sort();
    user.sort();

    for (var i = 0; i < correctIndices.length; i++) {
      if (correctIndices[i] !== user[i]) return 0;
    }
    return 1;
  }

  if (q.type === 'matching') {
    var pairs = (answer && typeof answer === 'object') ? answer : {};
    var correctPairs = Array.isArray(correct.pairs) ? correct.pairs : [];

    if (Object.keys(pairs).length !== correctPairs.length) return 0;

    for (var i = 0; i < correctPairs.length; i++) {
      var p = correctPairs[i];
      if (pairs[p.left] !== p.right) return 0;
    }
    return 1;
  }

  if (q.type === 'ranking') {
    var order = Array.isArray(answer) ? answer : [];
    var correctOrder = Array.isArray(correct.correctOrder) ? correct.correctOrder : [];

    if (order.length !== correctOrder.length) return 0;

    for (var i = 0; i < order.length; i++) {
      if (order[i] !== correctOrder[i]) return 0;
    }
    return 1;
  }

  return 0;
}

function checkPassRule(rule, correct, total) {
  if (!rule) return true;
  if (rule.type === 'percent') {
    return (correct / total) * 100 >= rule.value;
  }
  return correct >= rule.value;
}

function checkPassRuleWithPartial(rule, percent, earnedScore) {
  if (!rule) return true;
  if (rule.type === 'percent') {
    return percent >= rule.value;
  }
  // PRD-10 FR-10: the count threshold is compared against the section score Σs
  // (earned points), not the number of fully-correct questions. For exact
  // scoring with 1 point per question Σs equals the correct count, so legacy
  // tests are unaffected; with graded/weighted scoring it tracks earned points.
  return earnedScore >= rule.value;
}

// Собирает уникальные рекомендованные курсы для проваленных тем
function collectFailedTopicCourses(results) {
  var courses = [];
  var seenTitles = {};

  if (!results || !results.topicResults) return courses;

  results.topicResults.forEach(function (topic) {
    var isFailed = topic.passed === false ||
      (topic.passed === null && topic.percent < 100) ||
      (topic.achievedLevelIndex !== undefined && topic.achievedLevelIndex === null);

    if (!isFailed) return;

    if (topic.recommendedCourses && topic.recommendedCourses.length > 0) {
      topic.recommendedCourses.forEach(function (course) {
        if (!seenTitles[course.title]) {
          seenTitles[course.title] = true;
          courses.push({ title: course.title, url: course.url });
        }
      });
    }

    if (topic.recommendedLinks && topic.recommendedLinks.length > 0) {
      topic.recommendedLinks.forEach(function (link) {
        if (!seenTitles[link.title]) {
          seenTitles[link.title] = true;
          courses.push({ title: link.title, url: link.url });
        }
      });
    }
  });

  return courses;
}

/** SCORM numbers options from 1; our answers are 0-based indices. */
function to1(x) {
  return typeof x === 'number' ? x + 1 : x;
}

/**
 * The SCORM 2004 interaction type for a question. Branch on the TYPE TRAIT, never on
 * a literal, so a new question type does not silently fall through to `other`.
 */
function mapScormType(q) {
  // «Сценарий в ИС»: прогон по шагам — взаимодействие `performance` стандарта.
  if (TBQType.isSimulation(q.type)) return 'performance';
  if (TBQType.isSingleIndexChoice(q.type)) return 'choice';
  if (q.type === 'multiple') return 'choice';
  if (q.type === 'matching') return 'matching';
  if (q.type === 'ranking') return 'sequencing';
  // PRD-57 FR-27: текстовый ввод — `fill-in`. Признак, а не литерал.
  if (TBQType.isTextEntry(q.type)) return 'fill-in';
  // PRD-57 FR-24h: задание с пропусками уезжает ОДНИМ взаимодействием `fill-in`, а не по
  // одному на пропуск. В выгрузке WebTutor на взаимодействие приходится ровно четыре
  // подколонки, и задание с шестью пропусками превратило бы отчёт в частокол столбцов.
  if (TBQType.hasBlanks(q.type)) return 'fill-in';
  // PRD-57 FR-19: развёрнутый ответ — `long-fill-in`; эталона у него нет вовсе.
  if (TBQType.isOpenText(q.type)) return 'long-fill-in';
  return 'other';
}

/**
 * The learner answer as the string `cmi.interactions.n.learner_response` carries.
 *
 * An unanswered question yields '' — the same value the caller passes for a missing
 * reference answer, which is why the null guard comes first.
 */
function formatResponse(q, ans) {
  if (ans == null) return '';

  // «Сценарий в ИС»: ответ `performance` — шаги «имя[.]значение» через `[,]`: исход, доля цели
  // в процентах и счётчики штрафов. Протокол в LMS не уходит — у отчёта на взаимодействие
  // четыре подколонки, и сотни событий их бы затопили; он едет телеметрией.
  if (TBQType.isSimulation(q.type)) {
    var c = ans.counts || {};
    var share = ans.goal && typeof ans.goal.share === 'number' ? Math.round(ans.goal.share * 100) : 0;
    return [
      'outcome[.]' + (ans.outcome || ''),
      'goal[.]' + share,
      'misses[.]' + (c.misses || 0),
      'blocked[.]' + (c.blocked || 0),
      'wrong[.]' + (c.wrongValues || 0),
      'detours[.]' + (c.detours || 0),
      'traps[.]' + (c.traps || 0),
      'hints[.]' + (c.hints || 0),
    ].join('[,]');
  }

  // PRD-57 §6.5: ответ уже строка, и в отчёт LMS он уходит РОВНО таким, каким его набрал
  // участник. Нормализация живёт в сравнении: разбирая спор, важно видеть написание.
  if (TBQType.isTextEntry(q.type)) return String(ans);
  // PRD-57 §5: развёрнутый ответ уходит в отчёт LMS ровно таким, каким его набрали.
  if (TBQType.isOpenText(q.type)) return String(ans);
  // PRD-57 FR-24h: ответы пропусков идут в порядке набора правил и разделяются `[,]` —
  // записью стандарта. Порядок берётся из эталона, а не из объекта ответа: у объекта
  // порядок ключей ничего не гарантирует, а отчёт читают по колонкам.
  if (TBQType.hasBlanks(q.type)) {
    var sets = (q.correct && Array.isArray(q.correct.blanks)) ? q.correct.blanks : [];
    var written = (ans && typeof ans === 'object' && !Array.isArray(ans)) ? ans : {};
    return sets.map(function (set) {
      var v = set ? written[set.id] : '';
      return typeof v === 'string' ? v : '';
    }).join('[,]');
  }
  if (TBQType.isSingleIndexChoice(q.type)) return String(to1(ans));
  if (q.type === 'multiple') return (Array.isArray(ans) ? ans : []).map(to1).join(',');
  if (q.type === 'ranking') return (Array.isArray(ans) ? ans : []).map(to1).join(',');
  if (q.type === 'matching') {
    return Object.keys(ans)
      .map(Number)
      .sort(function (a, b) { return a - b; })
      .map(function (k) { return to1(k) + '-' + to1(ans[k]); })
      .join(',');
  }
  // PRD-44 FR-54: ответ ВЕКТОРНЫЙ — «индекс[.]балл» через запятую. Тип `numeric` не
  // подходит (ответ не одно число), `matching` семантически ложен (пар нет), поэтому
  // взаимодействие пишется как `other`, а строка остаётся разбираемой отчётом LMS.
  // Нули НЕ выбрасываются: «поставил ноль» и «не дошёл» — разные факты для аналитики.
  // Индексы 1-based, как у всех остальных типов (формат версии 2, см.
  // `buildResponseFormatInteraction`): до выравнивания «1» у выбора и «1» у распределения
  // означали РАЗНЫЕ варианты, и читатель выгрузки ошибался на единицу.
  if (TBQType.distributesBudget(q.type)) {
    return Object.keys(ans)
      .map(Number)
      .sort(function (a, b) { return a - b; })
      .map(function (i) { return to1(i) + '[.]' + ans[i]; })
      .join(',');
  }
  return '';
}

/**
 * The reference answer in the same shape a learner answer arrives in, so one
 * formatter serves both. `null` for a measurement question — it has no reference at
 * all, and the formatter turns that into an empty `correct_responses` pattern.
 */
function getCorrectAnswerFor(q) {
  var c = q.correct || {};
  if (TBQType.isSingleIndexChoice(q.type)) return c.correctIndex;
  if (q.type === 'multiple') return c.correctIndices || [];
  if (q.type === 'ranking') return c.correctOrder || [];
  if (q.type === 'matching') {
    var m = {};
    (c.pairs || []).forEach(function (p) { m[p.left] = p.right; });
    return m;
  }
  return null;
}

/**
 * `cmi.interactions.n.correct_responses.0.pattern` для ОДНОГО задания.
 *
 * У текстового ввода эталон — набор правил (PRD-57 §6.1), и в `fill-in` он представим
 * только тогда, когда все правила БУКВАЛЬНЫ: подстановочные знаки `*` и `?` стандартом для
 * этого взаимодействия не предусмотрены. Как только образец появляется, эталон не пишется
 * вовсе — промолчать честнее, чем отправить в отчёт LMS шаблон, который прочтут как ответ.
 *
 * Несколько допустимых ответов разделяются `[,]` — запись стандарта для `fill-in`.
 */
function correctPatternFor(q) {
  // «Сценарий в ИС»: эталона-ответа у сценария нет — есть цель и проверки внутри сценария.
  if (TBQType.isSimulation(q.type)) return '';
  // PRD-57 FR-19: у развёрнутого ответа эталона НЕТ — `correct_responses` не пишется
  // вовсе. Пустая рамка в отчёте читалась бы как потерянные данные.
  if (TBQType.isOpenText(q.type)) return '';
  // PRD-57 FR-24h: эталоны пропусков — в том же порядке, тем же разделителем. Пропуск,
  // у которого эталона одной строкой нет (выражение, допуск, подстановочный знак),
  // обнуляет весь образец: половина эталона в отчёте хуже, чем его отсутствие.
  if (TBQType.hasBlanks(q.type)) {
    var blanks = (q.correct && Array.isArray(q.correct.blanks)) ? q.correct.blanks : [];
    if (blanks.length === 0) return '';
    if (typeof TBTemplate === 'undefined' || !TBTemplate.referenceAnswer) return '';
    var TBb = TBTemplate;
    var refs = [];
    for (var bi = 0; bi < blanks.length; bi++) {
      var ref = TBb.referenceAnswer(blanks[bi]);
      if (ref === null) return '';
      refs.push(ref);
    }
    return refs.join('[,]');
  }
  if (TBQType.isTextEntry(q.type)) {
    var set = q.correct || {};
    var rules = Array.isArray(set.rules) ? set.rules : [];
    if (rules.length === 0) return '';
    var values = [];
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (!rule || rule.kind !== 'text' || rule.match !== 'wildcard') return '';
      var value = String(rule.value == null ? '' : rule.value);
      if (value.indexOf('*') !== -1 || value.indexOf('?') !== -1) return '';
      values.push(value);
    }
    return values.join('[,]');
  }
  return formatResponse(q, getCorrectAnswerFor(q));
}

/**
 * The SCORM 2004 outcome of ONE question interaction.
 *
 * A measurement question (a scale without a correct grading, an allocation of points)
 * is never right or wrong: it has no reference answer at all, so grading returns zero
 * and `incorrect` would show the LMS report a learner mistake where there is nothing
 * to get wrong. SCORM 2004 has a separate outcome for exactly this — `neutral`
 * (PRD-26 FR-08, PRD-44 FR-09). The rule reads the TYPE trait, so it covers both
 * measurement types at once and any future one.
 */
function interactionResultFor(question, fullCorrect) {
  var measurementOnly = typeof TBQType !== 'undefined' && TBQType.isMeasurementOnly(question);
  return measurementOnly ? 'neutral' : (fullCorrect ? 'correct' : 'incorrect');
}

/**
 * ONE question interaction for the LMS report, assembled in ONE place.
 *
 * Each finish path used to build this object inline from its own private copies of
 * the helpers above, and the copies drifted twice: the `neutral` outcome landed in a
 * dead path (229f3d12) and, right after it, so did the allocation response format —
 * WebTutor showed every ЧИЛ answer as an empty «Полученный ответ» while the unit test,
 * which extracted the FIRST copy by name, stayed green. A single assembler removes the
 * place where that can happen: a path can choose WHICH answer it reports (graded vs
 * raw), never how it is reported.
 *
 * @param {object} question baked question — needs `id`, `type`, `prompt`, `correct`
 * @param {*} answer the learner answer to report, in its per-type shape
 * @param {boolean} fullCorrect whether that answer scored full marks
 * @returns {object} interaction record for `SCORM.finish`
 */
/**
 * ONE topic result as a SCORM 2004 objective.
 *
 * The score travels in POINTS with its own scale — `raw` alone is unreadable in an LMS
 * report («18» out of what?), and `scaled` is what most report builders aggregate on.
 * The topic NAME travels too: `topic_<uuid>` identifies nothing to the person reading
 * the report.
 *
 * Three score states, and the difference between the last two matters:
 *  - graded topic        -> points out of points;
 *  - measurement topic   -> NO score block at all. Zero out of zero is «nothing to
 *    grade», and reporting it as 0 reads as «scored nothing», which is a different
 *    claim about the learner (PRD-26 FR-08);
 *  - legacy attempt      -> a record saved by an older package carries only `percent`
 *    (no points at all), and the best-attempt path replays exactly such records — so
 *    it degrades to the percent scale rather than losing the result.
 *
 * @param {object} tr topic result — `topicId`, `topicName`, points and `passed`
 * @returns {object} objective record for `SCORM.finish`
 */
function buildTopicObjective(tr) {
  var hasPoints = typeof tr.possiblePoints === 'number';
  var possible = hasPoints ? tr.possiblePoints : 0;
  var earned = typeof tr.earnedPoints === 'number' ? tr.earnedPoints : 0;
  var score = null;

  if (hasPoints) {
    if (possible > 0) score = { raw: earned, min: 0, max: possible, scaled: ratio(earned / possible) };
  } else if (typeof tr.percent === 'number') {
    score = { raw: Math.round(tr.percent), min: 0, max: 100, scaled: ratio(tr.percent / 100) };
  }

  return {
    id: 'topic_' + tr.topicId,
    description: tr.topicName || '',
    score: score,
    // FR-09: a topic with nothing to grade has no verdict either — `failed` would
    // claim the learner fell short of a threshold that was never applied.
    success: (tr.passed === null || tr.passed === undefined)
      ? 'unknown'
      : (tr.passed ? 'passed' : 'failed'),
    completion: 'completed'
  };
}

/** `score.scaled` is a real in -1..1; four decimals is as fine as any report reads. */
function ratio(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * The service interaction that tells the LMS report WHICH response format this package
 * writes (`meta_response_format`).
 *
 * Version 1 (packages built before 2026-09-12) encoded an allocation of points 0-based while
 * every other type was 1-based; version 2 aligned them. The two cannot be told apart by the
 * string itself — «0,1,2» and «1,2,3» are equally plausible index sets — so the version has
 * to travel with the data. An absent block in an export therefore means version 1, which is
 * exactly what packages already in the field send.
 *
 * `neutral`, like the other service blocks (`scale_*`, `var_*`): there is nothing to be right
 * or wrong about.
 */
function buildResponseFormatInteraction() {
  return {
    id: 'meta_response_format',
    type: 'other',
    result: 'neutral',
    response: '2',
    correct: '',
    description: 'Версия формата строк ответа'
  };
}

/**
 * Идентификаторы вариантов (PRD-17), выданных этому прохождению — по одному на раздел в
 * режиме вариантов. Пустой список у теста без вариантов, и это не потеря данных.
 *
 * Читается `state.deliveredForms` — карта «тема -> вариант», которую заполняет
 * `generateVariant()` и восстанавливает `sessionRecovery`: продолженный прогон сообщает тот
 * же состав, что и непрерывный.
 */
function deliveredFormIds() {
  try {
    var map = (typeof state !== 'undefined' && state.deliveredForms) || {};
    var out = [];
    for (var topicId in map) {
      if (!Object.prototype.hasOwnProperty.call(map, topicId)) continue;
      if (map[topicId]) out.push(map[topicId]);
    }
    return out;
  } catch (e) {
    return [];
  }
}

/**
 * Служебные блоки о САМОМ прохождении: версия публикации и выданные варианты
 * (PRD-56 FR-19a). Зеркало `shared/lms-export/meta.ts`, парность держит
 * `tests/scorm-meta-blocks`.
 *
 * Блока НЕТ, когда сообщать нечего: у пакета черновика версии не существует, у теста без
 * вариантов — вариантов. Пустая ячейка и отсутствующая колонка означают для разбора одно и
 * то же «не сообщено», а выдуманный номер версии сделал бы разрез по версиям бесполезным
 * ровно там, где он и нужен.
 *
 * `neutral`, как и прочие служебные блоки: правильного ответа тут нет.
 */
function buildRunMetaInteractions() {
  var out = [];
  var version = (typeof TEST_DATA !== 'undefined' && TEST_DATA.publicationVersion) || null;
  if (version) {
    out.push({
      id: 'meta_test_version',
      type: 'other',
      result: 'neutral',
      response: String(version),
      correct: '',
      description: 'Версия публикации теста'
    });
  }

  var forms = deliveredFormIds();
  if (forms.length > 0) {
    out.push({
      id: 'meta_variant',
      type: 'other',
      result: 'neutral',
      response: forms.join(';'),
      correct: '',
      description: 'Выданные варианты'
    });
  }

  return out;
}

/**
 * Метка регистрации SCO (PRD-54 раздел 7.1b, BR-54-35): по ней импорт выгрузки различает две
 * строки одного участника за одну дату. Зеркало `REGISTRATION_INTERACTION_ID` из
 * `shared/lms-export/meta.ts`, парность держит `tests/scorm-meta-blocks`.
 *
 * Метку хранит `registrationMark` (`suspendAttempts.js`); блока нет, если состояние недоступно.
 * `neutral`, как и прочие служебные блоки.
 */
function buildRegistrationInteraction() {
  var mark = (typeof registrationMark === 'function') ? registrationMark() : '';
  if (!mark) return [];
  return [{
    id: 'meta_registration',
    type: 'other',
    result: 'neutral',
    response: mark,
    correct: '',
    description: 'Метка прохождения'
  }];
}

/**
 * Time spent on this question as an ISO 8601 duration for `cmi.interactions.n.latency`.
 *
 * An empty string when the question was never shown (a run restored mid-way, a question the
 * learner never reached): the element is then skipped entirely rather than written as «PT0S»,
 * which would claim an instant answer. Mirrors `formatScormDuration` of
 * `shared/lms-export/duration`, and the mirror is held by `tests/scorm-latency`.
 */
function questionLatency(questionId) {
  if (typeof TBQuestionTime === 'undefined') return '';
  var ms = TBQuestionTime.totalMsFor(questionId);
  if (!ms || ms <= 0) return '';

  var total = Math.floor(ms / 1000);
  var hours = Math.floor(total / 3600);
  var minutes = Math.floor((total % 3600) / 60);
  var seconds = total % 60;

  var out = 'PT';
  if (hours > 0) out += hours + 'H';
  if (minutes > 0) out += minutes + 'M';
  if (seconds > 0 || out === 'PT') out += seconds + 'S';
  return out;
}

/**
 * «Сценарий в ИС»: протокол прогона для отчёта LMS — псевдо-взаимодействия `sim_<id>_<n>`.
 *
 * Требование владельца 2026-10-08: всё, что аналитика берёт из телеметрии и веба, приходит и
 * выгрузкой отчёта. Сцены, типичные ошибки и карта промахов строятся по протоколу, поэтому он
 * едет здесь — сжатый до входных событий (`shared/sim/protocol-codec`, зеркало разбора в
 * `shared/lms-export/parse.ts`); остальное импорт восстановит повтором прогона.
 *
 * Протокол есть только у ответа, сыгранного в этой сессии SCO (поле `protocol`, см.
 * `simulation.js`): у восстановленного из `suspend_data` — нет, и блоков тогда нет тоже.
 * `neutral`, как и прочие служебные блоки.
 */
function buildSimProtocolInteractions() {
  var out = [];
  state.flatQuestions.forEach(function (fq) {
    var q = fq.question;
    if (!TBQType.isSimulation(q.type)) return;
    var answer = state.answers[q.id];
    if (!answer || !answer.protocol) return;
    var chunks = TBTemplate.simProtocolChunks(answer.protocol);
    for (var i = 0; i < chunks.length; i++) {
      out.push({
        id: 'sim_' + q.id + '_' + (i + 1),
        type: 'other',
        result: 'neutral',
        response: chunks[i],
        correct: '',
        description: 'Протокол сценария, часть ' + (i + 1)
      });
    }
  });
  return out;
}

function buildQuestionInteraction(question, answer, fullCorrect) {
  // «Сценарий в ИС»: прогон с целью и штрафами не делится на «верно / неверно» — достигнутая
  // цель со штрафом за промах в отчёте LMS читалась бы как провал. SCORM 2004 разрешает в
  // `result` число, и сценарий пишет долю цены, ту же, что пошла в балл.
  var result = TBQType.isSimulation(question.type)
    ? String(Math.round(checkAnswer(question, answer) * 10000) / 10000)
    : interactionResultFor(question, fullCorrect);
  return {
    id: 'q_' + question.id,
    type: mapScormType(question),
    result: result,
    response: formatResponse(question, answer),
    correct: correctPatternFor(question),
    description: authorTextPlain(question.prompt),
    latency: questionLatency(question.id)
  };
}

// Отправка результата в LMS. Телеметрия к этому моменту уже отправлена вызывающим —
// `finishAndClose` шлёт её один раз для ТЕКУЩЕЙ попытки, тогда как в LMS уезжает лучшая.
// `verdictForLms` — настоящий вердикт пакета (без подмены принудительным закрытием): по нему
// баллы для LMS выравниваются с проходным, см. общий `lmsScoreFor`.
function finishScormLmsOnly(results, passedForLms, resultComputation, scaleComputation, verdictForLms) {
  var objectives = results.topicResults.map(buildTopicObjective);

  var interactions = [];

  state.flatQuestions.forEach(function (fq) {
    var q = fq.question;
    // PRD-19 Block E (FR-14): the LMS interaction must reflect the GRADED answer
    // (status-aware), so a surviving draft / skipped / unanswered question reports
    // 'incorrect' with an empty response — consistent with the score (calculateResults
    // uses the same gradedAnswerFor). Strict mode is unchanged (gradedAnswerFor → raw).
    var ans = gradedAnswerFor(q);
    var fullCorrect = checkAnswer(q, ans) === 1;

    interactions.push(buildQuestionInteraction(q, ans, fullCorrect));
  });

  // «Сценарий в ИС»: протокол прогона — следом за вопросами, кусками `sim_<id>_<n>`.
  pushAll(interactions, buildSimProtocolInteractions());

  // --- Рекомендации для проваленных тем: передаём object_id курса ---
  results.topicResults.forEach(function (tr) {
    if (tr.passed === false && tr.recommendedCourses && tr.recommendedCourses.length > 0) {
      tr.recommendedCourses.forEach(function (course, i) {
        var objectId = '';
        try {
          var match = course.url.match(/object_id=([^&]+)/);
          if (match) objectId = match[1];
        } catch (e) {}
        if (!objectId) return;

        interactions.push({
          id: 'topic_' + tr.topicId + '_course_' + i,
          type: 'other',
          result: 'neutral',
          response: objectId,
          correct: '',
          description: tr.topicName + ': рекомендованный курс'
        });
      });
    }
  });

  var percentScore = Math.round(results.percent);

  // НЕ отправляем телеметрию - она уже отправлена в finishAndClose()
  // PRD-5 (B5): append scale_{key}[_level] pseudo-interactions for published scales.
  pushAll(interactions, buildScaleInteractions(scaleComputation));
  // PRD-2 (A7): append var_{name} pseudo-interactions for published variables.
  pushAll(interactions, buildResultVarInteractions(resultComputation));
  // Версия формата строк ответа — тем же блоком, что и в адаптивном пути.
  interactions.push(buildResponseFormatInteraction());
  // PRD-56 FR-19a: версия публикации и выданные варианты — тем же блоком, что и там.
  pushAll(interactions, buildRunMetaInteractions());
  // PRD-54 BR-54-35: метка регистрации — тем же блоком, что и в адаптивном пути.
  pushAll(interactions, buildRegistrationInteraction());

  // A run with nothing to grade reports NO score — the same shared decision the adaptive
  // path makes, so the two finish paths cannot drift on what the LMS is told.
  // WebTutor records the outcome by comparing these points with the course's passing score
  // (the administrator sets it equal to the test's at publication) and ignores
  // success_status, so the points carry the package's verdict where the two disagree.
  var lmsScore = window.TBTemplate.lmsScoreFor({
    percent: percentScore,
    possiblePoints: results.possiblePoints,
    passed: (results.gradingComplete === false || typeof verdictForLms !== 'boolean') ? null : verdictForLms,
    lmsThreshold: TEST_DATA.passPercent
  });
  SCORM.finish(
    lmsScore ? lmsScore.raw : null,
    lmsScore ? lmsScore.max : null,
    // PRD-57 FR-40: попытка, в которой есть непроверенный ответ, отправляет `unknown`,
    // а не `failed`. «Не сдал» по работе, которую никто не смотрел, — претензия
    // участника, а не неточность данных.
    results.gradingComplete === false ? null : passedForLms,
    objectives,
    interactions
  );
}