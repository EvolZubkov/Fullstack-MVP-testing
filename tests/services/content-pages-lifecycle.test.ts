/**
 * @module tests/services/content-pages-lifecycle
 * @description Unit tests for system-page planning (PRD-1 §4.3.5, PRD-7 §1.4).
 * Covers all four flowMode directions, add/remove topic in per-topic modes,
 * router-row lifecycle, and parameter transfer when `kind: questions`
 * collapses (N→1) or expands (1→N).
 */
import { describe, it, expect } from "vitest";
import type { TemplateManifest, VariantKind } from "../../shared/schema";
import {
  planSystemPages,
  type ExistingSystemPage,
  type DesiredTestState,
  type FlowMode,
} from "../../server/services/content-pages-lifecycle";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function manifest(
  id: string,
  contentTemplates: Array<{ key: string; kind: VariantKind; isDefault?: boolean }>,
): TemplateManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    templateApiVersion: "1.0",
    contentTemplates: contentTemplates.map((ct) => ({ label: ct.key, ...ct })),
  } as unknown as TemplateManifest;
}

const defaultTemplate = manifest("default", [
  { key: "question.standard", kind: "questions", isDefault: true },
  { key: "intro.simple",      kind: "intro" },
  { key: "info.text",         kind: "info" },
  { key: "summary.text",      kind: "summary" },
]);

const fullTemplate = manifest("full", [
  { key: "question.standard", kind: "questions", isDefault: true },
  { key: "router.standard",   kind: "router" },
  { key: "intro.simple",      kind: "intro" },
  { key: "summary.text",      kind: "summary" },
]);

function state(
  flowMode: FlowMode,
  topicIds: string[],
  template = fullTemplate,
): DesiredTestState {
  return { flowMode, topicIds, template, defaultTemplate };
}

function row(
  id: string,
  kind: "intro" | "summary" | "router" | "questions",
  topicId: string | null,
  templateKey: string,
  valuesJson: Record<string, unknown> = {},
): ExistingSystemPage {
  return { id, kind, topicId, templateKey, valuesJson };
}

// ─── Empty-state creation (new test) ──────────────────────────────────────────

describe("planSystemPages — initial creation (no existing rows)", () => {
  it("linear_flat creates only the flat questions row — no section intro/summary, no router", () => {
    const plan = planSystemPages([], state("linear_flat", ["t1", "t2"]));
    expect(plan.delete).toEqual([]);
    expect(plan.keep).toEqual([]);
    expect(plan.create.map((c) => ({ kind: c.kind, topicId: c.topicId }))).toEqual([
      { kind: "questions", topicId: null },
    ]);
  });

  it("linear_by_topics creates per-topic intro + summary + questions", () => {
    const plan = planSystemPages([], state("linear_by_topics", ["t1", "t2"]));
    expect(plan.create.filter((c) => c.kind === "intro").map((c) => c.topicId)).toEqual(["t1", "t2"]);
    expect(plan.create.filter((c) => c.kind === "summary").map((c) => c.topicId)).toEqual(["t1", "t2"]);
    expect(plan.create.filter((c) => c.kind === "questions").map((c) => c.topicId)).toEqual(["t1", "t2"]);
  });

  it("creates single test-level start + results pages when the template declares them", () => {
    // start (landing, До теста) and results (final results, После теста) are
    // singletons bound like intro/summary.
    const withStartResults = manifest("with-sr", [
      { key: "start.standard",    kind: "start" },
      { key: "results.standard",  kind: "results" },
      { key: "question.standard", kind: "questions", isDefault: true },
      { key: "intro.simple",      kind: "intro" },
      { key: "summary.text",      kind: "summary" },
    ]);
    const plan = planSystemPages([], {
      flowMode: "linear_flat",
      topicIds: ["t1"],
      template: withStartResults,
      defaultTemplate: withStartResults,
    });
    const start = plan.create.filter((c) => c.kind === "start");
    expect(start).toHaveLength(1);
    expect(start[0].topicId).toBeNull();
    expect(start[0].templateKey).toBe("start.standard");

    const results = plan.create.filter((c) => c.kind === "results");
    expect(results).toHaveLength(1);
    expect(results[0].topicId).toBeNull();
    expect(results[0].templateKey).toBe("results.standard");
  });

  it("linear_by_topics creates intro + summary + N per-topic questions, no router", () => {
    const plan = planSystemPages([], state("linear_by_topics", ["t1", "t2", "t3"]));
    const kinds = plan.create.map((c) => c.kind);
    expect(kinds.filter((k) => k === "questions").length).toBe(3);
    expect(kinds.includes("router")).toBe(false);
    expect(plan.create.filter((c) => c.kind === "questions").map((c) => c.topicId))
      .toEqual(["t1", "t2", "t3"]);
  });

  it("router_by_topics creates intro + summary + router + N per-topic questions", () => {
    const plan = planSystemPages([], state("router_by_topics", ["t1", "t2"]));
    const kinds = plan.create.map((c) => c.kind);
    expect(kinds.includes("router")).toBe(true);
    expect(kinds.filter((k) => k === "questions").length).toBe(2);
  });

  it("bindingHints.fallbackUsed reflects missing kind in template", () => {
    // template without `router` → falls back. defaultTemplate also lacks
    // router, so we cannot create the row at all.
    const noRouter = manifest("no-router", [
      { key: "q", kind: "questions", isDefault: true },
      { key: "i", kind: "intro" },
      { key: "s", kind: "summary" },
    ]);
    const plan = planSystemPages([], {
      ...state("router_by_topics", ["t1"]),
      template: noRouter,
    });
    // router cannot be created (defaultTemplate also lacks router):
    expect(plan.create.find((c) => c.kind === "router")).toBeUndefined();
    // intro/summary are present in template — no fallback:
    expect(plan.create.find((c) => c.kind === "intro")?.bindingHints.fallbackUsed).toBe(false);
  });
});

