var scormFinished = false;

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

  console.log('📤 Отправляем в LMS:', Math.round(resultsForLms.percent) + '%, passed:', bestPassed);

  // Отправляем в LMS
  if (isAdaptive) {
    console.log('🔵 Адаптивный тест: принудительно passed=true для LMS');
    finishScormAdaptive(resultsForLms, true);
  } else {
    if (bestAttempt && bestAttempt !== results) {
      console.log('🔄 Восстанавливаем state из лучшей попытки для LMS');
      var savedAnswers = state.answers;
      var savedFlatQuestions = state.flatQuestions;

      state.answers = bestAttempt.answers || {};
      state.flatQuestions = bestAttempt.flatQuestions || [];

      finishScormLmsOnly(resultsForLms, bestPassed);

      state.answers = savedAnswers;
      state.flatQuestions = savedFlatQuestions;
    } else {
      finishScormLmsOnly(resultsForLms, bestPassed);
    }
  }

  try { SCORM.commit(); } catch (e) { }
  try { SCORM.terminate(); } catch (e) { }
  try { window.close(); } catch (e) { }
}

/**
 * Finish SCORM for adaptive mode
 */
function finishScormAdaptive(results, passedForLms) {
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
    var qPoints = q.points || 1;
    total++;
    possiblePoints += qPoints;
    earnedPoints += qPoints * scoreRatio;
    if (scoreRatio === 1) fullyCorrect++;
  });

  var percent = possiblePoints > 0 ? (earnedPoints / possiblePoints) * 100 : 0;
  var passRule = section ? section.topicPassRule : null;
  var passed = passRule ? checkPassRuleWithPartial(passRule, percent, fullyCorrect) : null;

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
  var totalEarnedPoints = 0;
  var totalPossiblePoints = 0;
  var totalFullyCorrect = 0;
  var totalQuestions = 0;
  var topicData = {};

  state.flatQuestions.forEach(function (fq) {
    var q = fq.question;
    var answer = state.answers[q.id];
    var scoreRatio = checkAnswer(q, answer);
    var qPoints = q.points || 1;

    totalPossiblePoints += qPoints;
    totalEarnedPoints += qPoints * scoreRatio;
    totalQuestions++;
    if (scoreRatio === 1) totalFullyCorrect++;

    if (!topicData[fq.topicId]) {
      var section = TEST_DATA.sections.find(function (s) { return s.topicId === fq.topicId; });
      topicData[fq.topicId] = {
        topicId: fq.topicId,
        topicName: fq.topicName,
        correct: 0,
        earnedPoints: 0,
        possiblePoints: 0,
        total: 0,
        passRule: section.topicPassRule,
        topicFeedback: section.topicFeedback || null,
        recommendedCourses: section.recommendedCourses || [],
        recommendedEvents: section.recommendedEvents || []
      };
    }
    topicData[fq.topicId].total++;
    topicData[fq.topicId].possiblePoints += qPoints;
    topicData[fq.topicId].earnedPoints += qPoints * scoreRatio;
    if (scoreRatio === 1) topicData[fq.topicId].correct++;
  });

  var overallPercent = totalPossiblePoints > 0 ? (totalEarnedPoints / totalPossiblePoints) * 100 : 0;
  var overallPassed = checkPassRuleWithPartial(TEST_DATA.overallPassRule, overallPercent, totalFullyCorrect);

  var topicResults = [];
  var allTopicsPassed = true;

  Object.keys(topicData).forEach(function (tid) {
    var td = topicData[tid];
    td.percent = td.possiblePoints > 0 ? (td.earnedPoints / td.possiblePoints) * 100 : 0;
    if (td.passRule) {
      td.passed = checkPassRuleWithPartial(td.passRule, td.percent, td.correct);
      if (!td.passed) allTopicsPassed = false;
    } else {
      td.passed = null;
    }
    topicResults.push(td);
  });

  var passed = overallPassed && allTopicsPassed;

  return {
    correct: totalFullyCorrect,
    totalQuestions: totalQuestions,
    earnedPoints: totalEarnedPoints,
    possiblePoints: totalPossiblePoints,
    percent: overallPercent,
    passed: passed,
    topicResults: topicResults
  };
}

// Returns a score between 0 and 1 (supports partial credit)
function checkAnswer(q, answer) {
  if (answer === undefined || answer === null) return 0;

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

function checkPassRuleWithPartial(rule, percent, fullyCorrectCount) {
  if (!rule) return true;
  if (rule.type === 'percent') {
    return percent >= rule.value;
  }
  return fullyCorrectCount >= rule.value;
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

function finishScorm(results, passedForLms) {
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

  SCORM.finish(percentScore, 100, passedForLms, objectives, interactions);
}

// Версия finishScorm БЕЗ отправки телеметрии (используется когда телеметрия уже отправлена)
function finishScormLmsOnly(results, passedForLms) {
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
  SCORM.finish(percentScore, 100, passedForLms, objectives, interactions);
}