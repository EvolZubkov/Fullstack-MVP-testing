/**
 * @module scripts/sim/play
 * @description Dev player of a «Сценарий в ИС» scenario: no database, no editor, no test.
 *
 * Bundles `shared/sim/browser-entry.ts` with esbuild, serves it with a scenario folder
 * (`scenario.json` + `media/`) and a small page that plays the scenario the way the question
 * will: rules → «Старт» → fullscreen → result. Every finished run is saved as JSON into
 * `out/sim-results/` — the result contract made tangible.
 *
 * Usage: `npm run sim:play [-- <scenario folder>] [--port 5070] [--open]`.
 * Default folder: `docs/specs/sim-scenario/example`.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string, def: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const folder = path.resolve(ROOT, args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--port") ?? "docs/specs/sim-scenario/example");
const port = Number(opt("--port", "5070"));
const resultsDir = path.join(ROOT, "out", "sim-results");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const PAGE = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Плеер сценария</title>
<style>
  body{margin:0;font:15px/1.5 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:#f6f7f9;color:#16181d}
  main{max-width:860px;margin:40px auto;padding:0 24px;display:flex;flex-direction:column;gap:16px}
  .card{background:#fff;border:1px solid #dfe3e8;border-radius:12px;padding:24px;display:flex;flex-direction:column;gap:12px}
  h1{font-size:22px;margin:0} h2{font-size:17px;margin:0} ul{margin:0;padding-left:22px}
  button{font:inherit;padding:10px 18px;border-radius:8px;border:1px solid #6b2bd9;background:#6b2bd9;color:#fff;cursor:pointer;align-self:flex-start}
  button.ghost{background:#fff;color:#16181d;border-color:#c9ced6}
  .muted{color:#5b6270}
  pre{background:#16181d;color:#e7eaee;padding:12px;border-radius:8px;max-height:360px;overflow:auto;font-size:12px}
  #stage{position:fixed;inset:0;display:none;background:#eef0f3;z-index:10}
  #stage.on{display:block}
  .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
</style></head>
<body>
<main>
  <div class="card">
    <span class="muted" id="system"></span>
    <h1 id="title"></h1>
    <p id="task"></p>
  </div>
  <div class="card">
    <h2>Правила</h2>
    <ul id="rules"></ul>
    <button id="start" type="button">Старт</button>
  </div>
  <div class="card" id="out" hidden>
    <h2 id="outTitle"></h2>
    <span class="muted" id="saved"></span>
    <div class="row"><button id="again" type="button">Сыграть ещё</button><button class="ghost" id="download" type="button">Скачать результат</button></div>
    <pre id="json"></pre>
  </div>
</main>
<div id="stage"></div>
<script src="/player.js"></script>
<script>
(async function () {
  var scenario = await (await fetch('/scenario/scenario.json')).json();
  var s = scenario.settings || {};
  document.getElementById('system').textContent = (scenario.meta.system || 'Информационная система');
  document.getElementById('title').textContent = scenario.meta.title;
  document.getElementById('task').textContent = scenario.meta.task;
  var rules = ['Задание откроется на весь экран. Выполните действия в окне системы так, как делаете это в работе.'];
  if (s.limitSeconds) rules.push('На задание отводится ' + Math.round(s.limitSeconds / 60) + ' мин. Таймер — на панели над окном системы; когда время выйдет, задание завершится.');
  rules.push('Ошибочные клики и лишние действия снижают балл.');
  if (!s.hints || s.hints.enabled !== false) rules.push('После ' + ((s.hints && s.hints.afterMisses) || 3) + ' ошибок подряд появится подсказка. Подсказка тоже снижает балл.');
  rules.push('Выйти досрочно можно кнопкой на панели. Задание тогда будет засчитано как невыполненное.');
  rules.forEach(function (r) { var li = document.createElement('li'); li.textContent = r; document.getElementById('rules').appendChild(li); });

  var stage = document.getElementById('stage');
  var last = null, player = null;
  function stop() {
    if (player) { player.destroy(); player = null; }
    stage.classList.remove('on');
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
  }
  function start() {
    stage.classList.add('on');
    if (stage.requestFullscreen) stage.requestFullscreen().catch(function () {});
    player = TBSim.mountPlayer(stage, {
      scenario: scenario,
      caption: 'Задание',
      mediaUrl: function (file) { return '/scenario/' + file; },
      onFinish: function (result) {
        last = result;
        fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) })
          .then(function (r) { return r.text(); }).then(function (p) { document.getElementById('saved').textContent = 'Сохранено: ' + p; });
      },
      onClose: function (result) {
        stop();
        document.getElementById('out').hidden = false;
        document.getElementById('outTitle').textContent = 'Результат: ' + result.outcome;
        document.getElementById('json').textContent = JSON.stringify(result, null, 2);
      }
    });
  }
  document.getElementById('start').onclick = start;
  document.getElementById('again').onclick = start;
  document.getElementById('download').onclick = function () {
    if (!last) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(last, null, 2)], { type: 'application/json' }));
    a.download = 'sim-result.json';
    a.click();
  };
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && player && !player.run.done()) { /* остаёмся слоем на всё окно */ }
  });
})();
</script>
</body></html>`;

async function bundle(): Promise<string> {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: [path.join(ROOT, "shared", "sim", "browser-entry.ts")],
    bundle: true,
    format: "iife",
    globalName: "TBSim",
    platform: "browser",
    target: "es2019",
    write: false,
    alias: { "@shared": path.join(ROOT, "shared") },
  });
  return result.outputFiles[0].text;
}

async function main(): Promise<void> {
  if (!fs.existsSync(path.join(folder, "scenario.json"))) {
    console.error(`Нет scenario.json в ${folder}`);
    process.exit(1);
  }
  // Rebuilt on every request: the player is iterated on while the server runs.
  await bundle();
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (req.method === "POST" && url === "/result") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        fs.mkdirSync(resultsDir, { recursive: true });
        const name = `${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        const file = path.join(resultsDir, name);
        fs.writeFileSync(file, JSON.stringify(JSON.parse(body), null, 2));
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(path.relative(ROOT, file));
      });
      return;
    }
    if (url === "/" || url === "/index.html") { res.writeHead(200, { "Content-Type": TYPES[".html"] }); res.end(PAGE); return; }
    if (url === "/player.js") {
      bundle().then(
        (js) => { res.writeHead(200, { "Content-Type": TYPES[".js"] }); res.end(js); },
        (e: Error) => { res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }); res.end(String(e.message)); },
      );
      return;
    }
    if (url.startsWith("/scenario/")) {
      const file = path.resolve(folder, url.slice("/scenario/".length));
      if (file.startsWith(folder) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
        fs.createReadStream(file).pipe(res);
        return;
      }
    }
    res.writeHead(404);
    res.end("not found");
  });
  server.listen(port, () => {
    const link = `http://localhost:${port}/`;
    console.log(`Плеер сценария: ${link}`);
    console.log(`Сценарий: ${path.relative(ROOT, folder) || "."}; результаты — в ${path.relative(ROOT, resultsDir)}`);
    if (flag("--open")) exec(process.platform === "win32" ? `start "" "${link}"` : `xdg-open "${link}"`);
  });
}

void main();
