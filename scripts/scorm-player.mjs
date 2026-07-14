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
import { readDebugPlayerAssets } from "../server/scorm/debug-player/player-assets.mjs";

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

// Single-source RTE shim + inspector (compute + render) shared with the in-service
// debug player (PRD-18). `computeJs` exposes window.TBInspector before the render.
const { shimJs, computeJs, inspectorJs } = readDebugPlayerAssets();

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
${shimJs}

${computeJs}

${inspectorJs}
</script>
</body>
</html>`;
