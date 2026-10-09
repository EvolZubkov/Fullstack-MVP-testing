import { describe, expect, it } from "vitest";

import { applyBaseline, diffInventories } from "../../scripts/check/editor-conformance/diff.mjs";

type Item = { role: string; text: string; variant?: string };

const WIREFRAME: Item[] = [
  { role: "heading", text: "О тесте" },
  { role: "label", text: "Название *" },
  { role: "label", text: "Описание" },
];

const IMPLEMENTATION: Item[] = [
  { role: "label", text: "Название *" },
  { role: "label", text: "Описание" },
];

describe("diffInventories", () => {
  it("сообщает о пропавшем заголовке раздела", () => {
    expect(diffInventories(WIREFRAME, IMPLEMENTATION)).toEqual([
      { op: "missing", role: "heading", text: "О тесте", index: 0 },
    ]);
  });

  it("сообщает о лишнем элементе", () => {
    const extra = [...WIREFRAME, { role: "hint", text: "Оставьте пустым" }];

    expect(diffInventories(WIREFRAME, extra)).toEqual([
      { op: "extra", role: "hint", text: "Оставьте пустым", index: 3 },
    ]);
  });

  it("различает элементы по варианту кнопки, а не только по подписи", () => {
    const wf = [{ role: "button", text: "Отменить", variant: "secondary" }];
    const impl = [{ role: "button", text: "Отменить", variant: "ghost" }];

    const ops = diffInventories(wf, impl).map((d) => d.op);
    expect(ops).toEqual(["missing", "extra"]);
  });

  it("замечает переставленные элементы", () => {
    const swapped = [WIREFRAME[0], WIREFRAME[2], WIREFRAME[1]];

    expect(diffInventories(WIREFRAME, swapped).some((d) => d.op === "order")).toBe(true);
  });

  it("молчит на совпадающих описях", () => {
    expect(diffInventories(WIREFRAME, [...WIREFRAME])).toEqual([]);
  });

  it("считает пустую опись реализации полным отсутствием, а не совпадением", () => {
    expect(diffInventories(WIREFRAME, [])).toHaveLength(WIREFRAME.length);
  });
});

describe("applyBaseline", () => {
  const diff = () => diffInventories(WIREFRAME, IMPLEMENTATION);

  it("гасит известное расхождение", () => {
    const baseline = [{ op: "missing", role: "heading", text: "О тесте", finding: "A-3" }];

    expect(applyBaseline(diff(), baseline)).toEqual({ unexpected: [], stale: [] });
  });

  it("докладывает о расхождении вне базовой линии: это регрессия", () => {
    expect(applyBaseline(diff(), []).unexpected).toHaveLength(1);
  });

  it("докладывает об исчезнувшей записи базовой линии: это прогресс", () => {
    const baseline = [{ op: "missing", role: "heading", text: "Интеграция", finding: "A-4" }];

    const { stale } = applyBaseline([], baseline) as { stale: Array<{ finding: string }> };

    expect(stale.map((s) => s.finding)).toEqual(["A-4"]);
  });

  it("сопоставляет повторяющиеся записи один к одному, а не все к первой", () => {
    const twice = [
      { op: "missing", role: "label", text: "Порог", index: 0, state: "scoring" },
      { op: "missing", role: "label", text: "Порог", index: 7, state: "scoring" },
    ];
    const baseline = [
      { op: "missing", role: "label", text: "Порог", state: "scoring" },
      { op: "missing", role: "label", text: "Порог", state: "scoring" },
    ];

    expect(applyBaseline(twice, baseline)).toEqual({ unexpected: [], stale: [] });
  });

  it("сверяет записи по состоянию: одна и та же подпись на разных вкладках — разные записи", () => {
    const found = [{ op: "missing", role: "heading", text: "О тесте", index: 0, state: "basic" }];
    const baseline = [{ op: "missing", role: "heading", text: "О тесте", state: "rules", finding: "X-1" }];

    expect(applyBaseline(found, baseline).unexpected).toHaveLength(1);
  });
});
