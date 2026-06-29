/**
 * @module contentFlow
 * Builds and navigates a mixed sequence of content pages and questions.
 */
(function (root) {
  "use strict";

  function contentPagesFor(topicId, position) {
    return (TEST_DATA.contentPages || [])
      .filter(function (p) {
        // `kind: "start"`/`"results"` are the landing and final-results screens,
        // rendered separately by their own runtimes — they must never enter the
        // content-page flow sequence.
        return p.kind !== "start" && p.kind !== "results"
          && p.topicId === topicId && p.position === position;
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

    // PRD-4 v1.1 §4.6 (adaptive, linear_by_topics): per-topic question stretch
    // is replaced by a single `{kind: "adaptive-session", topicId}` marker.
    // syncPhaseToCurrentPage launches AdaptiveSession.runAdaptiveSession on
    // entry; on completion the callback advances pageSequence past the
    // marker into that topic's after_topic content. Test-scope «after» is
    // handled by the same legacy summary-boundary logic.
    if (flowMode === "linear_by_topics" && TEST_DATA.mode === "adaptive") {
      (TEST_DATA.sections || []).forEach(function (section) {
        contentPagesFor(section.topicId, "before_topic").forEach(function (page) {
          seq.push({ kind: "content", page: page });
        });
        seq.push({ kind: "adaptive-session", topicId: section.topicId });
        contentPagesFor(section.topicId, "after_topic").forEach(function (page) {
          seq.push({ kind: "content", page: page });
        });
      });
      var seenSummaryAdaptive = false;
      var postResultsAdaptive = [];
      contentPagesFor(null, "after").forEach(function (page) {
        if (page.type === "summary") { seenSummaryAdaptive = true; return; }
        if (seenSummaryAdaptive) postResultsAdaptive.push(page);
        else seq.push({ kind: "content", page: page });
      });
      state.postResultsPages = postResultsAdaptive;
      state.pageSequence = seq;
      state.currentPageIndex = Math.min(state.currentPageIndex || 0, Math.max(seq.length - 1, 0));
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
    // PRD-4 v1.1 §3.2: maintain per-section timer alongside phase changes.
    // Started on topic-entry (first content/question/adaptive-session item
    // carrying this topicId), stopped when transitioning to a different
    // topic or to the test-end content / results.
    maybeUpdateSectionTimer(item);
    maybeFreezeSectionOnExit(item);
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
    // PRD-4 v1.1 §4.6 (adaptive, linear_by_topics): adaptive-session marker
    // — launch the topic's single-topic adaptive session. The engine takes
    // over rendering (renderAdaptive) until the topic completes; the
    // onComplete callback freezes sectionResults and advances pageSequence
    // past the marker so the next page (after_topic content) renders.
    if (item.kind === "adaptive-session") {
      state.phase = "adaptive-session";
      maybeLaunchAdaptiveSession(item);
      return;
    }
    state.phase = "question";
    state.currentIndex = item.questionIndex;
  }

  /**
   * PRD-4 v1.1 §3.2 (Phase 4e) — section timer lifecycle hook.
   *
   * Determines whether the current pageSequence item belongs to a section
   * different from the one we just left, and starts / stops the section
   * timer accordingly. Reads section.timeLimitMinutes from TEST_DATA.sections.
   *
   * Topic detection per item kind:
   *   - content    → item.page.topicId (null for test-scope pages)
   *   - question   → state.flatQuestions[item.questionIndex].topicId
   *   - adaptive-session → item.topicId
   *
   * Items without a topicId (router page, test-before, test-after) stop
   * any running section timer — the learner is no longer inside a section.
   *
   * Expiry callback skips past the remaining items of the section so the
   * learner lands on the next topic's first item (or test-end). Section
   * result is still computed by maybeExposeSectionResult on the next
   * after_topic entry; expired sections fall back to whatever partial
   * answers exist in state.answers / state.adaptiveState.
   */
  function maybeUpdateSectionTimer(item) {
    var currentTopicId = topicIdForItem(item);
    var runningTopicId =
      state.sectionTimer && state.sectionTimer.topicId
        ? state.sectionTimer.topicId
        : null;
    if (runningTopicId === currentTopicId) return; // same section — keep running
    if (typeof stopSectionTimer === "function") stopSectionTimer();
    if (!currentTopicId) return; // outside any section (test-scope/router page)
    var section = (TEST_DATA.sections || []).find(function (s) {
      return s.topicId === currentTopicId;
    });
    if (!section || !section.timeLimitMinutes || section.timeLimitMinutes <= 0) {
      return; // section has no limit (inherit_test or none)
    }
    if (typeof startSectionTimer === "function") {
      startSectionTimer(currentTopicId, section.timeLimitMinutes, function (expiredTopicId) {
        // Skip forward past the rest of this section's items.
        skipSectionFromCurrent(expiredTopicId);
      });
    }
  }

  /** Extracts the topicId associated with a pageSequence item, or null. */
  function topicIdForItem(item) {
    if (!item) return null;
    if (item.kind === "content" && item.page) return item.page.topicId || null;
    if (item.kind === "adaptive-session") return item.topicId || null;
    if (item.kind === "question") {
      var fq = state.flatQuestions[item.questionIndex];
      return fq ? fq.topicId : null;
    }
    return null;
  }

  /**
   * Advance pageSequence past every item belonging to `topicId`. Used by
   * the section-timer expiry handler. Stops at the first item of a
   * different topic (or test-scope) and re-enters that item via
   * syncPhaseToCurrentPage + render, so its timer / phase logic fires.
   */
  function skipSectionFromCurrent(topicId) {
    if (!state.pageSequence) return;
    var i = state.currentPageIndex || 0;
    while (
      i < state.pageSequence.length &&
      topicIdForItem(state.pageSequence[i]) === topicId
    ) {
      i++;
    }
    if (i >= state.pageSequence.length) {
      // Section was the last in the sequence — submit the attempt.
      if (typeof submit === "function") submit(true);
      return;
    }
    state.currentPageIndex = i;
    syncPhaseToCurrentPage();
    if (typeof render === "function") render();
  }

  /**
   * PRD-4 v1.1 §4.6: starts the single-topic adaptive session for an
   * adaptive-session marker item. Idempotent — re-entering the same item
   * (e.g. after a re-render) does not restart a session already in flight
   * (state.adaptiveState already non-null).
   */
  function maybeLaunchAdaptiveSession(item) {
    if (!item || item.kind !== "adaptive-session") return;
    if (state.adaptiveState) return; // session already running for this marker
    if (typeof AdaptiveSession === "undefined" || !AdaptiveSession.runAdaptiveSession) {
      // No AdaptiveSession loaded — strict gating should prevent this, but
      // defend in depth by skipping the marker so navigation can continue.
      advancePageSequence();
      return;
    }
    var topicId = item.topicId;
    var ok = AdaptiveSession.runAdaptiveSession(topicId, function (topicResult) {
      // Freeze the per-topic adaptive result for templates bound to
      // section.current.result.* (consistent with Phase 4b sectionResults).
      if (topicResult) {
        if (!state.sectionResults) state.sectionResults = {};
        state.sectionResults[topicId] = topicResult;
      }
      // Advance past the adaptive-session marker into the next page
      // (typically the topic's first after_topic content page, then the
      // next topic's before_topic content / adaptive-session, etc).
      advancePageSequence();
    });
    if (!ok) {
      // Defensive: skip the marker so the learner can still traverse the
      // rest of the test (after_topic content + next topic).
      console.warn(
        "[PRD-4] Adaptive session for topic " +
          topicId +
          " failed to start; advancing past marker.",
      );
      advancePageSequence();
    }
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

  /**
   * PRD-19 (Block B / B4-freeze): when answerCommitScope === 'section', freeze a
   * section's answers on exit so they can no longer be edited (isAnswerLocked in
   * answers.js reads state.sectionCommitted). Detects the section boundary the
   * same way the section timer does — a change in the item's topicId — so it
   * works even for sections without an after_topic content page. Flat / adaptive
   * tests (scope 'test') keep answers editable until submit and are skipped here.
   * state.activeSectionTopic tracks the section currently being traversed; it is
   * transient (re-derived after a restore, while sectionCommitted is persisted).
   */
  function maybeFreezeSectionOnExit(item) {
    if (typeof TEST_DATA === "undefined" || TEST_DATA.answerCommitScope !== "section") return;
    var currentTopicId = topicIdForItem(item);
    var prev = state.activeSectionTopic || null;
    if (prev === currentTopicId) return; // still inside the same section
    if (prev) {
      if (!state.sectionCommitted) state.sectionCommitted = {};
      state.sectionCommitted[prev] = true;
    }
    state.activeSectionTopic = currentTopicId || null;
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
