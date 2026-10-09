/**
 * @module tests/config-exposure-window
 * @description PRD-55 (FR-04): окно наблюдения экспозиции — свойство ИНСТАНСА, а не теста.
 * Отсутствие значения означает 12 месяцев, бессмысленное значение молча не принимается: с нулём
 * или отрицательным окном счётчик читался бы пустым, и поправка тихо выключилась бы целиком.
 */
import { describe, it, expect } from "vitest";
import { shape } from "../server/config";

describe("delivery.exposureWindowMonths", () => {
  it("по умолчанию 12 месяцев", () => {
    expect(shape({}).delivery.exposureWindowMonths).toBe(12);
  });

  it("берёт значение из конфигурации", () => {
    expect(shape({ delivery: { exposureWindowMonths: 6 } }).delivery.exposureWindowMonths).toBe(6);
  });

  it("отбрасывает ноль", () => {
    expect(shape({ delivery: { exposureWindowMonths: 0 } }).delivery.exposureWindowMonths).toBe(12);
  });

  it("отбрасывает отрицательное значение", () => {
    expect(shape({ delivery: { exposureWindowMonths: -3 } }).delivery.exposureWindowMonths).toBe(12);
  });

  it("округляет дробное вниз", () => {
    expect(shape({ delivery: { exposureWindowMonths: 7.9 } }).delivery.exposureWindowMonths).toBe(7);
  });

  it("читает число, записанное строкой", () => {
    expect(shape({ delivery: { exposureWindowMonths: "18" } }).delivery.exposureWindowMonths).toBe(18);
  });
});
