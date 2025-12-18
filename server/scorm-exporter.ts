import archiver from "archiver";
import { Writable } from "stream";
import type { Test, TestSection, Topic, Question, TopicCourse, PassRule } from "@shared/schema";

interface ExportData {
  test: Test;
  sections: (TestSection & { topic: Topic; questions: Question[]; courses: TopicCourse[] })[];
}

export function generateScormPackage(data: ExportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });

    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    archive.pipe(writable);

    const testJson = buildTestJson(data);
    const manifest = buildManifest(data.test, data);
    const indexHtml = buildIndexHtml(data.test.title);
    const runtimeJs = buildRuntimeJs();
    const appJs = buildAppJs(testJson);
    const metadataXml = buildMetadataXml(data.test);

    archive.append(manifest, { name: "imsmanifest.xml" });
    archive.append(metadataXml, { name: "metadata.xml" });
    archive.append(indexHtml, { name: "index.html" });
    archive.append(runtimeJs, { name: "runtime.js" });
    archive.append(appJs, { name: "app.js" });

    archive.finalize();
  });
}

function buildTestJson(data: ExportData): string {
  const totalQuestions = data.sections.reduce((sum, s) => sum + s.drawCount, 0);
  const overallPassRule = data.test.overallPassRuleJson as PassRule;
  const passPercent = overallPassRule.type === "percent" 
    ? overallPassRule.value 
    : totalQuestions > 0 ? Math.round((overallPassRule.value / totalQuestions) * 100) : 80;

  const test = {
    id: data.test.id,
    title: data.test.title,
    description: data.test.description,
    overallPassRule: overallPassRule,
    webhookUrl: data.test.webhookUrl,
    testFeedback: data.test.feedback || null,
    timeLimitMinutes: data.test.timeLimitMinutes || null,
    maxAttempts: data.test.maxAttempts || null,
    showCorrectAnswers: data.test.showCorrectAnswers || false,
    startPageContent: data.test.startPageContent || null,
    passPercent: passPercent,
    totalQuestions: totalQuestions,
    sections: data.sections.map((s) => ({
      topicId: s.topic.id,
      topicName: s.topic.name,
      drawCount: s.drawCount,
      topicPassRule: s.topicPassRuleJson as PassRule | null,
      topicFeedback: s.topic.feedback || null,
      recommendedCourses: s.courses.map((c) => ({ title: c.title, url: c.url })),
      questions: s.questions.map((q) => ({
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        data: q.dataJson,
        correct: q.correctJson,
        points: q.points || 1,
        mediaUrl: q.mediaUrl || null,
        mediaType: q.mediaType || null,
        feedback: q.feedback || null,
        feedbackMode: q.feedbackMode || "general",
        feedbackCorrect: q.feedbackCorrect || null,
        feedbackIncorrect: q.feedbackIncorrect || null,
      })),
    })),
  };

  return JSON.stringify(test, null, 2);
}

