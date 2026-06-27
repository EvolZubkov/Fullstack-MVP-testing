// ─── UI wiring + inspector RENDER (CLI host) ─────────────────────────────────────
// Thin renderer over the shared compute layer `window.TBInspector`
// (assets/inspector-compute.js): all correctness-critical logic lives there; this
// file only arranges that data into the CLI player's HTML. The in-service player
// (React) renders the SAME `TBInspector` data as DS components (PRD-18 FR-13, R-1).
(function () {
  var TB = window.TBInspector;
  var pkgSel = document.getElementById("pkg");
  var loadBtn = document.getElementById("loadBtn");
  var fileInp = document.getElementById("file");
  var stage = document.getElementById("stage");
  var inspector = document.getElementById("inspector");
  var toggleLog = document.getElementById("toggleLog");
  var resetBtn = document.getElementById("reloadAttempt");
  var lastLoad = null;

  toggleLog.onclick = function () { inspector.classList.toggle("closed"); };

  // Tabs
  var PANELS = ["protocol", "scales", "results", "watch", "lms"];
  var tabBtns = document.querySelectorAll("#tabs button");
  for (var i = 0; i < tabBtns.length; i++) {
    tabBtns[i].onclick = function () {
      var tab = this.getAttribute("data-tab");
      for (var j = 0; j < tabBtns.length; j++) tabBtns[j].classList.toggle("active", tabBtns[j] === this);
      PANELS.forEach(function (t) {
        document.getElementById("panel-" + t).classList.toggle("active", t === tab);
      });
    };
  }

  // ── Local render helpers (HTML escaping is a render concern; the package data
  // is read live in TBInspector). `fmtNum` re-adds the "—" placeholder the data
  // layer leaves as null. ──
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function fmtNum(n) { var v = TB.fmtNum(n); return v == null ? "—" : String(v); }
  var trunc = TB.trunc, byteLen = TB.byteLen, fmtBytes = TB.fmtBytes;

  // Read the live package off the iframe window (same-origin).
  function readPkg() { return TB.readPkg(stage.contentWindow); }

  // ── Render: Шкалы ──
  function renderScales(pkg, ints) {
    var body = document.getElementById("scales-body");
    var table = document.getElementById("scales-table");
    var empty = document.getElementById("scales-empty");
    var errBox = document.getElementById("scales-errors");
    var rows = TB.buildScaleRows(pkg, ints);
    document.getElementById("b-scales").textContent = String(rows.length);
    if (!rows.length) {
      table.style.display = "none"; empty.style.display = "";
      empty.textContent = pkg && pkg.hasData ? "В тесте нет шкал." : "Запустите пакет. Значения шкал пересчитываются вживую по ответам (state.answers).";
      errBox.innerHTML = ""; return;
    }
    empty.style.display = "none"; table.style.display = "";
    body.innerHTML = rows.map(function (r) {
      var lvl = r.level ? '<span class="lvl ' + esc(r.level) + '">' + esc(r.levelLabel) + "</span>" : '<span class="muted">—</span>';
      var pub = r.pub ? '<span class="pub">' + esc(r.pub) + "</span>" : '<span class="nopub">— (до завершения)</span>';
      return "<tr><td>" + esc(r.key) + "</td><td class=num>" + (r.raw == null ? "—" : fmtNum(r.raw)) + "</td><td class=num>" +
        (r.percent == null ? "—" : fmtNum(r.percent)) + "</td><td>" + lvl + "</td><td>" + pub + "</td></tr>";
    }).join("");
    var errs = (pkg && pkg.scaleErrors) || [];
    errBox.innerHTML = errs.length ? '<div class="err">Ошибки шкал: ' + esc(errs.map(function (e) { return e.key + ": " + e.message; }).join("; ")) + "</div>" : "";
  }

  // ── Render: Показатели ──
  function renderResults(pkg, ints) {
    var body = document.getElementById("results-body");
    var table = document.getElementById("results-table");
    var empty = document.getElementById("results-empty");
    var errBox = document.getElementById("results-errors");
    var rows = TB.buildResultRows(pkg, ints);
    document.getElementById("b-results").textContent = String(rows.length);
    if (!rows.length) {
      table.style.display = "none"; empty.style.display = "";
      empty.textContent = pkg && pkg.hasData ? "В тесте нет показателей." : "Запустите пакет."; errBox.innerHTML = ""; return;
    }
    empty.style.display = "none"; table.style.display = "";
    body.innerHTML = rows.map(function (r) {
      var liveStr = r.live == null ? '<span class="muted">—</span>' : esc(r.live);
      var pubStr = r.pub != null ? '<span class="pub">' + esc(r.pub) + "</span>" : '<span class="nopub">— (до завершения)</span>';
      return "<tr><td>" + esc(r.name) + "</td><td>" + liveStr + "</td><td>" + pubStr + "</td></tr>";
    }).join("");
    var errs = (pkg && pkg.resultErrors) || [];
    errBox.innerHTML = errs.length ? '<div class="err">Ошибки формул: ' + esc(errs.map(function (e) { return e.name + ": " + e.message; }).join("; ")) + "</div>" : "";
  }

  // ═══ Протокол ответов ═══════════════════════════════════════════════════════
  var protoRows = []; // structured rows from TBInspector — also the CSV source.

  function renderProtocol(pkg, cmi) {
    var listEl = document.getElementById("proto-list");
    var emptyEl = document.getElementById("proto-empty");
    var sel = document.getElementById("proto-attempt");
    var res = TB.buildProtocolRows(pkg, cmi, sel.value || "live");
    var rows = res.rows;
    document.getElementById("b-protocol").textContent = String(rows.length);
    protoRows = rows;
    if (!rows.length) {
      listEl.innerHTML = ""; emptyEl.style.display = "";
      emptyEl.textContent = res.note || (pkg && pkg.hasData
        ? "Пока нет выданных вопросов — начните отвечать."
        : "Запустите пакет и начните отвечать — здесь появится протокол.");
      return;
    }
    emptyEl.style.display = "none";
    listEl.innerHTML = rows.map(function (r) {
      var vlabel = r.verdict === "none" ? '<span class="tag">— нет ответа</span>'
        : r.verdict === "correct" ? '<span class="tag ok">верно</span>'
        : r.verdict === "partial" ? '<span class="tag part">частично ' + r.ratioPct + "%</span>"
        : '<span class="tag no">неверно</span>';
      var balStr = " · балл " + fmtNum(r.earned) + "/" + fmtNum(r.points);
      var priceTag = r.priceNote
        ? '<span class="tag price">' + esc(r.priceNote) + balStr + "</span>"
        : r.score != null
          ? '<span class="tag price">цена ' + fmtNum(r.score) + "/" + fmtNum(r.sMax) + balStr + "</span>"
          : "";
      var diffTag = r.difficulty != null ? '<span class="tag diff">сложность ' + esc(r.difficulty) + "</span>" : "";
      var lvlTag = r.levelName ? '<span class="tag lvl2">' + esc(r.levelName) + "</span>" : "";
      var contribStr = r.contribs.map(function (c) {
        return '<span class="contrib' + (c.delta < 0 ? " neg" : "") + '">' + esc(c.scaleKey) + " " + (c.delta >= 0 ? "+" : "") + fmtNum(c.delta) + "</span>";
      }).join(", ");
      return '<div class="pcard">' +
        '<div class="pcard-head"><span class="pcard-idx">#' + r.idx + "</span>" +
        '<span class="tag">' + esc(r.typeLabel) + "</span>" + vlabel + priceTag + diffTag + lvlTag + "</div>" +
        '<div class="pcard-q" title="' + esc(r.prompt) + '">' + esc(trunc(r.prompt || "(без текста)", 160)) +
        (r.topicName ? ' <span class="muted">· ' + esc(r.topicName) + "</span>" : "") + "</div>" +
        '<div class="pcard-row"><b>Ответ:</b> ' + esc(r.answerStr) + "</div>" +
        (contribStr ? '<div class="pcard-row"><b>Вклад в шкалы:</b> ' + contribStr + "</div>" : "") +
        "</div>";
    }).join("");
  }

  function updateAttemptSelector(cmi) {
    var sel = document.getElementById("proto-attempt");
    var atts = TB.getSuspendAttempts(cmi);
    if (sel.options.length === 1 + atts.length) return;
    var cur = sel.value;
    sel.innerHTML = "";
    var oLive = document.createElement("option"); oLive.value = "live"; oLive.textContent = "Текущая (live)"; sel.appendChild(oLive);
    atts.forEach(function (a, i) {
      var o = document.createElement("option"); o.value = "att:" + i;
      o.textContent = "#" + (a.attemptNumber || i + 1) + " — " + Math.round(a.percent) + "%"; sel.appendChild(o);
    });
    for (var j = 0; j < sel.options.length; j++) if (sel.options[j].value === cur) { sel.value = cur; break; }
  }

  function exportCsv() {
    if (!protoRows.length) return;
    function csv(s) { s = String(s == null ? "" : s); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
    var lines = [["#", "Тема", "Вопрос", "Тип", "Ответ", "Верность", "Ratio", "score", "sMax", "Балл", "ВозможныйБалл", "Сложность", "ВкладыВШкалы"].join(";")];
    protoRows.forEach(function (r, i) {
      var contribsPlain = r.contribs.map(function (c) { return c.scaleKey + " " + (c.delta >= 0 ? "+" : "") + fmtNum(c.delta); }).join(" | ");
      lines.push([i + 1, csv(r.topicName), csv(r.prompt), r.type, csv(r.answerStr), r.verdict, r.ratio,
        r.score == null ? "" : r.score, r.sMax == null ? "" : r.sMax, r.earned, r.points,
        r.difficulty == null ? "" : r.difficulty, csv(contribsPlain)].join(";"));
    });
    var blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = "protocol.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  // ═══ Состояние (watch) — debugger-style flat path→value with live highlighting ═
  var watchSrc = "state";
  var lastWatchFlat = {}, lastWatchInit = false, lastWatchSig = null, lastWatchFilter = null, lastWatchSrc = null;

  function renderWatch(pkg, cmi) {
    var sizeEl = document.getElementById("watch-size");
    var table = document.getElementById("watch-table");
    var empty = document.getElementById("watch-empty");
    var body = document.getElementById("watch-body");
    var jsonEl = document.getElementById("watch-json");

    var obj = null, rawJson = "—", sizePill = "—", sizeCls = "size-pill", emptyMsg = "";
    if (watchSrc === "state") {
      obj = (pkg && pkg.state) || null;
      emptyMsg = "Запустите пакет — здесь появится живое состояние рантайма (answers, currentIndex, adaptiveState, таймеры…).";
      rawJson = obj ? TB.safeJson(obj) : "—";
    } else if (watchSrc === "suspend") {
      var raw = (cmi && cmi["cmi.suspend_data"]) || "";
      var size = byteLen(raw);
      sizePill = raw ? fmtBytes(size) : "—";
      sizeCls = "size-pill" + (size > 64 * 1024 ? " over" : (size > 16 * 1024 ? " warn" : ""));
      try { obj = JSON.parse(raw || "null"); } catch (e) { obj = null; }
      rawJson = obj ? JSON.stringify(obj, null, 2) : (raw || "—");
      emptyMsg = raw ? "suspend_data не в JSON-формате (см. сырой ниже)."
        : "suspend_data ещё не записан. Для адаптивных/таймерных тестов он пишется только при завершении попытки — смотрите состояние в источнике «state».";
    } else { // cmi
      obj = (cmi && Object.keys(cmi).length) ? cmi : null;
      emptyMsg = "Нет данных cmi — запустите пакет.";
      rawJson = obj ? TB.safeJson(obj) : "—";
    }

    var flat = obj ? TB.flattenLimited(obj) : [];
    if (watchSrc !== "suspend") sizePill = flat.length + (watchSrc === "cmi" ? " ключей" : " узлов");
    sizeEl.textContent = sizePill; sizeEl.className = sizeCls;
    document.getElementById("b-watch").textContent = obj ? (watchSrc === "suspend" ? sizePill : String(flat.length)) : "—";
    jsonEl.textContent = rawJson;

    var filter = (document.getElementById("watch-filter").value || "").toLowerCase();
    if (!obj) {
      table.style.display = "none"; empty.style.display = ""; empty.textContent = emptyMsg;
      lastWatchInit = false; lastWatchFlat = {}; lastWatchSig = null; lastWatchFilter = filter; lastWatchSrc = watchSrc;
      return;
    }

    var filtered = filter ? flat.filter(function (kv) { return kv.path.toLowerCase().indexOf(filter) !== -1; }) : flat;
    var sig = filtered.length + "|" + filtered.map(function (kv) { return kv.path + ":" + kv.disp; }).join(";;");
    if (watchSrc === lastWatchSrc && sig === lastWatchSig && filter === lastWatchFilter) return;

    empty.style.display = "none"; table.style.display = "";
    var srcChanged = watchSrc !== lastWatchSrc;
    var capped = filtered.slice(0, 500);
    var html = capped.map(function (kv) {
      var changed = !srcChanged && lastWatchInit && lastWatchFlat[kv.path] !== undefined && lastWatchFlat[kv.path] !== kv.disp;
      var isNew = !srcChanged && lastWatchInit && lastWatchFlat[kv.path] === undefined;
      return "<tr" + ((changed || isNew) ? ' class="changed"' : "") + '><td class="path">' + esc(kv.path) + '</td><td class="val">' + esc(kv.disp) + "</td></tr>";
    }).join("");
    if (filtered.length > capped.length) html += '<tr><td class="path muted">…</td><td class="val muted">+' + (filtered.length - capped.length) + " строк скрыто (уточните фильтр)</td></tr>";
    body.innerHTML = html;

    lastWatchFlat = {}; flat.forEach(function (kv) { lastWatchFlat[kv.path] = kv.disp; });
    lastWatchInit = true; lastWatchSig = sig; lastWatchFilter = filter; lastWatchSrc = watchSrc;
  }

  // ═══ LMS-журнал (очеловеченный) ══════════════════════════════════════════════
  var lmsLogEl = document.getElementById("lmsLog");
  var rawLogEl = document.getElementById("scormLog");
  var hideGet = document.getElementById("hideGet");
  var renderedRaw = 0, lastHumanCount = -1;

  hideGet.onchange = function () { renderedRaw = 0; rawLogEl.innerHTML = ""; renderRaw(); };

  function renderLms() {
    if (!window.__scorm) return;
    var events = TB.humanizeTraffic(window.__scorm.getTraffic());
    document.getElementById("b-lms").textContent = String(events.length);
    if (events.length !== lastHumanCount) {
      lmsLogEl.innerHTML = events.length
        ? events.map(function (ev) { return '<div class="row ' + ev.kind + '">' + esc(ev.text) + (ev.sub ? '<span class="sub">' + esc(ev.sub) + "</span>" : "") + "</div>"; }).join("")
        : '<div class="row hint">События обмена с LMS появятся здесь после запуска пакета.</div>';
      lmsLogEl.scrollTop = lmsLogEl.scrollHeight;
      lastHumanCount = events.length;
    }
    renderRaw();
  }

  function classForRaw(fn) { return fn === "GetValue" ? "get" : fn === "SetValue" ? "set" : "ev"; }
  function renderRaw() {
    if (!window.__scorm) return;
    var traffic = window.__scorm.getTraffic();
    if (renderedRaw === 0) rawLogEl.innerHTML = "";
    for (var i = renderedRaw; i < traffic.length; i++) {
      var e = traffic[i];
      if (hideGet.checked && e.fn === "GetValue") continue;
      var row = document.createElement("div");
      row.className = "row " + classForRaw(e.fn);
      var txt = e.fn + "(" + esc(e.key || "");
      if (e.fn === "SetValue") txt += ", " + esc(String(e.value).slice(0, 160));
      txt += ")";
      var ret = e.ret != null ? "  → " + esc(String(e.ret).slice(0, 160)) : "";
      var err = e.err && e.err !== "0" ? '  <span class="e">[err ' + esc(e.err) + "]</span>" : "";
      row.innerHTML = txt + '<span class="ret">' + ret + "</span>" + err;
      rawLogEl.appendChild(row);
    }
    renderedRaw = traffic.length;
    rawLogEl.scrollTop = rawLogEl.scrollHeight;
  }

  // ── Header indicator: adaptive progress (current topic/level + confirmed) ──
  function renderAdaptiveBar(pkg) {
    var bar = document.getElementById("adaptiveBar");
    var ab = TB.buildAdaptiveBar(pkg);
    if (!ab.visible) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");

    var nowEl = document.getElementById("adaptive-now");
    if (ab.finished) {
      nowEl.innerHTML = '<span class="ab-chip done">Тест завершён</span>';
    } else if (ab.now) {
      var n = ab.now;
      nowEl.innerHTML = '<span class="ab-now">▸ Тема ' + n.topicIndex + "/" + n.topicCount + ": " +
        esc(n.topicName) + " · " + esc(n.levelName) + " · сложность " + n.minDifficulty + "–" + n.maxDifficulty + "</span>";
    } else {
      nowEl.innerHTML = "";
    }

    var chips = ab.confirmed.map(function (c) {
      if (c.kind === "ok") {
        return '<span class="ab-chip ok" title="' + esc(c.topicName) + ": подтверждён (" + c.correctCount + "/" + c.total + ')">' +
          esc(c.topicName) + " · " + esc(c.levelName) + " ✓</span>";
      }
      return '<span class="ab-chip no">' + esc(c.topicName) + " · уровень не достигнут</span>";
    });
    document.getElementById("adaptive-confirmed").innerHTML =
      '<span class="ab-label">Подтверждено:</span> ' + (chips.length ? chips.join(" ") : '<span class="muted">пока ничего</span>');
  }

  // ── Real-time loop: recompute everything off the live package window ──
  function tick() {
    var pkg = readPkg();
    var cmi = (window.__scorm && window.__scorm.getCmi()) || {};
    var ints = TB.parseInteractions(cmi);
    renderLms();
    renderWatch(pkg, cmi);
    renderAdaptiveBar(pkg);
    updateAttemptSelector(cmi);
    renderProtocol(pkg, cmi);
    if (pkg) { renderScales(pkg, ints); renderResults(pkg, ints); }
  }
  if (window.__scorm) window.__scorm.subscribe(function () { renderLms(); });
  setInterval(tick, 600);

  // Protocol controls
  document.getElementById("proto-attempt").onchange = function () {
    renderProtocol(readPkg(), (window.__scorm && window.__scorm.getCmi()) || {});
  };
  document.getElementById("proto-export").onclick = exportCsv;

  // Watch controls: source toggle + path filter
  var watchSegBtns = document.querySelectorAll("#watch-src button");
  for (var wi = 0; wi < watchSegBtns.length; wi++) {
    watchSegBtns[wi].onclick = function () {
      watchSrc = this.getAttribute("data-src");
      for (var wj = 0; wj < watchSegBtns.length; wj++) watchSegBtns[wj].classList.toggle("active", watchSegBtns[wj] === this);
      lastWatchSig = null;
      renderWatch(readPkg(), (window.__scorm && window.__scorm.getCmi()) || {});
    };
  }
  document.getElementById("watch-filter").oninput = function () {
    lastWatchSig = null; // force rebuild on filter change
    renderWatch(readPkg(), (window.__scorm && window.__scorm.getCmi()) || {});
  };

  // Clear all inspector views when (re)loading a package or resetting an attempt.
  function resetInspector() {
    renderedRaw = 0; lastHumanCount = -1;
    if (rawLogEl) rawLogEl.innerHTML = "";
    if (lmsLogEl) lmsLogEl.innerHTML = '<div class="row hint">События обмена с LMS появятся здесь после запуска пакета.</div>';
    lastWatchFlat = {}; lastWatchInit = false; lastWatchSig = null; lastWatchFilter = null; lastWatchSrc = null;
    watchSrc = "state";
    var segs = document.querySelectorAll("#watch-src button");
    for (var si = 0; si < segs.length; si++) segs[si].classList.toggle("active", segs[si].getAttribute("data-src") === "state");
    protoRows = [];
    var sel = document.getElementById("proto-attempt");
    if (sel) sel.innerHTML = '<option value="live">Текущая (live)</option>';
  }

  function refreshPackages() {
    fetch("/api/packages").then(function (r) { return r.json(); }).then(function (d) {
      pkgSel.innerHTML = "";
      (d.packages || []).forEach(function (p) {
        var o = document.createElement("option");
        o.value = p.name;
        o.textContent = p.name + "  (" + (p.size / 1024).toFixed(0) + " KB)";
        pkgSel.appendChild(o);
      });
      if (!(d.packages || []).length) {
        var o = document.createElement("option");
        o.textContent = "out/ пуст — запустите npm run scorm:sample";
        o.disabled = true;
        pkgSel.appendChild(o);
      }
    });
  }

  function play(result, key) {
    window.__scorm.restore(key);
    lastLoad = { result: result, key: key };
    resetInspector();
    stage.src = "/play/" + result.token + "/" + result.launch + "?object_id=1234567890";
  }

  loadBtn.onclick = function () {
    var name = pkgSel.value;
    if (!name) return;
    fetch("/api/load", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name }) })
      .then(function (r) { return r.json(); })
      .then(function (res) { if (res.error) return alert(res.error); play(res, "pkg:" + name); });
  };

  fileInp.onchange = function () {
    var f = fileInp.files && fileInp.files[0];
    if (!f) return;
    var fd = new FormData();
    fd.append("file", f);
    fetch("/api/upload", { method: "POST", body: fd })
      .then(function (r) { return r.json(); })
      .then(function (res) { if (res.error) return alert(res.error); play(res, "file:" + f.name); });
  };

  resetBtn.onclick = function () {
    if (!lastLoad) return;
    window.__scorm.reset();
    resetInspector();
    stage.src = "/play/" + lastLoad.result.token + "/" + lastLoad.result.launch + "?object_id=1234567890&_=" + Date.now();
  };

  // ── PRD-6 WebTutor mock controls ──────────────────────────────────────────
  var mockDate = document.getElementById("mockDate");
  var mockState = document.getElementById("mockState");
  var mockProgress = document.getElementById("mockProgress");
  var mockStatus = document.getElementById("mockStatus");

  function reloadStage() {
    if (!lastLoad) return;
    stage.src = "/play/" + lastLoad.result.token + "/" + lastLoad.result.launch + "?_=" + Date.now();
  }
  function postMock(body, label) {
    return fetch("/api/mock-webtutor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function () { mockStatus.textContent = label; reloadStage(); });
  }
  document.getElementById("mockApply").onclick = function () {
    postMock(
      { lastDate: mockDate.value || "", state: mockState.value, progress: mockProgress.value },
      mockDate.value ? "посл. прохождение: " + mockDate.value + " — гейт перезапущен" : "дата не задана — доступ разрешён",
    );
  };
  document.getElementById("mockClear").onclick = function () {
    mockDate.value = "";
    postMock({ lastDate: "" }, "нет прошлой попытки — доступ разрешён");
  };
  fetch("/api/mock-webtutor").then(function (r) { return r.json(); }).then(function (j) {
    if (j && j.mock && j.mock.lastDate) mockDate.value = j.mock.lastDate;
  });

  refreshPackages();
})();
