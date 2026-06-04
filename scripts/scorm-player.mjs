/**
 * @module scripts/scorm-player
 * @description Minimal local SCORM 2004 player for acceptance/preview. Serves a
 * wrapper page that exposes a SCORM 2004 RTE (`window.API_1484_11`) and hosts the
 * package launch HTML in an iframe. Packages are loaded from `out/*.zip` or via
 * file upload, unzipped in memory (JSZip) and served statically over HTTP — so the
 * runtime's relative assets (`template/`, `app/`, `assets/`) resolve normally.
 *
 * Run: `npm run scorm:player` → open http://localhost:5050
 *
 * Dependencies: express + multer (already prod deps), jszip (present in the
 * dependency tree). This is a dev/acceptance tool, not part of the app build.
 */
import express from "express";
import multer from "multer";
import JSZip from "jszip";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "out");
const PORT = Number(process.env.SCORM_PLAYER_PORT || 5050);

/** token -> Map<relativePath, Buffer> */
const packages = new Map();
/** token -> launch href (relative path inside the package) */
const launches = new Map();

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
};

function contentTypeFor(p) {
  return CONTENT_TYPES[path.extname(p).toLowerCase()] || "application/octet-stream";
}

/** Finds the SCO launch href in an imsmanifest.xml; falls back to index.html. */
function detectLaunch(files) {
  const manifest = files.get("imsmanifest.xml");
  if (manifest) {
    const xml = manifest.toString("utf8");
    // Prefer a resource flagged as an SCO; otherwise the first resource href.
    const sco = xml.match(/<resource\b[^>]*scormType="sco"[^>]*\bhref="([^"]+)"/i);
    const any = xml.match(/<resource\b[^>]*\bhref="([^"]+)"/i);
    const href = (sco && sco[1]) || (any && any[1]);
    if (href && files.has(href)) return href;
  }
  if (files.has("index.html")) return "index.html";
  // last resort: first .html file
  for (const k of files.keys()) if (k.toLowerCase().endsWith(".html")) return k;
  return "index.html";
}

async function loadZipBuffer(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const files = new Map();
  await Promise.all(
    Object.values(zip.files).map(async (entry) => {
      if (entry.dir) return;
      files.set(entry.name, await entry.async("nodebuffer"));
    }),
  );
  const token = randomUUID();
  packages.set(token, files);
  launches.set(token, detectLaunch(files));
  return { token, launch: launches.get(token), fileCount: files.size };
}

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

app.get("/api/packages", (_req, res) => {
  let list = [];
  try {
    list = fs
      .readdirSync(OUT_DIR)
      .filter((f) => f.toLowerCase().endsWith(".zip"))
      .map((f) => ({ name: f, size: fs.statSync(path.join(OUT_DIR, f)).size }));
  } catch {
    /* out/ may not exist yet */
  }
  res.json({ packages: list });
});

app.post("/api/load", express.json(), async (req, res) => {
  try {
    const name = req.body && req.body.name;
    if (!name) return res.status(400).json({ error: "name is required" });
    const zipPath = path.join(OUT_DIR, name);
    if (!fs.existsSync(zipPath)) return res.status(404).json({ error: "package not found in out/" });
    const result = await loadZipBuffer(fs.readFileSync(zipPath));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file is required" });
    const result = await loadZipBuffer(req.file.buffer);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

app.get("/play/:token/*splat", (req, res) => {
  const files = packages.get(req.params.token);
  if (!files) return res.status(404).send("Unknown package token");
  const parts = req.params.splat;
  const rel = decodeURIComponent(Array.isArray(parts) ? parts.join("/") : String(parts || ""));
  const buf = files.get(rel);
  if (!buf) return res.status(404).send("Not found in package: " + rel);
  res.setHeader("Content-Type", contentTypeFor(rel));
  res.send(buf);
});

// ── PRD-6 WebTutor mock (local tooling) ──────────────────────────────────────
// The webtutor_cooldown plugin fetches WebTutor's collection endpoint same-origin
// from the package iframe. There is no live WebTutor locally, so the player mocks
// it: a form sets the module's "last completion date" and the endpoint returns a
// synthetic record (or an empty set => no prior attempt => allowed).
let webtutorMock = { lastDate: null, state: "Завершен", progress: "100%" };

app.get("/api/mock-webtutor", (_req, res) => res.json({ mock: webtutorMock }));

app.post("/api/mock-webtutor", express.json(), (req, res) => {
  const b = req.body || {};
  webtutorMock = {
    lastDate: typeof b.lastDate === "string" && b.lastDate ? b.lastDate : null, // ISO yyyy-mm-dd or null
    state: typeof b.state === "string" && b.state ? b.state : "Завершен",
    progress: typeof b.progress === "string" && b.progress ? b.progress : "100%",
  };
  res.json({ ok: true, mock: webtutorMock });
});

app.get("/pp/Ext5/extjs_json_collection_data.html", (_req, res) => {
  const data = [];
  if (webtutorMock.lastDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(webtutorMock.lastDate);
    const ddmmyyyy = m ? `${m[3]}.${m[2]}.${m[1]}` : webtutorMock.lastDate;
    data.push({ state: webtutorMock.state, progress: webtutorMock.progress, last_usage_date: ddmmyyyy });
  }
  res.json({ data });
});

app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(PLAYER_HTML);
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`SCORM player on http://localhost:${PORT}  (serving zips from ${OUT_DIR})`);
});

