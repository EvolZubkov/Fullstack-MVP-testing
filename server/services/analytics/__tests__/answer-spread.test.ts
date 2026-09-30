/**
 * @module server/services/analytics/__tests__/answer-spread
 * @description PRD-56 FR-22: разброс ответов измерительного задания.
 */
import { describe, expect, it } from "vitest";

import { answerSpread, textVolume } from "../answer-spread";

const GRADES = ["Никогда", "Иногда", "Часто", "Всегда"];
const STATEMENTS = ["Командный", "Вдохновляющий", "Целеустремлённый", "Процессный"];

describe("answerSpread — шкала", () => {
  it("считает долю ВЫБРАВШИХ каждую градацию", () => {
    const spread = answerSpread({
      type: "scale",
      options: GRADES,
      answers: [2, 2, 2, 1],
    });

    expect(spread?.answered).toBe(4);
    expect(spread?.options.map(o => Math.round(o.share))).toEqual([0, 25, 75, 0]);
  });

  it("читает индекс и строкой — выгрузка LMS присылает его так", () => {
    const spread = answerSpread({ type: "scale", options: GRADES, answers: ["1", 1] });

    expect(spread?.options[1].share).toBe(100);
  });

  it("не считает ответ, указывающий на несуществующую градацию", () => {
    // Вопрос мог потерять вариант после прохождения: ответ на него не должен ни падать,
    // ни смещать доли остальных.
    const spread = answerSpread({ type: "scale", options: GRADES, answers: [0, 9] });

    expect(spread?.answered).toBe(1);
    expect(spread?.options[0].share).toBe(100);
  });
});

describe("answerSpread — распределение баллов", () => {
  it("считает долю ОТДАННЫХ баллов, а не долю людей", () => {
    // Человек делит бюджет между несколькими утверждениями сразу, поэтому доли считаются от
    // розданных баллов: «доля выбравших» дала бы в сумме больше ста процентов.
    const spread = answerSpread({
      type: "allocation",
      options: STATEMENTS,
      answers: [
        { "0": 4, "1": 2, "2": 1 },
        { "0": 3, "3": 4 },
      ],
    });

    expect(spread?.answered).toBe(2);
    // Всего роздано 14: 7 первому, 2 второму, 1 третьему, 4 четвёртому.
    expect(spread?.options.map(o => Math.round(o.share))).toEqual([50, 14, 7, 29]);
  });

  it("не берёт в знаменатель ответ, где не роздано ничего", () => {
    const spread = answerSpread({
      type: "allocation",
      options: STATEMENTS,
      answers: [{ "0": 5 }, {}, { "1": 5 }],
    });

    expect(spread?.answered).toBe(2);
  });
});

describe("answerSpread — когда считать не из чего", () => {
  it("молчит без ответов", () => {
    expect(answerSpread({ type: "scale", options: GRADES, answers: [] })).toBeNull();
  });

  it("молчит без вариантов", () => {
    expect(answerSpread({ type: "scale", options: [], answers: [1] })).toBeNull();
  });

  it("молчит, когда ни один ответ не пригоден", () => {
    expect(answerSpread({ type: "allocation", options: STATEMENTS, answers: [null, 7] })).toBeNull();
  });
});

describe("answerSpread — короткий ответ (PRD-57 FR-28x)", () => {
  it("сворачивает ответы по частоте, не различая написаний", () => {
    const spread = answerSpread({
      type: "short",
      options: [],
      answers: ["Ростехнадзор", "ростехнадзор", "  РОСТЕХНАДЗОР ", "РТН"],
    });

    expect(spread?.answered).toBe(4);
    expect(spread?.options).toEqual([
      { label: "Ростехнадзор", share: 75 },
      { label: "РТН", share: 25 },
    ]);
  });

  it("подписью берёт самое частое исходное написание", () => {
    const spread = answerSpread({ type: "short", options: [], answers: ["ртн", "ртн", "РТН"] });
    expect(spread?.options[0].label).toBe("ртн");
  });

  it("пустые ответы в знаменатель не идут", () => {
    const spread = answerSpread({ type: "short", options: [], answers: ["РТН", "", "   ", null] });
    expect(spread?.answered).toBe(1);
  });

  it("считать не из чего — null, а не пустой разброс", () => {
    expect(answerSpread({ type: "short", options: [], answers: [] })).toBeNull();
    expect(answerSpread({ type: "short", options: [], answers: ["", null] })).toBeNull();
  });

  it("строки идут по убыванию доли: автор читает сверху самое частое", () => {
    const spread = answerSpread({
      type: "short",
      options: [],
      answers: ["а", "б", "б", "в", "в", "в"],
    });
    expect(spread?.options.map((o) => o.label)).toEqual(["в", "б", "а"]);
  });
});

