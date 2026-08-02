import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { attachBlurGuard } from "../protection/blur-guard";
import { QUESTION_REGIONS } from "../protection/spec";

const TARGET = { selectors: [...QUESTION_REGIONS], wholeScene: false };

function scene(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = '<h2 data-slot="question-text">Текст</h2>';
  document.body.innerHTML = "";
  document.body.appendChild(root);
  return root;
}

function setHidden(value: boolean): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (value ? "hidden" : "visible"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("attachBlurGuard", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  it("скрывает задание при уходе со вкладки немедленно", () => {
    const root = scene();
    attachBlurGuard(root, TARGET);
    setHidden(true);
    expect(root.querySelector(".tb-protection-veil")).not.toBeNull();
  });

  it("возврат видимости снимает заглушку сам, без действий участника", () => {
    const root = scene();
    attachBlurGuard(root, TARGET);
    setHidden(true);
    setHidden(false);
    expect(root.querySelector(".tb-protection-veil")).toBeNull();
  });

  it("возврат фокуса окну тоже снимает заглушку немедленно", () => {
    const root = scene();
    attachBlurGuard(root, TARGET);
    window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(400);
    expect(root.querySelector(".tb-protection-veil")).not.toBeNull();
    window.dispatchEvent(new Event("focus"));
    expect(root.querySelector(".tb-protection-veil")).toBeNull();
  });

  it("мгновенный возврат фокуса не скрывает ничего", () => {
    const root = scene();
    attachBlurGuard(root, TARGET);
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(1000);
    expect(root.querySelector(".tb-protection-veil")).toBeNull();
  });

  it("заглушка не содержит кнопки: возврат автоматический", () => {
    const root = scene();
    attachBlurGuard(root, TARGET);
    setHidden(true);
    const veil = root.querySelector(".tb-protection-veil")!;
    expect(veil.querySelector("button")).toBeNull();
    expect(veil.textContent).toContain("Задание скрыто");
  });

  it("сообщение печатается ОДИН раз, на самом крупном закрытом регионе", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<h2 data-slot="question-text">Текст</h2>' +
      '<div data-slot="question-interaction">варианты</div>';
    document.body.innerHTML = "";
    document.body.appendChild(root);
    const title = root.querySelector<HTMLElement>('[data-slot="question-text"]')!;
    const opts = root.querySelector<HTMLElement>('[data-slot="question-interaction"]')!;
    title.getBoundingClientRect = () => ({ width: 600, height: 30 }) as DOMRect;
    opts.getBoundingClientRect = () => ({ width: 600, height: 400 }) as DOMRect;

    attachBlurGuard(root, TARGET);
    setHidden(true);

    const veils = root.querySelectorAll(".tb-protection-veil");
    expect(veils.length).toBe(2);
    const withText = [...veils].filter((v) => v.textContent!.includes("Задание скрыто"));
    expect(withText.length).toBe(1);
    // Именно на крупном регионе, а не на короткой полоске заголовка.
    expect(opts.contains(withText[0])).toBe(true);
  });

  it("отсоединение снимает слушатели", () => {
    const root = scene();
    const detach = attachBlurGuard(root, TARGET);
    detach();
    setHidden(true);
    expect(root.querySelector(".tb-protection-veil")).toBeNull();
  });

  it("без цели не вешает ничего", () => {
    const root = scene();
    attachBlurGuard(root, null);
    setHidden(true);
    expect(root.querySelector(".tb-protection-veil")).toBeNull();
  });
});
