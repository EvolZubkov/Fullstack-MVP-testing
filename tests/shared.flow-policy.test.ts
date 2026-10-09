/**
 * @module tests/shared.flow-policy
 *
 * One normalisation of `flow_policy_json` for both hosts. The cases below are the
 * ones the hosts used to answer differently — an unknown mode, router gating outside
 * router mode, an absent completion policy — so a change here is a change to what
 * BOTH the package and the web run do.
 */
import { describe, it, expect } from "vitest";
import { resolveFlowPolicy } from "../shared/flow/flow-policy";

describe("flow-policy — mode", () => {
  it("falls back to linear_flat on absence, null and an unknown mode", () => {
    // FR-40: a row this build cannot read still delivers its questions.
    expect(resolveFlowPolicy(undefined).mode).toBe("linear_flat");
    expect(resolveFlowPolicy(null).mode).toBe("linear_flat");
    expect(resolveFlowPolicy({}).mode).toBe("linear_flat");
    expect(resolveFlowPolicy({ mode: "from_the_future" }).mode).toBe("linear_flat");
  });

  it("keeps the two sectional modes as authored", () => {
    expect(resolveFlowPolicy({ mode: "linear_by_topics" }).mode).toBe("linear_by_topics");
    expect(resolveFlowPolicy({ mode: "router_by_topics" }).mode).toBe("router_by_topics");
  });
});

const RULES = { t2: { mode: "after_sections_completed", sectionIds: ["t1"] } };

describe("flow-policy — router gating", () => {
  it("defaults the completion policy to the softer rule in router mode", () => {
    expect(resolveFlowPolicy({ mode: "router_by_topics" })).toEqual({
      mode: "router_by_topics",
      routerCompletionPolicy: "all_required_completed",
    });
  });

  // THE shape the editor writes (`buildFlowPolicyForPayload`) and the workbook import
  // writes. It is the reason this test exists: the bake read the flat keys, nothing
  // ever wrote them, and the author's gating reached no runtime at all.
  it("reads the AUTHORED nested `router` object", () => {
    expect(
      resolveFlowPolicy({
        mode: "router_by_topics",
        router: { completionPolicy: "all_required_passed", sectionUnlockRules: RULES },
      }),
    ).toEqual({
      mode: "router_by_topics",
      routerCompletionPolicy: "all_required_passed",
      sectionUnlockRules: RULES,
    });
  });

  it("still reads the flat keys a hand-written or migrated row may carry", () => {
    expect(
      resolveFlowPolicy({
        mode: "router_by_topics",
        routerCompletionPolicy: "all_required_passed",
        sectionUnlockRules: RULES,
      }),
    ).toEqual({
      mode: "router_by_topics",
      routerCompletionPolicy: "all_required_passed",
      sectionUnlockRules: RULES,
    });
  });

  // The package ships this object verbatim as TEST_DATA.flowPolicy, so a key that
  // appears where it has no meaning rewrites the bytes of every non-router package.
  it("omits the router fields entirely outside router mode", () => {
    const resolved = resolveFlowPolicy({
      mode: "linear_by_topics",
      router: { completionPolicy: "all_required_passed", sectionUnlockRules: RULES },
    });
    expect(resolved).toEqual({ mode: "linear_by_topics" });
    expect("routerCompletionPolicy" in resolved).toBe(false);
    expect("sectionUnlockRules" in resolved).toBe(false);
  });

  // The editor saves an EMPTY map for every router test; emitting it would rewrite the
  // bytes of every router package that has no rules at all.
  it("omits sectionUnlockRules when the author set none", () => {
    expect("sectionUnlockRules" in resolveFlowPolicy({ mode: "router_by_topics" })).toBe(false);
    expect(
      "sectionUnlockRules" in
        resolveFlowPolicy({ mode: "router_by_topics", router: { sectionUnlockRules: {} } }),
    ).toBe(false);
  });
});
