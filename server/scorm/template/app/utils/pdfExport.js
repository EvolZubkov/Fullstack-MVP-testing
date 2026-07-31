// app/utils/pdfExport.js
//
// The package's side of the attempt REPORT. The markup and the export pipeline are
// SHARED (shared/report/*, reached through the TBTemplate bundle) — the web host runs
// the same two functions, so a learner gets the same PDF in the LMS and in the browser.
// What stays here is package-specific: how the runtime result maps onto the normalized
// report input, and the loading overlay.
//
// The report's pictures are NOT known here: since PRD-27 FR-05 the background and the
// logo are files of the TEMPLATE, declared by the chosen variant and resolved to
// package paths by the builder — this side only inlines them for the rasterizer.

/** Inlined pictures of the report variant, resolved once per session. */
var pdfImageValues = null;

/**
 * Show the blocking «Генерация PDF…» overlay.
 * @returns {Element} The overlay, to be removed by {@link hidePdfOverlay}.
 */
function showPdfOverlay() {
  var overlay = document.createElement('div');
  overlay.id = 'pdf-loading-overlay';
  overlay.innerHTML = '<div style="display: flex; flex-direction: column; align-items: center; gap: 16px;">' +
    '<div style="width: 48px; height: 48px; border: 4px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: pdf-spin 1s linear infinite;"></div>' +
    '<div style="font-size: 18px; font-weight: 500;">Генерация PDF...</div>' +
    '<div style="font-size: 14px; opacity: 0.7;">Это может занять некоторое время</div>' +
    '</div>';
  overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 99999; color: #fff; font-family: Inter, sans-serif;';
  var style = document.createElement('style');
  style.textContent = '@keyframes pdf-spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
  document.body.appendChild(overlay);
  return overlay;
}

/** Remove the generation overlay, whatever the outcome was. */
function hidePdfOverlay() {
  var overlay = document.getElementById('pdf-loading-overlay');
  if (overlay) overlay.remove();
}

/**
 * Per-topic recommendations for the report: the TEST's section settings win over the
 * topic's own defaults — the same precedence the results screen uses (vrRecommended).
 *
 * @param {Object} topicResult One runtime topicResults[] row.
 * @returns {{courses: Array, events: Array}}
 */
function pdfTopicRecommendations(topicResult) {
  var section = (TEST_DATA && TEST_DATA.sections)
    ? TEST_DATA.sections.find(function (s) { return s.topicId === topicResult.topicId; })
    : null;
  var courses = (section && section.recommendedCourses && section.recommendedCourses.length > 0)
    ? section.recommendedCourses
    : (topicResult.recommendedCourses || topicResult.recommendedLinks || []);
  var events = (section && section.recommendedEvents)
    ? section.recommendedEvents
    : (topicResult.recommendedEvents || []);
  return { courses: courses, events: events };
}

/** Map the runtime's standard result onto the shared report input. */
function pdfStandardInput(results) {
  return {
    passed: !!results.passed,
    percent: results.percent,
    totalQuestions: results.totalQuestions,
    correct: (results.totalCorrect != null ? results.totalCorrect : results.correct),
    earnedPoints: results.earnedPoints,
    possiblePoints: results.possiblePoints,
    topicResults: (results.topicResults || []).map(function (tr) {
      var rec = pdfTopicRecommendations(tr);
      return {
        topicId: tr.topicId,
        topicName: tr.topicName,
        correct: tr.correct,
        total: tr.total,
        percent: tr.percent,
        earnedPoints: tr.earnedPoints,
        possiblePoints: tr.possiblePoints,
        passed: (tr.passed === null || tr.passed === undefined) ? null : !!tr.passed,
        feedback: tr.topicFeedback,
        recommendedCourses: rec.courses,
        recommendedEvents: rec.events
      };
    })
  };
}

/** Map the runtime's adaptive result onto the shared report input. */
function pdfAdaptiveInput(results) {
  return {
    topicResults: (results.topicResults || []).map(function (tr) {
      var rec = pdfTopicRecommendations(tr);
      return {
        topicName: tr.topicName,
        achievedLevelIndex: (tr.achievedLevelIndex === undefined ? null : tr.achievedLevelIndex),
        achievedLevelName: tr.achievedLevelName,
        totalQuestionsAnswered: tr.totalQuestionsAnswered,
        totalCorrect: tr.totalCorrect,
        feedback: tr.feedback,
        recommendedCourses: rec.courses,
        recommendedEvents: rec.events
      };
    })
  };
}

