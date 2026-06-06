// @vitest-environment jsdom
/**
 * @module tests/render-screen-content
 *
 * jsdom verification of the content-page render path (PRD-12): the unified
 * renderer fills `data-placeholder` regions from a content template's values —
 * plain placeholders by type (escaped text / raw richText / image) and
 * `resultField` placeholders drawn via the renderer registry (renderers.ts) with
 * the value resolved from the public context. Proves all content-page screen
 * kinds render headless before the renderer is bundled / mounted in a host.
 */

import { describe, it, expect } from "vitest";
import { renderScreenInto, type ContentPageData } from "../shared/template/render-screen";

const layout = `
  <div class="content-page">
    <h1 data-placeholder="title"></h1>
    <div class="body" data-placeholder="body"></div>
    <div class="pic" data-placeholder="pic"></div>
    <div class="metric" data-placeholder="score"></div>
  </div>
`;

const content: ContentPageData = {
  template: {
    placeholders: [
      { key: "title", type: "text" },
      { key: "body", type: "richText" },
      { key: "pic", type: "image" },
      {
        key: "score",
        type: "resultField",
        allowedRenderers: ["core.progressBar"],
        allowedPaths: ["result.scorePercent"],
      },
    ],
  },
  values: {
    title: "Итог <b>раздела</b>",
    body: "<p>Богатый <em>текст</em></p>",
    pic: "assets/media/pic.png",
    score: {
      path: "result.scorePercent",
      renderer: "core.progressBar",
      rendererOptions: { showValue: true },
      label: "Прогресс",
    },
  },
};

const context = { result: { scorePercent: 60 } };

describe("renderScreenInto — content-page placeholders", () => {
  const root = document.createElement("div");
  renderScreenInto(root, { layout, context, content });

  it("escapes a text placeholder", () => {
    expect(root.querySelector('[data-placeholder="title"]')?.innerHTML).toBe("Итог &lt;b&gt;раздела&lt;/b&gt;");
  });

  it("passes richText through as raw HTML", () => {
    expect(root.querySelector('[data-placeholder="body"]')?.innerHTML).toBe("<p>Богатый <em>текст</em></p>");
  });

  it("renders an image placeholder as an <img>", () => {
    const img = root.querySelector('[data-placeholder="pic"] img');
    expect(img?.getAttribute("src")).toBe("assets/media/pic.png");
  });

  it("draws a resultField via the renderer registry with the path-resolved value", () => {
    const cell = root.querySelector('[data-placeholder="score"]');
    expect(cell?.querySelector(".renderer--progress-bar")).not.toBeNull();
    expect(cell?.innerHTML).toContain("width:60.00%");
    expect(cell?.textContent).toContain("60%"); // showValue
    expect(cell?.textContent).toContain("Прогресс"); // label
  });

  it("falls back to an empty value when the resultField path is not allowed", () => {
    const r2 = document.createElement("div");
    renderScreenInto(r2, {
      layout: '<div data-placeholder="s"></div>',
      context: { result: { scorePercent: 60 } },
      content: {
        template: { placeholders: [{ key: "s", type: "resultField", allowedPaths: ["result.scorePercent"] }] },
        values: { s: { path: "secret.value", renderer: "core.textMetric" } },
      },
    });
    // path "secret.value" not in allowedPaths -> textMetric with null -> "—"
    expect(r2.querySelector('[data-placeholder="s"]')?.textContent).toContain("—");
  });
});
