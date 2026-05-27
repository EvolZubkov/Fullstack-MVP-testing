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

app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(PLAYER_HTML);
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`SCORM player on http://localhost:${PORT}  (serving zips from ${OUT_DIR})`);
});

// ─── Player page (RTE shim on the parent window + iframe) ────────────────────────

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
  #stageWrap { display: flex; height: calc(100vh - 53px); }
  #stage { flex: 1; border: 0; background: #fff; }
  #log { width: 360px; max-width: 40vw; background: #0b0d11; border-left: 1px solid #262b36; overflow: auto; padding: 8px; font: 12px/1.45 ui-monospace, monospace; display: none; }
  #log.open { display: block; }
  #log .row { padding: 2px 4px; border-bottom: 1px solid #1a1e26; white-space: pre-wrap; word-break: break-word; }
  #log .set { color: #93c5fd; }
  #log .get { color: #86efac; }
  #log .ev { color: #fbbf24; }
  .hint { color: #8b93a4; }
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
  <button id="toggleLog">Лог SCORM</button>
</header>
<div id="stageWrap">
  <iframe id="stage" title="SCORM content"></iframe>
  <div id="log"><div class="row hint">Лог вызовов SCORM RTE появится здесь после запуска пакета.</div></div>
</div>

<script>
// ─── SCORM 2004 RTE shim (lives on the player window; iframe walks parent) ──────
(function () {
  var cmi = {};
  var currentKey = "scorm-player-default";
  var logEl = document.getElementById("log");

  function log(kind, msg) {
    var row = document.createElement("div");
    row.className = "row " + kind;
    row.textContent = msg;
    logEl.appendChild(row);
    logEl.scrollTop = logEl.scrollHeight;
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
    try {
      var saved = JSON.parse(localStorage.getItem(key) || "null");
      if (saved && typeof saved === "object") {
        Object.assign(cmi, saved);
        cmi["cmi.entry"] = cmi["cmi.suspend_data"] ? "resume" : "ab-initio";
      }
    } catch (e) {}
  }
  function resetAttempt() {
    try { localStorage.removeItem(currentKey); } catch (e) {}
    cmi = defaults();
  }

  var API_1484_11 = {
    Initialize: function () { log("ev", "Initialize()"); return "true"; },
    Terminate: function () { log("ev", "Terminate()"); persist(); return "true"; },
    GetValue: function (k) { var v = cmi[k] != null ? String(cmi[k]) : ""; log("get", "GetValue(" + k + ") -> " + v); return v; },
    SetValue: function (k, v) { cmi[k] = v; log("set", "SetValue(" + k + ", " + String(v).slice(0, 120) + ")"); return "true"; },
    Commit: function () { log("ev", "Commit()"); persist(); return "true"; },
    GetLastError: function () { return "0"; },
    GetErrorString: function () { return ""; },
    GetDiagnostic: function () { return ""; },
  };
  window.API_1484_11 = API_1484_11;
  window.__scormRestore = restore;
  window.__scormReset = resetAttempt;
})();

// ─── UI wiring ──────────────────────────────────────────────────────────────────
(function () {
  var pkgSel = document.getElementById("pkg");
  var loadBtn = document.getElementById("loadBtn");
  var fileInp = document.getElementById("file");
  var stage = document.getElementById("stage");
  var logEl = document.getElementById("log");
  var toggleLog = document.getElementById("toggleLog");
  var resetBtn = document.getElementById("reloadAttempt");
  var lastLoad = null;

  toggleLog.onclick = function () { logEl.classList.toggle("open"); };

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
    window.__scormRestore(key);
    lastLoad = { result: result, key: key };
    stage.src = "/play/" + result.token + "/" + result.launch;
    logEl.querySelector(".hint") && (logEl.innerHTML = "");
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
    window.__scormReset();
    stage.src = "/play/" + lastLoad.result.token + "/" + lastLoad.result.launch + "?_=" + Date.now();
  };

  refreshPackages();
})();
</script>
</body>
</html>`;
