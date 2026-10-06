/**
 * @module server/services/analytics/__tests__/scale-psychometrics
 * @description PRD-66 FR-29 — FR-32: психометрика измерительных шкал.
 */
import { describe, expect, it } from "vitest";

import { computeScalePsychometrics, itemContribution, type ScaleContext } from "../scale-psychometrics";
import type { ResponseFact } from "../response-matrix";

function fact(over: Partial<ResponseFact> & Pick<ResponseFact, "questionId" | "respondentId" | "answer">): ResponseFact {
  return {
    observationId: `obs-${over.respondentId}`,
    source: "web",
    psychoHash: "hash-1",
    // Измерительный ответ не бывает ни верным, ни неверным: доли балла у него нет.
    outcome: "neutral",
    score: null,
    maxScore: null,
    scoreRatio: null,
    latencyMs: null,
    formKey: null,
    groupKeys: [],
    occurredAt: new Date("2026-09-20T10:00:00Z"),
    ...over,
  } as ResponseFact;
}

/** Пункт шкалы: ответ — индекс градации, вклад равен индексу. */
const ITEM_INFO = (questionId: string) => ({
  questionId,
  prompt: `Пункт ${questionId}`,
  type: "scale",
  gradeLabels: ["Никогда", "Редко", "Иногда", "Часто", "Всегда"],
});

/** Единицы измерения: каждая градация вносит свой номер в шкалу. */
function measurementsFor(questionIds: string[], scaleKey = "burnout") {
  return questionIds.flatMap(questionId =>
    [0, 1, 2, 3, 4].map(grade => ({
      questionId,
      scaleKey,
      sourceType: "option" as const,
      sourceKey: String(grade),
      value: grade,
      weight: 1,
    })));
}

const CTX: ScaleContext = {
  measurements: measurementsFor(["s1", "s2", "s3"]),
  scaleLabels: new Map([["burnout", "Эмоциональное истощение"]]),
  itemById: new Map([
    ["s1", ITEM_INFO("s1")],
    ["s2", ITEM_INFO("s2")],
    ["s3", ITEM_INFO("s3")],
  ]),
};

/** Пять респондентов; третий пункт отвечает ПРОТИВ шкалы — его вклад зеркален. */
const RESPONSES: ResponseFact[] = [];
for (const [respondentId, a, b, c] of [
  ["R1", 0, 0, 4], ["R2", 1, 1, 3], ["R3", 2, 2, 2], ["R4", 3, 3, 1], ["R5", 4, 4, 0],
] as Array<[string, number, number, number]>) {
  RESPONSES.push(fact({ respondentId, questionId: "s1", answer: a }));
  RESPONSES.push(fact({ respondentId, questionId: "s2", answer: b }));
  RESPONSES.push(fact({ respondentId, questionId: "s3", answer: c }));
}

