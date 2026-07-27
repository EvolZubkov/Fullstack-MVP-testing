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
 * Content-page assembly is SHARED with the web host — the rules live in
 * `shared/template/content-page` and reach this runtime through the `TBTemplate`
 * bundle. These wrappers keep the historical global names (renderSectionIntro,
 * renderGalleryPage and the offline preview generator call them) while holding no
 * logic of their own: a second copy here is exactly what let the two hosts drift
 * until the web could not render content pages at all (PRD-12 FR-6).
 * @param {object} page  A content page from TEST_DATA.contentPages
 * @param {Array}  contentTemplates  From the design template manifest
 * @returns {object|null}
 */
function findContentTemplate(page, contentTemplates) {
  // PRD-22 (plan Э5): a page whose variant this template does not declare renders
  // through the kind's DEFAULT variant instead of the untemplated fallback card —
  // the binding in the database is untouched, so the author still decides via
  // «Сменить вариант». Returns null only when the template declares no variant of
  // the kind at all.
  return TBTemplate.resolveContentTemplate(page, contentTemplates).template;
}

/**
 * Fallback markup for a page with no usable content template.
 * @param {object} page
 * @returns {string}
 */
function buildFallbackContentHtml(page) {
  return TBTemplate.buildFallbackContentHtml(page);
}

/**
 * Builds the [data-placeholder] skeleton for a page from its content template.
 * @param {object} page
 * @param {object} contentTemplate
 * @returns {string}
 */
function buildContentPageSkeleton(page, contentTemplate) {
  return TBTemplate.buildContentPageSkeleton(page, contentTemplate);
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
  return TBTemplate.getPageValues(page);
}

