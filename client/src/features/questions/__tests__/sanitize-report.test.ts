/**
 * @module features/questions/__tests__/sanitize-report.test
 *
 * Слова, которыми автору задания говорят о вырезанном (PRD-57, эскиз
 * `prd57-question-text.html`, состояние `s-diag`).
 *
 * Проверяется то, ради чего модуль заведён: находка называется числом, машинное имя правила
 * остаётся машинным (иначе его не найти в своём тексте), а незнакомое правило печатается как
 * есть, а не переводится наугад.
 */
import { describe, it, expect } from "vitest";
import { removalPhrases } from "../sanitize-report";

describe("формулировки вырезанного", () => {
  it("тег печатается своим написанием и без приставки", () => {
    expect(removalPhrases([{ kind: "tag", label: "<script>", count: 1 }])).toEqual([
      { prefix: "", code: "<script>", count: 1 },
    ]);
  });

  it("обработчик называется обработчиком и сохраняет имя события", () => {
    expect(removalPhrases([{ kind: "attribute", label: "onclick", count: 2 }])).toEqual([
      { prefix: "обработчик", code: "onclick", count: 2 },
    ]);
  });

  it("внешний адрес назван внешним: правило одно на src и href", () => {
    expect(removalPhrases([{ kind: "uri", label: "external src/href", count: 1 }])).toEqual([
      { prefix: "внешний", code: "src/href", count: 1 },
    ]);
  });

  it("javascript: назван адресом, а не обработчиком", () => {
    expect(removalPhrases([{ kind: "uri", label: "javascript:", count: 3 }])).toEqual([
      { prefix: "адрес", code: "javascript:", count: 3 },
    ]);
  });

  it("порядок находок — тот, в котором их вернул санитайзер", () => {
    const phrases = removalPhrases([
      { kind: "tag", label: "<iframe>", count: 1 },
      { kind: "attribute", label: "onmouseover", count: 1 },
    ]);
    expect(phrases.map((p) => p.code)).toEqual(["<iframe>", "onmouseover"]);
  });

  it("пустота и отсутствие дают пустой список: показывать нечего", () => {
    expect(removalPhrases([])).toEqual([]);
    expect(removalPhrases(undefined)).toEqual([]);
  });

  it("находка без срабатываний отбрасывается: «удалено 0» — не находка", () => {
    expect(removalPhrases([{ kind: "tag", label: "<svg>", count: 0 }])).toEqual([]);
  });
});
