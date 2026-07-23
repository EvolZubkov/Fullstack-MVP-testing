/**
 * @module templateCore
 * @description TestBuilder Runtime Core — CSS variable application, placeholder
 * rendering, textFit modes, autoAdvance timer, and the window.TestBuilder API
 * consumed by design template scripts.
 *
 * Pure helper functions are exposed on TestBuilder._internal so they can be
 * unit-tested without a live DOM or SCORM session.
 */
(function (root) {
  "use strict";

  // ─── Path resolver ────────────────────────────────────────────────────────

  /**
   * Resolves a dot-notation path in an object.
   * @param {object} obj
   * @param {string} path
   * @returns {*}
   */
  function resolvePath(obj, path) {
    if (!obj || !path) return undefined;
    var parts = path.split(".");
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  // ─── CSS variables ────────────────────────────────────────────────────────

  /**
   * Builds a { "--css-var": "value" } map from effective params and the
   * manifest param definitions that declare a cssVar property.
   * @param {object} params  Effective param values
   * @param {Array}  manifestParams  Array of param definitions from manifest
   * @returns {object}
   */
  function buildCssVarDeclarations(params, manifestParams) {
    // Canonical mapping lives in shared/template/params-css and is exposed on the
    // TBTemplate runtime bundle. Delegate to it so the package runtime and the web
    // preview never drift. The inline copy below is a byte-for-byte fallback used
    // only when the bundle is not present (defensive — keeps the package working).
    if (root.TBTemplate && typeof root.TBTemplate.buildTemplateCssVars === "function") {
      return root.TBTemplate.buildTemplateCssVars(params, manifestParams);
    }
    var result = {};
    if (!manifestParams || !params) return result;
    var defaultCssVars = {
      primaryColor: "--primary",
      backgroundColor: "--background",
      foregroundColor: "--foreground",
      cardColor: "--card",
      cardBorderColor: "--card-border",
      borderColor: "--border",
      mutedColor: "--muted",
      accentColor: "--accent",
      fontFamily: "--font-sans"
    };
    manifestParams.forEach(function (def) {
      var cssVar = def.cssVar || defaultCssVars[def.key];
      if (!cssVar) return;
      var value = resolvePath(params, def.key);
      if (value === null || value === undefined) value = def.default;
      if (value === null || value === undefined) return;
      var cssValue =
        typeof value === "number"
          ? String(value) + (def.cssUnit || "px")
          : String(value);
      result[cssVar] = cssValue;
    });
    return result;
  }

  /**
   * Applies CSS custom properties derived from params to document.documentElement.
   * @param {object} params
   * @param {Array}  manifestParams
   */
  function applyCssVarsToRoot(params, manifestParams) {
    var vars = buildCssVarDeclarations(params, manifestParams);
    var el =
      typeof document !== "undefined" ? document.documentElement : null;
    if (!el) return;
    Object.keys(vars).forEach(function (name) {
      el.style.setProperty(name, vars[name]);
    });
  }

  /**
   * PRD-23: paints a themed template. The per-theme colours go in as a stylesheet
   * appended LAST (a media query cannot scope inline custom properties, and the
   * dark value must apply only under the dark palette), and the author's pinned
   * palette goes on `<html data-theme>`. «Авто» leaves the attribute off so the
   * template's own `prefers-color-scheme` rules decide.
   *
   * No-ops without the shared bundle: printing is not something to duplicate by
   * hand here, and a package built by this codebase always ships it.
   * @param {object} design    TEST_DATA.designSettings
   * @param {object} manifest  Template manifest (params[] + themes[])
   */
  function applyThemeCss(design, manifest) {
    if (typeof document === "undefined") return;
    if (!root.TBTemplate || typeof root.TBTemplate.buildTemplateThemeCss !== "function") return;
    var css = root.TBTemplate.buildTemplateThemeCss(design, manifest);
    var pinned = root.TBTemplate.sceneThemeAttribute(design, manifest);
    var el = document.documentElement;
    if (pinned) el.setAttribute("data-theme", pinned);
    else el.removeAttribute("data-theme");
    if (!css) return;
    var style = document.getElementById("tb-theme-vars");
    if (!style) {
      style = document.createElement("style");
      style.id = "tb-theme-vars";
      (document.head || el).appendChild(style);
    }
    style.textContent = css;
  }

  // ─── textFit ──────────────────────────────────────────────────────────────

  /**
   * Returns true when an element's content overflows its box.
   * @param {Element} el
   * @returns {boolean}
   */
  function isOverflowing(el) {
    return (
      el.scrollHeight > el.clientHeight + 1 ||
      el.scrollWidth > el.clientWidth + 1
    );
  }

  /**
   * Applies a textFit configuration to a DOM element.
   *
   * Modes:
   *   fixed      — sets font-size to defaultFontSize (or authorFontSize when
   *                allowAuthorFontSize is true). Warns on overflow.
   *   autoFitFont — shrinks font-size from maxFontSize down to minFontSize
   *                until the element no longer overflows.
   *   growBox    — sets font-size to defaultFontSize and lets the element's
   *                height grow. Caps at maxHeight if specified.
   *
   * @param {Element} el
   * @param {object}  config   textFit definition from the placeholder schema
   * @param {number|null} authorFontSize  Author-chosen font size (optional)
   */
  function applyTextFit(el, config, authorFontSize) {
    if (!el || !config) return;
    var mode = config.mode || "fixed";
    var useAuthor =
      config.allowAuthorFontSize &&
      authorFontSize !== null &&
      authorFontSize !== undefined;
    var defaultSize = useAuthor
      ? authorFontSize
      : config.defaultFontSize || 16;

    if (mode === "fixed") {
      el.style.fontSize = defaultSize + "px";
      if (config.overflow === "warn" && isOverflowing(el)) {
        console.warn("[textFit:fixed] overflow on element", el);
      }
      return;
    }

    if (mode === "autoFitFont") {
      var max = config.maxFontSize || defaultSize;
      var min = config.minFontSize || 8;
      el.style.fontSize = max + "px";
      var size = max;
      while (size > min && isOverflowing(el)) {
        size -= 0.5;
        el.style.fontSize = size.toFixed(2) + "px";
      }
      if (config.overflow === "warn" && isOverflowing(el)) {
        console.warn("[textFit:autoFitFont] overflow after shrink", el);
      }
      return;
    }

    if (mode === "growBox") {
      el.style.fontSize = defaultSize + "px";
      el.style.height = "auto";
      if (config.maxHeight) {
        el.style.maxHeight = config.maxHeight + "px";
        el.style.overflowY = "auto";
      }
    }
  }

  // ─── Placeholder rendering ────────────────────────────────────────────────

  var _escapeHtml =
    typeof escapeHtml === "function"
      ? escapeHtml
      : function (s) {
          return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
        };

  /**
   * Converts a raw placeholder value to safe HTML ready for innerHTML.
   * richText / html bypass escaping (already sanitized server-side).
   * @param {string} type
   * @param {*} value
   * @returns {string}
   */
  function renderPlaceholderHtml(type, value) {
    if (value === null || value === undefined || value === "") return "";
    switch (type) {
      case "text":
      case "textarea":
        return _escapeHtml(String(value)).replace(/\n/g, "<br>");
      case "richText":
      case "html":
        return String(value);
      case "number":
        return _escapeHtml(String(value));
      case "image":
        return (
          '<img src="' +
          _escapeHtml(String(value)) +
          '" alt="" style="max-width:100%;max-height:100%;">'
        );
      case "boolean":
        return value ? "&#10003;" : "";
      default:
        return _escapeHtml(String(value));
    }
  }

  /**
   * Fills [data-placeholder] elements inside root according to the content
   * template definition, then applies textFit to each.
   * @param {Element} root
   * @param {object}  contentTemplate  Entry from manifest.contentTemplates[]
   * @param {object}  values           Plain values map
   * @param {object}  placeholderStyles  { key: { fontSize: number } }
   */
  function fillPlaceholders(root, contentTemplate, values, placeholderStyles) {
    if (!root || !contentTemplate || !contentTemplate.placeholders) return;
    values = values || {};
    placeholderStyles = placeholderStyles || {};

    contentTemplate.placeholders.forEach(function (phDef) {
      var key = phDef.key;
      var el = root.querySelector('[data-placeholder="' + key + '"]');
      if (!el) return;

      var value = values[key];
      el.innerHTML = renderPlaceholderHtml(phDef.type, value);

      if (phDef.textFit) {
        var style = placeholderStyles[key] || {};
        applyTextFit(el, phDef.textFit, style.fontSize || null);
      }
    });
  }

  function renderPathOnlyDsl(root, data) {
    if (!root) return;
    var nodes = root.querySelectorAll("[data-path]");
    nodes.forEach(function (el) {
      var path = el.getAttribute("data-path");
      var value = resolvePath(data || {}, path);
      el.textContent = value === null || value === undefined ? "" : String(value);
    });
  }

  function fillControlledSlots(root, slots) {
    if (!root || !slots) return;
    Object.keys(slots).forEach(function (slotName) {
      var el = root.querySelector('[data-slot="' + slotName + '"]');
      if (el) el.innerHTML = slots[slotName] || "";
    });
  }

  // ─── autoAdvance ──────────────────────────────────────────────────────────

  var _autoAdvanceTimer = null;

  /**
   * Starts the autoAdvance countdown. Calls onComplete when the timer fires.
   * Only one timer can be active; any previous one is cancelled.
   * @param {number}   delayMs
   * @param {Function} onComplete
   */
  function startAutoAdvance(delayMs, onComplete) {
    cancelAutoAdvance();
    _autoAdvanceTimer = setTimeout(function () {
      _autoAdvanceTimer = null;
      if (typeof onComplete === "function") onComplete();
    }, delayMs);
  }

  /** Cancels any pending autoAdvance timer. */
  function cancelAutoAdvance() {
    if (_autoAdvanceTimer !== null) {
      clearTimeout(_autoAdvanceTimer);
      _autoAdvanceTimer = null;
    }
  }

  // ─── Event emitter ────────────────────────────────────────────────────────

  var _listeners = {};

  function on(event, handler) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(handler);
  }

  function emit(event, data) {
    (_listeners[event] || []).forEach(function (h) {
      try {
        h(data);
      } catch (e) {
        console.warn("[TestBuilder] handler error for " + event + ":", e);
      }
    });
  }

  // ─── TestBuilder API ──────────────────────────────────────────────────────

  var _contextParams = {};

  /**
   * Reads effective params from TEST_DATA.designSettings.params (safe: works
   * even before TEST_DATA is defined, returns {}).
   */
  function _readParams() {
    try {
      if (
        typeof TEST_DATA !== "undefined" &&
        TEST_DATA.designSettings &&
        TEST_DATA.designSettings.params
      ) {
        return TEST_DATA.designSettings.params;
      }
    } catch (_) {}
    return {};
  }

  /** The whole baked design settings — PRD-23 reads `theme`/`paramsByTheme` too. */
  function _readDesignSettings() {
    try {
      if (typeof TEST_DATA !== "undefined" && TEST_DATA.designSettings) {
        return TEST_DATA.designSettings;
      }
    } catch (_) {}
    return {};
  }

  root.TestBuilder = {
    /** Read-only context for template scripts. */
    context: {
      get: function () {
        return { params: _contextParams };
      }
    },

    /** Template lifecycle event emitter. */
    template: { on: on, emit: emit },

    /** SCORM commit proxy (template scripts call this instead of SCORM directly). */
    scorm: {
      commit: function () {
        if (typeof SCORM !== "undefined" && typeof SCORM.commit === "function") {
          SCORM.commit();
        }
      }
    },

    /** UI helpers for template scripts. */
    ui: {
      modal: function (opts) {
        console.warn("[TestBuilder.ui.modal]", opts);
      },
      toast: function (msg) {
        console.warn("[TestBuilder.ui.toast]", msg);
      }
    },

    /**
     * Called by bootstrap once TEST_DATA is available and the design template
     * manifest has been loaded/embedded.
     * @param {Array}  manifestParams  Param definitions from the template manifest
     * @param {object} [manifest]      Whole manifest — PRD-23 needs `themes[]` to
     *                                 know whether colours split per palette.
     */
    _init: function (manifestParams, manifest) {
      var design = _readDesignSettings();
      var mf = manifest || { params: manifestParams || [] };
      _contextParams = _readParams();
      // A themed template's colours must NOT go in as inline custom properties:
      // inline beats every stylesheet, so the dark palette would never get its
      // turn. `baseParams` keeps only what paints the same in both palettes.
      var inlineParams = _contextParams;
      if (root.TBTemplate && typeof root.TBTemplate.baseParams === "function") {
        inlineParams = root.TBTemplate.baseParams(design, mf);
      }
      applyCssVarsToRoot(inlineParams, manifestParams || []);
      applyThemeCss(design, mf);
    },

    /** Pure helpers exposed for unit testing. */
    _internal: {
      resolvePath: resolvePath,
      buildCssVarDeclarations: buildCssVarDeclarations,
      applyCssVarsToRoot: applyCssVarsToRoot,
      applyThemeCss: applyThemeCss,
      applyTextFit: applyTextFit,
      isOverflowing: isOverflowing,
      renderPlaceholderHtml: renderPlaceholderHtml,
      fillPlaceholders: fillPlaceholders,
      renderPathOnlyDsl: renderPathOnlyDsl,
      fillControlledSlots: fillControlledSlots,
      startAutoAdvance: startAutoAdvance,
      cancelAutoAdvance: cancelAutoAdvance
    }
  };
})(typeof window !== "undefined" ? window : global);
