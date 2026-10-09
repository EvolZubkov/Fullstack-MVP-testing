/**
 * @module shared/draw/__tests__/expected-exposure
 * @description PRD-55 (FR-33): ожидаемая экспозиция — сколько участников увидят каждое задание
 * темы при нынешних настройках выдачи.
 *
 * Величина НЕ требует накопленных данных: она следует из размера банка и объёма выдачи, поэтому
 * работает и на пустом тесте, который ещё никто не проходил. Ради этого она и вынесена чистой
 * функцией — её одинаково зовут редактор, сводка свёрнутой темы и окно экспорта.
 */
import { describe, it, expect } from "vitest";
import { expectedExposure, EXPOSURE_WARN_THRESHOLD } from "../expected-exposure";

describe("expectedExposure", () => {
  it("выдача почти всего банка — предупреждение", () => {
    expect(expectedExposure({ drawCount: 20, poolSize: 25 })).toEqual({ percent: 80, tone: "warning" });
  });

  it("запас банка достаточный — сообщение", () => {
    expect(expectedExposure({ drawCount: 10, poolSize: 80 })).toEqual({ percent: 13, tone: "info" });
  });

  it("выдаётся весь банк — сто процентов", () => {
    expect(expectedExposure({ drawCount: 12, poolSize: 12 })).toEqual({ percent: 100, tone: "warning" });
  });

  it("процент округляется до целого: доли процента автору ничего не говорят", () => {
    expect(expectedExposure({ drawCount: 1, poolSize: 3 })?.percent).toBe(33);
  });

  it("порог — граничное значение, а не строгое превышение", () => {
    const atThreshold = expectedExposure({ drawCount: 7, poolSize: 10 });
    expect(atThreshold?.percent).toBe(EXPOSURE_WARN_THRESHOLD);
    expect(atThreshold?.tone).toBe("warning");
  });

  it("пустой банк — величины нет вовсе", () => {
    expect(expectedExposure({ drawCount: 5, poolSize: 0 })).toBeNull();
  });

  it("выдача не задана — величины нет", () => {
    expect(expectedExposure({ drawCount: 0, poolSize: 20 })).toBeNull();
  });

  it("выдача больше банка невозможна, но считается честно", () => {
    // Редактор такого не даст, а книга Excel и перенос теста — могут. Подрезка до 100% спрятала
    // бы расхождение настроек с банком, которое автору как раз надо увидеть.
    expect(expectedExposure({ drawCount: 30, poolSize: 25 })).toEqual({ percent: 120, tone: "warning" });
  });
});
