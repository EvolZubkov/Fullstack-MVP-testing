/**
 * @module features/templates/__tests__/preview-rail.test
 * @description Direct branch tests for the preview-rail grouping builder
 * ({@link module:features/templates/preview-rail}). Exercises `buildRail` and,
 * through it, the internal `classify` / `typeLabel` / `groupOf` / `screenLabel`
 * helpers by feeding one screen spec per route family plus the malformed /
 * fallback inputs, and `variantStatus` for the group roll-up. No React or
 * rendering — every case is a pure input -> output assertion.
 */
import { describe, expect, it } from "vitest";
import type { ScreenSpec } from "@shared/template/preview-context";
import type { SmokeRouteResult } from "@shared/template/smoke-runner";
import { buildRail, variantStatus } from "../preview-rail";

// ─── Fixture ──────────────────────────────────────────────────────────────────

/** Build a minimal {@link ScreenSpec} — buildRail only reads id/route/label/variant*. */
function spec(
  route: string,
  id: string = route,
  label?: string,
  variant?: { key: string; label?: string },
): ScreenSpec {
  return {
    id,
    route,
    label,
    variantKey: variant?.key,
    variantLabel: variant?.label,
    layoutKey: "x",
    expectedSlots: [],
    input: { context: {}, slots: {}, content: {} },
  } as unknown as ScreenSpec;
}

/** Flatten the rail into the single group + screen produced for one spec. */
function single(route: string, id: string = route, label?: string) {
  const rail = buildRail([spec(route, id, label)]);
  expect(rail).toHaveLength(1);
  const section = rail[0];
  expect(section.variants).toHaveLength(1);
  const group = section.variants[0];
  expect(group.screens).toHaveLength(1);
  return { section, group, screen: group.screens[0] };
}

/** Build the status map `variantStatus` reads. */
function statuses(rows: Array<[string, SmokeRouteResult["status"]]>): Map<string, SmokeRouteResult> {
  return new Map(rows.map(([id, status]) => [id, { id, route: id, status, errors: [], warnings: [] }]));
}

// ─── classify: section + group keys per route family ──────────────────────────

