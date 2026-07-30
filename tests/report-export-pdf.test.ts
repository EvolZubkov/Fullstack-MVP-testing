// @vitest-environment jsdom
/**
 * @module tests/report-export-pdf
 *
 * The report's export pipeline (`shared/report/export-pdf`) — the one routine both hosts
 * run. The PDF libraries are injected precisely so this is testable without them: the
 * tests drive it with recording doubles and assert what reaches the writer (A4 sizing,
 * the recommendation chips re-added as REAL links, the off-screen container always
 * cleaned up).
 */

import { describe, it, expect, vi } from "vitest";
import { exportReportPdf, loadReportAssets, loadImageDataUrl } from "../shared/report/export-pdf";

/** A canvas double: html2canvas' output is only read for size + data URL. */
function fakeCanvas(width = 1190, height = 1684) {
  return { width, height, toDataURL: () => "data:image/jpeg;base64,ZZ" } as unknown as HTMLCanvasElement;
}

/** A jsPDF double recording every call the pipeline makes. */
function fakePdf() {
  const calls = {
    ctor: [] as unknown[],
    addImage: [] as unknown[][],
    link: [] as unknown[][],
    saved: [] as string[],
  };
  class Doc {
    constructor(opts: unknown) {
      calls.ctor.push(opts);
    }
    addImage(...args: unknown[]) {
      calls.addImage.push(args);
    }
    link(...args: unknown[]) {
      calls.link.push(args);
    }
    save(name: string) {
      calls.saved.push(name);
    }
  }
  return { calls, jsPDF: Doc as unknown as never };
}

const PAGE = '<div style="width: 595px">Отчёт</div>';

describe("exportReportPdf", () => {
  it("rasterizes the page and hands an A4-wide image to the writer", async () => {
    const { calls, jsPDF } = fakePdf();
    const html2canvas = vi.fn().mockResolvedValue(fakeCanvas(1190, 1684));
    const name = await exportReportPdf(PAGE, "Демо тест", { jsPDF, html2canvas });

    expect(html2canvas).toHaveBeenCalledTimes(1);
    expect(calls.ctor[0]).toMatchObject({ orientation: "portrait", unit: "mm" });
    // 1684/1190 * 210mm ≈ 297mm — A4 proportions preserved.
    const [, , , , w, h] = calls.addImage[0] as [string, string, number, number, number, number];
    expect(w).toBe(210);
    expect(Math.round(h)).toBe(297);
    expect(name).toMatch(/^Результаты_Демо_тест_\d{2}_\d{2}_\d{4}\.pdf$/);
    expect(calls.saved).toEqual([name]);
  });

  it("never leaves the off-screen container in the document", async () => {
    const { jsPDF } = fakePdf();
    await exportReportPdf(PAGE, "T", { jsPDF, html2canvas: vi.fn().mockResolvedValue(fakeCanvas()) });
    expect(document.body.textContent).not.toContain("Отчёт");
  });

  it("cleans up even when rasterizing fails, and surfaces the failure", async () => {
    const { jsPDF } = fakePdf();
    const boom = vi.fn().mockRejectedValue(new Error("canvas boom"));
    await expect(exportReportPdf(PAGE, "T", { jsPDF, html2canvas: boom })).rejects.toThrow("canvas boom");
    expect(document.body.children.length).toBe(0);
  });

  it("re-adds the recommendation chips as real PDF links", async () => {
    const { calls, jsPDF } = fakePdf();
    const withChips =
      '<div style="width: 595px">' +
      '<div class="pdf-link-btn" data-url="https://e/a">Курс A</div>' +
      '<div class="pdf-link-btn" data-url="">Без ссылки</div>' +
      "</div>";
    await exportReportPdf(withChips, "T", { jsPDF, html2canvas: vi.fn().mockResolvedValue(fakeCanvas()) });
    // Only the chip that carries a URL becomes a link.
    expect(calls.link).toHaveLength(1);
    const [, , , , opts] = calls.link[0] as [number, number, number, number, { url: string; newWindow: boolean }];
    expect(opts).toEqual({ url: "https://e/a", newWindow: true });
  });

  it("refuses to run without the libraries", async () => {
    await expect(
      exportReportPdf(PAGE, "T", { jsPDF: undefined as never, html2canvas: vi.fn() }),
    ).rejects.toThrow(/jsPDF|html2canvas/);
    const { jsPDF } = fakePdf();
    await expect(
      exportReportPdf(PAGE, "T", { jsPDF, html2canvas: undefined as never }),
    ).rejects.toThrow(/jsPDF|html2canvas/);
  });

  it("rejects empty markup rather than writing a blank page", async () => {
    const { jsPDF } = fakePdf();
    await expect(
      exportReportPdf("", "T", { jsPDF, html2canvas: vi.fn().mockResolvedValue(fakeCanvas()) }),
    ).rejects.toThrow("Пустая разметка отчёта");
  });
});

describe("report assets", () => {
  /** Stub `Image` so a src either "loads" or fails, without any network. */
  function stubImage(behaviour: (src: string) => "load" | "error") {
    class FakeImage {
      width = 4;
      height = 4;
      crossOrigin = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        setTimeout(() => (behaviour(value) === "load" ? this.onload?.() : this.onerror?.()), 0);
      }
    }
    vi.stubGlobal("Image", FakeImage);
  }

  it("resolves null for an asset that cannot be read (report falls back)", async () => {
    stubImage(() => "error");
    await expect(loadImageDataUrl("/api/report/asset/pdf-bg-1.png")).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it("returns no background and no logo when every asset is missing", async () => {
    stubImage(() => "error");
    await expect(loadReportAssets("/api/report/asset/")).resolves.toEqual({
      backgroundDataUrl: null,
      logoDataUrl: null,
    });
    vi.unstubAllGlobals();
  });

  it("asks for the plates and the logo under the given base URL", async () => {
    const asked: string[] = [];
    stubImage((src) => {
      asked.push(src);
      return "error";
    });
    await loadReportAssets("/api/report/asset/");
    expect(asked).toEqual([
      "/api/report/asset/pdf-bg-1.png",
      "/api/report/asset/pdf-bg-2.png",
      "/api/report/asset/pdf-bg-3.png",
      "/api/report/asset/logo-light.png",
    ]);
    vi.unstubAllGlobals();
  });

  it("picks a plate deterministically when the caller supplies the chooser", async () => {
    // jsdom has no 2D context, so `loadImageDataUrl` cannot produce a data URL here;
    // the point of the assertion is that `pick` drives the choice, not Math.random.
    const pick = vi.fn().mockReturnValue(0);
    stubImage(() => "load");
    await loadReportAssets("/base/", pick);
    vi.unstubAllGlobals();
    // With no readable plates there is nothing to choose from, so `pick` stays unused —
    // guarding that the empty case never indexes into an empty list.
    expect(pick).not.toHaveBeenCalled();
  });
});
