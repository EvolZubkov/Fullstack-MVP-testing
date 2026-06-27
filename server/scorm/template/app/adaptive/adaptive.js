// app/adaptive/adaptive.js
// Adaptive testing logic for SCORM

/**
 * Initialize adaptive test state
 */
function initAdaptiveTest() {
  if (TEST_DATA.mode !== 'adaptive' || !TEST_DATA.adaptiveTopics) {
    return false;
  }

  var topics = TEST_DATA.adaptiveTopics.map(function(topic, topicIndex) {
    // Initialize levels state
    var levelsState = topic.levels.map(function(level) {
      // Filter questions by difficulty range
      var eligibleQuestions = topic.questions.filter(function(q) {
        return q.difficulty >= level.minDifficulty && q.difficulty <= level.maxDifficulty;
      });

      // Shuffle and select questionsCount
      var selectedQuestions = shuffle(eligibleQuestions.slice()).slice(0, level.questionsCount);
      
      return {
        levelIndex: level.levelIndex,
        levelName: level.levelName,
        minDifficulty: level.minDifficulty,
        maxDifficulty: level.maxDifficulty,
        questionsCount: level.questionsCount,
        passThreshold: level.passThreshold,
        passThresholdType: level.passThresholdType,
        feedback: level.feedback,
        links: level.links || [],
        questionIds: selectedQuestions.map(function(q) { return q.id; }),
        answeredQuestionIds: [],
        correctCount: 0,
        status: 'pending'
      };
    });

    // Start from median level
    var startLevelIndex = Math.floor(levelsState.length / 2);
    if (levelsState.length > 0) {
      levelsState[startLevelIndex].status = 'in_progress';
    }

    return {
      topicId: topic.topicId,
      topicName: topic.topicName,
      failureFeedback: topic.failureFeedback,
      currentLevelIndex: startLevelIndex,
      levelsState: levelsState,
      finalLevelIndex: null,
      status: 'pending'
    };
  });

  // Set first topic as in_progress
  if (topics.length > 0) {
    topics[0].status = 'in_progress';
  }

  state.adaptiveState = {
    topics: topics,
    currentTopicIndex: 0,
    currentQuestionId: null,
    questionsAnswered: 0,
    isFinished: false,
    result: null
  };

  // Get first question
  var firstQuestion = getNextAdaptiveQuestion();
  if (firstQuestion) {
    state.adaptiveState.currentQuestionId = firstQuestion.id;
  }

  return true;
}

/**
 * Get current adaptive question data
 */
function getCurrentAdaptiveQuestion() {
  if (!state.adaptiveState || state.adaptiveState.isFinished) {
    return null;
  }

  var currentTopic = state.adaptiveState.topics[state.adaptiveState.currentTopicIndex];
  if (!currentTopic || currentTopic.status === 'completed') {
    return null;
  }

  var currentLevel = currentTopic.levelsState[currentTopic.currentLevelIndex];
  if (!currentLevel) {
    return null;
  }

  var questionId = state.adaptiveState.currentQuestionId;
  if (!questionId) {
    return null;
  }

  // Find question in topic
  var topicData = TEST_DATA.adaptiveTopics.find(function(t) { 
    return t.topicId === currentTopic.topicId; 
  });
  if (!topicData) return null;

  var question = topicData.questions.find(function(q) { return q.id === questionId; });
  if (!question) return null;

  // Calculate question number in level
  var questionNumber = currentLevel.answeredQuestionIds.length + 1;
  var totalInLevel = currentLevel.questionIds.length;

  return {
    id: questionId,
    question: question,
    topicName: currentTopic.topicName,
    levelName: currentLevel.levelName,
    questionNumber: questionNumber,
    totalInLevel: totalInLevel
  };
}

/**
 * Get next question for adaptive test
 */
