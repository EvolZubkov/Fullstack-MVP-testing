/**
 * PRD-53 §6: колонка «Рекомендации» на листе «Исходы показателей».
 *
 * Отдельного листа «Профили» не понадобилось: колонка «Код» — свободный текст, поэтому коды-наборы
 * (`cel+pro`) и запасные (`count:2`) лист везёт без единой правки разбора. Не хватало только
 * второго крупного текста методики — обратной связи исхода.
 */
import { describe, expect, it } from "vitest";
import {
  OUTCOME_HEADERS,
  mergeOutcomes,
  parseOutcomeRow,
  serializeOutcomeRows,
} from "../server/utils/workbook-sheets";

const HEADERS = new Set(OUTCOME_HEADERS);

describe("«Исходы показателей»: колонка «Рекомендации»", () => {
  it("значится в колонках последней", () => {
    expect(OUTCOME_HEADERS).toEqual([
      "Показатель",
      "Код",
      "Метка",
      "Текст",
      "Тональность",
      "Рекомендации",
    ]);
  });

  it("читается, когда колонка в книге есть", () => {
    const parsed = parseOutcomeRow(
      {
        "Показатель": "lead_style",
        "Код": "cel+pro",
        "Метка": "Двухвекторный",
        "Текст": "Характеристика",
        "Рекомендации": "Совет",
      },
      HEADERS,
    );
    expect(parsed.ok && parsed.value.feedbackText).toBe("Совет");
  });

  it("код-набор и запасной код проходят без правок разбора", () => {
    const set = parseOutcomeRow({ "Показатель": "lead_style", "Код": "cel+pro" }, HEADERS);
    const count = parseOutcomeRow({ "Показатель": "lead_style", "Код": "count:2" }, HEADERS);
    expect(set.ok && set.value.code).toBe("cel+pro");
    expect(count.ok && count.value.code).toBe("count:2");
  });

  it("колонки НЕТ — поле не трогается", () => {
    const parsed = parseOutcomeRow(
      { "Показатель": "lead_style", "Код": "cel" },
      new Set(["Показатель", "Код"]),
    );
    expect(parsed.ok && "feedbackText" in parsed.value).toBe(false);
  });

  it("выгружается из feedback.text", () => {
    const rows = serializeOutcomeRows({
      name: "lead_style",
      configJson: {
        outcomes: [{ code: "cel+pro", label: "Д", text: "Х", feedback: { text: "Совет" } }],
      },
    });
    expect(rows[0]["Рекомендации"]).toBe("Совет");
  });

  it("слияние задаёт текст обратной связи и сохраняет вложения", () => {
    const stored = {
      outcomes: [
        {
          code: "cel+pro",
          feedback: { text: "Старый", format: "html", links: [{ title: "Курс" }] },
        },
      ],
    };
    const merged = mergeOutcomes(stored, [
      { variableName: "lead_style", code: "cel+pro", feedbackText: "Новый" },
    ]);
    expect(merged[0].feedback).toEqual({
      text: "Новый",
      format: "html",
      links: [{ title: "Курс" }],
    });
  });

  it("опустошённая ячейка стирает текст обратной связи, но не вложения", () => {
    const stored = {
      outcomes: [{ code: "cel", feedback: { text: "Старый", links: [{ title: "Курс" }] } }],
    };
    const merged = mergeOutcomes(stored, [
      { variableName: "lead_style", code: "cel", feedbackText: "" },
    ]);
    expect(merged[0].feedback).toEqual({ links: [{ title: "Курс" }] });
  });

  it("обратной связи не было и в книге пусто — поля не появляется", () => {
    const merged = mergeOutcomes({ outcomes: [{ code: "cel" }] }, [
      { variableName: "lead_style", code: "cel", feedbackText: "" },
    ]);
    expect("feedback" in merged[0]).toBe(false);
  });
});
