/**
 * @module tests/sim-replay-scoring
 * @description How a «Сценарий в ИС» run is graded (`shared/sim/scoring`, `shared/scoring/engine`)
 * and why the server can trust it (`shared/sim/replay`): a played run replays to the very same
 * result, while a posted outcome its own protocol does not lead to is graded by the protocol.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRun, type SimRun } from "@shared/sim/engine";
import { boundsOf } from "@shared/sim/geometry";
import { replayRun } from "@shared/sim/replay";
import { DEFAULT_SIM_PENALTIES, simulationRatio } from "@shared/sim/scoring";
import { scoreAnswer } from "@shared/scoring/engine";
import type { Scenario, Zone } from "@shared/sim/contract";

const scenario = JSON.parse(
  readFileSync(resolve(process.cwd(), "docs/specs/sim-scenario/example/scenario.json"), "utf8"),
) as Scenario;

function zone(id: string): Zone {
  for (const s of scenario.scenes) {
    const z = (s.zones ?? []).find((x) => x.id === id);
    if (z) return z;
  }
  throw new Error(`no zone ${id}`);
}

function hit(run: SimRun, id: string, kind: "click" | "dblclick" = "click") {
  const b = boundsOf(zone(id));
  return run.click(b.x + b.w / 2, b.y + b.h / 2, kind);
}

/** The main path of the reference quest, with one miss and one wrong value on the way. */
function playSuccess(): ReturnType<SimRun["result"]> {
  let now = 1000;
  const run = createRun(scenario, { now: () => now });
  hit(run, "home-inbox");
  now += 2000;
  run.click(5, 5); // a miss
  hit(run, "list-create");
  hit(run, "form-corr");
  hit(run, "dir-2");
  hit(run, "sel2-choose");
  run.commitField("num", "1183"); // wrong: no prefix
  run.commitField("num", "ВХ-1183");
  run.commitField("topic", "Запрос коммерческого предложения");
  hit(run, "form-exec");
  hit(run, "exec-1");
  hit(run, "form-save-close");
  now += 30_000;
  hit(run, "confirm-ok");
  return run.result();
}

describe("оценка прогона", () => {
  it("success без ошибок — вся цена", () => {
    expect(simulationRatio({ outcome: "success", counts: {} })).toBe(1);
  });

  it("штрафы — доля цены за каждый промах, неверное значение, ловушку", () => {
    const ratio = simulationRatio({ outcome: "success", counts: { misses: 2, wrongValues: 1, traps: 1 } });
    expect(ratio).toBeCloseTo(1 - 2 * DEFAULT_SIM_PENALTIES.miss - DEFAULT_SIM_PENALTIES.wrongValue - DEFAULT_SIM_PENALTIES.trap);
  });

  it("partial — доля цели минус штрафы; fail, exited, timeout — ноль; ниже нуля не опускается", () => {
    expect(simulationRatio({ outcome: "partial", goal: { share: 0.6 }, counts: { misses: 1 } })).toBeCloseTo(0.58);
    for (const outcome of ["fail", "exited", "timeout"]) expect(simulationRatio({ outcome, counts: {} })).toBe(0);
    expect(simulationRatio({ outcome: "success", counts: { traps: 10 } })).toBe(0);
  });

  it("не прогон (нет ответа) — ноль", () => {
    expect(simulationRatio(undefined)).toBe(0);
    expect(simulationRatio("success")).toBe(0);
  });

  it("движок оценки берёт долю цены сценария, а не градуированные способы", () => {
    const res = scoreAnswer({ type: "simulation", correct: {}, answer: { outcome: "success", counts: { misses: 1 } }, scoring: { kind: "weighted", weights: [5] } as never });
    expect(res.ratio).toBeCloseTo(1 - DEFAULT_SIM_PENALTIES.miss);
  });
});

describe("переигрывание протокола", () => {
  it("честный прогон переигрывается в тот же исход, те же счётчики и то же время", () => {
    const played = playSuccess();
    expect(played.outcome).toBe("success");
    const { result, consistent } = replayRun(scenario, played);
    expect(consistent).toBe(true);
    expect(result.outcome).toBe(played.outcome);
    expect(result.counts).toEqual(played.counts);
    expect(result.durationMs).toBe(played.durationMs);
    expect(result.fields).toEqual(played.fields);
  });

  it("подделанный исход без протокола к нему оценивается по протоколу", () => {
    const played = playSuccess();
    // Тот же протокол, оборванный до финала, и приписанный успех.
    const cut = played.events.findIndex((e) => e.type === "action" && e.id === "confirm-ok");
    const forged = { ...played, outcome: "success" as const, events: played.events.slice(0, cut) };
    const { result, consistent } = replayRun(scenario, forged);
    expect(consistent).toBe(false);
    expect(result.outcome).toBe("exited");
    expect(simulationRatio(result)).toBe(0);
  });

  it("исход без протокола вовсе — участник вышел", () => {
    const { result, consistent } = replayRun(scenario, { outcome: "success", counts: {}, events: [] });
    expect(consistent).toBe(false);
    expect(result.outcome).toBe("exited");
  });

  it("действие, которого на текущей сцене нет, — протокол не этого сценария", () => {
    const played = playSuccess();
    const forged = { ...played, events: [played.events[0], { t: 10, type: "action", scene: "home", id: "confirm-ok", role: "path" }] };
    expect(replayRun(scenario, forged).consistent).toBe(false);
  });
});