// ─── flowMode transitions ────────────────────────────────────────────────────

describe("planSystemPages — flowMode transitions", () => {
  it("linear_flat → linear_by_topics: flat questions expand per-topic; section intro/summary appear", () => {
    const flatRow = row("q-flat", "questions", null, "question.standard", { color: "blue" });
    // linear_flat has no section intro/summary, so the only existing row is the flat questions.
    const plan = planSystemPages([flatRow], state("linear_by_topics", ["t1", "t2"]));

    expect(plan.delete.map((d) => d.id)).toEqual(["q-flat"]);
    const newQ = plan.create.filter((c) => c.kind === "questions");
    expect(newQ.map((c) => c.topicId)).toEqual(["t1", "t2"]);
    expect(newQ.every((c) => (c.valuesJson as { color?: string }).color === "blue")).toBe(true);
    expect(plan.create.filter((c) => c.kind === "intro").map((c) => c.topicId)).toEqual(["t1", "t2"]);
    expect(plan.create.filter((c) => c.kind === "summary").map((c) => c.topicId)).toEqual(["t1", "t2"]);
  });

  it("linear_by_topics → linear_flat: per-topic rows collapse; questions carry first values; no intro/summary", () => {
    const existing = [
      row("intro-t1",   "intro",   "t1", "intro.simple"),
      row("summary-t1", "summary", "t1", "summary.text"),
      row("q-t1",       "questions", "t1", "question.standard", { tag: "alpha" }),
      row("q-t2",       "questions", "t2", "question.standard", { tag: "beta" }),
    ];
    const plan = planSystemPages(existing, state("linear_flat", ["t1", "t2"]));

    expect(plan.delete.map((d) => d.id).sort()).toEqual(["intro-t1", "q-t1", "q-t2", "summary-t1"]);
    const newFlat = plan.create.find((c) => c.kind === "questions");
    expect(newFlat?.topicId).toBeNull();
    expect((newFlat?.valuesJson as { tag?: string }).tag).toBe("alpha");
    expect(plan.create.some((c) => c.kind === "intro" || c.kind === "summary")).toBe(false);
  });

  it("linear_by_topics → router_by_topics: keeps per-topic rows, adds router", () => {
    const existing = [
      row("intro-t1",   "intro",   "t1", "intro.simple"),
      row("intro-t2",   "intro",   "t2", "intro.simple"),
      row("summary-t1", "summary", "t1", "summary.text"),
      row("summary-t2", "summary", "t2", "summary.text"),
      row("q-t1",       "questions", "t1", "question.standard"),
      row("q-t2",       "questions", "t2", "question.standard"),
    ];
    const plan = planSystemPages(existing, state("router_by_topics", ["t1", "t2"]));

    expect(plan.delete).toEqual([]);
    expect(plan.create.map((c) => c.kind)).toEqual(["router"]);
    expect(plan.keep.map((k) => k.id).sort()).toEqual(
      ["intro-t1", "intro-t2", "q-t1", "q-t2", "summary-t1", "summary-t2"],
    );
  });

  it("router_by_topics → linear_by_topics: removes router, keeps per-topic rows", () => {
    const existing = [
      row("intro-t1",   "intro",   "t1", "intro.simple"),
      row("intro-t2",   "intro",   "t2", "intro.simple"),
      row("summary-t1", "summary", "t1", "summary.text"),
      row("summary-t2", "summary", "t2", "summary.text"),
      row("router-1",   "router",  null, "router.standard"),
      row("q-t1",       "questions", "t1", "question.standard"),
      row("q-t2",       "questions", "t2", "question.standard"),
    ];
    const plan = planSystemPages(existing, state("linear_by_topics", ["t1", "t2"]));

    expect(plan.delete.map((d) => d.id)).toEqual(["router-1"]);
    expect(plan.create).toEqual([]);
    expect(plan.keep.map((k) => k.id).sort()).toEqual(
      ["intro-t1", "intro-t2", "q-t1", "q-t2", "summary-t1", "summary-t2"],
    );
  });

  it("router_by_topics → linear_flat: removes router + section rows, collapses questions", () => {
    const existing = [
      row("intro-t1",   "intro",   "t1", "intro.simple"),
      row("summary-t1", "summary", "t1", "summary.text"),
      row("router-1",   "router",  null, "router.standard"),
      row("q-t1",       "questions", "t1", "question.standard", { x: 1 }),
      row("q-t2",       "questions", "t2", "question.standard", { x: 2 }),
    ];
    const plan = planSystemPages(existing, state("linear_flat", ["t1", "t2"]));

    expect(plan.delete.map((d) => d.id).sort()).toEqual(
      ["intro-t1", "q-t1", "q-t2", "router-1", "summary-t1"],
    );
    const newFlat = plan.create.find((c) => c.kind === "questions");
    expect(newFlat?.topicId).toBeNull();
    expect((newFlat?.valuesJson as { x?: number }).x).toBe(1);
    expect(plan.create.some((c) => c.kind === "intro" || c.kind === "summary")).toBe(false);
  });
});