function getNextAdaptiveQuestion() {
  if (!state.adaptiveState) return null;

  var currentTopic = state.adaptiveState.topics[state.adaptiveState.currentTopicIndex];
  if (!currentTopic || currentTopic.status === 'completed') {
    return null;
  }

  var currentLevel = currentTopic.levelsState[currentTopic.currentLevelIndex];
  if (!currentLevel || currentLevel.status !== 'in_progress') {
    return null;
  }

  // Find first unanswered question in current level
  for (var i = 0; i < currentLevel.questionIds.length; i++) {
    var qId = currentLevel.questionIds[i];
    if (currentLevel.answeredQuestionIds.indexOf(qId) === -1) {
      // Find question data
      var topicData = TEST_DATA.adaptiveTopics.find(function(t) { 
        return t.topicId === currentTopic.topicId; 
      });
      if (topicData) {
        var question = topicData.questions.find(function(q) { return q.id === qId; });
        if (question) {
          return question;
        }
      }
    }
  }

  return null;
}

/**
 * Submit answer for adaptive question
 * Returns: { isCorrect, levelTransition, topicTransition, isFinished }
 */
function submitAdaptiveAnswer(questionId, answer) {
  if (!state.adaptiveState) return null;

  var currentTopic = state.adaptiveState.topics[state.adaptiveState.currentTopicIndex];
  var currentLevel = currentTopic.levelsState[currentTopic.currentLevelIndex];

  console.log('=== ADAPTIVE ANSWER ===');
  console.log('Topic:', currentTopic.topicName, '| Level:', currentLevel.levelName, '(index:', currentTopic.currentLevelIndex + ')');
  console.log('Levels status:', currentTopic.levelsState.map(function(l) { return l.levelName + ':' + l.status; }).join(', '));

  // Find question
  var topicData = TEST_DATA.adaptiveTopics.find(function(t) { 
    return t.topicId === currentTopic.topicId; 
  });
  var question = topicData.questions.find(function(q) { return q.id === questionId; });
  
  if (!question) return null;

  // Check answer
  var isCorrect = checkAnswer(question, answer) === 1;

  // Подготавливаем данные о вариантах ответов
  var answerOptions = null;
  var leftItems = null;
  var rightItems = null;
  var rankingItems = null;
  
  if (question.type === 'single' || question.type === 'multiple') {
    answerOptions = question.data && question.data.options ? question.data.options : null;
  } else if (question.type === 'matching') {
    leftItems = question.data && question.data.left ? question.data.left : null;
    rightItems = question.data && question.data.right ? question.data.right : null;
  } else if (question.type === 'ranking') {
    rankingItems = question.data && question.data.items ? question.data.items : null;
  }

  // Send answer to telemetry (adaptive)
  // НЕ переопределяем currentTopic и currentLevel - используем те, что получили в начале функции
  Telemetry.answer({
    questionId: question.id,
    questionPrompt: question.prompt,
    questionType: question.type,
    topicId: currentTopic ? currentTopic.topicId : null,
    topicName: currentTopic ? currentTopic.topicName : null,
    difficulty: question.difficulty || 50,
    userAnswer: answer,
    correctAnswer: question.correct,
    isCorrect: isCorrect,
    points: isCorrect ? (question.points || 1) : 0,
    maxPoints: question.points || 1,
    levelIndex: currentLevel ? currentLevel.levelIndex : null,
    levelName: currentLevel ? currentLevel.levelName : null,
    // Варианты ответов для отображения в аналитике
    options: answerOptions,
    leftItems: leftItems,
    rightItems: rightItems,
    items: rankingItems
  });
  
  console.log('Answer correct:', isCorrect);

  // Update level state
  currentLevel.answeredQuestionIds.push(questionId);
  if (isCorrect) {
    currentLevel.correctCount++;
  }

  // Store answer
  state.answers[questionId] = answer;
  state.adaptiveState.questionsAnswered++;

  // Calculate if passed/failed
  var totalAnswered = currentLevel.answeredQuestionIds.length;
  var totalQuestions = currentLevel.questionIds.length;
  var remaining = totalQuestions - totalAnswered;

  var requiredCorrect;
  if (currentLevel.passThresholdType === 'percent') {
    requiredCorrect = Math.ceil(totalQuestions * currentLevel.passThreshold / 100);
  } else {
    requiredCorrect = currentLevel.passThreshold;
  }

  console.log('Progress:', totalAnswered + '/' + totalQuestions, '| Correct:', currentLevel.correctCount, '| Required:', requiredCorrect);

  var result = {
    isCorrect: isCorrect,
    levelTransition: null,
    topicTransition: null,
    isFinished: false
  };

  // Early pass: already have enough correct
  if (currentLevel.correctCount >= requiredCorrect) {
    console.log('>>> LEVEL PASSED (early)');
    currentLevel.status = 'passed';
    result.levelTransition = handleLevelPassed(currentTopic, currentLevel);
  }
  // Early fail: impossible to reach threshold
  else if (currentLevel.correctCount + remaining < requiredCorrect) {
    console.log('>>> LEVEL FAILED (early) - correct:', currentLevel.correctCount, '+ remaining:', remaining, '< required:', requiredCorrect);
    currentLevel.status = 'failed';
    result.levelTransition = handleLevelFailed(currentTopic, currentLevel);
  }
  // Continue in same level
  else if (totalAnswered < totalQuestions) {
    console.log('>>> CONTINUE in same level');
    // Get next question
    var nextQ = getNextAdaptiveQuestion();
    if (nextQ) {
      state.adaptiveState.currentQuestionId = nextQ.id;
    }
  }
  // All questions answered - evaluate
  else {
    if (currentLevel.correctCount >= requiredCorrect) {
      console.log('>>> LEVEL PASSED (all answered)');
      currentLevel.status = 'passed';
      result.levelTransition = handleLevelPassed(currentTopic, currentLevel);
    } else {
      console.log('>>> LEVEL FAILED (all answered)');
      currentLevel.status = 'failed';
      result.levelTransition = handleLevelFailed(currentTopic, currentLevel);
    }
  }

  // Check if topic completed and move to next
  if (currentTopic.status === 'completed') {
    console.log('>>> TOPIC COMPLETED, finalLevelIndex:', currentTopic.finalLevelIndex);
    var nextTopicIndex = state.adaptiveState.currentTopicIndex + 1;
    if (nextTopicIndex < state.adaptiveState.topics.length) {
      result.topicTransition = {
        fromTopic: currentTopic.topicName,
        toTopic: state.adaptiveState.topics[nextTopicIndex].topicName
      };
      state.adaptiveState.currentTopicIndex = nextTopicIndex;
      state.adaptiveState.topics[nextTopicIndex].status = 'in_progress';
      
      // Start from median level of new topic
      var newTopic = state.adaptiveState.topics[nextTopicIndex];
      var startLevel = Math.floor(newTopic.levelsState.length / 2);
      newTopic.currentLevelIndex = startLevel;
      newTopic.levelsState[startLevel].status = 'in_progress';
      
      console.log('>>> Moving to topic:', newTopic.topicName, '| Start level:', startLevel);
      
      var nextQ = getNextAdaptiveQuestion();
      if (nextQ) {
        state.adaptiveState.currentQuestionId = nextQ.id;
      }
    } else {
      // All topics completed
      console.log('>>> ALL TOPICS COMPLETED');
      result.isFinished = true;
      state.adaptiveState.isFinished = true;
      state.adaptiveState.result = buildAdaptiveResult();
      // PRD-4 v1.1 §4.6/§4.7: in single-topic scope (sessions launched by
      // routerFlow or contentFlow per topic), «all topics completed» means
      // OUR one topic is done. Delegate to AdaptiveSession to fire the
      // onComplete callback and clear state.adaptiveState. The caller then
      // returns to the router page or advances to the next topic chunk.
      if (
        typeof AdaptiveSession !== 'undefined' &&
        AdaptiveSession.maybeFinishSingleTopic &&
        AdaptiveSession.maybeFinishSingleTopic()
      ) {
        // AdaptiveSession handled the completion; do not finalize the
        // multi-topic test result here. Suppress the legacy auto-submit
        // path so the caller's onComplete can navigate cleanly.
        result.singleTopicHandled = true;
      }
    }
  }

  console.log('Result:', result.levelTransition ? result.levelTransition.type : 'continue');
  console.log('=== END ===');

  return result;
}

