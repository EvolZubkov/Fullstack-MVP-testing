/**
 * @module features/tests/editor/__tests__/issue-indication
 * @description Контур индикации проблем: уровень по адресу поля и находки, которым
 * нужны данные ВНЕ модели. Правило — `docs/architecture/test-editor-contracts.md`,
 * раздел «Индикация проблем».
 *
 * Проверяется главное следствие правила: проблема, о которой говорят автору, обязана
 * попасть в общий контур. Секция, посчитавшая находку у себя и не отдавшая её наверх,
 * не зажигает ни точку на вкладке, ни точку в рейле, и «Перейти к ошибкам» некуда вести.
 */
import { describe, expect, it } from "vitest";
import { buildIssueLevel } from "../field-errors";
import { validateTestEditor } from "../test-editor.validation";
import { emptyEditorModel } from "../test-editor.mappers";
import type { TestEditorModel, ValidationIssue } from "../test-editor.types";

function issue(field: string, severity: "error" | "warning"): ValidationIssue {
  return { field, code: "test", message: "…", severity };
}

function modelWithQuota(count: number): TestEditorModel {
  const base = emptyEditorModel({ folderId: null });
  return {
    ...base,
    basic: { ...base.basic, title: "Тест" },
    sections: [
      {
        topicId: "top-1",
        topicName: "Финансы",
        maxQuestions: 20,
        drawCount: count,
        drawAll: false,
        required: true,
        timeLimit: { source: "inherit_test" },
        feedback: { format: "plain", text: "" },
        feedbackLinks: [],
        feedbackAssets: [],
        feedbackEvents: [],
        defaultPoints: null,
        drawBlueprint: { strata: [{ tag: "Бюджет", count, mode: "exact" }] },
      },
    ],
  };
}

describe("уровень проблемы по адресу поля", () => {
  it("ошибка перебивает предупреждение: точка показывает ХУДШИЙ уровень", () => {
    const level = buildIssueLevel([
      issue("sections[0].drawBlueprintJson[0]", "warning"),
      issue("sections[0].drawCount", "error"),
    ]);
    expect(level("sections")).toBe("error");
  });

  it("одни предупреждения дают жёлтый", () => {
    const level = buildIssueLevel([issue("sections[0].drawBlueprintJson[0]", "warning")]);
    expect(level("sections")).toBe("warning");
  });

  it("чужой адрес не подсвечивается", () => {
    const level = buildIssueLevel([issue("passRules.overall.value", "error")]);
    expect(level("sections")).toBeUndefined();
    // Совпадение по началу строки не считается вложенностью: `sections` и
    // `sectionsExtra` — разные адреса.
    expect(buildIssueLevel([issue("sectionsExtra", "error")])("sections")).toBeUndefined();
  });
});

/** Тест с одной темой в режиме вариантов: варианты заданных размеров. */
function modelWithVariants(sizes: number[]): TestEditorModel {
  const base = modelWithQuota(1);
  const forms = sizes.map((n, i) => ({
    id: `f${i + 1}`,
    label: `Вариант ${i + 1}`,
    questionIds: Array.from({ length: n }, (_, j) => `q${i}-${j}`),
  }));
  return {
    ...base,
    sections: [{ ...base.sections[0], drawBlueprint: null, formSet: { forms } }],
  };
}

describe("неравные варианты доходят до общего контура", () => {
  it("разные размеры — предупреждение с адресом темы", () => {
    const result = validateTestEditor(modelWithVariants([5, 3]));
    const found = result.warnings.filter((w) => w.code === "variants_unequal");
    expect(found).toHaveLength(1);
    expect(found[0].field).toBe("sections[0].formSetJson");
    expect(found[0].message).toContain("5 / 3");
    // Замечание, а не ошибка: неравные варианты — законная настройка.
    expect(result.errors.filter((e) => e.code === "variants_unequal")).toHaveLength(0);
    expect(buildIssueLevel([...result.errors, ...result.warnings])("sections")).toBe("warning");
  });

  it("равные варианты молчат", () => {
    const result = validateTestEditor(modelWithVariants([4, 4]));
    expect(result.warnings.filter((w) => w.code === "variants_unequal")).toHaveLength(0);
  });

  it("пустой вариант — уже ошибка, о неравенстве второй раз не говорим", () => {
    const result = validateTestEditor(modelWithVariants([4, 0]));
    expect(result.errors.some((e) => e.field === "sections[0].formSetJson")).toBe(true);
    expect(result.warnings.filter((w) => w.code === "variants_unequal")).toHaveLength(0);
  });
});

describe("находки, которым нужны данные вне модели", () => {
  it("без контекста молчит: выдумывать предупреждение по пустому банку нельзя", () => {
    const result = validateTestEditor(modelWithQuota(10));
    expect(result.warnings.filter((w) => w.code === "quota_exceeds_bank")).toHaveLength(0);
  });

  it("квота больше банка — предупреждение с адресом самой квоты", () => {
    const result = validateTestEditor(modelWithQuota(10), {
      availableByTopicAndTag: { "top-1": { бюджет: 3 } },
    });
    const found = result.warnings.filter((w) => w.code === "quota_exceeds_bank");
    expect(found).toHaveLength(1);
    expect(found[0].field).toBe("sections[0].drawBlueprintJson[0]");
    expect(found[0].message).toContain("запрошено 10");
    expect(found[0].message).toContain("в банке темы 3");
    // Предупреждение не блокирует сохранение — это второй уровень, а не ошибка.
    expect(result.errors.filter((e) => e.code === "quota_exceeds_bank")).toHaveLength(0);
  });

  it("банка хватает — молчит", () => {
    const result = validateTestEditor(modelWithQuota(2), {
      availableByTopicAndTag: { "top-1": { бюджет: 3 } },
    });
    expect(result.warnings.filter((w) => w.code === "quota_exceeds_bank")).toHaveLength(0);
  });

  it("найденное предупреждение зажигает точку рейла «Состава»", () => {
    // Ради этого всё и делается: находка секции доходит до общего контура.
    const result = validateTestEditor(modelWithQuota(10), {
      availableByTopicAndTag: { "top-1": { бюджет: 3 } },
    });
    const level = buildIssueLevel([...result.errors, ...result.warnings]);
    expect(level("sections")).toBe("warning");
  });
});
