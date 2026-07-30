/**
 * @module features/learner/attempt-report
 *
 * The web host's «Скачать отчёт»: builds the attempt report PDF in the browser from the
 * SHARED generator (`shared/report/*`) — the same markup and the same export pipeline
 * the SCORM package runs, so a learner gets the same file in the LMS and here.
 *
 * The rasterizer and the PDF writer are NOT bundled: they are the package's vendored
 * builds, fetched from `/api/report/lib/*` the first time a report is actually asked
 * for. That keeps one library version behind both hosts and keeps ~560 KB out of the
 * learner's initial download.
 */

import {
  buildReportHtml,
  buildAdaptiveReportHtml,
  type ReportInput,
  type AdaptiveReportInput,
  type ReportAssets,
} from "@shared/report/report-html";
import { exportReportPdf, loadReportAssets } from "@shared/report/export-pdf";

/** Where the server serves the report's ingredients (see server/routes/report.ts). */
const LIB_BASE = "/api/report/lib/";
const ASSET_BASE = "/api/report/asset/";

type Jspdf = { jsPDF: new (opts: any) => any };

declare global {
  interface Window {
    jspdf?: Jspdf;
    html2canvas?: (el: Element, opts: Record<string, unknown>) => Promise<HTMLCanvasElement>;
  }
}

/** In-flight/settled loader promise — the libraries load at most once per document. */
let libsPromise: Promise<void> | null = null;
/** Report background/logo, resolved once (a few hundred KB of image decode). */
let assetsPromise: Promise<ReportAssets> | null = null;

/** Load one classic script and resolve when it has executed. */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-report-lib="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error(`Не удалось загрузить ${src}`)));
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.dataset.reportLib = src;
    el.addEventListener("load", () => {
      el.dataset.loaded = "1";
      resolve();
    });
    el.addEventListener("error", () => reject(new Error(`Не удалось загрузить ${src}`)));
    document.head.appendChild(el);
  });
}

/** Ensure `window.jspdf` / `window.html2canvas` are present (idempotent). */
async function ensureLibs(): Promise<void> {
  if (window.jspdf?.jsPDF && window.html2canvas) return;
  if (!libsPromise) {
    libsPromise = Promise.all([
      loadScript(`${LIB_BASE}html2canvas.min.js`),
      loadScript(`${LIB_BASE}jspdf.umd.min.js`),
    ])
      .then(() => undefined)
      .catch((e) => {
        // A failed load must not poison later attempts — the learner can retry.
        libsPromise = null;
        throw e;
      });
  }
  return libsPromise;
}

/** Report input as the results endpoint delivers it (standard or adaptive shape). */
export type AttemptReport = ReportInput | AdaptiveReportInput;

/**
 * Build and download the attempt report.
 *
 * @param report Report input from `GET /api/attempts/:id/result`.
 * @returns The saved file name.
 * @throws When the libraries cannot load or rasterizing fails — the caller surfaces it.
 */
export async function downloadAttemptReport(report: AttemptReport): Promise<string> {
  await ensureLibs();
  if (!assetsPromise) {
    assetsPromise = loadReportAssets(ASSET_BASE).catch(() => {
      // Missing plates are not fatal: the page falls back to its gradient + no logo.
      assetsPromise = null;
      return {};
    });
  }
  const assets = await assetsPromise;
  // The server flags the mode (`adaptive`) — the page differs, the input shape follows.
  const html = report.adaptive
    ? buildAdaptiveReportHtml(report as AdaptiveReportInput, assets)
    : buildReportHtml(report as ReportInput, assets);
  return exportReportPdf(html, report.testName, {
    jsPDF: window.jspdf!.jsPDF,
    html2canvas: window.html2canvas!,
  });
}
