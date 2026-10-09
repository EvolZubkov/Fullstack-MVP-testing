/**
 * @module shared/report/__tests__/export-pdf.links
 *
 * Кликабельные ссылки PDF отчёта.
 *
 * Отчёт растеризуется, и любая ссылка на листе становится картинкой. Живой она остаётся
 * только потому, что конвейер накладывает поверх снимка области `pdf.link()`. Раньше их
 * получали лишь чипы рекомендаций `.pdf-link-btn`; ссылка, которую автор вставил в текст
 * авторской страницы, в PDF выглядела ссылкой и не нажималась.
 *
 * jsdom не раскладывает страницу, поэтому прямоугольники строк ссылки подставляются
 * заглушкой `getClientRects`: предмет проверки — какие области и с каким адресом уходят в
 * jsPDF, а не геометрия браузера.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportReportPdf, type ReportPage } from "../export-pdf";

/** Область, переданная двойнику jsPDF. */
interface LinkCall {
  x: number;
  y: number;
  w: number;
  h: number;
  url: string;
}

/**
 * Двойники библиотек: растеризатор отдаёт холст-заглушку, jsPDF записывает ссылки.
 *
 * @param calls Куда складывать вызовы `link()`.
 */
function makeDeps(calls: LinkCall[]) {
  return {
    document,
    html2canvas: vi.fn(async () => ({
      width: 595,
      height: 842,
      toDataURL: () => "data:image/jpeg;base64,AAAA",
    })),
    jsPDF: class {
      addImage() {}
      addPage() {}
      link(x: number, y: number, w: number, h: number, opts: { url: string }) {
        calls.push({ x, y, w, h, url: opts.url });
      }
      save() {}
    },
  } as unknown as Parameters<typeof exportReportPdf>[2];
}

/** Прямоугольник строки в CSS-пикселях. */
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * Страница с авторскими ссылками внутри колонки — ровно то, что печатает блок
 * «Страница: заголовок, текст и три колонки».
 *
 * @param columnHtml Разметка колонки.
 */
function pageWith(columnHtml: string): ReportPage {
  return {
    layout: `<div class="tb-report"><section class="tb-report__card"><div class="tb-report__cols-3"><div class="tb-report__text">${columnHtml}</div></div></section></div>`,
    context: {},
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ссылки авторского текста в PDF", () => {
  it("внешняя ссылка становится кликабельной областью с её адресом", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "getClientRects").mockReturnValue([
      rect(100, 200, 80, 20),
    ] as unknown as DOMRectList);
    const calls: LinkCall[] = [];
    await exportReportPdf(
      pageWith('<p>См. <a href="https://example.org/cards">карточки</a></p>'),
      "Тест",
      makeDeps(calls),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://example.org/cards");
    expect(calls[0].w).toBeGreaterThan(0);
    expect(calls[0].h).toBeGreaterThan(0);
  });

  it("перенесённая на две строки ссылка даёт область на КАЖДУЮ строку", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "getClientRects").mockReturnValue([
      rect(300, 200, 90, 20),
      rect(40, 220, 60, 20),
    ] as unknown as DOMRectList);
    const calls: LinkCall[] = [];
    await exportReportPdf(
      pageWith('<p><a href="https://example.org/long">длинная ссылка</a></p>'),
      "Тест",
      makeDeps(calls),
    );
    expect(calls.map((c) => c.url)).toEqual(["https://example.org/long", "https://example.org/long"]);
    // Вторая строка начинается левее первой: одна общая рамка накрыла бы чужой текст.
    expect(calls[1].x).toBeLessThan(calls[0].x);
    expect(calls[1].y).toBeGreaterThan(calls[0].y);
  });

  it("mailto переносится, якорь и относительный путь — нет", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "getClientRects").mockReturnValue([
      rect(10, 10, 50, 20),
    ] as unknown as DOMRectList);
    const calls: LinkCall[] = [];
    await exportReportPdf(
      pageWith('<a href="mailto:hr@example.org">почта</a><a href="#top">наверх</a><a href="/local">путь</a>'),
      "Тест",
      makeDeps(calls),
    );
    expect(calls.map((c) => c.url)).toEqual(["mailto:hr@example.org"]);
  });

  it("чип рекомендации по-прежнему становится ссылкой", async () => {
    // Геометрия подменяется ТОЛЬКО у чипа: ненулевой прямоугольник у всех элементов
    // включил бы постраничную раскладку jsdom-документа, и чип попал бы на несколько листов.
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("pdf-link-btn") ? rect(20, 40, 120, 24) : original.call(this);
    });
    const calls: LinkCall[] = [];
    await exportReportPdf(
      pageWith('<div class="pdf-link-btn" data-url="https://example.org/course">Курс</div>'),
      "Тест",
      makeDeps(calls),
    );
    expect(calls.map((c) => c.url)).toEqual(["https://example.org/course"]);
  });
});
