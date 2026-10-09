/**
 * @module tests/scale-icons
 * @description Разрешение имени пиктограммы в контуры (PRD-46 §8).
 *
 * Отдельный тест появился из-за обновления библиотеки: lucide ПЕРЕИМЕНОВЫВАЕТ глифы
 * (`circle-help` -> `circle-question-mark`), оставляя прежнее имя алиасом, а генератор
 * алиасы в набор не кладёт — иначе автор видел бы два имени одной картинки. Имя при этом
 * уже лежит в тестах, выбранное до переименования, и без карты алиасов пиктограмма просто
 * исчезла бы после обновления. Проверяем, что она не исчезает.
 */
import { describe, it, expect } from "vitest";
import { iconContours, iconNames } from "../server/services/scale-icons";
import ALIASES from "@shared/template/lucide-aliases.generated.json";

describe("iconContours", () => {
  it("рисует глиф по каноническому имени", () => {
    const paths = iconContours("square-off");
    expect(Array.isArray(paths)).toBe(true);
    expect(paths!.length).toBeGreaterThan(0);
  });

  it("рисует глиф по ПРЕЖНЕМУ имени — тем же контуром, что и нынешнее", () => {
    const [oldName, canonical] = Object.entries(ALIASES as Record<string, string>)[0];
    expect(iconContours(oldName)).toEqual(iconContours(canonical));
  });

  it("`circle-help` из старого набора по-прежнему рисуется", () => {
    expect(iconContours("circle-help")).not.toBeNull();
  });

  it("неизвестное имя даёт null, а не пустой массив", () => {
    expect(iconContours("такого-глифа-нет")).toBeNull();
  });

  it("в перечне для выбора алиасов НЕТ — одно имя на одну картинку", () => {
    const names = new Set(iconNames());
    const aliasNames = Object.keys(ALIASES as Record<string, string>);
    expect(aliasNames.length).toBeGreaterThan(0);
    expect(aliasNames.filter((n) => names.has(n))).toEqual([]);
  });
});
