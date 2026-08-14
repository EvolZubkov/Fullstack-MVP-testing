/**
 * @module scripts/docs/make-guide-placeholders
 * @description Generates placeholder images for illustrations a guide already
 * references but which have not been captured yet.
 *
 * The guides under `docs/guides` embed screenshots with ordinary Markdown image
 * syntax. Until a real screenshot exists, both the Markdown preview and the PDF
 * would show a broken image, and the reader could not tell whether the picture is
 * missing or the document is wrong. This script scans a guide for its image
 * references and renders a labelled placeholder — the alt text plus a note that
 * the screenshot is still to come — for every referenced file that is absent.
 * Existing files are never touched, so dropping a real screenshot in place is all
 * it takes to replace a placeholder permanently.
 *
 * Rendering goes through headless Chrome (`--screenshot`), the same dependency
 * the PDF build already needs; nothing is added to `package.json`.
 *
 * Usage: `node scripts/docs/make-guide-placeholders.mjs [<guide.md> …]`
 * (defaults to `docs/guides/test-authoring-guide.md`).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { findChrome, fileUrl } from "./chrome.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_GUIDES = [path.join(REPO_ROOT, "docs", "guides", "test-authoring-guide.md")];

/** Placeholder canvas size — 16:9, wide enough to read the caption in print. */
const WIDTH = 1440;
const HEIGHT = 810;

/** `![alt](relative/path.png)` — Markdown image references, in document order. */
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

/** Collect the (alt, absolute path) pairs a guide references, de-duplicated. */
function collectImages(guidePath) {
  const markdown = readFileSync(guidePath, "utf8");
  const baseDir = path.dirname(guidePath);
  const seen = new Map();
  for (const match of markdown.matchAll(IMAGE_RE)) {
    const [, alt, src] = match;
    if (/^[a-z]+:/i.test(src)) continue; // external URL — not ours to create
    const abs = path.resolve(baseDir, src);
    if (!seen.has(abs)) seen.set(abs, alt);
  }
  return [...seen].map(([abs, alt]) => ({ abs, alt }));
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The placeholder page: a dashed frame with the caption and the file name. */
function placeholderHtml(alt, fileName) {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; }
  body {
    width: ${WIDTH}px; height: ${HEIGHT}px; background: #eef0f6;
    font: 400 22px/1.45 "Segoe UI", Arial, sans-serif; color: #3a4155;
    display: flex; align-items: center; justify-content: center;
  }
  .frame {
    width: ${WIDTH - 96}px; height: ${HEIGHT - 96}px; box-sizing: border-box;
    border: 3px dashed #a8b0c6; border-radius: 18px; background: #f7f8fc;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; padding: 48px; gap: 18px;
  }
  .kicker { font-size: 18px; letter-spacing: .12em; text-transform: uppercase; color: #8f97ae; }
  .caption { font-size: 40px; font-weight: 600; color: #1a1f2b; max-width: 1040px; }
  .note { font-size: 20px; color: #5d6580; max-width: 900px; }
  .file { font: 400 18px/1.4 "Cascadia Code", Consolas, monospace; color: #7c8399; }
</style></head>
<body>
  <div class="frame">
    <div class="kicker">Иллюстрация</div>
    <div class="caption">${escapeHtml(alt || "Экран сервиса")}</div>
    <div class="note">Снимок экрана будет добавлен после подготовки демонстрационного стенда.</div>
    <div class="file">${escapeHtml(fileName)}</div>
  </div>
</body></html>`;
}

function main() {
  const args = process.argv.slice(2);
  const guides = args.length ? args.map((a) => path.resolve(REPO_ROOT, a)) : DEFAULT_GUIDES;
  const chrome = findChrome();
  if (!chrome) {
    console.error("Chrome/Chromium не найден. Задайте путь через DOCS_PDF_CHROME=<путь к chrome.exe>.");
    process.exit(1);
  }
  console.log("Chrome:", chrome);

  let made = 0;
  let kept = 0;
  for (const guide of guides) {
    if (!existsSync(guide)) {
      console.error("Пропущено (нет источника):", guide);
      process.exitCode = 1;
      continue;
    }
    for (const { abs, alt } of collectImages(guide)) {
      if (existsSync(abs)) {
        kept += 1;
        continue;
      }
      mkdirSync(path.dirname(abs), { recursive: true });
      const tmpHtml = abs.replace(/\.[^.]+$/, "") + ".tmp.html";
      writeFileSync(tmpHtml, placeholderHtml(alt, path.basename(abs)), "utf8");
      const profileDir = path.join(os.tmpdir(), "guide-placeholder-profile");
      const res = spawnSync(
        chrome,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-sandbox",
          "--hide-scrollbars",
          "--force-device-scale-factor=1",
          `--window-size=${WIDTH},${HEIGHT}`,
          `--user-data-dir=${profileDir}`,
          `--screenshot=${abs}`,
          fileUrl(tmpHtml),
        ],
        { stdio: ["ignore", "ignore", "ignore"], timeout: 120000 },
      );
      try {
        rmSync(tmpHtml, { force: true });
      } catch {
        /* best-effort cleanup */
      }
      if (res.status !== 0 || !existsSync(abs)) {
        console.error("Не удалось создать заглушку:", abs, res.error || "exit " + res.status);
        process.exitCode = 1;
        continue;
      }
      made += 1;
      console.log("OK  " + path.relative(REPO_ROOT, abs));
    }
  }
  console.log(`Заглушек создано: ${made}; готовых снимков оставлено без изменений: ${kept}`);
}

main();
