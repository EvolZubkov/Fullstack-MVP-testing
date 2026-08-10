// @vitest-environment jsdom
/**
 * @module tests/results-ipsative-scorm
 *
 * PRD-46 §5, последнее звено проводки в пакете: рантайм ОТДАЁТ признак ипсативности из
 * запечённых данных в общий сборщик итогов. Сам он его не выводит — строк вкладов и
 * бюджетов распределения в пакете нет, и второе правило «что считается ипсативным»
 * разошлось бы с веб-хостом (PRD-29 §9).
 *
 * Рантайм пакета — рукописный плоский JS, не модуль, поэтому источник исполняется с
 * подставленными глобалями, как в остальных тестах экрана итогов.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseScaleInterpretation, parseIndicatorInterpretation } from "../shared/scales/interpretation";
import { LEVEL_SCHEMES } from "../shared/template/level-ramp";

const viewResultsSrc = fs.readFileSync(
  path.resolve(process.cwd(), "server/scorm/template/app/render/viewResults.js"),
  "utf8",
);

const SCALE = {
  key: "cel",
  label: "Целеустремлённый",
  learnerVisibility: "level_and_value",
  sortOrder: 0,
  domainMin: 0,
  domainMax: 98,
  bands: [],
};

/** Исполнить рантайм с подставленным TEST_DATA и достать сборщик измерений. */
function measuresOf(testData: Record<string, unknown>) {
  (window as unknown as { TBTemplate: unknown }).TBTemplate = {
    parseScaleInterpretation,
    parseIndicatorInterpretation,
    LEVEL_SCHEMES,
  };
  const factory = new Function(
    "TEST_DATA",
    `${viewResultsSrc}\nreturn buildResultsMeasures(null, null);`,
  );
  return factory({ title: "ЧИЛ", scales: [SCALE], ...testData }) as Record<string, unknown> | null;
}

describe("рантайм пакета — признак ипсативности (PRD-46)", () => {
  it("отдаёт запечённый признак в сборщик итогов", () => {
    expect(measuresOf({ ipsativeScales: true })!.ipsativeScales).toBe(true);
  });

  it("пакет без ключа читается как «не ипсативна» — собранный до PRD-46 рисует прежнее", () => {
    expect(measuresOf({})!.ipsativeScales).toBe(false);
  });
});