/**
 * Handle level passed - move up or complete topic
 */
function handleLevelPassed(topic, level) {
  var levelIndex = topic.currentLevelIndex;

  console.log('handleLevelPassed: current level index:', levelIndex);
  console.log('All levels:', topic.levelsState.map(function(l, i) { return i + ':' + l.levelName + '(' + l.status + ')'; }).join(', '));

  // Record this as achieved level
  topic.finalLevelIndex = levelIndex;

  // Check ONLY the next level (no skipping allowed!)
  var nextLevelIndex = levelIndex + 1;
  
  if (nextLevelIndex < topic.levelsState.length) {
    var nextLevel = topic.levelsState[nextLevelIndex];
    console.log('Next level', nextLevelIndex, ':', nextLevel.levelName, '- status:', nextLevel.status);
    
    if (nextLevel.status === 'pending') {
      // Move to next level
      topic.currentLevelIndex = nextLevelIndex;
      topic.levelsState[nextLevelIndex].status = 'in_progress';
      
      var nextQ = getNextAdaptiveQuestion();
      if (nextQ) {
        state.adaptiveState.currentQuestionId = nextQ.id;
      }

      console.log('Moving UP to level:', topic.levelsState[nextLevelIndex].levelName);

      return {
        type: 'up',
        fromLevel: level.levelName,
        toLevel: topic.levelsState[nextLevelIndex].levelName,
        message: 'Отлично! Переход на уровень "' + topic.levelsState[nextLevelIndex].levelName + '"'
      };
    } else {
      // Next level is failed/passed - cannot skip, topic complete
      console.log('Next level is', nextLevel.status, '- cannot skip, TOPIC COMPLETE');
      topic.status = 'completed';
      return {
        type: 'complete',
        fromLevel: level.levelName,
        toLevel: null,
        message: 'Тема завершена. Достигнутый уровень: "' + level.levelName + '"'
      };
    }
  } else {
    // Highest level passed - topic complete
    topic.status = 'completed';
    console.log('Highest level passed - TOPIC COMPLETE');
    return {
      type: 'complete',
      fromLevel: level.levelName,
      toLevel: null,
      message: 'Поздравляем! Вы достигли максимального уровня "' + level.levelName + '"'
    };
  }
}

