/**
 * @module shared/report/__tests__/clone-fonts
 *
 * Шрифты клона растеризатора совпадают со шрифтами холста.
 *
 * html2canvas меряет каждое слово в КЛОНЕ документа (скрытом iframe), а рисует его на холсте
 * исходного документа. Если клон в момент замера видит другую гарнитуру — встроенный шрифт ещё
 * не разобран, начертание подобрано иначе, — слова рисуются шире или уже отмеренного места, и
 * в PDF пропадают пробелы: «несколькимтемам», «стандартуруководителяв». Проверено пробой в
 * Chrome: тот же текст, клон без `@font-face` — ровно эта картина.
 *
 * jsdom не знает ни `document.fonts`, ни холста, поэтому оба подставляются двойниками:
 * предмет проверки — какие начертания клон обязан догрузить и чего он ждёт, а не браузер.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncCloneFonts } from "../clone-fonts";
import { exportReportPdf } from "../export-pdf";

/** Начертание, как его отдаёт `FontFaceSet`. */
interface FaceStub {
  family: string;
  weight: string;
  style: string;
  status: string;
}

/**
 * Документ-двойник с набором шрифтов.
 *
 * @param faces Начертания набора.
 * @param load Что делает `fonts.load(desc)`.
 */
function docWithFonts(faces: FaceStub[], load: (desc: string) => Promise<unknown> = async () => []) {
  const doc = document.implementation.createHTMLDocument("clone");
  const fonts = {
    forEach: (fn: (f: FaceStub) => void) => faces.forEach(fn),
    load: vi.fn(load),
    check: vi.fn(() => true),
    ready: Promise.resolve(),
  };
  Object.defineProperty(doc, "fonts", { value: fonts, configurable: true });
  return { doc, fonts };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("syncCloneFonts", () => {
  it("клон догружает каждое ЗАГРУЖЕННОЕ начертание исходного документа", async () => {
    const source = docWithFonts([
      { family: '"RostelecomBasis"', weight: "300", style: "normal", status: "loaded" },
      { family: "RostelecomBasis", weight: "700", style: "normal", status: "loaded" },
      { family: "RostelecomBasis", weight: "500", style: "normal", status: "unloaded" },
    ]);
    const clone = docWithFonts([]);

    await syncCloneFonts(source.doc, clone.doc);

    expect(clone.fonts.load.mock.calls.map((c) => c[0]).sort()).toEqual([
      'normal 300 16px "RostelecomBasis"',
      'normal 700 16px "RostelecomBasis"',
    ]);
  });

  it("одинаковое начертание просится один раз; диапазон веса берётся по нижней границе", async () => {
    const source = docWithFonts([
      { family: "Brand", weight: "100 900", style: "normal", status: "loaded" },
      { family: "Brand", weight: "100 900", style: "normal", status: "loaded" },
    ]);
    const clone = docWithFonts([]);

    await syncCloneFonts(source.doc, clone.doc);

    expect(clone.fonts.load.mock.calls.map((c) => c[0])).toEqual(['normal 100 16px "Brand"']);
  });

  it("без Font Loading API ничего не делает и не падает", async () => {
    const source = document.implementation.createHTMLDocument("src");
    const clone = document.implementation.createHTMLDocument("clone");
    await expect(syncCloneFonts(source, clone)).resolves.toBeUndefined();
  });

  it("зависшая загрузка не держит экспорт дольше предела", async () => {
    vi.useFakeTimers();
    const source = docWithFonts([{ family: "Brand", weight: "400", style: "normal", status: "loaded" }]);
    const clone = docWithFonts([], () => new Promise(() => {}));

    let done = false;
    const run = syncCloneFonts(source.doc, clone.doc, { timeoutMs: 1000 }).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    await run;
    expect(done).toBe(true);
  });

  it("ждёт, пока ширина строки в клоне не сравняется с шириной на холсте", async () => {
    const source = docWithFonts([{ family: "Brand", weight: "400", style: "normal", status: "loaded" }]);
    const clone = docWithFonts([]);
    // Холст исходного документа: строка шириной 200px.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: () => ({ width: 200 }),
    } as unknown as CanvasRenderingContext2D);
    // Клон: первые два замера — запасная гарнитура (170px), затем шрифт готов.
    const widths = [170, 170, 200];
    let probes = 0;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ width: widths[Math.min(probes++, widths.length - 1)] }) as DOMRect,
    );

    await syncCloneFonts(source.doc, clone.doc, { pollMs: 1 });

    expect(probes).toBe(3);
    // Проба не остаётся в клоне: иначе её снял бы растеризатор.
    expect(clone.doc.body.querySelector("[data-tb-font-probe]")).toBeNull();
  });

  it("стойкое расхождение не вешает экспорт: после предела печатается как есть", async () => {
    const source = docWithFonts([{ family: "Brand", weight: "400", style: "normal", status: "loaded" }]);
    const clone = docWithFonts([]);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: () => ({ width: 200 }),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 170 } as DOMRect);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await syncCloneFonts(source.doc, clone.doc, { pollMs: 1, timeoutMs: 30 });

    expect(warn).toHaveBeenCalled();
  });

  it("конвейер PDF выравнивает шрифты клона перед КАЖДЫМ снимком", async () => {
    const options: Record<string, unknown>[] = [];
    await exportReportPdf({ layout: '<div class="tb-report"><p>Текст</p></div>', context: {} }, "Тест", {
      document,
      html2canvas: vi.fn(async (_el: Element, opts: Record<string, unknown>) => {
        options.push(opts);
        return { width: 595, height: 842, toDataURL: () => "data:image/jpeg;base64,AAAA" } as HTMLCanvasElement;
      }),
      jsPDF: class {
        addImage() {}
        addPage() {}
        link() {}
        save() {}
      },
    });

    expect(options.length).toBeGreaterThan(0);
    for (const opts of options) expect(typeof opts.onclone).toBe("function");
  });
});
