// @vitest-environment jsdom
/**
 * @module features/learner/__tests__/attempt-report
 *
 * The web host's «Скачать отчёт» loader. The PDF libraries are the package's vendored
 * builds fetched from `/api/report/lib/*` on first use — not bundled — so these tests
 * pin that contract: the scripts are injected once, the shared generator is handed the
 * loaded globals, and the mode flag (not a guess about the data) picks the page.
 *
 * С PRD-27 Фазы 2 страницу рисует МАКЕТ шаблона: клиент отдаёт конвейеру макет, CSS и
 * контекст, а не готовый HTML.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const exportReportPdf = vi.fn().mockResolvedValue("Результаты_Тест_30_07_2026.pdf");
const loadReportAssets = vi.fn().mockResolvedValue({ backgroundDataUrl: null, logoDataUrl: null });
const buildReportContext = vi.fn().mockReturnValue({ report: { kind: "standard" } });
const buildAdaptiveReportContext = vi.fn().mockReturnValue({ report: { kind: "adaptive" } });

vi.mock("@shared/report/export-pdf", () => ({ exportReportPdf, loadReportAssets }));
vi.mock("@shared/report/report-context", () => ({ buildReportContext, buildAdaptiveReportContext }));

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

/** Страница отчёта, как её отдаёт `GET /api/attempts/:id/result`. */
const render = {
  layout: '<div class="tb-report">x</div>',
  css: ".tb-report { color: red }",
  variantKey: "report.standard",
  values: { headline: "Итоги" },
  cssVars: { "--primary": "270 100% 50%" },
  themeCss: ".tb-report[data-theme=dark] { color: white }",
  design: { logoUrl: "/l.png" },
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
  it("отдаёт конвейеру МАКЕТ и контекст, а не готовый HTML", async () => {
    const { downloadAttemptReport } = await import("../attempt-report");
    const name = await downloadAttemptReport(standardReport as never, render as never);

    expect(buildReportContext).toHaveBeenCalledTimes(1);
    expect(buildAdaptiveReportContext).not.toHaveBeenCalled();
    const [page, testName] = exportReportPdf.mock.calls[0];
    expect(page.layout).toBe(render.layout);
    expect(page.context).toEqual({ report: { kind: "standard" } });
    expect(page.cssVars).toEqual(render.cssVars);
    // Блок темы приклеивается к CSS варианта: он тоже скоуплен в `.tb-report`.
    expect(page.css).toContain(render.css);
    expect(page.css).toContain(render.themeCss);
    expect(testName).toBe("Тест");
    expect(name).toBe("Результаты_Тест_30_07_2026.pdf");
  });

  it("передаёт построителю значения полей варианта и брендинг", async () => {
    const { downloadAttemptReport } = await import("../attempt-report");
    await downloadAttemptReport(standardReport as never, render as never);
    const [, opts] = buildReportContext.mock.calls[0];
    expect(opts.values).toEqual(render.values);
    expect(opts.design).toEqual(render.design);
    expect(opts.assets).toBeDefined();
  });

  it("строит АДАПТИВНУЮ страницу, когда сервер пометил режим", async () => {
    const { downloadAttemptReport } = await import("../attempt-report");
    await downloadAttemptReport({ ...standardReport, adaptive: true } as never, render as never);
    expect(buildAdaptiveReportContext).toHaveBeenCalledTimes(1);
    expect(buildReportContext).not.toHaveBeenCalled();
  });

  it("грузит вендоренные библиотеки из API, когда их нет", async () => {
    delete (window as unknown as Record<string, unknown>).jspdf;
    delete (window as unknown as Record<string, unknown>).html2canvas;
    const { downloadAttemptReport } = await import("../attempt-report");
    const run = downloadAttemptReport(standardReport as never, render as never);
    await Promise.resolve();
    (window as unknown as Record<string, unknown>).jspdf = { jsPDF: class {} };
    (window as unknown as Record<string, unknown>).html2canvas = () => Promise.resolve();
    await run;
    const srcs = [...document.head.querySelectorAll("script")].map((s) => s.getAttribute("src"));
    expect(srcs).toEqual(["/api/report/lib/html2canvas.min.js", "/api/report/lib/jspdf.umd.min.js"]);
  });

  it("грузит библиотеки и подложки не более одного раза на несколько скачиваний", async () => {
    delete (window as unknown as Record<string, unknown>).jspdf;
    delete (window as unknown as Record<string, unknown>).html2canvas;
    const { downloadAttemptReport } = await import("../attempt-report");
    const first = downloadAttemptReport(standardReport as never, render as never);
    await Promise.resolve();
    (window as unknown as Record<string, unknown>).jspdf = { jsPDF: class {} };
    (window as unknown as Record<string, unknown>).html2canvas = () => Promise.resolve();
    await first;
    await downloadAttemptReport(standardReport as never, render as never);
    expect(document.head.querySelectorAll("script")).toHaveLength(2);
    expect(loadReportAssets).toHaveBeenCalledTimes(1);
  });

  it("строит отчёт и когда подложки недоступны", async () => {
    loadReportAssets.mockRejectedValueOnce(new Error("404"));
    const { downloadAttemptReport } = await import("../attempt-report");
    await downloadAttemptReport(standardReport as never, render as never);
    // Пустые ассеты, а не исключение: страница откатывается к своему градиенту.
    const [, opts] = buildReportContext.mock.calls[0];
    expect(opts.assets).toEqual({});
  });

  it("пробрасывает не загрузившуюся библиотеку и позволяет повторить", async () => {
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
    await expect(downloadAttemptReport(standardReport as never, render as never)).rejects.toThrow(
      /Не удалось загрузить/,
    );
    failing.disconnect();
    // Неудача не отравляет модуль: с присутствующими глобалями всё снова работает.
    (window as unknown as Record<string, unknown>).jspdf = { jsPDF: class {} };
    (window as unknown as Record<string, unknown>).html2canvas = () => Promise.resolve();
    await expect(downloadAttemptReport(standardReport as never, render as never)).resolves.toBeTruthy();
  });
});
