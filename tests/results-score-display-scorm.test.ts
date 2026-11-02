// @vitest-environment jsdom
/**
 * @module tests/results-score-display-scorm
 *
 * Переключатели «Сводка баллов» и «Полоса балла» в пакете: рантайм читает их со страницы
 * «Итоги теста» и отдаёт общему построителю ВНЕ `measures` — у контрольного теста `measures`
 * нет вовсе, а скрыть кольцо он должен мочь так же, как на вебе.
 *
 * Рантайм пакета — рукописный плоский JS, не модуль, поэтому источник исполняется с
 * подставленными глобалями, как в остальных тестах экрана итогов.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const viewResultsSrc = fs.readFileSync(
  path.resolve(process.cwd(), "server/scorm/template/app/render/viewResults.js"),
  "utf8",
);

/** Исполнить рантайм с подставленным TEST_DATA и прочитать переключатели. */
function scoreDisplayOf(settings: Record<string, unknown> | null) {
  const factory = new Function("TEST_DATA", `${viewResultsSrc}\nreturn scoreDisplayOf();`);
  const contentPages = settings ? [{ kind: "results", settings }] : [];
  return factory({ title: "Тест", contentPages }) as Record<string, unknown> | null;
}

describe("рантайм пакета — переключатели сводки и полосы балла", () => {
  it("отдаёт оба переключателя страницы итогов", () => {
    expect(scoreDisplayOf({ scoreSummary: "hide", scoreBar: "show", headingPassed: "x" })).toEqual({
      scoreSummary: "hide",
      scoreBar: "show",
    });
  });

  it("нетронутые настройки и отсутствие страницы не дают ничего", () => {
    expect(scoreDisplayOf({ headingPassed: "x" })).toBeNull();
    expect(scoreDisplayOf(null)).toBeNull();
  });

  it("оба экрана итогов пакета передают переключатели построителю", () => {
    // «Мой результат» и экран сразу после завершения собирают опции порознь.
    expect(viewResultsSrc.match(/opts\.scoreDisplay = scoreDisplay;/g)).toHaveLength(2);
  });
});
