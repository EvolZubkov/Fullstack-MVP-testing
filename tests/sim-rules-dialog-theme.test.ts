/**
 * @module tests/sim-rules-dialog-theme
 * @description «Сценарий в ИС» в пакете: окно правил сценария живёт в палитре пакета.
 *
 * Поставщик темы дизайн-системы в пакете — `<html class="ou ou--dark|ou--light">`
 * (`templateCore.applyDsThemeClass`). Окно правил прежде монтировалось в контейнер с голым классом
 * `ou`: правило DS `.ou` заново объявляет СВЕТЛЫЕ токены и цвет текста, и в тёмной палитре окно
 * получало тёмный фон с тёмным текстом — читать было нечего. Исполняется ИСХОДНЫЙ `simulation.js`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderSimRulesDialog, simRules } from "@shared/sim/cover";
import type { Scenario } from "@shared/sim/contract";

const simulationSrc = readFileSync(resolve(process.cwd(), "server/scorm/template/app/render/simulation.js"), "utf8");

const scenario = {
  format: "skillum.sim-scenario",
  version: 1,
  meta: { title: "Регистрация", task: "Внесите запись" },
  media: [],
  fields: [],
  start: "s",
  scenes: [{ id: "s", elements: [], zones: [] }],
} as unknown as Scenario;

/** `TBSimRun` из исходного файла с минимальным окружением пакета. */
function loadSimRun(): { openRules(fq: unknown): void } {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function("TEST_DATA", "state", "TBTemplate", `${simulationSrc}\nreturn TBSimRun;`)(
    { mode: "standard" },
    { answers: {}, questionStatuses: {}, flatQuestions: [], currentIndex: 0 },
    { renderSimRulesDialog, simRules },
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.className = "";
});

describe("окно правил сценария в пакете", () => {
  it("не объявляет свою тему поверх темы пакета: ближайший `.ou` — `<html>`", () => {
    document.documentElement.className = "ou ou--dark";
    loadSimRun().openRules({ question: { id: "q", data: { scenario } }, topicId: "t1" });

    const dialog = document.querySelector(".tb-sim-modal");
    expect(dialog).not.toBeNull();
    expect(dialog!.parentElement!.closest(".ou")).toBe(document.documentElement);
  });
});
