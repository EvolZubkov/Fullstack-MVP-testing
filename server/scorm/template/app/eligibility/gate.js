// app/eligibility/gate.js
// PRD-6 retake gate runtime. Runs BEFORE SCORM.Initialize for tests with a
// retake policy (NFR-01/02): evaluates the configured eligibility plugin, and
// either renders a block-wall (blocked => no Initialize, no cmi.*) or — when
// eligible — hands straight to the normal course (Initialize + flow) with NO
// extra gate-shell (PRD-19 FR-19: an elapsed-cooldown test is indistinguishable
// from an ordinary test). Non-gated tests never reach here. Side effects (fetch,
// suspend_data read, render) live here; the pure logic is
// EligibilityEngine/EligibilityPlugins.
var RetakeGate = (function () {
  var GATE_TIMEOUT_MS = 5000; // NFR-06

  function esc(s) {
    return typeof escapeHtml === 'function' ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);
  }

  function isGated(td) {
    var rp = td && td.retakePolicy;
    return !!(
      rp && rp.enabled === true &&
      rp.eligibilityPlugin && rp.eligibilityPlugin.key &&
      td.retakePlugin && td.retakePlugin.runtimeEntry
    );
  }

  function todayIso() {
    var now = new Date();
    var epoch = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
    return EligibilityEngine.formatIsoDate(epoch);
  }

  function buildContext(td) {
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { tz = ''; }
    return {
      test: { id: td.id || '', title: td.title || '' },
      retakePolicy: { cooldownPeriodDays: td.retakePolicy.cooldownPeriodDays },
      runtime: {
        todayDate: todayIso(),
        timezone: tz,
        launchUrl: typeof location !== 'undefined' ? location.href : ''
      },
      lms: { scormVersion: '2004' },
      config: td.retakePlugin.config || {}
    };
  }

  // Resolve the WebTutor course object_id from the launch context (confirmed on
  // the live portal: present in the course-card referer / launch path).
  function resolveObjectId(config) {
    var pats = config.objectIdPatterns || ['object_id=(\\d{6,})', '_wt/course/(\\d{6,})', 'cplayer2/(\\d{6,})'];
    function safeUrl(getter) { try { return getter() || ''; } catch (e) { return ''; } }
    // Our SCO runs nested inside WebTutor's cplayer2; object_id lives in the
    // parent/top URL (confirmed on the live portal across ≥2 modules), and the
    // frames are same-origin, so top/parent.location are readable.
    var sources = [
      typeof location !== 'undefined' ? location.href : '',
      typeof document !== 'undefined' ? document.referrer : '',
      safeUrl(function () { return window.top.location.href; }),
      safeUrl(function () { return window.parent.location.href; })
    ];
    for (var i = 0; i < sources.length; i++) {
      for (var j = 0; j < pats.length; j++) {
        var m = new RegExp(pats[j]).exec(sources[i] || '');
        if (m) return m[1];
      }
    }
    return config.objectIdFallback || null;
  }

  // webtutor_cooldown adapter — confirmed against the live RT portal. The course
  // completion date is NOT in SCORM (no adl.data) and NOT in server HTML; it is
  // served by the ClientBridge `get_metadata` SOAP (the course-card screen), which
  // needs a per-page SECID scraped from the course card. So the gate, same-origin
  // with the learner session: (1) GET course card -> scrape SECID; (2) POST SOAP
  // get_metadata{form_url, wsparams(object_id, SECID)}; (3) parse «Курс был пройден
  // ДД.ММ.ГГГГ». All endpoints/markers are admin-config (PRD-6 §4.2/NFR-03); the
  // local scorm-player mock answers both calls for verification.
  function webtutorEvaluate(ctx, config) {
    var oid = resolveObjectId(config);
    if (!oid) return Promise.reject(new Error('object_id_not_resolved'));
    var origin = typeof location !== 'undefined' ? location.origin : '';
    var coursePageUrl = (config.coursePageUrlTemplate || '/view_doc.html?mode=course&object_id={{oid}}').replace(/\{\{oid\}\}/g, oid);
    return fetch(coursePageUrl, { credentials: 'include' })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var secid = EligibilityPlugins.extractSecid(html, config.secidPattern);
        if (!secid) throw new Error('secid_not_found');
        var ws = 'PAGEURL=' + encodeURIComponent(origin + '/_wt/course/' + oid)
          + '&REQUESTURL=' + encodeURIComponent(origin + '/view_doc.html?mode=course&object_id=' + oid)
          + '&CLIENTWINDOWSIZE=1000,800&SECID=' + secid
          + '&sysparam=&parent_template_id=' + (config.parentTemplateId || '') + '&playerid=extjs5';
        var soap = '<?xml version="1.0" encoding="utf-8"?>'
          + '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>'
          + '<get_metadata xmlns="http://www.datex-soft.com/"><form_url>' + (config.formUrl || '') + '</form_url>'
          + '<wsparams>' + ws.replace(/&/g, '&amp;') + '</wsparams></get_metadata></soap:Body></soap:Envelope>';
        return fetch(config.endpoint || '/services/ClientBridgeService', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'text/xml; charset=UTF-8', 'SOAPAction': config.soapAction || 'http://www.datex-soft.com/get_metadata' },
          body: soap
        });
      })
      .then(function (r) {
        if (!r.ok) throw new Error('webtutor_http_' + r.status);
        return r.text();
      })
      .then(function (xml) {
        var date = EligibilityPlugins.extractCourseCompletionDate(xml, {
          completionMarker: config.completionMarker,
          dateFormat: config.dateFormat
        });
        return EligibilityPlugins.cooldownDecideFromDate(date, ctx, 'webtutor_cooldown');
      });
  }

  // suspend_data_cooldown adapter — best-effort read of a date carried in
  // suspend_data (PRD-6 §4.6). Pre-Initialize reads are unreliable; tolerate failure.
  function suspendEvaluate(ctx) {
    var date = null;
    try {
      if (typeof SCORM !== 'undefined' && SCORM.getValue) {
        var raw = SCORM.getValue('cmi.suspend_data');
        if (raw) {
          var obj = JSON.parse(raw);
          date = (obj && obj.retake && obj.retake.lastCompletedDate) || null;
        }
      }
    } catch (e) { date = null; }
    return Promise.resolve(EligibilityPlugins.suspendDataCooldownDecide(date, ctx));
  }

  function runPlugin(td, ctx) {
    var entry = td.retakePlugin.runtimeEntry;
    if (entry === 'webtutorCooldown') return webtutorEvaluate(ctx, td.retakePlugin.config || {});
    if (entry === 'suspendDataCooldown') return suspendEvaluate(ctx);
    return Promise.resolve(true); // unknown adapter => allow (core default spirit)
  }

  function evaluate(td, ctx) {
    var failPolicy = (td.retakePolicy.eligibilityPlugin && td.retakePolicy.eligibilityPlugin.failPolicy) || 'failOpen';
    var work;
    try { work = Promise.resolve(runPlugin(td, ctx)); } catch (e) { work = Promise.reject(e); }
    var timeout = new Promise(function (_resolve, reject) {
      setTimeout(function () { reject(new Error('eligibility_timeout')); }, GATE_TIMEOUT_MS);
    });
    return Promise.race([work, timeout])
      .then(function (v) { return EligibilityEngine.normalizeVerdict(v); })
      .catch(function (e) { return EligibilityEngine.applyFailPolicy(failPolicy, (e && e.message) ? e.message : String(e)); });
  }

  function appEl() {
    return typeof document !== 'undefined' ? document.getElementById('app') : null;
  }

  function fmtDateHuman(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? (m[3] + '.' + m[2] + '.' + m[1]) : iso;
  }

  // Whole days from today until the ISO date (UTC day granularity), or null when
  // not in the future. Drives the optional «через N дн.» on the cooldown start.
  function daysUntilIso(iso) {
    if (!iso) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return null;
    var target = Date.UTC(+m[1], (+m[2]) - 1, +m[3]);
    var now = new Date();
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    var d = Math.ceil((target - today) / 86400000);
    return d > 0 ? d : null;
  }

  // The block page is a SYSTEM PAGE of the design template (PRD-6 §4.4): the gate
  // renders the template's `system.blocked` layout and fills `retake.*` via the
  // shared path-DSL. The template manifest/layouts are NOT loaded yet at gate time
  // (loadDesignTemplate runs inside runCourse, which the blocked path never reaches),
  // so the gate loads them itself — a pure fetch of package-local files that does NOT
  // touch SCORM, so NFR-01/02 (no Initialize before the gate decides) still holds.
  function ensureTemplate() {
    var layouts = (typeof state !== 'undefined' && state) ? state.templateLayouts : null;
    // `state.templateLayouts` is initialised to an EMPTY object (state.js), and
    // loadDesignTemplate runs only inside runCourse — which the gate never reaches.
    // So an empty map means "not loaded yet": load it ourselves (a pure package-local
    // fetch, no SCORM). Treating {} as loaded made the gate render its built-in wall
    // instead of the template's system.blocked / start screens.
    if (layouts && Object.keys(layouts).length > 0) return Promise.resolve(layouts);
    if (typeof loadDesignTemplate === 'function') {
      return loadDesignTemplate()
        .then(function () { return (typeof state !== 'undefined' && state) ? state.templateLayouts : null; })
        .catch(function () { return null; });
    }
    return Promise.resolve(null);
  }

  function blockedLayoutKey(td) {
    var rp = td && td.retakePolicy;
    return (rp && rp.blockedPageId) || 'system.blocked';
  }

  function tbInternal() {
    var tb = (typeof window !== 'undefined' && window.TestBuilder) ||
      (typeof TestBuilder !== 'undefined' ? TestBuilder : null);
    return (tb && tb._internal) || null;
  }

  function setShown(node, shown) {
    if (node) node.style.display = shown ? '' : 'none';
  }

  // Toggle the layout's `data-retake-branch` blocks to the relevant message:
  // cooldown (default) or error (failClosed). The unused `availableDate` line is
  // hidden when the plugin could not report a next-available date.
  function applyBlockBranches(el, retake) {
    var isError = !!(retake && retake.reason === 'plugin_error_fail_closed');
    setShown(el.querySelector('[data-retake-branch="default"]'), false);
    setShown(el.querySelector('[data-retake-branch="cooldown"]'), !isError);
    setShown(el.querySelector('[data-retake-branch="error"]'), isError);
    if (!isError && !(retake && retake.availableDate)) {
      setShown(el.querySelector('[data-retake-available]'), false);
    }
  }

  // Fallback wall used only when the template carries no `system.blocked` layout
  // (e.g. a template without it) so the learner never sees a blank screen.
  function renderBlockWallBuiltin(retake, el) {
    var avail = retake.availableDate ? fmtDateHuman(retake.availableDate) : null;
    var errorNote = retake.reason === 'plugin_error_fail_closed'
      ? '<p class="retake-wall__note">Не удалось проверить доступ. Обратитесь к администратору теста.</p>'
      : '';
    el.innerHTML =
      '<div class="retake-wall" data-testid="retake-wall">' +
      '<div class="retake-wall__card">' +
      '<h1 class="retake-wall__title">Повторное прохождение пока недоступно</h1>' +
      '<p class="retake-wall__lead">Этот тест можно проходить не чаще, чем раз в ' +
      esc(retake.cooldownPeriodDays) + ' дн.</p>' +
      (avail ? '<p class="retake-wall__date">Повторный запуск будет доступен с <strong>' + esc(avail) + '</strong>.</p>' : '') +
      errorNote +
      '</div></div>';
  }

  function renderBlockWall(retake, td) {
    var el = appEl();
    if (!el) return;
    ensureTemplate().then(function (layouts) {
      var html = layouts && layouts[blockedLayoutKey(td)];
      if (!html) { renderBlockWallBuiltin(retake, el); return; }
      el.innerHTML = html;
      var view = {
        retake: {
          cooldownPeriodDays: retake.cooldownPeriodDays,
          availableDate: retake.availableDate,
          availableDateHuman: retake.availableDate ? fmtDateHuman(retake.availableDate) : ''
        }
      };
      var internal = tbInternal();
      if (internal && internal.renderPathOnlyDsl) internal.renderPathOnlyDsl(el, view);
      applyBlockBranches(el, retake);
    });
  }

  // PRD-19 FR-20: render the cooldown state ON the normal start page (start.html)
  // instead of a separate block-wall — pre-Initialize, so a blocked test never
  // opens a SCORM session (NFR-01/02). Only the date + a DISABLED start button are
  // shown: the prior result / report are NOT offered here because suspend_data is
  // unavailable before Initialize (and WebTutor has no cross-attempt store), so the
  // builder gets no prior facts. Falls back to the block-wall if the active
  // template ships no `start` layout (every conformant template does).
  function renderCooldownStart(retake, td) {
    var el = appEl();
    if (!el) return;
    ensureTemplate().then(function (layouts) {
      var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
      var layout = layouts && layouts['start'];
      if (!layout || !TB || !TB.renderScreenInto || !TB.buildStartState) {
        renderBlockWall(retake, td);
        return;
      }
      var ctx = TB.buildStartState({
        info: {
          title: td.title || '',
          description: td.description || '',
          questionCount: td.totalQuestions,
          passPercent: td.passPercent,
          timeLimitMinutes: td.timeLimitMinutes,
          maxAttempts: td.maxAttempts
        },
        maxAttempts: td.maxAttempts || null,
        completedAttempts: 0,
        resume: null,
        hasCompletedResults: false,
        canStartNew: false,
        cooldown: {
          availableDateHuman: retake.availableDate ? fmtDateHuman(retake.availableDate) : '',
          daysUntil: daysUntilIso(retake.availableDate)
        }
      });
      ctx.design = (typeof scormDesignContext === 'function') ? scormDesignContext() : {};
      if (typeof applySystemScreenStyles === 'function') applySystemScreenStyles('start');
      el.innerHTML = '';
      // Mount directly into #app so .tb-pad > .cover fills the fixed stage — mirrors
      // renderGalleryPage (a wrapper div would defeat the child-combinator rule).
      TB.renderScreenInto(el, { layout: layout, context: ctx });
      // No action wiring: the start button is disabled and nothing else is
      // clickable pre-Initialize, so the SCORM session stays unopened.
    });
  }

  function run(td, onAllowedStart) {
    var ctx = buildContext(td);
    evaluate(td, ctx).then(function (result) {
      var retake = EligibilityEngine.buildRetakeState(result, {
        todayDate: ctx.runtime.todayDate,
        cooldownPeriodDays: ctx.retakePolicy.cooldownPeriodDays
      });
      if (typeof state !== 'undefined' && state) state.retake = retake;
      if (typeof console !== 'undefined' && console.log) {
        console.log('PRD-6 retake gate:', result.allowed ? 'allowed' : 'blocked',
          '(' + (retake.reason || '') + (retake.availableDate ? ', available ' + retake.availableDate : '') + ')');
      }
      // PRD-19 FR-19: eligible => NO gate-shell. Hand straight to the normal
      // course (onAllowedStart = runCourse: Initialize + the standard start page),
      // so an elapsed-cooldown test is indistinguishable from an ordinary one.
      // FR-20: blocked => the cooldown state renders ON the standard start page
      // (pre-Initialize), not a separate wall — NFR-01/02 still hold.
      if (!result.allowed) renderCooldownStart(retake, td);
      else onAllowedStart();
    });
  }

  return { isGated: isGated, run: run };
})();
