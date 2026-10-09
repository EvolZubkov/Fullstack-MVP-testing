/**
 * @module shared/formula/__tests__/resolve-scale-group
 *
 * PRD-53, находка F6 приёмки 2026-09-07: карточка «шкалы вне профиля» правится у того
 * показателя, который её ПЕЧАТАЕТ, а печатает её не обязательно тот, кто считает набор.
 * Разойтись они обязаны по устройству продукта — см. JSDoc `resolveScaleGroup`.
 */
import { describe, it, expect } from "vitest";
import { resolveScaleGroup } from "../outcome-literals";

const PROFILE = 'topGroup(["cel","vdo","kom","pro"], 5).code';

/** Показатели теста как «имя -> формула». */
function bank(map: Record<string, string>) {
  return (name: string) => map[name];
}

describe("resolveScaleGroup", () => {
  it("возвращает собственную группу показателя-вычислителя", () => {
    const group = resolveScaleGroup(PROFILE, bank({}));
    expect(group).toEqual({ keys: ["cel", "vdo", "kom", "pro"], threshold: 5 });
  });

  it("идёт по `var()` к соседу и берёт его группу", () => {
    const group = resolveScaleGroup('var("profile")', bank({ profile: PROFILE }));
    expect(group?.keys).toEqual(["cel", "vdo", "kom", "pro"]);
  });

  it("проходит цепочку из нескольких ссылок", () => {
    const group = resolveScaleGroup(
      'var("a")',
      bank({ a: 'var("b")', b: 'var("profile")', profile: PROFILE }),
    );
    expect(group?.threshold).toBe(5);
  });

  it("не зацикливается на ссылке по кругу", () => {
    const group = resolveScaleGroup('var("a")', bank({ a: 'var("b")', b: 'var("a")' }));
    expect(group).toBeNull();
  });

  it("не зацикливается на ссылке самого на себя", () => {
    const group = resolveScaleGroup('var("a")', bank({ a: 'var("a")' }));
    expect(group).toBeNull();
  });

  it("обрывает слишком длинную цепочку", () => {
    const chain: Record<string, string> = { profile: PROFILE };
    for (let i = 0; i < 10; i += 1) chain[`v${i}`] = `var("${i === 9 ? "profile" : `v${i + 1}`}")`;
    expect(resolveScaleGroup('var("v0")', bank(chain))).toBeNull();
  });

  it("молчит, когда ссылка ведёт в несуществующий показатель", () => {
    expect(resolveScaleGroup('var("нет-такого")', bank({}))).toBeNull();
  });

  it("не разбирает ссылку внутри выражения: единого профиля там нет", () => {
    expect(resolveScaleGroup('IF(var("profile") == "cel", 1, 0)', bank({ profile: PROFILE }))).toBeNull();
  });

  it("молчит на формуле без профиля и без ссылок", () => {
    expect(resolveScaleGroup('topScale(["cel","vdo"], 1).key', bank({}))).toBeNull();
  });
});
