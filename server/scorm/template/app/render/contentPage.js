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
/**
 * Fills the content-page placeholders within `root`: plain placeholders via
 * TestBuilder.fillPlaceholders (by type + textFit), resultField placeholders via
 * the renderer registry, then the path-only DSL bindings. Scoped to `root` so the
 * same logic works whether the skeleton lives directly in #app or inside the
 * shared `content` layout's page-content slot.
 */
function fillContentPagePlaceholders(root, contentTemplate, values, placeholderStyles, tb) {
  if (!contentTemplate || !tb || !tb._internal) return;
  var nonResult = (contentTemplate.placeholders || []).filter(function (ph) { return ph.type !== "resultField"; });
  var resultPh = (contentTemplate.placeholders || []).filter(function (ph) { return ph.type === "resultField"; });
  var syntheticCt = Object.assign({}, contentTemplate, { placeholders: nonResult });
  tb._internal.fillPlaceholders(root, syntheticCt, values, placeholderStyles);
  resultPh.forEach(function (phDef) {
    var el = root.querySelector('[data-placeholder="' + phDef.key + '"]');
    if (el) fillResultFieldPlaceholder(el, phDef, values[phDef.key], contentTemplate);
  });
  // §10: bind data-path against a PUBLIC context, not the internal TEST_DATA. The
  // default template's content has no data-path bindings (author content flows via
  // placeholders/resultField above), so a minimal `course` context suffices; extend
  // with result/sectionResult here if a content template ever binds those.
  tb._internal.renderPathOnlyDsl(root, contentPublicContext());
}

/** Minimal public context for content-page data-path bindings (no raw TEST_DATA). */
function contentPublicContext() {
  return { course: { title: (typeof TEST_DATA !== "undefined" ? TEST_DATA.title : "") } };
}

/**
 * PRD-1 §4.3: renders the «Введение раздела» (intro) page from its OWN section-intro
 * layout — topic name / description / question count / time limit (auto from the
 * section) + the author instruction (slot) — instead of the generic content wrapper.
 * Returns true when it rendered; false (caller falls back to the wrapper) when the
 * layout, the renderer, or the matching section is unavailable.
 * @param {object} page  An intro content page (kind: "intro").
 * @returns {boolean}
 */
function pluralQuestions(n) {
  var abs = Math.abs(n) % 100;
  var d = abs % 10;
  if (abs > 10 && abs < 20) return "вопросов";
  if (d === 1) return "вопрос";
  if (d > 1 && d < 5) return "вопроса";
  return "вопросов";
}

function pluralMinutes(n) {
  var abs = Math.abs(n) % 100;
  var d = abs % 10;
  if (abs > 10 && abs < 20) return "минут";
  if (d === 1) return "минута";
  if (d > 1 && d < 5) return "минуты";
  return "минут";
}

/**
 * Plain-JS fallback for buildSectionIntroContext — used only when the shared
 * builder is absent from the (per-process cached) TBTemplate bundle, e.g. in dev
 * before a server restart picks up a newly-added export. Mirrors
 * shared/template/result-context.buildSectionIntroContext exactly so the screen
 * renders identically regardless of which path built the context.
 */
function buildSectionIntroFallback(inp) {
  var count = Math.max(0, Math.round(inp.questionCount || 0));
  var desc = (inp.description == null ? "" : String(inp.description)).trim();
  var hasTime = !!(inp.timeLimitMinutes && inp.timeLimitMinutes > 0);
  var instr = typeof inp.instruction === "string" ? inp.instruction : "";
  var instrText = instr.replace(/<[^>]*>/g, "").trim();
  var illo = (inp.illustration == null ? "" : String(inp.illustration)).trim();
  return {
    course: { title: inp.topicName || "" },
    sectionIntro: {
      eyebrow: "Раздел " + (inp.sectionNumber || 1),
      topicName: inp.topicName || "",
      description: desc,
      hasDescription: desc.length > 0,
      questionCount: count,
      questionCountLabel: count + " " + pluralQuestions(count),
      hasTimeLimit: hasTime,
      timeLimitLabel: hasTime ? String(inp.timeLimitMinutes) + " " + pluralMinutes(inp.timeLimitMinutes) : "",
      hasInstruction: instrText.length > 0,
      illustrationUrl: illo,
      hasIllustration: illo.length > 0,
      continueLabel: inp.continueLabel || "Далее",
    },
  };
}

