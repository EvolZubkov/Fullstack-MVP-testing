/**
 * @module shared/draw/__tests__/blueprint-pick
 * @description PRD-55 (FR-18, FR-24): выдача принимает ОТБОР, а не перемешивание, и зовёт его в
 * обеих точках — при наборе страты по квоте и при добивке остатка.
 *
 * Проверяется именно то, что раньше было невыразимо: равномерный отбор стал частным случаем
 * взвешенного, поэтому второй реализации алгоритма выдачи в проекте не появилось.
 */
import { describe, it, expect } from "vitest";
import { drawSection, type PickFn } from "../blueprint";

const q = (id: string, ...tags: string[]) => ({ id, tags });

/** Отбор, который всегда берёт ПОСЛЕДНИЕ k — так видно, что он вызван, и в какой точке. */
const takeLast: PickFn = (pool, k) => pool.slice(-k);

describe("drawSection с инъектируемым pick", () => {
  it("зовёт pick при наборе страты", () => {
    const qs = [q("1", "A"), q("2", "A"), q("3")];
    const { selected } = drawSection(qs, 1, { strata: [{ tag: "A", count: 1 }] }, takeLast);
    expect(selected.map((x) => x.id)).toEqual(["2"]);
  });

  it("зовёт pick при добивке остатка", () => {
    const qs = [q("1", "A"), q("2"), q("3")];
    const { selected } = drawSection(qs, 2, { strata: [{ tag: "A", count: 1 }] }, takeLast);
    expect(selected.map((x) => x.id)).toEqual(["1", "3"]);
  });

  it("без чертежа берёт drawCount через pick", () => {
    const qs = [q("1"), q("2"), q("3")];
    const { selected } = drawSection(qs, 2, null, takeLast);
    expect(selected.map((x) => x.id)).toEqual(["2", "3"]);
  });

  it("недобор страты по-прежнему даёт предупреждение, а не исключение", () => {
    const qs = [q("1", "A")];
    const { selected, warnings } = drawSection(qs, 3, { strata: [{ tag: "A", count: 3 }] }, takeLast);
    expect(selected.map((x) => x.id)).toEqual(["1"]);
    expect(warnings).toEqual([{ tag: "A", requested: 3, available: 1 }]);
  });
});
