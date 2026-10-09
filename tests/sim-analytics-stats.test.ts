/**
 * @module tests/sim-analytics-stats
 * @description «Сценарий в ИС», этап Э5б: аналитика вопроса-сценария
 * (`server/services/analytics/simulation-stats.ts`). Прогоны получены настоящим движком на примере
 * сценария (`docs/specs/sim-scenario/example`), так что проверяется и разбор протокола, и карта
 * промахов по состояниям экрана: промах при открытом сообщении об ошибке — отдельное состояние с
 * этим слоем на подложке.
 */
import { describe, it, expect } from "vitest";
import { createRun } from "@shared/sim/engine";
import type { Scenario, SimResult } from "@shared/sim/contract";
import example from "../docs/specs/sim-scenario/example/scenario.json";
import { buildSimulationStats, readSimRun, simulationSpread } from "../server/services/analytics/simulation-stats";

const scenario = example as unknown as Scenario;

/** Пройти сценарий до успеха с одним промахом по полю «Корреспондент» и открытым сообщением об ошибке. */
function successRun(): SimResult {
  let clock = 0;
  const run = createRun(scenario, { now: () => (clock += 1000) });
  run.click(170, 366);                 // Входящие
  run.click(130, 180);                 // Создать
  run.click(900, 276);                 // промах: щелчок по самому полю «Корреспондент»
  run.key("Ctrl+S");                   // сохранение раньше времени — открывается сообщение об ошибке
  run.click(900, 276);                 // промах при открытом сообщении
  run.click(1430, 276);                // справочник
  run.click(900, 624);                 // выделить ООО «Ромашка»
  run.click(1094, 984);                // Выбрать
  run.commitField("num", "ВХ-1183");
  run.commitField("topic", "Запрос коммерческого предложения");
  run.click(1430, 708);                // исполнитель
  run.click(900, 852);                 // Петрова
  run.click(190, 126);                 // Сохранить и закрыть
  run.click(970, 690);                 // ОК
  return run.result();
}

/** Уйти в «Исходящие» и выйти досрочно. */
function detourExit(): SimResult {
  let clock = 0;
  const run = createRun(scenario, { now: () => (clock += 1000) });
  run.click(170, 438);                 // Исходящие — шаг в сторону
  run.exit();
  return run.result();
}

const fact = (answer: unknown, earned: number | null = null) => ({ answer, earnedPoints: earned, possiblePoints: earned === null ? null : 1, latencyMs: null });

describe("чтение прогона", () => {
  it("полный результат, компактный и шаги performance из выгрузки LMS", () => {
    const full = successRun();
    expect(readSimRun(full)?.events?.length).toBeGreaterThan(0);
    expect(readSimRun({ outcome: "partial", goal: { share: 0.5 }, counts: { misses: 2 } })).toMatchObject({ outcome: "partial", goalShare: 0.5, events: null });
    const lms = readSimRun("outcome[.]success[,]goal[.]100[,]misses[.]1[,]blocked[.]0[,]wrong[.]0[,]detours[.]1[,]traps[.]0[,]hints[.]0");
    expect(lms).toMatchObject({ outcome: "success", goalShare: 1, counts: { misses: 1, detours: 1 }, events: null });
    expect(readSimRun("ответ")).toBeNull();
    expect(readSimRun(null)).toBeNull();
  });

  it("разброс исходов для таблицы вопросов — доли прогонов", () => {
    const spread = simulationSpread([successRun(), detourExit(), "outcome[.]fail[,]goal[.]0"]);
    expect(spread?.answered).toBe(3);
    expect(spread?.options.map((o) => [o.key, Math.round(o.share)])).toEqual([
      ["success", 33], ["partial", 0], ["fail", 33], ["exited", 33], ["timeout", 0],
    ]);
  });
});

describe("аналитика вопроса-сценария", () => {
  const stats = buildSimulationStats(scenario, [
    fact(successRun(), 0.9),
    fact(detourExit(), 0),
    fact("outcome[.]success[,]goal[.]100[,]misses[.]3", 1),
  ]);

  it("исходы и плитки — по всем прогонам, разбор — только по прогонам с протоколом", () => {
    expect(stats.runs).toBe(3);
    expect(stats.withProtocol).toBe(2);
    expect(stats.outcomes.find((o) => o.outcome === "success")?.runs).toBe(2);
    expect(stats.outcomes.find((o) => o.outcome === "exited")?.runs).toBe(1);
    expect(stats.meanShare).toBeCloseTo((0.9 + 0 + 1) / 3, 10);
    expect(stats.misses.perRun).toBeCloseTo((2 + 0 + 3) / 3, 10);
  });

  it("сцены: основной путь по порядку, шаг в сторону — в конце с пометкой", () => {
    const ids = stats.scenes.map((s) => s.id);
    expect(ids.slice(0, 3)).toEqual(["home", "list", "form"]);
    const outgoing = stats.scenes.find((s) => s.id === "outgoing");
    expect(outgoing).toMatchObject({ onPath: false, flag: { kind: "detour" } });
    expect(stats.scenes.find((s) => s.id === "form")?.reached).toBe(1);
  });

  it("типичные ошибки: шаг в сторону и недоступное сохранение", () => {
    const kinds = stats.errors.map((e) => e.kind).sort();
    expect(kinds).toContain("detour");
    expect(kinds).toContain("blocked");
  });

  it("карта промахов: вид при входе и отдельное состояние с открытым сообщением об ошибке", () => {
    const form = stats.missMap.filter((s) => s.sceneId === "form");
    expect(form.map((s) => s.stateLabel)).toEqual([null, "+ «save-error»"]);
    expect(form[0].points).toEqual([[900, 276]]);
    expect(form[1].points).toEqual([[900, 276]]);
    expect(form[0].layers.map((l) => l.file)).toEqual(["media/form.png"]);
    expect(form[1].layers.map((l) => l.file)).toEqual(["media/form.png", "media/save-error.png"]);
    // У каждой сцены разбора есть вид при входе — и у той, где промахов не было.
    expect(stats.missMap.find((s) => s.sceneId === "home")?.points).toEqual([]);
    expect(stats.missRuns).toBe(1);
  });
});
