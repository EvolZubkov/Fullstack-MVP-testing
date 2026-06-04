// app/eligibility/gate.js
// PRD-6 retake gate runtime. Runs BEFORE SCORM.Initialize for tests with a
// retake policy (NFR-01/02): evaluates the configured eligibility plugin, and
// either renders a block-wall (blocked => no Initialize, no cmi.*) or a neutral
// "Начать курс" start shell whose click runs the normal course (Initialize +
// flow). Non-gated tests never reach here. Side effects (fetch, suspend_data
// read, render) live here; the pure logic is EligibilityEngine/EligibilityPlugins.
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

  function extractRecords(json) {
    if (Array.isArray(json)) return json;
    if (!json || typeof json !== 'object') return [];
    return json.data || json.rows || json.records || json.items || [];
  }

  function resolveTemplate(tpl, ctx) {
    return String(tpl == null ? '' : tpl).replace(/\{\{\s*test\.title\s*\}\}/g, ctx.test.title);
  }

  // webtutor_cooldown adapter — fetch course records, decide by cooldown. The
  // endpoint is configurable (PRD-6 §4.2); the local scorm-player WebTutor mock
  // answers it for verification.
  function webtutorEvaluate(ctx, config) {
    var endpoint = config.collectionEndpoint || '';
    var params = [];
    if (config.collectionCode) params.push('code=' + encodeURIComponent(config.collectionCode));
    if (config.courseSearchName) params.push('search=' + encodeURIComponent(resolveTemplate(config.courseSearchName, ctx)));
    if (config.limit) params.push('limit=' + encodeURIComponent(config.limit));
    var url = endpoint + (endpoint.indexOf('?') === -1 ? '?' : '&') + params.join('&');
    return fetch(url, { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('webtutor_http_' + r.status);
        return r.json();
      })
      .then(function (json) {
        return EligibilityPlugins.webtutorCooldownDecide(extractRecords(json), config.attemptFilter || {}, ctx);
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

  function renderBlockWall(retake, td) {
    var el = appEl();
    if (!el) return;
    var avail = retake.availableDate ? fmtDateHuman(retake.availableDate) : null;
    var errorNote = retake.reason === 'plugin_error_fail_closed'
      ? '<p class="retake-wall__note">Не удалось проверить доступ. Обратитесь к администратору курса.</p>'
      : '';
    el.innerHTML =
      '<div class="retake-wall" data-testid="retake-wall">' +
      '<div class="retake-wall__card">' +
      '<h1 class="retake-wall__title">Повторное прохождение пока недоступно</h1>' +
      '<p class="retake-wall__lead">Этот курс можно проходить не чаще, чем раз в ' +
      esc(retake.cooldownPeriodDays) + ' дн.</p>' +
      (avail ? '<p class="retake-wall__date">Повторный запуск будет доступен с <strong>' + esc(avail) + '</strong>.</p>' : '') +
      errorNote +
      '</div></div>';
  }

  function renderStartShell(retake, td, onStart) {
    var el = appEl();
    if (!el) { if (typeof onStart === 'function') onStart(); return; }
    el.innerHTML =
      '<div class="retake-shell" data-testid="retake-start-shell">' +
      '<div class="retake-shell__card">' +
      '<h1 class="retake-shell__title">' + esc(td.title || 'Курс') + '</h1>' +
      '<p class="retake-shell__lead">Доступ к прохождению открыт.</p>' +
      '<button type="button" class="retake-shell__btn" data-testid="retake-start-course">Начать курс</button>' +
      '</div></div>';
    var btn = el.querySelector('[data-testid="retake-start-course"]');
    if (btn) btn.addEventListener('click', function () { if (typeof onStart === 'function') onStart(); });
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
      if (!result.allowed) renderBlockWall(retake, td);
      else renderStartShell(retake, td, onAllowedStart);
    });
  }

  return { isGated: isGated, run: run };
})();
