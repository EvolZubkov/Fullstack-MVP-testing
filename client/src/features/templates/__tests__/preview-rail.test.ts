/**
 * @module features/templates/__tests__/preview-rail.test
 * @description Direct branch tests for the preview-rail grouping builder
 * ({@link module:features/templates/preview-rail}). Exercises `buildRail` and,
 * through it, the internal `classify` / `typeLabel` / `variantLabel` helpers by
 * feeding one screen spec per route family plus the malformed / fallback inputs.
 * No React or rendering — every case is a pure input -> output assertion.
 */
import { describe, expect, it } from "vitest";
import type { ScreenSpec } from "@shared/template/preview-context";
import { buildRail } from "../preview-rail";

// ─── Fixture ──────────────────────────────────────────────────────────────────

/** Build a minimal {@link ScreenSpec} — buildRail only reads id/route/label. */
function spec(route: string, id: string = route, label?: string): ScreenSpec {
  return {
    id,
    route,
    label,
    layoutKey: "x",
    requiredSlots: [],
    input: { context: {}, slots: {}, content: {} },
  } as unknown as ScreenSpec;
}

/** Flatten the rail into a lookup of the single variant produced for one spec. */
function single(route: string, id: string = route, label?: string) {
  const rail = buildRail([spec(route, id, label)]);
  expect(rail).toHaveLength(1);
  const section = rail[0];
  expect(section.types).toHaveLength(1);
  const type = section.types[0];
  expect(type.variants).toHaveLength(1);
  return { section, type, variant: type.variants[0] };
}

// ─── classify: section + type keys per route family ───────────────────────────

describe("classify — route → (section, type) grouping", () => {
  it("start route", () => {
    const { section, type } = single("start");
    expect(section.key).toBe("start");
    expect(section.label).toBe("Старт");
    expect(type.key).toBe("start");
    expect(type.label).toBe("Старт");
  });

  it("content.intro → intro section", () => {
    const { section, type } = single("content.intro");
    expect(section.key).toBe("intro");
    expect(section.label).toBe("Введение раздела");
    expect(type.key).toBe("content.intro");
    expect(type.label).toBe("Введение");
  });

  it("content.summary → summary section", () => {
    const { section, type } = single("content.summary");
    expect(section.key).toBe("summary");
    expect(section.label).toBe("Итог раздела");
    expect(type.key).toBe("content.summary");
    expect(type.label).toBe("Итог");
  });

  it("content.router → router section", () => {
    const { section, type } = single("content.router");
    expect(section.key).toBe("router");
    expect(section.label).toBe("Маршрутизатор");
    expect(type.key).toBe("content.router");
    expect(type.label).toBe("Маршрутизатор");
  });

  it("router (bare) also maps to router section", () => {
    const { section, type } = single("router");
    expect(section.key).toBe("router");
    expect(type.key).toBe("content.router");
  });

  it("content (bare) → info section with generic content type", () => {
    const { section, type } = single("content");
    expect(section.key).toBe("info");
    expect(section.label).toBe("Учебные страницы");
    expect(type.key).toBe("content");
    expect(type.label).toBe("Контент");
  });

  it("content.info → info section with mapped type label", () => {
    const { section, type } = single("content.info");
    expect(section.key).toBe("info");
    expect(type.key).toBe("content.info");
    expect(type.label).toBe("Учебный материал");
  });

  it("unknown content.* sub-kind still lands in info with fallback type label", () => {
    const { section, type } = single("content.custom");
    expect(section.key).toBe("info");
    expect(type.key).toBe("content.custom");
    // typeLabel fallback: no TYPE_LABELS entry → the key itself.
    expect(type.label).toBe("content.custom");
  });

  it("question (bare) → questions section with generic question type", () => {
    const { section, type } = single("question");
    expect(section.key).toBe("questions");
    expect(section.label).toBe("Вопросы");
    expect(type.key).toBe("question");
    expect(type.label).toBe("Вопрос");
  });

  it("question.single/multiple/matching/ranking map to their labels", () => {
    expect(single("question.single").type.label).toBe("Один вариант");
    expect(single("question.multiple").type.label).toBe("Несколько вариантов");
    expect(single("question.matching").type.label).toBe("Сопоставление");
    expect(single("question.ranking").type.label).toBe("Ранжирование");
    expect(single("question.single").section.key).toBe("questions");
  });

  it("results (bare) → results section, type 'results'", () => {
    const { section, type } = single("results");
    expect(section.key).toBe("results");
    expect(section.label).toBe("Результаты теста");
    expect(type.key).toBe("results");
    expect(type.label).toBe("Результаты");
  });

  it("results.adaptive → results section, adaptive type (ternary true branch)", () => {
    const { section, type } = single("results.adaptive");
    expect(section.key).toBe("results");
    expect(type.key).toBe("results.adaptive");
    expect(type.label).toBe("Адаптивные результаты");
  });

  it("results-prefixed but not adaptive → type collapses to 'results' (ternary false branch)", () => {
    const { section, type } = single("results.summary", "results.summary");
    expect(section.key).toBe("results");
    expect(type.key).toBe("results");
  });

  it("system.* → system section, route as type key", () => {
    expect(single("system.blocked").type.label).toBe("Доступ ограничен");
    expect(single("system.transition").type.label).toBe("Переход");
    const { section, type } = single("system.blocked");
    expect(section.key).toBe("system");
    expect(section.label).toBe("Системные экраны");
    expect(type.key).toBe("system.blocked");
  });

  it("bare 'system' (no dot) falls through to the system fallback", () => {
    const { section, type } = single("system");
    expect(section.key).toBe("system");
    expect(type.key).toBe("system");
    // No TYPE_LABELS["system"] → fallback to the key.
    expect(type.label).toBe("system");
  });

  it("completely unknown route → system section, route echoed as type key + label", () => {
    const { section, type } = single("totally-unknown");
    expect(section.key).toBe("system");
    expect(type.key).toBe("totally-unknown");
    expect(type.label).toBe("totally-unknown");
  });
});

