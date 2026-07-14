/**
 * @module tests/services/content-pages-lifecycle
 * @description Unit tests for system-page planning (PRD-1 §4.3.5, PRD-7 §1.4,
 * PRD-19 contract §3.2). Covers all four flowMode directions, add/remove topic in
 * per-topic modes, router/section-results lifecycle, the `review` singleton, and
 * parameter transfer when `kind: questions` collapses (N→1) or expands (1→N).
 *
 * PRD-19: the legacy per-topic `intro`/`summary` system pages are no longer planned
 * (section intro/summary is authored as `info` pages; the section boundary screens
 * are the `review` (обзор) + `section-results` (итоги раздела) system NODES — both
 * test-level singletons; section-results only in per-topic modes).
 */
import { describe, it, expect } from "vitest";
import type { TemplateManifest, VariantKind } from "../../shared/schema";
import {
  planSystemPages,
  type ExistingSystemPage,
  type DesiredTestState,
  type FlowMode,
  type SystemKind,
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

// Both fixtures declare every system kind the planner manages so all bindings
// resolve and the full lifecycle is exercised (start/results/review/section-results
// singletons + questions; `full` adds router).
const SYSTEM_CTS: Array<{ key: string; kind: VariantKind; isDefault?: boolean }> = [
  { key: "start.standard", kind: "start" },
  { key: "results.standard", kind: "results" },
  { key: "question.standard", kind: "questions", isDefault: true },
  { key: "review.standard", kind: "review" },
  { key: "section-results.standard", kind: "section-results" },
];

const defaultTemplate = manifest("default", SYSTEM_CTS);
const fullTemplate = manifest("full", [...SYSTEM_CTS, { key: "router.standard", kind: "router" }]);

function state(
  flowMode: FlowMode,
  topicIds: string[],
  template = fullTemplate,
): DesiredTestState {
  return { flowMode, topicIds, template, defaultTemplate };
}

function row(
  id: string,
  kind: SystemKind,
  topicId: string | null,
  templateKey: string,
  valuesJson: Record<string, unknown> = {},
): ExistingSystemPage {
  return { id, kind, topicId, templateKey, valuesJson };
}

/** The four test-level singletons that exist in every per-topic steady state. */
function singletons(): ExistingSystemPage[] {
  return [
    row("start-1", "start", null, "start.standard"),
    row("results-1", "results", null, "results.standard"),
    row("review-1", "review", null, "review.standard"),
    row("sr-1", "section-results", null, "section-results.standard"),
  ];
}

// ─── Empty-state creation (new test) ──────────────────────────────────────────

describe("planSystemPages — initial creation (no existing rows)", () => {
  it("linear_flat: start + results + review + flat questions; no section-results, no router, no intro/summary", () => {
    const plan = planSystemPages([], state("linear_flat", ["t1", "t2"]));
    const created = plan.create.map((c) => ({ kind: c.kind, topicId: c.topicId }));
    expect(created).toContainEqual({ kind: "start", topicId: null });
    expect(created).toContainEqual({ kind: "results", topicId: null });
    expect(created).toContainEqual({ kind: "review", topicId: null });
    expect(created).toContainEqual({ kind: "questions", topicId: null });
    // Flat tests have no sections → no section-results; not router → no router.
    expect(plan.create.some((c) => c.kind === "section-results")).toBe(false);
    expect(plan.create.some((c) => c.kind === "router")).toBe(false);
    // PRD-19: legacy intro/summary are never planned.
    expect(plan.create.some((c) => c.kind === "intro" || c.kind === "summary")).toBe(false);
    expect(plan.delete).toEqual([]);
    expect(plan.keep).toEqual([]);
  });

  it("linear_by_topics: per-topic questions + review + section-results singletons; no router, no intro/summary", () => {
    const plan = planSystemPages([], state("linear_by_topics", ["t1", "t2"]));
    expect(plan.create.filter((c) => c.kind === "questions").map((c) => c.topicId)).toEqual(["t1", "t2"]);
    // review + section-results are test-level singletons (topicId null), one each.
    expect(plan.create.filter((c) => c.kind === "review").map((c) => c.topicId)).toEqual([null]);
    expect(plan.create.filter((c) => c.kind === "section-results").map((c) => c.topicId)).toEqual([null]);
    expect(plan.create.some((c) => c.kind === "router")).toBe(false);
    expect(plan.create.some((c) => c.kind === "intro" || c.kind === "summary")).toBe(false);
  });

  it("router_by_topics: router + review + section-results + N per-topic questions", () => {
    const plan = planSystemPages([], state("router_by_topics", ["t1", "t2"]));
    const kinds = plan.create.map((c) => c.kind);
    expect(kinds).toContain("router");
    expect(kinds).toContain("review");
    expect(kinds).toContain("section-results");
    expect(kinds.filter((k) => k === "questions").length).toBe(2);
  });

  it("creates single test-level start + results singletons bound to the template", () => {
    const plan = planSystemPages([], state("linear_flat", ["t1"]));
    const start = plan.create.filter((c) => c.kind === "start");
    expect(start).toHaveLength(1);
    expect(start[0].topicId).toBeNull();
    expect(start[0].templateKey).toBe("start.standard");
    const results = plan.create.filter((c) => c.kind === "results");
    expect(results).toHaveLength(1);
    expect(results[0].topicId).toBeNull();
    expect(results[0].templateKey).toBe("results.standard");
  });

  it("router cannot be created when neither template nor default declares it", () => {
    const noRouter = manifest("no-router", SYSTEM_CTS); // no router kind
    const plan = planSystemPages([], {
      ...state("router_by_topics", ["t1"]),
      template: noRouter,
    });
    expect(plan.create.find((c) => c.kind === "router")).toBeUndefined();
    // review/section-results are present in the template — no fallback used.
    expect(plan.create.find((c) => c.kind === "review")?.bindingHints.fallbackUsed).toBe(false);
    expect(plan.create.find((c) => c.kind === "section-results")?.bindingHints.fallbackUsed).toBe(false);
  });

  it("binds review/section-results to the default-template fallback when the test template lacks them", () => {
    const minimal = manifest("minimal", [{ key: "q", kind: "questions", isDefault: true }]);
    const plan = planSystemPages([], {
      flowMode: "linear_by_topics",
      topicIds: ["t1"],
      template: minimal,
      defaultTemplate,
    });
    expect(plan.create.find((c) => c.kind === "review")?.bindingHints.fallbackUsed).toBe(true);
    expect(plan.create.find((c) => c.kind === "section-results")?.bindingHints.fallbackUsed).toBe(true);
  });
});

// ─── flowMode transitions ────────────────────────────────────────────────────

describe("planSystemPages — flowMode transitions", () => {
  it("linear_flat → linear_by_topics: flat questions expand per-topic; section-results appears; singletons kept", () => {
    const existing = [
      row("start-1", "start", null, "start.standard"),
      row("results-1", "results", null, "results.standard"),
      row("review-1", "review", null, "review.standard"),
      row("q-flat", "questions", null, "question.standard", { color: "blue" }),
    ];
    const plan = planSystemPages(existing, state("linear_by_topics", ["t1", "t2"]));

    expect(plan.delete.map((d) => d.id)).toEqual(["q-flat"]);
    const newQ = plan.create.filter((c) => c.kind === "questions");
    expect(newQ.map((c) => c.topicId)).toEqual(["t1", "t2"]);
    expect(newQ.every((c) => (c.valuesJson as { color?: string }).color === "blue")).toBe(true);
    // entering per-topic mode creates the section-results singleton; review/start/results kept.
    expect(plan.create.filter((c) => c.kind === "section-results").map((c) => c.topicId)).toEqual([null]);
    expect(plan.keep.map((k) => k.id).sort()).toEqual(["results-1", "review-1", "start-1"]);
  });

  it("linear_by_topics → linear_flat: per-topic questions collapse; section-results removed; review kept", () => {
    const existing = [
      ...singletons(),
      row("q-t1", "questions", "t1", "question.standard", { tag: "alpha" }),
      row("q-t2", "questions", "t2", "question.standard", { tag: "beta" }),
    ];
    const plan = planSystemPages(existing, state("linear_flat", ["t1", "t2"]));

    // leaving per-topic mode removes the section-results singleton + collapses questions.
    expect(plan.delete.map((d) => d.id).sort()).toEqual(["q-t1", "q-t2", "sr-1"]);
    const newFlat = plan.create.find((c) => c.kind === "questions");
    expect(newFlat?.topicId).toBeNull();
    expect((newFlat?.valuesJson as { tag?: string }).tag).toBe("alpha");
    expect(plan.create.some((c) => c.kind === "intro" || c.kind === "summary")).toBe(false);
    expect(plan.keep.map((k) => k.id).sort()).toEqual(["results-1", "review-1", "start-1"]);
  });

  it("linear_by_topics → router_by_topics: keeps singletons + per-topic questions, adds router", () => {
    const existing = [
      ...singletons(),
      row("q-t1", "questions", "t1", "question.standard"),
      row("q-t2", "questions", "t2", "question.standard"),
    ];
    const plan = planSystemPages(existing, state("router_by_topics", ["t1", "t2"]));

    expect(plan.delete).toEqual([]);
    expect(plan.create.map((c) => c.kind)).toEqual(["router"]);
    expect(plan.keep.map((k) => k.id).sort()).toEqual(
      ["q-t1", "q-t2", "results-1", "review-1", "sr-1", "start-1"],
    );
  });

  it("router_by_topics → linear_by_topics: removes router, keeps singletons + per-topic rows", () => {
    const existing = [
      ...singletons(),
      row("router-1", "router", null, "router.standard"),
      row("q-t1", "questions", "t1", "question.standard"),
      row("q-t2", "questions", "t2", "question.standard"),
    ];
    const plan = planSystemPages(existing, state("linear_by_topics", ["t1", "t2"]));

    expect(plan.delete.map((d) => d.id)).toEqual(["router-1"]);
    expect(plan.create).toEqual([]);
    expect(plan.keep.map((k) => k.id).sort()).toEqual(
      ["q-t1", "q-t2", "results-1", "review-1", "sr-1", "start-1"],
    );
  });

  it("router_by_topics → linear_flat: removes router + section-results, collapses questions, keeps start/results/review", () => {
    const existing = [
      ...singletons(),
      row("router-1", "router", null, "router.standard"),
      row("q-t1", "questions", "t1", "question.standard", { x: 1 }),
      row("q-t2", "questions", "t2", "question.standard", { x: 2 }),
    ];
    const plan = planSystemPages(existing, state("linear_flat", ["t1", "t2"]));

    expect(plan.delete.map((d) => d.id).sort()).toEqual(["q-t1", "q-t2", "router-1", "sr-1"]);
    const newFlat = plan.create.find((c) => c.kind === "questions");
    expect(newFlat?.topicId).toBeNull();
    expect((newFlat?.valuesJson as { x?: number }).x).toBe(1);
    expect(plan.keep.map((k) => k.id).sort()).toEqual(["results-1", "review-1", "start-1"]);
  });
});

// ─── Topic add / remove inside per-topic mode ────────────────────────────────

describe("planSystemPages — topic lifecycle in per-topic modes", () => {
  it("adding a topic creates only its questions row; test-level singletons untouched", () => {
    const existing = [
      ...singletons(),
      row("q-t1", "questions", "t1", "question.standard"),
    ];
    const plan = planSystemPages(existing, state("linear_by_topics", ["t1", "t2"]));

    expect(plan.keep.map((k) => k.id).sort()).toEqual(
      ["q-t1", "results-1", "review-1", "sr-1", "start-1"],
    );
    expect(plan.delete).toEqual([]);
    expect(plan.create.map((c) => ({ kind: c.kind, topicId: c.topicId }))).toEqual([
      { kind: "questions", topicId: "t2" },
    ]);
  });

  it("removing a topic deletes only its questions row; singletons + other topics kept", () => {
    const existing = [
      ...singletons(),
      row("q-t1", "questions", "t1", "question.standard"),
      row("q-t2", "questions", "t2", "question.standard"),
      row("q-t3", "questions", "t3", "question.standard"),
    ];
    const plan = planSystemPages(existing, state("linear_by_topics", ["t1", "t3"]));

    expect(plan.delete.map((d) => d.id)).toEqual(["q-t2"]);
    expect(plan.create).toEqual([]);
    expect(plan.keep.map((k) => k.id).sort()).toEqual(
      ["q-t1", "q-t3", "results-1", "review-1", "sr-1", "start-1"],
    );
  });
});

// ─── Idempotency: re-running plan against own output is a no-op ──────────────

describe("planSystemPages — idempotency", () => {
  it("a second pass against a steady state produces no creates or deletes", () => {
    const existing = [
      ...singletons(),
      row("router-1", "router", null, "router.standard"),
      row("q-t1", "questions", "t1", "question.standard"),
      row("q-t2", "questions", "t2", "question.standard"),
    ];
    const plan = planSystemPages(existing, state("router_by_topics", ["t1", "t2"]));
    expect(plan.create).toEqual([]);
    expect(plan.delete).toEqual([]);
    expect(plan.keep.map((k) => k.id).sort()).toEqual(
      ["q-t1", "q-t2", "results-1", "review-1", "router-1", "sr-1", "start-1"],
    );
  });
});

// ─── Duplicate cleanup ────────────────────────────────────────────────────────

describe("planSystemPages — duplicate singleton rows", () => {
  it("when two review rows exist, keeps the first and deletes the rest", () => {
    const existing = [
      row("start-1", "start", null, "start.standard"),
      row("results-1", "results", null, "results.standard"),
      row("review-a", "review", null, "review.standard"),
      row("review-b", "review", null, "review.standard"),
      row("sr-1", "section-results", null, "section-results.standard"),
      row("q-t1", "questions", "t1", "question.standard"),
    ];
    const plan = planSystemPages(existing, state("linear_by_topics", ["t1"]));
    expect(plan.delete.map((d) => d.id)).toEqual(["review-b"]);
    expect(plan.keep.map((k) => k.id).sort()).toEqual(
      ["q-t1", "results-1", "review-a", "sr-1", "start-1"],
    );
  });
});

// ─── intro («Введение раздела») per-topic lifecycle (PRD-1 §4.3) ──────────────

describe("planSystemPages — intro («Введение раздела») lifecycle", () => {
  const withIntro = manifest("with-intro", [...SYSTEM_CTS, { key: "intro.standard", kind: "intro" }]);
  const stIntro = (flowMode: FlowMode, topicIds: string[]): DesiredTestState => ({
    flowMode,
    topicIds,
    template: withIntro,
    defaultTemplate: withIntro,
  });

  it("creates one intro row per topic in per-topic modes", () => {
    const plan = planSystemPages([], stIntro("linear_by_topics", ["t1", "t2"]));
    expect(plan.create.filter((c) => c.kind === "intro").map((c) => c.topicId)).toEqual(["t1", "t2"]);
  });

  it("creates no intro rows in linear_flat (no sections)", () => {
    const plan = planSystemPages([], stIntro("linear_flat", ["t1"]));
    expect(plan.create.some((c) => c.kind === "intro")).toBe(false);
  });

  it("adds intro for a new topic, removes intro for a dropped topic", () => {
    const existing = [
      row("intro-t1", "intro", "t1", "intro.standard"),
      row("intro-t2", "intro", "t2", "intro.standard"),
    ];
    const plan = planSystemPages(existing, stIntro("linear_by_topics", ["t1", "t3"]));
    expect(plan.create.filter((c) => c.kind === "intro").map((c) => c.topicId)).toEqual(["t3"]);
    expect(plan.delete.map((d) => d.id)).toContain("intro-t2");
    expect(plan.keep.map((k) => k.id)).toContain("intro-t1");
  });

  it("removes intro rows on transition to linear_flat", () => {
    const existing = [row("intro-t1", "intro", "t1", "intro.standard")];
    const plan = planSystemPages(existing, stIntro("linear_flat", ["t1"]));
    expect(plan.delete.map((d) => d.id)).toContain("intro-t1");
    expect(plan.create.some((c) => c.kind === "intro")).toBe(false);
  });
});