/**
 * Handle level failed - move down or complete topic
 */
function handleLevelFailed(topic, level) {
  var levelIndex = topic.currentLevelIndex;

  console.log('handleLevelFailed: current level index:', levelIndex);
  console.log('finalLevelIndex (achieved):', topic.finalLevelIndex);
  console.log('All levels:', topic.levelsState.map(function(l, i) { return i + ':' + l.levelName + '(' + l.status + ')'; }).join(', '));

  // If we already achieved a level, topic is complete with the achieved level
  if (topic.finalLevelIndex !== null) {
    console.log('Already achieved level', topic.finalLevelIndex, '- TOPIC COMPLETE');
    topic.status = 'completed';
    return {
      type: 'complete',
      fromLevel: level.levelName,
      toLevel: null,
      message: 'Тема завершена. Достигнутый уровень: "' + topic.levelsState[topic.finalLevelIndex].levelName + '"'
    };
  }

  // Check ONLY the previous level (no skipping allowed!)
  var prevLevelIndex = levelIndex - 1;

  if (prevLevelIndex >= 0) {
    var prevLevel = topic.levelsState[prevLevelIndex];
    console.log('Prev level', prevLevelIndex, ':', prevLevel.levelName, '- status:', prevLevel.status);
    
    if (prevLevel.status === 'pending') {
      // Move to previous level
      topic.currentLevelIndex = prevLevelIndex;
      topic.levelsState[prevLevelIndex].status = 'in_progress';
      
      var nextQ = getNextAdaptiveQuestion();
      if (nextQ) {
        state.adaptiveState.currentQuestionId = nextQ.id;
      }

      console.log('Moving DOWN to level:', topic.levelsState[prevLevelIndex].levelName);

      return {
        type: 'down',
        fromLevel: level.levelName,
        toLevel: topic.levelsState[prevLevelIndex].levelName,
        message: 'Переход на уровень "' + topic.levelsState[prevLevelIndex].levelName + '"'
      };
    } else {
      // Previous level is failed/passed - cannot skip, topic complete
      console.log('Prev level is', prevLevel.status, '- cannot skip, TOPIC COMPLETE');
      topic.status = 'completed';
      return {
        type: 'complete',
        fromLevel: level.levelName,
        toLevel: null,
        message: 'Тема завершена'
      };
    }
  } else {
    // Lowest level failed - topic complete with no level achieved
    topic.status = 'completed';
    console.log('Lowest level failed - TOPIC COMPLETE, no level achieved');
    return {
      type: 'complete',
      fromLevel: level.levelName,
      toLevel: null,
      message: 'Тема завершена'
    };
  }
}

