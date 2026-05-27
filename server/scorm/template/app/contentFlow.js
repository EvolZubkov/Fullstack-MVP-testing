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

    // Test-scope «До теста» content (intro/info): topicId = null, position 'before'.
    // Rendered before the question stream (PRD-1 §1.9 / BR-02).
    contentPagesFor(null, "before").forEach(function (page) {
      seq.push({ kind: "content", page: page });
    });

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
      state.phase = "content";
      return;
    }
    state.phase = "question";
    state.currentIndex = item.questionIndex;
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
