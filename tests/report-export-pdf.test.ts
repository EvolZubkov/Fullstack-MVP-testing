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
    addPage: 0,
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
    addPage() {
      calls.addPage += 1;
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

/**
 * Дать jsdom высоты: он раскладку не считает, а разбивка на страницы стоит именно на
 * измеренных координатах. Высота блока читается из его `data-h`, корень занимает их сумму.
 */
function stubLayout() {
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const own = Number((this as HTMLElement).dataset?.h ?? NaN);
    if (Number.isFinite(own)) {
      let top = 0;
      for (const sibling of [...(this.parentElement?.children ?? [])]) {
        if (sibling === this) break;
        top += Number((sibling as HTMLElement).dataset?.h ?? 0);
      }
      return { top, bottom: top + own, left: 0, right: 595, width: 595, height: own } as DOMRect;
    }
    const total = [...this.children].reduce((sum, c) => sum + Number((c as HTMLElement).dataset?.h ?? 0), 0);
    return { top: 0, bottom: total, left: 0, right: 595, width: 595, height: total } as DOMRect;
  });
}

/**
 * То же, но страница отчёта несёт ВЕРХНЕЕ ПОЛЕ: блоки начинаются под ним, а высота корня
 * его включает — ровно так, как меряет браузер. Поле — единственная разница между
 * пространством измерений и пространством кусков, и без него её не проверить.
 */
