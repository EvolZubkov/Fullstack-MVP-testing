/**
 * @module features/templates/__tests__/preview-rail.test
 * @description Direct branch tests for the preview-rail grouping builder
 * ({@link module:features/templates/preview-rail}). Exercises `buildRail` and,
 * through it, the internal `classify` / `typeLabel` / `groupOf` / `screenLabel`
 * helpers by feeding one screen spec per route family plus the malformed /
 * fallback inputs, and `variantStatus` for the group roll-up. No React or
 * rendering — every case is a pure input -> output assertion.
 *
 * Taxonomy: TWO top sections — «Системные экраны» (`system`) and «Пользовательские
 * страницы» (`user`). Within a section the middle level is the TYPE; question kinds,
 * learning pages and galleries collapse under one type node («варианты одного типа»),
 * so a variant is a demonstration leaf, not a separate middle level.
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
  it("start route → system section", () => {
    const { section, group } = single("start");
    expect(section.key).toBe("system");
    expect(section.label).toBe("Системные экраны");
    expect(group.key).toBe("start");
    expect(group.label).toBe("Старт");
    expect(group.fromManifest).toBe(false);
  });

  it("PRD-19 section nodes are labelled in Russian, under the system section", () => {
    const review = single("review", "review", "Обзор раздела");
    expect(review.section.key).toBe("system");
    expect(review.group.key).toBe("review");
    expect(review.group.label).toBe("Обзор раздела");

    const sectionResults = single("section-results", "section-results", "Итоги раздела");
    expect(sectionResults.section.key).toBe("system");
    expect(sectionResults.group.label).toBe("Итоги раздела");
  });

  it("the four question kinds collapse under ONE «Вопрос» type in the system section", () => {
    const rail = buildRail([
      spec("question.single", "q1", "Одиночный выбор"),
      spec("question.multiple", "q2", "Множественный выбор"),
      spec("question.matching", "q3", "Сопоставление"),
      spec("question.ranking", "q4", "Ранжирование"),
    ]);
    expect(rail).toHaveLength(1);
    expect(rail[0].key).toBe("system");
    expect(rail[0].variants).toHaveLength(1);
    const group = rail[0].variants[0];
    expect(group.key).toBe("question");
    expect(group.label).toBe("Вопрос");
    expect(group.screens.map((s) => s.label)).toEqual([
      "Одиночный выбор",
      "Множественный выбор",
      "Сопоставление",
      "Ранжирование",
    ]);
  });

  it("bare question route also maps to the «Вопрос» type", () => {
    const { section, group } = single("question");
    expect(section.key).toBe("system");
    expect(group.key).toBe("question");
    expect(group.label).toBe("Вопрос");
  });

  it("results (bare) → system section, «Итоги теста»", () => {
    const { section, group } = single("results");
    expect(section.key).toBe("system");
    expect(group.key).toBe("results");
    expect(group.label).toBe("Итоги теста");
  });

  it("results.adaptive → system section, adaptive group (ternary true branch)", () => {
    const { section, group } = single("results.adaptive");
    expect(section.key).toBe("system");
    expect(group.key).toBe("results.adaptive");
    expect(group.label).toBe("Итоги теста (адаптивные)");
  });

  it("results-prefixed but not adaptive → group collapses to 'results' (ternary false branch)", () => {
    const { section, group } = single("results.summary", "results.summary");
    expect(section.key).toBe("system");
    expect(group.key).toBe("results");
  });

  it("system.* → system section, route as group key", () => {
    expect(single("system.blocked").group.label).toBe("Доступ ограничен");
    expect(single("system.transition").group.label).toBe("Переход");
    const { section, group } = single("system.blocked");
    expect(section.key).toBe("system");
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

  it("content.intro → user section, «Введение раздела»", () => {
    const { section, group } = single("content.intro");
    expect(section.key).toBe("user");
    expect(section.label).toBe("Пользовательские страницы");
    expect(group.key).toBe("content.intro");
    expect(group.label).toBe("Введение раздела");
  });

  it("content.router / bare router → user section, «Маршрутизатор»", () => {
    const a = single("content.router");
    expect(a.section.key).toBe("user");
    expect(a.group.key).toBe("content.router");
    expect(a.group.label).toBe("Маршрутизатор");
    expect(single("router").group.key).toBe("content.router");
  });

  it("learning-page variants collapse under «Учебная страница» in the user section", () => {
    const rail = buildRail([
      spec("content.info", "a", "Текст", { key: "info.text", label: "Текст" }),
      spec("content.info", "b", "Текст с подзаголовком", { key: "info.text-lead", label: "Текст с подзаголовком" }),
      spec("content", "c", "Текст, изображение слева", { key: "info.image-left", label: "Текст, изображение слева" }),
    ]);
    expect(rail).toHaveLength(1);
    expect(rail[0].key).toBe("user");
    expect(rail[0].variants).toHaveLength(1);
    const group = rail[0].variants[0];
    expect(group.key).toBe("content");
    expect(group.label).toBe("Учебная страница");
    expect(group.fromManifest).toBe(false);
    expect(group.screens.map((s) => s.label)).toEqual([
      "Текст",
      "Текст с подзаголовком",
      "Текст, изображение слева",
    ]);
  });

  it("gallery variants collapse under «Галерея» in the user section", () => {
    const rail = buildRail([
      spec("content.gallery.1", "gallery-1", "Галерея: список"),
      spec("content.gallery.2", "gallery-2", "Галерея: текст"),
    ]);
    expect(rail[0].key).toBe("user");
    const group = rail[0].variants[0];
    expect(group.key).toBe("gallery");
    expect(group.label).toBe("Галерея");
    expect(group.screens.map((s) => s.id)).toEqual(["gallery-1", "gallery-2"]);
  });
});

// ─── groupOf: variant-key middle level for NON-grouped types ──────────────────

describe("groupOf — variant-backed screens (non type-grouped) group by their manifest variant", () => {
  it("names the group from the manifest, not the route (content.intro is not type-grouped)", () => {
    const rail = buildRail([
      spec("content.intro", "page-1", "Слайд 1", { key: "intro.card", label: "Введение с карточкой" }),
    ]);
    const group = rail[0].variants[0];
    expect(group.key).toBe("v:intro.card");
    expect(group.label).toBe("Введение с карточкой");
    expect(group.fromManifest).toBe(true);
  });

  it("several demo screens of ONE variant are its demonstrations, not separate variants", () => {
    const v = { key: "intro.card", label: "Введение" };
    const rail = buildRail([
      spec("content.intro", "page-1", "Слайд 1", v),
      spec("content.intro", "page-2", "Слайд 2", v),
      spec("content.intro", "page-3", "Слайд 3", v),
    ]);
    expect(rail[0].variants).toHaveLength(1);
    expect(rail[0].variants[0].screens.map((s) => s.id)).toEqual(["page-1", "page-2", "page-3"]);
  });

  it("falls back to the variant key when the manifest declares no / blank label", () => {
    expect(buildRail([spec("content.intro", "a", "A", { key: "intro.x" })])[0].variants[0].label).toBe("intro.x");
    expect(buildRail([spec("content.intro", "a", "A", { key: "intro.x", label: "  " })])[0].variants[0].label).toBe(
      "intro.x",
    );
  });

  it("type-grouped content ignores the manifest variant key and merges by type", () => {
    // Two DISTINCT manifest variants of the learning-page type now read as ONE
    // «Учебная страница» group with two demonstrations (variants of one type).
    const rail = buildRail([
      spec("content.info", "a", "Текст", { key: "info.text", label: "Текст" }),
      spec("content.info", "b", "Медиа", { key: "info.image-left", label: "Медиа" }),
    ]);
    expect(rail[0].variants).toHaveLength(1);
    expect(rail[0].variants[0].key).toBe("content");
    expect(rail[0].variants[0].screens.map((s) => s.id)).toEqual(["a", "b"]);
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

  it("falls back to the route when the label is whitespace-only / absent", () => {
    expect(single("start", "start", "   ").screen.label).toBe("start");
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

// ─── buildRail: grouping / ordering ───────────────────────────────────────────

describe("buildRail — grouping and ordering", () => {
  it("returns an empty rail for no specs", () => {
    expect(buildRail([])).toEqual([]);
  });

  it("nests multiple demonstrations under one shared group (existing-group branch)", () => {
    const rail = buildRail([
      spec("question.single", "q-a", "Радио-список"),
      spec("question.multiple", "q-b", "Карточки"),
    ]);
    expect(rail).toHaveLength(1);
    expect(rail[0].variants).toHaveLength(1);
    expect(rail[0].variants[0].key).toBe("question");
    expect(rail[0].variants[0].screens.map((s) => s.id)).toEqual(["q-a", "q-b"]);
  });

  it("keeps distinct groups under one section (existing-section, new-group branch)", () => {
    const rail = buildRail([spec("start", "s"), spec("question.single", "q"), spec("results", "r")]);
    expect(rail).toHaveLength(1);
    expect(rail[0].key).toBe("system");
    expect(rail[0].variants.map((v) => v.key)).toEqual(["start", "question", "results"]);
  });

  it("sorts sections into the canonical SECTION_ORDER (system before user)", () => {
    const rail = buildRail([
      spec("content.intro", "ci"),
      spec("results", "r"),
      spec("question.single", "q"),
      spec("start", "s"),
    ]);
    expect(rail.map((s) => s.key)).toEqual(["system", "user"]);
  });

  it("preserves declaration order of demonstrations within a group", () => {
    const rail = buildRail([
      spec("question.single", "first"),
      spec("question.multiple", "second"),
      spec("question.matching", "third"),
    ]);
    expect(rail[0].variants[0].screens.map((s) => s.id)).toEqual(["first", "second", "third"]);
  });
});

// ─── variantStatus: worst-of roll-up ──────────────────────────────────────────

describe("variantStatus — group dot", () => {
  const group = buildRail([
    spec("question.single", "a", "A"),
    spec("question.multiple", "b", "B"),
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