function getPagePlaceholderStyles(page) {
  return TBTemplate.getPagePlaceholderStyles(page);
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
  // Falls back to the standard template's section-intro when this template declares
  // no `intro` variant (PRD-1 §4.3.2); returning false below drops the page to the
  // generic content render, which is what a template without the screen should get.
  var layout = (typeof systemLayout === "function")
    ? systemLayout("section-intro")
    : ((typeof state !== "undefined" && state && state.templateLayouts) || {})["section-intro"];
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
  if (typeof applySystemScreenStyles === "function") applySystemScreenStyles("section-intro");
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
 * PRD-22 FR-36: resolves relative links in author values against the template's
 * assets, which the package stores under `template/`. Without a base a link like
 * `images/diagram.png` would resolve next to index.html, where nothing lives.
 * @param {object} values  Author values of a content page
 * @returns {object} the same values with relative src/href prefixed
 */
function withTemplateAssets(values) {
  var TB = (typeof window !== "undefined") ? window.TBTemplate : null;
  if (!TB || !TB.withTemplateAssetBaseInValues) return values;
  return TB.withTemplateAssetBaseInValues(values, "template/");
}

/**
 * PRD-22: the `page.*` context of a content page — navigation dots of its
 * sequence plus the back affordance. Sequences are computed by the SHARED core
 * from the test's structure, so the LMS package, the web host and the preview
 * count identically; `canGoBack` is host state and is supplied here, because only
 * the runtime knows whether there is a screen to return to (in router mode the
 * first page of a topic returns to the hub).
 * @param {object} page  A content page from TEST_DATA.contentPages
 * @returns {object} `{ dots, dotIndex, dotsTotal, canGoBack }`
 */
function buildPageRenderContext(page) {
  var TB = (typeof window !== "undefined") ? window.TBTemplate : null;
  var canGoBack =
    (typeof canNavigateBack === "function" && canNavigateBack()) ||
    (typeof state !== "undefined" && state && (state.currentPageIndex || 0) > 0) ||
    (typeof RouterFlow !== "undefined" && RouterFlow.isRouterMode && RouterFlow.isRouterMode());
  if (!TB || !TB.buildPageContextFor || !page) {
    return { dots: [], dotIndex: 0, dotsTotal: 0, canGoBack: !!canGoBack };
  }
  var pages = (typeof TEST_DATA !== "undefined" && TEST_DATA.contentPages) ? TEST_DATA.contentPages : [];
  return TB.buildPageContextFor(page.id, pages, { canGoBack: !!canGoBack });
}

/**
 * Applies the page's `backgroundImage` setting (PRD-22 FR-27) to the screen root.
 * A background is a page PROPERTY, not content: it never goes through a
 * placeholder region, so the core applies it directly.
 * @param {Element} app   The #app element the screen was rendered into
 * @param {object}  page  A content page from TEST_DATA.contentPages
 */
function applyPageBackground(app, page) {
  var settings = (page && (page.settings || page.settingsJson)) || {};
  var raw = settings.backgroundImage;
  var url = raw && typeof raw === "object" ? (raw.url || "") : (raw || "");
  if (!url) return;
  var root = app.firstElementChild || app;
  root.classList.add("has-slide-bg");
  root.style.backgroundImage = 'url("' + String(url).replace(/"/g, "%22") + '")';
}

/**
 * Finds the layout's OWN navigation button for a direction (`next` / `prev`).
 *
 * The contract is the `data-nav` attribute, not the wrapper's class: a layout is
 * free to name its footer whatever it likes (`.navigation`, `.gallery__nav`, …),
 * and the certification gallery does exactly that. Keying the lookup on
 * `.navigation` left such a layout with a dead «Далее».
 *
 * Buttons INSIDE the page-content slot belong to the author's content, not to the
 * screen chrome, so they are skipped — a stray `data-nav` in pasted markup must
 * not become the screen's navigation.
 * @param {Element} app  The #app element the screen was rendered into
 * @param {string}  dir  Navigation direction: `"next"` or `"prev"`
 * @returns {Element|null}
 */
function findScreenNavButton(app, dir) {
  var nodes = app.querySelectorAll('[data-nav="' + dir + '"]');
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    if (node.closest && node.closest('[data-slot="page-content"]')) continue;
    return node;
  }
  return null;
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
  // PRD-22 FR-36: relative links in author content point at the TEMPLATE's files,
  // which live under `template/` inside the package. The stored value is
  // host-independent, so the base is applied here, at render time.
  var values = withTemplateAssets(getPageValues(page));
  var placeholderStyles = getPagePlaceholderStyles(page);
  var skeleton = buildContentPageSkeleton(page, contentTemplate);

  // Primary path: render the page's layout and fill the page-content slot with the
  // placeholder skeleton — the SAME layout/renderer the web host uses. The variant's
  // own `layoutFile` wins (spec §8.2): a template may ship one layout per page, and
  // resolving everything through the single `content` key would render them all as
  // whichever page that key happens to point at. Falls back to `content`, then to
  // mounting the skeleton directly.
  var layouts = (typeof state !== "undefined" && state) ? state.templateLayouts : null;
  // A variant's own layout is only usable when THIS path can supply the context it
  // binds against. `intro` variants render section-intro, which needs `sectionIntro.*`
  // — built by renderSectionIntro from the page's section. When that declined (an
  // `intro` page with no matching section, e.g. a test-scope one), rendering its
  // layout here produced a blank card: every binding empty and the continue button
  // unwired. The generic wrapper at least shows the author's content and navigates.
  var declinedOwnLayout = page && page.kind === "intro";
  var layout = (layouts && !declinedOwnLayout && contentTemplate && contentTemplate.layoutFile && layouts[contentTemplate.layoutFile])
    || (layouts && layouts["content"]);
  var TB = (typeof window !== "undefined") ? window.TBTemplate : null;
  var host;
  if (layout && TB && TB.renderScreenInto) {
    app.innerHTML = "";
    // PRD-22: navigation dots + header caption/progress of the page sequence,
    // computed by the shared core from the structure — the author supplies only
    // the identifier. A layout without an indicator simply ignores the block.
    var pageCtx = buildPageRenderContext(page);
    // Mount directly into #app (no wrapper) so .tb-pad > .tb-scene fills
    // the fixed stage and the bottom nav anchors.
    TB.renderScreenInto(app, {
      layout: layout,
      context: {
        course: {
          title: (typeof TEST_DATA !== "undefined" ? TEST_DATA.title : ""),
          subtitle: (typeof scormCourseSubtitle === "function") ? scormCourseSubtitle() : ""
        },
        page: pageCtx
      },
      slots: { "page-content": skeleton }
    });
    host = app.querySelector('[data-slot="page-content"]') || app;
    var navBtn = findScreenNavButton(app, "next");
    if (navBtn) navBtn.onclick = function () { if (typeof advancePageSequence === "function") advancePageSequence(); };
    // «Назад» is optional: only layouts that render it get it wired, and it
    // follows the recorded nav route (router hub fallback included).
    var prevBtn = findScreenNavButton(app, "prev");
    if (prevBtn) prevBtn.onclick = function () {
      if (typeof navigateBackOrPrevPage === "function") navigateBackOrPrevPage();
    };
    applyPageBackground(app, page);
  } else {
    app.innerHTML = skeleton;
    host = app;
    var nav = document.createElement("div");
    nav.className = "navigation";
    nav.style.justifyContent = "flex-end";
    nav.innerHTML = '<button class="ou-btn ou-btn--primary ou-btn--m" data-nav="next" onclick="advancePageSequence()">Далее</button>';
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
