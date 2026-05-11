/**
 * @module template
 * @description Minimal template lifecycle script. Applies CSS vars
 * and updates the top progress bar on page transitions.
 */
(function () {
  "use strict";

  var tb = window.TestBuilder;
  if (!tb) return;

  /** Updates the progress bar from runtime data. */
  function updateProgress() {
    var fill = document.getElementById("tb-progress-fill");
    if (!fill) return;
    try {
      var pct = TEST_DATA.progress.question.percent || 0;
      fill.style.width = pct + "%";
    } catch (_) {}
  }

  tb.template.on("page:enter", function () {
    updateProgress();
  });

  document.addEventListener("DOMContentLoaded", function () {
    if (tb._init) tb._init(window.PRD1_TEMPLATE_MANIFEST ? window.PRD1_TEMPLATE_MANIFEST.params : []);
    updateProgress();
  });
})();
