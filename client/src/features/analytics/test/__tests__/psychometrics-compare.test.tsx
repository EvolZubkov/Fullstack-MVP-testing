/**
 * @module features/analytics/test/__tests__/psychometrics-compare
 * @description PRD-66 FR-04b — FR-04c: сравнение психометрики по срезам.
 *
 * Главное, что здесь стережётся, — правило колонки «Разница»: она появляется ТОЛЬКО при двух
 * срезах и ТОЛЬКО у сопоставимых величин. Это правило PRD-56, и расхождение с ним сделало бы
 * один механизм двумя.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PsychometricsCompare, type PsychometricsSlice } from "../psychometrics-compare";

function slice(over: Partial<PsychometricsSlice> & Pick<PsychometricsSlice, "id" | "name">): PsychometricsSlice {
  return {
    conditions: {},
    alpha: 0.84,
    reliabilityGap: null,
    sem: 2.1,
    respondents: 120,
    observations: 1200,
    itemsCount: 42,
    suspiciousCount: 5,
    items: [
      { questionId: "q1", prompt: "Первое задание", difficulty: 0.62, itemRest: 0.31, observations: 120 },
      { questionId: "q2", prompt: "Второе задание", difficulty: 0.41, itemRest: 0.28, observations: 118 },
    ],
    ...over,
  };
}

const TWO = [
  slice({ id: "s1", name: "Розница" }),
  slice({ id: "s2", name: "Опт", alpha: 0.72, sem: 2.8, suspiciousCount: 9 }),
];

describe("PsychometricsCompare", () => {
  it("ставит срезы колонками и показывает надёжность с ошибкой измерения", () => {
    render(<PsychometricsCompare slices={TWO} />);

    expect(screen.getAllByText("Розница").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Опт").length).toBeGreaterThan(0);
    expect(screen.getByText("Надёжность (альфа)")).toBeTruthy();
    expect(screen.getByText("Ошибка измерения")).toBeTruthy();
  });

  it("при ДВУХ срезах считает разницу у сопоставимых величин", () => {
    render(<PsychometricsCompare slices={TWO} />);

    // 0,84 − 0,72 = +0,12
    expect(screen.getByText("+0,12")).toBeTruthy();
  });

  it("у СЧЁТНОЙ строки разницы нет даже при двух срезах (FR-04b2)", () => {
    // Разность счётчиков говорит о размере группы, а не о качестве теста.
    render(<PsychometricsCompare slices={TWO} />);

    const row = screen.getByText("Вопросов под подозрением").closest("tr")!;
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(row).queryByText("−4")).toBeNull();
  });

  it("при ТРЁХ срезах колонки «Разница» нет вовсе", () => {
    // Разница между какими двумя из трёх — вопрос без ответа, а «эталонного» среза продукт
    // не заводит.
    render(<PsychometricsCompare slices={[...TWO, slice({ id: "s3", name: "Сервис" })]} />);

    expect(screen.queryByText("Разница")).toBeNull();
    expect(screen.getByText(/Разница считается только при двух срезах/)).toBeTruthy();
  });

  it("сравнивает трудность ПО ЗАДАНИЯМ", () => {
    render(<PsychometricsCompare slices={TWO} />);

    expect(screen.getByText("Трудность вопросов")).toBeTruthy();
    expect(screen.getByText("Первое задание")).toBeTruthy();
  });

  it("задание, которого в срезе не было, отмечено прочерком, а не нулём", () => {
    // Это факт о сравнении: прятать такое задание значило бы молча укоротить разговор.
    const missing = slice({ id: "s2", name: "Опт", items: [
      { questionId: "q1", prompt: "Первое задание", difficulty: 0.55, itemRest: 0.3, observations: 40 },
    ] });
    render(<PsychometricsCompare slices={[TWO[0], missing]} />);

    const row = screen.getByText("Второе задание").closest("tr")!;
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("причину отсутствия надёжности называет словами, а не прочерком", () => {
    const thin = slice({ id: "s2", name: "Опт", alpha: null, reliabilityGap: "too-few-respondents", sem: null });
    render(<PsychometricsCompare slices={[TWO[0], thin]} />);

    expect(screen.getByText("не посчитана")).toBeTruthy();
  });

  // Эскиз prd66-item-quality, состояние compare (задача 3.4 плана сверки).
  it("под именем среза в заголовке колонки — число прохождений в расчёте", () => {
    render(<PsychometricsCompare slices={[TWO[0], slice({ id: "s2", name: "Опт", respondents: 272 })]} />);

    expect(screen.getAllByText("120 прохождений").length).toBeGreaterThan(0);
    expect(screen.getAllByText("272 прохождения").length).toBeGreaterThan(0);
  });

  it("строки «Участников в расчёте» нет: объём стоит в заголовке колонки", () => {
    render(<PsychometricsCompare slices={TWO} />);
    expect(screen.queryByText("Участников в расчёте")).toBeNull();
  });

  it("«Вопросов под подозрением» — числом, без «из N»", () => {
    render(<PsychometricsCompare slices={TWO} />);

    const row = screen.getByText("Вопросов под подозрением").closest("tr")!;
    expect(within(row).getByText("5")).toBeTruthy();
    expect(within(row).queryByText(/из 42/)).toBeNull();
  });

  it("одного среза для сравнения мало — так и говорит", () => {
    render(<PsychometricsCompare slices={[TWO[0]]} />);
    expect(screen.getByText(/нужны хотя бы два среза/)).toBeTruthy();
  });
});
