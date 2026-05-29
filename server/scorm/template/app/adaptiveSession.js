/**
 * @module adaptiveSession
 * @description PRD-4 v1.1 §4.6 / §4.7: single-topic adaptive session runtime.
 *
 * Existing `adaptive/adaptive.js` runs adaptive across ALL topics in fixed
 * order (legacy `(adaptive, linear_flat)` flow). For sectional modes
 * (linear_by_topics / router_by_topics) we need adaptive scoped to ONE
 * topic at a time: router-click → topic adaptive → return; linear-flow →
 * before_topic content → topic adaptive → after_topic content → next topic.
 *
 * This module is a thin wrapper around the existing engine — it filters
 * TEST_DATA.adaptiveTopics to one entry, calls the same init/submit logic,
 * and intercepts the «all topics completed» branch (which in single-topic
 * scope means «THIS topic is done») to invoke an onComplete callback.
 *
 * Side-effect contract: while a single-topic session runs,
 * `state.adaptiveState` holds the single-topic engine state (so render
 * dispatch in mainRender.js continues to route to renderAdaptive). The
 * `_scope` and `_onComplete` fields tag the state as router/linear-scoped
 * so the adaptive engine's "all topics completed" branch can fire the
 * callback instead of finishing the whole test.
 */
(function (root) {
  "use strict";

  /**
   * Starts an adaptive session for ONE topic. Reuses the existing
   * initAdaptiveTest scaffolding by temporarily swapping
   * TEST_DATA.adaptiveTopics to just the requested topic, calling
   * initAdaptiveTest, then restoring the original array.
   *
   * @param {string} topicId
   * @param {Function} onComplete  Called with the single-topic result
   *   when the engine signals isFinished. Shape mirrors topicResults
   *   entries from buildAdaptiveResult (topicId, finalLevelIndex,
   *   finalLevelName, passed, etc).
   * @returns {boolean} true on success, false when the topic is not
   *   found in TEST_DATA.adaptiveTopics or has no levels configured
   *   (strict gating PRD-4 v1.1 §3.1.2 should have rejected this at
   *   save time, but the runtime defends in depth).
   */
  function runAdaptiveSession(topicId, onComplete) {
    if (
      typeof TEST_DATA === "undefined" ||
      TEST_DATA.mode !== "adaptive" ||
      !TEST_DATA.adaptiveTopics
    ) {
      return false;
    }
    var topic = TEST_DATA.adaptiveTopics.find(function (t) {
      return t.topicId === topicId;
    });
    if (!topic || !topic.levels || topic.levels.length === 0) return false;

    var originalTopics = TEST_DATA.adaptiveTopics;
    TEST_DATA.adaptiveTopics = [topic];
    try {
      if (typeof initAdaptiveTest !== "function") return false;
      var ok = initAdaptiveTest();
      if (!ok || !state.adaptiveState) return false;
      state.adaptiveState._scope = "single-topic";
      state.adaptiveState._onComplete = onComplete || null;
    } finally {
      // Restore the global list so other readers (e.g. recovery, results
      // page) see the full set of topics.
      TEST_DATA.adaptiveTopics = originalTopics;
    }
    if (typeof render === "function") render();
    return true;
  }

  /**
   * Called by the adaptive engine when its multi-topic loop hits «all
   * topics completed». In single-topic scope this means OUR topic is
   * done — extract its result, clear adaptiveState, and invoke the
   * caller's onComplete with the topicResults[0] entry.
   *
   * Returns true when the engine should NOT continue to its default
   * end-of-test behavior (renderAdaptiveResults). When this returns
   * false, the engine falls through to the legacy multi-topic path.
   */
  function maybeFinishSingleTopic() {
    if (!state.adaptiveState || state.adaptiveState._scope !== "single-topic") {
      return false;
    }
    var onComplete = state.adaptiveState._onComplete;
    var fullResult = state.adaptiveState.result;
    var topicResult =
      fullResult && fullResult.topicResults && fullResult.topicResults[0];
    state.adaptiveState = null;
    if (typeof onComplete === "function") onComplete(topicResult || null);
    return true;
  }

  root.AdaptiveSession = {
    runAdaptiveSession: runAdaptiveSession,
    maybeFinishSingleTopic: maybeFinishSingleTopic,
  };
  root.runAdaptiveSession = runAdaptiveSession;
})(typeof window !== "undefined" ? window : global);
