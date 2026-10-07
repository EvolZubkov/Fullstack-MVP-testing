/**
 * @module server/services/analytics/__tests__/attempt-protocol
 * @description Протокол попытки книгой Excel (дефект D3 UX-аудита аналитики).
 *
 * Главное, что здесь стережётся: ответ и эталон в файле — СЛОВАМИ, как в окне попытки, а не
 * сырым JSON. Остальное — что состав протокола не потерялся при переезде из CSV в книгу.
 */
import { describe, expect, it } from "vitest";

import { answerRows, buildAttemptProtocol, summaryRows } from "../attempt-protocol";
import { sheetToArrays } from "../../../utils/excel";

/** Веб-разбор в том виде, в каком его отдаёт `loadWebAttemptDetail`. */
function webDetail(over: Record<string, unknown> = {}) {
  return {
    attemptId: "a1",
    username: "Иван Петров",
    userEmail: "ivan@example.ru",
    testTitle: "Тест по финансам",
    testMode: "standard",
    snapshotVersion: 3,
    startedAt: "2026-09-30T10:00:00.000Z",
    finishedAt: "2026-09-30T10:12:30.000Z",
    duration: 750,
    overallPercent: 61.6,
    earnedPoints: 1.5,
    possiblePoints: 2,
    passed: false,
    scored: true,
    verdictPronounced: true,
    answers: [
      {
        questionPrompt: "Что такое бюджет?",
        questionType: "single",
        topicName: "Бюджетирование",
        difficulty: 40,
        isCorrect: true,
        ratio: 1,
        earnedPoints: 1,
        possiblePoints: 1,
        contribs: [{ scaleKey: "ee", delta: 2 }],
        userAnswerRaw: 1,
        correctAnswerRaw: { correctIndex: 1 },
        questionData: { options: ["План расходов", "План доходов и расходов"] },
      },
      {
        questionPrompt: "Какие статьи постоянные?",
        questionType: "multiple",
        topicName: "Бюджетирование",
        difficulty: 60,
        isCorrect: false,
        ratio: 0.5,
        earnedPoints: 0.5,
        possiblePoints: 1,
        contribs: [{ scaleKey: "ee", delta: 3 }, { scaleKey: "oc", delta: -1 }],
        userAnswerRaw: [0],
        correctAnswerRaw: { correctIndices: [0, 2] },
        questionData: { options: ["Аренда", "Премии", "Связь"] },
      },
    ],
    scaleResults: { ee: { raw: 5, level: "high", label: "Высокий", hasValue: true } },
    resultVariables: { verdict: "сильный", flag: true },
    ...over,
  };
}

/** Сырой текст всех ячеек листа — для поиска подстрок. */
function sheetText(detail: Record<string, unknown>, source: "web" | "lms", name: string): string {
  const sheet = buildAttemptProtocol(detail, source).getWorksheet(name);
  if (!sheet) return "";
  return sheetToArrays(sheet).map(row => row.join("\t")).join("\n");
}

