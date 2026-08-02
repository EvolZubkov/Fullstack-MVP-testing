import { describe, it, expect } from "vitest";
import { renderScreenInto } from "../render-screen";
import { buildProtectionSpec } from "../protection/spec";
import { PROTECTED_ATTR } from "../protection/apply";

const LAYOUT = '<div class="tb-scene"><h2 data-slot="question-text"></h2></div>';
const ON = { copyProtection: true, watermark: false, hideOnBlur: false };

describe("renderScreenInto + protection", () => {
  it("применяет защиту к слоту после его заполнения", () => {
    const root = document.createElement("div");
    renderScreenInto(root, {
      layout: LAYOUT,
      context: {},
      slots: { "question-text": "<b>Текст</b>" },
      protection: buildProtectionSpec({ screen: "question", settings: ON, stamp: null }),
    });
    const slot = root.querySelector<HTMLElement>('[data-slot="question-text"]')!;
    expect(slot.innerHTML).toBe("<b>Текст</b>");
    expect(slot.hasAttribute(PROTECTED_ATTR)).toBe(true);
  });

  it("без поля protection ничего не помечает", () => {
    const root = document.createElement("div");
    renderScreenInto(root, { layout: LAYOUT, context: {}, slots: { "question-text": "т" } });
    expect(root.querySelector("[" + PROTECTED_ATTR + "]")).toBeNull();
  });
});
