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

  /**
   * Builds the pageSequence chunk for one topic: before_topic content →
   * questions for that topic → after_topic content. Reused by
   * {@link selectRouterTopic} every time the learner picks a topic.
   *
   * Delegates to the shared builder (`shared/flow/page-sequence`, exposed as
   * `TBTemplate`) so a topic chunk here is assembled by exactly the same rules
   * as the linear flow and the web host — including the filter that keeps system
   * design-bindings (`questions`, `start`, `results`) and PRD-19 section nodes
   * out of the sequence, which is what stops a blank «Далее» page appearing at
   * the section start.
   */
  function buildTopicChunk(topicId) {
    return TBTemplate.buildTopicChunk(
      TEST_DATA.contentPages,
      topicId,
      indicesForTopic(topicId),
    );
  }

  /**
   * Builds the post-router test-end sequence: test-scope «after» content, split
   * at the `summary` boundary (pages past it are deferred to
   * state.postResultsPages and render after the results screen).
   */
  function buildPostRouterSequence() {
    var after = TBTemplate.buildAfterZone(TEST_DATA.contentPages);
    state.postResultsPages = after.postResultsPages;
    return after.preResults;
  }

  /** The hub state the shared rules read (topic states + frozen results + policy). */
  function hubState() {
    return {
      topicStates: state.routerTopicStates || {},
      sectionResults: state.sectionResults || {},
      unlockRules: (TEST_DATA.flowPolicy && TEST_DATA.flowPolicy.sectionUnlockRules) || {},
      completionPolicy:
        (TEST_DATA.flowPolicy && TEST_DATA.flowPolicy.routerCompletionPolicy) || null,
    };
  }

  /** PRD-4 v1.1 §4.7 — delegated to shared/flow/router-hub (single source). */
  function isSectionUnlocked(section) {
    return TBTemplate.isSectionUnlocked(section, hubState());
  }

  /** PRD-4 v1.1 §4.7 — delegated to shared/flow/router-hub (single source). */
  function isRouterReadyToFinish() {
    return TBTemplate.isRouterReadyToFinish(TEST_DATA.sections || [], hubState());
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
    // The router hub is the test-entry menu — the attempt subtitle ("Попытка N")
    // belongs on the in-attempt screens, not on the section menu. Drop it.
    var sub = app.querySelector(".tb-scene__subtitle");
    if (sub && sub.parentNode) sub.parentNode.removeChild(sub);
    // The router is a HUB, but «Завершить» belongs in the STANDARD footer, in the
    // usual navigation slot — the content wrapper's own primary button, repurposed
    // below (label + gating + handler). Drop only the fallback `.navigation` block
    // (the no-layout branch of renderContentPage), which would duplicate it.
    var nav = app.querySelector(".navigation");
    if (nav && nav.parentNode) nav.parentNode.removeChild(nav);
    // Cards live INSIDE the content wrapper's page-content slot — the SAME DOM the
    // preview builds — so the run and the structure preview look identical.
    var host = app.querySelector('[data-slot="page-content"]') || app;
    // Cards / progress / «Завершить» come from the SHARED builder — the same
    // markup and the same open/locked rules the web host renders, so a section
    // cannot be clickable in one runtime and dead in the other.
    var prev = host.querySelector(".router-hub");
    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
    var hub = document.createElement("div");
    hub.className = "router-hub";
    hub.innerHTML = TBTemplate.buildRouterHubHtml(TEST_DATA.sections || [], hubState(), {
      deadline: TEST_DATA.deadline || null,
    });
    host.appendChild(hub);

    // Delegate the builder's data-action contract onto this runtime's handlers.
    Array.prototype.forEach.call(
      hub.querySelectorAll('[data-action]'),
      function (el) {
        var action = el.getAttribute("data-action") || "";
        if (action.indexOf("router-select:") === 0) {
          var topicId = action.slice("router-select:".length);
          el.onclick = function () { selectRouterTopic(topicId); };
        } else if (action === "router-finish") {
          el.onclick = finishRouter;
        }
      },
    );

    var ready = isRouterReadyToFinish();

    // «Завершить» in the standard footer: the content wrapper's primary nav button,
    // relabelled and wired to finishRouter, inert until every required section is
    // done. Re-runs on each hub render, so completing a section enables it.
    var finishBtn = typeof findScreenNavButton === "function"
      ? findScreenNavButton(app, "next")
      : null;
    if (finishBtn) {
      finishBtn.textContent = "Завершить";
      finishBtn.disabled = !ready;
      if (ready) {
        finishBtn.removeAttribute("aria-disabled");
        finishBtn.onclick = finishRouter;
      } else {
        finishBtn.setAttribute("aria-disabled", "true");
        finishBtn.onclick = null;
      }
    }

    // PRD-8 FR-18: emit router lifecycle events for diagnostics + template
    // extensions. The first time the «Завершить» action becomes available
    // we additionally emit router:finalResultUnlocked so templates can
    // highlight the transition (e.g. animate the button into view).
    emitRouterEvent("router:shown", {
      sections: (TEST_DATA.sections || []).map(function (s) {
        return {
          topicId: s.topicId,
          topicName: s.topicName,
          required: s.required !== false,
          status: state.routerTopicStates[s.topicId] || "notStarted",
          unlocked: isSectionUnlocked(s),
        };
      }),
      readyToFinish: ready,
    });
    if (ready && !state._routerFinalUnlockedFired) {
      state._routerFinalUnlockedFired = true;
      emitRouterEvent("router:finalResultUnlocked", {});
    }
  }

  /**
   * PRD-8 FR-18: thin helper around TestBuilder.template.emit that
   * tolerates missing TestBuilder instance (defensive in case the
   * runtime bundle skipped templateCore for any reason).
   */
  function emitRouterEvent(name, data) {
    var tb = typeof window !== "undefined" ? window.TestBuilder : null;
    if (tb && tb.template && typeof tb.template.emit === "function") {
      tb.template.emit(name, data || {});
    }
  }

  // statusLabel / pluralQuestions moved to shared/flow/router-hub with the hub
  // markup that used them — no local copies to drift.

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
    // Record the router hub on the nav route BEFORE mutating state, so the
    // topic's «Назад» (section-intro / first page) returns to the hub instead of
    // dead-ending at the rebuilt chunk's index 0. Captures the clean hub state
    // (this topic not yet 'inProgress', currentRouterTopic still null).
    if (typeof pushNavHistory === "function") pushNavHistory();
    state.routerTopicStates[topicId] = "inProgress";
    state.currentRouterTopic = topicId;
    // PRD-8 FR-18: section selection event for diagnostics + template
    // hooks (e.g. transition animations).
    emitRouterEvent("router:sectionSelected", { topicId: topicId });

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
    // PRD-4 v1.1 §3.2 / Phase 4f — checkpoint the sectional state on
    // every section completion so a SCO reload can resume with completed
    // topics intact (beforeunload also saves, but explicit checkpoints
    // protect against unexpected browser kills).
    if (typeof saveCurrentSession === "function") saveCurrentSession();
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
   * PRD-20 (2e): resume INTO an unfinished topic on reload — reconstruct its
   * chunk and enter at the saved page position instead of dropping the learner
   * back on the router page. Adaptive topics cannot resume (their state is not
   * persisted) — the caller excludes them. Returns true on success.
   */
  function resumeRouterTopic(topicId, pageIndex) {
    if (!isRouterMode() || !topicId) return false;
    if (TEST_DATA.mode === "adaptive") return false;
    var chunk = buildTopicChunk(topicId);
    if (!chunk || chunk.length === 0) return false;
    state.routerTopicStates[topicId] = "inProgress";
    state.currentRouterTopic = topicId;
    state.pageSequence = chunk;
    var idx = (typeof pageIndex === "number" && pageIndex >= 0 && pageIndex < chunk.length)
      ? pageIndex : 0;
    state.currentPageIndex = idx;
    // Section timers are not persisted (PRD-4 §3.2): restart fresh on re-entry.
    var section = (TEST_DATA.sections || []).find(function (s) {
      return s.topicId === topicId;
    });
    if (section && section.timeLimitMinutes && typeof startSectionTimer === "function") {
      startSectionTimer(topicId, section.timeLimitMinutes, function () {
        returnFromTopic();
      });
    }
    if (typeof syncPhaseToCurrentPage === "function") syncPhaseToCurrentPage();
    if (typeof render === "function") render();
    return true;
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
    // PRD-8 FR-18: final-result open event — fires when the learner
    // actively triggers «Завершить» (after completionPolicy is met).
    emitRouterEvent("router:finalResultOpened", {});
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

  /**
   * Return to the router hub WITHOUT completing the current topic — the resume-
   * safe «Назад» fallback from a topic's first page when no nav history exists
   * (e.g. a reloaded SCO). Reverts the topic to 'notStarted', stops its section
   * timer and re-renders the hub. Live sessions use navigateBack, which restores
   * the exact hub snapshot; this reconstructs an equivalent hub.
   */
  function returnToHub() {
    if (!isRouterMode()) return false;
    if (typeof stopSectionTimer === "function") stopSectionTimer();
    var topicId = state.currentRouterTopic;
    if (topicId && state.routerTopicStates[topicId] === "inProgress") {
      delete state.routerTopicStates[topicId];
    }
    state.currentRouterTopic = null;
    var routerPage = (TEST_DATA.contentPages || []).find(function (p) {
      return p.kind === "router";
    });
    if (!routerPage) return false;
    state.pageSequence = [{ kind: "content", page: routerPage, isRouter: true }];
    state.currentPageIndex = 0;
    state.phase = "router";
    if (typeof render === "function") render();
    return true;
  }

  root.RouterFlow = {
    isRouterMode: isRouterMode,
    buildTopicChunk: buildTopicChunk,
    buildPostRouterSequence: buildPostRouterSequence,
    renderRouterPage: renderRouterPage,
    selectRouterTopic: selectRouterTopic,
    resumeRouterTopic: resumeRouterTopic,
    returnFromTopic: returnFromTopic,
    returnToHub: returnToHub,
    finishRouter: finishRouter,
    isSectionUnlocked: isSectionUnlocked,
    isRouterReadyToFinish: isRouterReadyToFinish,
  };
  root.selectRouterTopic = selectRouterTopic;
  root.returnFromTopic = returnFromTopic;
  root.finishRouter = finishRouter;
})(typeof window !== "undefined" ? window : global);
