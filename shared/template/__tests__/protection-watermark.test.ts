import { describe, it, expect } from "vitest";
import { applyWatermark } from "../protection/watermark";

const TEXT = "ID 7f3ac2 · 02.08.2026 14:35";

/** Макет, ОБЪЯВИВШИЙ якорь в строке подсказки. */
function sceneWithAnchor(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML =
    '<div class="scene"><header>шапка</header><div class="col">' +
    '<div class="q"><h2 data-slot="question-text">Задание</h2>' +
    '<div class="meta"><span>Выберите один вариант</span>' +
    '<div data-slot="protection-mark"></div></div></div>' +
    '<div class="body"><div data-slot="question-interaction">варианты</div></div>' +
    "</div></div>";
  return root;
}

/** Произвольный макет, якорь не объявивший: двухколоночная раскладка. */
function sceneWithoutAnchor(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML =
    '<div class="scene"><header>шапка</header><div class="row" style="display:flex">' +
    '<div class="left"><h2 data-slot="question-text">Задание</h2></div>' +
    '<div class="right"><div data-slot="question-interaction">варианты</div></div>' +
    "</div></div>";
  return root;
}

describe("applyWatermark", () => {
  it("встаёт в объявленный макетом якорь", () => {
    const root = sceneWithAnchor();
    applyWatermark(root, TEXT);
    const anchor = root.querySelector('[data-slot="protection-mark"]')!;
    const mark = anchor.querySelector<HTMLElement>(".tb-protection-mark")!;
    expect(mark.textContent).toBe(TEXT);
    expect(mark.getAttribute("aria-hidden")).toBe("true");
  });

  it("без якоря встаёт строкой в начало сцены и раскладку не трогает", () => {
    const root = sceneWithoutAnchor();
    applyWatermark(root, TEXT);
    const scene = root.firstElementChild!;
    expect(scene.firstElementChild!.className).toContain("tb-protection-mark");
    // Двухколоночная строка не получила третьей колонки.
    expect(root.querySelector(".row")!.children.length).toBe(2);
  });

  it("повторный вызов не задваивает знак", () => {
    const root = sceneWithAnchor();
    applyWatermark(root, "A");
    applyWatermark(root, "B");
    expect(root.querySelectorAll(".tb-protection-mark").length).toBe(1);
    expect(root.querySelector(".tb-protection-mark")!.textContent).toBe("B");
  });

  it("null снимает знак", () => {
    const root = sceneWithAnchor();
    applyWatermark(root, "A");
    applyWatermark(root, null);
    expect(root.querySelector(".tb-protection-mark")).toBeNull();
  });
});
