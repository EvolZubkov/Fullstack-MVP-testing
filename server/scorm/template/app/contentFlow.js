/**
 * @module contentFlow
 * Builds and navigates a mixed sequence of content pages and questions.
 */
(function (root) {
  "use strict";

  function contentPagesFor(topicId, position) {
    return (TEST_DATA.contentPages || [])
      .filter(function (p) {
        return p.topicId === topicId && p.position === position;
      })
      .sort(function (a, b) {
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });
  }

  function rebuildPageSequence() {
    var seq = [];
    var flowMode =
      (TEST_DATA && TEST_DATA.flowPolicy && TEST_DATA.flowPolicy.mode) ||
      "linear_flat";

    // Test-scope «До теста» content (intro/info): topicId = null, position 'before'.
    // Rendered before the question stream (PRD-1 §1.9 / BR-02). Items with
    // `page.kind === "router"` carry an `isRouter` flag so the router runtime
    // can intercept navigation (Phase 4c).
    contentPagesFor(null, "before").forEach(function (page) {
      seq.push({
        kind: "content",
        page: page,
        isRouter: page.kind === "router",
      });
    });

    // PRD-4 v1.1 §4.7 router_by_topics: in router mode the linear sequence
    // stops here — the router page becomes the hub. Topic chunks are built
    // on demand by RouterFlow.selectRouterTopic when the learner picks a
    // card; test-scope «after» content is built by RouterFlow.finishRouter.
    if (flowMode === "router_by_topics") {
      state.pageSequence = seq;
      state.currentPageIndex = 0;
      state.postResultsPages = [];
      return seq;
    }

    var remainingByTopic = {};
    var startedTopic = {};

    state.flatQuestions.forEach(function (fq) {
      remainingByTopic[fq.topicId] = (remainingByTopic[fq.topicId] || 0) + 1;
    });

    state.flatQuestions.forEach(function (fq, questionIndex) {
      if (!startedTopic[fq.topicId]) {
        startedTopic[fq.topicId] = true;
        contentPagesFor(fq.topicId, "before_topic").forEach(function (page) {
          seq.push({ kind: "content", page: page });
        });
      }

      seq.push({ kind: "question", questionIndex: questionIndex });
      remainingByTopic[fq.topicId] -= 1;

      if (remainingByTopic[fq.topicId] === 0) {
        contentPagesFor(fq.topicId, "after_topic").forEach(function (page) {
          seq.push({ kind: "content", page: page });
        });
      }
    });

    // Test-scope «После теста» content: topicId = null, position 'after'.
    // The first `summary` page marks the results boundary — the built-in results
    // screen IS the score page. Pages before it render before results
    // (pre-results); pages after it are deferred to `state.postResultsPages`
    // and rendered after the results screen.
    var seenSummary = false;
    var postResults = [];
    contentPagesFor(null, "after").forEach(function (page) {
      if (page.type === "summary") { seenSummary = true; return; }
      if (seenSummary) postResults.push(page);
      else seq.push({ kind: "content", page: page });
    });
    state.postResultsPages = postResults;

    state.pageSequence = seq;
    state.currentPageIndex = Math.min(state.currentPageIndex || 0, Math.max(seq.length - 1, 0));
    return seq;
  }

  function currentPageItem() {
    if (!state.pageSequence || state.pageSequence.length === 0) rebuildPageSequence();
    return state.pageSequence[state.currentPageIndex || 0] || null;
  }

  function syncPhaseToCurrentPage() {
    var item = currentPageItem();
    if (!item) {
      state.phase = "question";
      return;
    }
    if (item.kind === "content") {
      // PRD-4 v1.1 §4.7: router pages enter the dedicated 'router' phase
      // so mainRender.js routes to RouterFlow.renderRouterPage.
      state.phase = item.isRouter ? "router" : "content";
      // PRD-4 v1.1 §4.4: when entering the first `after_topic` content page
      // for a topic, compute and freeze that section's result so templates
      // bound to TEST_DATA.section.current.result.* see correct data.
      maybeExposeSectionResult(item);
      return;
    }
    state.phase = "question";
    state.currentIndex = item.questionIndex;
  }

  /**
   * PRD-4 v1.1 §4.4: if the current content page belongs to a topic and
   * carries `position === "after_topic"`, compute (or read cached) section
   * result and expose it on TEST_DATA.section.current. Templates can bind
   * via `data-path="section.current.result.percent"` (or `passed`, etc.).
   */
  function maybeExposeSectionResult(item) {
    if (!item || item.kind !== "content" || !item.page) return;
    var page = item.page;
    if (!page.topicId || page.position !== "after_topic") return;
    if (typeof computeSectionResult !== "function") return;
    var result = computeSectionResult(page.topicId);
    if (typeof TEST_DATA === "undefined") return;
    if (!TEST_DATA.section) TEST_DATA.section = {};
    TEST_DATA.section.current = {
      topicId: page.topicId,
      topicName: result.topicName,
      result: result,
    };
  }

  function goToPageSequenceIndex(index) {
    if (!state.pageSequence || state.pageSequence.length === 0) rebuildPageSequence();
    state.currentPageIndex = Math.max(0, Math.min(index, Math.max(state.pageSequence.length - 1, 0)));
    syncPhaseToCurrentPage();
  }

  function advancePageSequence() {
    if (!state.pageSequence || state.pageSequence.length === 0) rebuildPageSequence();
    if (state.currentPageIndex < state.pageSequence.length - 1) {
      state.currentPageIndex += 1;
      syncPhaseToCurrentPage();
      render();
      return;
    }
    // PRD-4 v1.1 §4.7: in router mode the «end» of the current sequence is
    // either the end of a topic chunk (return to router) or the end of the
    // post-router test-end sequence (submit). RouterFlow.returnFromTopic
    // handles both: it marks the topic completed and re-renders the router,
    // unless the learner has already triggered «Завершить» (routerFinished).
    if (
      typeof RouterFlow !== "undefined" &&
      RouterFlow.isRouterMode() &&
      state.currentRouterTopic
    ) {
      RouterFlow.returnFromTopic();
      return;
    }
    submit(true);
  }

  function pageProgressPercent() {
    if (!state.pageSequence || state.pageSequence.length === 0) rebuildPageSequence();
    if (!state.pageSequence.length) return 0;
    return ((state.currentPageIndex + 1) / state.pageSequence.length) * 100;
  }

  function getProgressMode() {
    var params = (TEST_DATA.designSettings && TEST_DATA.designSettings.params) || {};
    return params["progress.mode"] || "questions";
  }

  // ─── Post-results content (test-scope «После теста» pages after the summary) ──
  // These render AFTER the built-in results screen. They reuse renderContentPage
  // for the body and override its default (pageSequence) navigation.

  function enterPostResults() {
    state.postResultsIndex = 0;
    state.phase = "postResults";
    render();
  }

  function nextPostResults() {
    state.postResultsIndex = (state.postResultsIndex || 0) + 1;
    if (state.postResultsIndex >= (state.postResultsPages || []).length) {
      finishAndClose();
      return;
    }
    render();
  }

  function renderPostResults() {
    var pages = state.postResultsPages || [];
    var idx = state.postResultsIndex || 0;
    var page = pages[idx];
    if (!page) { finishAndClose(); return; }
    var manifest = state.templateManifest || {};
    renderContentPage(page, manifest.contentTemplates || []);
    // Replace the content page's default «Далее» (which advances pageSequence)
    // with post-results navigation: «Далее» through the pages, then «Завершить».
    var app = document.getElementById("app");
    var nav = app ? app.querySelector(".navigation") : null;
    if (nav) {
      nav.innerHTML = idx >= pages.length - 1
        ? '<button class="btn" data-action="test-finish" onclick="finishAndClose()">Завершить тест</button>'
        : '<button class="btn" data-nav="next" onclick="nextPostResults()">Далее</button>';
    }
  }

  root.rebuildPageSequence = rebuildPageSequence;
  root.enterPostResults = enterPostResults;
  root.nextPostResults = nextPostResults;
  root.renderPostResults = renderPostResults;
  root.currentPageItem = currentPageItem;
  root.syncPhaseToCurrentPage = syncPhaseToCurrentPage;
  root.goToPageSequenceIndex = goToPageSequenceIndex;
  root.advancePageSequence = advancePageSequence;
  root.pageProgressPercent = pageProgressPercent;
  root.getProgressMode = getProgressMode;
})(typeof window !== "undefined" ? window : global);