describe("classify — route → (section, group) grouping", () => {
  it("start route", () => {
    const { section, group } = single("start");
    expect(section.key).toBe("start");
    expect(section.label).toBe("Старт");
    expect(group.key).toBe("start");
    expect(group.label).toBe("Старт");
    expect(group.fromManifest).toBe(false);
  });

  // Regression: PRD-19 nodes had no TYPE_LABELS entry, so the rail fell back to the
  // raw route key and showed the author `review` / `section-results` in English.
  it("PRD-19 section nodes are labelled in Russian, not by their route key", () => {
    const review = single("review", "review", "Обзор раздела");
    expect(review.section.key).toBe("system");
    expect(review.group.label).toBe("Обзор раздела");

    const sectionResults = single("section-results", "section-results", "Итоги раздела");
    expect(sectionResults.section.key).toBe("system");
    expect(sectionResults.group.label).toBe("Итоги раздела");
  });

  // Same defect for the gallery group («certification» previews two slides).
  it("gallery slides group under a Russian label", () => {
    const rail = buildRail([
      spec("content.gallery.1", "gallery-1", "Галерея: список"),
      spec("content.gallery.2", "gallery-2", "Галерея: текст"),
    ]);
    const group = rail[0].variants[0];
    expect(group.key).toBe("content.gallery");
    expect(group.label).toBe("Галерея");
    expect(group.screens.map((s) => s.id)).toEqual(["gallery-1", "gallery-2"]);
  });

  it("content.intro → intro section", () => {
    const { section, group } = single("content.intro");
    expect(section.key).toBe("intro");
    expect(section.label).toBe("Введение раздела");
    expect(group.key).toBe("content.intro");
    expect(group.label).toBe("Введение");
  });

  it("content.summary → summary section", () => {
    const { section, group } = single("content.summary");
    expect(section.key).toBe("summary");
    expect(section.label).toBe("Итог раздела");
    expect(group.key).toBe("content.summary");
    expect(group.label).toBe("Итог");
  });

  it("content.router → router section", () => {
    const { section, group } = single("content.router");
    expect(section.key).toBe("router");
    expect(section.label).toBe("Маршрутизатор");
    expect(group.key).toBe("content.router");
    expect(group.label).toBe("Маршрутизатор");
  });

  it("router (bare) also maps to router section", () => {
    const { section, group } = single("router");
    expect(section.key).toBe("router");
    expect(group.key).toBe("content.router");
  });

  it("content (bare) → info section with generic content group", () => {
    const { section, group } = single("content");
    expect(section.key).toBe("info");
    expect(section.label).toBe("Учебные страницы");
    expect(group.key).toBe("content");
    expect(group.label).toBe("Контент");
  });

  it("content.info → info section with mapped group label", () => {
    const { section, group } = single("content.info");
    expect(section.key).toBe("info");
    expect(group.key).toBe("content.info");
    expect(group.label).toBe("Учебный материал");
  });

  it("unknown content.* sub-kind still lands in info with fallback group label", () => {
    const { section, group } = single("content.custom");
    expect(section.key).toBe("info");
    expect(group.key).toBe("content.custom");
    // typeLabel fallback: no TYPE_LABELS entry → the key itself.
    expect(group.label).toBe("content.custom");
  });

  it("question (bare) → questions section with generic question group", () => {
    const { section, group } = single("question");
    expect(section.key).toBe("questions");
    expect(section.label).toBe("Вопросы");
    expect(group.key).toBe("question");
    expect(group.label).toBe("Вопрос");
  });

  it("question.single/multiple/matching/ranking map to their labels", () => {
    expect(single("question.single").group.label).toBe("Один вариант");
    expect(single("question.multiple").group.label).toBe("Несколько вариантов");
    expect(single("question.matching").group.label).toBe("Сопоставление");
    expect(single("question.ranking").group.label).toBe("Ранжирование");
    expect(single("question.single").section.key).toBe("questions");
  });

  it("results (bare) → results section, group 'results'", () => {
    const { section, group } = single("results");
    expect(section.key).toBe("results");
    expect(section.label).toBe("Результаты теста");
    expect(group.key).toBe("results");
    expect(group.label).toBe("Результаты");
  });

  it("results.adaptive → results section, adaptive group (ternary true branch)", () => {
    const { section, group } = single("results.adaptive");
    expect(section.key).toBe("results");
    expect(group.key).toBe("results.adaptive");
    expect(group.label).toBe("Адаптивные результаты");
  });

  it("results-prefixed but not adaptive → group collapses to 'results' (ternary false branch)", () => {
    const { section, group } = single("results.summary", "results.summary");
    expect(section.key).toBe("results");
    expect(group.key).toBe("results");
  });

  it("system.* → system section, route as group key", () => {
    expect(single("system.blocked").group.label).toBe("Доступ ограничен");
    expect(single("system.transition").group.label).toBe("Переход");
    const { section, group } = single("system.blocked");
    expect(section.key).toBe("system");
    expect(section.label).toBe("Системные экраны");
    expect(group.key).toBe("system.blocked");
  });

  it("bare 'system' (no dot) falls through to the system fallback", () => {
    const { section, group } = single("system");
    expect(section.key).toBe("system");
    expect(group.key).toBe("system");
    // No TYPE_LABELS["system"] → fallback to the key.
    expect(group.label).toBe("system");
  });

  it("completely unknown route → system section, route echoed as group key + label", () => {
    const { section, group } = single("totally-unknown");
    expect(section.key).toBe("system");
    expect(group.key).toBe("totally-unknown");
    expect(group.label).toBe("totally-unknown");
  });
});

// ─── groupOf: the manifest variant is the middle level (Д1) ───────────────────

describe("groupOf — variant-backed screens group by their manifest variant", () => {
  it("names the group from the manifest, not from the route", () => {
    const rail = buildRail([
      spec("content.info", "page-1", "Слайд 1", { key: "gallery.card", label: "Галерея" }),
    ]);
    const group = rail[0].variants[0];
    expect(group.key).toBe("v:gallery.card");
    expect(group.label).toBe("Галерея");
    expect(group.fromManifest).toBe(true);
  });

  it("several demo screens of ONE variant are its demonstrations, not separate variants", () => {
    const v = { key: "gallery.card", label: "Галерея" };
    const rail = buildRail([
      spec("content.info", "page-1", "Слайд 1", v),
      spec("content.info", "page-2", "Слайд 2", v),
      spec("content.info", "page-3", "Слайд 3", v),
    ]);
    expect(rail[0].variants).toHaveLength(1);
    expect(rail[0].variants[0].screens.map((s) => s.id)).toEqual(["page-1", "page-2", "page-3"]);
  });

  it("distinct variants of one kind stay separate groups under the same section", () => {
    const rail = buildRail([
      spec("content.info", "a", "A", { key: "info.text", label: "Текст" }),
      spec("content.info", "b", "B", { key: "info.image-left", label: "Текст, изображение слева" }),
    ]);
    expect(rail[0].variants.map((v) => v.label)).toEqual(["Текст", "Текст, изображение слева"]);
  });

  it("falls back to the variant key when the manifest declares no label", () => {
    const rail = buildRail([spec("content.info", "a", "A", { key: "info.text" })]);
    expect(rail[0].variants[0].label).toBe("info.text");
  });

  it("falls back to the variant key when the manifest label is whitespace-only", () => {
    const rail = buildRail([spec("content.info", "a", "A", { key: "info.text", label: "  " })]);
    expect(rail[0].variants[0].label).toBe("info.text");
  });

  // The `v:` namespace exists so a variant key equal to a route-derived type key
  // cannot silently swallow the route group (and vice versa).
  it("a variant key equal to a route type key does not merge with it", () => {
    const rail = buildRail([
      spec("content.info", "routed"),
      spec("content.info", "varianted", "B", { key: "content.info", label: "Учебная" }),
    ]);
    expect(rail[0].variants.map((v) => v.key)).toEqual(["content.info", "v:content.info"]);
  });
});