function renderSectionIntro(page) {
  var layouts = (typeof state !== "undefined" && state) ? state.templateLayouts : null;
  var layout = layouts && layouts["section-intro"];
  var TB = (typeof window !== "undefined") ? window.TBTemplate : null;
  // NOTE: do NOT require TB.buildSectionIntroContext here — it is a recent export
  // and may be missing from the per-process-cached runtime bundle in dev. Only
  // TB.renderScreenInto (long-present) is required; the context is built via the
  // shared builder when available, else the inline fallback above.
  if (!layout || !TB || !TB.renderScreenInto) return false;

  var sections = (typeof TEST_DATA !== "undefined" && TEST_DATA.sections) || [];
  var section = null, idx = -1;
  for (var i = 0; i < sections.length; i++) {
    if (sections[i].topicId === page.topicId) { section = sections[i]; idx = i; break; }
  }
  if (!section) return false;

  var values = getPageValues(page);
  var instruction = values && values.instruction != null ? String(values.instruction) : "";
  // Author section illustration (image placeholder on the intro content template).
  var illoRaw = values && values.illustration;
  var illustrationUrl = illoRaw && typeof illoRaw === "object" ? (illoRaw.url || "") : (illoRaw || "");
  var introInput = {
    sectionNumber: idx + 1,
    topicName: section.topicName,
    description: section.topicDescription,
    questionCount: section.drawCount,
    timeLimitMinutes: section.timeLimitMinutes,
    instruction: instruction,
    illustration: illustrationUrl,
    continueLabel: "Далее",
  };
  var built = TB.buildSectionIntroContext
    ? TB.buildSectionIntroContext(introInput)
    : buildSectionIntroFallback(introInput);
  var context = {
    course: built.course,
    design: (typeof scormDesignContext === "function") ? scormDesignContext() : {},
    sectionIntro: built.sectionIntro,
  };

  var app = document.getElementById("app");
  app.innerHTML = "";
  // Mount the layout root DIRECTLY into #app (no intermediate wrapper) so the
  // fixed-stage flex chain (.tb-pad > .section-intro-page) applies — mirrors
  // renderGalleryPage. A wrapper div would make the root a grandchild of .tb-pad,
  // defeating the child-combinator fill/anchor rule.
  // The author instruction is sanitized rich text → injected raw via the slot (the
  // same trust model as info-page bodies / the question-interaction slot).
  TB.renderScreenInto(app, { layout: layout, context: context, slots: { instruction: instruction } });
  var btn = app.querySelector('[data-action="section-intro-continue"]');
  if (btn) btn.addEventListener("click", function () {
    if (typeof advancePageSequence === "function") advancePageSequence();
  });
  // «Назад»: return to the ACTUAL previous screen via the recorded nav route
  // (a preceding content page, or the router hub) instead of a hard-coded target
  // — in router mode the section-intro is index 0 of a rebuilt topic chunk, so a
  // plain currentPageIndex-1 clamps to itself and does nothing. Shown only when
  // the layout renders the back button.
  var back = app.querySelector('[data-action="section-intro-back"]');
  if (back) back.addEventListener("click", function () {
    if (typeof navigateBackOrPrevPage === "function") navigateBackOrPrevPage();
  });
  return true;
}

/**
 * Renders a gallery card page (kind `gallery`) via its own layout variant
 * (text / media / list). Header + subheader + card body + the round pill row +
 * Назад/Далее. The pills are a per-page indicator: the two settings
 * (pillsTotal, pillCurrent) are expanded here into a Core-prepared `pills` array
 * the layout renders with `{{#each}}` (the DSL cannot loop over a raw count).
 * «Назад» (shown only when the page's `showBack` setting is on) steps the page
 * sequence back via goToPageSequenceIndex; «Далее» advances it as usual. Each
 * card is a normal content page — no gallery controller / grouping.
 */
