/**
 * @module contentPage
 * @description Renders a content page using the current design template's
 * content template definition. Handles placeholder filling, textFit, and
 * autoAdvance.
 *
 * Depends on: templateCore (window.TestBuilder._internal),
 *             renderers (window.TestBuilder.renderers),
 *             escapeHtml, TEST_DATA globals.
 */

/**
 * Finds the content template definition for a given page.
 * @param {object} page  A content page from TEST_DATA.contentPages
 * @param {Array}  contentTemplates  From the design template manifest
 * @returns {object|null}
 */
function findContentTemplate(page, contentTemplates) {
  if (!page || !contentTemplates) return null;
  var key = page.templateKey;
  if (!key) return null;
  for (var i = 0; i < contentTemplates.length; i++) {
    if (contentTemplates[i].key === key) return contentTemplates[i];
  }
  return null;
}

/**
 * Builds a fallback HTML structure for a content page when no content
 * template definition is available.
 * @param {object} page
 * @returns {string}
 */
function buildFallbackContentHtml(page) {
  var typeLabel = page.type || "content";
  var values = getPageValues(page);
  if (page.mode === "html" && values.__html) {
    return '<div class="content-page content-page--html">' + String(values.__html) + "</div>";
  }
  var title = values.title || values.heading || typeLabel;
  var body = values.body || values.text || values.subtitle || "";
  return (
    '<div class="content-page content-page--fallback" data-page-type="' +
    escapeHtml(typeLabel) +
    '">' +
    '<div class="card">' +
    '<h1>' + escapeHtml(String(title)) + '</h1>' +
    (body ? '<div style="color:hsl(var(--muted-foreground));">' + String(body) + '</div>' : '') +
    '</div>' +
    "</div>"
  );
}

/**
 * Builds the HTML skeleton for a content page based on its content template
 * placeholders. Each placeholder becomes a [data-placeholder] div that will
 * be filled by fillPlaceholders().
 * @param {object} page
 * @param {object} contentTemplate
 * @returns {string}
 */
function buildContentPageSkeleton(page, contentTemplate) {
  if (!contentTemplate || !contentTemplate.placeholders) {
    return buildFallbackContentHtml(page);
  }
  var html =
    '<div class="content-page content-page--' +
    escapeHtml(page.type || "info") +
    '" data-template-key="' +
    escapeHtml(contentTemplate.key) +
    '">';
  contentTemplate.placeholders.forEach(function (phDef) {
    html +=
      '<div class="content-placeholder content-placeholder--' +
      escapeHtml(phDef.key) +
      '" data-placeholder="' +
      escapeHtml(phDef.key) +
      '"></div>';
  });
  html += "</div>";
  return html;
}

/**
 * Renders a resultField placeholder using the renderers module.
 * @param {Element} el
 * @param {object}  phDef
 * @param {*}       value
 * @param {object}  contentTemplate
 */
function fillResultFieldPlaceholder(el, phDef, value, contentTemplate) {
  if (!value || typeof value !== "object") {
    el.innerHTML = "";
    return;
  }
  var allowedRenderers = phDef.allowedRenderers
    ? new Set(phDef.allowedRenderers)
    : null;

  // value is the raw resultField object { path, renderer, rendererOptions, label }
  var tb = typeof window !== "undefined" ? window.TestBuilder : null;
  var rendererFn = tb && tb.renderers ? tb.renderers.render : null;
  if (!rendererFn) {
    el.innerHTML = escapeHtml(String(value.path || ""));
    return;
  }
  el.innerHTML = rendererFn(
    value,
    typeof TEST_DATA !== "undefined" ? TEST_DATA : {},
    allowedRenderers
  );
}

function getPageValues(page) {
  if (!page) return {};
  if (page.valuesJson && page.valuesJson.values) return page.valuesJson.values;
  return page.values || {};
}

function getPagePlaceholderStyles(page) {
  if (!page) return {};
  if (page.valuesJson && page.valuesJson.placeholderStyles) return page.valuesJson.placeholderStyles;
  return page.placeholderStyles || {};
}

/**
 * Renders a content page into the #app element.
 * @param {object} page             Entry from TEST_DATA.contentPages
 * @param {Array}  contentTemplates Array from the design template manifest
 */
function renderContentPage(page, contentTemplates) {
  var app = document.getElementById("app");
  if (!app) return;

  // Cancel any previous autoAdvance timer
  var tb = typeof window !== "undefined" ? window.TestBuilder : null;
  if (tb && tb._internal) tb._internal.cancelAutoAdvance();

  var contentTemplate = findContentTemplate(page, contentTemplates);
  var values = getPageValues(page);
  var placeholderStyles = getPagePlaceholderStyles(page);

  app.innerHTML = buildContentPageSkeleton(page, contentTemplate);

  if (contentTemplate && tb && tb._internal) {
    // Handle resultField separately; delegate rest to fillPlaceholders
    var nonResultPlaceholders = (contentTemplate.placeholders || []).filter(
      function (ph) {
        return ph.type !== "resultField";
      }
    );
    var resultPlaceholders = (contentTemplate.placeholders || []).filter(
      function (ph) {
        return ph.type === "resultField";
      }
    );

    var syntheticCt = Object.assign({}, contentTemplate, {
      placeholders: nonResultPlaceholders
    });
    tb._internal.fillPlaceholders(app, syntheticCt, values, placeholderStyles);

    resultPlaceholders.forEach(function (phDef) {
      var el = app.querySelector('[data-placeholder="' + phDef.key + '"]');
      if (el) fillResultFieldPlaceholder(el, phDef, values[phDef.key], contentTemplate);
    });

    tb._internal.renderPathOnlyDsl(app, typeof TEST_DATA !== "undefined" ? TEST_DATA : {});
  }

  // autoAdvance
  if (page.autoAdvance && page.autoAdvanceDelayMs && tb && tb._internal) {
    tb._internal.startAutoAdvance(page.autoAdvanceDelayMs, function () {
      if (typeof advancePageSequence === "function") advancePageSequence();
      else if (typeof next === "function") next();
    });
  }

  var nav = document.createElement("div");
  nav.className = "navigation";
  nav.style.justifyContent = "flex-end";
  nav.innerHTML = '<button class="btn" data-nav="next" onclick="advancePageSequence()">Далее</button>';
  app.appendChild(nav);

  // Template lifecycle event
  if (tb && tb.template) {
    tb.template.emit("page:enter", { page: page });
  }
}
