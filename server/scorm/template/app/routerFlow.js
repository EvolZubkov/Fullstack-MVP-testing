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
   * PRD-4 v1.1 §4.7: evaluates whether `section` is unlocked given the
   * current routerTopicStates. Reads `flowPolicy.sectionUnlockRules`
   * (per-section rule keyed by topicId). Default rule is `always`.
   *
   * Supported rule modes:
   *   - { mode: "always" }                                   — unconditional
   *   - { mode: "after_sections_completed", sectionIds: [] } — all listed
   *     sections must be in 'completed' state (any achievedLevel/result)
   *   - { mode: "after_sections_passed", sectionIds: [] }    — same, but
   *     sectionResults[id].passed must be true (or null when the section
   *     has no pass rule; null is treated as passed in this MVP)
   */
  function isSectionUnlocked(section) {
    var rules =
      (TEST_DATA.flowPolicy && TEST_DATA.flowPolicy.sectionUnlockRules) || {};
    var rule = rules[section.topicId];
    if (!rule || !rule.mode || rule.mode === "always") return true;
    if (rule.mode === "after_sections_completed") {
      return (rule.sectionIds || []).every(function (id) {
        return state.routerTopicStates[id] === "completed";
      });
    }
    if (rule.mode === "after_sections_passed") {
      return (rule.sectionIds || []).every(function (id) {
        if (state.routerTopicStates[id] !== "completed") return false;
        var result = state.sectionResults && state.sectionResults[id];
        // null passed (no passRule) is treated as passed for navigation;
        // strict pass mode would reject it — see PRD-4 §4.6.
        return !result || result.passed !== false;
      });
    }
    return true; // Unknown rule mode: fail-open (don't block the learner).
  }

  /**
   * PRD-4 v1.1 §4.7: evaluates whether the router can show «Завершить».
   * Reads `flowPolicy.routerCompletionPolicy` (default
   * 'all_required_completed'). Optional sections never block completion.
   */
  function isRouterReadyToFinish() {
    var policy =
      (TEST_DATA.flowPolicy && TEST_DATA.flowPolicy.routerCompletionPolicy) ||
      "all_required_completed";
    var requiredSections = (TEST_DATA.sections || []).filter(function (s) {
      return s.required !== false;
    });
    if (requiredSections.length === 0) {
      // No required sections — learner can finish at any time.
      return true;
    }
    return requiredSections.every(function (s) {
      if (state.routerTopicStates[s.topicId] !== "completed") return false;
      if (policy === "all_required_passed") {
        var result = state.sectionResults && state.sectionResults[s.topicId];
        // No-result safeguard: treat as not-passed under strict policy.
        if (!result) return false;
        // null `passed` (no passRule) → not strictly passed under the
        // 'all_required_passed' policy; author must define passRules to
        // use this policy.
        return result.passed === true;
      }
      // all_required_completed: any completion is sufficient.
      return true;
    });
  }

  /**
   * Renders the router page using the existing renderContentPage flow and
   * then augments the resulting DOM with clickable topic cards. The card
   * list reads TEST_DATA.sections (topic order, name) and per-topic state
   * from state.routerTopicStates. Phase 4c-iv adds `locked` state from
   * sectionUnlockRules and gates «Завершить» behind
   * routerCompletionPolicy.
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
      var unlocked = isSectionUnlocked(section);
      var lockedClass = !unlocked && status !== "completed" ? " router-topic-card--locked" : "";
      var card = document.createElement("button");
      card.type = "button";
      card.className =
        "router-topic-card router-topic-card--" + status + lockedClass;
      card.setAttribute("role", "listitem");
      card.setAttribute("data-topic-id", section.topicId);
      card.setAttribute("data-router-status", status);
      if (!unlocked) card.setAttribute("data-router-locked", "true");
      // Completed cards stay disabled to prevent re-entry; locked cards are
      // disabled because their unlock-rule prerequisites aren't met yet.
      card.disabled = status === "completed" || !unlocked;
      card.innerHTML =
        '<span class="router-topic-card__name">' +
        escapeHtml(section.topicName || section.topicId) +
        (section.required === false
          ? ' <span class="router-topic-card__optional">(необязательная)</span>'
          : "") +
        "</span>" +
        '<span class="router-topic-card__status">' +
        escapeHtml(unlocked ? statusLabel(status) : "Недоступна") +
        "</span>";
      card.onclick = function () {
        if (card.disabled) return;
        selectRouterTopic(section.topicId);
      };
      cards.appendChild(card);
    });

    app.appendChild(cards);

    // PRD-4 v1.1 §4.7: «Завершить» is gated by routerCompletionPolicy
    // (all required sections completed, optionally also passed). Optional
    // sections never block.
    if (isRouterReadyToFinish()) {
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
   * Marks the topic as in-progress and starts the topic's runtime. In
   * standard mode this is a linear chunk (before_topic content → questions
   * → after_topic content). In adaptive mode (PRD-4 v1.1 §4.7), a
   * single-topic adaptive session takes over — content pages around the
   * adaptive session are NOT rendered in this slice (Phase 4d-iii adds
   * that for the (adaptive, linear_by_topics) combo; router adaptive
   * fires the engine directly and returns to router on completion).
   * Picking a completed topic is a no-op (button also disabled).
   */
  function selectRouterTopic(topicId) {
    if (!isRouterMode()) return;
    if (state.routerTopicStates[topicId] === "completed") return;
    state.routerTopicStates[topicId] = "inProgress";
    state.currentRouterTopic = topicId;

    // PRD-4 v1.1 §3.2 (Phase 4e): start the per-section timer on entry.
    // Stopped by returnFromTopic (normal completion) or by the timer's
    // own expiry handler. Sections without a custom limit (null/inherit_test)
    // skip startSectionTimer's no-op early return.
    var section = (TEST_DATA.sections || []).find(function (s) {
      return s.topicId === topicId;
    });
    if (
      section &&
      section.timeLimitMinutes &&
      typeof startSectionTimer === "function"
    ) {
      startSectionTimer(topicId, section.timeLimitMinutes, function () {
        // On expiry mark the topic completed (with whatever was answered)
        // and return to the router. The completion still feeds the
        // sectionResults snapshot via Phase 4b on the next render — for
        // adaptive sessions the AdaptiveSession callback has already
        // populated it.
        returnFromTopic();
      });
    }

    // PRD-4 v1.1 §4.7: adaptive + router_by_topics — launch a single-topic
    // adaptive session via the AdaptiveSession wrapper. On completion
    // (engine's «all topics done» branch fires the callback), freeze the
    // topic's achievedLevel in sectionResults and return to router.
    if (
      TEST_DATA.mode === "adaptive" &&
      typeof AdaptiveSession !== "undefined" &&
      AdaptiveSession.runAdaptiveSession
    ) {
      var ok = AdaptiveSession.runAdaptiveSession(topicId, function (topicResult) {
        // topicResult is the adaptive engine's per-topic entry:
        // { topicId, topicName, finalLevelIndex, finalLevelName,
        //   answeredQuestions, achievedLevel, passed, ... }
        // Mirror onto sectionResults for templates that bind
        // data-path="section.current.result.*" (consistent with Phase 4b).
        if (topicResult) {
          if (!state.sectionResults) state.sectionResults = {};
          state.sectionResults[topicId] = topicResult;
        }
        returnFromTopic();
      });
      if (!ok) {
        // Defensive: strict gating (Phase 1 L2/L3) should prevent this,
        // but if a malformed package reaches the runtime, fall back to a
        // standard topic chunk so the learner can still navigate.
        console.warn(
          "[PRD-4] Adaptive session for topic " +
            topicId +
            " failed to start (no levels?). Falling back to standard topic chunk.",
        );
        state.pageSequence = buildTopicChunk(topicId);
        state.currentPageIndex = 0;
        if (typeof syncPhaseToCurrentPage === "function") syncPhaseToCurrentPage();
        if (typeof render === "function") render();
      }
      return;
    }

    // Standard mode (mode='standard', router_by_topics): linear topic chunk.
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
    // PRD-4 v1.1 §3.2 (Phase 4e): tear down the per-section timer regardless
    // of whether it fired naturally or the learner finished the section
    // ahead of time. Safe to call when no timer is active.
    if (typeof stopSectionTimer === "function") stopSectionTimer();
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
    isSectionUnlocked: isSectionUnlocked,
    isRouterReadyToFinish: isRouterReadyToFinish,
  };
  root.selectRouterTopic = selectRouterTopic;
  root.returnFromTopic = returnFromTopic;
  root.finishRouter = finishRouter;
})(typeof window !== "undefined" ? window : global);
