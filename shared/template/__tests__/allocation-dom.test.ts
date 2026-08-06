/**
 * @module shared/template/__tests__/allocation-dom
 *
 * Live input of the allocation group (PRD-44 §6) on a real DOM.
 *
 * The property that matters most here is the one a snapshot cannot show: a drag patches
 * the group IN PLACE and commits only when the finger lifts. The DS slider is a div with
 * pointer handlers, and both hosts paint the scene by writing HTML into a slot — commit on
 * every pointermove and the host re-render would replace the node being held, killing the
 * gesture on the first pixel. So the tests assert node IDENTITY across a drag, not just
 * the numbers.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { renderAllocation } from "../question-interaction";
import { attachAllocation, syncAllocationDom, allocIndexOf } from "../allocation-dom";
import { allocationSpec } from "../../questions/allocation";

const SPEC = allocationSpec({ options: ["А", "Б", "В", "Г"], budget: 7, minPerOption: 0, maxPerOption: 7 });
const QUESTION = { type: "allocation", dataJson: { options: ["А", "Б", "В", "Г"], budget: 7, minPerOption: 0, maxPerOption: 7 } };

let root: HTMLElement;

/** Mount a rendered group and give its rails a measurable width (jsdom has none). */
function mount(answer: unknown): HTMLElement {
  document.body.innerHTML = `<div id="host">${renderAllocation(QUESTION, answer)}</div>`;
  const host = document.getElementById("host") as HTMLElement;
  host.querySelectorAll(".ou-slider__rail").forEach((rail) => {
    (rail as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, width: 700, top: 0, height: 6, right: 700, bottom: 6, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  });
  return host;
}

const rowOf = (index: number) => root.querySelector(`.ou-alloc__row[data-index="${index}"]`) as HTMLElement;
const thumbOf = (index: number) => rowOf(index).querySelector(".ou-slider__thumb") as HTMLElement;
const inputOf = (index: number) => rowOf(index).querySelector(".ou-number__input") as HTMLInputElement;
const counterText = () => (root.querySelector(".ou-alloc__counter") as HTMLElement).textContent ?? "";

beforeEach(() => {
  root = mount({});
});

describe("syncAllocationDom", () => {
  it("обновляет значения, не заменяя узлы", () => {
    const before = thumbOf(0);
    syncAllocationDom(root as never, SPEC, { 0: 3, 1: 1, 2: 0, 3: 0 });
    expect(thumbOf(0)).toBe(before); // тот же узел, а не новый
    expect(thumbOf(0).getAttribute("aria-valuenow")).toBe("3");
    expect(inputOf(0).value).toBe("3");
  });

  it("пересчитывает подвижный потолок каждой строки", () => {
    syncAllocationDom(root as never, SPEC, { 0: 3, 1: 1, 2: 0, 3: 0 });
    // Остаток 3: строка со значением 3 доходит до 6, нулевая — до 3.
    expect(thumbOf(0).getAttribute("aria-valuemax")).toBe("6");
    expect(thumbOf(2).getAttribute("aria-valuemax")).toBe("3");
  });

  it("обновляет счётчик остатка по ходу, а не после", () => {
    syncAllocationDom(root as never, SPEC, { 0: 3, 1: 1, 2: 0, 3: 0 });
    expect(counterText()).toContain("Осталось");
    expect(counterText()).toContain("3");
    syncAllocationDom(root as never, SPEC, { 0: 3, 1: 1, 2: 1, 3: 2 });
    expect(counterText()).toContain("Вы использовали все баллы");
  });

  it("гасит степпер на границах строки", () => {
    syncAllocationDom(root as never, SPEC, { 0: 0, 1: 0, 2: 0, 3: 7 });
    const [minus, plus] = Array.from(rowOf(0).querySelectorAll(".ou-number__btn")) as HTMLButtonElement[];
    expect(minus.disabled).toBe(true); // уже на минимуме
    expect(plus.disabled).toBe(true); // остаток исчерпан соседней строкой
  });

  it("отмечает строку выше минимума, а не просто ненулевую", () => {
    syncAllocationDom(root as never, SPEC, { 0: 2, 1: 0, 2: 0, 3: 0 });
    expect(rowOf(0).classList.contains("is-weighted")).toBe(true);
    expect(rowOf(1).classList.contains("is-weighted")).toBe(false);
  });
});

describe("attachAllocation — жест перетаскивания", () => {
  let answer: Record<string, number>;
  let commits: Record<string, number>[];

  beforeEach(() => {
    answer = {};
    commits = [];
    attachAllocation(root as never, {
      getSpec: () => SPEC,
      getAnswer: () => answer,
      onCommit: (next) => {
        commits.push(next);
        answer = next;
      },
    });
  });

  const pointer = (type: string, target: Element, clientX: number) => {
    const e = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent & { clientX: number };
    Object.defineProperty(e, "clientX", { value: clientX });
    target.dispatchEvent(e);
  };

  it("во время жеста DOM обновляется, а хост не трогается", () => {
    const rail = rowOf(0).querySelector(".ou-slider__rail") as HTMLElement;
    pointer("pointerdown", rail, 300); // ~3 из 7
    pointer("pointermove", rail, 400);
    expect(inputOf(0).value).toBe("4");
    expect(commits).toHaveLength(0); // хост ещё ничего не знает
  });

  it("узлы переживают жест — иначе он рвётся на первом же пикселе", () => {
    const rail = rowOf(0).querySelector(".ou-slider__rail") as HTMLElement;
    const thumb = thumbOf(0);
    pointer("pointerdown", rail, 100);
    pointer("pointermove", rail, 200);
    pointer("pointermove", rail, 500);
    expect(thumbOf(0)).toBe(thumb);
  });

  it("ответ отдаётся хосту ОДИН раз, по завершении жеста", () => {
    const rail = rowOf(0).querySelector(".ou-slider__rail") as HTMLElement;
    pointer("pointerdown", rail, 100);
    pointer("pointermove", rail, 300);
    pointer("pointerup", rail, 300);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual({ 0: 3, 1: 0, 2: 0, 3: 0 });
  });

  it("перебор невозможен: жест упирается в остаток", () => {
    answer = { 0: 0, 1: 5, 2: 0, 3: 0 };
    syncAllocationDom(root as never, SPEC, answer);
    const rail = rowOf(0).querySelector(".ou-slider__rail") as HTMLElement;
    pointer("pointerdown", rail, 700); // тянем на самый край
    pointer("pointerup", rail, 700);
    expect(commits[0][0]).toBe(2); // 7 - 5, а не 7
  });
});

describe("attachAllocation — дискретный ввод", () => {
  let answer: Record<string, number>;
  let commits: Record<string, number>[];

  beforeEach(() => {
    answer = { 0: 2, 1: 1, 2: 0, 3: 0 };
    commits = [];
    root = mount(answer);
    attachAllocation(root as never, {
      getSpec: () => SPEC,
      getAnswer: () => answer,
      onCommit: (next) => {
        commits.push(next);
        answer = next;
      },
    });
  });

  it("степпер меняет значение и сразу отдаёт ответ", () => {
    const plus = rowOf(0).querySelectorAll(".ou-number__btn")[1] as HTMLButtonElement;
    plus.click();
    expect(commits).toHaveLength(1);
    expect(commits[0][0]).toBe(3);
  });

  it("ввод числа срезается по остатку, а не отвергается", () => {
    const input = inputOf(2);
    input.value = "99";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(commits[0][2]).toBe(4); // остаток 7 - 2 - 1 = 4
  });

  it("нечисловой ввод не ломает ответ", () => {
    const input = inputOf(2);
    input.value = "абв";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(commits[0][2]).toBe(0);
  });

  it("клавиатура: стрелки, Home и End", () => {
    const key = (k: string) => {
      thumbOf(0).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    };
    key("ArrowRight");
    expect(commits[0][0]).toBe(3);
    key("Home");
    expect(commits[1][0]).toBe(0);
    key("End");
    expect(commits[2][0]).toBe(6); // минимум 0 + остаток 6 после соседней единицы
  });

  it("заблокированный вопрос не принимает ввод", () => {
    document.body.innerHTML = "";
    root = mount(answer);
    commits = [];
    attachAllocation(root as never, {
      getSpec: () => SPEC,
      getAnswer: () => answer,
      onCommit: (next) => commits.push(next),
      isLocked: () => true,
    });
    (rowOf(0).querySelectorAll(".ou-number__btn")[1] as HTMLButtonElement).click();
    expect(commits).toHaveLength(0);
  });
});

describe("allocIndexOf", () => {
  it("читает индекс утверждения с элемента", () => {
    expect(allocIndexOf(thumbOf(2) as never)).toBe(2);
  });

  it("возвращает null на чужом элементе", () => {
    expect(allocIndexOf(rowOf(0) as never)).toBeNull();
    expect(allocIndexOf(null)).toBeNull();
  });
});
