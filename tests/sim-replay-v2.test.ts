/**
 * @module tests/sim-replay-v2
 * @description «Я закончил» survives the LMS protocol and the server replay; a protocol without it
 * is still written as version 1, so packages of control scenarios stay byte-identical.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRun } from "@shared/sim/engine";
import { replayRun } from "@shared/sim/replay";
import { decodeProtocol, encodeProtocol } from "@shared/sim/protocol-codec";
import type { Scenario } from "@shared/sim/contract";

const v1 = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/sim/scenario-v1.json"), "utf8"));

const research: Scenario = {
  format: "skillum.sim-scenario", version: 2, kind: "research",
  meta: { title: "R", task: "T" }, media: [],
  variants: [{ device: "desktop", stage: { w: 10, h: 10 }, start: "a", scenes: [
    { id: "a", title: "A", elements: [], zones: [{ id: "go", x: 0, y: 0, w: 5, h: 5, effects: [{ goto: "b" }] }] },
    { id: "b", title: "B", elements: [], zones: [{ id: "back", x: 0, y: 0, w: 5, h: 5, effects: [{ goto: "a" }] }] },
  ] }],
};

describe("«Я закончил» в протоколе", () => {
  it("кодируется буквой d версии 2 и читается обратно", () => {
    let clock = 0;
    const run = createRun(research, { now: () => clock });
    clock = 100; run.click(1, 1);
    clock = 250; run.declare();
    const r = run.result();
    const encoded = encodeProtocol(r.events, r.durationMs);
    expect(encoded.startsWith("2;")).toBe(true);
    const decoded = decodeProtocol(encoded)!;
    expect(decoded.events.map((e) => e.type)).toEqual(["action", "declare"]);
    expect(replayRun(research, { events: decoded.events }).result.outcome).toBe("declared");
  });

  it("протокол без d пишется версией 1, как раньше", () => {
    const run = createRun(v1, { now: () => 0 });
    run.exit();
    expect(encodeProtocol(run.result().events, 0).startsWith("1;")).toBe(true);
  });

  it("буква d в протоколе версии 1 — повреждение", () => {
    expect(decodeProtocol("1;d@0")).toBeNull();
  });
});

describe("переигрывание", () => {
  it("исход declared переигрывается и сходится с присланным", () => {
    const run = createRun(research, { now: () => 0 });
    run.declare();
    const verdict = replayRun(research, run.result());
    expect(verdict.consistent).toBe(true);
    expect(verdict.result.outcome).toBe("declared");
  });
});
