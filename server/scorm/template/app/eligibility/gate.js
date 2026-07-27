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

  // Diagnostics. The gate used to emit ONE line, after deciding, carrying only the
  // normalized reason — so a broken integration was indistinguishable from a
  // non-gated package: `failPolicy` defaults to failOpen, which turns every error
  // (object_id/SECID not resolved, HTTP 403, timeout) into a plain `allowed`, and
  // the underlying message never left `result.data.error`. These trace the whole
  // resolution chain so a live WebTutor run can be read straight from the console.
  function glog() {
    if (typeof console === 'undefined' || !console.log) return;
    var args = ['[PRD-6 gate]'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  }

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

  // Normalize the WebTutor collection response to a flat array of records. The
  // ExtJS json collection returns them under `results` ({success, total, results}).
  function extractRecords(json) {
    if (Array.isArray(json)) return json;
    if (!json || typeof json !== 'object') return [];
    return json.results || json.data || json.rows || json.records || json.items || [];
  }

  function resolveTemplate(tpl, ctx, personId) {
    return String(tpl == null ? '' : tpl)
      .replace(/\{\{\s*test\.title\s*\}\}/g, ctx.test.title)
      .replace(/\{\{\s*personId\s*\}\}/g, personId || '');
  }

  // Scrape the session SECID (32-hex) the collection POST requires. It is present in
  // the portal chrome; `secidSource.endpoint` (default "/") is fetched same-origin.
  function resolveSecid(config) {
    var src = config.secidSource || {};
    var url = src.endpoint || '/';
    var pattern = src.pattern || '[A-F0-9]{32}';
    return fetch(url, { credentials: 'include' })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var m = new RegExp(pattern).exec(html || '');
        return m ? m[0] : '';
      })
      .catch(function () { return ''; });
  }

  // Resolve cur_person_id. WebTutor's collection query is scoped to the learner by
  // `cur_person_id`; it is not in SCORM (pre-Initialize) so it is scraped from the
  // portal chrome via `personIdSource.pattern`, with an optional config override.
  function resolvePersonId(config) {
    if (config.personId) return Promise.resolve(String(config.personId));
    var src = config.personIdSource || {};
    if (!src.pattern) return Promise.resolve('');
    var url = src.endpoint || '/';
    return fetch(url, { credentials: 'include' })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var m = new RegExp(src.pattern).exec(html || '');
        return m ? (m[1] || m[0]) : '';
      })
      .catch(function () { return ''; });
  }

  function formEncode(obj) {
    var out = [];
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        out.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
      }
    }
    return out.join('&');
  }

  // webtutor_cooldown adapter — reads the learner's LEARNING RECORDS (all attempts,
  // any outcome) from WebTutor's ExtJS json collection endpoint, same-origin with the
  // learner session, and decides the cooldown from the latest FINISHED record's date
  // (PRD-6 §3.3/§4.2). This is the correct source per the requirement "cooldown fires
  // after ANY completion, passed OR failed": the course CARD only carries a date for a
  // PASSED course, so it can never gate a failed attempt — the records grid carries
  // `last_usage_date` + `state` («Пройден»/«Не пройден») for every attempt.
  //
  // The request contract (confirmed against the live RT portal, «Мои обучения» grid):
  // POST form fields `secid`, `collection_code`, `parameters` (a `;`-joined string with
  // cur_person_id + sCatalogName), `referer_url`, `page`, `start`, header
  // `X-Requested-With: XMLHttpRequest`. Records come back under `results`, sorted
  // last_usage_date DESC; all assignments of one course share `name` (matched via the
  // filter's nameField = the test title). Endpoint/collection/filter are admin-config.
  function webtutorEvaluate(ctx, config) {
    var endpoint = config.collectionEndpoint || '';
    if (!endpoint) return Promise.reject(new Error('collection_endpoint_not_configured'));
    return Promise.all([resolveSecid(config), resolvePersonId(config)]).then(function (ids) {
      var secid = ids[0], personId = ids[1];
      glog('secid:', secid ? 'found' : '(NOT FOUND)', '| cur_person_id:', personId || '(session-scoped)');
      if (!secid) throw new Error('secid_not_resolved');
      var refererUrl = typeof location !== 'undefined' ? location.href : '';
      var body = formEncode({
        secid: secid,
        limit: config.limit || 500,
        collection_code: config.collectionCode || '',
        parameters: resolveTemplate(config.parametersTemplate || '', ctx, personId),
        referer_url: refererUrl,
        page: 1,
        start: 0
      });
      var url = endpoint + (endpoint.indexOf('?') === -1 ? '?' : '&') + '_dc=' + (ctx.runtime.todayDate || '');
      glog('collection POST:', endpoint, '| collection_code:', config.collectionCode);
      return fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json'
        },
        body: body
      }).then(function (r) {
        glog('collection HTTP', r.status);
        if (!r.ok) throw new Error('webtutor_http_' + r.status);
        return r.json();
      }).then(function (json) {
        if (json && json.success === false) throw new Error('collection_error: ' + (json.messageText || 'unknown'));
        var records = extractRecords(json);
        glog('records:', records.length, '| total:', (json && json.total), '| course:', ctx.test.title,
          '| filter:', JSON.stringify(config.attemptFilter || {}));
        var result = EligibilityPlugins.webtutorCooldownDecide(records, config.attemptFilter || {}, ctx, ctx.test.title);
        glog('selected lastAttemptDate:',
          (result.data && result.data.lastAttemptDate) || '(none — no finished attempt for this course)');
        return result;
      });
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
      .catch(function (e) {
        var msg = (e && e.message) ? e.message : String(e);
        glog('plugin FAILED:', msg, '- applying failPolicy:', failPolicy,
          failPolicy === 'failClosed' ? '(blocked)' : '(ALLOWED — the gate is now inert)');
        return EligibilityEngine.applyFailPolicy(failPolicy, msg);
      });
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
    if (typeof loadDesignTemplate !== 'function') return Promise.resolve(null);
    var settled = false;
    var load = loadDesignTemplate()
      .then(function () { settled = true; return (typeof state !== 'undefined' && state) ? state.templateLayouts : null; })
      .catch(function () { settled = true; return null; });
    // Safety net: the template fetch can HANG (not reject) on WebTutor's cplayer —
    // the SCO runs in a sandboxed iframe and package-local fetches may stall with no
    // response and no error, leaving the learner on «Загрузка теста…» forever. Cap it
    // so the blocked screen always renders (null => built-in wall fallback). `settled`
    // keeps the timer quiet once the load has already resolved (setTimeout still fires).
    var timeout = new Promise(function (resolve) {
      setTimeout(function () {
        if (settled) return;
        glog('ensureTemplate timed out — falling back to built-in wall');
        resolve(null);
      }, 4000);
    });
    return Promise.race([load, timeout]);
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
    if (!node) return;
    node.style.display = shown ? '' : 'none';
    // Also toggle the `hidden` attribute: the layout hides inactive branches with it
    // initially, and a scene rule keys off `[hidden]` — clearing style.display alone
    // would leave a shown branch hidden by the attribute.
    if (shown) node.removeAttribute('hidden');
    else node.setAttribute('hidden', '');
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
    ensureTemplate().then(function (layouts) {
      // Re-fetch #app AFTER the template loads: applyTemplateShell (mountShell) may
      // have REPLACED #app with the shell's node, detaching the one captured earlier.
      var el = appEl();
      if (!el) return;
      var html = layouts && layouts[blockedLayoutKey(td)];
      if (!html) { renderBlockWallBuiltin(retake, el); return; }
      el.innerHTML = html;
      var view = {
        // Shared header: test title + attempt subtitle (path-only DSL fills data-path).
        course: {
          title: (td && td.title) || (typeof TEST_DATA !== 'undefined' && TEST_DATA ? TEST_DATA.title : '') || '',
          subtitle: (typeof scormCourseSubtitle === 'function') ? scormCourseSubtitle() : ''
        },
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
    if (typeof document === 'undefined') return;
    glog('rendering cooldown state...');
    // Last-resort safety net: whatever hangs or throws below (template fetch stall,
    // renderScreenInto error), guarantee the learner sees the cooldown message rather
    // than an endless «Загрузка теста…». Fires the built-in wall if nothing rendered.
    // Always re-fetch #app at write time: applyTemplateShell (mountShell) REPLACES
    // #app with the shell's node — writing to a pre-captured reference renders into a
    // detached node (visible symptom: content invisible, «Загрузка теста…» stays).
    var rendered = false;
    function fallbackWall() {
      if (rendered) return;
      var elw = appEl();
      if (!elw) return;
      try { renderBlockWallBuiltin(retake, elw); rendered = true; } catch (e) { glog('built-in wall failed:', (e && e.message) || e); }
    }
    setTimeout(function () {
      if (rendered) return;
      glog('cooldown render did not complete in time — forcing built-in wall');
      fallbackWall();
    }, 4500);
    ensureTemplate().then(function (layouts) {
      if (rendered) return;
      var el = appEl(); // fresh: #app may have been replaced by the shell mount
      if (!el) return;
      var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
      var layout = layouts && layouts['start'];
      glog('template ready. start layout:', !!layout, '| TBTemplate:', !!(TB && TB.renderScreenInto), '| #app:', !!el);
      if (!layout || !TB || !TB.renderScreenInto || !TB.buildStartState) {
        renderBlockWall(retake, td);
        rendered = true;
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
      rendered = true;
      glog('cooldown state rendered on start page');
      // No action wiring: the start button is disabled and nothing else is
      // clickable pre-Initialize, so the SCORM session stays unopened.
    }).catch(function (e) {
      // A throw here (renderScreenInto / buildStartState) was previously an unhandled
      // rejection: no log, learner stuck on the loading text. Fall back to the wall.
      glog('cooldown render error:', (e && e.message) || e);
      fallbackWall();
    });
  }

  function run(td, onAllowedStart) {
    var ctx = buildContext(td);
    glog('gated. plugin:', td.retakePlugin.runtimeEntry,
      '| cooldownPeriodDays:', ctx.retakePolicy.cooldownPeriodDays,
      '| today:', ctx.runtime.todayDate);
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
      // buildRetakeState drops `data`, so the underlying error would otherwise be
      // lost even though the verdict was decided by failPolicy rather than by data.
      if (result.data && result.data.error) glog('decided by failPolicy. error was:', result.data.error);
      glog('lastAttemptDate:', (result.data && result.data.lastAttemptDate) || '(none)',
        '| availableDate:', retake.availableDate || '(none)');
      // PRD-19 FR-19: eligible => NO gate-shell. Hand straight to the normal
      // course (onAllowedStart = runCourse: Initialize + the standard start page),
      // so an elapsed-cooldown test is indistinguishable from an ordinary one.
      // FR-20: blocked => the cooldown state renders ON the standard start page
      // (pre-Initialize), not a separate wall — NFR-01/02 still hold.
      if (!result.allowed) renderCooldownStart(retake, td);
      else onAllowedStart();
    }).catch(function (e) {
      // evaluate() already absorbs plugin errors via failPolicy, so reaching here
      // means the GATE itself broke (state build / template render). Previously this
      // was an unhandled rejection: no log, and a learner left on a blank #app.
      glog('GATE CRASHED after the verdict:', (e && e.stack) || e, '- starting the course (failOpen spirit)');
      try { onAllowedStart(); } catch (e2) { glog('course start also failed:', (e2 && e2.stack) || e2); }
    });
  }

  return { isGated: isGated, run: run };
})();