// ─── Player page (RTE shim on the parent window + iframe + inspector) ────────────

const PLAYER_HTML = /* html */ `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>SCORM 2004 Player</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.4 system-ui, sans-serif; background: #0f1115; color: #e6e8ec; }
  header { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 10px 14px; background: #171a21; border-bottom: 1px solid #262b36; }
  header h1 { font-size: 15px; margin: 0 12px 0 0; font-weight: 600; }
  select, button, input[type=file] { font: inherit; color: inherit; background: #222732; border: 1px solid #353c4a; border-radius: 6px; padding: 6px 10px; }
  button { cursor: pointer; }
  button.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
  button:disabled { opacity: .5; cursor: default; }
  .spacer { flex: 1; }
  #mockBar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 12px; background: #0e1117; border-bottom: 1px solid #1a1e26; }
  #mockBar input { background: #11141a; border: 1px solid #2a2f3a; color: #cbd5e1; border-radius: 4px; padding: 3px 6px; font-size: 12px; }
  #mockBar #mockStatus { color: #6ee7b7; }
  #stageWrap { display: flex; height: calc(100vh - 92px); }
  #stage { flex: 1; border: 0; background: #fff; }
  .hint { color: #8b93a4; }

  /* ── Inspector ── */
  #inspector { width: 460px; max-width: 46vw; background: #0b0d11; border-left: 1px solid #262b36; display: flex; flex-direction: column; }
  #inspector.closed { display: none; }
  #tabs { display: flex; border-bottom: 1px solid #262b36; flex: 0 0 auto; }
  #tabs button { flex: 1; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; padding: 8px 6px; font-size: 12px; color: #8b93a4; }
  #tabs button.active { color: #e6e8ec; border-bottom-color: #3b82f6; }
  #tabs .badge { display: inline-block; min-width: 16px; padding: 0 4px; margin-left: 4px; border-radius: 8px; background: #262b36; color: #cbd5e1; font-size: 10px; }
  .panel { display: none; overflow: auto; padding: 8px 10px; flex: 1; }
  .panel.active { display: block; }
  .panel h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #8b93a4; margin: 10px 0 4px; font-weight: 600; }
  .panel h2:first-child { margin-top: 0; }
  table.insp { width: 100%; border-collapse: collapse; font: 12px/1.4 ui-monospace, monospace; }
  table.insp th, table.insp td { text-align: left; padding: 3px 6px; border-bottom: 1px solid #1a1e26; vertical-align: top; }
  table.insp th { color: #8b93a4; font-weight: 600; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .lvl { display: inline-block; padding: 0 6px; border-radius: 8px; font-size: 11px; background: #262b36; color: #cbd5e1; }
  .lvl.high { background: #7f1d1d; color: #fecaca; }
  .lvl.mid { background: #78350f; color: #fde68a; }
  .lvl.low { background: #14532d; color: #bbf7d0; }
  .pub { color: #93c5fd; }
  .nopub { color: #6b7280; }
  .err { color: #fca5a5; }
  .muted { color: #6b7280; }
  #scormLog { font: 12px/1.45 ui-monospace, monospace; }
  #scormLog .row { padding: 2px 4px; border-bottom: 1px solid #1a1e26; white-space: pre-wrap; word-break: break-word; }
  #scormLog .set { color: #93c5fd; }
  #scormLog .get { color: #86efac; }
  #scormLog .ev { color: #fbbf24; }
  #scormLog .ret { color: #6b7280; }
  #scormLog .e { color: #fca5a5; }
  pre.json { white-space: pre-wrap; word-break: break-word; font: 11px/1.4 ui-monospace, monospace; color: #cbd5e1; margin: 0; background: #11141a; border: 1px solid #1a1e26; border-radius: 6px; padding: 6px; max-height: 240px; overflow: auto; }
  label.filter { font-size: 11px; color: #8b93a4; display: inline-flex; gap: 4px; align-items: center; margin: 4px 0; }
</style>
</head>
<body>
<header>
  <h1>SCORM 2004 Player</h1>
  <select id="pkg" title="Пакеты из out/"></select>
  <button id="loadBtn">Загрузить из out/</button>
  <span class="hint">или</span>
  <input id="file" type="file" accept=".zip" />
  <span class="spacer"></span>
  <button id="reloadAttempt" title="Сбросить cmi и перезапустить">Сброс попытки</button>
  <button id="toggleLog">Инспектор</button>
</header>
<div id="mockBar" title="PRD-6: локальный мок WebTutor для retake-гейта">
  <span class="hint">WebTutor-мок · дата посл. прохождения:</span>
  <input id="mockDate" type="date" />
  <input id="mockState" type="text" value="Завершен" size="10" title="статус записи" />
  <input id="mockProgress" type="text" value="100%" size="6" title="прогресс" />
  <button id="mockApply">Применить + перезапустить</button>
  <button id="mockClear" title="Нет прошлой попытки (доступ разрешён)">Очистить</button>
  <span class="hint" id="mockStatus"></span>
</div>
<div id="stageWrap">
  <iframe id="stage" title="SCORM content"></iframe>
  <aside id="inspector">
    <nav id="tabs">
      <button data-tab="scales" class="active">Шкалы <span class="badge" id="b-scales">0</span></button>
      <button data-tab="results">Показатели <span class="badge" id="b-results">0</span></button>
      <button data-tab="scorm">SCORM ↔ LMS <span class="badge" id="b-scorm">0</span></button>
    </nav>

    <section class="panel active" id="panel-scales">
      <div class="hint" id="scales-empty">Запустите пакет. Значения шкал пересчитываются вживую по ответам (state.answers), как это делает сам пакет.</div>
      <table class="insp" id="scales-table" style="display:none">
        <thead><tr><th>Ключ</th><th class="num">raw</th><th class="num">%</th><th>Уровень</th><th>→ LMS</th></tr></thead>
        <tbody id="scales-body"></tbody>
      </table>
      <div id="scales-errors"></div>
    </section>

    <section class="panel" id="panel-results">
      <div class="hint" id="results-empty">Запустите пакет. Показатели (result.*) пересчитываются вживую теми же формулами, что и в пакете.</div>
      <table class="insp" id="results-table" style="display:none">
        <thead><tr><th>Имя</th><th>Значение (live)</th><th>→ LMS</th></tr></thead>
        <tbody id="results-body"></tbody>
      </table>
      <div id="results-errors"></div>
    </section>

    <section class="panel" id="panel-scorm">
      <label class="filter"><input type="checkbox" id="hideGet" /> скрыть GetValue</label>
      <h2>Журнал вызовов RTE (модуль → LMS → ответ)</h2>
      <div id="scormLog"><div class="row hint">Вызовы SCORM RTE появятся здесь после запуска пакета.</div></div>
      <h2>Интеракции (cmi.interactions.*)</h2>
      <table class="insp" id="int-table"><thead><tr><th>id</th><th>learner_response</th><th>Описание</th></tr></thead><tbody id="int-body"></tbody></table>
      <div class="hint" id="int-empty">Интеракции пишутся в LMS при завершении попытки.</div>
      <h2>suspend_data — последняя попытка (scale.*/result.*)</h2>
      <pre class="json" id="suspend-json">—</pre>
    </section>
  </aside>
</div>

<script>
// ─── SCORM 2004 RTE shim — records structured traffic so the inspector can show
//     exactly what the module sends to the LMS and what the LMS answers back ──────
(function () {
  var cmi = {};
  var traffic = [];
  var seq = 0;
  var lastError = "0";
  var currentKey = "scorm-player-default";
  var listeners = [];

  function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) {} } }
  function record(fn, key, value, ret) {
    traffic.push({ seq: ++seq, t: Date.now(), fn: fn, key: key, value: value, ret: ret, err: lastError });
    if (traffic.length > 5000) traffic.shift();
    emit();
  }

  function defaults() {
    return {
      "cmi.completion_status": "incomplete",
      "cmi.success_status": "unknown",
      "cmi.entry": "ab-initio",
      "cmi.location": "",
      "cmi.suspend_data": "",
      "cmi.learner_id": "preview-learner",
      "cmi.learner_name": "Предпросмотр",
      "cmi.core.student_id": "preview-learner",
      "cmi.core.student_name": "Предпросмотр",
      "cmi.score.scaled": "",
      "cmi.score.raw": "",
      "cmi.score.min": "",
      "cmi.score.max": "",
      "cmi.mode": "normal",
      "cmi.credit": "credit",
    };
  }

  function persist() {
    try { localStorage.setItem(currentKey, JSON.stringify(cmi)); } catch (e) {}
  }
  function restore(key) {
    currentKey = key;
    cmi = defaults();
    traffic.length = 0;
    seq = 0;
    try {
      var saved = JSON.parse(localStorage.getItem(key) || "null");
      if (saved && typeof saved === "object") {
        Object.assign(cmi, saved);
        cmi["cmi.entry"] = cmi["cmi.suspend_data"] ? "resume" : "ab-initio";
      }
    } catch (e) {}
    emit();
  }
  function resetAttempt() {
    try { localStorage.removeItem(currentKey); } catch (e) {}
    cmi = defaults();
    traffic.length = 0;
    seq = 0;
    emit();
  }

  var API_1484_11 = {
    Initialize: function () { lastError = "0"; record("Initialize", "", null, "true"); return "true"; },
    Terminate: function () { lastError = "0"; persist(); record("Terminate", "", null, "true"); return "true"; },
    GetValue: function (k) { var v = cmi[k] != null ? String(cmi[k]) : ""; lastError = "0"; record("GetValue", k, null, v); return v; },
    SetValue: function (k, v) { cmi[k] = v; lastError = "0"; record("SetValue", k, v, "true"); return "true"; },
    Commit: function () { lastError = "0"; persist(); record("Commit", "", null, "true"); return "true"; },
    GetLastError: function () { return lastError; },
    GetErrorString: function () { return ""; },
    GetDiagnostic: function () { return ""; },
  };
  window.API_1484_11 = API_1484_11;
  window.__scorm = {
    getCmi: function () { return cmi; },
    getTraffic: function () { return traffic; },
    subscribe: function (cb) { listeners.push(cb); },
    restore: restore,
    reset: resetAttempt,
  };
})();

// ─── UI wiring + inspector ────────────────────────────────────────────────────────
(function () {
  var pkgSel = document.getElementById("pkg");
  var loadBtn = document.getElementById("loadBtn");
  var fileInp = document.getElementById("file");
  var stage = document.getElementById("stage");
  var inspector = document.getElementById("inspector");
  var toggleLog = document.getElementById("toggleLog");
  var resetBtn = document.getElementById("reloadAttempt");
  var lastLoad = null;
  var renderedTraffic = 0;

  toggleLog.onclick = function () { inspector.classList.toggle("closed"); };

  // Tabs
  var tabBtns = document.querySelectorAll("#tabs button");
  for (var i = 0; i < tabBtns.length; i++) {
    tabBtns[i].onclick = function () {
      var tab = this.getAttribute("data-tab");
      for (var j = 0; j < tabBtns.length; j++) tabBtns[j].classList.toggle("active", tabBtns[j] === this);
      ["scales", "results", "scorm"].forEach(function (t) {
        document.getElementById("panel-" + t).classList.toggle("active", t === tab);
      });
    };
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function fmtNum(n) { return (typeof n === "number" && isFinite(n)) ? String(Math.round(n * 100) / 100) : "—"; }

  // ── Read live globals straight off the package window (same-origin) ──
  function readLive() {
    var w;
    try { w = stage.contentWindow; } catch (e) { return null; }
    if (!w) return null;
    var live = { hasData: false, hasEngine: false, scaleDefs: [], varDefs: [], scales: {}, results: {}, scaleErrors: [], resultErrors: [] };
    try {
      var TD = w.TEST_DATA;
      if (TD && typeof TD === "object") { live.hasData = true; live.scaleDefs = TD.scales || []; live.varDefs = TD.resultVariables || []; }
    } catch (e) {}
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
      var m = /^cmi\\.interactions\\.(\\d+)\\.(.+)$/.exec(k);
      if (!m) continue;
      (byIdx[m[1]] = byIdx[m[1]] || {})[m[2]] = cmi[k];
    }
    return Object.keys(byIdx).sort(function (a, b) { return a - b; }).map(function (i) { return byIdx[i]; });
  }
  function interactionById(ints, id) {
    for (var i = 0; i < ints.length; i++) if (ints[i].id === id) return ints[i];
    return null;
  }
  function parseSuspendCustom(cmi) {
    try {
      var s = JSON.parse(cmi["cmi.suspend_data"] || "null");
      if (!s || !s.attempts || !s.attempts.length) return null;
      var a = s.attempts[s.attempts.length - 1];
      return {
        scale: a.scaleValues || {},
        result: a.resultValues || {},
        scaleErrors: a.scaleErrors || [],
        formulaErrors: a.formulaErrors || [],
      };
    } catch (e) { return null; }
  }

  // ── Render: Шкалы ──
  function renderScales(live, ints) {
    var body = document.getElementById("scales-body");
    var table = document.getElementById("scales-table");
    var empty = document.getElementById("scales-empty");
    var errBox = document.getElementById("scales-errors");
    var defs = (live && live.scaleDefs) || [];
    document.getElementById("b-scales").textContent = String(defs.length);
    if (!defs.length) { table.style.display = "none"; empty.style.display = ""; empty.textContent = live && live.hasData ? "В тесте нет шкал." : "Запустите пакет. Значения шкал пересчитываются вживую по ответам (state.answers)."; errBox.innerHTML = ""; return; }
    empty.style.display = "none"; table.style.display = "";
    var rows = defs.map(function (d) {
      var v = (live.scales && live.scales[d.key]) || null;
      var lvl = v && v.level ? '<span class="lvl ' + esc(v.level) + '">' + esc(v.label || v.level) + "</span>" : '<span class="muted">—</span>';
      var pubVal = interactionById(ints, "scale_" + d.key);
      var pubLvl = interactionById(ints, "scale_" + d.key + "_level");
      var pub = pubVal
        ? '<span class="pub">' + esc(pubVal.learner_response) + (pubLvl ? " · " + esc(pubLvl.learner_response) : "") + "</span>"
        : '<span class="nopub">— (до завершения)</span>';
      return "<tr><td>" + esc(d.key) + "</td><td class=num>" + (v ? fmtNum(v.raw) : "—") + "</td><td class=num>" +
        (v && v.hasValue && v.percent ? fmtNum(v.percent) : "—") + "</td><td>" + lvl + "</td><td>" + pub + "</td></tr>";
    });
    body.innerHTML = rows.join("");
    var errs = (live.scaleErrors || []);
    errBox.innerHTML = errs.length ? '<div class="err">Ошибки шкал: ' + esc(errs.map(function (e) { return e.key + ": " + e.message; }).join("; ")) + "</div>" : "";
  }

  // ── Render: Показатели ──
  function renderResults(live, ints) {
    var body = document.getElementById("results-body");
    var table = document.getElementById("results-table");
    var empty = document.getElementById("results-empty");
    var errBox = document.getElementById("results-errors");
    var defs = (live && live.varDefs) || [];
    document.getElementById("b-results").textContent = String(defs.length);
    if (!defs.length) { table.style.display = "none"; empty.style.display = ""; empty.textContent = live && live.hasData ? "В тесте нет показателей." : "Запустите пакет."; errBox.innerHTML = ""; return; }
    empty.style.display = "none"; table.style.display = "";
    var rows = defs.map(function (d) {
      var val = (live.results && d.name in live.results) ? live.results[d.name] : undefined;
      var liveStr = val === undefined || val === null ? '<span class="muted">—</span>' : esc(String(val));
      var pub = interactionById(ints, "var_" + d.name);
      var pubStr = pub ? '<span class="pub">' + esc(pub.learner_response) + "</span>" : '<span class="nopub">— (до завершения)</span>';
      return "<tr><td>" + esc(d.name) + "</td><td>" + liveStr + "</td><td>" + pubStr + "</td></tr>";
    });
    body.innerHTML = rows.join("");
    var errs = (live.resultErrors || []);
    errBox.innerHTML = errs.length ? '<div class="err">Ошибки формул: ' + esc(errs.map(function (e) { return e.name + ": " + e.message; }).join("; ")) + "</div>" : "";
  }

  // ── Render: SCORM ↔ LMS (call log + interactions + suspend_data) ──
  var logEl = document.getElementById("scormLog");
  var hideGet = document.getElementById("hideGet");
  hideGet.onchange = function () { renderedTraffic = 0; logEl.innerHTML = ""; renderScorm(true); };

  function classFor(fn) { return fn === "GetValue" ? "get" : fn === "SetValue" ? "set" : "ev"; }
  function renderScorm(full) {
    if (!window.__scorm) return;
    var traffic = window.__scorm.getTraffic();
    var cmi = window.__scorm.getCmi();
    if (full) { logEl.innerHTML = ""; renderedTraffic = 0; }
    if (renderedTraffic === 0 && traffic.length) logEl.innerHTML = "";
    for (var i = renderedTraffic; i < traffic.length; i++) {
      var e = traffic[i];
      if (hideGet.checked && e.fn === "GetValue") continue;
      var row = document.createElement("div");
      row.className = "row " + classFor(e.fn);
      var txt = e.fn + "(" + esc(e.key || "");
      if (e.fn === "SetValue") txt += ", " + esc(String(e.value).slice(0, 160));
      txt += ")";
      var ret = e.ret != null ? "  → " + esc(String(e.ret).slice(0, 160)) : "";
      var err = e.err && e.err !== "0" ? '  <span class="e">[err ' + esc(e.err) + "]</span>" : "";
      row.innerHTML = txt + '<span class="ret">' + ret + "</span>" + err;
      logEl.appendChild(row);
    }
    renderedTraffic = traffic.length;
    logEl.scrollTop = logEl.scrollHeight;
    document.getElementById("b-scorm").textContent = String(traffic.length);

    // Interactions table
    var ints = parseInteractions(cmi);
    var intBody = document.getElementById("int-body");
    var intEmpty = document.getElementById("int-empty");
    if (ints.length) {
      intEmpty.style.display = "none";
      intBody.innerHTML = ints.map(function (it) {
        return "<tr><td>" + esc(it.id) + "</td><td>" + esc(it.learner_response) + "</td><td>" + esc(it.description) + "</td></tr>";
      }).join("");
    } else { intEmpty.style.display = ""; intBody.innerHTML = ""; }

    // suspend_data custom (last attempt's scale/result snapshot)
    var sd = parseSuspendCustom(cmi);
    document.getElementById("suspend-json").textContent = sd
      ? JSON.stringify({ scale: sd.scale, result: sd.result, scaleErrors: sd.scaleErrors, formulaErrors: sd.formulaErrors }, null, 2)
      : "— (появится после завершения попытки)";
    return ints;
  }

  // ── Real-time loop: recompute scales/results off the live package window ──
  function tick() {
    var live = readLive();
    var ints = renderScorm(false) || [];
    if (live) { renderScales(live, ints); renderResults(live, ints); }
  }
  if (window.__scorm) window.__scorm.subscribe(function () { renderScorm(false); });
  setInterval(tick, 600);

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
    renderedTraffic = 0; logEl.innerHTML = "";
    stage.src = "/play/" + result.token + "/" + result.launch;
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
    renderedTraffic = 0; logEl.innerHTML = "";
    stage.src = "/play/" + lastLoad.result.token + "/" + lastLoad.result.launch + "?_=" + Date.now();
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
</script>
</body>
</html>`;