function stubPaddedLayout(pad: number) {
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const own = Number((this as HTMLElement).dataset?.h ?? NaN);
    if (Number.isFinite(own)) {
      let top = pad;
      for (const sibling of [...(this.parentElement?.children ?? [])]) {
        if (sibling === this) break;
        top += Number((sibling as HTMLElement).dataset?.h ?? 0);
      }
      return { top, bottom: top + own, left: 0, right: 595, width: 595, height: own } as DOMRect;
    }
    const total = [...this.children].reduce((sum, c) => sum + Number((c as HTMLElement).dataset?.h ?? 0), 0);
    return { top: 0, bottom: pad + total + pad, left: 0, right: 595, width: 595, height: pad + total + pad } as DOMRect;
  });
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

  it("на время растеризации чинит измеритель шрифта html2canvas", async () => {
    // Растеризатор ищет базовую линию шрифта скрытой пробой из строки и картинки 1×1.
    // Глобальный сброс веб-хоста (`preflight.css`: `img { display: block }`) выбивает
    // картинку из строки, «подъём» шрифта вырастает на пол-строки, и весь текст снимка
    // съезжает вниз — за границу окна страницы, отчего нижняя строка листа режется
    // пополам, а её половина всплывает вверху следующего. Правило живёт ровно столько,
    // сколько строится отчёт.
    const { jsPDF } = fakePdf();
    const seen: string[] = [];
    const html2canvas = vi.fn().mockImplementation(() => {
      seen.push([...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n"));
      return Promise.resolve(fakeCanvas());
    });
    await exportReportPdf(PAGE, "T", { jsPDF, html2canvas });

    // Адрес пробы — тот самый однопиксельный GIF, который html2canvas зашил в свой код.
    expect(seen[0]).toContain("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7");
    expect(seen[0]).toContain("display:inline!important");
    const left = [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
    expect(left).not.toContain("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7");
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

  it("раскладывает документ по страницам A4, не разрывая карточки", async () => {
    // Отчёт печатался ОДНОЙ страницей произвольной высоты — «колбасой», которую нечем
    // ни распечатать, ни пролистать. Теперь страница всегда A4, а разрыв проходит между
    // карточками: три по 500 px при полезной высоте A4 не уживаются на одном листе.
    const rect = stubLayout();
    try {
      const { calls, jsPDF } = fakePdf();
      const html2canvas = vi.fn().mockResolvedValue(fakeCanvas(1190, 1000));
      await exportReportPdf(
        {
          layout:
            '<div class="tb-report">' +
            '<section data-h="500">Счёт</section>' +
            '<section data-h="500">Темы</section>' +
            '<section data-h="500">Показатели</section>' +
            "</div>",
          context: {},
        },
        "T",
        { jsPDF, html2canvas },
      );
      // Каждая карточка получает свой лист: снимок на страницу, addPage между ними.
      expect(html2canvas).toHaveBeenCalledTimes(3);
      expect(calls.addImage).toHaveLength(3);
      expect(calls.addPage).toBe(2);
      // Формат страницы — A4, а не высота содержимого.
      expect(calls.ctor[0]).toMatchObject({ format: [210, 297] });
      // На каждом листе — только его карточка: разрыва внутри карточки нет.
      const printed = html2canvas.mock.calls.map(([el]) => (el as HTMLElement).textContent);
      expect(printed).toEqual(["Счёт", "Темы", "Показатели"]);
    } finally {
      rect.mockRestore();
    }
  });

  it("короткий отчёт остаётся одной страницей", async () => {
    const rect = stubLayout();
    try {
      const { calls, jsPDF } = fakePdf();
      const html2canvas = vi.fn().mockResolvedValue(fakeCanvas(1190, 400));
      await exportReportPdf(
        { layout: '<div class="tb-report"><section data-h="200">Счёт</section></div>', context: {} },
        "T",
        { jsPDF, html2canvas },
      );
      expect(calls.addPage).toBe(0);
      expect(calls.addImage).toHaveLength(1);
    } finally {
      rect.mockRestore();
    }
  });

  it("ссылки уходят на ТУ страницу, где напечатан их чип", async () => {
    // Растр без этого превращает рекомендацию в мёртвую картинку, а координаты чипа
    // на второй странице отсчитываются от её собственного верха, а не от начала документа.
    const rect = stubLayout();
    try {
      const { calls, jsPDF } = fakePdf();
      const html2canvas = vi.fn().mockResolvedValue(fakeCanvas(1190, 1000));
      await exportReportPdf(
        {
          layout:
            '<div class="tb-report">' +
            '<section data-h="600">Первая</section>' +
            '<section data-h="600"><div class="pdf-link-btn" data-url="https://e/a">Курс</div></section>' +
            "</div>",
          context: {},
        },
        "T",
        { jsPDF, html2canvas },
      );
      expect(calls.addPage).toBe(1);
      expect(calls.link).toHaveLength(1);
      const [, , , , opts] = calls.link[0] as [number, number, number, number, { url: string }];
      expect(opts.url).toBe("https://e/a");
    } finally {
      rect.mockRestore();
    }
  });

  it("поле страницы не считается содержимым: лист в полную высоту не делится надвое", async () => {
    // Раскладка мерит всё от верхнего края корня, то есть ВМЕСТЕ с полем страницы, а
    // показывает кусок окно, стоящее уже за полем. Пока поле оставалось в координатах,
    // содержимое ростом ровно в полезную высоту считалось выше листа — и уезжало на второй,
    // почти пустой; окно же показывало на высоту поля БОЛЬШЕ отмеренного, отчего строка на
    // краю резалась пополам и повторялась вверху следующего листа.
    const rect = stubPaddedLayout(20);
    try {
      const { calls, jsPDF } = fakePdf();
      const html2canvas = vi.fn().mockResolvedValue(fakeCanvas(1190, 1684));
      await exportReportPdf(
        {
          layout:
            '<div class="tb-report" style="padding: 20px 25px">' +
            // 790 px содержимого при полезной высоте 802 — лист полон, но не переполнен.
            '<section data-h="790">Толкование</section>' +
            '<section data-h="100">Итог</section>' +
            "</div>",
          context: {},
        },
        "T",
        { jsPDF, html2canvas },
      );
      // Ровно два листа: толкование и итог. Третьего — обрезка толкования в восемь
      // пикселей — быть не должно.
      expect(html2canvas.mock.calls.map(([el]) => (el as HTMLElement).textContent)).toEqual([
        "Толкование",
        "Итог",
      ]);
      expect(calls.addPage).toBe(1);
    } finally {
      rect.mockRestore();
    }
  });

  it("принудительный разрыв в макете делит документ, который делить было бы не за чем", async () => {
    // Верстальщик шаблона объявляет `data-page-break` там, где документ читается новым
    // разделом. Обе карточки помещаются на лист, и без метки лист был бы один.
    const layout = (breakNode: string) =>
      '<div class="tb-report" style="padding: 20px 25px">' +
      '<section data-h="200">Темы</section>' +
      breakNode +
      '<section data-h="200">Показатели</section>' +
      "</div>";

    const rect = stubPaddedLayout(20);
    try {
      const plain = fakePdf();
      const once = vi.fn().mockResolvedValue(fakeCanvas());
      await exportReportPdf({ layout: layout(""), context: {} }, "T", { jsPDF: plain.jsPDF, html2canvas: once });
      expect(plain.calls.addPage).toBe(0);

      const split = fakePdf();
      const twice = vi.fn().mockResolvedValue(fakeCanvas());
      await exportReportPdf(
        { layout: layout('<div data-page-break data-h="0"></div>'), context: {} },
        "T",
        { jsPDF: split.jsPDF, html2canvas: twice },
      );
      expect(split.calls.addPage).toBe(1);
      expect(split.calls.addImage).toHaveLength(2);
      // Лист остаётся ЛИСТОМ: разрыв меняет только то, где кончается содержимое, а не
      // размер бумаги — снимок каждой страницы ложится на полный A4.
      for (const [, , , , w, h] of split.calls.addImage as [string, string, number, number, number, number][]) {
        expect(w).toBe(210);
        expect(Math.round(h)).toBe(297);
      }
    } finally {
      rect.mockRestore();
    }
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
    // Растеризуется СТРАНИЦА, внутри которой лежит отрисованный корень: лист обрезает
    // содержимое сам, поэтому снимок и лист — одно и то же.
    const target = html2canvas.mock.calls[0][0] as HTMLElement;
    expect(target.className).toContain("tb-report-page");
    expect(target.querySelector(".tb-report")).not.toBeNull();
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
    // После экспорта в документе не остаётся ни контейнера, ни СВОЕГО стиля варианта.
    // Единственный `<style>`, который вправе пережить экспорт, — глобальный
    // `[data-tb-protection]` (PRD-34): `renderScreenInto` инжектит его в `document.head`
    // безусловно при КАЖДОМ рендере сцены (см. `applyProtection` в
    // `shared/template/protection/apply.ts`) и он идемпотентен — не течёт при повторных
    // экспортах, просто живёт в head как обычная страница. Это не утечка страницы отчёта.
    const leftoverPageStyles = Array.from(document.querySelectorAll("style")).filter(
      (el) => !el.hasAttribute("data-tb-protection"),
    );
    expect(leftoverPageStyles).toHaveLength(0);
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
