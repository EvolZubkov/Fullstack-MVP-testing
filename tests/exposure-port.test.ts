/**
 * @module tests/exposure-port
 * @description PRD-55 (FR-25): golden-парность веса и отбора между TS-источником
 * (`shared/draw/exposure.ts`) и РУЧНЫМ плейн-JS двойником в рантайме пакета
 * (`server/scorm/assets/app.js`).
 *
 * Приём тот же, что в tests/draw-blueprint-port.test.ts: обе реализации гоняются по одному
 * набору входов, поэтому разойтись молча они не могут. Расхождение здесь означало бы, что веб и
 * пакет выдают РАЗНЫЕ задания при одинаковой истории выдач, — дефект, который в жизни
 * обнаружился бы статистикой через месяцы.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computeWeights as tsWeights,
  weightedPick as tsPick,
  EXPOSURE_WEIGHT_RATIO,
} from "../shared/draw/exposure";

const src = readFileSync(resolve(process.cwd(), "server/scorm/assets/app.js"), "utf8");

function extract(name: string): Function {
  const m = src.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`${name} not found in assets/app.js`);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`var EXPOSURE_WEIGHT_RATIO = ${EXPOSURE_WEIGHT_RATIO};\n${m[0]}\n;return ${name};`)();
}

const portWeights = extract("computeExposureWeights") as typeof tsWeights;
const portPick = extract("weightedPick") as typeof tsPick;

/** Воспроизводимый генератор: обе стороны должны получить ОДНУ последовательность. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const cases: Array<{ name: string; ids: string[]; counts: Array<[string, number]> }> = [
  { name: "равные счётчики", ids: ["a", "b", "c"], counts: [["a", 5], ["b", 5], ["c", 5]] },
  { name: "нет данных", ids: ["a", "b"], counts: [] },
  { name: "крайние значения", ids: ["a", "b"], counts: [["a", 10], ["b", 0]] },
  { name: "промежуточное", ids: ["a", "b", "c"], counts: [["a", 10], ["b", 5], ["c", 0]] },
  { name: "частичная карта", ids: ["a", "b"], counts: [["a", 4]] },
  { name: "один элемент", ids: ["a"], counts: [["a", 99]] },
  { name: "большой разброс", ids: ["a", "b", "c", "d"], counts: [["a", 0], ["b", 1], ["c", 500], ["d", 10000]] },
];

describe("экспозиция — парность TS ↔ JS", () => {
  it("константа предела совпадает в обеих реализациях", () => {
    expect(src).toContain(`var EXPOSURE_WEIGHT_RATIO = ${EXPOSURE_WEIGHT_RATIO};`);
  });

  it.each(cases)("вес: $name", ({ ids, counts }) => {
    const a = tsWeights(ids, new Map(counts));
    const b = portWeights(ids, new Map(counts));
    expect([...b.entries()]).toEqual([...a.entries()]);
  });

  it.each(cases)("отбор: $name", ({ ids, counts }) => {
    const pool = ids.map((id) => ({ id }));
    const w = tsWeights(ids, new Map(counts));
    const a = tsPick(pool, 2, w, seeded(42));
    const b = portPick(pool, 2, w, seeded(42));
    expect(b.map((x: { id: string }) => x.id)).toEqual(a.map((x) => x.id));
  });

  it("пустой пул одинаково даёт пустой результат", () => {
    expect(portPick([], 3, new Map(), seeded(1))).toEqual(tsPick([], 3, new Map(), seeded(1)));
  });
});
