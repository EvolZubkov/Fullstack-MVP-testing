/**
 * @module tests/summary-contract
 * @description Плагин 6.3: summary — граница РЕЗУЛЬТАТОВ (системный узел потока), а не
 * произвольная информационная страница. Его контракт строго `title + result`: ничего
 * лишнего (ни тега, ни абзаца-описания). Гард на манифест-шаблон `summary.result`, чтобы
 * контракт не расползся; `result` — виджет по `defaultRenderer` (кольцо/число/полоса).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../server/scorm/templates/default/manifest.json"), "utf8"),
) as { contentTemplates?: Array<{ key?: string; kind?: string; placeholders?: Array<{ key: string; type: string; defaultRenderer?: string }> }> };

describe("summary.result — contract (plan 6.3)", () => {
  const summary = (manifest.contentTemplates ?? []).find((c) => c.key === "summary.result");

  it("exists and is a summary boundary node", () => {
    expect(summary).toBeTruthy();
    expect(summary!.kind).toBe("summary");
  });

  it("declares EXACTLY title + result — no extra nodes", () => {
    const keys = (summary!.placeholders ?? []).map((p) => p.key).sort();
    expect(keys).toEqual(["result", "title"]);
  });

  it("result is a resultField widget with a core renderer default", () => {
    const result = (summary!.placeholders ?? []).find((p) => p.key === "result")!;
    expect(result.type).toBe("resultField");
    expect(result.defaultRenderer).toMatch(/^core\.(ringChart|textMetric|progressBar)$/);
    const title = (summary!.placeholders ?? []).find((p) => p.key === "title")!;
    expect(title.type).toBe("text");
  });
});
