/**
 * Unit tests for the "Цена ответа" Excel grammar (PRD-14 §7):
 * parse/serialize of `questions.scoring_json` (PRD-10).
 *
 *   - empty / "точное" → null (exact)
 *   - weighted (single): weights, pad with zeros, too-many → error, type guard
 *   - tiered (multiple/matching/ranking): conditions, tokens, ;/, separators,
 *     type guard, invalid grammar → error
 *   - serialize ∘ parse is stable (round-trip)
 */

import { describe, it, expect } from "vitest";
import { parseScoringCell, serializeScoring } from "../server/utils/scoring-excel";
import type { QuestionScoring } from "../shared/schema";

describe("parseScoringCell — exact / empty", () => {
  it("пустая ячейка → null", () => {
    expect(parseScoringCell("", "single", 3)).toEqual({ ok: true, value: null });
  });
  it("«точное» → null", () => {
    expect(parseScoringCell("точное", "multiple", 4)).toEqual({ ok: true, value: null });
  });
});

describe("parseScoringCell — weighted (single)", () => {
  it("разбирает веса по числу вариантов", () => {
    const r = parseScoringCell("веса: 2 # 0 # 1", "single", 3);
    expect(r).toEqual({ ok: true, value: { kind: "weighted", weights: [2, 0, 1] } });
  });

  it("меньше весов → добивает нулями", () => {
    const r = parseScoringCell("веса: 2", "single", 3);
    expect(r.ok && r.value).toEqual({ kind: "weighted", weights: [2, 0, 0] });
  });

  it("больше весов, чем вариантов → ошибка", () => {
    const r = parseScoringCell("веса: 1 # 2 # 3 # 4", "single", 3);
    expect(r.ok).toBe(false);
  });

  it("веса для не-single → ошибка", () => {
    const r = parseScoringCell("веса: 1 # 2", "multiple", 2);
    expect(r.ok).toBe(false);
  });

  it("парсит опциональный sMax", () => {
    const r = parseScoringCell("веса: 2 # 1; sMax=3", "single", 2);
    expect(r.ok && r.value).toEqual({ kind: "weighted", weights: [2, 1], sMax: 3 });
  });

  it("нечисловой вес → ошибка", () => {
    const r = parseScoringCell("веса: 2 # абв", "single", 2);
    expect(r.ok).toBe(false);
  });
});

describe("parseScoringCell — ключ РТК «%A2B1C1D0» (алиас весов)", () => {
  it("разбирает буквенный ключ в веса по позиции опции", () => {
    const r = parseScoringCell("%A2B1C1D0", "single", 4);
    expect(r).toEqual({ ok: true, value: { kind: "weighted", weights: [2, 1, 1, 0] } });
  });

  it("допускает пробелы и строчные буквы", () => {
    const r = parseScoringCell("% a0 b2 c1 d1", "single", 4);
    expect(r.ok && r.value).toEqual({ kind: "weighted", weights: [0, 2, 1, 1] });
  });

  it("меньше букв, чем вариантов → добивает нулями", () => {
    const r = parseScoringCell("%A2B1", "single", 4);
    expect(r.ok && r.value).toEqual({ kind: "weighted", weights: [2, 1, 0, 0] });
  });

  it("больше букв, чем вариантов → ошибка", () => {
    const r = parseScoringCell("%A2B1C1D0", "single", 3);
    expect(r.ok).toBe(false);
  });

  it("буквы не по порядку A, B, C… → ошибка", () => {
    const r = parseScoringCell("%A2C1B1D0", "single", 4);
    expect(r.ok).toBe(false);
  });

  it("ключ для не-single → ошибка", () => {
    const r = parseScoringCell("%A2B1", "multiple", 2);
    expect(r.ok).toBe(false);
  });

  it("мусор после «%» → ошибка", () => {
    const r = parseScoringCell("%абв", "single", 4);
    expect(r.ok).toBe(false);
  });
});

