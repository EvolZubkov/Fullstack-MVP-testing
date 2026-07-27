/**
 * @module tests/page-sequences
 * @description PRD-22: computation of page sequences and the `page.*` context
 * (`shared/template/page-sequences`). Pure: no DOM, no DB.
 *
 * These lock the four rules the author never sees but always feels: what counts
 * as one segment of the structure, when adjacent pages form a sequence, why a run
 * of one yields no dots, and that the counter never survives the results screen.
 */
import { describe, it, expect } from "vitest";
import {
  buildSequencePlacements,
  buildPageContext,
  buildPageContextFor,
  collectSequenceIds,
  nextLabelOf,
  sequenceIdOf,
} from "@shared/template/page-sequences";

/** Content page shorthand: `page("a", "before", "Галерея", 0)`. */
function page(
  id: string,
  position: string,
  sequenceId: string | null,
  sortOrder: number,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    kind: "info",
    type: "info",
    topicId: null,
    position,
    sortOrder,
    settingsJson: sequenceId ? { sequenceId } : {},
    ...extra,
  };
}

describe("sequenceIdOf", () => {
  it("reads the identifier from either storage shape and trims it", () => {
    expect(sequenceIdOf(page("a", "before", "  Галерея  ", 0))).toBe("Галерея");
    expect(sequenceIdOf({ id: "b", settings: { sequenceId: "Итоги" } })).toBe("Итоги");
  });

  it("treats an absent, empty or non-string value as «not in a sequence»", () => {
    expect(sequenceIdOf(page("a", "before", null, 0))).toBe("");
    expect(sequenceIdOf({ id: "b", settingsJson: { sequenceId: "   " } })).toBe("");
    expect(sequenceIdOf({ id: "c", settingsJson: { sequenceId: 42 } })).toBe("");
    expect(sequenceIdOf(null)).toBe("");
  });
});

describe("buildSequencePlacements — adjacency (FR-18)", () => {
  it("numbers adjacent pages sharing an identifier", () => {
    const placements = buildSequencePlacements([
      page("p1", "before", "Галерея", 0),
      page("p2", "before", "Галерея", 1),
      page("p3", "before", "Галерея", 2),
    ]);

    expect(placements.get("p1")).toMatchObject({ index: 1, total: 3 });
    expect(placements.get("p2")).toMatchObject({ index: 2, total: 3 });
    expect(placements.get("p3")).toMatchObject({ index: 3, total: 3 });
  });

  it("orders by sortOrder, not by array order", () => {
    const placements = buildSequencePlacements([
      page("late", "before", "Галерея", 5),
      page("early", "before", "Галерея", 1),
    ]);

    expect(placements.get("early")?.index).toBe(1);
    expect(placements.get("late")?.index).toBe(2);
  });

  it("a page with another identifier interrupts the run; the next run is NEW", () => {
    const placements = buildSequencePlacements([
      page("a1", "before", "Галерея", 0),
      page("a2", "before", "Галерея", 1),
      page("mid", "before", "Другая", 2),
      page("a3", "before", "Галерея", 3),
      page("a4", "before", "Галерея", 4),
    ]);

    // Two separate sequences of two, not one of four.
    expect(placements.get("a1")).toMatchObject({ index: 1, total: 2 });
    expect(placements.get("a2")).toMatchObject({ index: 2, total: 2 });
    expect(placements.get("a3")).toMatchObject({ index: 1, total: 2 });
    expect(placements.get("a4")).toMatchObject({ index: 2, total: 2 });
    // The interrupting page is alone under its own identifier — no dots.
    expect(placements.has("mid")).toBe(false);
  });

  it("a page without an identifier also interrupts", () => {
    const placements = buildSequencePlacements([
      page("a1", "before", "Галерея", 0),
      page("plain", "before", null, 1),
      page("a2", "before", "Галерея", 2),
    ]);

    expect(placements.size).toBe(0);
  });
});

describe("buildSequencePlacements — a sequence needs two pages (FR-19)", () => {
  it("a lone page with an identifier yields nothing", () => {
    const placements = buildSequencePlacements([page("only", "before", "Галерея", 0)]);
    expect(placements.size).toBe(0);
  });
});

describe("buildSequencePlacements — segments of the structure (FR-17)", () => {
  it("zones do not join, even with the same identifier", () => {
    const placements = buildSequencePlacements([
      page("before-1", "before", "Галерея", 0),
      page("after-1", "after", "Галерея", 0),
    ]);

    expect(placements.size).toBe(0);
  });

  it("per-topic zones of different topics do not join", () => {
    const placements = buildSequencePlacements([
      page("t1", "before_topic", "Галерея", 0, { topicId: "topic-1" }),
      page("t2", "before_topic", "Галерея", 0, { topicId: "topic-2" }),
    ]);

    expect(placements.size).toBe(0);
  });

  it("«перед темой» and «после темы» of ONE topic do not join", () => {
    const placements = buildSequencePlacements([
      page("pre", "before_topic", "Галерея", 0, { topicId: "topic-1" }),
      page("post", "after_topic", "Галерея", 1, { topicId: "topic-1" }),
    ]);

    expect(placements.size).toBe(0);
  });

  it("the results boundary splits «После теста» in two", () => {
    const placements = buildSequencePlacements([
      page("pre-1", "after", "Галерея", 0),
      page("pre-2", "after", "Галерея", 1),
      { id: "results", kind: "info", type: "summary", topicId: null, position: "after", sortOrder: 2 },
      page("post-1", "after", "Галерея", 3),
      page("post-2", "after", "Галерея", 4),
    ]);

    // Two sequences of two — the counter does not survive the results screen.
    expect(placements.get("pre-1")).toMatchObject({ index: 1, total: 2 });
    expect(placements.get("post-1")).toMatchObject({ index: 1, total: 2 });
    expect(placements.get("post-2")).toMatchObject({ index: 2, total: 2 });
  });

  it("a single page on each side of the results boundary yields nothing", () => {
    const placements = buildSequencePlacements([
      page("pre", "after", "Галерея", 0),
      { id: "results", kind: "info", type: "summary", topicId: null, position: "after", sortOrder: 1 },
      page("post", "after", "Галерея", 2),
    ]);

    expect(placements.size).toBe(0);
  });
});