describe("answerSpread — текст, похожий на число", () => {
  it("у текстового задания ответ «42», прочитанный числом, остаётся написанием", () => {
    const spread = answerSpread({ type: "short", options: [], answers: [42, "42", "сорок два"] });
    expect(spread?.answered).toBe(3);
    expect(spread?.options.map((option) => option.label)).toContain("42");
  });

  it("сводка текста считает и такие ответы", () => {
    expect(textVolume([42, "сорок два"])?.answered).toBe(2);
  });
});

describe("answerSpread — числовое задание (PRD-57 FR-28ag)", () => {
  /** Числовой разброс: тот же вызов, вид ответа приходит из набора правил. */
  const numeric = (answers: unknown[]) =>
    answerSpread({ type: "short", options: [], answers, answerKind: "number" });

  it("раскладывает значения по корзинам, а не по написаниям", () => {
    const spread = numeric(["10", "11", "12", "100"]);
    // Частотная таблица дала бы четыре строки по 25 % — и ничего не сказала бы о том,
    // что три ответа рядом, а один далеко.
    expect(spread?.options.length).toBeLessThan(4);
    expect(spread?.answered).toBe(4);
  });

  it("ответ, который драйвер прочитал числом, в гистограмму попадает", () => {
    // drizzle при чтении `jsonb` повторно разбирает строку: «15» из базы приходит числом 15.
    const spread = numeric([15, "15", 10, 30]);
    expect(spread?.answered).toBe(4);
    expect(spread?.options.some((option) => option.label === "не число")).toBe(false);
  });

  it("корзин не больше десяти", () => {
    const answers = Array.from({ length: 200 }, (_, i) => String(i));
    expect(numeric(answers)?.options.length).toBeLessThanOrEqual(10);
  });

  it("одинаковые значения дают одну корзину со всей долей", () => {
    const spread = numeric(["7", "7,0", "7"]);
    expect(spread?.options.length).toBe(1);
    expect(spread?.options[0].share).toBe(100);
  });

  it("дробь и десятичная запись попадают в одну корзину", () => {
    const spread = numeric(["1/2", "0,5"]);
    expect(spread?.options.length).toBe(1);
  });

  it("ненабранные числа образуют свою строку", () => {
    const spread = numeric(["10", "около десяти", "10"]);
    const nan = spread?.options.find((o) => o.label === "не число");
    expect(nan).toBeTruthy();
    expect(nan?.share).toBeCloseTo(33.3, 0);
    expect(spread?.answered).toBe(3);
  });

  it("подпись корзины называет её границы", () => {
    const spread = numeric(["0", "5", "10"]);
    expect(spread?.options[0].label).toMatch(/^от .+ до .+$/);
  });

  it("считать не из чего — null", () => {
    expect(numeric([])).toBeNull();
    expect(numeric(["", null])).toBeNull();
  });

  it("текстовый набор по-прежнему сворачивается по написаниям", () => {
    const spread = answerSpread({ type: "short", options: [], answers: ["РТН", "ртн"] });
    expect(spread?.options).toEqual([{ label: "РТН", share: 100 }]);
  });
});

/**
 * PRD-57 FR-32: свободный текст не описывается частотами вариантов — двух одинаковых
 * развёрнутых ответов не бывает. Объективного о таком задании ровно две вещи: сколько
 * написали и как длинно.
 */
describe("сводка свободного текста (FR-32)", () => {
  it("считает ответы и длину: медиану и границы", () => {
    const summary = textVolume(["раз", "двадцать символов!!!", "семь!!"]);
    expect(summary).toEqual({ answered: 3, medianLength: 6, minLength: 3, maxLength: 20 });
  });

  it("медиана, а не среднее: один ответ на страницу не сдвигает типичную работу", () => {
    const summary = textVolume(["ответ", "ответ", "ответ", "x".repeat(3000)]);
    expect(summary?.medianLength).toBe(5);
    expect(summary?.maxLength).toBe(3000);
  });

  it("пустые ответы не считаются написанными", () => {
    const summary = textVolume(["", "   ", null, "есть"]);
    expect(summary).toEqual({ answered: 1, medianLength: 4, minLength: 4, maxLength: 4 });
  });

  it("считать не из чего — null", () => {
    expect(textVolume([])).toBeNull();
    expect(textVolume(["", null])).toBeNull();
  });

  it("длина меряется по видимому тексту, без краевых пробелов", () => {
    expect(textVolume(["  пять  "])?.medianLength).toBe(4);
  });
});
