/**
 * @module template
 * @description Corporate template lifecycle script. Applies CSS vars,
 * updates progress bar, and highlights the active topic in the sidebar.
 */
(function () {
  "use strict";

  var tb = window.TestBuilder;
  if (!tb) return;

  /** Updates the progress fill width from runtime data. */
  function updateProgress() {
    var fill = document.getElementById("tb-progress-fill");
    if (!fill) return;
    try {
      var pct = TEST_DATA.progress.question.percent || 0;
      fill.style.width = pct + "%";
    } catch (_) {}
  }

  /** Marks the current topic active in the sidebar. */
  function updateTopicNav() {
    try {
      var currentId = TEST_DATA.state && TEST_DATA.state.currentTopicId;
      if (!currentId) return;
      document.querySelectorAll(".tb-topic-item").forEach(function (el) {
        el.classList.toggle("active", el.dataset.topicId === currentId);
      });
    } catch (_) {}
  }

  tb.template.on("page:enter", function () {
    updateProgress();
    updateTopicNav();
  });

  document.addEventListener("DOMContentLoaded", function () {
    if (tb._init) tb._init(window.PRD1_TEMPLATE_MANIFEST ? window.PRD1_TEMPLATE_MANIFEST.params : []);
    updateProgress();
    updateTopicNav();
  });
})();
