import { describe, it, expect } from "vitest";
import { resolveBlockOrder, DEFAULT_BLOCK_ORDER, type ResultsBlockKey } from "../results-order";

describe("resolveBlockOrder", () => {
  it("falls back to the template order when the test stored nothing", () => {
    expect(resolveBlockOrder(undefined, DEFAULT_BLOCK_ORDER)).toEqual([
      "summary",
      "scales",
      "indicators",
      "topics",
    ]);
  });

  it("keeps the author's order", () => {
    const saved: ResultsBlockKey[] = ["topics", "scales", "indicators", "summary"];
    expect(resolveBlockOrder(saved, DEFAULT_BLOCK_ORDER)).toEqual(saved);
  });

  it("appends a key the saved order does not mention, in template order", () => {
    expect(resolveBlockOrder(["topics", "scales"], DEFAULT_BLOCK_ORDER)).toEqual([
      "topics",
      "scales",
      "summary",
      "indicators",
    ]);
  });

  it("drops an unknown key", () => {
    expect(resolveBlockOrder(["topics", "legacy" as ResultsBlockKey], DEFAULT_BLOCK_ORDER)).toEqual([
      "topics",
      "summary",
      "scales",
      "indicators",
    ]);
  });

  it("drops a duplicate", () => {
    expect(resolveBlockOrder(["topics", "topics"], DEFAULT_BLOCK_ORDER)).toEqual([
      "topics",
      "summary",
      "scales",
      "indicators",
    ]);
  });
});
