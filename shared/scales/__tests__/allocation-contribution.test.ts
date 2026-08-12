/**
 * @module shared/scales/__tests__/allocation-contribution
 *
 * The measurement source `option_allocation` (PRD-44 §4): the first contribution whose
 * SIZE the learner sets. Every other source contributes a number the author fixed, so the
 * engine could treat «unit fired» and «unit contributed value * weight» as the same fact;
 * here it cannot, and these tests pin the difference.
 *
 * The scale domain gets its own block because an error there does not move a number, it
 * moves a VERDICT: `achievableRange` feeds both percent normalization and the PRD-29 band
 * ruler, so a domain that is too wide puts the level marker under the wrong band (R-3).
 */
import { describe, expect, it } from "vitest";
import { achievableRange, computeAnswerContributions, computeScales, type MeasurementSpec } from "../engine";
import type { QuestionType } from "../../questions/question-type";
import type { AllocationSpec } from "../../questions/allocation";
import {
  CHIL_ANSWERS,
  CHIL_BUDGETS,
  CHIL_EXPECTED_SUM,
  CHIL_EXPECTED_TOTALS,
  CHIL_MEASUREMENTS,
  CHIL_SCALES,
  CHIL_TYPES,
} from "./fixtures/chil-reference";

const unit = (index: number, over: Partial<MeasurementSpec> = {}): MeasurementSpec => ({
  questionId: "q1",
  scaleKey: "s",
  sourceType: "option_allocation",
  sourceKey: String(index),
  value: 1,
  weight: 1,
  ...over,
});

const TYPES: Record<string, QuestionType> = { q1: "allocation" };
const SPEC: AllocationSpec = { options: ["a", "b", "c", "d"], budget: 7, minPerOption: 0, maxPerOption: 7 };
const BUDGETS: Record<string, AllocationSpec> = { q1: SPEC };

describe("вклад единицы распределения (FR-12, FR-13)", () => {
  it("вклад равен присвоенному баллу, умноженному на коэффициент и вес", () => {
    const out = computeAnswerContributions([unit(0, { value: 2, weight: 3 })], "q1", { 0: 3, 1: 4 }, "allocation");
    expect(out).toEqual([{ scaleKey: "s", delta: 18 }]);
  });

  it("коэффициент 1 означает «балл учащегося равен вкладу» (случай референса)", () => {
    const out = computeAnswerContributions([unit(0)], "q1", { 0: 5, 1: 2 }, "allocation");
    expect(out).toEqual([{ scaleKey: "s", delta: 5 }]);
  });

  it("отрицательный коэффициент даёт обратный вклад", () => {
    const out = computeAnswerContributions([unit(1, { value: -1 })], "q1", { 0: 3, 1: 4 }, "allocation");
    expect(out).toEqual([{ scaleKey: "s", delta: -4 }]);
  });

  it("нулевой балл единицу не активирует", () => {
    expect(computeAnswerContributions([unit(1)], "q1", { 0: 7, 1: 0 }, "allocation")).toEqual([]);
  });

  it("нетронутый вопрос вкладов не даёт", () => {
    expect(computeAnswerContributions([unit(0)], "q1", undefined, "allocation")).toEqual([]);
    expect(computeAnswerContributions([unit(0)], "q1", null, "allocation")).toEqual([]);
  });

  it("один вопрос даёт несколько дельт в одну шкалу", () => {
    // Механизм это уже допускает (множественный выбор), и выгрузка попытки на это опирается.
    const out = computeAnswerContributions([unit(0), unit(2)], "q1", { 0: 3, 1: 0, 2: 4 }, "allocation");
    expect(out).toEqual([
      { scaleKey: "s", delta: 3 },
      { scaleKey: "s", delta: 4 },
    ]);
  });

  it("вклад в агрегате совпадает с вкладом в выгрузке — путь расчёта один", () => {
    const measurements = [unit(0), unit(1, { value: 2 })];
    const answer = { 0: 3, 1: 2, 2: 2, 3: 0 };
    const { values } = computeScales(
      [{ key: "s", aggregation: "sum", normalization: "none", direction: "positive" }],
      measurements,
      { q1: answer },
      TYPES,
    );
    const perAnswer = computeAnswerContributions(measurements, "q1", answer, "allocation");
    expect(values.s.raw).toBe(perAnswer.reduce((sum, c) => sum + c.delta, 0));
    expect(values.s.raw).toBe(7);
  });
});