describe("parseScoringCell — tiered (multiple/matching/ranking)", () => {
  it("разбирает ступени с условиями и токеном T", () => {
    const r = parseScoringCell("ступени: c>=2 => 1; c==T & x==0 => 2", "multiple", 3);
    expect(r.ok && r.value).toEqual({
      kind: "tiered",
      tiers: [
        { when: { all: [{ lhs: "c", op: ">=", rhs: 2 }] }, score: 1 },
        { when: { all: [{ lhs: "c", op: "==", rhs: "T" }, { lhs: "x", op: "==", rhs: 0 }] }, score: 2 },
      ],
    });
  });

  it("запятая как разделитель ступеней работает наравне с ;", () => {
    const a = parseScoringCell("ступени: c>=1 => 1, c>=2 => 2", "ranking", 3);
    const b = parseScoringCell("ступени: c>=1 => 1; c>=2 => 2", "ranking", 3);
    expect(a).toEqual(b);
  });

  it("токен P для matching и N для ranking принимаются", () => {
    expect(parseScoringCell("ступени: c==P => 1", "matching", 2).ok).toBe(true);
    expect(parseScoringCell("ступени: c==N => 1", "ranking", 2).ok).toBe(true);
  });

  it("десятичный балл — точка", () => {
    const r = parseScoringCell("ступени: c>=1 => 1.5", "multiple", 2);
    expect(r.ok && (r.value as any).tiers[0].score).toBe(1.5);
  });

  it("ступени для single → ошибка", () => {
    expect(parseScoringCell("ступени: c>=1 => 1", "single", 3).ok).toBe(false);
  });

  it("ступень без => → ошибка", () => {
    expect(parseScoringCell("ступени: c>=1", "multiple", 2).ok).toBe(false);
  });

  it("некорректное условие → ошибка", () => {
    expect(parseScoringCell("ступени: z>=1 => 1", "multiple", 2).ok).toBe(false);
  });
});

describe("parseScoringCell — неизвестный формат", () => {
  it("мусор → ошибка", () => {
    expect(parseScoringCell("абракадабра", "single", 3).ok).toBe(false);
  });
});

describe("serializeScoring", () => {
  it("null → пустая строка", () => {
    expect(serializeScoring(null)).toBe("");
  });
  it("exact → пустая строка", () => {
    expect(serializeScoring({ kind: "exact" })).toBe("");
  });
  it("weighted", () => {
    expect(serializeScoring({ kind: "weighted", weights: [2, 0, 1] })).toBe("веса: 2 # 0 # 1");
  });
  it("tiered — пишет читаемые слова correct/wrong/total", () => {
    const s: QuestionScoring = {
      kind: "tiered",
      tiers: [
        { when: { all: [{ lhs: "c", op: ">=", rhs: 2 }] }, score: 1 },
        { when: { all: [{ lhs: "c", op: "==", rhs: "T" }, { lhs: "x", op: "==", rhs: 0 }] }, score: 2 },
      ],
    };
    expect(serializeScoring(s)).toBe("ступени: correct >= 2 => 1; correct == total & wrong == 0 => 2");
  });
});

describe("parseScoringCell — читаемые слова (correct/wrong/total)", () => {
  it("correct/wrong/total разбираются как c/x/T", () => {
    const r = parseScoringCell("ступени: correct == total & wrong == 0 => 2; correct >= 1 & wrong <= 1 => 1", "multiple", 4);
    expect(r.ok && r.value).toEqual({
      kind: "tiered",
      tiers: [
        { when: { all: [{ lhs: "c", op: "==", rhs: "T" }, { lhs: "x", op: "==", rhs: 0 }] }, score: 2 },
        { when: { all: [{ lhs: "c", op: ">=", rhs: 1 }, { lhs: "x", op: "<=", rhs: 1 }] }, score: 1 },
      ],
    });
  });

  it("total → P для matching, N для ranking", () => {
    const m = parseScoringCell("ступени: correct == total => 3", "matching", 3);
    expect(m.ok && (m.value as any).tiers[0].when.all[0].rhs).toBe("P");
    const n = parseScoringCell("ступени: correct == total => 2", "ranking", 3);
    expect(n.ok && (n.value as any).tiers[0].when.all[0].rhs).toBe("N");
  });

  it("старые токены c/x/T по-прежнему принимаются (back-compat)", () => {
    expect(parseScoringCell("ступени: c==T & x==0 => 2", "multiple", 3).ok).toBe(true);
  });

  it("неизвестное слово в левой части → ошибка", () => {
    expect(parseScoringCell("ступени: правильно >= 1 => 1", "multiple", 3).ok).toBe(false);
  });

  it("round-trip: c/x/T → сериализация в слова → реимпорт даёт то же", () => {
    const parsed = parseScoringCell("ступени: c==T & x==0 => 2; c>=1 & x<=1 => 1", "multiple", 4);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reparsed = parseScoringCell(serializeScoring(parsed.value), "multiple", 4);
    expect(reparsed).toEqual(parsed);
  });
});

describe("round-trip serialize ∘ parse", () => {
  const cases: Array<{ type: "single" | "multiple"; opts: number; cell: string }> = [
    { type: "single", opts: 3, cell: "веса: 2 # 0 # 1" },
    { type: "multiple", opts: 4, cell: "ступени: c>=2 => 1; c==T & x==0 => 2" },
  ];
  for (const c of cases) {
    it(`«${c.cell}» стабилен`, () => {
      const parsed = parseScoringCell(c.cell, c.type, c.opts);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const serialized = serializeScoring(parsed.value);
      const reparsed = parseScoringCell(serialized, c.type, c.opts);
      expect(reparsed).toEqual(parsed);
    });
  }
});