function buildManifest(test: Test, data: ExportData): string {
  const id = `test_${test.id}`;
  const overallPassRule = test.overallPassRuleJson as PassRule;
  const totalQuestions = data.sections.reduce((sum, s) => sum + s.drawCount, 0);
  const overallThreshold = overallPassRule.type === "percent" 
    ? (overallPassRule.value / 100).toFixed(2) 
    : totalQuestions > 0 ? (overallPassRule.value / totalQuestions).toFixed(2) : "0.8";
  
  const objectives = data.sections.map((s) => {
    const topicPassRule = s.topicPassRuleJson as PassRule | null;
    let threshold = "0.5";
    if (topicPassRule) {
      threshold = topicPassRule.type === "percent" 
        ? (topicPassRule.value / 100).toFixed(2) 
        : (topicPassRule.value / s.drawCount).toFixed(2);
    }
    return `
        <imsss:objective objectiveID="obj_topic_${s.topic.id}">
          <imsss:minNormalizedMeasure>${threshold}</imsss:minNormalizedMeasure>
        </imsss:objective>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd
    http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd
    http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd
    http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd
    http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">

  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
    <adlcp:location>metadata.xml</adlcp:location>
  </metadata>

  <organizations default="org_${id}">
    <organization identifier="org_${id}" structure="hierarchical">
      <title>${escapeXml(test.title)}</title>
      <item identifier="item_${id}" identifierref="res_${id}">
        <title>${escapeXml(test.title)}</title>
        <imsss:sequencing>
          <imsss:controlMode choice="true" flow="true" />
          <imsss:deliveryControls completionSetByContent="true" objectiveSetByContent="true" />
          <imsss:objectives>
            <imsss:primaryObjective objectiveID="primary_obj" satisfiedByMeasure="true">
              <imsss:minNormalizedMeasure>${overallThreshold}</imsss:minNormalizedMeasure>
            </imsss:primaryObjective>${objectives}
          </imsss:objectives>
        </imsss:sequencing>
        <adlnav:presentation>
          <adlnav:navigationInterface>
            <adlnav:hideLMSUI>continue</adlnav:hideLMSUI>
            <adlnav:hideLMSUI>previous</adlnav:hideLMSUI>
            <adlnav:hideLMSUI>abandon</adlnav:hideLMSUI>
            <adlnav:hideLMSUI>exit</adlnav:hideLMSUI>
          </adlnav:navigationInterface>
        </adlnav:presentation>
      </item>
    </organization>
  </organizations>

  <resources>
    <resource identifier="res_${id}" type="webcontent" adlcp:scormType="sco" href="index.html">
      <file href="index.html"/>
      <file href="runtime.js"/>
      <file href="app.js"/>
    </resource>
  </resources>
</manifest>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildMetadataXml(test: Test): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<lom xmlns="http://ltsc.ieee.org/xsd/LOM"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://ltsc.ieee.org/xsd/LOM lomStrict.xsd">
  <general>
    <identifier>
      <catalog>test</catalog>
      <entry>${test.id}</entry>
    </identifier>
    <title>
      <string language="en">${escapeXml(test.title)}</string>
    </title>
    <description>
      <string language="en">${escapeXml(test.description || "Assessment test")}</string>
    </description>
    <language>en</language>
  </general>
  <lifeCycle>
    <version>
      <string language="en">1.0</string>
    </version>
    <status>
      <source>LOMv1.0</source>
      <value>final</value>
    </status>
  </lifeCycle>
  <technical>
    <format>text/html</format>
  </technical>
  <educational>
    <interactivityType>
      <source>LOMv1.0</source>
      <value>active</value>
    </interactivityType>
    <learningResourceType>
      <source>LOMv1.0</source>
      <value>exercise</value>
    </learningResourceType>
  </educational>
</lom>`;
}

function buildIndexHtml(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeXml(title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 24px; margin-bottom: 20px; color: #1a1a1a; }
    .card {
      background: white;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .question-text { font-size: 18px; margin-bottom: 16px; color: #333; }
    .option {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .option:hover { border-color: #2563eb; background: #f0f7ff; }
    .option.correct-answer { border-color: #16a34a; background: #dcfce7; }
    .option.incorrect-answer { border-color: #dc2626; background: #fee2e2; }
    .matching-row.correct-answer { background: #dcfce7; border-radius: 4px; padding: 4px 8px; }
    .matching-row.incorrect-answer { background: #fee2e2; border-radius: 4px; padding: 4px 8px; }
    .ranking-item.correct-answer { background: #dcfce7; border-radius: 4px; }
    .ranking-item.incorrect-answer { background: #fee2e2; border-radius: 4px; }
    .option.selected { border-color: #2563eb; background: #eff6ff; }
    .option input { margin-right: 12px; }
    .progress-bar {
      height: 8px;
      background: #e0e0e0;
      border-radius: 4px;
      margin-bottom: 20px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: #2563eb;
      transition: width 0.3s;
    }
    .btn {
      display: inline-block;
      padding: 12px 24px;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn:hover { background: #1d4ed8; }
    .btn:disabled { background: #94a3b8; cursor: not-allowed; }
    .btn-outline { background: white; color: #2563eb; border: 2px solid #2563eb; }
    .btn-outline:hover { background: #eff6ff; }
    .navigation { display: flex; justify-content: space-between; margin-top: 20px; }
    .result-hero { text-align: center; padding: 40px 20px; }
    .result-score { font-size: 64px; font-weight: bold; }
    .result-passed { color: #16a34a; }
    .result-failed { color: #dc2626; }
    .result-status { font-size: 24px; margin-top: 10px; }
    .topic-result {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      border-bottom: 1px solid #e0e0e0;
    }
    .topic-result:last-child { border-bottom: none; }
    .course-link {
      display: block;
      padding: 12px 16px;
      background: #f0f7ff;
      border-radius: 8px;
      margin-top: 8px;
      color: #2563eb;
      text-decoration: none;
    }
    .course-link:hover { background: #dbeafe; }
    .matching-row { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; }
    .matching-item { flex: 1; padding: 12px; background: #f5f5f5; border-radius: 8px; }
    select {
      padding: 10px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      min-width: 120px;
    }
    .ranking-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: white;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      margin-bottom: 8px;
    }
    .ranking-controls button {
      background: #e0e0e0;
      border: none;
      width: 28px;
      height: 28px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    .ranking-controls button:hover { background: #d0d0d0; }
    .ranking-controls button:disabled { opacity: 0.3; cursor: not-allowed; }
    #loading { text-align: center; padding: 60px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div id="app">
      <div id="loading">Загрузка теста...</div>
    </div>
  </div>
  <script src="runtime.js"></script>
  <script src="app.js"></script>
</body>
</html>`;
}

function buildRuntimeJs(): string {
  return `
// SCORM 2004 API Wrapper
var SCORM = (function() {
  var API = null;
  var initialized = false;

  function findAPI(win) {
    var attempts = 0;
    while (win && attempts < 500) {
      if (win.API_1484_11) return win.API_1484_11;
      if (win.parent === win) break;
      win = win.parent;
      attempts++;
    }
    return null;
  }

  function getAPI() {
    if (API) return API;
    API = findAPI(window);
    if (!API && window.opener) {
      API = findAPI(window.opener);
    }
    return API;
  }

  function log(msg) {
    if (console && console.log) console.log('[SCORM] ' + msg);
  }

  return {
    init: function() {
      var api = getAPI();
      if (!api) {
        log('API not found - running in standalone mode');
        return true;
      }
      var result = api.Initialize("");
      initialized = (result === "true" || result === true);
      log('Initialize: ' + result);
      return initialized;
    },

    getValue: function(key) {
      var api = getAPI();
      if (!api) return "";
      return api.GetValue(key);
    },

    setValue: function(key, value) {
      var api = getAPI();
      if (!api) {
        log('setValue (standalone): ' + key + ' = ' + value);
        return true;
      }
      var result = api.SetValue(key, String(value));
      log('SetValue ' + key + ' = ' + value + ' -> ' + result);
      return result === "true" || result === true;
    },

    commit: function() {
      var api = getAPI();
      if (!api) return true;
      var result = api.Commit("");
      log('Commit: ' + result);
      return result === "true" || result === true;
    },

    terminate: function() {
      var api = getAPI();
      if (!api) return true;
      var result = api.Terminate("");
      log('Terminate: ' + result);
      initialized = false;
      return result === "true" || result === true;
    },

    setScore: function(raw, min, max, scaled) {
      this.setValue('cmi.score.raw', raw);
      this.setValue('cmi.score.min', min);
      this.setValue('cmi.score.max', max);
      this.setValue('cmi.score.scaled', scaled);
    },

    setCompletion: function(status) {
      this.setValue('cmi.completion_status', status);
    },

    setSuccess: function(status) {
      this.setValue('cmi.success_status', status);
    },

    setObjective: function(index, id, scoreRaw, successStatus) {
      this.setValue('cmi.objectives.' + index + '.id', id);
      this.setValue('cmi.objectives.' + index + '.score.raw', scoreRaw);
      this.setValue('cmi.objectives.' + index + '.success_status', successStatus);
    },

    setInteraction: function(index, id, type, result, learnerResponse) {
      this.setValue('cmi.interactions.' + index + '.id', id);
      this.setValue('cmi.interactions.' + index + '.type', type);
      this.setValue('cmi.interactions.' + index + '.result', result);
      this.setValue('cmi.interactions.' + index + '.learner_response', learnerResponse);
    },

    finish: function(earnedPoints, possiblePoints, passed, objectives, interactions) {
      // Report earned points as raw score, possible points as max, scaled as ratio
      var scaled = possiblePoints > 0 ? earnedPoints / possiblePoints : 0;
      this.setScore(earnedPoints, 0, possiblePoints, scaled);
      this.setCompletion('completed');
      this.setSuccess(passed ? 'passed' : 'failed');
      this.setValue('cmi.progress_measure', '1');
      this.setValue('cmi.exit', 'normal');

      for (var i = 0; i < objectives.length; i++) {
        var obj = objectives[i];
        this.setObjective(i, obj.id, obj.score, obj.status);
      }

      for (var j = 0; j < interactions.length; j++) {
        var int = interactions[j];
        this.setInteraction(j, int.id, int.type, int.result, int.response);
      }

      this.commit();
      this.terminate();
    }
  };
})();
`;
}

function buildAppJs(testJson: string): string {
  return `
// Embedded test data
var TEST_DATA = ${testJson};

// App state
var state = {
  phase: 'start',
  currentIndex: 0,
  answers: {},
  variant: null,
  flatQuestions: [],
  timerInterval: null,
  remainingSeconds: null,
  timeExpired: false,
  submitted: false,
  answerConfirmed: false,
  feedbackShown: false
};

// Initialize
window.onload = function() {
  SCORM.init();
  generateVariant();
  render();
};

function initTimer() {
  if (TEST_DATA.timeLimitMinutes && TEST_DATA.timeLimitMinutes > 0) {
    state.remainingSeconds = TEST_DATA.timeLimitMinutes * 60;
    state.timerInterval = setInterval(updateTimer, 1000);
  }
}

function updateTimer() {
  if (state.submitted) {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
    return;
  }
  
  if (state.remainingSeconds === null || state.remainingSeconds <= 0) {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
    return;
  }
  
  state.remainingSeconds--;
  updateTimerDisplay();
  
  if (state.remainingSeconds <= 0 && !state.submitted) {
    state.timeExpired = true;
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
    submit();
  }
}

function updateTimerDisplay() {
  var timerEl = document.getElementById('timer-display');
  if (timerEl && state.remainingSeconds !== null) {
    var mins = Math.floor(state.remainingSeconds / 60);
    var secs = state.remainingSeconds % 60;
    timerEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
    if (state.remainingSeconds <= 60) {
      timerEl.style.color = '#dc2626';
      timerEl.style.fontWeight = 'bold';
    }
  }
}

function formatTime(seconds) {
  var mins = Math.floor(seconds / 60);
  var secs = seconds % 60;
  return mins + ':' + (secs < 10 ? '0' : '') + secs;
}

function generateVariant() {
  state.variant = { sections: [] };
  state.flatQuestions = [];

  TEST_DATA.sections.forEach(function(section) {
    var questions = shuffle(section.questions.slice()).slice(0, section.drawCount);
    state.variant.sections.push({
      topicId: section.topicId,
      topicName: section.topicName,
      questionIds: questions.map(function(q) { return q.id; })
    });
    questions.forEach(function(q) {
      state.flatQuestions.push({
        question: q,
        topicId: section.topicId,
        topicName: section.topicName
      });
    });
  });
}

function shuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr;
}

function render() {
  if (state.phase === 'start') {
    renderStartPage();
    return;
  }
  
  var app = document.getElementById('app');
  var total = state.flatQuestions.length;
  var current = state.currentIndex;

  if (current >= total) {
    renderResults();
    return;
  }

  var qData = state.flatQuestions[current];
  var q = qData.question;
  var progress = ((current + 1) / total) * 100;

  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
  html += '<h1 style="margin:0">' + escapeHtml(TEST_DATA.title) + '</h1>';
  if (state.remainingSeconds !== null) {
    var timerClass = state.remainingSeconds <= 60 ? 'style="color:#dc2626;font-weight:bold;font-size:18px;"' : 'style="color:#666;font-size:18px;"';
    html += '<div id="timer-display" ' + timerClass + '>' + formatTime(state.remainingSeconds) + '</div>';
  }
  html += '</div>';
  html += '<div class="progress-bar"><div class="progress-fill" style="width:' + progress + '%"></div></div>';
  html += '<div class="card">';
  html += '<div style="color:#666;margin-bottom:8px;">Вопрос ' + (current + 1) + ' из ' + total + ' | ' + escapeHtml(qData.topicName) + '</div>';
  html += '<div class="question-text">' + escapeHtml(q.prompt) + '</div>';
  html += renderQuestionMedia(q);
  html += renderQuestionInput(q);
  
  if (TEST_DATA.showCorrectAnswers && state.feedbackShown) {
    var answer = state.answers[q.id];
    var scoreRatio = checkAnswer(q, answer);
    var isCorrect = scoreRatio === 1;
    var statusColor = isCorrect ? '#16a34a' : '#dc2626';
    var statusText = isCorrect ? 'Правильно!' : (scoreRatio > 0 ? 'Частично правильно' : 'Неправильно');
    
    html += '<div style="margin-top:16px;padding:12px;border-radius:8px;background:' + (isCorrect ? '#dcfce7' : '#fee2e2') + ';border:1px solid ' + statusColor + ';">';
    html += '<div style="font-weight:600;color:' + statusColor + ';margin-bottom:4px;">' + statusText + '</div>';
    
    var feedbackText = null;
    if (q.feedbackMode === 'conditional') {
      feedbackText = isCorrect ? q.feedbackCorrect : q.feedbackIncorrect;
    } else {
      feedbackText = q.feedback;
    }
    
    if (feedbackText) {
      html += '<div style="color:#333;font-size:14px;">' + escapeHtml(feedbackText) + '</div>';
    }
    html += '</div>';
  }
  
  html += '</div>';
  html += '<div class="navigation" style="justify-content:flex-end">';
  
  if (TEST_DATA.showCorrectAnswers && !state.feedbackShown) {
    html += '<button class="btn" onclick="confirmAnswer()">Принять</button>';
  } else if (current < total - 1) {
    html += '<button class="btn" onclick="next()">Далее</button>';
  } else {
    html += '<button class="btn" onclick="submit()">Завершить тест</button>';
  }
  html += '</div>';

  app.innerHTML = html;
}

function renderStartPage() {
  var app = document.getElementById('app');
  
  var iconQuestions = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>';
  var iconPass = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  var iconTime = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  var iconAttempts = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>';
  
  var html = '<div style="max-width:600px;margin:40px auto;">';
  html += '<div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:16px 16px 0 0;padding:32px;text-align:center;">';
  html += '<h1 style="color:white;margin:0;font-size:28px;font-weight:600;">' + escapeHtml(TEST_DATA.title) + '</h1>';
  if (TEST_DATA.description) {
    html += '<p style="color:rgba(255,255,255,0.9);margin-top:12px;margin-bottom:0;">' + escapeHtml(TEST_DATA.description) + '</p>';
  }
  html += '</div>';
  
  html += '<div style="background:white;border-radius:0 0 16px 16px;padding:24px;box-shadow:0 4px 12px rgba(0,0,0,0.1);">';
  html += '<h2 style="margin:0 0 20px 0;font-size:18px;color:#374151;">Информация о тесте</h2>';
  
  html += '<div style="display:grid;gap:12px;">';
  
  html += '<div style="display:flex;align-items:center;gap:12px;padding:16px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);border-radius:12px;">';
  html += '<div style="flex-shrink:0;">' + iconQuestions + '</div>';
  html += '<div><div style="font-weight:600;color:#374151;">Количество вопросов</div><div style="color:#6b7280;font-size:14px;">' + TEST_DATA.totalQuestions + '</div></div>';
  html += '</div>';
  
  html += '<div style="display:flex;align-items:center;gap:12px;padding:16px;background:linear-gradient(135deg,#ecfdf5,#d1fae5);border-radius:12px;">';
  html += '<div style="flex-shrink:0;">' + iconPass + '</div>';
  html += '<div><div style="font-weight:600;color:#374151;">Проходной балл</div><div style="color:#6b7280;font-size:14px;">' + TEST_DATA.passPercent + '%</div></div>';
  html += '</div>';
  
  if (TEST_DATA.timeLimitMinutes) {
    html += '<div style="display:flex;align-items:center;gap:12px;padding:16px;background:linear-gradient(135deg,#fffbeb,#fef3c7);border-radius:12px;">';
    html += '<div style="flex-shrink:0;">' + iconTime + '</div>';
    html += '<div><div style="font-weight:600;color:#374151;">Ограничение времени</div><div style="color:#6b7280;font-size:14px;">' + TEST_DATA.timeLimitMinutes + ' минут</div></div>';
    html += '</div>';
  }
  
  if (TEST_DATA.maxAttempts) {
    html += '<div style="display:flex;align-items:center;gap:12px;padding:16px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);border-radius:12px;">';
    html += '<div style="flex-shrink:0;">' + iconAttempts + '</div>';
    html += '<div><div style="font-weight:600;color:#374151;">Количество попыток</div><div style="color:#6b7280;font-size:14px;">' + TEST_DATA.maxAttempts + '</div></div>';
    html += '</div>';
  }
  
  html += '</div>';
  
  if (TEST_DATA.startPageContent) {
    html += '<div style="margin-top:20px;padding:16px;background:linear-gradient(135deg,#eff6ff,#dbeafe);border-radius:12px;border-left:4px solid #3b82f6;">';
    html += '<div style="color:#1e40af;font-size:14px;line-height:1.6;">' + escapeHtml(TEST_DATA.startPageContent) + '</div>';
    html += '</div>';
  }
  
  html += '<div style="margin-top:24px;text-align:center;">';
  html += '<button class="btn" onclick="startTest()" style="padding:14px 40px;font-size:16px;font-weight:600;border-radius:12px;">Начать тестирование</button>';
  html += '</div>';
  
  html += '</div></div>';
  
  app.innerHTML = html;
}

function startTest() {
  state.phase = 'question';
  initTimer();
  render();
}

function confirmAnswer() {
  state.feedbackShown = true;
  render();
}

function renderQuestionMedia(q) {
  if (!q.mediaUrl || !q.mediaType) return '';
  
  if (q.mediaType === 'image') {
    return '<div class="question-media"><img src="' + escapeHtml(q.mediaUrl) + '" alt="Question media" style="max-height:250px;max-width:100%;margin:16px auto;display:block;border-radius:8px;"></div>';
  }
  if (q.mediaType === 'audio') {
    return '<div class="question-media"><audio controls style="width:100%;margin:16px 0;"><source src="' + escapeHtml(q.mediaUrl) + '">Your browser does not support audio.</audio></div>';
  }
  if (q.mediaType === 'video') {
    return '<div class="question-media"><video controls style="max-height:250px;max-width:100%;margin:16px auto;display:block;border-radius:8px;"><source src="' + escapeHtml(q.mediaUrl) + '">Your browser does not support video.</video></div>';
  }
  return '';
}

function renderQuestionInput(q) {
  var answer = state.answers[q.id];
  var locked = TEST_DATA.showCorrectAnswers && state.feedbackShown;
  var correct = q.correct || {};

  // SINGLE
  if (q.type === 'single') {
    var correctIndex = (typeof correct.correctIndex === 'number') ? correct.correctIndex : -1;
    var html = '';
    q.data.options.forEach(function(opt, i) {
      var selected = answer === i ? 'selected' : '';
      var correctClass = '';
      if (locked) {
        if (i === correctIndex) correctClass = ' correct-answer';
        else if (answer === i && i !== correctIndex) correctClass = ' incorrect-answer';
      }
      var clickHandler = locked ? '' : 'onclick="selectSingle(\\'' + q.id + '\\',' + i + ')"';
      html += '<div class="option ' + selected + correctClass + '" ' + clickHandler + ' style="' + (locked ? 'cursor:default;' : '') + '">';
      html += '<input type="radio" name="q_' + q.id + '" ' + (answer === i ? 'checked' : '') + ' ' + (locked ? 'disabled' : '') + '>';
      html += escapeHtml(opt) + '</div>';
    });
    return html;
  }

  // MULTIPLE
  if (q.type === 'multiple') {
    var selected = Array.isArray(answer) ? answer : [];
    var correctSet = Array.isArray(correct.correctIndices) ? correct.correctIndices : [];
    var html = '';
    q.data.options.forEach(function(opt, i) {
      var isSelected = selected.indexOf(i) !== -1;
      var isCorrect = correctSet.indexOf(i) !== -1;
      var correctClass = '';
      if (locked) {
        if (isCorrect) correctClass = ' correct-answer';
        else if (isSelected && !isCorrect) correctClass = ' incorrect-answer';
      }
      var clickHandler = locked ? '' : 'onclick="toggleMultiple(\\'' + q.id + '\\',' + i + ')"';
      html += '<div class="option ' + (isSelected ? 'selected' : '') + correctClass + '" ' + clickHandler + ' style="' + (locked ? 'cursor:default;' : '') + '">';
      html += '<input type="checkbox" ' + (isSelected ? 'checked' : '') + ' ' + (locked ? 'disabled' : '') + '>';
      html += escapeHtml(opt) + '</div>';
    });
    return html;
  }

  // MATCHING (у тебя correct.pairs = [{left,right}], делаем map left->right)
  if (q.type === 'matching') {
  var pairs = (answer && typeof answer === 'object') ? answer : {};

  // correct.pairs = [{left, right}]
  var correctPairsArr = Array.isArray(correct.pairs) ? correct.pairs : [];
  var correctMap = {};
  correctPairsArr.forEach(function(p) { correctMap[p.left] = p.right; });

  var html = '<div style="margin-top:8px">';
  q.data.left.forEach(function(left, i) {
    var isCorrect = locked && Number(pairs[i]) === correctMap[i];
    var isIncorrect = locked && pairs[i] !== undefined && Number(pairs[i]) !== correctMap[i];
    var rowClass = isCorrect ? 'correct-answer' : (isIncorrect ? 'incorrect-answer' : '');
    html += '<div class="matching-row ' + rowClass + '">';
    html += '<div class="matching-item">' + (i + 1) + '. ' + escapeHtml(left) + '</div>';
    html += '<span style="margin:0 8px;">→</span>';
    html += '<select onchange="setMatch(\\'' + q.id + '\\',' + i + ',this.value)"' + (locked ? ' disabled' : '') + '>';
    html += '<option value="">Выберите...</option>';
    q.data.right.forEach(function(right, j) {
      var sel = Number(pairs[i]) === j ? 'selected' : '';
      html += '<option value="' + j + '" ' + sel + '>' + String.fromCharCode(65 + j) + '. ' + escapeHtml(right) + '</option>';
    });
    html += '</select>';

    if (locked && isIncorrect) {
      html += '<span style="color:#16a34a;margin-left:8px;font-size:12px;">(Правильно: ' + String.fromCharCode(65 + correctMap[i]) + ')</span>';
    }

    html += '</div>';
  });
  html += '</div>';
  return html;
}
  // RANKING
  if (q.type === 'ranking') {
    var defaultOrder = q.data.items.map(function(_, i) { return i; });
    var order = Array.isArray(answer) ? answer : defaultOrder;
    var correctOrder = Array.isArray(correct.correctOrder) ? correct.correctOrder : defaultOrder;

    var html = '<div>';
    order.forEach(function(itemIdx, pos) {
      var isCorrectPos = locked && itemIdx === correctOrder[pos];
      var rowClass = locked ? (isCorrectPos ? 'correct-answer' : 'incorrect-answer') : '';
      html += '<div class="ranking-item ' + rowClass + '">';
      html += '<div class="ranking-controls">';
      html += '<button onclick="moveRank(\\'' + q.id + '\\',' + pos + ',-1)"' + (pos === 0 || locked ? ' disabled' : '') + '>▲</button>';
      html += '<button onclick="moveRank(\\'' + q.id + '\\',' + pos + ',1)"' + (pos === order.length - 1 || locked ? ' disabled' : '') + '>▼</button>';
      html += '</div>';
      html += '<span>' + (pos + 1) + '.</span>';
      html += '<span>' + escapeHtml(q.data.items[itemIdx]) + '</span>';
      if (locked && !isCorrectPos) {
        html += '<span style="color:#16a34a;margin-left:8px;font-size:12px;">(Должен быть: ' + (correctOrder.indexOf(itemIdx) + 1) + ')</span>';
      }
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  return '<div>Неизвестный тип вопроса</div>';
}


function selectSingle(qId, idx) {
  if (TEST_DATA.showCorrectAnswers && state.feedbackShown) return;
  state.answers[qId] = idx;
  render();
}

function toggleMultiple(qId, idx) {
  if (TEST_DATA.showCorrectAnswers && state.feedbackShown) return;
  var current = state.answers[qId] || [];
  var pos = current.indexOf(idx);
  if (pos === -1) {
    current.push(idx);
  } else {
    current.splice(pos, 1);
  }
  state.answers[qId] = current;
  render();
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
  render();
}


function moveRank(qId, pos, dir) {
  if (TEST_DATA.showCorrectAnswers && state.feedbackShown) return;
  var q = state.flatQuestions.find(function(fq) { return fq.question.id === qId; }).question;
  var order = state.answers[qId] || q.data.items.map(function(_, i) { return i; });
  var newPos = pos + dir;
  if (newPos < 0 || newPos >= order.length) return;
  var temp = order[pos];
  order[pos] = order[newPos];
  order[newPos] = temp;
  state.answers[qId] = order;
  render();
}


function next() {
  if (state.currentIndex < state.flatQuestions.length - 1) {
    state.currentIndex++;
    state.feedbackShown = false;
    render();
  }
}

function submit() {
  if (state.submitted) return;
  state.submitted = true;
  
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  
  state.currentIndex = state.flatQuestions.length;
  render();
}

function renderResults() {
  var results = calculateResults();
  var app = document.getElementById('app');

  var html = '<div class="result-hero">';
  html += '<div class="result-score ' + (results.passed ? 'result-passed' : 'result-failed') + '">' + Math.round(results.percent) + '%</div>';
  html += '<div class="result-status">' + (results.passed ? 'ПРОЙДЕН' : 'НЕ ПРОЙДЕН') + '</div>';
  html += '<div style="margin-top:10px;color:#666">Полностью верных: ' + results.correct + ' из ' + results.totalQuestions + '</div>';
  html += '<div style="color:#666">Баллы: ' + results.earnedPoints.toFixed(1) + ' / ' + results.possiblePoints + '</div>';
  html += '</div>';

  if (TEST_DATA.testFeedback) {
    html += '<div class="card"><div style="color:#333">' + escapeHtml(TEST_DATA.testFeedback) + '</div></div>';
  }

  var failedTopics = results.topicResults.filter(function(tr) { return !tr.passed; });
  
  if (failedTopics.length > 0) {
    html += '<div class="card"><h2 style="margin-bottom:16px">Темы, требующие доработки</h2>';
    failedTopics.forEach(function(tr) {
      html += '<div class="topic-result">';
      html += '<div><strong>' + escapeHtml(tr.topicName) + '</strong></div>';
      html += '<div>' + tr.earnedPoints.toFixed(1) + '/' + tr.possiblePoints + ' (' + Math.round(tr.percent) + '%)</div>';
      html += '</div>';
      if (tr.topicFeedback) {
        html += '<div style="padding:0 16px 8px;color:#666;font-size:14px;">' + escapeHtml(tr.topicFeedback) + '</div>';
      }
      if (tr.recommendedCourses && tr.recommendedCourses.length > 0) {
        html += '<div style="padding:0 16px 16px">';
        html += '<div style="color:#666;font-size:14px;margin-bottom:8px">Рекомендуемые курсы:</div>';
        tr.recommendedCourses.forEach(function(c) {
          html += '<a class="course-link" href="' + escapeHtml(c.url) + '" target="_blank">' + escapeHtml(c.title) + '</a>';
        });
        html += '</div>';
      }
    });
    html += '</div>';
  }

  app.innerHTML = html;

  finishScorm(results);
}

function calculateResults() {
  var totalEarnedPoints = 0;  // Sum of earned points (weighted by question points)
  var totalPossiblePoints = 0; // Total possible points
  var totalFullyCorrect = 0; // Fully correct count
  var totalQuestions = 0;
  var topicData = {};

  state.flatQuestions.forEach(function(fq) {
    var q = fq.question;
    var answer = state.answers[q.id];
    var scoreRatio = checkAnswer(q, answer);
    var qPoints = q.points || 1;

    totalPossiblePoints += qPoints;
    totalEarnedPoints += qPoints * scoreRatio;
    totalQuestions++;
    if (scoreRatio === 1) totalFullyCorrect++;

    if (!topicData[fq.topicId]) {
      var section = TEST_DATA.sections.find(function(s) { return s.topicId === fq.topicId; });
      topicData[fq.topicId] = {
        topicId: fq.topicId,
        topicName: fq.topicName,
        correct: 0,
        earnedPoints: 0,
        possiblePoints: 0,
        total: 0,
        passRule: section.topicPassRule,
        topicFeedback: section.topicFeedback || null,
        recommendedCourses: section.recommendedCourses || []
      };
    }
    topicData[fq.topicId].total++;
    topicData[fq.topicId].possiblePoints += qPoints;
    topicData[fq.topicId].earnedPoints += qPoints * scoreRatio;
    if (scoreRatio === 1) topicData[fq.topicId].correct++;
  });

  // Use point-based percentage for overall score (matches backend)
  var overallPercent = totalPossiblePoints > 0 ? (totalEarnedPoints / totalPossiblePoints) * 100 : 0;
  // Pass rule evaluation: percent type uses point-based percentage, count type uses fully correct count
  var overallPassed = checkPassRuleWithPartial(TEST_DATA.overallPassRule, overallPercent, totalFullyCorrect);

  var topicResults = [];
  var allTopicsPassed = true;

  Object.keys(topicData).forEach(function(tid) {
    var td = topicData[tid];
    // Use point-based percentage (matches backend)
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
    var correctIndices = Array.isArray(correct.correctIndices) ? correct.correctIndices : [];
    var totalCorrect = correctIndices.length;
    if (totalCorrect === 0) return 0;

    var correctSet = {};
    correctIndices.forEach(function(idx) { correctSet[idx] = true; });

    var answerList = Array.isArray(answer) ? answer : [];
    var correctSelections = 0;
    var incorrectSelections = 0;

    answerList.forEach(function(idx) {
      if (correctSet[idx]) correctSelections++;
      else incorrectSelections++;
    });

    return Math.max(0, (correctSelections - incorrectSelections) / totalCorrect);
  }

  if (q.type === 'matching') {
    var pairs = (answer && typeof answer === 'object') ? answer : {};
    var correctPairs = Array.isArray(correct.pairs) ? correct.pairs : [];
    var totalPairs = correctPairs.length;
    if (totalPairs === 0) return 0;

    var correctCount = 0;
    for (var i = 0; i < correctPairs.length; i++) {
      var p = correctPairs[i];
      if (pairs[p.left] === p.right) correctCount++;
    }

    return correctCount / totalPairs;
  }

  if (q.type === 'ranking') {
    var order = Array.isArray(answer) ? answer : [];
    var correctOrder = Array.isArray(correct.correctOrder) ? correct.correctOrder : [];

    if (correctOrder.length === 0) return 0;
    if (order.length !== correctOrder.length) return 0;

    var correctPositions = 0;
    for (var i = 0; i < order.length; i++) {
      if (order[i] === correctOrder[i]) correctPositions++;
    }

    return correctPositions / correctOrder.length;
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

// Pass rule check that properly handles partial credit
// For percent rules, uses the already-calculated percent (from earned/possible)
// For count rules, uses the fully correct count
function checkPassRuleWithPartial(rule, percent, fullyCorrectCount) {
  if (!rule) return true;
  if (rule.type === 'percent') {
    return percent >= rule.value;
  }
  return fullyCorrectCount >= rule.value;
}

function finishScorm(results) {
  var objectives = results.topicResults.map(function(tr) {
    return {
      id: 'topic_' + tr.topicId,
      score: Math.round(tr.percent),
      status: tr.passed === null ? 'unknown' : (tr.passed ? 'passed' : 'failed')
    };
  });

  var interactions = [];
  state.flatQuestions.forEach(function(fq, i) {
    var q = fq.question;
    var answer = state.answers[q.id];
    var scoreRatio = checkAnswer(q, answer);

    var type = q.type;
    if (type === 'single') type = 'choice';
    if (type === 'multiple') type = 'multiple_choice';
    if (type === 'ranking') type = 'sequencing';

    var response = '';
    if (q.type === 'single') {
      response = answer !== undefined ? String(answer) : '';
    } else if (q.type === 'multiple') {
      response = (answer || []).join(',');
    } else if (q.type === 'matching') {
      var pairs = answer || {};
      response = Object.keys(pairs).map(function(k) { return k + '-' + pairs[k]; }).join(',');
    } else if (q.type === 'ranking') {
      response = (answer || []).join(',');
    }

    // SCORM result: 'correct' for full credit, 'incorrect' for no credit, 
    // for partial credit use numeric value
    var result = scoreRatio === 1 ? 'correct' : (scoreRatio === 0 ? 'incorrect' : scoreRatio.toFixed(2));

    interactions.push({
      id: 'q_' + q.id,
      type: type,
      result: result,
      response: response
    });
  });

  // Report percentage as score (0-100 scale) for LMS
  var percentScore = Math.round(results.percent);
  SCORM.finish(percentScore, 100, results.passed, objectives, interactions);

  if (TEST_DATA.webhookUrl) {
    try {
      fetch(TEST_DATA.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testId: TEST_DATA.id,
          score: results.percent,
          passed: results.passed,
          topicResults: results.topicResults,
          timestamp: new Date().toISOString()
        })
      }).catch(function() {});
    } catch (e) {}
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
`;
}