// ─── screenLabel: label?.trim() || route ──────────────────────────────────────

describe("screenLabel — leaf display name", () => {
  it("uses a non-empty label verbatim", () => {
    expect(single("start", "start", "Экран старта").screen.label).toBe("Экран старта");
  });

  it("trims surrounding whitespace from the label", () => {
    expect(single("start", "start", "  Экран старта  ").screen.label).toBe("Экран старта");
  });

  it("falls back to the route when the label is whitespace-only", () => {
    expect(single("start", "start", "   ").screen.label).toBe("start");
  });

  it("falls back to the route when the label is absent", () => {
    expect(single("start", "start", undefined).screen.label).toBe("start");
  });

  it("carries id/route/spec through onto the screen", () => {
    const s = spec("question.single", "q-1", "Вопрос 1");
    const rail = buildRail([s]);
    const screen = rail[0].variants[0].screens[0];
    expect(screen.id).toBe("q-1");
    expect(screen.route).toBe("question.single");
    expect(screen.spec).toBe(s);
  });
});

// ─── buildRail: grouping / dedup / ordering ───────────────────────────────────

describe("buildRail — grouping and ordering", () => {
  it("returns an empty rail for no specs", () => {
    expect(buildRail([])).toEqual([]);
  });

  it("nests multiple demonstrations under one shared group (existing-group branch)", () => {
    const rail = buildRail([
      spec("question.single", "q-a", "Радио-список"),
      spec("question.single", "q-b", "Карточки"),
    ]);
    expect(rail).toHaveLength(1);
    expect(rail[0].variants).toHaveLength(1);
    expect(rail[0].variants[0].screens.map((s) => s.id)).toEqual(["q-a", "q-b"]);
  });

  it("keeps distinct groups under one section (existing-section, new-group branch)", () => {
    const rail = buildRail([
      spec("question.single", "q-s"),
      spec("question.multiple", "q-m"),
    ]);
    expect(rail).toHaveLength(1);
    expect(rail[0].key).toBe("questions");
    expect(rail[0].variants.map((v) => v.key)).toEqual(["question.single", "question.multiple"]);
  });

  it("sorts sections into the canonical SECTION_ORDER regardless of input order", () => {
    const rail = buildRail([
      spec("results", "r"),
      spec("question.single", "q"),
      spec("start", "s"),
      spec("content.intro", "ci"),
    ]);
    expect(rail.map((s) => s.key)).toEqual(["start", "intro", "questions", "results"]);
  });

  it("preserves declaration order of demonstrations within a group", () => {
    const rail = buildRail([
      spec("question.single", "first"),
      spec("question.single", "second"),
      spec("question.single", "third"),
    ]);
    expect(rail[0].variants[0].screens.map((s) => s.id)).toEqual(["first", "second", "third"]);
  });
});

// ─── variantStatus: worst-of roll-up ──────────────────────────────────────────

describe("variantStatus — group dot", () => {
  const group = buildRail([
    spec("content.info", "a", "A", { key: "g", label: "Г" }),
    spec("content.info", "b", "B", { key: "g", label: "Г" }),
  ])[0].variants[0];

  it("is pass when every demonstration passes", () => {
    expect(variantStatus(group, statuses([["a", "pass"], ["b", "pass"]]))).toBe("pass");
  });

  it("is warn when one demonstration warns", () => {
    expect(variantStatus(group, statuses([["a", "pass"], ["b", "warn"]]))).toBe("warn");
  });

  it("is fail when one demonstration fails, whatever the others say", () => {
    expect(variantStatus(group, statuses([["a", "warn"], ["b", "fail"]]))).toBe("fail");
    expect(variantStatus(group, statuses([["a", "fail"], ["b", "warn"]]))).toBe("fail");
  });

  it("is undefined while any demonstration has no result yet", () => {
    expect(variantStatus(group, statuses([["a", "pass"]]))).toBeUndefined();
    expect(variantStatus(group, statuses([]))).toBeUndefined();
  });
});
