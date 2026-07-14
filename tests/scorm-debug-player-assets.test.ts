/**
 * @module tests/scorm-debug-player-assets
 * @description Phase-2 parity test: the SCORM 2004 RTE shim and the real-time
 * inspector live in ONE place (`server/scorm/debug-player/assets`) and the CLI
 * player inlines exactly those bytes — no second copy that could drift between
 * the CLI player and the in-service debug player (PRD-18 FR-13, R-1). The test
 * file is excluded from `tsc` (`**\/*.test.ts`), so the JS-only `.mjs` import is
 * resolved by Vitest only.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readDebugPlayerAssets } from "../server/scorm/debug-player/player-assets.mjs";

describe("debug-player shared assets — single source of shim + inspector", () => {
  const { shimJs, computeJs, inspectorJs } = readDebugPlayerAssets();

  it("exposes the SCORM 2004 RTE on window with cmi persistence", () => {
    expect(shimJs).toContain("window.API_1484_11 = API_1484_11");
    for (const fn of ["Initialize", "Terminate", "GetValue", "SetValue", "Commit", "GetLastError"]) {
      expect(shimJs).toContain(fn + ": function");
    }
    // Persisted across reloads so the shim can report resume vs ab-initio.
    expect(shimJs).toMatch(/localStorage\.setItem/);
  });

  it("exposes the compute layer on window.TBInspector with the shared builders", () => {
    expect(computeJs).toContain("window.TBInspector =");
    for (const fn of ["buildProtocolRows", "buildScaleRows", "buildResultRows", "buildScore", "buildDraw", "applyReference", "clearReference", "humanizeTraffic", "priceFor"]) {
      expect(computeJs).toContain(fn);
    }
  });

  it("renders inspector data into the CLI player page and consumes TBInspector (no logic copy)", () => {
    expect(inspectorJs).toContain('getElementById("inspector")');
    expect(inspectorJs).toContain("window.TBInspector");
    // The render delegates pricing to the compute layer — it must NOT re-implement it.
    expect(inspectorJs).toContain("TB.buildProtocolRows");
    expect(inspectorJs).not.toContain("ScoringEngine.scoreAnswer");
  });
});

describe("CLI player consumes the shared assets (no drift — FR-13/R-1)", () => {
  const cli = fs.readFileSync(path.resolve("scripts/scorm-player.mjs"), "utf8");

  it("imports the shared module and inlines the shim + compute + render in order", () => {
    expect(cli).toContain('from "../server/scorm/debug-player/player-assets.mjs"');
    expect(cli).toContain("readDebugPlayerAssets()");
    expect(cli).toContain("${shimJs}");
    expect(cli).toContain("${computeJs}");
    expect(cli).toContain("${inspectorJs}");
    // compute must precede the render (the render reads window.TBInspector).
    expect(cli.indexOf("${computeJs}")).toBeLessThan(cli.indexOf("${inspectorJs}"));
  });

  it("keeps NO inline copy of the RTE shim (single source)", () => {
    expect(cli).not.toContain("window.API_1484_11 = API_1484_11");
  });
});
