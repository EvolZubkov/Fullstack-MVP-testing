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
    expect(resolveLabels(DECLS, {}, {}, "results")).toEqual({
      "results.heading": "Ваш результат",
      "results.scales": "По шкалам",
      "recommendations.courses": "Пройти обучение",
    });
  });

  it("uses the screen default where the declaration has one", () => {
    const map = resolveLabels(DECLS, {}, {}, "report");
    expect(map["recommendations.courses"]).toBe("Рекомендации по курсам");
    expect(map["results.scales"]).toBe("По шкалам");
  });

  it("applies the author's own wording", () => {
    const map = resolveLabels(DECLS, { "results.scales": { on: true, text: "Профиль" } }, {}, "results");
    expect(map["results.scales"]).toBe("Профиль");
  });

  it("keeps the template text when the author cleared the field but left it on", () => {
    const map = resolveLabels(DECLS, { "results.scales": { on: true, text: "" } }, {}, "results");
    expect(map["results.scales"]).toBe("По шкалам");
  });

  it("returns an empty string for a switched-off label", () => {
    const map = resolveLabels(DECLS, { "results.scales": { on: false } }, {}, "results");
    expect(map["results.scales"]).toBe("");
  });

  it("ignores a stored key the template does not declare", () => {
    const map = resolveLabels(DECLS, { "results.gone": { on: false } }, {}, "results");
    expect(map["results.gone"]).toBeUndefined();
  });

  it("applies the caller's override layer on top of the shared wording", () => {
    const values = { "results.scales": { on: true, text: "Профиль" } };
    const overrides = { "results.scales": { on: true, text: "Профиль по шкалам" } };
    expect(resolveLabels(DECLS, values, overrides, "report")["results.scales"]).toBe("Профиль по шкалам");
    // Экран итогов слоя переопределений не имеет — вызывающий передаёт пустой объект.
    expect(resolveLabels(DECLS, values, {}, "results")["results.scales"]).toBe("Профиль");
  });

  it("lets the report switch a label off on its own", () => {
    const map = resolveLabels(DECLS, {}, { "results.heading": { on: false } }, "report");
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
});
