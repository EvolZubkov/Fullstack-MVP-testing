/**
 * @module shared/template/__tests__/result-context-headings
 * @description Заголовки итога: тест называет свой результат сам.
 *
 * Проверяются ПРАВИЛА, а не вёрстка: пустая строка равна отсутствию, умолчания у экрана и
 * у документа свои, а тест без вердикта заголовками исхода не переименовывается.
 */
import { describe, it, expect } from "vitest";
import { buildResultContext } from "../result-context";
import { buildReportContext } from "../../report/report-context";

/** Оценивающая попытка: порог объявлен, баллы есть — вердикт вынесен. */
function input(passed: boolean) {
  return {
    passed,
    percent: passed ? 80 : 40,
    totalQuestions: 5,
    correct: passed ? 4 : 2,
    earnedPoints: passed ? 4 : 2,
    possiblePoints: 5,
    topicResults: [],
  };
}

const HEADINGS = {
  document: "Отчёт о сертификации",
  passed: "Сертификация пройдена",
  failed: "Сертификация не пройдена",
};

describe("экран итогов", () => {
  it("заголовок документа заменяет название теста", () => {
    const ctx = buildResultContext(input(true), "Сертификация руководителей", {
      hasPassThreshold: true,
      headings: HEADINGS,
    });
    expect(ctx.course.title).toBe("Отчёт о сертификации");
  });

  it("заголовки исхода печатаются вместо «Пройден» / «Не пройден»", () => {
    const opts = { hasPassThreshold: true, headings: HEADINGS };
    expect(buildResultContext(input(true), "Тест", opts).result.statusLabel).toBe("Сертификация пройдена");
    expect(buildResultContext(input(false), "Тест", opts).result.statusLabel).toBe("Сертификация не пройдена");
  });

  it("пустая строка равна отсутствию: стёртая настройка возвращает умолчание", () => {
    const ctx = buildResultContext(input(true), "Сертификация руководителей", {
      hasPassThreshold: true,
      headings: { document: "   ", passed: "" },
    });
    expect(ctx.course.title).toBe("Сертификация руководителей");
    expect(ctx.result.statusLabel).toBe("Пройден");
  });

  it("тест без настройки печатает ровно то, что печатал", () => {
    const ctx = buildResultContext(input(false), "Сертификация руководителей", { hasPassThreshold: true });
    expect(ctx.course.title).toBe("Сертификация руководителей");
    expect(ctx.result.statusLabel).toBe("Не пройден");
  });

  it("тест БЕЗ вердикта заголовками исхода не переименовывается", () => {
    // Порога нет — экран ни о чём не судит, и пилюли у него нет вовсе. Заголовок исхода
    // вернул бы утверждение о слушателе там, где утверждения нет.
    const ctx = buildResultContext(input(true), "Опросник", { hasPassThreshold: false, headings: HEADINGS });
    expect(ctx.result.statusLabel).toBe("");
    // Заголовок документа при этом действует: как назван итог, от вердикта не зависит.
    expect(ctx.course.title).toBe("Отчёт о сертификации");
  });
});

describe("документ отчёта", () => {
  const report = (passed: boolean, headings?: typeof HEADINGS) =>
    buildReportContext({
      testName: "Сертификация руководителей",
      hasPassThreshold: true,
      ...(headings ? { headings } : {}),
      result: input(passed),
    } as never);

  it("шапка исхода авторская, заголовок документа заменяет название теста", () => {
    const ctx = report(true, HEADINGS);
    expect(ctx.report.verdictHeadline).toBe("Сертификация пройдена");
    expect(ctx.course.title).toBe("Отчёт о сертификации");
  });

  it("у неуспеха своя строка", () => {
    expect(report(false, HEADINGS).report.verdictHeadline).toBe("Сертификация не пройдена");
  });

  it("без настройки документ печатает свои прежние умолчания", () => {
    // Умолчание документа НЕ то же, что у экрана: над шапкой документа нет названия теста,
    // и одним словом она не держится.
    expect(report(true).report.verdictHeadline).toBe("Тест пройден");
    expect(report(false).report.verdictHeadline).toBe("Тест не пройден");
    expect(report(true).course.title).toBe("Сертификация руководителей");
  });
});
