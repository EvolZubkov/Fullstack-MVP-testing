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
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import { findChrome, fileUrl } from "./chrome.mjs";

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
  {
    src: path.join(REPO_ROOT, "docs", "guides", "test-authoring-guide.md"),
    out: path.join(OUT_DIR, "test-authoring-guide.pdf"),
    title: "Как создать тест. Руководство автора",
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
  /* Screenshots: fit the text column and never claim more than half a page, so a
     tall capture does not push the paragraph that explains it onto the next one. */
  img {
    display: block; margin: 10pt auto; width: auto; height: auto;
    max-width: 100%; max-height: 120mm;
    border: 1px solid #d4d8e4; border-radius: 6px; page-break-inside: avoid;
  }
`;

/**
 * Render one Markdown file into a full, self-contained HTML document string.
 *
 * Relative image paths are rewritten to absolute `file://` URLs against
 * `baseDir` (the directory of the source Markdown). The temporary HTML lives
 * next to the PDF output, not next to the guide, so `images/…` would otherwise
 * resolve into `docs/dist` and every screenshot would come out broken. Only
 * image sources are touched — a document-wide `<base>` would also rewrite the
 * links, turning cross-document references into paths of the build machine.
 */
function renderHtml(markdown, title, baseDir) {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
  const renderImage = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const src = tokens[idx].attrGet("src");
    if (src && !/^[a-z]+:/i.test(src)) {
      tokens[idx].attrSet("src", fileUrl(path.resolve(baseDir, src)));
    }
    return renderImage(tokens, idx, options, env, self);
  };
  const body = md.render(markdown);
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${PRINT_CSS}</style></head>
<body>${body}</body></html>`;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
    // Timestamp of the previous build, if any: the only reliable proof that this
    // run actually replaced the file (see the check after Chrome exits).
    const mtimeBefore = existsSync(doc.out) ? statSync(doc.out).mtimeMs : 0;
    const html = renderHtml(readFileSync(doc.src, "utf8"), doc.title, path.dirname(doc.src));
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
    // Chrome exits 0 even when `--print-to-pdf` cannot write the target (the file
    // is open in a PDF viewer, read-only, on a full disk). Existence alone then
    // "passes" on the PREVIOUS build's file and the run reports OK for a document
    // that was never rebuilt — the exact failure that shipped a stale guide. A
    // newer mtime is what actually proves the write happened.
    if (statSync(doc.out).mtimeMs <= mtimeBefore) {
      console.error(
        "PDF не перезаписан (файл занят другой программой, только для чтения или диск полон):",
        doc.out,
      );
      process.exitCode = 1;
      continue;
    }
    const kb = Math.round(statSync(doc.out).size / 1024);
    console.log(`OK  ${path.relative(REPO_ROOT, doc.out)} (${kb} KB)`);
  }
}

main();
