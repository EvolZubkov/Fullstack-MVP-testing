import { describe, it, expect } from "vitest";
import {
  resolveBlockOrder,
  templateBlockOrder,
  DEFAULT_BLOCK_ORDER,
  type ResultsBlockKey,
  type TemplateBlockOrder,
} from "../results-order";

describe("resolveBlockOrder", () => {
  it("falls back to the template order when the test stored nothing", () => {
    expect(resolveBlockOrder(undefined, DEFAULT_BLOCK_ORDER)).toEqual([
      "summary",
      "scales",
      "indicators",
      "topics",
      "breakdown",
    ]);
  });

  it("keeps the author's order", () => {
    const saved: ResultsBlockKey[] = ["topics", "scales", "indicators", "summary", "breakdown"];
    expect(resolveBlockOrder(saved, DEFAULT_BLOCK_ORDER)).toEqual(saved);
  });

  it("appends a key the saved order does not mention, in template order", () => {
    // PRD-50 FR-28: this is how the block reaches a test saved before it existed — the
    // author's four keys stay put and `breakdown` lands at the end of the template's list.
    expect(resolveBlockOrder(["topics", "scales"], DEFAULT_BLOCK_ORDER)).toEqual([
      "topics",
      "scales",
      "summary",
      "indicators",
      "breakdown",
    ]);
  });

  it("drops an unknown key", () => {
    expect(resolveBlockOrder(["topics", "legacy" as ResultsBlockKey], DEFAULT_BLOCK_ORDER)).toEqual([
      "topics",
      "summary",
      "scales",
      "indicators",
      "breakdown",
    ]);
  });

  it("drops a duplicate", () => {
    expect(resolveBlockOrder(["topics", "topics"], DEFAULT_BLOCK_ORDER)).toEqual([
      "topics",
      "summary",
      "scales",
      "indicators",
      "breakdown",
    ]);
  });

  it("шаблон без ключа `breakdown` не получает его ни при каком сохранённом порядке (FR-30)", () => {
    // Сторонний шаблон реестра PRD-3 объявляет состав БЕЗ разреза — автор мог сохранить
    // порядок на другом шаблоне, и ключ обязан отсеяться, а не «поехать» в чужой макет.
    expect(resolveBlockOrder(["breakdown", "topics"], ["summary", "topics"])).toEqual([
      "topics",
      "summary",
    ]);
  });
});

describe("templateBlockOrder", () => {
  const DECLARED: TemplateBlockOrder = {
    default: ["summary", "scales", "indicators", "topics"],
    "results.adaptive": ["topics", "scales", "indicators"],
  };

  it("gives a screen its own list — composition included", () => {
    // No `summary` in the list IS «this screen never printed a score summary».
    expect(templateBlockOrder(DECLARED, "results.adaptive")).toEqual(["topics", "scales", "indicators"]);
  });

  it("falls back to the template's shared list for a screen with none of its own", () => {
    expect(templateBlockOrder(DECLARED, "results")).toEqual(["summary", "scales", "indicators", "topics"]);
  });

  it("reads a flat array as the template's shared list", () => {
    expect(templateBlockOrder(["topics", "summary"], "results.adaptive")).toEqual(["topics", "summary"]);
  });

  it("falls back to the shipped order when the template declares nothing", () => {
    expect(templateBlockOrder(undefined, "results")).toEqual(DEFAULT_BLOCK_ORDER);
    expect(templateBlockOrder(null, "results")).toEqual(DEFAULT_BLOCK_ORDER);
    expect(templateBlockOrder({}, "results")).toEqual(DEFAULT_BLOCK_ORDER);
  });

  it("drops an unknown key but keeps the rest of the declaration", () => {
    const declared = { default: ["topics", "legacy", "summary"] } as unknown as TemplateBlockOrder;
    expect(templateBlockOrder(declared, "results")).toEqual(["topics", "summary"]);
  });

  it("honours a declaration that cleans out empty instead of resurrecting the shipped one", () => {
    // Whatever the template meant, it did NOT mean «print the four blocks I removed».
    const declared = { "results.adaptive": ["legacy"] } as unknown as TemplateBlockOrder;
    expect(templateBlockOrder(declared, "results.adaptive")).toEqual([]);
  });

  it("ignores a declaration of the wrong shape for the screen", () => {
    const declared = { "results.adaptive": "topics" } as unknown as TemplateBlockOrder;
    expect(templateBlockOrder(declared, "results.adaptive")).toEqual(DEFAULT_BLOCK_ORDER);
  });

  it("the shipping «Стандартный» manifest describes both of its results screens", async () => {
    // The declaration is the ONLY thing standing between the loop-driven layouts and a
    // silent reorder of every already-built test, so it is checked against the real file.
    const manifest = (await import("../../../server/scorm/templates/default/manifest.json")).default as {
      resultsBlockOrder: TemplateBlockOrder;
    };
    expect(templateBlockOrder(manifest.resultsBlockOrder, "results")).toEqual([
      "summary",
      "scales",
      "indicators",
      "topics",
      "breakdown",
    ]);
    expect(templateBlockOrder(manifest.resultsBlockOrder, "results.adaptive")).toEqual([
      "topics",
      "scales",
      "indicators",
      "breakdown",
    ]);
  });
});
