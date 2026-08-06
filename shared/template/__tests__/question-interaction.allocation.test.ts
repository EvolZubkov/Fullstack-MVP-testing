/**
 * @module shared/template/__tests__/question-interaction.allocation
 *
 * PRD-44 allocation interaction: the DS `BudgetAllocation` markup emitted by the SHARED
 * function both hosts call, so the web scene and the SCORM package cannot drift.
 *
 * What the assertions actually guard:
 *  - rows carry `data-index`, and the value/ceiling are read from attributes — matching
 *    DOM to data by TEXT breaks the moment typography touches a statement;
 *  - the slider's visual scale is the BUDGET while its `aria-valuemax` is the current
 *    ceiling: the first keeps a row from jumping when a NEIGHBOUR changes, the second is
 *    what a screen-reader user needs to know how far they may go;
 *  - review mode is read-only and carries no verdict classes at all — the type has no
 *    correct distribution to mark.
 */
import { describe, expect, it } from "vitest";
import { renderAllocation, questionHint, answerTexts } from "../question-interaction";

const OPTIONS = ["Разбор задачи", "Знакомство с командой", "Регламент", "Смысл работы"];
const Q = {
  type: "allocation",
  dataJson: { options: OPTIONS, budget: 7, minPerOption: 0, maxPerOption: 7 },
};

/** `aria-valuenow` of every row, in display order. */
const values = (html: string): number[] =>
  Array.from(html.matchAll(/aria-valuenow="(\d+)"/g)).map((m: RegExpMatchArray) => Number(m[1]));

/** `aria-valuemax` of every row — the CURRENT ceiling, not the budget. */
const ceilings = (html: string): number[] =>
  Array.from(html.matchAll(/aria-valuemax="(\d+)"/g)).map((m: RegExpMatchArray) => Number(m[1]));