describe("computeScalePsychometrics", () => {
  it("считает альфу шкалы по ВКЛАДАМ, а не по номерам градаций", () => {
    const [scale] = computeScalePsychometrics(RESPONSES, CTX);

    expect(scale.scaleKey).toBe("burnout");
    expect(scale.label).toBe("Эмоциональное истощение");
    expect(scale.respondents).toBe(5);
    expect(typeof scale.reliability).not.toBe("string");
  });

  it("пункт, ведущий себя против шкалы, помечается — без догадки о причине", () => {
    const [scale] = computeScalePsychometrics(RESPONSES, CTX);
    const third = scale.items.find(i => i.questionId === "s3")!;

    expect(third.itemRest!).toBeLessThan(0);
    expect(third.againstScale).toBe(true);
  });

  it("вместо причины даёт ВЫЧИСЛИМОЕ следствие: альфу с перевёрнутым вкладом (FR-31b)", () => {
    const [scale] = computeScalePsychometrics(RESPONSES, CTX);
    const third = scale.items.find(i => i.questionId === "s3")!;
    const before = typeof scale.reliability === "string" ? null : scale.reliability.alpha;

    expect(third.alphaIfMirrored).not.toBeNull();
    expect(third.alphaIfMirrored!).toBeGreaterThan(before!);
  });

  it("согласованному пункту следствие не показывается — переворачивать нечего", () => {
    const [scale] = computeScalePsychometrics(RESPONSES, CTX);
    expect(scale.items.find(i => i.questionId === "s1")!.alphaIfMirrored).toBeNull();
  });

  it("распределение по градациям берёт их число у ВОПРОСА", () => {
    // Шкалу задаёт автор: бывает и семибалльная, и десятибалльная (FR-30b).
    const [scale] = computeScalePsychometrics(RESPONSES, CTX);
    const first = scale.items.find(i => i.questionId === "s1")!;

    expect(first.distribution).toHaveLength(5);
    expect(first.distribution.every(share => share === 0.2)).toBe(true);
    expect(first.gradeLabels[0]).toBe("Никогда");
  });

  it("у типа БЕЗ градаций распределения нет вовсе, а не нули (FR-30a)", () => {
    // Распределение баллов (PRD-44): участник раскладывает баллы между утверждениями, и
    // выбранной градации у такого ответа не существует. Массив нулей отдавать нельзя — на
    // экране он рисуется столбиками нулевой высоты и читается как «все ответили мимо»,
    // хотя ответы есть (вскрыто на стенде: опросник ведущего стиля).
    const ctx: ScaleContext = {
      measurements: ["a1", "a2"].flatMap(questionId =>
        [0, 1, 2].map(option => ({
          questionId,
          scaleKey: "style",
          sourceType: "option_allocation" as const,
          sourceKey: String(option),
          value: 1,
          weight: 1,
        }))),
      scaleLabels: new Map([["style", "Вдохновляющий"]]),
      itemById: new Map(["a1", "a2"].map(questionId => [questionId, {
        questionId,
        prompt: `Пункт ${questionId}`,
        type: "allocation",
        gradeLabels: ["Первое утверждение", "Второе утверждение", "Третье утверждение"],
      }])),
    };
    // Ответ распределения баллов — раскладка «утверждение -> баллы», а не номер градации.
    const responses = [["R1", 3], ["R2", 2], ["R3", 1]].flatMap(([respondentId, points]) => (
      ["a1", "a2"].map(questionId => fact({
        respondentId: respondentId as string,
        questionId,
        answer: { 0: points as number, 1: 4 - (points as number) },
      }))
    ));

    const [scale] = computeScalePsychometrics(responses, ctx);

    expect(scale.items[0].observations).toBeGreaterThan(0);
    expect(scale.items[0].distribution).toEqual([]);
  });

  it("мёртвый пункт опознаётся по форме распределения", () => {
    const flat: ResponseFact[] = [];
    for (const respondentId of ["R1", "R2", "R3", "R4", "R5"]) {
      flat.push(fact({ respondentId, questionId: "s1", answer: 2 }));
      flat.push(fact({ respondentId, questionId: "s2", answer: 1 }));
    }
    const [scale] = computeScalePsychometrics(flat, {
      ...CTX,
      measurements: measurementsFor(["s1", "s2"]),
    });

    expect(scale.items.find(i => i.questionId === "s1")!.dead).toBe(true);
  });

  it("ипсативная методика помечается: вклады там связаны по построению (FR-32)", () => {
    // Сумма вкладов у каждого респондента одна и та же — так устроено распределение баллов.
    const ipsative: ResponseFact[] = [];
    for (const [respondentId, a, b] of [["R1", 1, 3], ["R2", 2, 2], ["R3", 3, 1]] as Array<[string, number, number]>) {
      ipsative.push(fact({ respondentId, questionId: "s1", answer: a }));
      ipsative.push(fact({ respondentId, questionId: "s2", answer: b }));
    }
    const [scale] = computeScalePsychometrics(ipsative, {
      ...CTX,
      measurements: measurementsFor(["s1", "s2"]),
    });

    expect(scale.ipsative).toBe(true);
  });

  describe("распределение баллов (опросник ведущего стиля, 2026-10-06)", () => {
    /** Два вопроса, в каждом три утверждения — по одному на шкалу «a», «b», «c». */
    const ALLOC: ScaleContext = {
      measurements: ["q1", "q2"].flatMap(questionId =>
        ["a", "b", "c"].map((scaleKey, option) => ({
          questionId,
          scaleKey,
          sourceType: "option_allocation" as const,
          sourceKey: String(option),
          value: 1,
          weight: 1,
        }))),
      scaleLabels: new Map([["a", "A"], ["b", "B"], ["c", "C"]]),
      itemById: new Map(["q1", "q2"].map(questionId => [questionId, {
        questionId, prompt: questionId, type: "allocation", gradeLabels: [],
      }])),
    };
    /** Запас 4 балла на вопрос; нули — законный ответ «не моё». */
    const LAYOUTS: Array<[string, Record<string, number>, Record<string, number>]> = [
      ["R1", { 0: 4, 1: 0, 2: 0 }, { 0: 3, 1: 1, 2: 0 }],
      ["R2", { 0: 2, 1: 2, 2: 0 }, { 0: 2, 1: 0, 2: 2 }],
      ["R3", { 0: 0, 1: 1, 2: 3 }, { 0: 1, 1: 1, 2: 2 }],
      ["R4", { 0: 1, 1: 3, 2: 0 }, { 0: 0, 1: 4, 2: 0 }],
    ];
    const allocResponses = LAYOUTS.flatMap(([respondentId, q1, q2]) => [
      fact({ respondentId, questionId: "q1", answer: q1 }),
      fact({ respondentId, questionId: "q2", answer: q2 }),
    ]);

    it("ноль баллов — ответ, а не пропуск: в альфу идут все участники", () => {
      const scales = computeScalePsychometrics(allocResponses, ALLOC);
      for (const scale of scales) {
        expect(scale.respondents).toBe(4);
        expect(typeof scale.reliability === "string" ? scale.reliability : scale.reliability.respondents).toBe(4);
        expect(scale.items.every(item => item.observations === 4)).toBe(true);
      }
    });

    it("пропущенный вопрос нулём не дополняется", () => {
      const withSkip = [
        ...allocResponses,
        fact({ respondentId: "R5", questionId: "q1", answer: { 0: 4, 1: 0, 2: 0 } }),
        fact({ respondentId: "R5", questionId: "q2", answer: null, outcome: "missing" }),
      ];
      const a = computeScalePsychometrics(withSkip, ALLOC).find(scale => scale.scaleKey === "a")!;
      expect(a.items.find(item => item.questionId === "q2")!.observations).toBe(4);
      // R5 без ответа на q2 в полные строки альфы не попадает.
      expect(typeof a.reliability === "string" ? null : a.reliability.respondents).toBe(4);
    });

    it("шкала из пунктов распределения баллов — ипсативная, хотя суммы внутри неё разные", () => {
      const scales = computeScalePsychometrics(allocResponses, ALLOC);
      expect(scales.every(scale => scale.ipsative)).toBe(true);
    });
  });

  it("задание, не вносящее вклада ни в одну шкалу, в расчёт не идёт", () => {
    const withGraded = [...RESPONSES, fact({ respondentId: "R1", questionId: "q-graded", answer: 0 })];
    const [scale] = computeScalePsychometrics(withGraded, CTX);

    expect(scale.items.map(i => i.questionId)).not.toContain("q-graded");
  });

  it("на пустой выборке шкал не выдумывает", () => {
    expect(computeScalePsychometrics([], CTX)).toEqual([]);
  });

  it("пункт несёт свой вклад в шкалу и тип вопроса (колонка «Вклад»)", () => {
    const [scale] = computeScalePsychometrics(RESPONSES, CTX);
    const first = scale.items.find(i => i.questionId === "s1")!;

    // Вклад градации равен её номеру — шаг +1; обратный пункт с неперевёрнутым вкладом
    // показывает тот же «+1», и в этом автор видит ошибку сборки.
    expect(first.contribution).toEqual({ value: 1, exact: true });
    expect(first.questionType).toBe("scale");
  });
});

