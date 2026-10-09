import { describe, expect, it } from "vitest";
import { buildRestScalesView, type MeasureInput } from "../result-context";

function scale(key: string, name: string, value: number, description: string): MeasureInput {
  return {
    key,
    name,
    value,
    description,
    visibility: "level_and_value",
    interpretation: {
      domainMin: null,
      domainMax: null,
      displayMax: null,
      valence: "none",
      bands: [],
    },
  };
}

const SCALES = [
  scale("cel", "Целеустремленный", 42, "Ориентирован на результат."),
  scale("vdo", "Вдохновляющий", 7, "Ориентирован на развитие людей."),
  scale("kom", "Командный", 12, "Ориентирован на команду."),
  scale("pro", "Процессный", 42, "Ориентирован на организацию работы."),
];

function profile(value: string): MeasureInput {
  return {
    key: "lead_style",
    name: "Профиль",
    value,
    visibility: "level",
    interpretation: { domainMin: null, domainMax: null, valence: "none", bands: [], outcomes: [] },
    restScales: {
      show: true,
      label: "Ознакомьтесь с другими стилями",
      keys: ["cel", "vdo", "kom", "pro"],
    },
  };
}

describe("карточка «вне профиля» (PRD-53 §4.4)", () => {
  it("перечисляет шкалы группы вне набора по убыванию значения", () => {
    const card = buildRestScalesView(profile("cel+pro"), SCALES);
    expect(card?.name).toBe("Ознакомьтесь с другими стилями");
    expect(card?.text).toBe(
      "Командный\nОриентирован на команду.\n\nВдохновляющий\nОриентирован на развитие людей.",
    );
  });

  it("не печатается, когда в наборе все шкалы группы", () => {
    expect(buildRestScalesView(profile("cel+vdo+kom+pro"), SCALES)).toBeNull();
  });

  it("не печатается при выключенном переключателе", () => {
    const off = profile("cel+pro");
    off.restScales!.show = false;
    expect(buildRestScalesView(off, SCALES)).toBeNull();
  });

  it("берёт только шкалы ГРУППЫ, а не все шкалы теста", () => {
    const narrow = profile("cel");
    narrow.restScales!.keys = ["cel", "vdo"];
    expect(buildRestScalesView(narrow, SCALES)?.text).toBe(
      "Вдохновляющий\nОриентирован на развитие людей.",
    );
  });

  it("шкала без описания печатает одно название", () => {
    const noDesc = SCALES.map((s) => ({ ...s, description: "" }));
    expect(buildRestScalesView(profile("cel+pro"), noDesc)?.text).toBe("Командный\n\nВдохновляющий");
  });

  it("значение не строка — печатать нечего", () => {
    const numeric = profile("cel+pro");
    numeric.value = 9;
    expect(buildRestScalesView(numeric, SCALES)).toBeNull();
  });
});
