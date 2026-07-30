// @vitest-environment jsdom
/**
 * @module features/learner/__tests__/attempt-report
 *
 * The web host's «Скачать отчёт» loader. The PDF libraries are the package's vendored
 * builds fetched from `/api/report/lib/*` on first use — not bundled — so these tests
 * pin that contract: the scripts are injected once, the shared generator is handed the
 * loaded globals, and the mode flag (not a guess about the data) picks the page.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const exportReportPdf = vi.fn().mockResolvedValue("Результаты_Тест_30_07_2026.pdf");
const loadReportAssets = vi.fn().mockResolvedValue({ backgroundDataUrl: null, logoDataUrl: null });
const buildReportHtml = vi.fn().mockReturnValue("<standard/>");
const buildAdaptiveReportHtml = vi.fn().mockReturnValue("<adaptive/>");

vi.mock("@shared/report/export-pdf", () => ({ exportReportPdf, loadReportAssets }));
vi.mock("@shared/report/report-html", () => ({ buildReportHtml, buildAdaptiveReportHtml }));

/** Resolve every injected <script> as soon as it is appended. */
function autoResolveScripts() {
  const observer = new MutationObserver((records) => {
    for (const rec of records) {
      rec.addedNodes.forEach((node) => {
        if (node instanceof HTMLScriptElement && node.dataset.reportLib) {
          node.dispatchEvent(new Event("load"));
        }
      });
    }
  });
  observer.observe(document.head, { childList: true });
  return observer;
}

const standardReport = {
  testName: "Тест",
  result: { passed: true, percent: 100, totalQuestions: 1, correct: 1, earnedPoints: 1, possiblePoints: 1, topicResults: [] },
};

let observer: MutationObserver;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  document.head.innerHTML = "";
  (window as unknown as Record<string, unknown>).jspdf = { jsPDF: class {} };
  (window as unknown as Record<string, unknown>).html2canvas = () => Promise.resolve();
  observer = autoResolveScripts();
});

afterEach(() => observer.disconnect());

describe("downloadAttemptReport", () => {
  it("builds the STANDARD page and returns the saved file name", async () => {
    const { downloadAttemptReport } = await import("../attempt-report");
    const name = await downloadAttemptReport(standardReport as never);
    expect(buildReportHtml).toHaveBeenCalledTimes(1);
    expect(buildAdaptiveReportHtml).not.toHaveBeenCalled();
    expect(exportReportPdf).toHaveBeenCalledWith("<standard/>", "Тест", expect.anything());
    expect(name).toBe("Результаты_Тест_30_07_2026.pdf");
  });

  it("builds the ADAPTIVE page when the server flags the mode", async () => {
    const { downloadAttemptReport } = await import("../attempt-report");
    await downloadAttemptReport({ ...standardReport, adaptive: true } as never);
    expect(buildAdaptiveReportHtml).toHaveBeenCalledTimes(1);
    expect(buildReportHtml).not.toHaveBeenCalled();
  });

  it("loads the vendored libraries from the API when they are absent", async () => {
    delete (window as unknown as Record<string, unknown>).jspdf;
    delete (window as unknown as Record<string, unknown>).html2canvas;
    const { downloadAttemptReport } = await import("../attempt-report");
    const run = downloadAttemptReport(standardReport as never);
    // The loader resolves on the injected scripts' load events; the globals then exist.
    await Promise.resolve();
    (window as unknown as Record<string, unknown>).jspdf = { jsPDF: class {} };
    (window as unknown as Record<string, unknown>).html2canvas = () => Promise.resolve();
    await run;
    const srcs = [...document.head.querySelectorAll("script")].map((s) => s.getAttribute("src"));
    expect(srcs).toEqual(["/api/report/lib/html2canvas.min.js", "/api/report/lib/jspdf.umd.min.js"]);
  });

  it("loads the libraries at most once across repeated downloads", async () => {
    delete (window as unknown as Record<string, unknown>).jspdf;
    delete (window as unknown as Record<string, unknown>).html2canvas;
    const { downloadAttemptReport } = await import("../attempt-report");
    const first = downloadAttemptReport(standardReport as never);
    await Promise.resolve();
    (window as unknown as Record<string, unknown>).jspdf = { jsPDF: class {} };
    (window as unknown as Record<string, unknown>).html2canvas = () => Promise.resolve();
    await first;
    await downloadAttemptReport(standardReport as never);
    expect(document.head.querySelectorAll("script")).toHaveLength(2);
    // The plates are resolved once too — they are a few hundred KB of image decode.
    expect(loadReportAssets).toHaveBeenCalledTimes(1);
  });

  it("still builds the report when the plates are unavailable", async () => {
    loadReportAssets.mockRejectedValueOnce(new Error("404"));
    const { downloadAttemptReport } = await import("../attempt-report");
    await downloadAttemptReport(standardReport as never);
    // Empty assets, not a thrown error: the page falls back to its gradient.
    expect(buildReportHtml).toHaveBeenCalledWith(standardReport, {});
  });

  it("propagates a library that fails to load, and allows a retry", async () => {
    observer.disconnect();
    const failing = new MutationObserver((records) => {
      for (const rec of records) {
        rec.addedNodes.forEach((node) => {
          if (node instanceof HTMLScriptElement && node.dataset.reportLib) {
            node.dispatchEvent(new Event("error"));
          }
        });
      }
    });
    failing.observe(document.head, { childList: true });
    delete (window as unknown as Record<string, unknown>).jspdf;
    delete (window as unknown as Record<string, unknown>).html2canvas;
    const { downloadAttemptReport } = await import("../attempt-report");
    await expect(downloadAttemptReport(standardReport as never)).rejects.toThrow(/Не удалось загрузить/);
    failing.disconnect();
    // A failed load must not poison the module: with the globals present it works again.
    (window as unknown as Record<string, unknown>).jspdf = { jsPDF: class {} };
    (window as unknown as Record<string, unknown>).html2canvas = () => Promise.resolve();
    await expect(downloadAttemptReport(standardReport as never)).resolves.toBeTruthy();
  });
});
