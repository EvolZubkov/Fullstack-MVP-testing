/**
 * @module features/tests/editor/__tests__/profile-matrix.test
 * @description Заготовки исходов шаблона «Профиль по группе шкал» (PRD-53 §5.2).
 */
import { describe, expect, it } from "vitest";
import { profileMatrix, profileSetLabel, type ProfileScale } from "../profile-matrix";

const SCALES: ProfileScale[] = [
  { key: "cel", label: "Целеустремленный" },
  { key: "vdo", label: "Вдохновляющий" },
  { key: "kom", label: "Командный" },
  { key: "pro", label: "Процессный" },
];

describe("profileSetLabel", () => {
  it("один стиль", () => {
    expect(profileSetLabel(["cel"], SCALES)).toBe("Сфокусированный: Целеустремленный");
  });

  it("два стиля соединяются союзом", () => {
    expect(profileSetLabel(["cel", "pro"], SCALES)).toBe(
      "Двухвекторный: Целеустремленный и Процессный",
    );
  });

  it("три стиля — запятые и союз перед последним", () => {
    expect(profileSetLabel(["cel", "vdo", "kom"], SCALES)).toBe(
      "Широкий: Целеустремленный, Вдохновляющий и Командный",
    );
  });

  it("вся группа", () => {
    expect(profileSetLabel(["cel", "vdo", "kom", "pro"], SCALES)).toBe(
      "Сбалансированный: Целеустремленный, Вдохновляющий, Командный и Процессный",
    );
  });

  it("шкала без названия подписывается ключом", () => {
    expect(profileSetLabel(["zzz"], SCALES)).toBe("Сфокусированный: zzz");
  });
});

describe("profileMatrix", () => {
  it("для четырёх шкал даёт пятнадцать заготовок", () => {
    expect(profileMatrix(["cel", "vdo", "kom", "pro"], SCALES)).toHaveLength(15);
  });

  it("заготовка несёт код и метку, но не текст", () => {
    expect(profileMatrix(["cel", "vdo"], SCALES)[0]).toEqual({
      code: "cel",
      label: "Сфокусированный: Целеустремленный",
    });
  });

  it("порядок — по возрастанию размера набора", () => {
    expect(profileMatrix(["cel", "vdo"], SCALES).map((r) => r.code)).toEqual([
      "cel",
      "vdo",
      "cel+vdo",
    ]);
  });

  it("код канонический независимо от порядка выбора шкал", () => {
    expect(profileMatrix(["pro", "cel"], SCALES).map((r) => r.code)).toEqual([
      "cel",
      "pro",
      "cel+pro",
    ]);
  });

  it("заготовки по размеру набора нумеруются count:N", () => {
    expect(profileMatrix(["cel", "vdo"], SCALES, { byCountOnly: true })).toEqual([
      { code: "count:1", label: "Сфокусированный" },
      { code: "count:2", label: "Двухвекторный" },
    ]);
  });

  it("слишком большая группа перечислению не подлежит", () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ key: `s${i}`, label: `Ш${i}` }));
    expect(profileMatrix(many.map((s) => s.key), many)).toEqual([]);
  });
});