describe("itemContribution", () => {
  const likert = (values: number[], weight = 1) => values.map((value, grade) => ({
    questionId: "q", scaleKey: "k", sourceType: "option" as const, sourceKey: String(grade), value, weight,
  }));

  it("прямой пункт Ликерта — «+1», обратный — «−1»", () => {
    expect(itemContribution(likert([0, 1, 2, 3, 4]), "q", "k", "scale", 5)).toEqual({ value: 1, exact: true });
    expect(itemContribution(likert([4, 3, 2, 1, 0]), "q", "k", "scale", 5)).toEqual({ value: -1, exact: true });
  });

  it("вес единицы входит в вклад так же, как в движке шкал (value * weight)", () => {
    expect(itemContribution(likert([1, 2, 3, 4, 5], 2), "q", "k", "scale", 5)).toEqual({ value: 2, exact: true });
  });

  it("неравномерные вклады градаций дают направление, а не точный шаг", () => {
    const result = itemContribution(likert([0, 0, 1, 3, 4]), "q", "k", "scale", 5)!;
    expect(result.exact).toBe(false);
    expect(result.value).toBeGreaterThan(0);
  });

  it("градация без единицы вносит ноль, как в движке", () => {
    // Единицы только у двух верхних градаций: остальные вносят 0.
    const units = likert([0, 0, 0, 1, 2]).slice(3);
    const result = itemContribution(units, "q", "k", "scale", 5)!;
    expect(result.exact).toBe(false);
    expect(result.value).toBeGreaterThan(0);
  });

  it("вклад «за ответ» — его число со знаком", () => {
    const units = [{ questionId: "q", scaleKey: "k", sourceType: "question" as const, sourceKey: null, value: -1, weight: 1 }];
    expect(itemContribution(units, "q", "k", "single", 3)).toEqual({ value: -1, exact: true });
  });

  it("распределение баллов — общий множитель к назначенным баллам", () => {
    const units = [0, 1, 2].map(option => ({
      questionId: "q", scaleKey: "k", sourceType: "option_allocation" as const, sourceKey: String(option), value: -1, weight: 1,
    }));
    expect(itemContribution(units, "q", "k", "allocation", 3)).toEqual({ value: -1, exact: true });
  });

  it("одиночный выбор без порядка вариантов одним числом не выражается", () => {
    expect(itemContribution(likert([2, 0, 1]), "q", "k", "single", 3)).toBeNull();
  });

  it("чужая шкала и чужой вопрос в вклад не входят", () => {
    expect(itemContribution(likert([0, 1, 2]), "q", "other", "scale", 3)).toBeNull();
    expect(itemContribution(likert([0, 1, 2]), "q2", "k", "scale", 3)).toBeNull();
  });
});