describe("buildSequencePlacements — system pages never take part", () => {
  it("system nodes are skipped and do not break a run around them", () => {
    const placements = buildSequencePlacements([
      page("a1", "before", "Галерея", 0),
      { id: "start", kind: "start", type: "info", topicId: null, position: "before", sortOrder: 1 },
      page("a2", "before", "Галерея", 2),
    ]);

    // The start screen is a runtime node, not a page of the segment.
    expect(placements.get("a1")).toMatchObject({ index: 1, total: 2 });
    expect(placements.get("a2")).toMatchObject({ index: 2, total: 2 });
  });

  it("the router hub does not take part either", () => {
    const placements = buildSequencePlacements([
      page("a1", "before", "Галерея", 0),
      { id: "hub", kind: "router", type: "info", topicId: null, position: "before", sortOrder: 1 },
      page("a2", "before", "Галерея", 2),
    ]);

    expect(placements.get("a2")).toMatchObject({ index: 2, total: 2 });
  });
});

describe("buildPageContext", () => {
  it("builds one dot per page, marking the current one", () => {
    const ctx = buildPageContext({ index: 2, total: 3, sequenceId: "Галерея" });

    expect(ctx.dotsTotal).toBe(3);
    expect(ctx.dotIndex).toBe(2);
    expect(ctx.dots.map((d) => d.statusClass)).toEqual(["", "is-current", ""]);
  });

  it("a page outside a sequence gets no dots — the layout degrades to a plain page", () => {
    const ctx = buildPageContext(null);

    expect(ctx.dots).toEqual([]);
    expect(ctx.dotIndex).toBe(0);
    expect(ctx.dotsTotal).toBe(0);
  });

  it("canGoBack comes from the host, not from the structure", () => {
    expect(buildPageContext(null).canGoBack).toBe(false);
    expect(buildPageContext(null, { canGoBack: true }).canGoBack).toBe(true);
  });
});

describe("buildPageContextFor", () => {
  it("computes placements and returns one page's context", () => {
    const pages = [page("p1", "before", "Галерея", 0), page("p2", "before", "Галерея", 1)];

    expect(buildPageContextFor("p2", pages, { canGoBack: true })).toEqual({
      dots: [{ statusClass: "" }, { statusClass: "is-current" }],
      dotIndex: 2,
      dotsTotal: 2,
      pageLabel: "Страница 2 из 2",
      progressPercent: 100,
      canGoBack: true,
      nextLabel: "Далее",
    });
  });

  it("an unknown page id yields the empty context", () => {
    expect(buildPageContextFor("nope", [], {}).dots).toEqual([]);
  });
});

// ─── nextLabel: the forward-button caption (FR-26) ────────────────────────────

describe("nextLabelOf", () => {
  const withSettings = (settings: Record<string, unknown> | null) =>
    page("p", "before", null, 0, { settingsJson: settings });

  it("takes the author's caption, trimmed", () => {
    expect(nextLabelOf(withSettings({ nextLabel: "Начать" }))).toBe("Начать");
    expect(nextLabelOf(withSettings({ nextLabel: "  Начать  " }))).toBe("Начать");
    expect(nextLabelOf({ id: "b", settings: { nextLabel: "Дальше" } })).toBe("Дальше");
  });

  it("falls back to «Далее» for a blank, missing or non-string value", () => {
    expect(nextLabelOf(withSettings({ nextLabel: "   " }))).toBe("Далее");
    expect(nextLabelOf(withSettings({}))).toBe("Далее");
    expect(nextLabelOf(withSettings(null))).toBe("Далее");
    expect(nextLabelOf(withSettings({ nextLabel: 42 }))).toBe("Далее");
    expect(nextLabelOf(undefined)).toBe("Далее");
  });

  it("reaches the page context through buildPageContextFor", () => {
    const pages = [
      page("p1", "before", "Галерея", 0),
      page("p2", "before", "Галерея", 1, { settingsJson: { sequenceId: "Галерея", nextLabel: "Начать" } }),
    ];

    expect(buildPageContextFor("p2", pages, {}).nextLabel).toBe("Начать");
    expect(buildPageContextFor("p1", pages, {}).nextLabel).toBe("Далее");
  });

  it("an explicit option wins over the page's own setting", () => {
    const pages = [page("p1", "before", null, 0, { settingsJson: { nextLabel: "Начать" } })];

    expect(buildPageContextFor("p1", pages, { nextLabel: "Вперёд" }).nextLabel).toBe("Вперёд");
  });
});

describe("collectSequenceIds", () => {
  it("lists identifiers in first-appearance order, without duplicates", () => {
    expect(
      collectSequenceIds([
        page("p1", "before", "Галерея", 0),
        page("p2", "before", "Галерея", 1),
        page("p3", "after", "Итоги", 0),
        page("p4", "after", null, 1),
      ]),
    ).toEqual(["Галерея", "Итоги"]);
  });

  it("empty input yields an empty list", () => {
    expect(collectSequenceIds(null)).toEqual([]);
  });
});