// ─── variantLabel: label?.trim() || route ─────────────────────────────────────

describe("variantLabel — leaf display name", () => {
  it("uses a non-empty label verbatim", () => {
    expect(single("start", "start", "Экран старта").variant.label).toBe("Экран старта");
  });

  it("trims surrounding whitespace from the label", () => {
    expect(single("start", "start", "  Экран старта  ").variant.label).toBe("Экран старта");
  });

  it("falls back to the route when the label is whitespace-only", () => {
    expect(single("start", "start", "   ").variant.label).toBe("start");
  });

  it("falls back to the route when the label is absent", () => {
    expect(single("start", "start", undefined).variant.label).toBe("start");
  });

  it("carries id/route/spec through onto the variant", () => {
    const s = spec("question.single", "q-1", "Вопрос 1");
    const rail = buildRail([s]);
    const variant = rail[0].types[0].variants[0];
    expect(variant.id).toBe("q-1");
    expect(variant.route).toBe("question.single");
    expect(variant.spec).toBe(s);
  });
});

// ─── buildRail: grouping / dedup / ordering ───────────────────────────────────

describe("buildRail — grouping and ordering", () => {
  it("returns an empty rail for no specs", () => {
    expect(buildRail([])).toEqual([]);
  });

  it("nests multiple render variants under one shared type (existing-type branch)", () => {
    const rail = buildRail([
      spec("question.single", "q-a", "Радио-список"),
      spec("question.single", "q-b", "Карточки"),
    ]);
    expect(rail).toHaveLength(1);
    expect(rail[0].types).toHaveLength(1);
    expect(rail[0].types[0].variants.map((v) => v.id)).toEqual(["q-a", "q-b"]);
  });

  it("keeps distinct types under one section (existing-section, new-type branch)", () => {
    const rail = buildRail([
      spec("question.single", "q-s"),
      spec("question.multiple", "q-m"),
    ]);
    expect(rail).toHaveLength(1);
    expect(rail[0].key).toBe("questions");
    expect(rail[0].types.map((t) => t.key)).toEqual(["question.single", "question.multiple"]);
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

  it("preserves declaration order of variants within a type", () => {
    const rail = buildRail([
      spec("question.single", "first"),
      spec("question.single", "second"),
      spec("question.single", "third"),
    ]);
    expect(rail[0].types[0].variants.map((v) => v.id)).toEqual(["first", "second", "third"]);
  });
});
