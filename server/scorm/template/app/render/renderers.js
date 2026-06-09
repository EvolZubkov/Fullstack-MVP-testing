/**
 * @module renderers
 * @description Built-in renderer plugins for resultField placeholders.
 *
 * Each renderer is a pure function:
 *   render(value, path, rendererOptions) → HTML string
 *
 * Renderers do NOT access SCORM API and do NOT mutate runtime state.
 * The registry is exposed on window.TestBuilder.renderers (added by this module).
 *
 * Built-in IDs: core.textMetric, core.badge, core.progressBar,
 *               core.ringChart, core.segmentedProgress.
 */
(function (root) {
  "use strict";

  var _esc =
    typeof escapeHtml === "function"
      ? escapeHtml
      : function (s) {
          return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
        };

  function clamp(v, min, max) {
    return Math.min(Math.max(Number(v) || 0, min), max);
  }

  // ─── core.textMetric ─────────────────────────────────────────────────────

  /**
   * Renders a numeric (or text) value with an optional label.
   * Options: { label?: string, suffix?: string, decimals?: number }
   */
  function textMetric(value, rendererOptions) {
    var opts = rendererOptions || {};
    var label = opts.label ? _esc(String(opts.label)) : "";
    var suffix = opts.suffix ? _esc(String(opts.suffix)) : "";
    var decimals =
      opts.decimals !== undefined ? Number(opts.decimals) : null;
    var display =
      value === null || value === undefined
        ? "—"
        : decimals !== null
        ? _esc(Number(value).toFixed(decimals))
        : _esc(String(value));

    return (
      '<div class="renderer renderer--text-metric">' +
      (label ? '<div class="renderer__label">' + label + "</div>" : "") +
      '<div class="renderer__value">' +
      display +
      (suffix ? '<span class="renderer__suffix">&thinsp;' + suffix + "</span>" : "") +
      "</div>" +
      "</div>"
    );
  }

  // ─── core.badge ──────────────────────────────────────────────────────────

  /**
   * Renders a status badge.
   * Options: {
   *   passed?: { value: string, label: string },
   *   failed?: { value: string, label: string },
   *   default?: string
   * }
   * `value` is compared to opts.passed.value / opts.failed.value.
   */
  function badge(value, rendererOptions) {
    var opts = rendererOptions || {};
    var strValue = String(value);
    var tone = "neutral";
    var label = _esc(strValue);

    if (opts.passed && String(opts.passed.value) === strValue) {
      tone = "passed";
      label = opts.passed.label ? _esc(String(opts.passed.label)) : label;
    } else if (opts.failed && String(opts.failed.value) === strValue) {
      tone = "failed";
      label = opts.failed.label ? _esc(String(opts.failed.label)) : label;
    } else if (opts.default) {
      label = _esc(String(opts.default));
    }

    return (
      '<span class="renderer renderer--badge renderer--badge-' +
      _esc(tone) +
      '">' +
      label +
      "</span>"
    );
  }

  // ─── core.progressBar ────────────────────────────────────────────────────

  /**
   * Renders a horizontal progress bar.
   * Options: { label?: string, showValue?: boolean, decimals?: number }
   * `value` must be 0–100 (percent).
   */
  function progressBar(value, rendererOptions) {
    var opts = rendererOptions || {};
    var pct = clamp(value, 0, 100);
    var label = opts.label ? _esc(String(opts.label)) : "";
    var decimals = opts.decimals !== undefined ? Number(opts.decimals) : 0;
    var display = pct.toFixed(decimals) + "%";

    return (
      '<div class="renderer renderer--progress-bar">' +
      (label ? '<div class="renderer__label">' + label + "</div>" : "") +
      '<div class="renderer__track">' +
      '<div class="renderer__fill" style="width:' +
      pct.toFixed(2) +
      '%"></div>' +
      "</div>" +
      (opts.showValue
        ? '<div class="renderer__value">' + _esc(display) + "</div>"
        : "") +
      "</div>"
    );
  }

  // ─── core.ringChart ──────────────────────────────────────────────────────

  /**
   * Renders an SVG ring (donut) chart.
   * Options: { label?: string, showValue?: boolean, decimals?: number,
   *            size?: number, strokeWidth?: number }
   * `value` must be 0–100.
   */
  function ringChart(value, rendererOptions) {
    var opts = rendererOptions || {};
    var pct = clamp(value, 0, 100);
    var size = Number(opts.size) || 120;
    var sw = Number(opts.strokeWidth) || 10;
    var r = (size - sw) / 2;
    var circumference = 2 * Math.PI * r;
    var filled = (pct / 100) * circumference;
    var label = opts.label ? _esc(String(opts.label)) : "";
    var decimals = opts.decimals !== undefined ? Number(opts.decimals) : 0;
    var display = pct.toFixed(decimals) + "%";
    var cx = size / 2;
    var cy = size / 2;

    return (
      '<div class="renderer renderer--ring-chart">' +
      (label ? '<div class="renderer__label">' + label + "</div>" : "") +
      '<svg class="renderer__ring" width="' +
      size +
      '" height="' +
      size +
      '" viewBox="0 0 ' +
      size +
      " " +
      size +
      '" aria-hidden="true">' +
      '<circle class="renderer__ring-track" cx="' +
      cx +
      '" cy="' +
      cy +
      '" r="' +
      r +
      '" fill="none" stroke-width="' +
      sw +
      '"/>' +
      '<circle class="renderer__ring-fill" cx="' +
      cx +
      '" cy="' +
      cy +
      '" r="' +
      r +
      '" fill="none" stroke-width="' +
      sw +
      '"' +
      ' stroke-dasharray="' +
      filled.toFixed(2) +
      " " +
      circumference.toFixed(2) +
      '"' +
      ' stroke-dashoffset="0"' +
      ' transform="rotate(-90 ' +
      cx +
      " " +
      cy +
      ')"/>' +
      "</svg>" +
      (opts.showValue
        ? '<div class="renderer__value">' + _esc(display) + "</div>"
        : "") +
      "</div>"
    );
  }

  // ─── core.segmentedProgress ──────────────────────────────────────────────

  /**
   * Renders a row of filled/empty segments.
   * Options: { segments?: number, label?: string, showValue?: boolean }
   * `value` must be 0–100.
   */
  function segmentedProgress(value, rendererOptions) {
    var opts = rendererOptions || {};
    var pct = clamp(value, 0, 100);
    var total = Math.max(Number(opts.segments) || 10, 1);
    var filled = Math.round((pct / 100) * total);
    var label = opts.label ? _esc(String(opts.label)) : "";
    var segs = "";
    for (var i = 0; i < total; i++) {
      segs +=
        '<span class="renderer__segment' +
        (i < filled ? " is-filled" : "") +
        '"></span>';
    }
    return (
      '<div class="renderer renderer--segmented-progress">' +
      (label ? '<div class="renderer__label">' + label + "</div>" : "") +
      '<div class="renderer__segments">' +
      segs +
      "</div>" +
      (opts.showValue
        ? '<div class="renderer__value">' +
          _esc(pct.toFixed(0) + "%") +
          "</div>"
        : "") +
      "</div>"
    );
  }

  // ─── Registry ─────────────────────────────────────────────────────────────

  /**
   * Renders a resultField value using the registered renderer.
   * Falls back to core.textMetric and logs a warning when the renderer is
   * missing or throws.
   *
   * @param {object} fieldValue  { path, renderer, label, rendererOptions }
   * @param {object} testData    Full TEST_DATA object (for path resolution)
   * @param {Set}    allowedRenderers  Set of allowed renderer IDs
   * @returns {string} HTML
   */
  function renderResultField(fieldValue, testData, allowedRenderers) {
    if (!fieldValue) return "";
    var rId = fieldValue.renderer || "core.textMetric";
    var opts = Object.assign({}, fieldValue.rendererOptions || {});
    if (fieldValue.label) opts.label = opts.label || fieldValue.label;

    // Enforce allowedRenderers
    if (allowedRenderers && !allowedRenderers.has(rId)) {
      console.warn(
        "[renderers] " + rId + " not in allowedRenderers; falling back to core.textMetric"
      );
      rId = "core.textMetric";
    }

    if (fieldValue.allowedPaths && fieldValue.allowedPaths.indexOf(fieldValue.path) === -1) {
      console.warn("[renderers] path not allowed; rendering empty value");
      return builtins["core.textMetric"](null, opts);
    }

    // Resolve data value from path
    var tb = root.TestBuilder && root.TestBuilder._internal;
    var value =
      tb && fieldValue.path
        ? tb.resolvePath(testData, fieldValue.path)
        : fieldValue.path
        ? undefined
        : null;

    var fn = builtins[rId];
    if (!fn) {
      console.warn("[renderers] unknown renderer " + rId + "; falling back");
      fn = builtins["core.textMetric"];
    }

    try {
      return fn(value, opts);
    } catch (e) {
      console.warn("[renderers] renderer " + rId + " threw:", e);
      return builtins["core.textMetric"](value, opts);
    }
  }

  var builtins = {
    "core.textMetric": textMetric,
    "core.badge": badge,
    "core.progressBar": progressBar,
    "core.ringChart": ringChart,
    "core.segmentedProgress": segmentedProgress
  };

  // Attach to TestBuilder (if already defined) or create stub
  if (!root.TestBuilder) root.TestBuilder = {};
  root.TestBuilder.renderers = {
    /** Register a custom renderer plugin. */
    register: function (id, fn) {
      builtins[id] = fn;
    },
    /** Render a resultField value, returns HTML string. */
    render: renderResultField,
    /** Direct access to built-in render functions (for unit tests). */
    _builtins: builtins
  };
})(typeof window !== "undefined" ? window : global);
