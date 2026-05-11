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

  root.rebuildPageSequence = rebuildPageSequence;
  root.currentPageItem = currentPageItem;
  root.syncPhaseToCurrentPage = syncPhaseToCurrentPage;
  root.goToPageSequenceIndex = goToPageSequenceIndex;
  root.advancePageSequence = advancePageSequence;
  root.pageProgressPercent = pageProgressPercent;
  root.getProgressMode = getProgressMode;
})(typeof window !== "undefined" ? window : global);
