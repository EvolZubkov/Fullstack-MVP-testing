/**
 * @module scripts/docs/build-docs-pdf
 * @description Build script that renders the template-authoring documents
 * (development guide + platform specification) from Markdown to self-contained
 * PDF, so the running service can offer them for download in the «Шаблоны»
 * section (see `GET /api/admin/templates/docs/:doc`).
 *
 * Pipeline: Markdown -> HTML (markdown-it, inline print CSS) -> PDF (headless
 * Chrome `--print-to-pdf`). No network, no emoji. Chrome is located via
 * `DOCS_PDF_CHROME` / `CHROME_BIN` or a small list of common install paths, so the
 * script stays portable across machines. Run with `npm run docs:pdf`.
 *
 * Output: `docs/dist/*.pdf` (committed, so the prod server ships them without
 * needing Chrome at runtime).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "docs", "dist");

/** The documents to render. `out` basenames double as the download route ids. */
const DOCS = [
  {
    src: path.join(REPO_ROOT, "docs", "guides", "template-development.md"),
    out: path.join(OUT_DIR, "template-development.pdf"),
    title: "Руководство по разработке шаблонов оформления",
  },
  {
    src: path.join(REPO_ROOT, "docs", "specs", "spec-template-platform.md"),
    out: path.join(OUT_DIR, "spec-template-platform.pdf"),
    title: "Техническая спецификация: платформа SCORM-шаблонов",
  },
  {
    src: path.join(REPO_ROOT, "docs", "guides", "import-workbook-guide.md"),
    out: path.join(OUT_DIR, "import-workbook-guide.pdf"),
    title: "Как заполнить шаблон импорта",
  },
];

/** Print stylesheet for the PDF — A4, readable body, wrapped code, bordered tables. */
const PRINT_CSS = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font: 11pt/1.55 "Segoe UI", Arial, sans-serif;
    color: #1a1f2b; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1 { font-size: 22pt; margin: 0 0 12pt; padding-bottom: 6pt; border-bottom: 2px solid #4a3aff; }
  h2 { font-size: 16pt; margin: 20pt 0 8pt; padding-top: 6pt; border-top: 1px solid #d8dbe6; page-break-after: avoid; }
  h3 { font-size: 13pt; margin: 14pt 0 6pt; page-break-after: avoid; }
  h4 { font-size: 11.5pt; margin: 12pt 0 5pt; page-break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  a { color: #2b3aff; text-decoration: none; }
  code {
    font-family: "Cascadia Code", "Consolas", monospace; font-size: 9.5pt;
    background: #f2f3f8; padding: 1px 4px; border-radius: 3px;
  }
  pre {
    background: #f6f7fb; border: 1px solid #e2e5ef; border-radius: 6px;
    padding: 9pt 11pt; overflow-x: auto; page-break-inside: avoid;
  }
  pre code { background: none; padding: 0; font-size: 9pt; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 9.5pt; page-break-inside: avoid; }
  th, td { border: 1px solid #d4d8e4; padding: 5pt 8pt; text-align: left; vertical-align: top; }
  th { background: #eef0f8; font-weight: 600; }
  blockquote {
    margin: 8pt 0; padding: 4pt 12pt; border-left: 3px solid #4a3aff;
    background: #f6f7fb; color: #333a4d;
  }
  hr { border: none; border-top: 1px solid #d8dbe6; margin: 14pt 0; }
`;

/** Render one Markdown file into a full, self-contained HTML document string. */
function renderHtml(markdown, title) {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
  const body = md.render(markdown);
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${PRINT_CSS}</style></head>
<body>${body}</body></html>`;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** file:// URL for a local absolute path (Windows-safe). */
function fileUrl(absPath) {
  return "file:///" + absPath.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** Newest `chrome.exe` under a puppeteer-style cache dir, or null. */
function newestChromeIn(cacheDir, exeName) {
  if (!existsSync(cacheDir)) return null;
  const found = [];
  for (const entry of readdirSync(cacheDir)) {
    const dir = path.join(cacheDir, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    // puppeteer layout: <cache>/<version>/<platform>/<exe>
    for (const sub of readdirSync(dir)) {
      const exe = path.join(dir, sub, exeName);
      if (existsSync(exe)) found.push(exe);
    }
  }
  found.sort();
  return found.length ? found[found.length - 1] : null;
}

/** Locate a Chrome/Chromium binary able to `--print-to-pdf`. */
function findChrome() {
  const override = process.env.DOCS_PDF_CHROME || process.env.CHROME_BIN;
  if (override && existsSync(override)) return override;
  const home = os.homedir();
  const candidates = [
    newestChromeIn(path.join(home, ".cache", "puppeteer", "chrome"), "chrome.exe"),
    newestChromeIn(path.join(home, ".cache", "puppeteer", "chrome-headless-shell"), "chrome-headless-shell.exe"),
    path.join(home, ".codeium", "ws-browser", "chromium-1155", "chrome-win", "chrome.exe"),
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error(
      "Chrome/Chromium не найден. Задайте путь через DOCS_PDF_CHROME=<путь к chrome.exe> и повторите.",
    );
    process.exit(1);
  }
  console.log("Chrome:", chrome);
  mkdirSync(OUT_DIR, { recursive: true });

  for (const doc of DOCS) {
    if (!existsSync(doc.src)) {
      console.error("Пропущено (нет источника):", doc.src);
      process.exitCode = 1;
      continue;
    }
    const html = renderHtml(readFileSync(doc.src, "utf8"), doc.title);
    const tmpHtml = doc.out.replace(/\.pdf$/, ".tmp.html");
    writeFileSync(tmpHtml, html, "utf8");
    // A throwaway profile dir avoids clobbering the user's Chrome session.
    const profileDir = path.join(os.tmpdir(), "docs-pdf-profile-" + path.basename(doc.out, ".pdf"));
    const res = spawnSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--no-pdf-header-footer",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=15000",
        `--user-data-dir=${profileDir}`,
        `--print-to-pdf=${doc.out}`,
        fileUrl(tmpHtml),
      ],
      { stdio: ["ignore", "inherit", "inherit"], timeout: 120000 },
    );
    try {
      rmSync(tmpHtml, { force: true });
    } catch {
      /* best-effort cleanup */
    }
    if (res.status !== 0 || !existsSync(doc.out)) {
      console.error("Не удалось собрать PDF:", doc.out, res.error || "exit " + res.status);
      process.exitCode = 1;
      continue;
    }
    const kb = Math.round(statSync(doc.out).size / 1024);
    console.log(`OK  ${path.relative(REPO_ROOT, doc.out)} (${kb} KB)`);
  }
}

main();
