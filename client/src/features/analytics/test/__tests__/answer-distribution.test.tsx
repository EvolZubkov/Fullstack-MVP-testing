/**
 * @module features/analytics/test/__tests__/answer-distribution.test
 * @description Э4а: распределение ответов — цвета, сводка и легенда у всех типов вопросов.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NoValue } from "../no-value";
import { colorize, compactModel, CompactDistribution, type CompactModel } from "../answer-distribution";

const bar = (model: CompactModel | null) => {
  if (!model || model.kind !== "bar") throw new Error("ожидалась полоса");
  return model;
};

describe("colorize", () => {
  it("цвет закреплён за вариантом, верный — зелёный, у оцениваемого бирюзового нет", () => {
    const options = colorize([
      { label: "A", share: 10 }, { label: "B", share: 50, correct: true }, { label: "C", share: 40, correct: false },
      ...Array.from({ length: 6 }, (_, i) => ({ label: `D${i}`, share: 0, correct: false })),
    ]);
    expect(options[1].color).toBe("var(--ou-success-default)");
    expect(options[0].color).toBe("var(--ou-cat-business)");
    expect(options[2].color).toBe("var(--ou-cat-bti)");
    expect(options.some(o => o.color === "var(--ou-cat-b2o)")).toBe(false);
  });

  it("у опросника палитра целиком, сумма — серая", () => {
    const options = colorize([
      ...Array.from({ length: 7 }, (_, i) => ({ label: `G${i}`, share: 10 })),
      { label: "ещё", share: 30, rest: true },
    ]);
    expect(options[6].color).toBe("var(--ou-cat-b2o)");
    expect(options[7].color).toBe("var(--ou-border-strong)");
  });
});

describe("compactModel", () => {
  it("выбор: сводка — два частых ответа с пометкой верного", () => {
    const model = bar(compactModel({
      questionType: "single",
      spread: { answered: 100, options: [
        { label: "Проверка", share: 41, correct: true }, { label: "Подарок", share: 34, correct: false },
        { label: "Обучение", share: 24, correct: false }, { label: "Журнал", share: 1, correct: false },
      ] },
    }));
    expect(model.summary).toBe("✓ Проверка — 41 % · Подарок — 34 % · ещё 2");
    expect(model.options.map(o => o.label)).toEqual(["Проверка", "Подарок", "Обучение", "Журнал"]);
  });

  it("множественный выбор объясняет сумму больше ста", () => {
    const model = bar(compactModel({ questionType: "multiple", spread: { answered: 10, options: [{ label: "A", share: 90, correct: true }, { label: "B", share: 60, correct: false }] } }));
    expect(model.head).toMatch(/в сумме больше 100 %/);
  });

  it("короткий ответ: пять написаний поимённо, остальное — серой суммой", () => {
    const options = Array.from({ length: 8 }, (_, i) => ({ label: `w${i}`, share: 20 - i, correct: i === 0 }));
    const model = bar(compactModel({ questionType: "short", spread: { answered: 50, options } }));
    expect(model.options).toHaveLength(6);
    expect(model.options[5]).toMatchObject({ label: "ещё 3 написания", rest: true, color: "var(--ou-border-strong)" });
    expect(model.head).toBe("Зелёным — засчитанные правилами ответы");
  });

  it("сопоставление: верно и неверно, хуже всех — по паре", () => {
    const model = bar(compactModel({
      questionType: "matching",
      units: { type: "matching", observations: 10, share: 0.72, units: [
        { index: 0, label: "Приказы", reference: "75 лет", share: 0.64, bottomShare: null, topShare: null, mistake: null },
        { index: 1, label: "Журнал", reference: "10 лет", share: 0.82, bottomShare: null, topShare: null, mistake: null },
      ] },
    }));
    expect(model.summary).toBe("пары верно — 72 % · хуже всех: Приказы — 64 %");
    expect(model.extra).toEqual(["Приказы → 75 лет: верно 64 %", "Журнал → 10 лет: верно 82 %"]);
    expect(model.options.map(o => o.label)).toEqual(["пары верно", "пары неверно"]);
  });

  it("развёрнутый ответ — сводка, читать на странице вопроса", () => {
    const model = compactModel({ questionType: "long", volume: { answered: 34, medianLength: 412, minLength: 38, maxLength: 1920 } });
    expect(model).toEqual({ kind: "volume", summary: "34 ответа · медиана 412 знаков (от 38 до 1920) · читать — на странице вопроса" });
  });

  it("считать не из чего — null", () => {
    expect(compactModel({ questionType: "single", spread: null })).toBeNull();
  });
});

describe("CompactDistribution", () => {
  it("по наведению показывает легенду: ответ и доля", async () => {
    const model = compactModel({ questionType: "scale", spread: { answered: 10, options: [{ label: "Согласен", share: 60 }, { label: "Не согласен", share: 40 }] } }, true)!;
    const { container } = render(<CompactDistribution model={model} />);
    fireEvent.mouseEnter(container.querySelector(".tb-dist")!);
    expect((await screen.findAllByText("Согласен")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("60 %").length).toBeGreaterThan(0);
  });
});

describe("NoValue", () => {
  it("«мало данных» называет, сколько не хватает, и порог в подсказке", () => {
    const { container } = render(<NoValue kind="insufficient" need={10} have={6} />);
    expect(container.textContent).toContain("мало данных");
    expect(container.textContent).toContain("ещё 4");
    expect(container.textContent).toContain("Число появится с 10 наблюдений");
  });

  it("«не применимо» объясняет причину", () => {
    const { container } = render(<NoValue kind="notApplicable" />);
    expect(container.textContent).toContain("не применимо");
    expect(container.textContent).toContain("нет автоматической оценки");
  });
});