describe("renderAllocation — разметка", () => {
  it("эмитит классы дизайн-системы, а не собственные", () => {
    const html = renderAllocation(Q, {});
    expect(html).toContain("ou-alloc");
    expect(html).toContain("ou-alloc__counter");
    expect(html).toContain("ou-alloc__row");
    expect(html).toContain("ou-slider");
    expect(html).toContain("ou-number");
    // Никаких выдуманных пространств имён.
    expect(html).not.toContain("tb-alloc");
  });

  it("одна строка на утверждение, сверка идёт по индексам", () => {
    const html = renderAllocation(Q, {});
    const indices = Array.from(html.matchAll(/data-index="(\d+)"/g)).map((m) => m[1]);
    expect(indices).toEqual(["0", "1", "2", "3"]);
  });

  it("подписи утверждений в авторском порядке", () => {
    const html = renderAllocation(Q, {});
    // Сверка нормализует типографику: рендер ставит неразрывные пробелы, и сравнение
    // «как в источнике» ломалось бы на них — по этой же причине хосты сверяют DOM с
    // данными по индексам, а не по тексту.
    const labels = Array.from(html.matchAll(/ou-alloc__label"[^>]*>([^<]*)</g)).map((m: RegExpMatchArray) =>
      m[1].replace(/ /g, " "),
    );
    expect(labels).toEqual(OPTIONS);
  });

  it("нетронутый вопрос: нули и полный остаток", () => {
    const html = renderAllocation(Q, {});
    expect(values(html)).toEqual([0, 0, 0, 0]);
    expect(html).toContain("Осталось:");
    expect(html).toContain(">7<");
  });

  it("при нулевом остатке счётчик меняет формулировку", () => {
    const html = renderAllocation(Q, { 0: 3, 1: 1, 2: 1, 3: 2 });
    expect(html).toContain("Вы использовали все баллы");
    expect(html).not.toContain("Осталось:");
    expect(html).toContain("is-complete");
  });

  it("счётчик — живая область для экранного диктора (FR-34)", () => {
    expect(renderAllocation(Q, {})).toContain('aria-live="polite"');
  });

  it("доступный максимум строки равен её значению плюс остаток (FR-29)", () => {
    // Остаток 3: строка со значением 3 может дойти до 6, нулевая — до 3.
    const html = renderAllocation(Q, { 0: 3, 1: 1, 2: 0, 3: 0 });
    expect(values(html)).toEqual([3, 1, 0, 0]);
    expect(ceilings(html)).toEqual([6, 4, 3, 3]);
  });

  it("шкала ползунка ФИКСИРОВАНА бюджетом, а не потолком строки", () => {
    // Положение считается от бюджета: иначе значение строки визуально прыгало бы
    // при изменении СОСЕДНЕЙ строки, хотя сама строка не менялась.
    const html = renderAllocation(Q, { 0: 3, 1: 1, 2: 0, 3: 0 });
    // 3 из бюджета 7 -> 42.9%, а не 50% (3 из потолка 6).
    expect(html).toMatch(/left:42\.9%/);
  });

  it("недоступный хвост показан, когда потолок ниже бюджета", () => {
    const html = renderAllocation(Q, { 0: 3, 1: 1, 2: 0, 3: 0 });
    expect(html).toContain("ou-alloc__cap");
  });

  it("строка выше минимума отмечена, предзаполненная — нет", () => {
    const withFloor = { type: "allocation", dataJson: { options: OPTIONS, budget: 7, minPerOption: 1, maxPerOption: 7 } };
    const seeded = renderAllocation(withFloor, { 0: 1, 1: 1, 2: 1, 3: 1 });
    expect(seeded).not.toContain("is-weighted");
    const touched = renderAllocation(withFloor, { 0: 4, 1: 1, 2: 1, 3: 1 });
    expect(touched).toContain("is-weighted");
  });

  it("у каждой пары есть подпись для диктора из текста утверждения", () => {
    const html = renderAllocation(Q, {});
    expect(html).toContain('aria-label="Разбор задачи"');
    expect(html).toContain('aria-label="Баллы: Разбор задачи"');
  });

  it("ввод делегирован по индексу утверждения", () => {
    const html = renderAllocation(Q, {});
    expect(html).toContain('data-alloc="0"');
    expect(html).toContain('data-alloc="3"');
  });

  it("разметка автора экранируется, а не доезжает тегами", () => {
    const evil = { type: "allocation", dataJson: { options: ["<img src=x onerror=alert(1)>", "Б"], budget: 4 } };
    const html = renderAllocation(evil, {});
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("испорченный dataJson даёт пустую группу, а не исключение", () => {
    expect(() => renderAllocation({ type: "allocation", dataJson: null }, {})).not.toThrow();
  });
});

describe("renderAllocation — обзор ответов (FR-33)", () => {
  it("только чтение и БЕЗ разметки верности", () => {
    const html = renderAllocation(Q, { 0: 3, 1: 1, 2: 1, 3: 2 }, true);
    expect(html).toContain("ou-alloc--readonly");
    expect(html).toContain("ou-alloc__value");
    // Ни одного класса вердикта: правильного распределения не существует.
    expect(html).not.toContain("correct-answer");
    expect(html).not.toContain("incorrect-answer");
    // Интерактива нет.
    expect(html).not.toContain("ou-number__btn");
    expect(html).not.toContain("data-alloc=");
  });
});

describe("подсказка и тексты ответов", () => {
  it("подсказка называет бюджет вопроса (FR-32)", () => {
    expect(questionHint("allocation", Q)).toBe("Распределите 7 баллов между вариантами");
  });

  it("подсказка без вопроса не выдумывает число", () => {
    expect(questionHint("allocation")).toBe("Распределите баллы между вариантами");
  });

  it("подсказки остальных типов не изменились", () => {
    expect(questionHint("single")).toBe("Выберите один вариант ответа");
    expect(questionHint("scale")).toBe("Выберите ответ на шкале");
  });

  it("тексты утверждений идут в подгонку шрифта (FR-35)", () => {
    expect(answerTexts(Q)).toEqual(OPTIONS);
  });
});
