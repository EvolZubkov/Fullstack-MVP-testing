import { describe, it, expect } from "vitest";
import { insertScaleSchema, insertResultVariableSchema } from "../schema";

describe("insertScaleSchema (PRD-29)", () => {
  it("принимает три позиции видимости", () => {
    for (const learnerVisibility of ["hidden", "level", "level_and_value"] as const) {
      const parsed = insertScaleSchema.parse({
        testId: "t1", key: "s1", label: "Шкала", type: "number", learnerVisibility,
      });
      expect(parsed.learnerVisibility).toBe(learnerVisibility);
    }
  });

  it("отклоняет значение вне перечня", () => {
    expect(() =>
      insertScaleSchema.parse({ testId: "t1", key: "s1", label: "Ш", type: "number", learnerVisibility: "yes" }),
    ).toThrow();
  });

  it("по умолчанию скрывает шкалу от ученика", () => {
    const parsed = insertScaleSchema.parse({ testId: "t1", key: "s1", label: "Ш", type: "number" });
    expect(parsed.learnerVisibility).toBe("hidden");
  });
});

describe("insertResultVariableSchema (PRD-29)", () => {
  it("принимает configJson с перечнем исходов", () => {
    const parsed = insertResultVariableSchema.parse({
      testId: "t1", name: "burnout_level", label: "Состояние", type: "string", formula: '"engaged"',
      configJson: { outcomes: [{ code: "engaged", label: "Вовлечённость" }] },
    });
    expect(parsed.configJson).toEqual({ outcomes: [{ code: "engaged", label: "Вовлечённость" }] });
  });

  it("по умолчанию даёт пустой configJson", () => {
    const parsed = insertResultVariableSchema.parse({
      testId: "t1", name: "v", label: "V", type: "number", formula: "1",
    });
    expect(parsed.configJson).toEqual({});
  });
});