/**
 * Build adaptive test result
 */
// PRD-18 «ВСЕ РАСЧЕТЫ ПО ЕДИНОМУ АЛГОРИТМУ»: thin host adapter over the shared
// aggregateAdaptiveResult (window.TBTemplate, the SAME engine the web grader uses).
// This side only normalizes in-package data (TEST_DATA.adaptiveTopics + live
// levelsState) into the engine input. TEST_DATA levels are sorted by levelIndex
// (test-json.ts), positionally aligned with levelsState, so the engine's POSITIONAL
// finalLevelIndex lookup is correct (and guarded — no more unguarded throw).
function buildAdaptiveResult() {
  var topics = state.adaptiveState.topics.map(function(topic) {
    var topicData = TEST_DATA.adaptiveTopics.find(function(t) {
      return t.topicId === topic.topicId;
    });
    var metaLevels = (topicData && topicData.levels) || [];

    return {
      topicId: topic.topicId,
      topicName: topic.topicName,
      finalLevelIndex: topic.finalLevelIndex,
      levelsState: topic.levelsState.map(function(ls) {
        return {
          levelIndex: ls.levelIndex,
          levelName: ls.levelName,
          status: ls.status,
          answeredCount: ls.answeredQuestionIds.length,
          correctCount: ls.correctCount
        };
      }),
      levels: metaLevels.map(function(ld) {
        return {
          levelName: ld.levelName,
          feedback: ld.feedback != null ? ld.feedback : null,
          links: ld.links || []
        };
      }),
      failureFeedback: topicData ? topicData.failureFeedback : null,
      // Preserve SCORM's failure branch: recommend the lowest level's links.
      failureLinks: (metaLevels[0] && metaLevels[0].links) || []
    };
  });

  return window.TBTemplate.aggregateAdaptiveResult({ topics: topics });
}

/**
 * Get adaptive result for SCORM reporting
 */
function getAdaptiveResultForScorm() {
  if (!state.adaptiveState || !state.adaptiveState.result) {
    return null;
  }

  var result = state.adaptiveState.result;
  
  // Calculate overall stats
  var totalQuestions = 0;
  var totalCorrect = 0;

  result.topicResults.forEach(function(tr) {
    totalQuestions += tr.totalQuestionsAnswered;
    totalCorrect += tr.totalCorrect;
  });

  var percent = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0;

  return {
    correct: totalCorrect,
    totalQuestions: totalQuestions,
    earnedPoints: totalCorrect, // Each question = 1 point in adaptive
    possiblePoints: totalQuestions,
    percent: percent,
    passed: result.overallPassed,
    topicResults: result.topicResults.map(function(tr) {
      return {
        topicId: tr.topicId,
        topicName: tr.topicName,
        correct: tr.totalCorrect,
        total: tr.totalQuestionsAnswered,
        percent: tr.levelPercent,
        earnedPoints: tr.totalCorrect,
        possiblePoints: tr.totalQuestionsAnswered,
        passed: tr.achievedLevelIndex !== null,
        achievedLevelName: tr.achievedLevelName,
        recommendedCourses: tr.recommendedLinks
      };
    })
  };
}