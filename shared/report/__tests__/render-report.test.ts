/**
 * @module shared/report/__tests__/render-report
 *
 * PRD-51 §5.2 — СБОРКА ДОКУМЕНТА в DOM.
 *
 * Главная проверка здесь — первая: блоки обязаны стать ПРЯМЫМИ детьми корня. По ним
 * режет постраничная раскладка (`paginate-dom` меряет `root.children`), и промежуточный
 * контейнер превратил бы многостраничный документ в один неделимый переросток, который
 * дорезается растром. Свойство держится устройством — вставку делает движок, — и тест
 * стоит на страже именно устройства.
 *
 * Среда jsdom берётся из общего `vitest.config.ts`.
 */
import { describe, expect, it } from "vitest";
import { renderReportInto, type ReportBlockToRender } from "../render-report";

const SHELL = '<div class="tb-report"></div>';
const HEADER = '<section class="tb-report__card"><h1 data-path="course.title"></h1></section>';
const PAGE = '<section class="tb-report__card"><div data-placeholder="body"></div></section>';

const ctx = { course: { title: "Тест руководителя" } };

/** Блок к печати: меняется только то, что важно проверке. */
function block(over: Partial<ReportBlockToRender> = {}): ReportBlockToRender {
  return {
    block: "header",
    nature: "system",
    enabled: true,
    layoutFile: "header.html",
    layout: HEADER,
    placeholders: [],
    values: {},
    settings: {},
    ...over,
  };
}

function stage(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("сборка документа отчёта", () => {
  it("кладёт блоки ПРЯМЫМИ детьми корня", () => {
    const el = stage();
    renderReportInto(el, {
      shell: SHELL,
      context: ctx,
      blocks: [block(), block({ block: "topics" })],
    });
    const root = el.firstElementChild as HTMLElement;
    expect(root.className).toBe("tb-report");
    expect(root.children).toHaveLength(2);
    expect(root.children[0].tagName).toBe("SECTION");
  });

  it("печатает контекст в блоке", () => {
    const el = stage();
    renderReportInto(el, { shell: SHELL, context: ctx, blocks: [block()] });
    expect(el.textContent).toContain("Тест руководителя");
  });

  it("заполняет области содержимого страницы", () => {
    const el = stage();
    renderReportInto(el, {
      shell: SHELL,
      context: ctx,
      blocks: [
        block({
          block: "page",
          nature: "page",
          layout: PAGE,
          placeholders: [{ key: "body", type: "richText" }],
          values: { body: "<p>Про тест</p>" },
        }),
      ],
    });
    expect(el.innerHTML).toContain("Про тест");
  });

  it("выключенный блок не печатается вовсе", () => {
    const el = stage();
    renderReportInto(el, { shell: SHELL, context: ctx, blocks: [block({ enabled: false })] });
    expect((el.firstElementChild as HTMLElement).children).toHaveLength(0);
  });

  it("разрыв листа печатается узлом data-page-break", () => {
    const el = stage();
    renderReportInto(el, {
      shell: SHELL,
      context: ctx,
      blocks: [block({ block: "page-break", nature: "page-break", layoutFile: "", layout: "" })],
    });
    expect(el.querySelectorAll("[data-page-break]")).toHaveLength(1);
  });

  it("блок, не давший видимых узлов, не оставляет следа", () => {
    const el = stage();
    renderReportInto(el, {
      shell: SHELL,
      context: ctx,
      blocks: [
        block({
          block: "scales",
          layout: "{{#if result.scales}}<section>шкалы</section>{{/if}}",
        }),
      ],
    });
    expect((el.firstElementChild as HTMLElement).children).toHaveLength(0);
  });

  it("сохраняет порядок блоков", () => {
    const el = stage();
    renderReportInto(el, {
      shell: SHELL,
      context: ctx,
      blocks: [
        block({ block: "a", layout: '<section id="a"></section>' }),
        block({ block: "brk", nature: "page-break", layout: "" }),
        block({ block: "b", layout: '<section id="b"></section>' }),
      ],
    });
    const root = el.firstElementChild as HTMLElement;
    expect([...root.children].map((c) => c.id || (c.getAttribute("data-page-break") ?? ""))).toEqual([
      "a",
      "",
      "b",
    ]);
  });

  it("отказывается печатать, когда оболочка ничего не отрисовала", () => {
    const el = stage();
    expect(() => renderReportInto(el, { shell: "", context: ctx, blocks: [block()] })).toThrow(
      /оболочк/i,
    );
  });
});
