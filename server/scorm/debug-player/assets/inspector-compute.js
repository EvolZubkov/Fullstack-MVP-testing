// ─── Debug-player inspector COMPUTE layer (framework-free, no DOM) ───────────────
// PRD-18 (FR-13, R-1): the single source of the inspector's correctness-critical
// logic — reading the live package window, pricing answers (PRD-10), scale
// contributions (PRD-5), humanising LMS traffic, flattening runtime state. It
// returns DATA only (no HTML). BOTH hosts consume it: the CLI player's
// `inspector.js` renders this data as its own HTML; the in-service player (React)
// renders the SAME data as DS components. Exposed on `window.TBInspector`.
(function () {
  // ── Formatters (data, not markup) ──
  function fmtNum(n) { return (typeof n === "number" && isFinite(n)) ? Math.round(n * 100) / 100 : null; }
  function trunc(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) + "…" : s; }
  function byteLen(s) { try { return new Blob([String(s)]).size; } catch (e) { return String(s).length; } }
  function fmtBytes(n) { return n < 1024 ? n + " Б" : (n / 1024).toFixed(1) + " КБ"; }

  // ── Read live globals straight off the package window (same-origin) ──
  // The package concatenates its app modules into one non-module script, so
  // state, TEST_DATA, ScoringEngine, computeTestScales, … live on the iframe
  // window. Same-origin (served from /play/:token) lets us read them directly.
  function readPkg(stageWindow) {
    var w = stageWindow;
    if (!w) return null;
    var live = { w: w, hasData: false, hasEngine: false, mode: "standard", TEST_DATA: null, state: null,
      scaleDefs: [], varDefs: [], measurements: [], scales: {}, results: {}, scaleErrors: [], resultErrors: [] };
    try {
      var TD = w.TEST_DATA;
      if (TD && typeof TD === "object") {
        live.hasData = true; live.TEST_DATA = TD;
        live.scaleDefs = TD.scales || []; live.varDefs = TD.resultVariables || [];
        live.measurements = TD.measurements || []; live.mode = TD.mode || "standard";
      }
    } catch (e) {}
    try { live.state = w.state || null; } catch (e) {}
    // Has the learner actually STARTED the run? Before «Начать тестирование» the
    // phase is 'start' (the package pre-generates the variant at bootstrap, so a
    // verdict/protocol must NOT be shown yet — 0% would read as «Не пройден»).
    live.started = !!(live.state && live.state.phase && live.state.phase !== "start");
    try {
      if (typeof w.computeTestScales === "function") {
        var sc = w.computeTestScales();
        if (sc) { live.hasEngine = true; live.scales = sc.values || {}; live.scaleErrors = sc.errors || []; }
        var results = {};
        try { if (typeof w.calculateResults === "function") results = w.calculateResults() || {}; } catch (e) {}
        if (typeof w.computeTestResultVariables === "function") {
          var rc = w.computeTestResultVariables(results, sc || { values: {}, errors: [] });
          if (rc) { live.results = rc.values || {}; live.resultErrors = rc.errors || []; }
        }
      }
    } catch (e) { live.engineError = String(e && e.message ? e.message : e); }
    return live;
  }

  // ── Parse what actually went to the LMS from the cmi store ──
  function parseInteractions(cmi) {
    var byIdx = {};
    for (var k in cmi) {
      var m = /^cmi\.interactions\.(\d+)\.(.+)$/.exec(k);
      if (!m) continue;
      (byIdx[m[1]] = byIdx[m[1]] || {})[m[2]] = cmi[k];
    }
    return Object.keys(byIdx).sort(function (a, b) { return a - b; }).map(function (i) { return byIdx[i]; });
  }
  function interactionById(ints, id) {
    for (var i = 0; i < ints.length; i++) if (ints[i].id === id) return ints[i];
    return null;
  }

  /**
   * Answered by picking ONE option index — 'single' and 'scale'. Mirrors
   * `isSingleIndexChoice` (shared/questions/question-type); this file is loaded as a
   * standalone script in the debug-player host page, so it cannot reach the package's
   * `TBQType` global and keeps its own copy.
   */
  function isOneIndexChoice(t) {
    return t === "single" || t === "scale";
  }

  function typeLabel(t) {
    return t === "single" ? "Один ответ" : t === "multiple" ? "Несколько" :
      t === "matching" ? "Соответствие" : t === "ranking" ? "Ранжирование" :
      t === "scale" ? "Шкала" : t === "allocation" ? "Распределение баллов" : (t || "?");
  }

  // Human-readable answer using the package's own option/left/right/items text.
  function humanAnswer(q, ans) {
    if (ans === null || ans === undefined) return "(нет ответа)";
    var d = q.data || {};
    if (isOneIndexChoice(q.type)) {
      var o = d.options || [];
      return (typeof ans === "number" && o[ans] != null) ? o[ans] : "#" + ans;
    }
    if (q.type === "multiple") {
      var o2 = d.options || [], arr = Array.isArray(ans) ? ans : [];
      if (!arr.length) return "(нет ответа)";
      return arr.map(function (ix) { return o2[ix] != null ? o2[ix] : "#" + ix; }).join("; ");
    }
    if (q.type === "matching") {
      var L = d.left || [], R = d.right || [], keys = Object.keys(ans || {});
      if (!keys.length) return "(нет ответа)";
      return keys.map(function (k) {
        var r = ans[k];
        return (L[k] != null ? L[k] : "#" + k) + " → " + (R[r] != null ? R[r] : "#" + r);
      }).join("; ");
    }
    if (q.type === "ranking") {
      var it = d.items || [], order = Array.isArray(ans) ? ans : [];
      return order.map(function (ix, pos) { return (pos + 1) + ". " + (it[ix] != null ? it[ix] : "#" + ix); }).join("   ");
    }
    // PRD-44: распределение показывается ЦЕЛИКОМ, вместе с нулями — инспектор нужен,
    // чтобы видеть вектор ответа, а не его непустую часть.
    if (q.type === "allocation") {
      var op = d.options || [], assigned = (ans && typeof ans === "object") ? ans : {};
      if (!op.length) return "(нет ответа)";
      return op.map(function (label, i) {
        return (label != null ? label : "#" + i) + ": " + Number(assigned[i] || 0);
      }).join("; ");
    }
    return String(ans);
  }

  // Replica of ScaleEngine.isActive (private in the engine) — measurement firing
  // test, kept tiny on purpose; mirrors server/scorm/template/app/scales/engine.js.
  function isActiveMeasure(m, answer, qType) {
    if (m.sourceType === "question") return answer !== null && answer !== undefined;
    if (answer === null || answer === undefined) return false;
    if (m.sourceType === "option") {
      var i = Number(m.sourceKey);
      if (isNaN(i)) return false;
      if (isOneIndexChoice(qType)) return answer === i;
      if (qType === "multiple") return Array.isArray(answer) && answer.indexOf(i) !== -1;
      return false;
    }
    if (m.sourceType === "matching_pair") {
      var lr = String(m.sourceKey).split(":"), left = Number(lr[0]), right = Number(lr[1]);
      return typeof answer === "object" && !Array.isArray(answer) && answer[left] === right;
    }
    if (m.sourceType === "ranking_position") {
      var ip = String(m.sourceKey).split(":"), item = Number(ip[0]), pos = Number(ip[1]);
      return Array.isArray(answer) && answer[pos] === item;
    }
    if (m.sourceType === "option_allocation") {
      if (typeof answer !== "object" || answer === null || Array.isArray(answer)) return false;
      var assignedPts = answer[String(Number(m.sourceKey))];
      return typeof assignedPts === "number" && isFinite(assignedPts) && assignedPts !== 0;
    }
    return false;
  }

  function contributionsFor(pkg, q, ans) {
    var out = [];
    (pkg.measurements || []).forEach(function (m) {
      if (m.questionId !== q.id) return;
      if (!isActiveMeasure(m, ans, q.type)) return;
      // PRD-44: вклад распределения равен ПРИСВОЕННОМУ баллу, а не фиксированной
      // величине, — иначе инспектор показывал бы не то, что посчитал движок.
      var delta = m.sourceType === "option_allocation"
        ? (ans[String(Number(m.sourceKey))] || 0) * m.value * m.weight
        : m.value * m.weight;
      out.push({ scaleKey: m.scaleKey, delta: delta });
    });
    return out;
  }

  function priceFor(pkg, q, ans) {
    var SE = null;
    try { SE = pkg.w.ScoringEngine; } catch (e) {}
    var input = { type: q.type, correct: q.correct || {}, answer: ans, scoring: q.scoring };
    // explainAnswer is a superset of scoreAnswer (adds kind/c/x/answered) — prefer
    // it so the «цена» note can be built without re-deriving any scoring logic.
    if (SE && typeof SE.explainAnswer === "function") {
      try { return SE.explainAnswer(input); } catch (e) {}
    }
    if (SE && typeof SE.scoreAnswer === "function") {
      try { return SE.scoreAnswer(input); } catch (e) {}
    }
    return null;
  }

  // ── «цена» note for the Протокол tab: the method that priced the answer plus
  // its tallies (PRD-18). `pr` is an explainAnswer result; older scoreAnswer-only
  // results (no `kind`) fall back to the raw score/sMax pair. ──
  function priceNum(n) {
    if (typeof n !== "number" || !isFinite(n)) return "0";
    return String(Math.round(n * 100) / 100);
  }
  function priceNote(pr) {
    if (!pr) return null;
    if (!pr.kind) return pr.score != null ? "цена: " + priceNum(pr.score) + " / " + priceNum(pr.sMax) : null;
    var method = pr.kind === "weighted" ? "веса опций" : pr.kind === "tiered" ? "тиры" : "точное совпадение";
    if (!pr.answered) return "цена: " + method + " · нет ответа → 0";
    if (pr.kind === "weighted") return "цена: " + method + " · вес выбранного = " + priceNum(pr.score);
    if (pr.kind === "tiered") return "цена: " + method + " · c=" + pr.c + ", x=" + pr.x + " → " + priceNum(pr.ratio);
    return "цена: " + method + " · " + (pr.ratio >= 1 ? "верно → 1" : "неверно → 0");
  }

  // Drawn questions for the live attempt — flat order (standard) or adaptive
  // walk (topics → levels → answeredQuestionIds), carrying the level label.
  function buildLiveRows(pkg) {
    var rows = [], st = pkg.state;
    if (!st) return rows;
    var isAdaptive = pkg.mode === "adaptive" && st.adaptiveState;
    if (isAdaptive) {
      var TA = (pkg.TEST_DATA && pkg.TEST_DATA.adaptiveTopics) || [];
      var byId = {};
      (st.adaptiveState.topics || []).forEach(function (topic) {
        var td = TA.filter(function (t) { return t.topicId === topic.topicId; })[0];
        if (!td) return;
        (topic.levelsState || []).forEach(function (level) {
          (level.answeredQuestionIds || []).forEach(function (qid) {
            var q = (td.questions || []).filter(function (x) { return x.id === qid; })[0];
            if (!q) return;
            byId[qid] = { q: q, topicName: td.topicName, answer: st.answers[qid], levelName: level.levelName };
          });
        });
      });
      // Emit in true delivery order: state.answers preserves answer-insertion
      // order, which equals delivery order.
      var seen = {};
      Object.keys(st.answers || {}).forEach(function (qid) {
        if (byId[qid]) { rows.push(byId[qid]); seen[qid] = 1; }
      });
      Object.keys(byId).forEach(function (qid) { if (!seen[qid]) rows.push(byId[qid]); });
    } else {
      // A question belongs in the protocol once the learner has COMMITTED it
      // (questionStatuses = answered/skipped) OR passed its flat position. Position
      // ALONE (i < currentIndex) is wrong: currentIndex is the CURRENT position, not a
      // high-water mark, so it drops the question the learner is currently ON (already
      // answered) and any answered question they navigated BACK past (skip/return,
      // «К обзору» pills). Status keeps NOT-yet-reached questions — and their pre-filled
      // ranking/matching default order — out, preserving the original intent.
      var statuses = st.questionStatuses || {};
      var limit = (typeof st.currentIndex === "number") ? st.currentIndex : (st.flatQuestions || []).length;
      (st.flatQuestions || []).forEach(function (fq, i) {
        var stt = statuses[fq.question.id];
        if (!(stt === "answered" || stt === "skipped" || i < limit)) return;
        rows.push({ q: fq.question, topicName: fq.topicName, answer: st.answers[fq.question.id], levelName: null });
      });
    }
    return rows;
  }

  function buildAttemptRows(att) {
    return (att.flatQuestions || []).map(function (fq) {
      return { q: fq.question, topicName: fq.topicName, answer: (att.answers || {})[fq.question.id], levelName: null };
    });
  }

  function getSuspendAttempts(cmi) {
    try { var s = JSON.parse((cmi && cmi["cmi.suspend_data"]) || "null"); return (s && s.attempts) || []; } catch (e) { return []; }
  }

  // ── Протокол: per-question structured records (drawn question, answer,
  // correctness, price PRD-10, scale contributions PRD-5). HTML/JSX is the host's. ──
  function buildProtocolRows(pkg, cmi, mode) {
    mode = mode || "live";
    var rows, note = "", total = 0;
    if (mode === "live" && (!pkg || !pkg.started)) {
      return { rows: [], note: "Тест ещё не начат — протокол появится после старта.", total: 0 };
    }
    if (mode === "live") {
      rows = pkg ? buildLiveRows(pkg) : [];
      var pst = pkg && pkg.state;
      // Total drawn for the progress denominator: flat = the full draw; adaptive =
      // delivered so far (the level path is dynamic, no fixed total).
      total = (pst && pkg.mode !== "adaptive" && pst.flatQuestions) ? pst.flatQuestions.length : rows.length;
    } else {
      var att = getSuspendAttempts(cmi)[parseInt(mode.slice(4), 10)];
      rows = att ? buildAttemptRows(att) : [];
      total = rows.length;
      if (att && (!att.flatQuestions || !att.flatQuestions.length)) note = "Для этой попытки детальный состав не сохранён (адаптивный режим).";
    }
    var showDiff = pkg && pkg.mode === "adaptive";
    // PRD-19 (FR-24): the per-question commit status (отвечен / пропущен / не отвечен)
    // for the «Протокол» — read from the LIVE runtime status map. It is distinct from
    // raw answer presence: a skipped question may carry an editable draft, so `answered`
    // (draft present) can be true while the status is still 'skipped'. Past attempts
    // (suspend_data) carry no status map → derive from answer presence.
    var liveStatuses = (mode === "live" && pkg && pkg.state && pkg.state.questionStatuses) || null;
    var out = rows.map(function (row, i) {
      var q = row.q, ans = row.answer;
      var pr = pkg ? priceFor(pkg, q, ans) : null;
      var ratio = pr ? pr.ratio : 0;
      var answered = !(ans == null || (Array.isArray(ans) && ans.length === 0) ||
        (q.type === "matching" && (!ans || !Object.keys(ans).length)));
      // PRD-44 FR-31: распределение отвечено только при полной сумме — частичное
      // здесь должно читаться как «не отвечен», как и в самом прохождении.
      if (q.type === "allocation") {
        var spec = q.data || {};
        var total = 0;
        Object.keys(ans || {}).forEach(function (k) { total += Number(ans[k]) || 0; });
        answered = Number(spec.budget) > 0 && total === Number(spec.budget);
      }
      var verdict = !answered ? "none" : ratio >= 1 ? "correct" : ratio > 0 ? "partial" : "wrong";
      var status = (liveStatuses && liveStatuses[q.id]) ? liveStatuses[q.id] : (answered ? "answered" : "unanswered");
      var points = q.points || 1;
      var earned = pr ? points * pr.ratio : 0;
      return {
        idx: i + 1, topicName: row.topicName || "", prompt: q.prompt || "", type: q.type, typeLabel: typeLabel(q.type),
        answerStr: humanAnswer(q, ans), answered: answered, status: status, verdict: verdict,
        ratio: Math.round(ratio * 100) / 100, ratioPct: Math.round(ratio * 100),
        score: pr ? pr.score : null, sMax: pr ? pr.sMax : null,
        priceNote: priceNote(pr),
        earned: Math.round(earned * 100) / 100, points: points,
        difficulty: (showDiff && q.difficulty != null) ? q.difficulty : null,
        levelName: row.levelName || null,
        contribs: pkg ? contributionsFor(pkg, q, ans) : [],
      };
    });
    return { rows: out, note: note, total: total };
  }

  // ── Шкалы / Показатели: structured rows (live value + what was published). ──
  function buildScaleRows(pkg, ints) {
    var defs = (pkg && pkg.scaleDefs) || [];
    return defs.map(function (d) {
      var v = (pkg.scales && pkg.scales[d.key]) || null;
      var pubVal = interactionById(ints, "scale_" + d.key);
      var pubLvl = interactionById(ints, "scale_" + d.key + "_level");
      return {
        key: d.key,
        raw: v ? v.raw : null,
        percent: (v && v.hasValue && v.percent) ? v.percent : null,
        level: v && v.level ? v.level : null,
        levelLabel: v && v.level ? (v.label || v.level) : null,
        pub: pubVal ? (pubVal.learner_response + (pubLvl ? " · " + pubLvl.learner_response : "")) : null,
      };
    });
  }

  function buildResultRows(pkg, ints) {
    var defs = (pkg && pkg.varDefs) || [];
    return defs.map(function (d) {
      var val = (pkg.results && d.name in pkg.results) ? pkg.results[d.name] : undefined;
      var pub = interactionById(ints, "var_" + d.name);
      return { name: d.name, live: (val === undefined || val === null) ? null : String(val), pub: pub ? pub.learner_response : null };
    });
  }

  // ═══ Состояние (watch) — flatten any object to a debugger-style path→value table.
  function dispVal(v) {
    if (v === null) return "null";
    if (typeof v === "string") return v.length > 140 ? v.slice(0, 140) + "…" : v;
    return String(v);
  }
  // Depth + node capped so a live state (large flatQuestions / adaptiveState,
  // shared refs, timer handles) can never hang the inspector; functions → ƒ().
  function flattenLimited(o) {
    var out = [], CAP = 4000, MAXD = 16;
    function walk(val, path, depth) {
      if (out.length >= CAP) return;
      if (typeof val === "function") { out.push({ path: path || "(root)", disp: "ƒ()" }); return; }
      if (val === null || typeof val !== "object") { out.push({ path: path || "(root)", disp: dispVal(val) }); return; }
      if (depth >= MAXD) { out.push({ path: path, disp: Array.isArray(val) ? "[…]" : "{…}" }); return; }
      if (Array.isArray(val)) {
        if (!val.length) { out.push({ path: path, disp: "[]" }); return; }
        for (var i = 0; i < val.length && out.length < CAP; i++) walk(val[i], path + "[" + i + "]", depth + 1);
        return;
      }
      var keys = Object.keys(val);
      if (!keys.length) { out.push({ path: path, disp: "{}" }); return; }
      for (var j = 0; j < keys.length && out.length < CAP; j++) walk(val[keys[j]], path ? path + "." + keys[j] : keys[j], depth + 1);
    }
    walk(o, "", 0);
    return out;
  }
  // Build a TREE (DS ou-tree shape) from a state-ish object: top-level keys become
  // root nodes, nested objects/arrays expand into children, leaves carry their value
  // in `meta`. Depth + node count capped so a huge live state can't hang the panel.
  function buildStateTree(obj) {
    var CAP = 2000, MAXD = 16, count = { n: 0 };
    function node(val, path, name, depth) {
      count.n++;
      if (typeof val === "function") return { id: path, label: name, meta: "ƒ()", leaf: true };
      if (val === null || typeof val !== "object") return { id: path, label: name, meta: dispVal(val), leaf: true };
      if (depth >= MAXD) return { id: path, label: name, meta: Array.isArray(val) ? "[…]" : "{…}", leaf: true };
      var isArr = Array.isArray(val), keys = Object.keys(val);
      if (!keys.length) return { id: path, label: name, meta: isArr ? "[]" : "{}", leaf: true };
      var children = [];
      for (var i = 0; i < keys.length && count.n < CAP; i++) {
        var k = keys[i];
        children.push(node(val[k], path ? path + "." + k : k, isArr ? "[" + k + "]" : k, depth + 1));
      }
      return { id: path, label: name, meta: isArr ? keys.length + " эл." : keys.length + " кл.", leaf: false, children: children };
    }
    if (obj === null || typeof obj !== "object") return [node(obj, "value", "value", 0)];
    var roots = [], keys = Object.keys(obj);
    for (var i = 0; i < keys.length && count.n < CAP; i++) roots.push(node(obj[keys[i]], keys[i], keys[i], 1));
    return roots;
  }

  function safeJson(obj) {
    try {
      var seen = new WeakSet();
      var s = JSON.stringify(obj, function (k, v) {
        if (typeof v === "function") return "[Function]";
        if (v && typeof v === "object") { if (seen.has(v)) return "[Circular]"; seen.add(v); }
        return v;
      }, 2);
      return (s && s.length > 20000) ? s.slice(0, 20000) + "\n…" : s;
    } catch (e) { return "[не сериализуется]"; }
  }

  // ═══ LMS-журнал — turn raw RTE traffic into a narrative of what the module tells
  // the LMS. Returns RAW text events ({kind,text,sub}); the host escapes for display.
  var GET_LABELS = {
    "cmi.suspend_data": "сохранённый прогресс", "cmi.location": "позиция",
    "cmi.learner_id": "идентификатор учащегося", "cmi.learner_name": "имя учащегося",
    "cmi.core.student_id": "идентификатор учащегося", "cmi.core.student_name": "имя учащегося",
    "cmi.completion_status": "статус прохождения", "cmi.success_status": "итог",
    "cmi.entry": "режим входа", "cmi.mode": "режим", "cmi.credit": "зачётность",
    "cmi.score.scaled": "балл", "cmi.student_email": "email", "cmi.student_org": "организация",
  };
  function humanGetSummary(keys) {
    var seen = {}, parts = [];
    keys.forEach(function (kv) {
      var label = GET_LABELS[kv.k] || kv.k.replace(/^cmi\./, "");
      if (kv.k === "cmi.entry") label = "режим входа: " + (kv.v === "resume" ? "продолжение" : (kv.v || "первый запуск"));
      if (!seen[label]) { seen[label] = 1; parts.push(label); }
    });
    return parts.slice(0, 6).join("; ") + (parts.length > 6 ? " …" : "");
  }
  function humanCompletion(v) { return v === "completed" ? "завершено" : v === "incomplete" ? "не завершено" : String(v); }
  function humanSuccess(v) { return v === "passed" ? "зачёт ✓" : v === "failed" ? "незачёт ✗" : v === "unknown" ? "не определён" : String(v); }

  /**
   * PRD-24: human label for the RESOLVED topic rule (`{type:'percent'|'count'}`),
   * i.e. the threshold that actually gated the topic. `null` = ungated.
   */
  function passRuleLabel(rule) {
    if (!rule) return "без порога";
    return rule.type === "percent" ? "≥ " + rule.value + "%" : "≥ " + rule.value + " баллов";
  }

  /**
   * PRD-24: label of the variant this run delivered for a topic, read from the pin
   * the runtime writes into the attempt state. Null for non-variant topics.
   */
  function variantLabelFor(pkg, topicId) {
    var vs = (((pkg.state || {}).variant || {}).sections || [])
      .filter(function (s) { return s.topicId === topicId; })[0];
    if (!vs || !vs.formId) return null;
    var def = ((pkg.TEST_DATA || {}).sections || [])
      .filter(function (s) { return s.topicId === topicId; })[0];
    var forms = (def && def.formSet && def.formSet.forms) || [];
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].id === vs.formId) return forms[i].label || ("Вариант " + (i + 1));
    }
    return null;
  }
  function collectByIndex(traffic, start, prefix) {
    var map = {}, order = [], i = start;
    while (i < traffic.length && traffic[i].fn === "SetValue" && traffic[i].key.indexOf(prefix) === 0) {
      var rest = traffic[i].key.slice(prefix.length);
      var dot = rest.indexOf(".");
      var idx = dot === -1 ? rest : rest.slice(0, dot);
      var field = dot === -1 ? "" : rest.slice(dot + 1);
      if (!map[idx]) { map[idx] = {}; order.push(idx); }
      map[idx][field] = traffic[i].value;
      i++;
    }
    return { list: order.map(function (x) { return map[x]; }), next: i };
  }
  function describeScore(sc) {
    var pct = (sc.scaled !== undefined && sc.scaled !== "") ? Math.round(Number(sc.scaled) * 100) + "%" : "";
    return sc.raw + " из " + sc.max + (pct ? " (" + pct + ")" : "");
  }
  function describeInteraction(it) {
    var id = it["id"] || "", resp = it["learner_response"] || "", desc = it["description"] || "", res = it["result"] || "";
    if (id.indexOf("q_") === 0) {
      return { kind: "answer", text: "📝 Ответ в отчёте LMS — " + (desc ? "«" + trunc(desc, 70) + "»" : id) + ": " +
        (res === "correct" ? "верно" : res === "incorrect" ? "неверно" : res), sub: "ответ учащегося: " + resp };
    }
    if (id.indexOf("scale_") === 0) {
      var isLvl = /_level$/.test(id);
      var key = id.replace(/^scale_/, "").replace(/_level$/, "");
      return { kind: "scale", text: "📊 Шкала " + key + (isLvl ? " — уровень" : "") + " → " + resp, sub: desc };
    }
    if (id.indexOf("var_") === 0) return { kind: "scale", text: "∑ Показатель " + id.replace(/^var_/, "") + " → " + resp, sub: desc };
    if (id.indexOf("_course_") !== -1) return { kind: "status", text: "🔗 Рекомендованный курс (object_id " + resp + ")", sub: desc };
    return { kind: "muted", text: "• " + id + " → " + resp, sub: "" };
  }
  function describeSuspendWrite(value, prevRaw) {
    var sizeStr = fmtBytes(byteLen(value));
    var cur = null, prev = null;
    try { cur = JSON.parse(value || "null"); } catch (e) {}
    try { prev = JSON.parse(prevRaw || "null"); } catch (e) {}
    var pa = (prev && prev.attempts) ? prev.attempts.length : 0;
    var ca = (cur && cur.attempts) ? cur.attempts.length : 0;
    var pu = (prev && prev.attemptsUsed) || 0, cu = (cur && cur.attemptsUsed) || 0;
    if (cur && ca > pa) {
      var a = cur.attempts[ca - 1];
      return { kind: "suspend", text: "💾 Результат попытки #" + a.attemptNumber + " сохранён: " + Math.round(a.percent) + "% — " + (a.passed ? "зачёт" : "незачёт"), sub: "suspend_data: " + sizeStr };
    }
    if (cur && cu > pu) return { kind: "suspend", text: "▶ Старт попытки " + cu + " зарегистрирован", sub: "suspend_data: " + sizeStr };
    if (cur && cur.currentSession) {
      var cs = cur.currentSession;
      var n = cs.answers ? Object.keys(cs.answers).length : 0;
      return { kind: "suspend", text: "💾 Прогресс сохранён: вопрос " + ((cs.currentIndex || 0) + 1) + " (ответов: " + n + ")", sub: "suspend_data: " + sizeStr };
    }
    return { kind: "suspend", text: "💾 suspend_data записан", sub: "размер: " + sizeStr };
  }
  function humanizeTraffic(traffic) {
    var ev = [], i = 0, prevSuspend = null;
    function add(kind, text, sub) { ev.push({ kind: kind, text: text, sub: sub || "" }); }
    while (i < traffic.length) {
      var e = traffic[i];
      if (e.fn === "Initialize") { add("sess", "▶ Сеанс открыт — модуль связался с LMS (Initialize)"); i++; continue; }
      if (e.fn === "Terminate") { add("sess", "■ Сеанс закрыт (Terminate)"); i++; continue; }
      if (e.fn === "Commit") {
        if (ev.length && ev[ev.length - 1].kind === "commit") { i++; continue; }
        add("commit", "✓ Данные отправлены в LMS (Commit)"); i++; continue;
      }
      if (e.fn === "GetValue") {
        var keys = [];
        while (i < traffic.length && traffic[i].fn === "GetValue") { keys.push({ k: traffic[i].key, v: traffic[i].ret }); i++; }
        add("read", "↩ Модуль читает из LMS: " + humanGetSummary(keys));
        continue;
      }
      if (e.fn === "SetValue") {
        var k = e.key;
        if (k === "cmi.suspend_data") { var d = describeSuspendWrite(e.value, prevSuspend); add(d.kind, d.text, d.sub); prevSuspend = e.value; i++; continue; }
        if (k.indexOf("cmi.score.") === 0) {
          var sc = {};
          while (i < traffic.length && traffic[i].fn === "SetValue" && traffic[i].key.indexOf("cmi.score.") === 0) { sc[traffic[i].key.slice(10)] = traffic[i].value; i++; }
          add("finish", "🏁 Итоговый балл отправлен в LMS: " + describeScore(sc)); continue;
        }
        if (k.indexOf("cmi.objectives.") === 0) {
          var go = collectByIndex(traffic, i, "cmi.objectives."); i = go.next;
          go.list.forEach(function (o) {
            var oid = (o["id"] || "").replace(/^topic_/, "");
            add("status", "🎯 Тема " + oid + " → " + (o["success_status"] || "?") + ", балл " + (o["score.raw"] !== undefined ? o["score.raw"] : "?"));
          });
          continue;
        }
        if (k.indexOf("cmi.interactions.") === 0) {
          var gi = collectByIndex(traffic, i, "cmi.interactions."); i = gi.next;
          gi.list.forEach(function (it) { var di = describeInteraction(it); add(di.kind, di.text, di.sub); });
          continue;
        }
        if (k === "cmi.completion_status") { add("status", "📌 Статус прохождения → " + humanCompletion(e.value)); i++; continue; }
        if (k === "cmi.success_status") { add("status", "📌 Итог → " + humanSuccess(e.value)); i++; continue; }
        if (k === "cmi.progress_measure") { add("status", "📈 Прогресс → " + Math.round(Number(e.value) * 100) + "%"); i++; continue; }
        if (k === "cmi.exit") { add("muted", "↪ Тип выхода → " + e.value); i++; continue; }
        if (k === "cmi.location") { add("muted", "📍 Позиция → " + (e.value ? e.value : "(очищена)")); i++; continue; }
        if (k === "cmi.comments_from_learner") { add("warn", "💬 Комментарий учащегося → " + e.value); i++; continue; }
        add("muted", "• " + k.replace(/^cmi\./, "") + " → " + trunc(e.value, 80)); i++; continue;
      }
      i++;
    }
    return ev;
  }

  // ── LMS-журнал as a structured RTE-call table (wireframe «Вызов · Ключ ·
  // Значение»): SetValue rows + session markers (Initialize/Terminate/Commit);
  // GetValue noise goes to the raw log below, not the main table. ──
  function buildLmsTable(traffic) {
    var rows = [];
    (traffic || []).forEach(function (e, i) {
      if (e.fn === "GetValue") return;
      if (e.fn === "SetValue") {
        rows.push({ idx: i, call: "Set", key: (e.key || "").replace(/^cmi\./, ""), value: String(e.value), marker: false });
      } else {
        rows.push({ idx: i, call: e.fn, key: "", value: e.fn + '("") → ' + (e.ret != null ? '"' + e.ret + '"' : '""'), marker: true });
      }
    });
    return rows;
  }
  /** The full raw RTE traffic (GetValue/SetValue/…) for the «Сырые вызовы» disclosure. */
  function buildLmsRawLog(traffic) {
    return (traffic || []).map(function (e) {
      var t = e.fn + "(" + (e.key || "");
      if (e.fn === "SetValue") t += ", " + String(e.value).slice(0, 200);
      t += ")";
      if (e.ret != null) t += ' → "' + String(e.ret).slice(0, 200) + '"';
      return t;
    }).join("\n");
  }

  // ── Адаптив: current topic/level + confirmed (passed) level pairs. ──
  function buildAdaptiveBar(pkg) {
    var st = pkg && pkg.state;
    var as = st && st.adaptiveState;
    if (!pkg || pkg.mode !== "adaptive" || !as) return { visible: false };
    var topics = as.topics || [];
    var finished = !!as.isFinished, now = null;
    if (!finished) {
      var topic = topics[as.currentTopicIndex];
      var lvl = topic && topic.levelsState[topic.currentLevelIndex];
      if (topic && lvl) {
        now = { topicIndex: as.currentTopicIndex + 1, topicCount: topics.length, topicName: topic.topicName,
          levelName: lvl.levelName, minDifficulty: lvl.minDifficulty, maxDifficulty: lvl.maxDifficulty };
      }
    }
    var confirmed = [];
    topics.forEach(function (t) {
      (t.levelsState || []).forEach(function (lv) {
        if (lv.status === "passed") {
          confirmed.push({ kind: "ok", topicName: t.topicName, levelName: lv.levelName,
            correctCount: lv.correctCount, total: (lv.answeredQuestionIds || []).length });
        }
      });
      if (t.status === "completed" && t.finalLevelIndex === null) confirmed.push({ kind: "no", topicName: t.topicName });
    });
    // Per-topic CONFIRMED level + status, in topic order — the source for the
    // status-bar adaptive lane and the «Результаты» adaptive table (one row per
    // topic, current topic as the «идёт» tail). status: confirmed | running |
    // failed | pending.
    var topicLevels = topics.map(function (t, ti) {
      var achieved = (t.finalLevelIndex !== null && t.levelsState[t.finalLevelIndex]) ? t.levelsState[t.finalLevelIndex] : null;
      var isCurrent = !finished && ti === as.currentTopicIndex && t.status !== "completed";
      var curLvl = t.levelsState[t.currentLevelIndex];
      var status = t.status === "completed" ? (achieved ? "confirmed" : "failed") : (isCurrent ? "running" : "pending");
      return {
        topicName: t.topicName,
        levelName: achieved ? achieved.levelName : (isCurrent && curLvl ? curLvl.levelName : null),
        status: status,
      };
    });
    return { visible: true, finished: finished, now: now, confirmed: confirmed, topicLevels: topicLevels };
  }

  // Display label for a step's transition (PRD-18 «Выдача» adaptive table). The
  // direction is the REAL one the engine recorded in stepLog (Вариант B), not a
  // heuristic: up/down level move, level confirmed (terminal), or staying in level.
  function adaptiveTransitionLabel(s) {
    if (s.transitionType === "up") return "↑ повышение";
    if (s.transitionType === "down") return "↓ понижение";
    if (s.transitionType === "complete") {
      return s.achievedLevelName ? ("подтверждён: " + s.achievedLevelName + " ✓") : "не подтверждён";
    }
    return "= закрепление";
  }

  // ── Адаптив «Выдача»: per-topic level path (Шаг|Уровень|Ответ|Переход) from the
  // engine's stepLog, with the current on-screen question appended as an «идёт»
  // tail row. Topics not yet reached are skipped. ──
  function buildAdaptivePath(pkg) {
    var st = pkg && pkg.state, as = st && st.adaptiveState;
    if (!pkg || pkg.mode !== "adaptive" || !as) return [];
    var log = as.stepLog || [], topics = as.topics || [], finished = !!as.isFinished;
    var byTopic = {};
    log.forEach(function (s) { (byTopic[s.topicId] = byTopic[s.topicId] || []).push(s); });
    var out = [];
    topics.forEach(function (t, ti) {
      var answered = byTopic[t.topicId] || [];
      var steps = answered.map(function (s, i) {
        return { step: i + 1, levelName: s.levelName, answer: s.isCorrect ? "верно" : "неверно",
          transition: adaptiveTransitionLabel(s), current: false };
      });
      var isCurrent = !finished && ti === as.currentTopicIndex && t.status !== "completed";
      var curLvl = t.levelsState[t.currentLevelIndex];
      if (isCurrent && curLvl) {
        steps.push({ step: steps.length + 1, levelName: curLvl.levelName, answer: "—", transition: "идёт", current: true });
      }
      if (!steps.length) return; // topic not reached yet
      var achieved = (t.finalLevelIndex !== null && t.levelsState[t.finalLevelIndex]) ? t.levelsState[t.finalLevelIndex] : null;
      var status = t.status === "completed" ? (achieved ? "confirmed" : "failed") : (isCurrent ? "running" : "pending");
      var last = answered[answered.length - 1], arrow = "";
      if (isCurrent && last) arrow = last.transitionType === "up" ? "↑" : last.transitionType === "down" ? "↓" : "";
      out.push({
        topicId: t.topicId, topicName: t.topicName, status: status,
        confirmedLevelName: achieved ? achieved.levelName : null,
        currentLevelName: isCurrent && curLvl ? curLvl.levelName : null,
        currentArrow: arrow, steps: steps,
      });
    });
    return out;
  }

  function round2(n) { return (typeof n === "number" && isFinite(n)) ? Math.round(n * 100) / 100 : 0; }
  function tagKeyJs(raw) { return String(raw == null ? "" : raw).replace(/\s+/g, " ").trim().toLowerCase(); }

  // ── Composition of a drawn question set, by sub-topic tag and by question type
  // (PRD-18 «Выдача» tab). First-seen original label is preserved per key; order
  // is insertion order so the table reads as authored. ──
  function composeByTag(drawn) {
    var order = [], by = {};
    (drawn || []).forEach(function (q) {
      var tags = Array.isArray(q.tags) ? q.tags : [];
      tags.forEach(function (t) {
        var k = tagKeyJs(t);
        if (!by[k]) { by[k] = { tag: t, count: 0 }; order.push(k); }
        by[k].count += 1;
      });
    });
    return order.map(function (k) { return by[k]; });
  }
  function composeByType(drawn) {
    var order = [], by = {};
    (drawn || []).forEach(function (q) {
      var t = q.type || "?";
      if (!by[t]) { by[t] = { type: t, typeLabel: typeLabel(t), count: 0 }; order.push(t); }
      by[t].count += 1;
    });
    return order.map(function (k) { return by[k]; });
  }

  // ── Результаты: the package's OWN aggregate (calculateResults) + the pass rule.
  // Adaptive tests have no points aggregate — show confirmed levels instead. ──
  function buildScore(pkg) {
    if (!pkg || !pkg.w || !pkg.started) return { available: false, adaptive: false };
    if (pkg.mode === "adaptive") return { available: true, adaptive: true, bar: buildAdaptiveBar(pkg) };
    var r = null;
    try { if (typeof pkg.w.calculateResults === "function") r = pkg.w.calculateResults(); } catch (e) {}
    if (!r) return { available: false, adaptive: false };
    // Sectioned flow (linear_by_topics / router_by_topics) drives the status-bar
    // «Прогресс · разделы» lane; flat flow shows «вопрос i из N». Default flat.
    var flowMode = (pkg.TEST_DATA && pkg.TEST_DATA.flowPolicy && pkg.TEST_DATA.flowPolicy.mode) || "linear_flat";
    // Per-topic completion: a topic is done once ALL its drawn questions have been
    // passed (flat index < currentIndex) — only then is its pass/fail meaningful (N9).
    var bst = pkg.state || {};
    var bIdx = (typeof bst.currentIndex === "number") ? bst.currentIndex : (bst.flatQuestions || []).length;
    var topicDone = {};
    if (flowMode === "router_by_topics" && bst.routerTopicStates) {
      // Router mode: topics are traversed non-linearly via the hub, and on the hub
      // currentIndex stays frozen on the LAST question of the topic just left — so
      // that question's flat index equals currentIndex and the heuristic below would
      // misread the (already completed) topic as still «в процессе». The router
      // runtime tracks authoritative per-topic completion in routerTopicStates; use
      // it so a topic shown «Пройдена» on the hub also reads «пройден» here.
      (bst.flatQuestions || []).forEach(function (fq) {
        topicDone[fq.topicId] = bst.routerTopicStates[fq.topicId] === "completed";
      });
    } else {
      (bst.flatQuestions || []).forEach(function (fq, i) {
        if (topicDone[fq.topicId] === undefined) topicDone[fq.topicId] = true;
        if (i >= bIdx) topicDone[fq.topicId] = false;
      });
    }
    return {
      available: true, adaptive: false,
      sectioned: flowMode !== "linear_flat",
      earnedPoints: round2(r.earnedPoints), possiblePoints: round2(r.possiblePoints),
      correct: r.correct, totalQuestions: r.totalQuestions,
      percent: Math.round(r.percent || 0), passed: !!r.passed,
      rule: (pkg.TEST_DATA && pkg.TEST_DATA.overallPassRule) || null,
      sections: (r.topicResults || []).map(function (td) {
        return {
          topicName: td.topicName, earnedPoints: round2(td.earnedPoints), possiblePoints: round2(td.possiblePoints),
          percent: Math.round(td.percent || 0), passed: td.passed, correct: td.correct, total: td.total,
          completed: !!topicDone[td.topicId],
          // PRD-24: the rule that ACTUALLY gated the topic. For a `by_variant` topic
          // that is the delivered variant's threshold — without it the methodologist
          // sees a verdict with no way to tell WHICH threshold produced it.
          rule: td.resolvedPassRule || null,
          ruleLabel: passRuleLabel(td.resolvedPassRule),
          variantLabel: variantLabelFor(pkg, td.topicId),
        };
      }),
    };
  }

  // ── Выдача: what THIS run delivered per section — variant (PRD-17; the formId is
  // read from the pin the runtime writes into the attempt state, PRD-24, falling back
  // to inference over the drawn id-set for pre-PRD-24 state) or per-tag quota
  // plan-vs-actual (PRD-11), or a plain/whole-topic draw. Adaptive → level path. ──
  function buildDraw(pkg) {
    if (!pkg || !pkg.state) return { available: false, adaptive: false };
    if (pkg.mode === "adaptive") return { available: true, adaptive: true, bar: buildAdaptiveBar(pkg), path: buildAdaptivePath(pkg) };
    var variant = pkg.state.variant;
    if (!variant || !variant.sections) return { available: false, adaptive: false };
    var secDefs = (pkg.TEST_DATA && pkg.TEST_DATA.sections) || [];
    var st = pkg.state;
    // Delivery progress (N3): a drawn question is "delivered" once the learner has
    // COMMITTED it (questionStatuses = answered/skipped) OR passed its flat position.
    // Position alone (index < currentIndex) drops the current question and anything
    // navigated back past — see buildLiveRows. flatIndex keeps delivery order.
    var statuses = st.questionStatuses || {};
    var currentIndex = (typeof st.currentIndex === "number") ? st.currentIndex : (st.flatQuestions || []).length;
    var flatIndex = {};
    (st.flatQuestions || []).forEach(function (fq, i) { flatIndex[fq.question.id] = i; });
    var drawnByTopic = {};
    (st.flatQuestions || []).forEach(function (fq) {
      (drawnByTopic[fq.topicId] = drawnByTopic[fq.topicId] || []).push(fq.question);
    });
    var sections = variant.sections.map(function (vs) {
      var def = secDefs.filter(function (s) { return s.topicId === vs.topicId; })[0] || {};
      var drawnIds = vs.questionIds || [];
      var drawn = drawnByTopic[vs.topicId] || [];
      var qlist = drawn.map(function (q) {
        var fi = (typeof flatIndex[q.id] === "number") ? flatIndex[q.id] : -1;
        var stt = statuses[q.id];
        var delivered = (stt === "answered" || stt === "skipped") || (fi >= 0 && fi < currentIndex);
        return { id: q.id, idx: fi, prompt: q.prompt || "", type: q.type, typeLabel: typeLabel(q.type),
          topicName: vs.topicName, delivered: delivered };
      });
      var out = {
        topicId: vs.topicId, topicName: vs.topicName, count: drawnIds.length, mode: "all",
        formId: null, formIndex: null, formCount: null, forms: [], quotas: null,
        bankSize: (def.questions && def.questions.length) || drawnIds.length,
        byTag: composeByTag(drawn), byType: composeByType(drawn),
        questions: qlist,
        delivered: qlist.filter(function (qq) { return qq.delivered; }).length,
      };
      if (def.formSet && def.formSet.forms && def.formSet.forms.length) {
        out.mode = "variants";
        out.formCount = def.formSet.forms.length;
        // PRD-18 debug: the full variant list (id + label + 1-based index) so the
        // «Выдача» tab can offer a per-topic pin selector (before the run starts).
        out.forms = def.formSet.forms.map(function (f, i) {
          return { id: f.id, label: f.label || ("Вариант " + (i + 1)), index: i + 1 };
        });
        // PRD-24: the runtime now PINS the delivered variant, so read it back instead
        // of guessing. Inference over the drawn id-set stays as a fallback for state
        // captured before the pin existed (and it cannot tell apart two variants that
        // share the same questions, which the pin can).
        if (vs.formId) {
          out.formId = vs.formId;
          for (var pi = 0; pi < def.formSet.forms.length; pi++) {
            if (def.formSet.forms[pi].id === vs.formId) { out.formIndex = pi + 1; break; }
          }
        } else {
          var set = {};
          drawnIds.forEach(function (id) { set[id] = 1; });
          for (var i = 0; i < def.formSet.forms.length; i++) {
            var fids = def.formSet.forms[i].questionIds || [];
            if (fids.length === drawnIds.length && fids.every(function (id) { return set[id]; })) {
              out.formId = def.formSet.forms[i].id; out.formIndex = i + 1; break;
            }
          }
        }
      } else if (def.drawBlueprint && def.drawBlueprint.strata && def.drawBlueprint.strata.length) {
        out.mode = "quota";
        var counts = {};
        drawn.forEach(function (q) {
          (Array.isArray(q.tags) ? q.tags : []).forEach(function (t) { var k = tagKeyJs(t); counts[k] = (counts[k] || 0) + 1; });
        });
        out.quotas = def.drawBlueprint.strata.map(function (s) {
          var actual = counts[tagKeyJs(s.tag)] || 0;
          return { tag: s.tag, planned: s.count, actual: actual, mode: s.mode || "exact", short: actual < s.count };
        });
      } else if (typeof def.drawCount === "number" && def.drawCount > 0) {
        out.mode = "draw";
      }
      return out;
    });
    var dFlow = (pkg.TEST_DATA && pkg.TEST_DATA.flowPolicy && pkg.TEST_DATA.flowPolicy.mode) || "linear_flat";
    // PRD-18 debug: `started` (phase !== 'start') drives the variant pin selectors —
    // they lock once the run began (all variants fixed at generateVariant time).
    return { available: true, adaptive: false, sections: sections, flat: dFlow === "linear_flat", started: !!pkg.started };
  }

  // ═══ «Эталон» — highlight the correct answers ON the real question render in the
  // iframe (PRD-18 §5.4). Markers are tiny inline-styled badges (the package CSS
  // doesn't know our classes): ✓ on correct options (single/multiple), the correct
  // ordinal (ranking), paired letters A/B/C on the chip + right tile (matching).
  // Idempotent: clears its own marks first, so it can run every tick. ──
  function tbRefBadge(doc, text, kind) {
    var b = doc.createElement("span");
    b.setAttribute("data-tb-ref", "1");
    b.textContent = text;
    if (kind === "key") {
      // matching pair letter — centered in a reserved LEFT gutter on the chip / right
      // tile (reserveKeyGutter makes the room). Absolute + translateY(-50%) keeps it on
      // the middle horizontal no matter how many lines the tile/chip text wraps to.
      b.style.cssText = "position:absolute;left:10px;top:50%;transform:translateY(-50%);" +
        "display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:18px;" +
        "padding:0 5px;border-radius:4px;background:#ede9fe;color:#6d28d9;" +
        "font:700 11px/1 system-ui,sans-serif;flex:0 0 auto;pointer-events:none;";
      return b;
    }
    // single/multiple/ranking — marker in a LEFT GUTTER OUTSIDE the variant (absolute,
    // anchored to the option which we set position:relative): doesn't touch the variant
    // content or its layout, and never affects scoring (§5.4).
    b.style.cssText = "position:absolute;left:-24px;top:50%;transform:translateY(-50%);" +
      "display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;" +
      "color:" + (kind === "ok" ? "#15803d" : "#1d4ed8") + ";" +
      "font:700 13px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums;";
    return b;
  }
  // True while a pointer drag gesture is in flight: the shared DnD engine
  // (shared/template/dnd/pointer-dnd) appends a `[data-drag-ghost]` card to the
  // document for the whole duration of a started drag. Mutating the captured
  // chip's subtree during that window (adding/removing an «Эталон» badge, toggling
  // its padding) makes the browser fire `pointercancel`, which the engine treats as
  // a drop-abort — so the overlay's per-tick repaint silently killed matching /
  // ranking drags while «Эталон» was on. The overlay must stand still until the
  // gesture ends; the next tick repaints.
  function dragInFlight(doc) {
    try { return !!doc.querySelector('[data-drag-ghost]'); } catch (e) { return false; }
  }
  function clearReference(iframeWin) {
    var doc = iframeWin && iframeWin.document;
    if (!doc || dragInFlight(doc)) return;
    var marks = doc.querySelectorAll('[data-tb-ref="1"]');
    for (var i = 0; i < marks.length; i++) {
      if (marks[i].parentNode) marks[i].parentNode.removeChild(marks[i]);
    }
    // Restore the left padding reserved for the centered matching pair letters.
    var padded = doc.querySelectorAll('[data-tb-ref-pad]');
    for (var k = 0; k < padded.length; k++) {
      padded[k].style.paddingLeft = padded[k].getAttribute("data-tb-ref-pad");
      padded[k].removeAttribute("data-tb-ref-pad");
    }
  }
  // Reserve a fixed left gutter on a matching chip / right tile so the centered
  // «Эталон» pair letter has room without overlapping content; the original inline
  // padding-left is stashed and restored in clearReference.
  function reserveKeyGutter(el) {
    if (!el) return;
    if (el.getAttribute("data-tb-ref-pad") === null) el.setAttribute("data-tb-ref-pad", el.style.paddingLeft);
    el.style.position = "relative";
    // The pair letter sits at left:10px and is ~32px wide, so the content needs to
    // start past ~44px or the badge touches the text; 52px leaves a clear gutter.
    el.style.paddingLeft = "52px";
  }
  // The question CURRENTLY on screen. Which state holds it depends on the delivery
  // mode, and the overlay must follow the render, not a parallel index:
  //  - adaptive → the level engine drives the screen from
  //    `adaptiveState.currentQuestionId` (getCurrentAdaptiveQuestion). The flat draw is
  //    a DIFFERENT set (empty in legacy linear_flat adaptive, an unrelated variant in the
  //    sectional modes), so `flatQuestions[currentIndex]` is another question entirely —
  //    reading it painted a foreign answer key: a single-choice key (one ✓) on a
  //    multiple-choice screen and a multi-key (several ✓) on a single-choice one.
  //  - everything else → the flat draw at the current position, as the standard render does.
  // Returns null when the on-screen question cannot be resolved: no overlay is far
  // better than a confident overlay of the wrong answer key.
  function currentScreenQuestion(iframeWin, st) {
    var ad = st.adaptiveState;
    if (ad && !ad.isFinished) {
      // Preferred: the package's OWN resolver — the same call the adaptive render makes,
      // so the overlay cannot drift from what is rendered.
      try {
        if (typeof iframeWin.getCurrentAdaptiveQuestion === "function") {
          var qd = iframeWin.getCurrentAdaptiveQuestion();
          if (qd && qd.question) return qd.question;
        }
      } catch (e) {}
      // Fallback: resolve the pinned id against the package's adaptive banks.
      var qid = ad.currentQuestionId;
      if (!qid) return null;
      var topics = (iframeWin.TEST_DATA && iframeWin.TEST_DATA.adaptiveTopics) || [];
      for (var t = 0; t < topics.length; t++) {
        var bank = topics[t].questions || [];
        for (var b = 0; b < bank.length; b++) if (bank[b].id === qid) return bank[b];
      }
      return null;
    }
    var curFq = (st.flatQuestions || [])[st.currentIndex];
    return (curFq && curFq.question) || null;
  }
  function applyReference(iframeWin) {
    var doc = iframeWin && iframeWin.document;
    var st = null;
    try { st = iframeWin.state; } catch (e) {}
    if (!doc || !st) return;
    // Never repaint mid-drag — see dragInFlight. Leaving the overlay untouched keeps
    // the captured chip's subtree stable so the gesture can complete.
    if (dragInFlight(doc)) return;
    clearReference(iframeWin);

    // The debug player shows ONE question at a time. The revised «Стандартный»
    // markup (ou-radio-card / ou-rank / ou-match) no longer carries the qid on the
    // option, so the reference targets the CURRENT question from the live state.
    var curQ = currentScreenQuestion(iframeWin, st);
    if (!curQ) return;
    var c = curQ.correct || {};

    // single / multiple — ✓ on the correct option(s). Options are `.ou-radio-card`
    // rows keyed by `data-index`, in the shuffled display order.
    if (curQ.type === "single" || curQ.type === "multiple") {
      var correctSet = curQ.type === "single"
        ? (typeof c.correctIndex === "number" ? [c.correctIndex] : [])
        : (Array.isArray(c.correctIndices) ? c.correctIndices : []);
      var opts = doc.querySelectorAll(".ou-radio-card[data-index]");
      for (var i = 0; i < opts.length; i++) {
        var idx = parseInt(opts[i].getAttribute("data-index"), 10);
        if (correctSet.indexOf(idx) !== -1) {
          opts[i].style.position = "relative";
          opts[i].appendChild(tbRefBadge(doc, "✓", "ok"));
        }
      }
    }

    // scale — ✓ on the correct graduation. The scale renders as the DS Stepper in
    // choice mode, so its rows are `.ou-stepper__step`, not `.ou-radio-card`. A
    // MEASUREMENT-only scale carries no `correctIndex`, so nothing is marked — there
    // is no reference answer to show.
    if (curQ.type === "scale" && typeof c.correctIndex === "number") {
      var steps = doc.querySelectorAll(".ou-stepper--choice .ou-stepper__step[data-index]");
      for (var si = 0; si < steps.length; si++) {
        if (parseInt(steps[si].getAttribute("data-index"), 10) === c.correctIndex) {
          steps[si].style.position = "relative";
          steps[si].appendChild(tbRefBadge(doc, "✓", "ok"));
        }
      }
    }

    // ranking — the correct 1-based position of each item. A row carries BOTH its
    // display position (`data-drag`, which the drag reorders) and the index of the
    // item in it (`data-item`); the answer key is in item indices, so the row is
    // keyed by `data-item`. Not by text — see the matching note below: the rendered
    // text has been through markdown + typography and no longer equals the raw
    // TEST_DATA string, so text matching left ordinary Russian wording unmarked.
    if (curQ.type === "ranking") {
      var co = Array.isArray(c.correctOrder) ? c.correctOrder : [];
      var itemPos = {};
      co.forEach(function (itemIdx, pos) { itemPos[String(itemIdx)] = pos + 1; });
      var rows = doc.querySelectorAll(".ou-rank__item[data-item]");
      for (var r = 0; r < rows.length; r++) {
        var p = itemPos[rows[r].getAttribute("data-item")];
        if (p) { rows[r].style.position = "relative"; rows[r].appendChild(tbRefBadge(doc, String(p), "num")); }
      }
    }

    // matching — paired letters A/B/C on the fixed prompt (right item) and the
    // draggable chip (left item). Both sides are found by their INDEX, which the
    // render puts straight into the markup: `data-drop="r<rightIdx>"` on the fixed
    // prompt, `data-drag="<leftIdx>"` on the chip. One letter per correct pair.
    //
    // NEVER by text: the render pipes every answer through renderInlineMarkdown
    // (markdown + the Russian typography pass), so what the DOM carries is not the
    // raw TEST_DATA string — «в сеть» comes back with U+00A0, quotes as guillemets,
    // a spaced hyphen as an em dash, a newline as <br>. Comparing against the raw
    // string therefore silently skipped exactly the long prompts (the wording that
    // has short prepositions in it) while short latin terms still matched: the
    // author saw letters on the chips and none on the prompts.
    if (curQ.type === "matching") {
      var pairs = Array.isArray(c.pairs) ? c.pairs : [];
      pairs.forEach(function (pair, idx) {
        var letter = String.fromCharCode(65 + idx);
        var ri = Number(pair && pair.right);
        var li = Number(pair && pair.left);
        if (isFinite(ri)) {
          var fc = doc.querySelector('.ou-match__card--fixed[data-drop="r' + ri + '"]');
          if (fc) { reserveKeyGutter(fc); fc.appendChild(tbRefBadge(doc, letter, "key")); }
        }
        if (isFinite(li)) {
          var chip = doc.querySelector('.ou-match__card--drag[data-drag="' + li + '"]');
          if (chip) { reserveKeyGutter(chip); chip.appendChild(tbRefBadge(doc, letter, "key")); }
        }
      });
    }
  }

  // ═══ «Завершить тест» guard (debug player): after the finish button is clicked,
  // disable it so the finished run can't be re-submitted. Re-applies across the
  // package's re-renders via the per-window __tbFinished flag. ──
  function guardFinishButton(iframeWin) {
    var doc = iframeWin && iframeWin.document;
    if (!doc) return;
    var found = [];
    var tagged = doc.querySelectorAll(
      '[data-action="test-finish"], [data-action="router-finish"], [data-action="results-finish"], [data-action="finish"]'
    );
    for (var i = 0; i < tagged.length; i++) found.push(tagged[i]);
    var all = doc.getElementsByTagName("button");
    for (var j = 0; j < all.length; j++) {
      if (found.indexOf(all[j]) === -1 && (all[j].textContent || "").trim() === "Завершить тест") found.push(all[j]);
    }
    found.forEach(function (b) {
      if (b.__tbFinishWired) return;
      b.__tbFinishWired = true;
      // Disable ONLY this button after ITS OWN click (prevents a double-submit of the
      // same action). A finish button on a DIFFERENT screen — e.g. the per-question
      // «Завершить тест» vs the results-page one — is independent and stays enabled.
      b.addEventListener("click", function () {
        setTimeout(function () { b.disabled = true; }, 0);
      });
    });
  }

  window.TBInspector = {
    fmtNum: fmtNum, trunc: trunc, byteLen: byteLen, fmtBytes: fmtBytes,
    buildScore: buildScore, buildDraw: buildDraw,
    applyReference: applyReference, clearReference: clearReference, guardFinishButton: guardFinishButton,
    readPkg: readPkg, parseInteractions: parseInteractions, interactionById: interactionById,
    typeLabel: typeLabel, humanAnswer: humanAnswer, isActiveMeasure: isActiveMeasure,
    contributionsFor: contributionsFor, priceFor: priceFor,
    buildLiveRows: buildLiveRows, buildAttemptRows: buildAttemptRows, getSuspendAttempts: getSuspendAttempts,
    buildProtocolRows: buildProtocolRows, buildScaleRows: buildScaleRows, buildResultRows: buildResultRows,
    flattenLimited: flattenLimited, buildStateTree: buildStateTree, dispVal: dispVal, safeJson: safeJson,
    humanizeTraffic: humanizeTraffic, buildLmsTable: buildLmsTable, buildLmsRawLog: buildLmsRawLog,
    buildAdaptiveBar: buildAdaptiveBar, buildAdaptivePath: buildAdaptivePath,
  };
})();
