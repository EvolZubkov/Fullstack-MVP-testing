/**
 * @module client/src/lib/__tests__/magic-scope
 * @description Tests for the client-side scope-violation flag: it starts clear,
 * notifies subscribers when raised, stays raised, and unsubscribes cleanly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isScopeViolation,
  raiseScopeViolation,
  resetScopeViolation,
  subscribeScopeViolation,
} from "../magic-scope";

describe("magic scope violation flag", () => {
  beforeEach(() => resetScopeViolation());

  it("starts clear", () => {
    expect(isScopeViolation()).toBe(false);
  });

  it("notifies subscribers when raised", () => {
    const seen = vi.fn();
    subscribeScopeViolation(seen);
    raiseScopeViolation();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(isScopeViolation()).toBe(true);
  });

  it("does not notify twice for a repeated violation", () => {
    const seen = vi.fn();
    subscribeScopeViolation(seen);
    raiseScopeViolation();
    raiseScopeViolation();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("stops notifying after unsubscribe", () => {
    const seen = vi.fn();
    const off = subscribeScopeViolation(seen);
    off();
    raiseScopeViolation();
    expect(seen).not.toHaveBeenCalled();
  });
});