describe("протокол попытки — ответы словами (D3)", () => {
  it("пишет ответ и эталон веб-попытки словами, а не JSON", () => {
    const rows = answerRows(webDetail().answers, "web");

    expect(rows[1][3]).toBe("2) План доходов и расходов");
    expect(rows[1][4]).toBe("2) План доходов и расходов");
    expect(rows[2][3]).toBe("1) Аренда");
    expect(rows[2][4]).toBe("1) Аренда, 3) Связь");
    for (const row of rows.slice(1)) {
      expect(String(row[3])).not.toMatch(/[{[]/);
      expect(String(row[4])).not.toMatch(/[{[]/);
    }
  });

  it("у строки LMS берёт варианты из снимка, приехавшего с ответом", () => {
    const rows = answerRows([{
      questionPrompt: "Порядок шагов",
      questionType: "ranking",
      isCorrect: false,
      ratio: 0,
      earnedPoints: 0,
      possiblePoints: 1,
      userAnswer: [1, 0],
      correctAnswer: { correctOrder: [0, 1] },
      items: ["Собрать заявки", "Утвердить"],
    }], "lms");

    expect(rows[1][3]).toBe("1. Утвердить, 2. Собрать заявки");
    expect(rows[1][4]).toBe("1. Собрать заявки, 2. Утвердить");
  });

  it("измерительный ответ — «Измерение», без эталона, баллов и доли", () => {
    const rows = answerRows([{
      questionPrompt: "Насколько согласны?",
      questionType: "scale",
      measurementOnly: true,
      isCorrect: false,
      ratio: 0,
      userAnswerRaw: 2,
      correctAnswerRaw: null,
      questionData: { options: ["Нет", "Скорее нет", "Скорее да", "Да"] },
    }], "web");

    expect(rows[1].slice(3, 9)).toEqual(["3) Скорее да", "", "Измерение", "", "", ""]);
  });

  it("сохраняет вклады в шкалы и долю верности в едином формате процентов", () => {
    const rows = answerRows(webDetail().answers, "web");

    expect(rows[0]).toContain("Вклады в шкалы");
    expect(rows[1][9]).toBe("ee +2");
    expect(rows[2][9]).toBe("ee +3 | oc -1");
    expect(rows[2][8]).toBe("50 %");
  });
});

describe("протокол попытки — итог и состав книги", () => {
  it("печатает итог: процент, баллы и вердикт", () => {
    const rows = Object.fromEntries(summaryRows(webDetail(), "web") as Array<[string, unknown]>);

    expect(rows["Участник"]).toBe("Иван Петров");
    expect(rows["Результат"]).toBe("62 %");
    expect(rows["Баллы"]).toBe("1.5 / 2");
    expect(rows["Статус"]).toBe("Не сдан");
    expect(rows["Длительность"]).toBe("12:30");
    expect(rows["Версия публикации"]).toBe(3);
  });

  it("не выносит вердикт там, где его не выносили (PRD-29 §6.7)", () => {
    const rows = Object.fromEntries(
      summaryRows(webDetail({ scored: false, verdictPronounced: false }), "web") as Array<[string, unknown]>,
    );

    expect(rows["Статус"]).toBe("Без вердикта");
    expect(rows).not.toHaveProperty("Результат");
  });

  it("у адаптивной попытки вместо результата — лист уровней", () => {
    const detail = webDetail({
      testMode: "adaptive",
      answers: [],
      achievedLevels: [{ topicName: "Финансы", levelName: "Средний" }, { topicName: "Право", levelName: null }],
    });

    expect(sheetText(detail, "web", "Попытка")).toContain("Адаптивный");
    expect(sheetText(detail, "web", "Попытка")).not.toContain("Результат");
    expect(sheetText(detail, "web", "Уровни")).toContain("Средний");
    expect(sheetText(detail, "web", "Уровни")).toContain("Не достигнут");
  });

  it("выгружает шкалы и показатели отдельными листами", () => {
    expect(sheetText(webDetail(), "web", "Шкалы")).toContain("Высокий");
    const variables = sheetText(webDetail(), "web", "Показатели");
    expect(variables).toContain("verdict");
    expect(variables).toContain("да");
  });

  it("names each indicator and prints its level when the detail resolved it (FR-21h)", () => {
    const sheet = buildAttemptProtocol(webDetail({
      indicatorViews: [
        { name: "idx", label: "Индекс", value: 64.256, interpretation: "Сильная сторона" },
        { name: "flag", label: "Резерв", value: true, interpretation: null },
        { name: "style", label: "Стиль", value: null, interpretation: null },
      ],
    }), "lms").getWorksheet("Показатели")!;

    expect(sheetToArrays(sheet)).toEqual([
      ["Ключ", "Название", "Значение", "Уровень / исход"],
      ["idx", "Индекс", "64.26", "Сильная сторона"],
      ["flag", "Резерв", "да", ""],
      // Not reported by the LMS: the row stays, the value is the dash, not a recompute.
      ["style", "Стиль", "—", ""],
    ]);
  });

  it("не заводит пустые листы шкал и показателей", () => {
    const workbook = buildAttemptProtocol(webDetail({ scaleResults: {}, resultVariables: {} }), "web");

    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(["Попытка", "Ответы"]);
  });

  it("называет участника строки LMS именем из LMS", () => {
    const rows = Object.fromEntries(summaryRows({
      lmsUserName: "Мария Сидорова", lmsUserEmail: "m@example.ru", testTitle: "Т", testMode: "standard",
      overallPercent: 80, earnedPoints: 8, possiblePoints: 10, passed: true, scored: true, verdictPronounced: true,
    }, "lms") as Array<[string, unknown]>);

    expect(rows["Участник"]).toBe("Мария Сидорова");
    expect(rows["Источник"]).toBe("LMS");
    expect(rows["Статус"]).toBe("Сдан");
  });
});
