import { describe, it, expect } from "vitest";
import { renderShortAnswer } from "../shared/template/question-interaction";

describe("renderShortAnswer", () => {
  it("рисует одно однострочное поле", () => {
    const html = renderShortAnswer({ type: "short", dataJson: {} }, null);
    expect(html).toContain("ou-field__input");
    expect(html).not.toContain("<textarea");
  });

  it("подставляет ответ участника", () => {
    const html = renderShortAnswer({ type: "short", dataJson: {} }, "РТН");
    expect(html).toContain('value="РТН"');
  });

  it("экранирует ответ, а не исполняет его", () => {
    const html = renderShortAnswer({ type: "short", dataJson: {} }, '"><img src=x onerror=alert(1)>');
    expect(html).not.toContain("<img");
    expect(html).toContain("&quot;");
  });

  it("показывает единицу измерения подписью у поля", () => {
    const html = renderShortAnswer({ type: "short", dataJson: {} }, null, { numeric: true, unit: "°C" });
    expect(html).toContain("ou-field__affix");
    expect(html).toContain("°C");
    expect(html).toContain('inputmode="decimal"');
  });

  it("ставит предел длины атрибутом и подписью", () => {
    const html = renderShortAnswer({ type: "short", dataJson: { maxLength: 40 } }, null, { maxLength: 40 });
    expect(html).toContain('maxlength="40"');
    expect(html).toContain("До 40 символов");
  });

  it("берёт предел ИЗ ЗАДАНИЯ, даже когда хост о нём не сказал", () => {
    // Приёмка 2026-09-20 (AC-04b): сервер кладёт действующий предел в `data_json`
    // (`withEffectiveMaxLength`), но ни веб-хост, ни пакет не пересказывали его
    // отрисовке — поле участника уезжало без `maxlength` и без подписи, и ответ
    // набирался любой длины. Предел — свойство ЗАДАНИЯ, поэтому читается у него, а
    // `options.maxLength` остаётся перекрытием для тех, кто знает лучше.
    const html = renderShortAnswer({ type: "short", dataJson: { maxLength: 40 } }, null);
    expect(html).toContain('maxlength="40"');
    expect(html).toContain("До 40 символов");
  });

  it("предел от хоста перекрывает записанный в задании", () => {
    const html = renderShortAnswer({ type: "short", dataJson: { maxLength: 250 } }, null, { maxLength: 40 });
    expect(html).toContain('maxlength="40"');
    expect(html).not.toContain("До 250 символов");
  });

  it("без предела не печатает ни атрибута, ни подписи", () => {
    const html = renderShortAnswer({ type: "short", dataJson: {} }, null);
    expect(html).not.toContain("maxlength");
    expect(html).not.toContain("ou-field__msg");
  });

  it("в режиме только для чтения поле заперто", () => {
    const html = renderShortAnswer({ type: "short", dataJson: {} }, "РТН", { readonly: true });
    expect(html).toContain("disabled");
  });
});

describe("renderShortAnswer — числовой ответ (PRD-57 §6.6)", () => {
  const numeric = (answer: unknown) =>
    renderShortAnswer({ type: "short", dataJson: {} }, answer, { numeric: true, unit: "°C" });

  it("называет формат, но не границы (FR-28aa5)", () => {
    const html = numeric(null);
    expect(html).toContain("Введите число");
    expect(html).not.toContain("от 12 до 15");
  });

  it("помечает поле видом ответа, чтобы привязка знала, что проверять", () => {
    expect(numeric(null)).toContain('data-answer-kind="number"');
    expect(renderShortAnswer({ type: "short", dataJson: {} }, null)).not.toContain("data-answer-kind");
  });

  it("на ненабранном числе печатает сообщение и помечает поле ошибкой (FR-28z1)", () => {
    const html = numeric("минус двадцать пять");
    expect(html).toContain("Ожидается число");
    expect(html).toContain("ou-field--error");
    expect(html).toContain('aria-invalid="true"');
    expect(html).not.toContain("hidden");
  });

  it("на разобранном числе сообщение спрятано, а не убрано", () => {
    // Узел остаётся в разметке: привязка переключает его между перерисовками, и
    // отсутствующий узел ей нечего было бы показать.
    const html = numeric("-25");
    expect(html).toContain("Ожидается число");
    expect(html).toContain("hidden");
    expect(html).not.toContain("ou-field--error");
  });

  it("пустой ответ ошибкой не считается — человек ещё не начал", () => {
    const html = numeric("");
    expect(html).not.toContain("ou-field--error");
    expect(html).toContain("hidden");
  });

  it("текстовому ответу ничего из этого не печатается", () => {
    const html = renderShortAnswer({ type: "short", dataJson: {} }, "около трёх");
    expect(html).not.toContain("Ожидается число");
    expect(html).not.toContain("Введите число");
  });
});

