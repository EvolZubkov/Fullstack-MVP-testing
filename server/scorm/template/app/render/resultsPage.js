var scormFinished = false;

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
// percent + per-topic results; PRD-5 scales now fill `scales` (B5);
// tags/sections resolve to neutral defaults (tag aggregation and PRD-4 section
// keys come later).
function buildResultVarContext(results, scaleComputation) {
  var topics = {};
  (results.topicResults || []).forEach(function (tr) {
    topics[tr.topicId] = { percent: tr.percent || 0, passed: tr.passed === true, score: tr.earnedPoints || 0 };
  });
  var scales = (scaleComputation && scaleComputation.values) || {};
  return { percent: results.percent || 0, topics: topics, tags: {}, scales: scales, sections: {} };
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

function pushAll(target, items) {
  for (var i = 0; i < items.length; i++) target.push(items[i]);
}

function finishAndClose() {
  if (scormFinished) return;
  scormFinished = true;

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

  Telemetry.finish({
    percent: results.percent,
    passed: results.passed,
    earnedPoints: results.earnedPoints,
    possiblePoints: results.possiblePoints,
    totalQuestions: results.totalQuestions,
    correct: results.correct,
    achievedLevels: results.achievedLevels || null,
    failedTopicCourses: failedTopicCourses
  });
  console.log('📤 Телеметрия: реальный результат попытки:', Math.round(results.percent) + '%, passed:', results.passed);

  // ===== LMS: отправляем лучшую попытку с хаком если нужно =====
  var attemptsExhausted = !!TEST_DATA.maxAttempts && !hasAttemptsLeft();
  var realPassed = !!results.passed;

  var passedForLms = realPassed;

  if (state.timeExpired) {
    passedForLms = false;
  }

  var forcePassedHack = false;
  if (attemptsExhausted && !realPassed && !state.timeExpired) {
    console.log('🔴 Попытки кончились, принудительно закрываем с passed=true');
    forcePassedHack = true;
    passedForLms = true;
    try {
      SCORM.setValue('cmi.comments_from_learner', 'ATTEMPTS_EXHAUSTED: FAILED (forced close)');
      SCORM.commit();
      console.log('✅ Comments установлены успешно');
    } catch (e) {
      console.log('⚠️ Ошибка установки comments:', e);
    }
  }

  var bestAttempt = getBestAttempt();
  console.log('🏆 Лучшая попытка:', bestAttempt ? Math.round(bestAttempt.percent) + '%' : 'none');

  var resultsForLms = bestAttempt || results;
  var bestPassed = !!resultsForLms.passed;

  if (forcePassedHack) {
    console.log('🔓 Хак активирован - переопределяем passed на true');
    bestPassed = true;
  }

  // PRD-2 (A7): a boolean controls_status="success" variable overrides the LMS
  // pass flag (cmi.success_status); completion is applied after SCORM.finish.
  var rcStatus = (results.resultComputation && results.resultComputation.status) || {};
  if (typeof rcStatus.success === 'boolean') {
    console.log('🎚️ controls_status переопределяет passed:', rcStatus.success);
    bestPassed = rcStatus.success;
    passedForLms = rcStatus.success;
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
    if (bestAttempt && bestAttempt !== results) {
      console.log('🔄 Восстанавливаем state из лучшей попытки для LMS');
      var savedAnswers = state.answers;
      var savedFlatQuestions = state.flatQuestions;

      state.answers = bestAttempt.answers || {};
      state.flatQuestions = bestAttempt.flatQuestions || [];

      finishScormLmsOnly(resultsForLms, bestPassed, resultComputation, scaleComputation);

      state.answers = savedAnswers;
      state.flatQuestions = savedFlatQuestions;
    } else {
      finishScormLmsOnly(resultsForLms, bestPassed, resultComputation, scaleComputation);
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
  try { window.close(); } catch (e) { }
}

/**
 * Finish SCORM for adaptive mode
 */
function finishScormAdaptive(results, passedForLms, resultComputation, scaleComputation) {
  var objectives = results.topicResults.map(function (tr) {
    return {
      id: 'topic_' + tr.topicId,
      score: Math.round(tr.percent),
      status: tr.passed ? 'passed' : 'failed'
    };
  });

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

          interactions.push({
            id: 'q_' + qId,
            type: 'other',
            result: isCorrect ? 'correct' : 'incorrect',
            response: answer !== undefined && answer !== null ? JSON.stringify(answer) : '',
            correct: '',
            description: question.prompt || ''
          });
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

  SCORM.finish(percentScore, 100, passedForLms, objectives, interactions);

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
function computeSectionResult(topicId) {
  if (state.sectionResults && state.sectionResults[topicId]) {
    return state.sectionResults[topicId];
  }
  var earnedPoints = 0;
  var possiblePoints = 0;
  var fullyCorrect = 0;
  var total = 0;
  var section = TEST_DATA.sections.find(function (s) { return s.topicId === topicId; }) || null;

  state.flatQuestions.forEach(function (fq) {
    if (fq.topicId !== topicId) return;
    var q = fq.question;
    var answer = state.answers[q.id];
    var scoreRatio = checkAnswer(q, answer);
    // PRD-18: preserve a legitimate 0-point price (don't coerce 0 -> 1); only an
    // ABSENT price falls back to the system default of 1, matching the web grader.
    var qPoints = q.points != null ? q.points : 1;
    total++;
    possiblePoints += qPoints;
    earnedPoints += qPoints * scoreRatio;
    if (scoreRatio === 1) fullyCorrect++;
  });

  var percent = possiblePoints > 0 ? (earnedPoints / possiblePoints) * 100 : 0;
  // PRD-18: resolve the topic rule via the SAME shared engine as calculateResults
  // (inherit_overall -> overall, none -> null), not the local pass-check.
  var passRule = section ? section.topicPassRule : null;
  var resolvedRule = window.TBTemplate.resolveTopicRule(passRule, window.TBTemplate.resolveOverallRule(TEST_DATA.overallPassRule));
  var passed = resolvedRule ? window.TBTemplate.checkPassRule(resolvedRule, percent, earnedPoints) : null;

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
    topicFeedback: section ? (section.topicFeedback || null) : null,
    recommendedCourses: section ? (section.recommendedCourses || []) : [],
    recommendedEvents: section ? (section.recommendedEvents || []) : [],
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
        questions: [],
        extra: {
          topicFeedback: (section && section.topicFeedback) || null,
          recommendedCourses: (section && section.recommendedCourses) || [],
          recommendedEvents: (section && section.recommendedEvents) || []
        }
      };
      order.push(fq.topicId);
    }
    byTopic[fq.topicId].questions.push({
      type: q.type,
      correct: q.correct || {},
      scoring: q.scoring,
      points: q.points != null ? q.points : 1,
      answer: state.answers[q.id]
    });
  });

  var sections = order.map(function (tid) { return byTopic[tid]; });
  var agg = window.TBTemplate.aggregateStandardResult({
    sections: sections,
    overallPassRule: TEST_DATA.overallPassRule
  });

  return {
    correct: agg.correct,
    totalQuestions: agg.totalQuestions,
    earnedPoints: agg.earnedPoints,
    possiblePoints: agg.possiblePoints,
    percent: agg.percent,
    passed: agg.passed,
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
        topicFeedback: t.extra.topicFeedback,
        recommendedCourses: t.extra.recommendedCourses,
        recommendedEvents: t.extra.recommendedEvents
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

  if (q.type === 'single') {
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

function finishScorm(results, passedForLms, resultComputation, scaleComputation) {
  var objectives = results.topicResults.map(function (tr) {
    return {
      id: 'topic_' + tr.topicId,
      score: Math.round(tr.percent),
      status: tr.passed === null ? 'unknown' : (tr.passed ? 'passed' : 'failed')
    };
  });

  var interactions = [];

  function to1(x) { return typeof x === 'number' ? x + 1 : x; }

  function mapScormType(q) {
    if (q.type === 'single') return 'choice';
    if (q.type === 'multiple') return 'choice';
    if (q.type === 'matching') return 'matching';
    if (q.type === 'ranking') return 'sequencing';
    return 'other';
  }

  function formatResponse(q, ans) {
    if (ans == null) return '';

    if (q.type === 'single') return String(to1(ans));
    if (q.type === 'multiple') return ans.map(to1).join(',');
    if (q.type === 'ranking') return ans.map(to1).join(',');
    if (q.type === 'matching') {
      return Object.keys(ans)
        .sort((a, b) => a - b)
        .map(k => to1(+k) + '-' + to1(ans[k]))
        .join(',');
    }
    return '';
  }

  function getCorrectAnswerFor(q) {
    var c = q.correct || {};
    if (q.type === 'single') return c.correctIndex;
    if (q.type === 'multiple') return c.correctIndices || [];
    if (q.type === 'ranking') return c.correctOrder || [];
    if (q.type === 'matching') {
      var m = {};
      (c.pairs || []).forEach(function (p) { m[p.left] = p.right; });
      return m;
    }
    return null;
  }

  state.flatQuestions.forEach(function (fq) {
    var q = fq.question;
    var ans = state.answers[q.id];
    var fullCorrect = checkAnswer(q, ans) === 1;

    interactions.push({
      id: 'q_' + q.id,
      type: mapScormType(q),
      result: fullCorrect ? 'correct' : 'incorrect',
      response: formatResponse(q, ans),
      correct: formatResponse(q, getCorrectAnswerFor(q)),
      description: q.prompt || ''
    });
  });

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

  var failedTopicCourses = collectFailedTopicCourses(results);

  Telemetry.finish({
    percent: results.percent,
    passed: results.passed,
    earnedPoints: results.earnedPoints,
    possiblePoints: results.possiblePoints,
    totalQuestions: results.totalQuestions,
    correct: results.correct,
    achievedLevels: results.achievedLevels || null,
    failedTopicCourses: failedTopicCourses
  });

  // PRD-5 (B5): append scale_{key}[_level] pseudo-interactions for published scales.
  pushAll(interactions, buildScaleInteractions(scaleComputation));
  // PRD-2 (A7): append var_{name} pseudo-interactions for published variables.
  pushAll(interactions, buildResultVarInteractions(resultComputation));

  SCORM.finish(percentScore, 100, passedForLms, objectives, interactions);
}

// Версия finishScorm БЕЗ отправки телеметрии (используется когда телеметрия уже отправлена)
function finishScormLmsOnly(results, passedForLms, resultComputation, scaleComputation) {
  var objectives = results.topicResults.map(function (tr) {
    return {
      id: 'topic_' + tr.topicId,
      score: Math.round(tr.percent),
      status: tr.passed === null ? 'unknown' : (tr.passed ? 'passed' : 'failed')
    };
  });

  var interactions = [];

  function mapScormType(q) {
    if (q.type === 'single') return 'choice';
    if (q.type === 'multiple') return 'choice';
    if (q.type === 'matching') return 'matching';
    if (q.type === 'ranking') return 'sequencing';
    return 'other';
  }

  function formatResponse(q, answer) {
    if (q.type === 'single') {
      return answer !== undefined && answer !== null ? String(answer + 1) : '';
    }
    if (q.type === 'multiple') {
      var arr = Array.isArray(answer) ? answer : [];
      return arr.map(function (i) { return i + 1; }).join(',');
    }
    if (q.type === 'matching') {
      var pairs = answer || {};
      return Object.keys(pairs).map(function (l) {
        return (parseInt(l, 10) + 1) + '-' + (pairs[l] + 1);
      }).join(',');
    }
    if (q.type === 'ranking') {
      var order = Array.isArray(answer) ? answer : [];
      return order.map(function (i) { return i + 1; }).join(',');
    }
    return '';
  }

  function getCorrectAnswerFor(q) {
    var c = q.correct;
    if (q.type === 'single') return c.correctIndex;
    if (q.type === 'multiple') return c.correctIndices;
    if (q.type === 'ranking') return c.correctOrder;
    if (q.type === 'matching') {
      var m = {};
      (c.pairs || []).forEach(function (p) { m[p.left] = p.right; });
      return m;
    }
    return null;
  }

  state.flatQuestions.forEach(function (fq) {
    var q = fq.question;
    var ans = state.answers[q.id];
    var fullCorrect = checkAnswer(q, ans) === 1;

    interactions.push({
      id: 'q_' + q.id,
      type: mapScormType(q),
      result: fullCorrect ? 'correct' : 'incorrect',
      response: formatResponse(q, ans),
      correct: formatResponse(q, getCorrectAnswerFor(q)),
      description: q.prompt || ''
    });
  });

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

  SCORM.finish(percentScore, 100, passedForLms, objectives, interactions);
}