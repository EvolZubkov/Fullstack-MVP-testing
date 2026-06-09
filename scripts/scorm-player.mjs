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
// object_id is fixed for the local demo (real WebTutor assigns it on upload);
// the player injects it into the launch URL so the gate's resolveObjectId picks it up.
const MOCK_OBJECT_ID = "1234567890";
let webtutorMock = { lastDate: null };

app.get("/api/mock-webtutor", (_req, res) => res.json({ mock: webtutorMock }));

app.post("/api/mock-webtutor", express.json(), (req, res) => {
  const b = req.body || {};
  webtutorMock = { lastDate: typeof b.lastDate === "string" && b.lastDate ? b.lastDate : null };
  res.json({ ok: true, mock: webtutorMock });
});

// Mock the WebTutor course card — the gate scrapes a 32-hex SECID from it.
app.get("/view_doc.html", (_req, res) => {
  res.type("html").send(
    '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<div data-secid="ABCDEF0123456789ABCDEF0123456789">course card</div>' +
    '</body></html>',
  );
});

// Mock ClientBridge get_metadata — returns the course-card XAML carrying the
// «Курс был пройден ДД.ММ.ГГГГ» block when a last-completion date is set.
app.post("/services/ClientBridgeService", express.text({ type: () => true }), (_req, res) => {
  let passedBlock = "";
  if (webtutorMock.lastDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(webtutorMock.lastDate);
    const dd = m ? `${m[3]}.${m[2]}.${m[1]}` : webtutorMock.lastDate;
    passedBlock =
      '&lt;Label Class="XAML-block-best_learn_step_success"&gt;Курс был пройден&lt;/Label&gt;' +
      '&lt;Button Class="XAML-block-best_learn_step"&gt;' + dd + " &amp;rarr;&lt;/Button&gt;";
  }
  const xaml = "&lt;SPXMLScreen&gt;" + passedBlock + "&lt;/SPXMLScreen&gt;";
  res.type("text/xml").send(
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
    '<get_metadataResponse xmlns="http://www.datex-soft.com/"><result>' + xaml + "</result>" +
    "<error>0</error></get_metadataResponse></soap:Body></soap:Envelope>",
  );
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
  body { margin: 0; font: 14px/1.4 system-ui, sans-serif; background: #0f1115; color: #e6e8ec; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
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
  #stageWrap { display: flex; flex: 1; min-height: 0; }

  /* ── Adaptive progress bar (header indicator) ── */
  #adaptiveBar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 12px; background: #0e1117; border-bottom: 1px solid #1a1e26; font-size: 12px; }
  #adaptiveBar.hidden { display: none; }
  .ab-label { color: #8b93a4; font-weight: 600; }
  .ab-now { display: inline-block; color: #dbeafe; background: #1e3a5f; border-radius: 8px; padding: 2px 9px; font-weight: 600; }
  .ab-chip { display: inline-block; padding: 1px 8px; border-radius: 8px; font-size: 11px; background: #262b36; color: #cbd5e1; }
  .ab-chip.ok { background: #14532d; color: #bbf7d0; }
  .ab-chip.no { background: #7f1d1d; color: #fecaca; }
  .ab-chip.done { background: #1e3a5f; color: #dbeafe; }
  .ab-sep { color: #3a4150; }
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

  /* ── 5-tab sizing + new panels ── */
  #tabs button { font-size: 11px; padding: 8px 3px; }
  .muted { color: #6b7280; }

  /* Protocol */
  .proto-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .proto-toolbar select { background: #11141a; border: 1px solid #2a2f3a; color: #cbd5e1; border-radius: 4px; padding: 2px 6px; font-size: 12px; }
  button.mini { padding: 3px 9px; font-size: 11px; }
  .pcard { border: 1px solid #1a1e26; border-radius: 8px; padding: 7px 9px; margin-bottom: 7px; background: #0e1117; }
  .pcard-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
  .pcard-idx { color: #6b7280; font-variant-numeric: tabular-nums; }
  .pcard-q { font-size: 12px; color: #cbd5e1; margin: 2px 0; line-height: 1.35; }
  .pcard-row { font-size: 11px; color: #9aa3b2; margin: 2px 0; line-height: 1.4; }
  .pcard-row b { color: #cbd5e1; font-weight: 600; }
  .tag { display: inline-block; padding: 0 6px; border-radius: 8px; font-size: 10px; background: #262b36; color: #cbd5e1; white-space: nowrap; }
  .tag.ok { background: #14532d; color: #bbf7d0; }
  .tag.no { background: #7f1d1d; color: #fecaca; }
  .tag.part { background: #78350f; color: #fde68a; }
  .tag.price { background: #1e3a5f; color: #bfdbfe; }
  .tag.diff { background: #3b1d5f; color: #ddd6fe; }
  .tag.lvl2 { background: #0f3a3a; color: #99f6e4; }
  .contrib { color: #93c5fd; }
  .contrib.neg { color: #fca5a5; }

  /* Watch (state / suspend_data / cmi) */
  .watch-head { margin-bottom: 8px; }
  .watch-head2 { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .seg { display: inline-flex; border: 1px solid #2a2f3a; border-radius: 6px; overflow: hidden; }
  .seg button { border: 0; border-radius: 0; background: #11141a; color: #8b93a4; padding: 4px 10px; font-size: 11px; border-right: 1px solid #2a2f3a; cursor: pointer; }
  .seg button:last-child { border-right: 0; }
  .seg button.active { background: #1e3a5f; color: #dbeafe; }
  #watch-filter { flex: 1; background: #11141a; border: 1px solid #2a2f3a; color: #cbd5e1; border-radius: 4px; padding: 3px 6px; font-size: 12px; }
  .size-pill { display: inline-block; padding: 1px 8px; border-radius: 8px; background: #1e3a5f; color: #bfdbfe; font: 12px ui-monospace, monospace; }
  .size-pill.warn { background: #78350f; color: #fde68a; }
  .size-pill.over { background: #7f1d1d; color: #fecaca; }
  table.watch td { font-family: ui-monospace, monospace; }
  table.watch td.path { color: #8b93a4; white-space: nowrap; }
  table.watch td.val { color: #cbd5e1; word-break: break-word; }
  table.watch tr.changed td { background: #15263b; }

  /* LMS humanized journal */
  #lmsLog { font: 12px/1.5 system-ui, sans-serif; }
  #lmsLog .row { padding: 3px 4px; border-bottom: 1px solid #1a1e26; white-space: pre-wrap; word-break: break-word; }
  #lmsLog .row .sub { display: block; color: #6b7280; font-size: 11px; }
  #lmsLog .sess { color: #e6e8ec; }
  #lmsLog .commit { color: #6b7280; }
  #lmsLog .read { color: #6b7280; }
  #lmsLog .answer { color: #86efac; }
  #lmsLog .scale { color: #93c5fd; }
  #lmsLog .finish { color: #fbbf24; }
  #lmsLog .status { color: #c4b5fd; }
  #lmsLog .suspend { color: #7dd3fc; }
  #lmsLog .warn { color: #fca5a5; }
  #lmsLog .muted { color: #6b7280; }
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
<div id="adaptiveBar" class="hidden" title="Прогресс адаптивного теста: текущая тема/уровень и подтверждённые уровни">
  <span class="ab-label">Адаптив</span>
  <span id="adaptive-now"></span>
  <span class="ab-sep">·</span>
  <span id="adaptive-confirmed"></span>
</div>
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
      <button data-tab="protocol" class="active">Протокол <span class="badge" id="b-protocol">0</span></button>
      <button data-tab="scales">Шкалы <span class="badge" id="b-scales">0</span></button>
      <button data-tab="results">Показатели <span class="badge" id="b-results">0</span></button>
      <button data-tab="watch">Watch <span class="badge" id="b-watch">—</span></button>
      <button data-tab="lms">LMS-журнал <span class="badge" id="b-lms">0</span></button>
    </nav>

    <section class="panel active" id="panel-protocol">
      <div class="proto-toolbar">
        <label class="filter">Попытка:
          <select id="proto-attempt"><option value="live">Текущая (live)</option></select>
        </label>
        <span class="spacer"></span>
        <button id="proto-export" class="mini" title="Скачать протокол в CSV">CSV</button>
      </div>
      <div class="hint" id="proto-empty">Запустите пакет и начните отвечать — здесь появится протокол: выданный вопрос, полученный ответ, верность, цена и вклад в шкалы.</div>
      <div id="proto-list"></div>
    </section>

    <section class="panel" id="panel-scales">
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

    <section class="panel" id="panel-watch">
      <div class="watch-head">
        <div class="seg" id="watch-src">
          <button data-src="state" class="active" title="Живое состояние рантайма (где копится прогресс)">state · рантайм</button>
          <button data-src="suspend" title="Сохранённый снимок в cmi.suspend_data">suspend_data</button>
          <button data-src="cmi" title="Полная модель данных cmi (что ушло в LMS)">cmi · LMS</button>
        </div>
      </div>
      <div class="watch-head2">
        <span class="size-pill" id="watch-size">—</span>
        <input type="text" id="watch-filter" placeholder="фильтр по пути…" />
      </div>
      <div class="hint" id="watch-empty">Запустите пакет — здесь появится живое состояние рантайма (answers, currentIndex, adaptiveState, таймеры…).</div>
      <table class="insp watch" id="watch-table" style="display:none">
        <thead><tr><th>Путь</th><th>Значение</th></tr></thead>
        <tbody id="watch-body"></tbody>
      </table>
      <details id="watch-raw-wrap" style="margin-top:8px"><summary class="hint">Сырой JSON</summary><pre class="json" id="watch-json">—</pre></details>
    </section>

    <section class="panel" id="panel-lms">
      <h2>Что происходит между модулем и LMS</h2>
      <div id="lmsLog"><div class="row hint">События обмена с LMS появятся здесь после запуска пакета.</div></div>
      <details id="raw-wrap" style="margin-top:10px">
        <summary class="hint">Сырые вызовы RTE (GetValue/SetValue)</summary>
        <label class="filter"><input type="checkbox" id="hideGet" checked /> скрыть GetValue</label>
        <div id="scormLog"></div>
      </details>
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

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function fmtNum(n) { return (typeof n === "number" && isFinite(n)) ? String(Math.round(n * 100) / 100) : "—"; }
  function trunc(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) + "…" : s; }
  function byteLen(s) { try { return new Blob([String(s)]).size; } catch (e) { return String(s).length; } }
  function fmtBytes(n) { return n < 1024 ? n + " Б" : (n / 1024).toFixed(1) + " КБ"; }

  // ── Read live globals straight off the package window (same-origin) ──
  // The package concatenates its app modules into one non-module script, so
  // state, TEST_DATA, ScoringEngine, computeTestScales, … live on the iframe
  // window. Same-origin (served from /play/:token) lets us read them directly.
  function readPkg() {
    var w;
    try { w = stage.contentWindow; } catch (e) { return null; }
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

  // ═══ Протокол ответов ═══════════════════════════════════════════════════════
  // Per-question registration: drawn question, learner answer, correctness,
  // answer price (PRD-10 ScoringEngine), and per-scale contributions (PRD-5).
  var protoRows = [];

  function typeLabel(t) {
    return t === "single" ? "Один ответ" : t === "multiple" ? "Несколько" :
      t === "matching" ? "Соответствие" : t === "ranking" ? "Ранжирование" : (t || "?");
  }

  // Human-readable answer using the package's own option/left/right/items text.
  function humanAnswer(q, ans) {
    if (ans === null || ans === undefined) return "(нет ответа)";
    var d = q.data || {};
    if (q.type === "single") {
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
      if (qType === "single") return answer === i;
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
    return false;
  }

  function contributionsFor(pkg, q, ans) {
    var out = [];
    (pkg.measurements || []).forEach(function (m) {
      if (m.questionId !== q.id) return;
      if (isActiveMeasure(m, ans, q.type)) out.push({ scaleKey: m.scaleKey, delta: m.value * m.weight });
    });
    return out;
  }

  function priceFor(pkg, q, ans) {
    var SE = null;
    try { SE = pkg.w.ScoringEngine; } catch (e) {}
    if (SE && typeof SE.scoreAnswer === "function") {
      try { return SE.scoreAnswer({ type: q.type, correct: q.correct || {}, answer: ans, scoring: q.scoring }); } catch (e) {}
    }
    return null;
  }

  // Drawn questions for the live attempt — flat order (standard) or adaptive
  // walk (topics → levels → answeredQuestionIds), carrying the level label.
  function buildLiveRows(pkg) {
    var rows = [], st = pkg.state;
    if (!st) return rows;
    var isAdaptive = pkg.mode === "adaptive" && st.adaptiveState;
    if (isAdaptive) {
      var TA = (pkg.TEST_DATA && pkg.TEST_DATA.adaptiveTopics) || [];
      // Index every answered question (across topics/levels) by id, carrying its
      // level label.
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
      // order, which equals delivery order. Iterating levelsState by index would
      // mis-sort a median→down move (level index ≠ traversal order).
      var seen = {};
      Object.keys(st.answers || {}).forEach(function (qid) {
        if (byId[qid]) { rows.push(byId[qid]); seen[qid] = 1; }
      });
      Object.keys(byId).forEach(function (qid) { if (!seen[qid]) rows.push(byId[qid]); });
    } else {
      (st.flatQuestions || []).forEach(function (fq) {
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

  function updateAttemptSelector(cmi) {
    var sel = document.getElementById("proto-attempt");
    var atts = getSuspendAttempts(cmi);
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

  function renderProtocol(pkg, cmi) {
    var listEl = document.getElementById("proto-list");
    var emptyEl = document.getElementById("proto-empty");
    var sel = document.getElementById("proto-attempt");
    var mode = sel.value || "live";
    var rows, note = "";
    if (mode === "live") {
      rows = pkg ? buildLiveRows(pkg) : [];
    } else {
      var att = getSuspendAttempts(cmi)[parseInt(mode.slice(4), 10)];
      rows = att ? buildAttemptRows(att) : [];
      if (att && (!att.flatQuestions || !att.flatQuestions.length)) note = "Для этой попытки детальный состав не сохранён (адаптивный режим).";
    }
    document.getElementById("b-protocol").textContent = String(rows.length);
    protoRows = [];
    if (!rows.length) {
      listEl.innerHTML = ""; emptyEl.style.display = "";
      emptyEl.textContent = note || (pkg && pkg.hasData
        ? "Пока нет выданных вопросов — начните отвечать."
        : "Запустите пакет и начните отвечать — здесь появится протокол.");
      return;
    }
    emptyEl.style.display = "none";
    var showDiff = pkg && pkg.mode === "adaptive";
    listEl.innerHTML = rows.map(function (row, i) {
      var q = row.q, ans = row.answer;
      var pr = pkg ? priceFor(pkg, q, ans) : null;
      var ratio = pr ? pr.ratio : 0;
      var answered = !(ans == null || (Array.isArray(ans) && ans.length === 0) ||
        (q.type === "matching" && (!ans || !Object.keys(ans).length)));
      var verdict, vlabel;
      if (!answered) { verdict = "none"; vlabel = '<span class="tag">— нет ответа</span>'; }
      else if (ratio >= 1) { verdict = "correct"; vlabel = '<span class="tag ok">верно</span>'; }
      else if (ratio > 0) { verdict = "partial"; vlabel = '<span class="tag part">частично ' + Math.round(ratio * 100) + "%</span>"; }
      else { verdict = "wrong"; vlabel = '<span class="tag no">неверно</span>'; }
      var points = q.points || 1;
      var earned = pr ? points * pr.ratio : 0;
      var priceTag = pr
        ? '<span class="tag price">цена ' + fmtNum(pr.score) + "/" + fmtNum(pr.sMax) + " · балл " + fmtNum(earned) + "/" + fmtNum(points) + "</span>"
        : "";
      var diffTag = (showDiff && q.difficulty !== null && q.difficulty !== undefined)
        ? '<span class="tag diff">сложность ' + esc(q.difficulty) + "</span>" : "";
      var lvlTag = row.levelName ? '<span class="tag lvl2">' + esc(row.levelName) + "</span>" : "";
      var contribs = pkg ? contributionsFor(pkg, q, ans) : [];
      var contribStr = contribs.map(function (c) {
        return '<span class="contrib' + (c.delta < 0 ? " neg" : "") + '">' + esc(c.scaleKey) + " " + (c.delta >= 0 ? "+" : "") + fmtNum(c.delta) + "</span>";
      }).join(", ");
      var answerStr = humanAnswer(q, ans);
      protoRows.push({
        topicName: row.topicName || "", prompt: q.prompt || "", type: q.type, answerStr: answerStr,
        verdict: verdict, ratio: Math.round(ratio * 100) / 100, score: pr ? pr.score : "", sMax: pr ? pr.sMax : "",
        earned: Math.round(earned * 100) / 100, points: points,
        difficulty: (showDiff && q.difficulty != null) ? q.difficulty : null,
        contribsPlain: contribs.map(function (c) { return c.scaleKey + " " + (c.delta >= 0 ? "+" : "") + fmtNum(c.delta); }).join(" | "),
      });
      return '<div class="pcard">' +
        '<div class="pcard-head"><span class="pcard-idx">#' + (i + 1) + "</span>" +
        '<span class="tag">' + esc(typeLabel(q.type)) + "</span>" + vlabel + priceTag + diffTag + lvlTag + "</div>" +
        '<div class="pcard-q" title="' + esc(q.prompt || "") + '">' + esc(trunc(q.prompt || "(без текста)", 160)) +
        (row.topicName ? ' <span class="muted">· ' + esc(row.topicName) + "</span>" : "") + "</div>" +
        '<div class="pcard-row"><b>Ответ:</b> ' + esc(answerStr) + "</div>" +
        (contribStr ? '<div class="pcard-row"><b>Вклад в шкалы:</b> ' + contribStr + "</div>" : "") +
        "</div>";
    }).join("");
  }

  function exportCsv() {
    if (!protoRows.length) return;
    function csv(s) { s = String(s == null ? "" : s); return /[";\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
    var lines = [["#", "Тема", "Вопрос", "Тип", "Ответ", "Верность", "Ratio", "score", "sMax", "Балл", "ВозможныйБалл", "Сложность", "ВкладыВШкалы"].join(";")];
    protoRows.forEach(function (r, i) {
      lines.push([i + 1, csv(r.topicName), csv(r.prompt), r.type, csv(r.answerStr), r.verdict, r.ratio, r.score, r.sMax, r.earned, r.points, r.difficulty == null ? "" : r.difficulty, csv(r.contribsPlain)].join(";"));
    });
    var blob = new Blob(["﻿" + lines.join("\\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = "protocol.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  // ═══ Watch — наблюдение за состоянием по ходу теста ══════════════════════════
  // Sources: live runtime state (where progress actually accumulates — answers,
  // adaptiveState, timers; default), the persisted suspend_data, and the full
  // cmi LMS data-model store. Debugger-style flat path→value table with live
  // change highlighting.
  var watchSrc = "state";
  var lastWatchFlat = {}, lastWatchInit = false, lastWatchSig = null, lastWatchFilter = null, lastWatchSrc = null;

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
  function safeJson(obj) {
    try {
      var seen = new WeakSet();
      var s = JSON.stringify(obj, function (k, v) {
        if (typeof v === "function") return "[Function]";
        if (v && typeof v === "object") { if (seen.has(v)) return "[Circular]"; seen.add(v); }
        return v;
      }, 2);
      return (s && s.length > 20000) ? s.slice(0, 20000) + "\\n…" : s;
    } catch (e) { return "[не сериализуется]"; }
  }

  function renderWatch(pkg, cmi) {
    var sizeEl = document.getElementById("watch-size");
    var table = document.getElementById("watch-table");
    var empty = document.getElementById("watch-empty");
    var body = document.getElementById("watch-body");
    var jsonEl = document.getElementById("watch-json");

    // Resolve the source object + raw JSON + size label.
    var obj = null, rawJson = "—", sizePill = "—", sizeCls = "size-pill", emptyMsg = "";
    if (watchSrc === "state") {
      obj = (pkg && pkg.state) || null;
      emptyMsg = "Запустите пакет — здесь появится живое состояние рантайма (answers, currentIndex, adaptiveState, таймеры…).";
      rawJson = obj ? safeJson(obj) : "—";
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
      rawJson = obj ? safeJson(obj) : "—";
    }

    var flat = obj ? flattenLimited(obj) : [];
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
    // Skip DOM churn when source, data and filter are unchanged.
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
  // Turns the raw RTE traffic into a narrative of what the module tells the LMS.
  var lmsLogEl = document.getElementById("lmsLog");
  var rawLogEl = document.getElementById("scormLog");
  var hideGet = document.getElementById("hideGet");
  var renderedRaw = 0, lastHumanCount = -1;

  hideGet.onchange = function () { renderedRaw = 0; rawLogEl.innerHTML = ""; renderRaw(); };

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
      var label = GET_LABELS[kv.k] || kv.k.replace(/^cmi\\./, "");
      if (kv.k === "cmi.entry") label = "режим входа: " + (kv.v === "resume" ? "продолжение" : (kv.v || "первый запуск"));
      if (!seen[label]) { seen[label] = 1; parts.push(label); }
    });
    return esc(parts.slice(0, 6).join("; ") + (parts.length > 6 ? " …" : ""));
  }
  function humanCompletion(v) { return v === "completed" ? "завершено" : v === "incomplete" ? "не завершено" : esc(v); }
  function humanSuccess(v) { return v === "passed" ? "зачёт ✓" : v === "failed" ? "незачёт ✗" : v === "unknown" ? "не определён" : esc(v); }

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
    return esc(sc.raw) + " из " + esc(sc.max) + (pct ? " (" + pct + ")" : "");
  }
  function describeInteraction(it) {
    var id = it["id"] || "", resp = it["learner_response"] || "", desc = it["description"] || "", res = it["result"] || "";
    if (id.indexOf("q_") === 0) {
      return { kind: "answer", text: "📝 Ответ в отчёте LMS — " + (desc ? "«" + esc(trunc(desc, 70)) + "»" : esc(id)) + ": " +
        (res === "correct" ? "верно" : res === "incorrect" ? "неверно" : esc(res)), sub: "ответ учащегося: " + esc(resp) };
    }
    if (id.indexOf("scale_") === 0) {
      var isLvl = /_level$/.test(id);
      var key = id.replace(/^scale_/, "").replace(/_level$/, "");
      return { kind: "scale", text: "📊 Шкала " + esc(key) + (isLvl ? " — уровень" : "") + " → " + esc(resp), sub: esc(desc) };
    }
    if (id.indexOf("var_") === 0) return { kind: "scale", text: "∑ Показатель " + esc(id.replace(/^var_/, "")) + " → " + esc(resp), sub: esc(desc) };
    if (id.indexOf("_course_") !== -1) return { kind: "status", text: "🔗 Рекомендованный курс (object_id " + esc(resp) + ")", sub: esc(desc) };
    return { kind: "muted", text: "• " + esc(id) + " → " + esc(resp), sub: "" };
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
      return { kind: "suspend", text: "💾 Результат попытки #" + esc(a.attemptNumber) + " сохранён: " + Math.round(a.percent) + "% — " + (a.passed ? "зачёт" : "незачёт"), sub: "suspend_data: " + sizeStr };
    }
    if (cur && cu > pu) return { kind: "suspend", text: "▶ Старт попытки " + esc(cu) + " зарегистрирован", sub: "suspend_data: " + sizeStr };
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
            add("status", "🎯 Тема " + esc(oid) + " → " + esc(o["success_status"] || "?") + ", балл " + esc(o["score.raw"] !== undefined ? o["score.raw"] : "?"));
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
        if (k === "cmi.exit") { add("muted", "↪ Тип выхода → " + esc(e.value)); i++; continue; }
        if (k === "cmi.location") { add("muted", "📍 Позиция → " + (e.value ? esc(e.value) : "(очищена)")); i++; continue; }
        if (k === "cmi.comments_from_learner") { add("warn", "💬 Комментарий учащегося → " + esc(e.value)); i++; continue; }
        add("muted", "• " + esc(k.replace(/^cmi\\./, "")) + " → " + esc(trunc(e.value, 80))); i++; continue;
      }
      i++;
    }
    return ev;
  }

  function renderLms() {
    if (!window.__scorm) return;
    var traffic = window.__scorm.getTraffic();
    var events = humanizeTraffic(traffic);
    document.getElementById("b-lms").textContent = String(events.length);
    if (events.length !== lastHumanCount) {
      lmsLogEl.innerHTML = events.length
        ? events.map(function (ev) { return '<div class="row ' + ev.kind + '">' + ev.text + (ev.sub ? '<span class="sub">' + ev.sub + "</span>" : "") + "</div>"; }).join("")
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
    var st = pkg && pkg.state;
    var as = st && st.adaptiveState;
    if (!pkg || pkg.mode !== "adaptive" || !as) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");

    var topics = as.topics || [];
    var nowEl = document.getElementById("adaptive-now");
    if (as.isFinished) {
      nowEl.innerHTML = '<span class="ab-chip done">Тест завершён</span>';
    } else {
      var topic = topics[as.currentTopicIndex];
      var lvl = topic && topic.levelsState[topic.currentLevelIndex];
      nowEl.innerHTML = (topic && lvl)
        ? '<span class="ab-now">▸ Тема ' + (as.currentTopicIndex + 1) + "/" + topics.length + ": " +
          esc(topic.topicName) + " · " + esc(lvl.levelName) + " · сложность " + lvl.minDifficulty + "–" + lvl.maxDifficulty + "</span>"
        : "";
    }

    // Confirmed (passed) topic/level pairs + topics finished without a level.
    var chips = [];
    topics.forEach(function (t) {
      (t.levelsState || []).forEach(function (lv) {
        if (lv.status === "passed") {
          chips.push('<span class="ab-chip ok" title="' + esc(t.topicName) + ": подтверждён (" + lv.correctCount + "/" + (lv.answeredQuestionIds || []).length + ')">' +
            esc(t.topicName) + " · " + esc(lv.levelName) + " ✓</span>");
        }
      });
      if (t.status === "completed" && t.finalLevelIndex === null) {
        chips.push('<span class="ab-chip no">' + esc(t.topicName) + " · уровень не достигнут</span>");
      }
    });
    document.getElementById("adaptive-confirmed").innerHTML =
      '<span class="ab-label">Подтверждено:</span> ' +
      (chips.length ? chips.join(" ") : '<span class="muted">пока ничего</span>');
  }

  // ── Real-time loop: recompute everything off the live package window ──
  function tick() {
    var pkg = readPkg();
    var cmi = (window.__scorm && window.__scorm.getCmi()) || {};
    var ints = parseInteractions(cmi);
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
</script>
</body>
</html>`;
