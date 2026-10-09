/**
 * @module tests/helpers/sim-runs
 * @description Played runs of the reference quest (`docs/specs/sim-scenario/example`), produced by
 * the REAL engine (`createRun` + clicks on zones), one per outcome.
 *
 * A hand-made `SimResult` is not a run: the web `/finish` replays the protocol (`shared/sim/replay`)
 * and grades what the protocol leads to, so a forged object would be graded differently on the two
 * hosts — through the test's fault, not theirs.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRun, type SimRun } from "@shared/sim/engine";
import { boundsOf } from "@shared/sim/geometry";
import type { Scenario, SimResult, Zone } from "@shared/sim/contract";

export const REFERENCE_SCENARIO = JSON.parse(
  readFileSync(resolve(process.cwd(), "docs/specs/sim-scenario/example/scenario.json"), "utf8"),
) as Scenario;

/** The outcomes a passage can ask for. */
export type SimRunKind = "success" | "partial" | "fail" | "exited" | "timeout";

function zone(scenario: Scenario, id: string): Zone {
  for (const s of scenario.scenes) {
    const z = (s.zones ?? []).find((x) => x.id === id);
    if (z) return z;
  }
  throw new Error(`no zone ${id}`);
}

function hit(scenario: Scenario, run: SimRun, id: string, kind: "click" | "dblclick" = "click") {
  const b = boundsOf(zone(scenario, id));
  return run.click(b.x + b.w / 2, b.y + b.h / 2, kind);
}

/**
 * The main path of the quest. `topic` is a NON-critical goal check (a wrong value gives `partial`),
 * `num` a critical one (a wrong value gives `fail`).
 */
function mainPath(scenario: Scenario, run: SimRun, values: { num: string; topic: string }, tick: () => void) {
  hit(scenario, run, "home-inbox");
  tick();
  hit(scenario, run, "list-create");
  hit(scenario, run, "form-corr");
  hit(scenario, run, "dir-2");
  hit(scenario, run, "sel2-choose");
  run.commitField("num", values.num);
  run.commitField("topic", values.topic);
  hit(scenario, run, "form-exec");
  hit(scenario, run, "exec-1");
  hit(scenario, run, "form-save-close");
  tick();
  hit(scenario, run, "confirm-ok");
}

/** A finished run of `kind`, deterministic: the clock is the test's. */
export function playRun(kind: SimRunKind, scenario: Scenario = REFERENCE_SCENARIO): SimResult {
  let now = 1000;
  const tick = () => {
    now += 5000;
  };
  const run = createRun(scenario, { now: () => now });
  const right = { num: "ВХ-1183", topic: "Запрос коммерческого предложения" };
  if (kind === "success") mainPath(scenario, run, right, tick);
  else if (kind === "partial") mainPath(scenario, run, { ...right, topic: "Не та тема" }, tick);
  else if (kind === "fail") mainPath(scenario, run, { ...right, num: "1183" }, tick);
  else {
    hit(scenario, run, "home-inbox");
    tick();
    if (kind === "exited") run.exit();
    else run.timeout();
  }
  const result = run.result();
  if (result.outcome !== kind) throw new Error(`sim-runs: asked for ${kind}, the run gave ${result.outcome}`);
  return result;
}
