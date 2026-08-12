// @vitest-environment jsdom
/**
 * @module tests/results-indicator-card
 *
 * PRD-29: the indicator card on the results screen (`{{#each result.indicators}}` in
 * `results.html`). The card is a fixed composition of four slots — name, value, level,
 * explanation — and an indicator can legitimately fill only some of them: a NUMERIC
 * indicator («Отрыв ведущего стиля») usually carries no interpretation bands, so it has
 * a value and no level, while a STRING one carries a level and no separate value.
 *
 * The defect these tests lock: the card drew the level slot only. A numeric indicator
 * therefore rendered as an empty banner — a coloured chip with nothing in it — next to
 * string indicators that printed fine, while its value was computed and stored all along.
 *
 * Rendered through the REAL layout of every shipped design template (parity is kept by
 * hand), so a template that never got the value slot cannot pass on the sibling's markup.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderScreenInto } from "../shared/template/render-screen";
import { buildMeasureView } from "../shared/template/measure-view";
import { LEVEL_SCHEMES } from "../shared/template/level-ramp";

const layouts: Array<[string, string]> = [
  ["default", fs.readFileSync(
    path.join(process.cwd(), "server", "scorm", "templates", "default", "layouts", "results.html"), "utf8")],
  ["certification", fs.readFileSync(
    path.join(process.cwd(), "templates", "certification", "layouts", "results.html"), "utf8")],
];

/** A numeric indicator with no bands: the author's computed number, nothing to interpret. */
const numeric = buildMeasureView({
  key: "lead_gap",
  name: "Отрыв ведущего стиля",
  value: 18,
  visibility: "level_and_value",
  interpretation: { domainMin: null, domainMax: null, valence: "none", bands: [], outcomes: [] },
  requestedKind: "label",
  ramp: LEVEL_SCHEMES.traffic,
});

/** A string indicator: the outcome label IS the reading — the case that always worked. */
const textual = buildMeasureView({
  key: "burnout_level",
  name: "Состояние",
  value: "growing",
  visibility: "level_and_value",
  interpretation: {
    domainMin: null,
    domainMax: null,
    valence: "none",
    bands: [],
    outcomes: [{ code: "growing", label: "Возрастающее истощение", tone: "attention" }],
  },
  requestedKind: "label",
  ramp: LEVEL_SCHEMES.traffic,
});

function render(layout: string, indicators: unknown[]): HTMLElement {
  const root = document.createElement("div");
  renderScreenInto(root, {
    layout,
    context: {
      course: { title: "Опросник" },
      result: {
        passed: false,
        passClass: "",
        statusLabel: "",
        scorePercent: 0,
        ringDashoffset: 0,
        totalQuestions: 22,
        correct: 0,
        earnedPoints: 0,
        possiblePoints: 0,
        hideScoreSummary: true,
        topicResults: [],
        indicators,
      },
    },
  });
  return root;
}

describe.each(layouts)("results.html (%s) — карточка показателя", (_name, layout) => {
  it("числовой показатель печатает значение", () => {
    const card = render(layout, [numeric]).querySelector(".tb-measure");
    expect(card?.textContent).toContain("Отрыв ведущего стиля");
    expect(card?.textContent).toContain("18");
  });

  it("без уровня пустой пилюли не остаётся", () => {
    // Толковать нечем: полос интерпретации у показателя нет. Пустой баннер выглядел
    // сломанным рендером — ровно тем, чем он и был.
    const card = render(layout, [numeric]).querySelector(".tb-measure");
    const banner = card?.querySelector(".ou-banner");
    expect(banner).toBeNull();
  });

  it("строковый показатель по-прежнему печатает исход баннером", () => {
    const card = render(layout, [textual]).querySelector(".tb-measure");
    expect(card?.querySelector(".ou-banner__title")?.textContent).toBe("Возрастающее истощение");
    expect(card?.querySelector(".ou-banner")?.className).toContain("ou-banner--warning");
  });

  it("два показателя рядом: у числового значение, у строкового исход", () => {
    // Именно эта пара и разошлась в приёмке: строковые карточки читались, числовые
    // стояли пустыми.
    const cards = render(layout, [numeric, textual]).querySelectorAll(".tb-measure");
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain("18");
    expect(cards[1].textContent).toContain("Возрастающее истощение");
  });
});
