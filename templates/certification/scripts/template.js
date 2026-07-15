/**
 * @module template
 * @description Default template lifecycle script. Applies CSS vars,
 * updates the progress bar on page transitions, and wires navigation buttons.
 */
(function () {
  "use strict";

  var tb = window.TestBuilder;
  if (!tb) return;

  /** Updates the progress fill element from runtime data. */
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
