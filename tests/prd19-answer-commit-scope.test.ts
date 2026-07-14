/**
 * @module tests/prd19-answer-commit-scope
 *
 * PRD-19 (Block B) golden contract test for the answer-commit granularity.
 *
 * Both runtime hosts read a single resolved `answerCommitScope` value rather than
 * each re-deriving it from the flow mode: the SCORM exporter
 * (`server/scorm/builders/test-json.ts`) and the web learner host (via the
 * attempt start / resume responses in `server/routes/attempts.ts`) both call
 * {@link resolveAnswerCommitScope}. This test pins the resolver's truth table so
 * the two hosts cannot drift — the same (mode, flowMode) MUST map to the same
 * scope on both sides.
 */

import { describe, it, expect } from "vitest";
import {
  resolveAnswerCommitScope,
  type AnswerCommitScope,
} from "@shared/flow/answer-commit-scope";

describe("PRD-19 resolveAnswerCommitScope — single cross-host contract", () => {
  const cases: Array<{
    mode: string | null | undefined;
    flowMode: string | null | undefined;
    expected: AnswerCommitScope;
    why: string;
  }> = [
    // Flat flow → test scope (no learner-facing sections).
    { mode: "standard", flowMode: "linear_flat", expected: "test", why: "flat" },
    { mode: "standard", flowMode: undefined, expected: "test", why: "missing flow → flat default" },
    { mode: "standard", flowMode: null, expected: "test", why: "null flow → flat default" },
    // Sectional flows → section scope (freeze per section on exit).
    { mode: "standard", flowMode: "linear_by_topics", expected: "section", why: "sectional linear" },
    { mode: "standard", flowMode: "router_by_topics", expected: "section", why: "sectional router" },
    // Adaptive ALWAYS commits at test scope (skip/return inapplicable, FR-22) —
    // even when combined with a sectional flow mode.
    { mode: "adaptive", flowMode: "linear_flat", expected: "test", why: "adaptive flat" },
    { mode: "adaptive", flowMode: "linear_by_topics", expected: "test", why: "adaptive overrides sectional" },
    { mode: "adaptive", flowMode: "router_by_topics", expected: "test", why: "adaptive overrides router" },
    // Missing mode defaults to standard.
    { mode: undefined, flowMode: "linear_by_topics", expected: "section", why: "missing mode → standard" },
    { mode: null, flowMode: "linear_flat", expected: "test", why: "null mode → standard" },
  ];

  for (const c of cases) {
    it(`mode=${String(c.mode)} flow=${String(c.flowMode)} → ${c.expected} (${c.why})`, () => {
      expect(resolveAnswerCommitScope({ mode: c.mode, flowMode: c.flowMode })).toBe(c.expected);
    });
  }

  it("returns only the two valid scope literals", () => {
    const scopes = new Set(cases.map((c) => resolveAnswerCommitScope({ mode: c.mode, flowMode: c.flowMode })));
    for (const s of scopes) expect(["test", "section"]).toContain(s);
  });

  it("is a pure function — identical inputs yield identical output (host-agnostic)", () => {
    // The drift guard: calling it the way the SCORM exporter does and the way the
    // web attempts route does must agree for the same test configuration.
    const scormSide = resolveAnswerCommitScope({ mode: "standard", flowMode: "router_by_topics" });
    const webSide = resolveAnswerCommitScope({ mode: "standard", flowMode: "router_by_topics" });
    expect(scormSide).toBe(webSide);
    expect(scormSide).toBe("section");
  });
});
