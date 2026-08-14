/**
 * @module scripts/docs/chrome
 * @description Locates a Chrome/Chromium binary for the documentation build
 * scripts. Both the Markdown-to-PDF renderer (`build-docs-pdf.mjs`) and the
 * guide illustration placeholder generator (`make-guide-placeholders.mjs`) drive
 * headless Chrome, so the lookup lives in one place instead of being copied.
 *
 * Resolution order: the `DOCS_PDF_CHROME` / `CHROME_BIN` override, then a
 * puppeteer-style cache directory under the user's home, then the usual install
 * paths on Windows and Linux. Returns `null` when nothing is found — callers
 * decide whether that is fatal.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

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

/**
 * Locate a Chrome/Chromium binary able to `--print-to-pdf` / `--screenshot`.
 *
 * @returns {string|null} absolute path to the executable, or null when absent.
 */
export function findChrome() {
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

/** file:// URL for a local absolute path (Windows-safe). */
export function fileUrl(absPath) {
  return "file:///" + absPath.replace(/\\/g, "/").replace(/^\/+/, "");
}