describe("домен шкалы для распределения (FR-15)", () => {
  it("верх ограничен бюджетом, а не суммой максимумов вариантов", () => {
    // Три единицы по максимуму 7 дали бы 21, но варианты делят ОБЩИЙ бюджет 7.
    expect(achievableRange([unit(0), unit(1), unit(2)], "sum", TYPES, BUDGETS)).toEqual({ min: 0, max: 7 });
  });

  it("одна единица шкалы: домен 0..бюджет", () => {
    expect(achievableRange([unit(0)], "sum", TYPES, BUDGETS)).toEqual({ min: 0, max: 7 });
  });

  it("максимум на вариант ниже бюджета ограничивает верх", () => {
    // Четыре варианта, бюджет 7, максимум 2 на вариант. Верх шкалы — её собственный
    // максимум 2. Низ НЕ ноль: остальные три варианта впитают не больше 6, поэтому
    // как минимум 1 балл вынужден лечь на этот вариант.
    const budgets = { q1: { ...SPEC, maxPerOption: 2 } };
    expect(achievableRange([unit(0)], "sum", TYPES, budgets)).toEqual({ min: 1, max: 2 });
    // Две единицы: их максимум 4, а вынужденный низ — 7 - 2*2 = 3.
    expect(achievableRange([unit(0), unit(1)], "sum", TYPES, budgets)).toEqual({ min: 3, max: 4 });
  });

  it("ненулевой минимум поднимает низ домена и опускает верх", () => {
    // Минимум 1 на каждый из четырёх вариантов: две единицы шкалы держат не меньше 2,
    // и не больше 5 — оставшиеся два варианта обязаны получить по единице.
    const budgets = { q1: { ...SPEC, minPerOption: 1 } };
    expect(achievableRange([unit(0), unit(1)], "sum", TYPES, budgets)).toEqual({ min: 2, max: 5 });
  });

  it("низ учитывает, что остальные варианты не могут впитать весь бюджет", () => {
    // Два варианта всего, бюджет 7, максимум 5: второй вариант возьмёт не больше 5,
    // значит первому достаётся минимум 2 — низ домена его шкалы не ноль.
    const budgets = { q1: { options: ["a", "b"], budget: 7, minPerOption: 0, maxPerOption: 5 } };
    expect(achievableRange([unit(0)], "sum", TYPES, budgets)).toEqual({ min: 2, max: 5 });
  });

  it("отрицательный коэффициент разворачивает домен", () => {
    expect(achievableRange([unit(0, { value: -1 })], "sum", TYPES, BUDGETS)).toEqual({ min: -7, max: 0 });
  });

  it("без спецификации бюджета домен не выдумывается", () => {
    // Пропущенный бюджет — это ошибка вызова, а не повод показать домен наугад:
    // завышенный домен сместил бы вердикт PRD-29 молча.
    expect(achievableRange([unit(0)], "sum", TYPES, {})).toEqual({ min: 0, max: 0 });
  });

  it("смешанный тест: распределение рядом с обычным выбором (R-3)", () => {
    const measurements: MeasurementSpec[] = [
      unit(0),
      { questionId: "q2", scaleKey: "s", sourceType: "option", sourceKey: "0", value: 3, weight: 1 },
      { questionId: "q2", scaleKey: "s", sourceType: "option", sourceKey: "1", value: 5, weight: 1 },
    ];
    const types: Record<string, QuestionType> = { q1: "allocation", q2: "single" };
    // Распределение даёт 0..7, одиночный выбор 0..5 — вместе 0..12.
    expect(achievableRange(measurements, "sum", types, BUDGETS)).toEqual({ min: 0, max: 12 });
  });
});