describe("attachShortAnswer", () => {
  const mount = (html: string): HTMLElement => {
    const root = document.createElement("div");
    root.innerHTML = html;
    return root;
  };

  it("отдаёт хосту набранную строку как есть, без нормализации", async () => {
    const { attachShortAnswer } = await import("../shared/template/short-answer-dom");
    const root = mount(renderShortAnswer({ type: "short", dataJson: {} }, null));
    const seen: string[] = [];
    const detach = attachShortAnswer(root, { getAnswer: () => "", setAnswer: (v) => seen.push(v) });

    const input = root.querySelector("input") as HTMLInputElement;
    input.value = "  Ростехнадзор ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(seen).toEqual(["  Ростехнадзор "]);
    detach();
  });

  it("после отписки ничего не отдаёт", async () => {
    const { attachShortAnswer } = await import("../shared/template/short-answer-dom");
    const root = mount(renderShortAnswer({ type: "short", dataJson: {} }, null));
    const seen: string[] = [];
    const detach = attachShortAnswer(root, { getAnswer: () => "", setAnswer: (v) => seen.push(v) });
    detach();

    const input = root.querySelector("input") as HTMLInputElement;
    input.value = "поздно";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(seen).toEqual([]);
  });

  it("молчит, пока ответ заперт", async () => {
    const { attachShortAnswer } = await import("../shared/template/short-answer-dom");
    const root = mount(renderShortAnswer({ type: "short", dataJson: {} }, null));
    const seen: string[] = [];
    attachShortAnswer(root, { getAnswer: () => "", setAnswer: (v) => seen.push(v), isLocked: () => true });

    const input = root.querySelector("input") as HTMLInputElement;
    input.value = "не считается";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(seen).toEqual([]);
  });

  it("переживает перерисовку: подписка ДО появления поля всё равно ловит ввод", async () => {
    // Рантайм пакета подписывается ОДИН раз на старте, когда вопроса ещё нет. Привязка
    // к самому элементу в этот момент молча теряет весь последующий ввод.
    const { attachShortAnswer } = await import("../shared/template/short-answer-dom");
    const root = mount("<div></div>");
    const seen: string[] = [];
    attachShortAnswer(root, { getAnswer: () => "", setAnswer: (v) => seen.push(v) });

    root.innerHTML = renderShortAnswer({ type: "short", dataJson: {} }, null);
    const input = root.querySelector("input") as HTMLInputElement;
    input.value = "РТН";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(seen).toEqual(["РТН"]);
  });

  it("не падает, когда поля на экране нет", async () => {
    const { attachShortAnswer } = await import("../shared/template/short-answer-dom");
    const detach = attachShortAnswer(mount("<div></div>"), { getAnswer: () => "", setAnswer: () => {} });
    expect(() => detach()).not.toThrow();
  });

  it("переключает «ожидается число» на вводе, не перерисовывая экран (FR-28z1)", async () => {
    // Пакет экран на каждый символ не пересобирает: это отняло бы фокус. Значит
    // сообщение обязано переключаться прямо по DOM.
    const { attachShortAnswer } = await import("../shared/template/short-answer-dom");
    const root = mount(renderShortAnswer({ type: "short", dataJson: {} }, null, { numeric: true }));
    attachShortAnswer(root, { getAnswer: () => "", setAnswer: () => {} });

    const input = root.querySelector("input") as HTMLInputElement;
    const message = root.querySelector('[data-role="nan"]') as HTMLElement;
    const wrap = root.querySelector(".tb-answer-field") as HTMLElement;

    input.value = "около трёх";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(message.hidden).toBe(false);
    expect(wrap.className).toContain("ou-field--error");
    expect(input.getAttribute("aria-invalid")).toBe("true");

    input.value = "-25";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(message.hidden).toBe(true);
    expect(wrap.className).not.toContain("ou-field--error");
    expect(input.getAttribute("aria-invalid")).toBeNull();

    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(message.hidden).toBe(true);
  });

  it("текстовое поле остаётся без отметок вида", async () => {
    const { attachShortAnswer } = await import("../shared/template/short-answer-dom");
    const root = mount(renderShortAnswer({ type: "short", dataJson: {} }, null));
    attachShortAnswer(root, { getAnswer: () => "", setAnswer: () => {} });

    const input = root.querySelector("input") as HTMLInputElement;
    input.value = "около трёх";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(root.querySelector('[data-role="nan"]')).toBeNull();
    expect((root.querySelector(".tb-answer-field") as HTMLElement).className).not.toContain("ou-field--error");
  });
});

describe("attachShortAnswer — поля пропусков (PRD-57 FR-24)", () => {
  const mountBlanks = (html: string): HTMLElement => {
    const root = document.createElement("div");
    root.innerHTML = html;
    return root;
  };

  it("отдаёт пару «имя — значение», а не одну строку", async () => {
    const { attachShortAnswer } = await import("../shared/template/short-answer-dom");
    const { renderBlanksPrompt } = await import("../shared/template/question-interaction");
    const html = renderBlanksPrompt("Надзор: {{organ}}, срок: {{srok}}", {
      mode: "input",
      blanks: [
        { id: "organ", answerKind: "text", join: "any", rules: [{ kind: "text", match: "wildcard", value: "РТН" }] },
        { id: "srok", answerKind: "number", join: "any", rules: [{ kind: "number", op: "eq", value: 15 }] },
      ],
    });
    const root = mountBlanks(html);
    const pairs: Array<[string, string]> = [];
    const plain: string[] = [];
    attachShortAnswer(root, {
      getAnswer: () => "",
      setAnswer: (v) => plain.push(v),
      setBlank: (id, value) => pairs.push([id, value]),
    });

    const inputs = [...root.querySelectorAll("input")] as HTMLInputElement[];
    inputs[1].value = "15";
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));

    expect(pairs).toEqual([["srok", "15"]]);
    // Одиночного ответа у задания с пропусками нет: перепутать их нельзя.
    expect(plain).toEqual([]);
  });
});
