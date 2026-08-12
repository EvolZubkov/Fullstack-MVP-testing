/**
 * @module tests/report-html
 *
 * Помощники отчёта (`shared/report/report-html`): имя файла и текстовые правила, которые
 * считает ЯДРО, потому что DSL не считает (spec §9).
 *
 * Вёрстки в этом модуле больше нет — с PRD-27 Фазы 2 страницу рисует макет шаблона, и её
 * содержимое проверяет `tests/report-layout-parity`. Здесь остались только те функции,
 * которые к разметке не относятся.
 */

import { describe, it, expect } from "vitest";
import { reportFileName, sanitizeFileName, pluralize, formatTimestamp } from "../shared/report/report-html";

describe("имя файла отчёта", () => {
  it("«Результаты_<Тест>_дд_мм_гггг.pdf»", () => {
    expect(reportFileName("Демо тест", new Date(2026, 6, 30))).toBe("Результаты_Демо_тест_30_07_2026.pdf");
  });

  it("день и месяц дополняются нулём — иначе имена не сортируются", () => {
    expect(reportFileName("Т", new Date(2026, 0, 5))).toBe("Результаты_Т_05_01_2026.pdf");
  });

  it("без названия теста имя всё равно осмысленно", () => {
    expect(reportFileName(null, new Date(2026, 6, 30))).toBe("Результаты_test_30_07_2026.pdf");
  });
});

describe("sanitizeFileName", () => {
  it("убирает то, чего имя файла не несёт, и склеивает пробелы", () => {
    expect(sanitizeFileName('Тест: "А/Б"')).toBe("Тест_АБ");
  });

  it("режет длину до 50 символов", () => {
    expect(sanitizeFileName("x".repeat(80))).toHaveLength(50);
  });

  it("пустое имя превращается в «test», а не в пустую строку", () => {
    expect(sanitizeFileName(null)).toBe("test");
    expect(sanitizeFileName("")).toBe("test");
  });

  it("кириллицу, цифры, дефис и подчёркивание сохраняет", () => {
    expect(sanitizeFileName("Тест-2 итог_1")).toBe("Тест-2_итог_1");
  });
});

describe("склонение", () => {
  it("подчиняется правилу русского языка, включая исключение на -надцать", () => {
    const forms = (n: number) => pluralize(n, "попытку", "попытки", "попыток");
    expect(forms(1)).toBe("попытку");
    expect(forms(2)).toBe("попытки");
    expect(forms(5)).toBe("попыток");
    expect(forms(11)).toBe("попыток");
    expect(forms(14)).toBe("попыток");
    expect(forms(21)).toBe("попытку");
    expect(forms(23)).toBe("попытки");
    expect(forms(25)).toBe("попыток");
    expect(forms(111)).toBe("попыток");
  });
});

describe("дата прохождения", () => {
  it("формат дд.мм.гггг чч:мм с ведущими нулями", () => {
    expect(formatTimestamp(new Date(2026, 6, 5, 9, 7).toISOString())).toBe("05.07.2026 09:07");
  });

  it("без метки времени берётся текущий момент, а не пустая строка", () => {
    expect(formatTimestamp(null)).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
  });
});
