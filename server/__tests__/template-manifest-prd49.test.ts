/**
 * @module server/__tests__/template-manifest-prd49
 *
 * PRD-49 §3 (Задача 3). A label is a named string the TEMPLATE declares with a default
 * text — the TEST may reword or switch it off (that layer is a separate task). This file
 * checks both halves of the template side: the static-check function itself, and that the
 * shipping `default` template actually declares the full label set.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateLabelDeclarations } from "../services/template-validation";

describe("validateLabelDeclarations", () => {
  it("accepts a well-formed declaration list", () => {
    expect(
      validateLabelDeclarations([
        { key: "results.heading", group: "Первый уровень", label: "Зонтик", default: "Ваш результат" },
      ]),
    ).toEqual([]);
  });

  it("rejects a declaration without a default", () => {
    expect(
      validateLabelDeclarations([{ key: "results.heading", group: "G", label: "L" }]),
    ).toEqual(['labels[0] (results.heading): отсутствует "default"']);
  });

  it("rejects a duplicate key", () => {
    const decls = [
      { key: "results.heading", group: "G", label: "L", default: "A" },
      { key: "results.heading", group: "G", label: "L", default: "B" },
    ];
    expect(validateLabelDeclarations(decls)).toEqual(["labels[1]: ключ results.heading объявлен дважды"]);
  });

  it("accepts a template that declares no labels at all", () => {
    expect(validateLabelDeclarations(undefined)).toEqual([]);
  });

  it("rejects a key that is the beginning of another key", () => {
    // `labelsTree` cannot hold both: `results` would be a string where `results.heading`
    // needs an object. It resolves that silently at render time, so the shout belongs here.
    const decls = [
      { key: "results", group: "G", label: "L", default: "Ваш результат" },
      { key: "results.heading", group: "G", label: "L", default: "Заголовок" },
    ];
    expect(validateLabelDeclarations(decls)).toEqual([
      "labels[1]: ключ results.heading конфликтует с ключом results — один ключ является началом другого",
    ]);
  });

  it("rejects the same pair declared the other way round", () => {
    const decls = [
      { key: "results.heading", group: "G", label: "L", default: "Заголовок" },
      { key: "results", group: "G", label: "L", default: "Ваш результат" },
    ];
    expect(validateLabelDeclarations(decls)).toEqual([
      "labels[1]: ключ results конфликтует с ключом results.heading — один ключ является началом другого",
    ]);
  });

  it("rejects a conflict at any depth, not only the first segment", () => {
    const decls = [
      { key: "a.b", group: "G", label: "L", default: "X" },
      { key: "a.b.c", group: "G", label: "L", default: "Y" },
    ];
    expect(validateLabelDeclarations(decls)).toEqual([
      "labels[1]: ключ a.b.c конфликтует с ключом a.b — один ключ является началом другого",
    ]);
  });

  it("does not mistake a shared prefix for a conflict", () => {
    // `results.heading` and `results.summary` are siblings, not a prefix pair.
    const decls = [
      { key: "results.heading", group: "G", label: "L", default: "X" },
      { key: "results.summary", group: "G", label: "L", default: "Y" },
      { key: "results.summaries", group: "G", label: "L", default: "Z" },
    ];
    expect(validateLabelDeclarations(decls)).toEqual([]);
  });
});

/**
 * The 15 keys the results screens and their recommendations block need (PRD-49 spec §3
 * table). Order is not asserted — the manifest is free to group them however it likes;
 * only presence and a non-empty `default` matter here.
 */
const EXPECTED_KEYS = [
  "results.heading",
  "results.recommendations",
  "results.summary",
  "results.scales",
  "results.indicators",
  "results.topics",
  "recommendations.courses",
  "recommendations.events",
  "recommendations.assets",
  "facts.questions",
  "facts.correct",
  "facts.points",
  "topic.correct",
  "topic.points",
  "section.eyebrow",
];

interface LabelDecl {
  key: string;
  group: string;
  label: string;
  default: string;
  defaults?: Record<string, string>;
}

const manifest = JSON.parse(
  readFileSync(resolve("server/scorm/templates/default/manifest.json"), "utf-8"),
) as { labels?: LabelDecl[]; resultsBlockOrder?: Record<string, string[]> };

describe("манифест «Стандартного»: объявление надписей (PRD-49)", () => {
  it("объявляет все 15 ключей с непустым default", () => {
    const declared = manifest.labels ?? [];
    expect(declared.map((d) => d.key).sort()).toEqual([...EXPECTED_KEYS].sort());
    for (const decl of declared) {
      expect(typeof decl.default, decl.key).toBe("string");
      expect(decl.default.length, decl.key).toBeGreaterThan(0);
    }
  });

  it("не содержит дублей ключей и проходит статическую проверку", () => {
    expect(validateLabelDeclarations(manifest.labels)).toEqual([]);
  });

  it("объявляет порядок подблоков итогов ПО ЭКРАНАМ", () => {
    // Состав у экранов разный, а не только порядок: на адаптивных итогах сводки баллов
    // нет и никогда не было (в макете нет ни `hideScoreSummary`, ни блока сводки), и
    // отсутствие ключа `summary` в списке — это и есть «на этом экране сводки не бывает».
    expect(manifest.resultsBlockOrder).toEqual({
      default: ["summary", "scales", "indicators", "topics"],
      "results.adaptive": ["topics", "scales", "indicators"],
    });
  });
});
