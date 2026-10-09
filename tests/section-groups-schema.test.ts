/**
 * @module tests/section-groups-schema
 * @description PRD-50 FR-11/FR-12: блоки разделов — упорядоченный список `{ key, label,
 * order }` у теста и необязательная ссылка `group_key` у раздела. Схема принимает форму из
 * §4 спеки и отбивает то, что сделало бы принадлежность раздела неоднозначной.
 */
import { describe, it, expect } from "vitest";
import { sectionGroupSchema, sectionGroupsSchema } from "../shared/schema";

describe("sectionGroupSchema", () => {
  it("принимает форму из §4 спеки", () => {
    expect(sectionGroupSchema.parse({ key: "competencies", label: "Управленческие компетенции", order: 0 })).toEqual({
      key: "competencies",
      label: "Управленческие компетенции",
      order: 0,
    });
  });

  it("принимает блок без порядка: список и так упорядочен позицией", () => {
    expect(sectionGroupSchema.parse({ key: "knowledge", label: "Знания" })).toEqual({
      key: "knowledge",
      label: "Знания",
    });
  });

  it("подрезает пробелы у ключа и надписи", () => {
    expect(sectionGroupSchema.parse({ key: "  k  ", label: "  Знания  " })).toEqual({ key: "k", label: "Знания" });
  });

  it("не принимает пустой ключ: ссылаться на такой блок нечем", () => {
    expect(sectionGroupSchema.safeParse({ key: "   ", label: "Знания" }).success).toBe(false);
  });
});

describe("sectionGroupsSchema", () => {
  it("принимает упорядоченный список блоков", () => {
    const parsed = sectionGroupsSchema.parse([
      { key: "competencies", label: "Управленческие компетенции", order: 0 },
      { key: "knowledge", label: "Знания", order: 1 },
    ]);
    expect(parsed.map((g) => g.key)).toEqual(["competencies", "knowledge"]);
  });

  it("принимает пустой список: блоков у теста нет", () => {
    expect(sectionGroupsSchema.parse([])).toEqual([]);
  });

  it("не принимает два одинаковых ключа: принадлежность раздела стала бы неоднозначной", () => {
    expect(
      sectionGroupsSchema.safeParse([
        { key: "k", label: "Первый" },
        { key: "k", label: "Второй" },
      ]).success,
    ).toBe(false);
  });
});
