/**
 * @module tests/metrics.test
 * @description The in-process counter registry (server/metrics): increment creates
 * on first use and accumulates, getCounter reads (0 when absent), getCounters
 * snapshots. Uses a test-unique counter name so the process-global map does not
 * couple this suite to others.
 */
import { describe, it, expect } from "vitest";
import { incrementCounter, getCounter, getCounters } from "../server/metrics";

describe("metrics counter registry", () => {
  const name = "test.metrics_spec_counter";

  it("getCounter returns 0 for an unknown counter", () => {
    expect(getCounter("test.never_touched_counter")).toBe(0);
  });

  it("incrementCounter creates on first use and accumulates", () => {
    expect(incrementCounter(name)).toBe(1);
    expect(incrementCounter(name, 4)).toBe(5);
    expect(getCounter(name)).toBe(5);
  });

  it("getCounters snapshots the current values", () => {
    incrementCounter(name);
    const snapshot = getCounters();
    expect(snapshot[name]).toBe(getCounter(name));
    // Snapshot is a copy — mutating it does not affect the registry.
    snapshot[name] = -999;
    expect(getCounter(name)).not.toBe(-999);
  });
});
