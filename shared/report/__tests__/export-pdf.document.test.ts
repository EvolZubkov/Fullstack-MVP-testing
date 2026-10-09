/**
 * @module shared/report/__tests__/export-pdf.document
 *
 * PRD-51 §5.3 — КОНВЕЙЕР PDF собирает документ из блоков.
 *
 * Проверяется развилка и только она: страница с оболочкой и блоками печатается сборкой
 * документа, страница со старым цельным `layout` — прежним путём. Обе ветви обязаны жить
 * в ОДНОМ конвейере: постраничная раскладка, стыки листов и растеризация ниже одни и те
 * же, и вторая копия разошлась бы с первой на первой же правке.
 *
 * Растеризатор и jsPDF подменяются двойниками: предмет проверки — что попало в DOM перед
 * съёмкой, а не картинка.
 */
import { describe, expect, it, vi } from "vitest";
import { exportReportPdf, type ReportPage } from "../export-pdf";
import type { ReportBlockToRender } from "../render-report";

/** Что двойник растеризатора увидел в документе на момент съёмки. */
interface Captured {
  rootClass: string;
  childTags: string[];
  html: string;
}

/**
 * Двойники библиотек. `html2canvas` запоминает поддерево, которое ему дали, и отдаёт
 * холст-заглушку; jsPDF считает страницы и ничего не рисует.
 */
function makeDeps(captured: Captured[]) {
  return {
    document,
    html2canvas: vi.fn(async (el: HTMLElement) => {
      // Снимок берётся с ОКНА ЛИСТА, а корень документа лежит внутри него: постраничная
      // раскладка клонирует корень в лист. Ищем его и внутри, и снаружи — в jsdom
      // раскладка вырождается в один лист, и обёртка может отсутствовать.
      const root =
        (el.querySelector(".tb-report") as HTMLElement) ??
        (el.closest(".tb-report") as HTMLElement) ??
        el;
      captured.push({
        rootClass: root.className,
        childTags: [...root.children].map((c) => c.tagName.toLowerCase()),
        html: root.innerHTML,
      });
      return {
        width: 595,
        height: 842,
        toDataURL: () => "data:image/png;base64,AAAA",
      };
    }),
    jsPDF: class {
      internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
      addImage() {}
      addPage() {}
      link() {}
      save() {}
      output() {
        return "blob";
      }
    },
  } as unknown as Parameters<typeof exportReportPdf>[2];
}

const SHELL = '<div class="tb-report"></div>';

function block(over: Partial<ReportBlockToRender> = {}): ReportBlockToRender {
  return {
    block: "header",
    nature: "system",
    enabled: true,
    layoutFile: "header.html",
    layout: '<section class="tb-report__card" id="b-header"></section>',
    placeholders: [],
    values: {},
    settings: {},
    ...over,
  };
}

describe("конвейер PDF и документ из блоков", () => {
  it("печатает блоки прямыми детьми корня документа", async () => {
    const captured: Captured[] = [];
    const page: ReportPage = {
      layout: "",
      context: {},
      shell: SHELL,
      blocks: [block(), block({ block: "topics", layout: '<section id="b-topics"></section>' })],
    };
    await exportReportPdf(page, "Тест", makeDeps(captured));
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0].rootClass).toContain("tb-report");
    expect(captured[0].childTags).toEqual(["section", "section"]);
  });

  it("страница без блоков печатается прежним путём — цельной раскладкой", async () => {
    const captured: Captured[] = [];
    const page: ReportPage = {
      layout: '<div class="tb-report"><section id="legacy"></section></div>',
      context: {},
    };
    await exportReportPdf(page, "Тест", makeDeps(captured));
    expect(captured[0].html).toContain('id="legacy"');
  });

  it("отсутствие и раскладки, и оболочки — отказ, а не пустой документ", async () => {
    await expect(
      exportReportPdf({ layout: "", context: {} }, "Тест", makeDeps([])),
    ).rejects.toThrow();
  });
});
