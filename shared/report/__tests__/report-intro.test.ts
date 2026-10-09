/**
 * @module shared/report/__tests__/report-intro
 *
 * КАКИЕ вводные тексты печатает выдача и в каком порядке (PRD-61).
 *
 * Правило пиннится здесь, а не в построителе контекста, потому что здесь оно и живёт: тот же
 * ответ нужен вебу, отчёту, рантайму внутри SCORM-пакета и предпросмотру, и второй его
 * экземпляр разошёлся бы с первым при первой же правке.
 */

import { describe, it, expect } from "vitest";
import { introBlocksToPrint, resolveReportIntro } from "../report-intro";

const block = {
  format: "plain" as const,
  text: "Спасибо за прохождение теста.",
  passed: { format: "plain" as const, text: "Поздравляем." },
  failed: { format: "plain" as const, text: "Не хватило баллов." },
};

describe("introBlocksToPrint", () => {
  it("пройден: общее вступление, затем текст прошедшему", () => {
    expect(introBlocksToPrint(block, { verdictPronounced: true, passed: true })).toEqual([
      { text: "Спасибо за прохождение теста.", format: "plain" },
      { text: "Поздравляем.", format: "plain" },
    ]);
  });

  it("не пройден: общее вступление, затем текст не прошедшему", () => {
    const out = introBlocksToPrint(block, { verdictPronounced: true, passed: false });
    expect(out.map((b) => b.text)).toEqual([
      "Спасибо за прохождение теста.",
      "Не хватило баллов.",
    ]);
  });

  it("вердикт не вынесен: только общее вступление", () => {
    // Сказать «не пройден» тесту, который ничего не судит, значит соврать.
    const out = introBlocksToPrint(block, { verdictPronounced: false, passed: false });
    expect(out.map((b) => b.text)).toEqual(["Спасибо за прохождение теста."]);
  });

  it("вердикт не вынесен, но `passed` истинно: текста исхода всё равно нет", () => {
    // `passed` у неоценивающего теста — умолчание, а не суждение.
    const out = introBlocksToPrint(block, { verdictPronounced: false, passed: true });
    expect(out.map((b) => b.text)).toEqual(["Спасибо за прохождение теста."]);
  });

  it("общее вступление пустое: печатается только текст исхода", () => {
    const out = introBlocksToPrint(
      { format: "plain", text: "   ", failed: { format: "plain", text: "Не хватило." } },
      { verdictPronounced: true, passed: false },
    );
    expect(out.map((b) => b.text)).toEqual(["Не хватило."]);
  });

  it("текста ЭТОГО исхода нет: печатается только общее вступление", () => {
    const out = introBlocksToPrint(
      { format: "plain", text: "Общее", failed: { format: "plain", text: "Не хватило." } },
      { verdictPronounced: true, passed: true },
    );
    expect(out.map((b) => b.text)).toEqual(["Общее"]);
  });

  it("старая форма без ветвей исхода: только общее вступление", () => {
    // Вечный вход, а не переходное состояние: снимок публикации не мигрируется.
    const out = introBlocksToPrint(
      { format: "plain", text: "Об отчёте" },
      { verdictPronounced: true, passed: true },
    );
    expect(out.map((b) => b.text)).toEqual(["Об отчёте"]);
  });

  it("формат каждого блока едет свой", () => {
    const out = introBlocksToPrint(
      { format: "plain", text: "Общее", passed: { format: "html", text: "<p>Ура</p>" } },
      { verdictPronounced: true, passed: true },
    );
    expect(out).toEqual([
      { text: "Общее", format: "plain" },
      { text: "<p>Ура</p>", format: "html" },
    ]);
  });

  it("ничего не задано: пустой список", () => {
    expect(introBlocksToPrint(null, { verdictPronounced: true, passed: true })).toEqual([]);
    expect(introBlocksToPrint(undefined, { verdictPronounced: true, passed: true })).toEqual([]);
    expect(introBlocksToPrint({}, { verdictPronounced: true, passed: true })).toEqual([]);
  });
});

describe("resolveReportIntro с текстами исхода (FR-11)", () => {
  it("переключатель отдаёт отчёту ветвь экрана ЦЕЛИКОМ", () => {
    const intro = {
      results: block,
      report: { format: "plain" as const, text: "Своё" },
      reportSameAsResults: true,
    };
    expect(resolveReportIntro(intro)?.passed?.text).toBe("Поздравляем.");
  });

  it("выключенный переключатель отдаёт собственные тексты отчёта", () => {
    const intro = {
      results: block,
      report: { format: "plain" as const, text: "Своё", failed: { format: "plain" as const, text: "Свой провал" } },
    };
    expect(resolveReportIntro(intro)?.failed?.text).toBe("Свой провал");
  });

  it("общего вступления нет, есть только текст исхода: ветвь доезжает до отчёта", () => {
    // Гейт стоит на ТЕКСТАХ ветви, а не на одном общем вступлении. Пока он смотрел только
    // на `text`, автор, заполнивший «Если тест пройден» и оставивший «При любом исходе»
    // пустым, получал документ БЕЗ вводного блока — при том что экран итогов тот же текст
    // печатал (`measures.intro.results` едет туда объектом, без этого гейта).
    const intro = {
      report: { format: "plain" as const, text: "", passed: { format: "plain" as const, text: "Поздравляем." } },
    };
    expect(resolveReportIntro(intro)?.passed?.text).toBe("Поздравляем.");
  });

  it("переключатель включён, а общее вступление экрана пусто: текст исхода не теряется", () => {
    const intro = {
      results: { format: "plain" as const, text: "   ", failed: { format: "plain" as const, text: "Не хватило." } },
      reportSameAsResults: true,
    };
    expect(resolveReportIntro(intro)?.failed?.text).toBe("Не хватило.");
  });

  it("ветвь пуста целиком: блока нет (FR-05)", () => {
    // Автор, стерший все три текста, ожидает, что блок исчезнет, а не станет пустой рамкой.
    expect(resolveReportIntro({ report: { format: "plain", text: "  " } })).toBeNull();
    expect(
      resolveReportIntro({
        report: { format: "plain", text: "", passed: { format: "plain", text: " " }, failed: null },
      }),
    ).toBeNull();
    expect(resolveReportIntro({})).toBeNull();
  });
});
