import { describe, it, expect } from "vitest";
import { resolveLabels, labelsTree, type LabelDeclaration } from "../labels";

const DECLS: LabelDeclaration[] = [
  { key: "results.heading", group: "Первый уровень", label: "Зонтик", default: "Ваш результат" },
  { key: "results.scales", group: "Второй уровень", label: "Шкалы", default: "По шкалам" },
  {
    key: "recommendations.courses",
    group: "Группы рекомендаций",
    label: "Курсы",
    default: "Пройти обучение",
    defaults: { report: "Рекомендации по курсам" },
  },
];

describe("resolveLabels", () => {
  it("returns template defaults when the test stored nothing", () => {
    expect(resolveLabels({ declarations: DECLS, values: {}, screen: "results" })).toEqual({
      "results.heading": "Ваш результат",
      "results.scales": "По шкалам",
      "recommendations.courses": "Пройти обучение",
    });
  });

  it("uses the screen default where the declaration has one", () => {
    const map = resolveLabels({ declarations: DECLS, values: {}, screen: "report" });
    expect(map["recommendations.courses"]).toBe("Рекомендации по курсам");
    expect(map["results.scales"]).toBe("По шкалам");
  });

  it("uses the results.adaptive screen default where the declaration has one", () => {
    const decls: LabelDeclaration[] = [
      {
        key: "results.heading",
        group: "Первый уровень",
        label: "Заголовок",
        default: "Ваш результат",
        defaults: { "results.adaptive": "Ваш профиль по уровням" },
      },
    ];
    const map = resolveLabels({ declarations: decls, values: {}, screen: "results.adaptive" });
    expect(map["results.heading"]).toBe("Ваш профиль по уровням");
  });

  it("applies the author's own wording", () => {
    const map = resolveLabels({
      declarations: DECLS,
      values: { "results.scales": { on: true, text: "Профиль" } },
      screen: "results",
    });
    expect(map["results.scales"]).toBe("Профиль");
  });

  it("keeps the template text when the author cleared the field but left it on", () => {
    const map = resolveLabels({
      declarations: DECLS,
      values: { "results.scales": { on: true, text: "" } },
      screen: "results",
    });
    expect(map["results.scales"]).toBe("По шкалам");
  });

  it("returns an empty string for a switched-off label", () => {
    const map = resolveLabels({
      declarations: DECLS,
      values: { "results.scales": { on: false } },
      screen: "results",
    });
    expect(map["results.scales"]).toBe("");
  });

  it("ignores a stored key the template does not declare", () => {
    const map = resolveLabels({
      declarations: DECLS,
      values: { "results.gone": { on: false } },
      screen: "results",
    });
    expect(map["results.gone"]).toBeUndefined();
  });

  it("applies the caller's override layer on top of the shared wording", () => {
    const values = { "results.scales": { on: true, text: "Профиль" } };
    const overrides = { "results.scales": { on: true, text: "Профиль по шкалам" } };
    expect(
      resolveLabels({ declarations: DECLS, values, overrides, screen: "report" })["results.scales"],
    ).toBe("Профиль по шкалам");
    // Экран итогов слоя переопределений не имеет — вызывающий его просто не передаёт.
    expect(resolveLabels({ declarations: DECLS, values, screen: "results" })["results.scales"]).toBe(
      "Профиль",
    );
  });

  it("lets the report switch a label off on its own", () => {
    const map = resolveLabels({
      declarations: DECLS,
      values: {},
      overrides: { "results.heading": { on: false } },
      screen: "report",
    });
    expect(map["results.heading"]).toBe("");
  });
});

describe("labelsTree", () => {
  it("splits dotted keys into nested objects for the DSL", () => {
    expect(labelsTree({ "results.scales": "По шкалам", "facts.points": "баллов" })).toEqual({
      results: { scales: "По шкалам" },
      facts: { points: "баллов" },
    });
  });

  it("skips a mutually-prefixed key and keeps every other label", () => {
    // Rendering is total: a template with such a pair loses ONE heading, not the screen.
    // The pair itself is rejected by the manifest validator, at upload.
    expect(
      labelsTree({ "results.heading": "Заголовок", results: "Ваш результат", "facts.points": "баллов" }),
    ).toEqual({
      results: { heading: "Заголовок" },
      facts: { points: "баллов" },
    });
  });

  it("skips the prefixed key whichever order the keys arrive in", () => {
    expect(labelsTree({ results: "Ваш результат", "results.heading": "Заголовок" })).toEqual({
      results: "Ваш результат",
    });
  });
});