function renderGalleryPage(page, contentTemplate) {
  var layouts = (typeof state !== "undefined" && state) ? state.templateLayouts : null;
  var layout = layouts && contentTemplate ? layouts[contentTemplate.key] : null;
  var TB = (typeof window !== "undefined") ? window.TBTemplate : null;
  if (!layout || !TB || !TB.renderScreenInto) return false;

  var values = getPageValues(page) || {};
  var total = parseInt(values.pillsTotal, 10);
  if (!(total > 0)) total = 1;
  var current = parseInt(values.pillCurrent, 10) || 1;
  var pills = [];
  for (var i = 1; i <= total; i++) {
    pills.push({ statusClass: i === current ? "is-current" : "" });
  }

  var img = values.image;
  var imageUrl = img && typeof img === "object" ? (img.url || "") : (img || "");
  var bgRaw = values.backgroundImage;
  var slideBgUrl = bgRaw && typeof bgRaw === "object" ? (bgRaw.url || "") : (bgRaw || "");

  var context = {
    design: (typeof scormDesignContext === "function") ? scormDesignContext() : {},
    course: { title: (typeof TEST_DATA !== "undefined" ? TEST_DATA.title : "") },
    gallery: {
      header: values.header != null ? String(values.header) : "",
      subheader: values.subheader != null ? String(values.subheader) : "",
      imageUrl: imageUrl,
      pills: pills,
      showBack: values.showBack === true || values.showBack === "true",
      nextLabel: (values.nextLabel != null && values.nextLabel !== "") ? String(values.nextLabel) : "Далее"
    }
  };

  var app = document.getElementById("app");
  app.innerHTML = "";
  // cardText is sanitized rich text → injected raw via the slot (same trust model
  // as info-page bodies / the section-intro instruction). Rendered directly into
  // #app (no wrapper) so the fixed-stage flex chain (.tb-pad > .gallery) applies.
  var cardText = values.cardText != null ? String(values.cardText) : "";
  TB.renderScreenInto(app, { layout: layout, context: context, slots: { cardText: cardText } });

  // Per-slide background image (variant-slide setting): applied to the slide root.
  if (slideBgUrl) {
    var slideEl = app.querySelector(".gallery");
    if (slideEl) {
      slideEl.classList.add("has-slide-bg");
      slideEl.style.backgroundImage = 'url("' + String(slideBgUrl).replace(/"/g, "%22") + '")';
    }
  }

  var nextBtn = app.querySelector('[data-nav="next"]');
  if (nextBtn) nextBtn.onclick = function () {
    if (typeof advancePageSequence === "function") advancePageSequence();
  };
  var prevBtn = app.querySelector('[data-nav="prev"]');
  if (prevBtn) prevBtn.onclick = function () {
    // «Назад» follows the recorded nav route (same as section-intro); the router
    // hub fallback covers a gallery that is a topic chunk's first page.
    if (typeof navigateBackOrPrevPage === "function") navigateBackOrPrevPage();
  };
  return true;
}

function renderContentPage(page, contentTemplates) {
  var app = document.getElementById("app");
  if (!app) return;

  // Cancel any previous autoAdvance timer
  var tb = typeof window !== "undefined" ? window.TestBuilder : null;
  if (tb && tb._internal) tb._internal.cancelAutoAdvance();

  // PRD-1 §4.3: «Введение раздела» renders via its own section-intro layout
  // (topic metadata + author instruction), not the generic content wrapper.
  if (page && page.kind === "intro" && renderSectionIntro(page)) return;

  var contentTemplate = findContentTemplate(page, contentTemplates);
  // Gallery pages render via their own layout (header/subheader/card + pills + Назад/Далее).
  if (contentTemplate && contentTemplate.kind === "gallery" && renderGalleryPage(page, contentTemplate)) return;
  var values = getPageValues(page);
  var placeholderStyles = getPagePlaceholderStyles(page);
  var skeleton = buildContentPageSkeleton(page, contentTemplate);

  // Primary path: render the shared `content` layout (wrapper + nav) and fill the
  // page-content slot with the placeholder skeleton — the SAME layout/renderer the
  // web host uses. Falls back to mounting the skeleton directly when absent.
  var layouts = (typeof state !== "undefined" && state) ? state.templateLayouts : null;
  var layout = layouts && layouts["content"];
  var TB = (typeof window !== "undefined") ? window.TBTemplate : null;
  var host;
  if (layout && TB && TB.renderScreenInto) {
    app.innerHTML = "";
    // Mount directly into #app (no wrapper) so .tb-pad > .layout-content-wrap fills
    // the fixed stage and the bottom nav anchors — mirrors renderGalleryPage.
    TB.renderScreenInto(app, {
      layout: layout,
      context: { course: { title: (typeof TEST_DATA !== "undefined" ? TEST_DATA.title : "") } },
      slots: { "page-content": skeleton }
    });
    host = app.querySelector('[data-slot="page-content"]') || app;
    var navBtn = app.querySelector('.navigation [data-nav="next"]');
    if (navBtn) navBtn.onclick = function () { if (typeof advancePageSequence === "function") advancePageSequence(); };
  } else {
    app.innerHTML = skeleton;
    host = app;
    var nav = document.createElement("div");
    nav.className = "navigation";
    nav.style.justifyContent = "flex-end";
    nav.innerHTML = '<button class="btn" data-nav="next" onclick="advancePageSequence()">Далее</button>';
    app.appendChild(nav);
  }

  fillContentPagePlaceholders(host, contentTemplate, values, placeholderStyles, tb);

  // autoAdvance
  if (page.autoAdvance && page.autoAdvanceDelayMs && tb && tb._internal) {
    tb._internal.startAutoAdvance(page.autoAdvanceDelayMs, function () {
      if (typeof advancePageSequence === "function") advancePageSequence();
      else if (typeof next === "function") next();
    });
  }

  // Template lifecycle event
  if (tb && tb.template) {
    tb.template.emit("page:enter", { page: page });
  }
}
