/**
 * @module tests/report-enabled
 *
 * «Выдавать отчёт обучающемуся» — общая настройка отчёта (PRD-27 §7.1).
 *
 * До неё документ получал КАЖДЫЙ прошедший: маршрут результата ставил `canReport: true`
 * прямо в коде. Поэтому главное здесь — не то, что выключение работает, а то, что
 * ОТСУТСТВИЕ настройки по-прежнему означает «выдавать»: иначе тесты, сохранённые до неё,
 * молча лишились бы отчёта.
 */

import { describe, it, expect } from "vitest";
import { isReportEnabled } from "../shared/schema";
import { buildResultsNav } from "../shared/template/results-nav";

describe("isReportEnabled", () => {
  it("настройки нет — отчёт выдаётся", () => {
    expect(isReportEnabled(null)).toBe(true);
    expect(isReportEnabled(undefined)).toBe(true);
    expect(isReportEnabled({})).toBe(true);
  });

  it("признак не задан — отчёт выдаётся", () => {
    // Так выглядит тест, у которого настроен вид отчёта, но переключателя автор не касался.
    expect(isReportEnabled({ standard: { variantKey: "report.certificate", values: {} } })).toBe(true);
  });

  it("выключает только явное «нет»", () => {
    expect(isReportEnabled({ enabled: false })).toBe(false);
    expect(isReportEnabled({ enabled: true })).toBe(true);
  });

  it("выключение не зависит от режима: признак общий", () => {
    // Документ либо положен слушателю этого теста, либо нет — ветви режима тут ни при чём.
    const settings = {
      enabled: false,
      standard: { variantKey: "a", values: {} },
      adaptive: { variantKey: "b", values: {} },
    };
    expect(isReportEnabled(settings)).toBe(false);
  });
});

describe("кнопка отчёта на экране итогов", () => {
  it("выключенный отчёт убирает действие из подвала", () => {
    // `showReport` — единственный признак, по которому макет рисует «Скачать отчёт»;
    // выключение обязано снимать именно его, а не прятать кнопку стилями.
    expect(buildResultsNav({ canReport: false, canRetry: false, hasPostPages: false }).showReport).toBe(false);
    expect(buildResultsNav({ canReport: true, canRetry: false, hasPostPages: false }).showReport).toBe(true);
  });
});