describe("нормализация в проценты (R-3)", () => {
  const percentScale = [
    { key: "s", aggregation: "sum" as const, normalization: "percent" as const, direction: "positive" as const },
  ];

  it("процент считается от домена, ограниченного бюджетом", () => {
    // Один вопрос, бюджет 7, одна единица шкалы: домен 0..7, ответ 3 -> 42.86%.
    const out = computeScales(percentScale, [unit(0)], { q1: { 0: 3, 1: 4 } }, TYPES, BUDGETS);
    expect(out.errors).toEqual([]);
    expect(out.values.s.percent).toBeCloseTo((3 / 7) * 100, 6);
  });

  it("весь бюджет на одну шкалу даёт ровно 100 процентов", () => {
    const out = computeScales(percentScale, [unit(0)], { q1: { 0: 7, 1: 0 } }, TYPES, BUDGETS);
    expect(out.values.s.percent).toBe(100);
  });

  it("процент не выходит за границы на смешанном тесте", () => {
    const measurements: MeasurementSpec[] = [
      unit(0),
      { questionId: "q2", scaleKey: "s", sourceType: "option", sourceKey: "1", value: 5, weight: 1 },
    ];
    const types: Record<string, QuestionType> = { q1: "allocation", q2: "single" };
    const out = computeScales(percentScale, measurements, { q1: { 0: 7, 1: 0 }, q2: 1 }, types, BUDGETS);
    expect(out.values.s.raw).toBe(12);
    expect(out.values.s.percent).toBe(100);
  });

  it("обратное направление шкалы считает процент от верха домена", () => {
    const inverse = [{ ...percentScale[0], direction: "inverse" as const }];
    const out = computeScales(inverse, [unit(0)], { q1: { 0: 7, 1: 0 } }, TYPES, BUDGETS);
    expect(out.values.s.percent).toBe(0);
  });
});

describe("расчёт на референсе (приёмка A-02)", () => {
  const { values, errors } = computeScales(CHIL_SCALES, CHIL_MEASUREMENTS, CHIL_ANSWERS, CHIL_TYPES);

  it("считается без ошибок", () => {
    expect(errors).toEqual([]);
  });

  it("суммы по стилям совпадают с итогами файла", () => {
    expect(values.cel.raw).toBe(CHIL_EXPECTED_TOTALS.cel);
    expect(values.vdo.raw).toBe(CHIL_EXPECTED_TOTALS.vdo);
    expect(values.kom.raw).toBe(CHIL_EXPECTED_TOTALS.kom);
    expect(values.pro.raw).toBe(CHIL_EXPECTED_TOTALS.pro);
  });

  it("сумма по всем стилям равна общему бюджету опросника", () => {
    const total = Object.values(values).reduce((sum, v) => sum + v.raw, 0);
    expect(total).toBe(CHIL_EXPECTED_SUM);
  });

  it("ведущих стилей ДВА: ничья реальна, а не теоретична", () => {
    // Файл разрешает её молча — MATCH(MAX(...)) отдаёт победу левой колонке.
    // FR-21/FR-22 требуют, чтобы правило было явным, а ничья видимой.
    const top = Math.max(...Object.values(values).map((v) => v.raw));
    const winners = Object.entries(values).filter(([, v]) => v.raw === top).map(([key]) => key);
    expect(top).toBe(34);
    expect(winners).toEqual(["cel", "pro"]);
  });

  it("домен одного стиля равен 0..98 — как сказано в примечании файла", () => {
    const celMeasurements = CHIL_MEASUREMENTS.filter((m) => m.scaleKey === "cel");
    expect(achievableRange(celMeasurements, "sum", CHIL_TYPES, CHIL_BUDGETS)).toEqual({ min: 0, max: 98 });
  });
});
