/**
 * @module _preview-bootstrap
 * @description Browser-side bootstrap for template preview.html files.
 *
 * Reads globals injected by the generator:
 *   window.PRD1_PREVIEW_MANIFEST  — parsed manifest.json
 *   window.PRD1_PREVIEW_DEMO_DATA — parsed demo/course.json
 *   window.PRD1_PREVIEW_LAYOUTS   — { layoutKey: htmlString, ... }
 *   window.PRD1_PREVIEW_STYLES    — concatenated template CSS (already in <style>)
 *
 * Depends on PRD1 runtime globals (also injected by generator):
 *   window.TestBuilder   — from templateCore.js
 *   window.renderContentPage, buildContentPageSkeleton — from contentPage.js
 *   window.TEST_DATA     — set by this bootstrap from demo data
 *   window.escapeHtml    — injected by generator
 */
(function (root) {
  "use strict";

  // ─── Globals (set by generator) ─────────────────────────────────────────────
  var manifest = root.PRD1_PREVIEW_MANIFEST || {};
  var demoData = root.PRD1_PREVIEW_DEMO_DATA || {};
  var layouts  = root.PRD1_PREVIEW_LAYOUTS  || {};

  // ─── Path resolver (same as templateCore, but standalone) ───────────────────
  function resolvePath(obj, path) {
    if (!obj || !path) return undefined;
    var parts = path.split(".");
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  // ─── Param expander ──────────────────────────────────────────────────────────
  /** Expands flat dot-notation param keys (e.g. "layout.heroImage") into nested objects. */
  function expandParams(flat) {
    var result = {};
    Object.keys(flat).forEach(function (k) {
      var v = flat[k];
      if (k.indexOf(".") === -1) { result[k] = v; return; }
      var parts = k.split(".");
      var cur = result;
      for (var i = 0; i < parts.length - 1; i++) {
        if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = v;
    });
    return result;
  }

  // ─── DSL renderer ────────────────────────────────────────────────────────────
  /**
   * Renders the path-only DSL in an HTML string. Delegates to the REAL shared
   * renderer (`shared/template/dsl.ts`, bundled by the generator as `window.TBDsl`)
   * so nested `{{#if}}`/`{{#unless}}`/`{{#each}}` and in-loop blocks behave exactly
   * as they do on the SCORM/web hosts — no second, drifting DSL. The legacy
   * non-recursive regex below is a best-effort fallback only if the bundle is
   * absent or a template trips the strict parser.
   */
  function renderDsl(html, data) {
    if (root.TBDsl && typeof root.TBDsl.renderTemplate === "function") {
      try {
        return root.TBDsl.renderTemplate(html, data);
      } catch (e) {
        if (root.console) root.console.warn("[preview] real DSL failed, falling back:", e && e.message);
      }
    }
    // {{#unless path}}...{{/unless}}
    html = html.replace(/\{\{#unless ([^}]+)\}\}([\s\S]*?)\{\{\/unless\}\}/g, function (_, p, inner) {
      var v = resolvePath(data, p.trim());
      return (!v) ? inner : "";
    });
    // {{#if path}}...{{/if}}
    html = html.replace(/\{\{#if ([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, function (_, p, inner) {
      var v = resolvePath(data, p.trim());
      return v ? inner : "";
    });
    // {{#each path}}...{{/each}}
    html = html.replace(/\{\{#each ([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, function (_, p, inner) {
      var arr = resolvePath(data, p.trim());
      if (!Array.isArray(arr)) return "";
      return arr.map(function (item) {
        return inner.replace(/\{\{\s*(\w+)\s*\}\}/g, function (_, key) {
          var v = item[key];
          return v !== undefined && v !== null ? escapeHtml(String(v)) : "";
        });
      }).join("");
    });
    // {{ path }}
    html = html.replace(/\{\{\s*([^#/][^}]*?)\s*\}\}/g, function (_, p) {
      var v = resolvePath(data, p.trim());
      return v !== undefined && v !== null ? escapeHtml(String(v)) : "";
    });
    return html;
  }

  /** Fills [data-path] elements inside a root element. */
  function fillDataPaths(root, data) {
    root.querySelectorAll("[data-path]").forEach(function (el) {
      var path = el.getAttribute("data-path");
      var v = resolvePath(data, path);
      if (v !== undefined && v !== null) el.textContent = String(v);
    });
  }

  // ─── Shell & stage helpers ───────────────────────────────────────────────────
  var _stage = null;

  function getStage() {
    if (!_stage) _stage = document.getElementById("pv-stage");
    return _stage;
  }

  function getApp() {
    var stage = getStage();
    return stage ? stage.querySelector("#app") : null;
  }

  /** Injects rendered shell into the stage (called once on init). */
  function buildShell() {
    var stage = getStage();
    if (!stage) return;
    var shellHtml = layouts["shell"] || "";
    // Resolve Handlebars-style partials: {{> partialName }}
    shellHtml = shellHtml.replace(/\{\{>\s*(\w+)\s*\}\}/g, function (_, name) {
      return layouts[name] || "";
    });
    stage.innerHTML = renderDsl(shellHtml, buildDslData());
  }

  /** Resolves manifest param defaults into a flat object. */
  function paramDefaults() {
    var out = {};
    (manifest.params || []).forEach(function (p) {
      if (p.default !== null && p.default !== undefined) out[p.key] = p.default;
    });
    return out;
  }

  /** Builds the data object for DSL rendering (merges course + runtime + params). */
  function buildDslData() {
    var course  = demoData.course  || {};
    var runtime = demoData.runtime || {};
    var state   = runtime.state   || {};
    var currentTopicId = state.currentTopicId || "";

    // Build sections array for {{#each sections}} in topic-nav partial
    var sections = (course.topics || []).map(function (t) {
      var cls = t.status === "completed" ? "is-complete" :
                (t.id === currentTopicId || t.status === "available") ? "is-active" : "is-locked";
      return { id: t.id, title: t.title || "", className: cls };
    });

    return {
      course:   course,
      runtime:  runtime,
      result:   runtime.result   || {},
      progress: runtime.progress || {},
      state:    state,
      params:   expandParams(demoData.params || paramDefaults()),
      sections: sections,
      nav: {
        submitAnswerLabel: "Принять ответ",
        finishLabel:       "Завершить тест",
        nextLabel:         "Далее"
      },
      page: {
        title:   course.title || "",
        content: {},
        results: { kicker: "Результаты теста" }
      }
    };
  }

  // ─── TEST_DATA for contentPage.js / renderers.js ────────────────────────────
  function buildTestData() {
    var runtime = demoData.runtime || {};
    var course = demoData.course || {};
    var sections = (course.topics || []).map(function (t) {
      return {
        topicId: t.id,
        topicName: t.title || "",
        topicDescription: t.description || null,
        required: t.required !== false,
        timeLimitMinutes: t.timeLimitMinutes || null,
        drawCount: t.questionCount || null,
        image: t.image || null
      };
    });
    return Object.assign({}, runtime, {
      title: course.title || "",
      sections: sections,
      contentPages: course.contentPages || [],
      deadline: course.deadline || null,
      flowPolicy: { mode: "router_by_topics" },
      designSettings: {
        templateId: manifest.id,
        params: demoData.params || paramDefaults()
      }
    });
  }

  // ─── Navigation ──────────────────────────────────────────────────────────────
  function buildNav() {
    var nav = document.getElementById("pv-nav");
    if (!nav) return;
    var routes = (manifest.preview || {}).routes || [];
    var html = "";
    routes.forEach(function (r, i) {
      html += '<button type="button" class="pv-nav-item' + (i === 0 ? " pv-active" : "") + '" data-route="' + escapeHtml(r.route) + '">' + escapeHtml(r.label) + "</button>";
    });
    nav.innerHTML = html;
    nav.addEventListener("click", function (e) {
      var btn = e.target.closest(".pv-nav-item");
      if (!btn) return;
      var route = btn.getAttribute("data-route");
      nav.querySelectorAll(".pv-nav-item").forEach(function (el) { el.classList.remove("pv-active"); });
      btn.classList.add("pv-active");
      navigateTo(route, btn);
    });
  }

  // ─── Route navigation ────────────────────────────────────────────────────────
  function navigateTo(route, btn) {
    var routes = (manifest.preview || {}).routes || [];
    var routeDef = null;
    for (var i = 0; i < routes.length; i++) {
      if (routes[i].route === route) { routeDef = routes[i]; break; }
    }
    var label = routeDef ? routeDef.label : route;
    updateCaption(label);

    if (route === "start") {
      renderLayoutPage("start", buildDslData());
    } else if (route.indexOf("content.") === 0 || route === "content") {
      renderContentRoute(routeDef);
    } else if (route.indexOf("question.") === 0) {
      renderQuestionRoute(routeDef, route);
    } else if (route === "results") {
      renderLayoutPage("results", buildDslData());
    } else if (route === "review") {
      renderReviewRoute();
    } else if (route === "section-results") {
      renderSectionResultsRoute();
    } else if (route === "system.blocked" || route === "system.locked" ||
               route.indexOf("system.") === 0) {
      var systemData = Object.assign({}, buildDslData(), {
        page: {
          title:   "Доступ ограничен",
          content: { message: "Для этого теста больше нет доступных попыток." },
          results: {}
        }
      });
      renderLayoutPage(route, systemData);
    } else {
      renderLayoutPage(route, buildDslData());
    }

    updateProgress(route);
  }

  // ─── Content page rendering ──────────────────────────────────────────────────
  function renderContentRoute(routeDef) {
    if (!routeDef) return;
    var app = getApp();
    if (!app) return;

    var route = routeDef.route || "";
    var pageId = routeDef.pageId;
    var templateKey = routeDef.templateKey;
    var pages = (demoData.course || {}).contentPages || [];
    var page = null;
    for (var i = 0; i < pages.length; i++) {
      if ((pageId && pages[i].id === pageId) || (!pageId && pages[i].templateKey === templateKey)) {
        page = pages[i]; break;
      }
    }
    if (!page) return;

    // Router page → dedicated renderer (topic cards + progress + «Завершить»).
    var _ct = null;
    (manifest.contentTemplates || []).forEach(function (c) { if (c.key === page.templateKey) _ct = c; });
    if (((_ct && _ct.kind === "router") || page.kind === "router") &&
        root.RouterFlow && typeof root.RouterFlow.renderRouterPage === "function") {
      root.RouterFlow.renderRouterPage(page);
      return;
    }

    // If the template has a layout with data-slot="content-body" (rtk-style), render it directly.
    // Otherwise fall back to the PRD1 renderContentPage skeleton.
    var layoutHtml = layouts[route] || "";
    if (layoutHtml && layoutHtml.indexOf('data-slot="content-body"') >= 0) {
      var values = page.values || {};
      var pageDslData = Object.assign({}, buildDslData(), {
        page: {
          title:   values.title || (demoData.course || {}).title || "",
          content: values,
          summary: values,
          question: {}
        }
      });
      app.innerHTML = renderDsl(layoutHtml, pageDslData);
      var bodySlot = app.querySelector('[data-slot="content-body"]');
      if (bodySlot && values.body) bodySlot.innerHTML = String(values.body);
      fillDataPaths(app, pageDslData);
      return;
    }

    // PRD1 fallback: renderContentPage writes to #app directly
    if (typeof renderContentPage === "function") {
      renderContentPage(page, manifest.contentTemplates || []);
    }
  }

  // ─── Review / section-results rendering ─────────────────────────────────────
  // These two routes have no pageId; they bind top-level `review.*` /
  // `sectionResult.*` / `state.questionsProgress` namespaces that buildDslData does
  // NOT surface. Build the context via the SAME shared builders production uses
  // (window.TBTemplate.buildReviewContext / buildSectionResultContext) so the
  // offline preview mirrors the learner screen instead of rendering blank.
  function renderReviewRoute() {
    var TBt = (typeof window !== "undefined") ? window.TBTemplate : null;
    var base = buildDslData();
    var questions = ((demoData.course || {}).questions || []).map(function (q) {
      return { id: q.id, topicId: q.topicId, prompt: q.prompt };
    });
    // Demo statuses: leave every 3rd question skipped so the обзор shows the
    // «вернуться к пропущенным» list + pill map populated.
    var statuses = {};
    questions.forEach(function (q, i) { statuses[q.id] = (i % 3 === 2) ? "skipped" : "answered"; });
    var built = (TBt && TBt.buildReviewContext) ? TBt.buildReviewContext({
      questions: questions, statuses: statuses, commitScope: "test", isTest: true,
      scopeLabel: "Вопросы теста", finishLabel: "Завершить тест"
    }) : null;
    var data = Object.assign({}, base, {
      review: built ? built.review : {},
      state: Object.assign({}, base.state, { questionsProgress: built ? built.questionsProgress : null })
    });
    renderLayoutPage("review", data);
  }

  function renderSectionResultsRoute() {
    var TBt = (typeof window !== "undefined") ? window.TBTemplate : null;
    var base = buildDslData();
    var topic = ((demoData.course || {}).topics || [])[0] || {};
    var sr = (demoData.runtime || {}).sectionResult || {};
    var built = (TBt && TBt.buildSectionResultContext) ? TBt.buildSectionResultContext({
      topicName: topic.title || "Раздел",
      correct: sr.score != null ? sr.score : 7,
      total: sr.maxScore != null ? sr.maxScore : 8,
      percent: sr.scorePercent != null ? sr.scorePercent : 88,
      passed: sr.status ? sr.status === "passed" : true,
      continueLabel: "Продолжить"
    }) : null;
    var data = Object.assign({}, base, {
      course: built ? built.course : (demoData.course || {}),
      sectionResult: built ? built.sectionResult : {}
    });
    renderLayoutPage("section-results", data);
  }

  // ─── Question rendering ───────────────────────────────────────────────────────
  function renderQuestionRoute(routeDef, route) {
    var app = getApp();
    if (!app) return;

    var questionId = routeDef && routeDef.questionId;
    var questions = (demoData.course || {}).questions || [];
    var q = null;
    if (questionId) {
      for (var i = 0; i < questions.length; i++) {
        if (questions[i].id === questionId) { q = questions[i]; break; }
      }
    }

    var type = route.replace("question.", "");
    // Fall back to first question of matching type from demo data
    if (!q) {
      for (var j = 0; j < questions.length; j++) {
        if (questions[j].type === type) { q = questions[j]; break; }
      }
    }

    // Use type-specific layout when available (e.g. "question.single"), else generic "question"
    var layoutHtml = layouts["question." + type] || layouts["question"] || "";
    var dslData = buildDslData();

    // Build question counter label: "Вопрос N из M | TopicName"
    var qIndex = 0;
    for (var k = 0; k < questions.length; k++) {
      if (questions[k] === q) { qIndex = k; break; }
    }
    var topicTitle = "";
    if (q && q.topicId) {
      var topics = (demoData.course || {}).topics || [];
      for (var t = 0; t < topics.length; t++) {
        if (topics[t].id === q.topicId) { topicTitle = topics[t].title || ""; break; }
      }
    }
    var counterLabel = q ? ("Вопрос " + (qIndex + 1) + " из " + questions.length) : "";

    var customState = Object.assign({}, dslData.state, {
      questionCounterLabel: counterLabel,
      sectionName: topicTitle,
      currentTopicTitle: topicTitle
    });
    // PRD-19 Block C: build the progress-pills indicator so the question layout's pill
    // map renders in the preview (skip/return progress), matching production.
    var TBt = (typeof window !== "undefined") ? window.TBTemplate : null;
    if (TBt && typeof TBt.buildQuestionProgress === "function" && q) {
      var qList = questions.map(function (qq) { return { id: qq.id, topicId: qq.topicId }; });
      var demoStatuses = {};
      for (var s = 0; s < questions.length; s++) {
        if (s < qIndex) demoStatuses[questions[s].id] = (s === qIndex - 1) ? "skipped" : "answered";
      }
      customState.questionsProgress = TBt.buildQuestionProgress({
        questions: qList,
        statuses: demoStatuses,
        currentIndex: qIndex,
        commitScope: "test",
        sectionCommitted: {},
        allowReturn: true,
        scopeLabel: "Вопросы теста"
      });
    }
    var qDslData = Object.assign({}, dslData, {
      state: customState,
      page: {
        title:   (demoData.course || {}).title || "",
        content: {},
        question: { topicTitle: topicTitle }
      }
    });
    app.innerHTML = renderDsl(layoutHtml, qDslData);

    // Support both slot names: default template uses "question-text", rtk uses "question-prompt"
    var promptSlot = app.querySelector('[data-slot="question-text"], [data-slot="question-prompt"]');
    var interSlot  = app.querySelector('[data-slot="question-interaction"]');

    if (promptSlot && q) promptSlot.innerHTML = escapeHtml(q.prompt || "");
    if (interSlot  && q) interSlot.innerHTML  = buildInteractionHtml(q);

    fillDataPaths(app, qDslData);

    // Reveal the timer with a demo value (production reveals it from remainingSeconds).
    var _timer = app.querySelector("#timer-display");
    if (_timer) { _timer.classList.remove("q-timer--hidden"); _timer.textContent = "44:51"; }

    // Stepped text-fit (mirrors the runtime): shrink the prompt/options via --q-fit to
    // fit the fixed stage before the card's overflow scroll kicks in. Lower bound 0.7.
    var _card = app.querySelector(".question-card");
    if (_card && _card.style) {
      _card.classList.remove("question-card--scroll");
      var _steps = [1, 0.94, 0.88, 0.82, 0.76, 0.7], _fits = false;
      for (var _i = 0; _i < _steps.length; _i++) {
        _card.style.setProperty("--q-fit", String(_steps[_i]));
        if (_card.scrollHeight <= _card.clientHeight + 1) { _fits = true; break; }
      }
      if (!_fits) _card.classList.add("question-card--scroll");
    }
  }

  // ─── Interaction HTML builders ────────────────────────────────────────────────

  /** Builds interactive HTML for a question's interaction area. */
  function buildInteractionHtml(q) {
    if (!q) return "";
    switch (q.type) {
      case "single":
        return buildChoiceHtml(q, "radio");
      case "multiple":
        return buildChoiceHtml(q, "checkbox");
      case "matching":
        return buildMatchingHtml(q);
      case "ranking":
        return buildRankingHtml(q);
      default:
        return "";
    }
  }

  function buildChoiceHtml(q, inputType) {
    var name = "q-" + q.id;
    var html = "";
    (q.options || []).forEach(function (opt, idx) {
      var id = name + "-" + idx;
      html += '<div class="option" data-q="' + escapeHtml(String(q.id)) + '" data-input-type="' + inputType + '" data-opt-id="' + escapeHtml(String(opt.id)) + '">' +
        '<input type="' + inputType + '" id="' + escapeHtml(id) + '" name="' + escapeHtml(name) + '" value="' + escapeHtml(String(opt.id)) + '">' +
        escapeHtml(opt.text) +
        "</div>";
    });
    html += '<div class="navigation"><button type="button" class="btn" data-action="answer-submit">Принять ответ</button><button type="button" class="btn" data-nav="next">Далее</button></div>';
    return html;
  }

  // ─── Choice click handler (bound once on document) ────────────────────────────

  var _choiceClickBound = false;

  function bindChoiceClicksOnce() {
    if (_choiceClickBound) return;
    _choiceClickBound = true;

    document.addEventListener("click", function (e) {
      var el = e.target.closest ? e.target.closest(".option") : null;
      if (!el) return;
      var inputType = el.getAttribute("data-input-type");
      var qid = el.getAttribute("data-q");
      var inp = el.querySelector("input");
      if (!inp) return;

      if (inputType === "radio") {
        var stage = getStage();
        if (stage) {
          stage.querySelectorAll(".option[data-q]").forEach(function (o) {
            if (o.getAttribute("data-q") === qid) {
              o.classList.remove("selected");
              o.classList.remove("is-selected");
              var i = o.querySelector("input");
              if (i) i.checked = false;
            }
          });
        }
        el.classList.add("selected");
        el.classList.add("is-selected");
        inp.checked = true;
      } else {
        el.classList.toggle("selected");
        el.classList.toggle("is-selected");
        inp.checked = el.classList.contains("selected");
      }
    });
  }

  // ─── Matching: chip-based drag-and-drop ───────────────────────────────────────

  /** Per-question matching state: { answers: {leftIdx: rightIdx}, pool: [leftIdx,...] } */
  var _matchingState = {};

  function getMatchingState(q) {
    var qid = q.id;
    if (!_matchingState[qid]) {
      var pairs = q.pairs || [];
      var pool = pairs.map(function (_, i) { return i; });
      _matchingState[qid] = { answers: {}, pool: pool };
    }
    return _matchingState[qid];
  }

  /** Rebuilds the [data-slot="question-interaction"] content for a matching question. */
  function rerenderMatchingBoard(q) {
    var slot = document.querySelector('[data-slot="question-interaction"]');
    if (slot) slot.innerHTML = buildMatchingHtml(q);
  }

  /**
   * Builds chip-based DnD matching HTML matching pre-PRD1 structure.
   * Layout: .matching-board > .matching-line > [left slot] + .matching-gap + .match-right-tile
   * demo data format: q.pairs = [{id, left, right}], indices used as leftIdx / rightIdx
   */
  function buildMatchingHtml(q) {
    var pairs = q.pairs || [];
    var ms = getMatchingState(q);
    var answers = ms.answers;
    var pool = ms.pool;

    // rightToLeft map: rightIdx -> leftIdx from current answers
    var rightToLeft = {};
    Object.keys(answers).forEach(function (k) {
      var li = parseInt(k, 10);
      var ri = answers[k];
      if (typeof ri === "number") rightToLeft[ri] = li;
    });

    var html = '<div class="matching-board" data-qid="' + escapeHtml(q.id) + '">';
    var poolSlot = 0;

    pairs.forEach(function (pair, rightIdx) {
      var matchedLeft = rightToLeft.hasOwnProperty(rightIdx) ? rightToLeft[rightIdx] : null;
      var isJoined = (matchedLeft !== null);

      html += '<div class="matching-line' + (isJoined ? " is-joined" : "") +
        '" data-qid="' + escapeHtml(q.id) + '" data-right="' + rightIdx + '">';

      if (isJoined) {
        // Left slot contains a matched chip
        html += '<div class="match-tile match-left-slot match-drop-left"' +
          ' data-qid="' + escapeHtml(q.id) + '" data-right="' + rightIdx + '">';
        html += '<div class="match-chip" draggable="true"' +
          ' data-qid="' + escapeHtml(q.id) +
          '" data-left="' + matchedLeft +
          '" data-from="match" data-right="' + rightIdx + '">' +
          escapeHtml(pairs[matchedLeft].left) + '</div>';
        html += '</div>';
      } else {
        var poolLeft = (poolSlot < pool.length) ? pool[poolSlot] : null;
        if (poolLeft !== null && poolLeft !== undefined) {
          // Left slot has a pool chip
          html += '<div class="match-tile match-left-slot match-drop-left"' +
            ' data-qid="' + escapeHtml(q.id) +
            '" data-right="' + rightIdx +
            '" data-pool-slot="' + poolSlot + '">';
          html += '<div class="match-chip" draggable="true"' +
            ' data-qid="' + escapeHtml(q.id) +
            '" data-left="' + poolLeft +
            '" data-from="pool" data-pool-index="' + poolSlot + '">' +
            escapeHtml(pairs[poolLeft].left) + '</div>';
          html += '</div>';
        } else {
          // Empty slot
          html += '<div class="match-empty match-left-slot match-drop-left"' +
            ' data-qid="' + escapeHtml(q.id) +
            '" data-right="' + rightIdx +
            '" data-pool-slot="' + poolSlot + '">' +
            '<span class="slot-placeholder">Перетащите вариант</span>' +
            '</div>';
        }
        poolSlot++;
      }

      html += '<div class="matching-gap"></div>';

      html += '<div class="match-tile match-right-tile match-drop-right"' +
        ' data-qid="' + escapeHtml(q.id) + '" data-right="' + rightIdx + '">' +
        escapeHtml(pairs[rightIdx].right) + '</div>';

      html += '</div>'; // .matching-line
    });

    html += '</div>'; // .matching-board
    html += '<div class="navigation"><button type="button" class="btn" data-action="answer-submit">Принять ответ</button><button type="button" class="btn" data-nav="next">Далее</button></div>';
    return html;
  }

  // ─── Ranking: grip-based drag-and-drop ───────────────────────────────────────

  /** Per-question ranking state: ordered array of item indices. */
  var _rankingState = {};

  function getRankingState(q) {
    var qid = q.id;
    if (!_rankingState[qid]) {
      var opts = q.options || [];
      _rankingState[qid] = opts.map(function (_, i) { return i; });
    }
    return _rankingState[qid];
  }

  /** Rebuilds the [data-slot="question-interaction"] content for a ranking question. */
  function rerenderRankingBoard(q) {
    var slot = document.querySelector('[data-slot="question-interaction"]');
    if (slot) slot.innerHTML = buildRankingHtml(q);
  }

  /**
   * Builds grip-based DnD ranking HTML matching pre-PRD1 structure.
   * Layout: .ranking-board > .rank-item.rank-draggable > .rank-grip + .rank-text
   * demo data format: q.options = [{id, text}], state uses index ordering
   */
  function buildRankingHtml(q) {
    var opts = q.options || [];
    var order = getRankingState(q);
    var html = '<div class="ranking-board" data-qid="' + escapeHtml(q.id) + '">';
    order.forEach(function (itemIdx, pos) {
      var text = opts[itemIdx] ? opts[itemIdx].text : ("#" + itemIdx);
      html += '<div class="rank-item rank-draggable" draggable="true"' +
        ' data-qid="' + escapeHtml(q.id) + '"' +
        ' data-pos="' + pos + '"' +
        ' data-item="' + itemIdx + '">' +
        '<span class="rank-grip">' +
        '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path d="M2.5 4.99524H17.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>' +
        '<path d="M14.1667 9.9952H2.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>' +
        '<path d="M2.5 14.9951H10.8333" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>' +
        '</svg>' +
        '</span>' +
        '<span class="rank-text">' + escapeHtml(text) + '</span>' +
        '</div>';
    });
    html += '</div>'; // .ranking-board
    html += '<div class="navigation"><button type="button" class="btn" data-action="answer-submit">Принять ответ</button><button type="button" class="btn" data-nav="next">Далее</button></div>';
    return html;
  }

  // ─── Matching DnD (bound once on document) ───────────────────────────────────

  var _matchingDndBound = false;

  function bindMatchingDndOnce() {
    if (_matchingDndBound) return;
    _matchingDndBound = true;

    var _overEl = null;

    function closestCls(node, cls) {
      var el = node;
      while (el && el !== document) {
        if (el.classList && el.classList.contains(cls)) return el;
        el = el.parentNode;
      }
      return null;
    }

    function clearOver() {
      if (_overEl) _overEl.classList.remove("is-over");
      _overEl = null;
    }

    function setOver(el) {
      if (_overEl && _overEl !== el) _overEl.classList.remove("is-over");
      _overEl = el;
      if (el) el.classList.add("is-over");
    }

    function findQuestion(qid) {
      var questions = (demoData.course || {}).questions || [];
      for (var i = 0; i < questions.length; i++) {
        if (String(questions[i].id) === String(qid)) return questions[i];
      }
      return null;
    }

    function removeFromPool(pool, leftIdx, poolIndex) {
      if (typeof poolIndex === "number" && poolIndex >= 0 && poolIndex < pool.length && pool[poolIndex] === leftIdx) {
        return pool.splice(poolIndex, 1), poolIndex;
      }
      var idx = pool.indexOf(leftIdx);
      if (idx >= 0) pool.splice(idx, 1);
      return idx;
    }

    function insertIntoPool(pool, leftIdx, index) {
      var i = (typeof index === "number") ? index : pool.length;
      if (i < 0) i = 0;
      if (i > pool.length) i = pool.length;
      pool.splice(i, 0, leftIdx);
    }

    function leftForRight(answers, rightIdx) {
      var keys = Object.keys(answers);
      for (var i = 0; i < keys.length; i++) {
        if (answers[keys[i]] === rightIdx) return parseInt(keys[i], 10);
      }
      return null;
    }

    function deleteAnswer(answers, leftIdx) {
      delete answers[leftIdx];
      delete answers[String(leftIdx)];
    }

    function parsePayload(e) {
      var payload = null;
      try { payload = JSON.parse(e.dataTransfer.getData("application/json")); } catch (err) {}
      if (payload && payload.qid) return payload;
      var raw = "";
      try { raw = e.dataTransfer.getData("text/plain"); } catch (err) {}
      if (!raw) return null;
      var parts = raw.split("|");
      if (parts.length < 2) return null;
      var qid = parts[0];
      var leftIdx = parseInt(parts[1], 10);
      if (!qid || isNaN(leftIdx)) return null;
      payload = { qid: qid, leftIdx: leftIdx, from: parts[2] || "pool" };
      if (parts[3] !== undefined && parts[3] !== "") { var pi = parseInt(parts[3], 10); if (!isNaN(pi)) payload.poolIndex = pi; }
      if (parts[4] !== undefined && parts[4] !== "") { var ri = parseInt(parts[4], 10); if (!isNaN(ri)) payload.rightIdx = ri; }
      return payload;
    }

    document.addEventListener("dragstart", function (e) {
      var chip = closestCls(e.target, "match-chip");
      if (!chip) return;
      var qid = chip.getAttribute("data-qid");
      var left = parseInt(chip.getAttribute("data-left"), 10);
      if (!qid || isNaN(left)) return;
      var from = chip.getAttribute("data-from") || "pool";
      var payload = { qid: qid, leftIdx: left, from: from };
      var piStr = chip.getAttribute("data-pool-index");
      if (piStr !== null && piStr !== "") { var pi = parseInt(piStr, 10); if (!isNaN(pi)) payload.poolIndex = pi; }
      var riStr = chip.getAttribute("data-right");
      if (riStr !== null && riStr !== "") { var ri = parseInt(riStr, 10); if (!isNaN(ri)) payload.rightIdx = ri; }
      try {
        e.dataTransfer.setData("application/json", JSON.stringify(payload));
        e.dataTransfer.setData("text/plain",
          payload.qid + "|" + payload.leftIdx + "|" + payload.from + "|" +
          (payload.poolIndex !== undefined ? payload.poolIndex : "") + "|" +
          (payload.rightIdx !== undefined ? payload.rightIdx : ""));
        e.dataTransfer.effectAllowed = "move";
      } catch (err) {}
    });

    document.addEventListener("dragover", function (e) {
      var dropEl = closestCls(e.target, "match-drop-right") || closestCls(e.target, "match-drop-left");
      if (!dropEl) return;
      e.preventDefault();
      setOver(dropEl);
      try { e.dataTransfer.dropEffect = "move"; } catch (err) {}
    });

    document.addEventListener("dragleave", function (e) {
      var dropEl = closestCls(e.target, "match-drop-right") || closestCls(e.target, "match-drop-left");
      if (!dropEl) return;
      if (_overEl === dropEl && (!e.relatedTarget || !dropEl.contains(e.relatedTarget))) clearOver();
    });

    document.addEventListener("drop", function (e) {
      clearOver();
      var rightDrop = closestCls(e.target, "match-drop-right");
      var leftDrop  = closestCls(e.target, "match-drop-left");
      var dropEl = rightDrop || leftDrop;
      if (!dropEl) return;
      e.preventDefault();

      var payload = parsePayload(e);
      if (!payload || !payload.qid || isNaN(payload.leftIdx)) return;

      var q = findQuestion(payload.qid);
      if (!q || q.type !== "matching") return;

      var ms = getMatchingState(q);
      var answers = ms.answers;
      var pool = ms.pool;

      var poolSlotStr = dropEl.getAttribute("data-pool-slot");
      var targetRightStr = dropEl.getAttribute("data-right");
      var isPoolDrop = (poolSlotStr !== null && poolSlotStr !== "");

      if (isPoolDrop) {
        // Dropped onto a left/pool slot
        var targetSlot = parseInt(poolSlotStr, 10);
        if (isNaN(targetSlot)) return;
        if (payload.from === "pool") {
          var removedAt = pool.indexOf(payload.leftIdx);
          removeFromPool(pool, payload.leftIdx, payload.poolIndex);
          if (removedAt >= 0 && removedAt < targetSlot) targetSlot--;
        } else {
          deleteAnswer(answers, payload.leftIdx);
        }
        insertIntoPool(pool, payload.leftIdx, targetSlot);
        rerenderMatchingBoard(q);
        return;
      }

      // Dropped onto a right slot
      var targetRight = parseInt(targetRightStr, 10);
      if (isNaN(targetRight)) return;

      if (payload.from === "pool") {
        removeFromPool(pool, payload.leftIdx, payload.poolIndex);
      } else {
        deleteAnswer(answers, payload.leftIdx);
      }

      // Displace any existing chip in this right slot → back to pool
      var oldLeft = leftForRight(answers, targetRight);
      if (oldLeft !== null && !isNaN(oldLeft)) {
        deleteAnswer(answers, oldLeft);
        insertIntoPool(pool, oldLeft,
          (payload.from === "pool" && typeof payload.poolIndex === "number") ? payload.poolIndex : pool.length);
      }

      answers[payload.leftIdx] = targetRight;
      rerenderMatchingBoard(q);
    });

    // Double-click a matched chip to return it to the pool
    document.addEventListener("dblclick", function (e) {
      var chip = closestCls(e.target, "match-chip");
      if (!chip || chip.getAttribute("data-from") !== "match") return;
      var qid = chip.getAttribute("data-qid");
      var leftIdx = parseInt(chip.getAttribute("data-left"), 10);
      if (!qid || isNaN(leftIdx)) return;
      var q = findQuestion(qid);
      if (!q || q.type !== "matching") return;
      var ms = getMatchingState(q);
      deleteAnswer(ms.answers, leftIdx);
      insertIntoPool(ms.pool, leftIdx, ms.pool.length);
      rerenderMatchingBoard(q);
    });
  }

  // ─── Ranking DnD (bound once on document) ────────────────────────────────────

  var _rankingDndBound = false;

  function bindRankingDndOnce() {
    if (_rankingDndBound) return;
    _rankingDndBound = true;

    var dragPayload = null;
    var _overEl = null;

    function closestCls(node, cls) {
      var el = node;
      while (el && el !== document) {
        if (el.classList && el.classList.contains(cls)) return el;
        el = el.parentNode;
      }
      return null;
    }

    function clearRankOver() {
      if (_overEl) _overEl.classList.remove("is-over");
      _overEl = null;
    }

    function setRankOver(el) {
      if (_overEl && _overEl !== el) _overEl.classList.remove("is-over");
      _overEl = el;
      if (el) el.classList.add("is-over");
    }

    function moveInArray(arr, from, to) {
      if (from === to) return arr;
      var copy = arr.slice();
      var item = copy.splice(from, 1)[0];
      copy.splice(to, 0, item);
      return copy;
    }

    function findQuestion(qid) {
      var questions = (demoData.course || {}).questions || [];
      for (var i = 0; i < questions.length; i++) {
        if (String(questions[i].id) === String(qid)) return questions[i];
      }
      return null;
    }

    document.addEventListener("dragstart", function (e) {
      var el = closestCls(e.target, "rank-draggable");
      if (!el) return;
      var qid = el.getAttribute("data-qid");
      var fromPos = parseInt(el.getAttribute("data-pos"), 10);
      var itemIdx = parseInt(el.getAttribute("data-item"), 10);
      if (!qid || isNaN(fromPos) || isNaN(itemIdx)) return;
      dragPayload = { qid: qid, fromPos: fromPos, itemIdx: itemIdx };
      el.classList.add("dragging");
      try {
        e.dataTransfer.setData("application/json", JSON.stringify(dragPayload));
        e.dataTransfer.effectAllowed = "move";
      } catch (err) {}
    });

    document.addEventListener("dragend", function (e) {
      var el = closestCls(e.target, "rank-draggable");
      if (el) el.classList.remove("dragging");
      dragPayload = null;
      clearRankOver();
    });

    document.addEventListener("dragover", function (e) {
      var over = closestCls(e.target, "rank-item");
      if (!over) return;
      e.preventDefault();
      setRankOver(over);
      try { e.dataTransfer.dropEffect = "move"; } catch (err) {}
    });

    document.addEventListener("dragleave", function (e) {
      var over = closestCls(e.target, "rank-item");
      if (!over) return;
      if (_overEl === over && (!e.relatedTarget || !over.contains(e.relatedTarget))) clearRankOver();
    });

    document.addEventListener("drop", function (e) {
      clearRankOver();
      var over = closestCls(e.target, "rank-item");
      if (!over) return;
      e.preventDefault();

      var p = dragPayload;
      if (!p) {
        try { p = JSON.parse(e.dataTransfer.getData("application/json")); } catch (err) {}
      }
      if (!p) return;

      var qid = over.getAttribute("data-qid");
      if (!qid || qid !== p.qid) return;

      var toPos = parseInt(over.getAttribute("data-pos"), 10);
      if (isNaN(toPos)) return;

      var q = findQuestion(qid);
      if (!q || q.type !== "ranking") return;

      var order = getRankingState(q);
      _rankingState[qid] = moveInArray(order, p.fromPos, toPos);
      rerenderRankingBoard(q);
    });
  }

  // ─── Layout page rendering (start, results, system.blocked) ──────────────────
  function renderLayoutPage(layoutKey, data) {
    var app = getApp();
    if (!app) return;
    var html = layouts[layoutKey] || layouts["content"] || "";
    if (!html) { app.innerHTML = ""; return; }
    app.innerHTML = renderDsl(html, data);
    fillDataPaths(app, data);
    applyDataAttributes(app);
  }

  /** Applies data-ring-offset → CSS custom property, data-bar-width → fill width. */
  function applyDataAttributes(root) {
    root.querySelectorAll("[data-ring-offset]").forEach(function (el) {
      var v = el.getAttribute("data-ring-offset");
      if (v) el.style.setProperty("--ring-offset", v);
    });
    root.querySelectorAll("[data-bar-width]").forEach(function (el) {
      var v = el.getAttribute("data-bar-width");
      var fill = el.querySelector(".topic-bar-fill");
      if (fill && v) fill.style.width = v + "%";
    });
  }

  // ─── Progress bar ─────────────────────────────────────────────────────────────
  function updateProgress(route) {
    var fill = document.getElementById("tb-progress-fill");
    if (!fill) return;
    var pct = 0;
    if (route === "results") pct = 100;
    else if (route === "start") pct = 0;
    else {
      var routes = (manifest.preview || {}).routes || [];
      for (var i = 0; i < routes.length; i++) {
        if (routes[i].route === route) { pct = Math.round((i / (routes.length - 1)) * 100); break; }
      }
    }
    fill.style.width = pct + "%";
  }

  // ─── Caption ──────────────────────────────────────────────────────────────────
  function updateCaption(label) {
    var el = document.getElementById("pv-caption");
    if (el) el.textContent = label;
  }

  // ─── CSS vars ─────────────────────────────────────────────────────────────────
  function applyTemplateVars() {
    var tb = root.TestBuilder;
    if (!tb || !tb._internal) return;
    var params = demoData.params || paramDefaults();
    var vars = tb._internal.buildCssVarDeclarations(params, manifest.params || []);
    var stage = getStage();
    if (!stage) return;
    // Apply tokens as the RAW HSL components buildCssVarDeclarations returns (matching
    // the real host's buildTemplateCssVars). The template CSS composes them via
    // hsl(var(--token)); wrapping the triple in hsl() here would double-wrap it
    // (hsl(hsl(...)) → invalid), silently killing every hsl(var(--token)) rule.
    Object.keys(vars).forEach(function (name) {
      stage.style.setProperty(name, String(vars[name]));
    });
  }

  // ─── Theme toggle (preview chrome) ──────────────────────────────────────────
  /**
   * Wires the Авто/Светлая/Тёмная segmented control in the preview head: sets
   * data-theme on the document root (Авто removes it → the template follows the
   * host prefers-color-scheme). Only the previewed template (theme.css) reacts;
   * the preview chrome stays neutral.
   */
  function wireThemeToggle() {
    var group = document.getElementById("pv-theme");
    if (!group) return;
    function apply(mode) {
      var el = document.documentElement;
      if (mode === "light" || mode === "dark") el.setAttribute("data-theme", mode);
      else el.removeAttribute("data-theme");
      var btns = group.querySelectorAll(".pv-theme-btn");
      Array.prototype.forEach.call(btns, function (b) {
        b.classList.toggle("pv-theme-active", b.getAttribute("data-theme-set") === mode);
      });
    }
    group.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".pv-theme-btn") : null;
      if (b) apply(b.getAttribute("data-theme-set"));
    });
  }

  // ─── Init ────────────────────────────────────────────────────────────────────
  function init() {
    // Expose TEST_DATA for contentPage.js / renderers.js
    root.TEST_DATA = buildTestData();
    root.advancePageSequence = function () {};

    // Expose a minimal runtime state so the REAL content renderers
    // (renderContentPage / renderGalleryPage / renderSectionIntro) resolve template
    // layouts by key — mirrors production (templateLoader sets these). Without it,
    // content pages fall back to the bare skeleton, which no longer matches the
    // layout-driven runtime.
    root.state = root.state || {};
    root.state.templateLayouts = layouts;
    root.state.currentPageIndex = 0;
    root.state.templateManifest = manifest;
    // Router demo state: per-topic status for the router card map.
    root.state.routerTopicStates = {};
    ((demoData.course || {}).topics || []).forEach(function (t) {
      root.state.routerTopicStates[t.id] =
        t.status === "completed" ? "completed" :
        (t.status === "inProgress" ? "inProgress" : "notStarted");
    });

    // Init TestBuilder CSS vars
    if (root.TestBuilder && root.TestBuilder._init) {
      root.TestBuilder._init(manifest.params || []);
    }

    buildShell();
    applyTemplateVars();
    buildNav();
    wireThemeToggle();

    // Bind interaction handlers once at startup (global document listeners)
    bindChoiceClicksOnce();
    bindMatchingDndOnce();
    bindRankingDndOnce();

    // Navigate to default route
    var defaultRoute = (manifest.preview || {}).defaultRoute || "start";
    navigateTo(defaultRoute, null);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
