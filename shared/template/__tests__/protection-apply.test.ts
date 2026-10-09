import { describe, it, expect, beforeEach } from "vitest";
import { applyProtection, PROTECTED_ATTR } from "../protection/apply";
import { QUESTION_REGIONS } from "../protection/spec";

function scene(): HTMLElement {
  document.head.innerHTML = "";
  const root = document.createElement("div");
  root.innerHTML =
    '<h2 data-slot="question-text">Текст задания</h2>' +
    '<div data-slot="question-interaction"><label>Вариант</label></div>' +
    "<footer><button type=\"button\">Далее</button></footer>";
  document.body.innerHTML = "";
  document.body.appendChild(root);
  return root;
}

const QUESTION_TARGET = { selectors: [...QUESTION_REGIONS], wholeScene: false };

describe("applyProtection", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = scene();
  });

  it("помечает регионы периметра и ставит инлайн-запрет выделения", () => {
    applyProtection(root, QUESTION_TARGET);
    const title = root.querySelector<HTMLElement>('[data-slot="question-text"]')!;
    expect(title.hasAttribute(PROTECTED_ATTR)).toBe(true);
    expect(title.style.userSelect).toBe("none");
  });

  it("не трогает то, что вне периметра", () => {
    applyProtection(root, QUESTION_TARGET);
    expect(root.querySelector("footer")!.hasAttribute(PROTECTED_ATTR)).toBe(false);
  });

  it("wholeScene помечает корень сцены", () => {
    applyProtection(root, { selectors: [], wholeScene: true });
    expect(root.hasAttribute(PROTECTED_ATTR)).toBe(true);
  });

  it("гасит copy внутри периметра и показывает предупреждение", () => {
    applyProtection(root, QUESTION_TARGET);
    const title = root.querySelector('[data-slot="question-text"]')!;
    const ev = new Event("copy", { bubbles: true, cancelable: true });
    title.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(root.querySelector(".ou-toast-stack")).not.toBeNull();
  });

  it("copy вне периметра не гасится и предупреждения не даёт", () => {
    applyProtection(root, QUESTION_TARGET);
    const ev = new Event("copy", { bubbles: true, cancelable: true });
    root.querySelector("footer")!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(root.querySelector(".ou-toast-stack")).toBeNull();
  });

  it("гасит контекстное меню и перетаскивание, но молча", () => {
    applyProtection(root, QUESTION_TARGET);
    const title = root.querySelector('[data-slot="question-text"]')!;
    for (const type of ["contextmenu", "dragstart"]) {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      title.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    }
    expect(root.querySelector(".ou-toast-stack")).toBeNull();
  });

  it("впрыскивает печатное правило один раз", () => {
    applyProtection(root, QUESTION_TARGET);
    applyProtection(root, QUESTION_TARGET);
    const styles = document.head.querySelectorAll("style[data-tb-protection]");
    expect(styles.length).toBe(1);
    expect(styles[0].textContent).toContain("@media print");
  });

  it("снимает пометку и инлайн, когда защиты нет", () => {
    applyProtection(root, QUESTION_TARGET);
    applyProtection(root, null);
    const title = root.querySelector<HTMLElement>('[data-slot="question-text"]')!;
    expect(title.hasAttribute(PROTECTED_ATTR)).toBe(false);
    expect(title.style.userSelect).toBe("");
  });
});

/**
 * PRD-57 FR-29, AC-06. Поле ввода лежит ВНУТРИ защищённого слота ответа, и запрет,
 * поставленный на слот целиком, отнимает у участника правку собственного текста: ни
 * выделить, ни вырезать, ни вызвать контекстное меню. Исключение делается для полей, а
 * не отключением периметра — текст задания остаётся защищённым.
 */
describe("поля ввода внутри периметра (PRD-57 FR-29)", () => {
  function sceneWithField(): HTMLElement {
    document.head.innerHTML = "";
    const root = document.createElement("div");
    root.innerHTML =
      '<h2 data-slot="question-text">Текст задания</h2>' +
      '<div data-slot="question-interaction">' +
      '<textarea data-action="short-answer">мой ответ</textarea>' +
      '<label>Вариант выбора</label>' +
      "</div>";
    document.body.innerHTML = "";
    document.body.appendChild(root);
    return root;
  }

  let root: HTMLElement;
  beforeEach(() => {
    root = sceneWithField();
  });

  it("поле ввода выделяемо, хотя лежит в защищённом слоте", () => {
    applyProtection(root, QUESTION_TARGET);
    const field = root.querySelector<HTMLElement>("textarea")!;
    expect(field.style.userSelect).toBe("text");
    // Атрибут остаётся: на нём держится печатное правило — на печати поле обязано
    // исчезнуть вместе с остальным заданием.
    const slot = root.querySelector<HTMLElement>('[data-slot="question-interaction"]')!;
    expect(slot.hasAttribute(PROTECTED_ATTR)).toBe(true);
    expect(slot.style.userSelect).toBe("none");
  });

  it("copy и вырезание в собственном ответе не гасятся и плашки не дают", () => {
    applyProtection(root, QUESTION_TARGET);
    const field = root.querySelector("textarea")!;
    for (const type of ["copy", "cut", "contextmenu", "dragstart"]) {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      field.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(root.querySelector(".ou-toast-stack")).toBeNull();
  });

  it("а текст задания и варианты выбора защищены по-прежнему", () => {
    applyProtection(root, QUESTION_TARGET);
    for (const selector of ['[data-slot="question-text"]', "label"]) {
      const ev = new Event("copy", { bubbles: true, cancelable: true });
      root.querySelector(selector)!.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    }
  });

  it("однострочное поле и редактируемый блок исключаются наравне с многострочным", () => {
    const slot = root.querySelector('[data-slot="question-interaction"]')!;
    slot.insertAdjacentHTML("beforeend", '<input type="text"><div contenteditable="true">эссе</div>');
    applyProtection(root, QUESTION_TARGET);
    for (const selector of ["input", "[contenteditable]"]) {
      const field = root.querySelector<HTMLElement>(selector)!;
      expect(field.style.userSelect).toBe("text");
      const ev = new Event("copy", { bubbles: true, cancelable: true });
      field.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
  });

  it("исключение снимается вместе с защитой", () => {
    applyProtection(root, QUESTION_TARGET);
    applyProtection(root, null);
    expect(root.querySelector<HTMLElement>("textarea")!.style.userSelect).toBe("");
  });

  it("поле, попавшее в периметр `wholeScene`, тоже исключается", () => {
    applyProtection(root, { selectors: [], wholeScene: true });
    expect(root.querySelector<HTMLElement>("textarea")!.style.userSelect).toBe("text");
  });
});
