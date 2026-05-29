/**
 * @module routerFlow
 * @description PRD-4 v1.1 §4.7 router_by_topics runtime: state machine
 * around the linear pageSequence. Loaded only when
 * `TEST_DATA.flowPolicy.mode === "router_by_topics"`.
 *
 * Learner flow:
 *   1. Test-before content pages run linearly (existing pageSequence logic).
 *   2. Router page renders; learner picks a topic card.
 *   3. {@link selectRouterTopic} swaps pageSequence to that topic's chunk
 *      (before_topic content → questions → after_topic content).
 *   4. {@link returnFromTopic} fires when the chunk's last page advances;
 *      marks the topic completed, re-enters the router page.
 *   5. When `routerCompletionPolicy` is satisfied, {@link finishRouter}
 *      switches to the post-router sequence (test-after + results).
 *
 * Phase 4c-ii/iii contract. Phase 4c-iv adds completion policy + unlock
 * rules. Phase 4d wires adaptive sessions inside topic chunks.
 */
(function (root) {
  "use strict";

  /**
   * True if the test runs in router_by_topics mode and the router runtime
   * should take over navigation. Other modes ignore this module.
   */
  function isRouterMode() {
    return (
      typeof TEST_DATA !== "undefined" &&
      TEST_DATA.flowPolicy &&
      TEST_DATA.flowPolicy.mode === "router_by_topics"
    );
  }

  /**
   * Lists the questions for a single topic in the order generateVariant
   * produced them (which, in router/linear-by-topics modes, preserves
   * section order). The mapping back to flatQuestions index is what
   * downstream answer/feedback flow expects.
   */
  function indicesForTopic(topicId) {
    var out = [];
    for (var i = 0; i < state.flatQuestions.length; i++) {
      if (state.flatQuestions[i].topicId === topicId) out.push(i);
    }
    return out;
  }

  /** Lists per-topic content pages at the given position, in sortOrder. */
  function contentPagesForRouter(topicId, position) {
    return (TEST_DATA.contentPages || [])
      .filter(function (p) {
        return p.topicId === topicId && p.position === position;
      })
      .sort(function (a, b) {
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });
  }

  /**
   * Builds the pageSequence chunk for one topic: before_topic content →
   * questions for that topic → after_topic content. Reused by
   * {@link selectRouterTopic} every time the learner picks a topic.
   */
  function buildTopicChunk(topicId) {
    var seq = [];
    contentPagesForRouter(topicId, "before_topic").forEach(function (page) {
      seq.push({ kind: "content", page: page });
    });
    indicesForTopic(topicId).forEach(function (questionIndex) {
      seq.push({ kind: "question", questionIndex: questionIndex });
    });
    contentPagesForRouter(topicId, "after_topic").forEach(function (page) {
      seq.push({ kind: "content", page: page });
    });
    return seq;
  }

  /**
   * Builds the post-router test-end sequence: test-scope «after» content,
   * with the same summary-boundary semantics as the existing
   * rebuildPageSequence logic (a `summary` page splits pre-results vs
   * post-results pages).
   */
  function buildPostRouterSequence() {
    var seq = [];
    var postResults = [];
    var seenSummary = false;
    (TEST_DATA.contentPages || [])
      .filter(function (p) { return p.topicId === null && p.position === "after"; })
      .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); })
      .forEach(function (page) {
        if (page.type === "summary") { seenSummary = true; return; }
        if (seenSummary) postResults.push(page);
        else seq.push({ kind: "content", page: page });
      });
    state.postResultsPages = postResults;
    return seq;
  }

  /**
   * Renders the router page using the existing renderContentPage flow and
   * then augments the resulting DOM with clickable topic cards. The card
   * list reads TEST_DATA.sections (topic order, name) and per-topic state
   * from state.routerTopicStates. Phase 4c-iv will gate cards by
   * sectionUnlockRules + add the «Завершить» action.
   */
  function renderRouterPage(page) {
    var manifest = state.templateManifest || {};
    if (typeof renderContentPage === "function") {
      renderContentPage(page, manifest.contentTemplates || []);
    }
    var app = document.getElementById("app");
    if (!app) return;
    var existing = app.querySelector(".router-topic-cards");
    if (existing) existing.parentNode.removeChild(existing);

    var cards = document.createElement("div");
    cards.className = "router-topic-cards";
    cards.setAttribute("role", "list");
    cards.setAttribute("aria-label", "Доступные темы");

    (TEST_DATA.sections || []).forEach(function (section) {
      var status = state.routerTopicStates[section.topicId] || "notStarted";
      var card = document.createElement("button");
      card.type = "button";
      card.className = "router-topic-card router-topic-card--" + status;
      card.setAttribute("role", "listitem");
      card.setAttribute("data-topic-id", section.topicId);
      card.setAttribute("data-router-status", status);
      card.disabled = status === "completed";
      card.innerHTML =
        '<span class="router-topic-card__name">' +
        escapeHtml(section.topicName || section.topicId) +
        "</span>" +
        '<span class="router-topic-card__status">' +
        escapeHtml(statusLabel(status)) +
        "</span>";
      card.onclick = function () {
        if (status === "completed") return;
        selectRouterTopic(section.topicId);
      };
      cards.appendChild(card);
    });

    app.appendChild(cards);

    // Phase 4c-iv adds the «Завершить» action and completionPolicy gating.
    // For now we surface a small hint so the learner sees the unfinished
    // state and the developer sees the integration point.
    var allDone = (TEST_DATA.sections || []).every(function (s) {
      return state.routerTopicStates[s.topicId] === "completed";
    });
    if (allDone) {
      var finishBtn = document.createElement("button");
      finishBtn.type = "button";
      finishBtn.className = "btn router-finish";
      finishBtn.setAttribute("data-action", "router-finish");
      finishBtn.textContent = "Завершить тест";
      finishBtn.onclick = finishRouter;
      app.appendChild(finishBtn);
    }
  }

  function statusLabel(status) {
    if (status === "completed") return "Пройдена";
    if (status === "inProgress") return "В процессе";
    return "Не начата";
  }

  /**
   * Marks the topic as in-progress, swaps pageSequence to that topic's
   * chunk, resets the index, and re-renders. Called from a router-card
   * click handler. Idempotent — picking a completed topic is a no-op
   * (the button is also disabled).
   */
  function selectRouterTopic(topicId) {
    if (!isRouterMode()) return;
    if (state.routerTopicStates[topicId] === "completed") return;
    state.routerTopicStates[topicId] = "inProgress";
    state.currentRouterTopic = topicId;
    state.pageSequence = buildTopicChunk(topicId);
    state.currentPageIndex = 0;
    if (typeof syncPhaseToCurrentPage === "function") syncPhaseToCurrentPage();
    if (typeof render === "function") render();
  }

  /**
   * Called by `advancePageSequence` when the learner finishes the last
   * page of a topic chunk. Freezes the topic state as completed and
   * re-enters the router page so the learner picks the next topic (or
   * triggers «Завершить» if completionPolicy is satisfied).
   */
  function returnFromTopic() {
    if (!isRouterMode()) return;
    var topicId = state.currentRouterTopic;
    if (topicId) {
      state.routerTopicStates[topicId] = "completed";
    }
    state.currentRouterTopic = null;
    // Find and re-enter the router page (typically before/topicId=null).
    var routerPage = (TEST_DATA.contentPages || []).find(function (p) {
      return p.kind === "router";
    });
    if (!routerPage) {
      // No router page declared; fall through to finish.
      finishRouter();
      return;
    }
    state.pageSequence = [{ kind: "content", page: routerPage, isRouter: true }];
    state.currentPageIndex = 0;
    state.phase = "router";
    if (typeof render === "function") render();
  }

  /**
   * Triggered by the «Завершить тест» action on the router. Switches the
   * page sequence to the post-router test-end content (test-scope after,
   * minus the summary boundary which gates post-results). Then advances
   * to the first page; the existing post-results infrastructure handles
   * pages after the summary boundary.
   */
  function finishRouter() {
    if (!isRouterMode()) return;
    state.routerFinished = true;
    state.currentRouterTopic = null;
    var postRouter = buildPostRouterSequence();
    if (postRouter.length === 0) {
      // No test-scope after content (other than maybe a summary) →
      // submit and let the existing results flow take over.
      if (typeof submit === "function") submit(true);
      return;
    }
    state.pageSequence = postRouter;
    state.currentPageIndex = 0;
    if (typeof syncPhaseToCurrentPage === "function") syncPhaseToCurrentPage();
    if (typeof render === "function") render();
  }

  root.RouterFlow = {
    isRouterMode: isRouterMode,
    buildTopicChunk: buildTopicChunk,
    buildPostRouterSequence: buildPostRouterSequence,
    renderRouterPage: renderRouterPage,
    selectRouterTopic: selectRouterTopic,
    returnFromTopic: returnFromTopic,
    finishRouter: finishRouter,
  };
  root.selectRouterTopic = selectRouterTopic;
  root.returnFromTopic = returnFromTopic;
  root.finishRouter = finishRouter;
})(typeof window !== "undefined" ? window : global);