// ─── Topic add / remove inside per-topic mode ────────────────────────────────

describe("planSystemPages — topic lifecycle in per-topic modes", () => {
  it("adding a topic creates new intro/summary/questions rows for it; existing rows untouched", () => {
    const existing = [
      row("intro-t1",   "intro",   "t1", "intro.simple"),
      row("summary-t1", "summary", "t1", "summary.text"),
      row("q-t1",       "questions", "t1", "question.standard"),
    ];
    const plan = planSystemPages(existing, state("linear_by_topics", ["t1", "t2"]));

    expect(plan.keep.map((k) => k.id).sort()).toEqual(["intro-t1", "q-t1", "summary-t1"]);
    expect(plan.delete).toEqual([]);
    expect(plan.create.filter((c) => c.kind === "questions").map((c) => c.topicId)).toEqual(["t2"]);
    expect(plan.create.filter((c) => c.kind === "intro").map((c) => c.topicId)).toEqual(["t2"]);
    expect(plan.create.filter((c) => c.kind === "summary").map((c) => c.topicId)).toEqual(["t2"]);
  });

  it("removing a topic deletes its intro/summary/questions rows; other rows kept", () => {
    const existing = [
      row("intro-t1",   "intro",   "t1", "intro.simple"),
      row("intro-t2",   "intro",   "t2", "intro.simple"),
      row("intro-t3",   "intro",   "t3", "intro.simple"),
      row("summary-t1", "summary", "t1", "summary.text"),
      row("summary-t2", "summary", "t2", "summary.text"),
      row("summary-t3", "summary", "t3", "summary.text"),
      row("q-t1",       "questions", "t1", "question.standard"),
      row("q-t2",       "questions", "t2", "question.standard"),
      row("q-t3",       "questions", "t3", "question.standard"),
    ];
    const plan = planSystemPages(existing, state("linear_by_topics", ["t1", "t3"]));

    expect(plan.delete.map((d) => d.id).sort()).toEqual(["intro-t2", "q-t2", "summary-t2"]);
    expect(plan.create).toEqual([]);
    expect(plan.keep.map((k) => k.id).sort()).toEqual(
      ["intro-t1", "intro-t3", "q-t1", "q-t3", "summary-t1", "summary-t3"],
    );
  });
});

// ─── Idempotency: re-running plan against own output is a no-op ──────────────

describe("planSystemPages — idempotency", () => {
  it("a second pass against a steady state produces no creates or deletes", () => {
    const existing = [
      row("intro-t1",   "intro",   "t1", "intro.simple"),
      row("intro-t2",   "intro",   "t2", "intro.simple"),
      row("summary-t1", "summary", "t1", "summary.text"),
      row("summary-t2", "summary", "t2", "summary.text"),
      row("router-1",   "router",  null, "router.standard"),
      row("q-t1",       "questions", "t1", "question.standard"),
      row("q-t2",       "questions", "t2", "question.standard"),
    ];
    const plan = planSystemPages(existing, state("router_by_topics", ["t1", "t2"]));
    expect(plan.create).toEqual([]);
    expect(plan.delete).toEqual([]);
    expect(plan.keep.map((k) => k.id).sort()).toEqual(
      ["intro-t1", "intro-t2", "q-t1", "q-t2", "router-1", "summary-t1", "summary-t2"],
    );
  });
});

// ─── Duplicate cleanup ────────────────────────────────────────────────────────

describe("planSystemPages — duplicate per-topic rows", () => {
  it("when two intro rows exist for one topic, keeps the first and deletes the rest", () => {
    const existing = [
      row("intro-a",    "intro",   "t1", "intro.simple"),
      row("intro-b",    "intro",   "t1", "intro.simple"),
      row("summary-t1", "summary", "t1", "summary.text"),
      row("q-t1",       "questions", "t1", "question.standard"),
    ];
    const plan = planSystemPages(existing, state("linear_by_topics", ["t1"]));
    expect(plan.keep.map((k) => k.id).sort()).toEqual(["intro-a", "q-t1", "summary-t1"]);
    expect(plan.delete.map((d) => d.id)).toEqual(["intro-b"]);
  });
});