/**
 * Запечённый сборщиком выбор варианта отчёта (PRD-27 FR-22): макет, значения полей и
 * ключи полей-картинок (FR-05). Отсутствует у пакетов, собранных до этого PRD, — тогда
 * работает деградация по виду, а картинок у отчёта нет.
 *
 * @returns {{layoutKey: string, values: Object, imageKeys: string[]}|null}
 */
function pdfReportBake() {
  var ds = (typeof TEST_DATA !== 'undefined' && TEST_DATA) ? TEST_DATA.designSettings : null;
  return (ds && ds.report) ? ds.report : null;
}

/**
 * Макет отчёта АКТИВНОГО шаблона, либо вложенного `default`, когда активный вида не
 * объявил (PRD-27 FR-10). `systemLayout` реализует ровно эту деградацию для системных
 * экранов, поэтому отчёт идёт через неё же.
 *
 * @param {string} key Ключ макета: путь файла варианта либо канонический вид.
 * @returns {string} Макет; пустая строка — отчёт не собрать.
 */
function pdfReportLayout(key) {
  if (typeof systemLayout === 'function') {
    var viaFallback = systemLayout(key);
    if (viaFallback) return viaFallback;
  }
  return (typeof state !== 'undefined' && state && state.templateLayouts && state.templateLayouts[key]) || '';
}

/**
 * Build and download the attempt report.
 *
 * Страницу рисует МАКЕТ шаблона через общий рендерер (PRD-27 Фаза 2); CSS отчёта уже в
 * документе — пакет вкладывает `styles/report.css` в собранный `styles.css`, потому что
 * читать файл из рантайма к моменту растеризации поздно.
 *
 * @param {Object} results Runtime result (standard or adaptive shape).
 * @param {string} testName Test title.
 * @param {string} learnerName Learner's full name from the LMS (may be empty).
 * @param {string} timestamp ISO timestamp of the reported attempt.
 * @returns {Promise<boolean>} Whether a file was produced.
 */
async function exportResultsToPDF(results, testName, learnerName, timestamp) {
  showPdfOverlay();
  try {
    var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
    if (!TB || !TB.exportReportPdf) throw new Error('Общий модуль отчёта недоступен в пакете');

    var isAdaptive = TEST_DATA.mode === 'adaptive';
    var kind = isAdaptive ? 'report.adaptive' : 'report';
    // Макет ВЫБРАННОГО автором варианта; когда выбора в пакете нет (сборка до PRD-27)
    // либо файл варианта не загрузился — канонический вид, то есть прежнее поведение.
    var bake = pdfReportBake();
    var layout = (bake && bake.layoutKey) ? pdfReportLayout(bake.layoutKey) : '';
    if (!layout) layout = pdfReportLayout(kind);
    if (!layout) throw new Error('Шаблон не предоставил макет отчёта');

    // Картинки варианта — в data-URL, ОДИН раз за сессию: растеризатор снимает то, что
    // уже лежит в документе, и не станет ничего догружать (FR-05). Пути сюда приходят
    // от сборщика, уже разрешёнными в каталог шаблона внутри пакета.
    if (!pdfImageValues) {
      pdfImageValues = await TB.inlineReportImageValues(
        bake && bake.values ? bake.values : null,
        bake && bake.imageKeys ? bake.imageKeys : []
      );
    }

    var meta = {
      testName: testName,
      learnerName: learnerName,
      timestamp: timestamp,
      attemptsCount: (typeof getAllAttempts === 'function') ? getAllAttempts().length : 1
    };
    var opts = {
      design: (typeof scormDesignContext === 'function') ? scormDesignContext() : {},
      // Значения полей варианта — те, что автор задал в блоке обратной связи (FR-16).
      values: pdfImageValues
    };
    var context = isAdaptive
      ? TB.buildAdaptiveReportContext(Object.assign({}, meta, { result: pdfAdaptiveInput(results) }), opts)
      : TB.buildReportContext(Object.assign({}, meta, { result: pdfStandardInput(results) }), opts);

    var fileName = await TB.exportReportPdf({ layout: layout, context: context }, testName, {
      jsPDF: window.jspdf && window.jspdf.jsPDF,
      html2canvas: window.html2canvas
    });
    console.log('PDF сгенерирован:', fileName);
    return true;
  } catch (error) {
    console.error('Ошибка генерации PDF:', error);
    alert('Ошибка при экспорте PDF: ' + (error && error.message ? error.message : error));
    return false;
  } finally {
    hidePdfOverlay();
  }
}
