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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportReportPdf, inlineReportImageValues, loadImageDataUrl } from "../shared/report/export-pdf";

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

/** Страница отчёта: макет варианта + контекст, как их отдаёт шаблон. */
const PAGE = { layout: '<div class="tb-report">Отчёт: {{ course.title }}</div>', context: { course: { title: "Демо" } } };

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
    const withChips = {
      layout:
        '<div class="tb-report">' +
        '<div class="pdf-link-btn" data-url="https://e/a">Курс A</div>' +
        '<div class="pdf-link-btn" data-url="">Без ссылки</div>' +
        "</div>",
      context: {},
    };
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

  it("отказывается работать без макета: шаблон обязан его дать", async () => {
    const { jsPDF } = fakePdf();
    await expect(
      exportReportPdf({ layout: "", context: {} }, "T", { jsPDF, html2canvas: vi.fn().mockResolvedValue(fakeCanvas()) }),
    ).rejects.toThrow("Шаблон не предоставил макет отчёта");
  });

  it("рендерит МАКЕТ через общий рендерер, а не берёт готовый HTML", async () => {
    const { jsPDF } = fakePdf();
    const html2canvas = vi.fn().mockResolvedValue(fakeCanvas());
    await exportReportPdf(
      { layout: '<div class="tb-report"><span data-path="report.verdictHeadline"></span></div>', context: { report: { verdictHeadline: "Тест пройден" } } },
      "T",
      { jsPDF, html2canvas },
    );
    // Растеризуется отрисованный корень, и подстановка из контекста уже произошла.
    const target = html2canvas.mock.calls[0][0] as HTMLElement;
    expect(target.className).toContain("tb-report");
    expect(target.textContent).toBe("Тест пройден");
  });

  it("CSS варианта и токены живут на контейнере и уходят вместе с ним", async () => {
    const { jsPDF } = fakePdf();
    let sawStyle = false;
    let sawVar = "";
    const html2canvas = vi.fn().mockImplementation((el: HTMLElement) => {
      sawStyle = !!el.parentElement?.parentElement?.querySelector("style");
      sawVar = el.parentElement?.style.getPropertyValue("--primary") ?? "";
      return Promise.resolve(fakeCanvas());
    });
    await exportReportPdf(
      { layout: '<div class="tb-report">x</div>', css: ".tb-report { color: red }", cssVars: { "--primary": "270 100% 50%" }, context: {} },
      "T",
      { jsPDF, html2canvas },
    );
    expect(sawStyle).toBe(true);
    expect(sawVar).toBe("270 100% 50%");
    // После экспорта ни стилей, ни контейнера в документе нет.
    expect(document.querySelectorAll("style").length).toBe(0);
    expect(document.body.children.length).toBe(0);
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
    await expect(loadImageDataUrl("template/assets/report/bg.png")).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it("нечитаемая картинка становится пустым значением, а не роняет экспорт", async () => {
    stubImage(() => "error");
    await expect(
      inlineReportImageValues({ backgroundImage: "template/assets/report/bg.png" }, ["backgroundImage"]),
    ).resolves.toEqual({ backgroundImage: "" });
    vi.unstubAllGlobals();
  });

  it("читает ИМЕННО объявленные вариантом картинки, по их путям", async () => {
    const asked: string[] = [];
    stubImage((src) => {
      asked.push(src);
      return "error";
    });
    await inlineReportImageValues(
      {
        backgroundImage: "template/assets/report/bg.png",
        logoImage: "/uploads/media/own-logo.png",
        headline: "Итоги",
      },
      ["backgroundImage", "logoImage"],
    );
    // Заголовок — не картинка, его никто не грузит; порядок — как объявлено.
    expect(asked).toEqual(["template/assets/report/bg.png", "/uploads/media/own-logo.png"]);
    vi.unstubAllGlobals();
  });

  it("незаполненное и уже инлайненное значения сети не касаются", async () => {
    const asked: string[] = [];
    stubImage((src) => {
      asked.push(src);
      return "load";
    });
    const values = await inlineReportImageValues(
      { backgroundImage: "", logoImage: "data:image/png;base64,AAA" },
      ["backgroundImage", "logoImage"],
    );
    expect(asked).toEqual([]);
    expect(values).toEqual({ backgroundImage: "", logoImage: "data:image/png;base64,AAA" });
    vi.unstubAllGlobals();
  });

  describe("с работающим 2D-контекстом", () => {
    // jsdom не умеет `getContext("2d")`, а именно на нём стоит успешный путь чтения
    // ассета: без подмены он не проверяется ни разу.
    let ctxSpy: ReturnType<typeof vi.spyOn>;
    let urlSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      ctxSpy = vi
        .spyOn(HTMLCanvasElement.prototype, "getContext")
        .mockReturnValue({ drawImage: () => undefined } as unknown as CanvasRenderingContext2D);
      urlSpy = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,PLATE");
    });

    afterEach(() => {
      ctxSpy.mockRestore();
      urlSpy.mockRestore();
      vi.unstubAllGlobals();
    });

    it("читает ассет шаблона в data-URL", async () => {
      stubImage(() => "load");
      await expect(loadImageDataUrl("template/assets/report/logo.png")).resolves.toBe(
        "data:image/png;base64,PLATE",
      );
    });

    it("все объявленные картинки приходят в макет уже инлайненными", async () => {
      stubImage(() => "load");
      const values = await inlineReportImageValues(
        { backgroundImage: "template/assets/report/bg.png", logoImage: "template/assets/report/logo.png" },
        ["backgroundImage", "logoImage"],
      );
      expect(values).toEqual({
        backgroundImage: "data:image/png;base64,PLATE",
        logoImage: "data:image/png;base64,PLATE",
      });
    });

    it("подложки нет, а логотип есть — отчёт печатается с градиентом шаблона", async () => {
      stubImage((src) => (src.includes("bg.png") ? "error" : "load"));
      const values = await inlineReportImageValues(
        { backgroundImage: "template/assets/report/bg.png", logoImage: "template/assets/report/logo.png" },
        ["backgroundImage", "logoImage"],
      );
      expect(values.backgroundImage).toBe("");
      expect(values.logoImage).toBe("data:image/png;base64,PLATE");
    });

    it("значения, которых вариант не объявлял картинками, не трогаются", async () => {
      stubImage(() => "load");
      const values = await inlineReportImageValues(
        { headline: "Итоги", backgroundImage: "template/assets/report/bg.png" },
        ["backgroundImage"],
      );
      expect(values.headline).toBe("Итоги");
    });
  });
});
