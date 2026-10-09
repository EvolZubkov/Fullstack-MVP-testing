/**
 * @module tests/scorm-exposure-runtime
 * @description PRD-55 (FR-28, FR-30): рантайм пакета берёт ЗАПЕЧЁННЫЙ вес и ничего не
 * пересчитывает — счётчика по популяции у него нет.
 *
 * Отсутствие поля означает вес 1, поэтому пакеты, собранные до внедрения, играются ровно как
 * раньше. Проверяется это на самой функции выдачи, вырезанной из `assets/app.js`: поднимать весь
 * рантайм ради одного решения об отборе незачем, а вырезка — уже принятый в проекте приём
 * (tests/draw-blueprint-port.test.ts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(process.cwd(), "server/scorm/assets/app.js"), "utf8");

/** Вырезает набор функций рантайма и отдаёт последнюю из них. */
function extract(names: string[]): Function {
  const bodies = names.map((name) => {
    const m = src.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
    if (!m) throw new Error(`${name} not found in assets/app.js`);
    return m[0];
  });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    `var EXPOSURE_WEIGHT_RATIO = 4;\n${bodies.join("\n")}\n;return ${names[names.length - 1]};`,
  )();
}

const weightedPick = extract(["weightedPick"]) as (
  pool: Array<{ id: string; exposureWeight?: number }>,
  k: number,
  weights: Map<string, number>,
  rnd: () => number,
) => Array<{ id: string }>;

/**
 * Ровно та карта весов, которую строит `generateVariant`: из поля вопроса, с единицей как
 * умолчанием. Дублируется здесь, чтобы тест проверял ПРАВИЛО, а не вызывал ту же строку кода.
 */
function weightsFromBake(pool: Array<{ id: string; exposureWeight?: number }>): Map<string, number> {
  const weights = new Map<string, number>();
  pool.forEach((q) => weights.set(q.id, q.exposureWeight === undefined ? 1 : q.exposureWeight));
  return weights;
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe("рантайм пакета и запечённый вес", () => {
  it("вопрос с бóльшим весом выпадает чаще", () => {
    const pool = [{ id: "hot" }, { id: "fresh", exposureWeight: 4 }];
    const rnd = seeded(11);
    let fresh = 0;
    for (let i = 0; i < 4000; i += 1) {
      if (weightedPick(pool, 1, weightsFromBake(pool), rnd)[0].id === "fresh") fresh += 1;
    }
    expect(fresh).toBeGreaterThan(2400);
    expect(fresh).toBeLessThan(3600);
  });

  it("пакет без поля веса играется равномерно", () => {
    const pool = [{ id: "a" }, { id: "b" }];
    const rnd = seeded(3);
    let a = 0;
    for (let i = 0; i < 4000; i += 1) {
      if (weightedPick(pool, 1, weightsFromBake(pool), rnd)[0].id === "a") a += 1;
    }
    expect(a).toBeGreaterThan(1700);
    expect(a).toBeLessThan(2300);
  });

  it("generateVariant строит карту весов из запечённого поля", () => {
    // Проверка того, что правило действительно живёт в рантайме, а не только в этом тесте:
    // подмена `drawSection` на взвешенный отбор должна читать `q.exposureWeight`.
    expect(src).toContain("q.exposureWeight === undefined ? 1 : q.exposureWeight");
  });

  it("адаптивный уровень отбирает взвешенно, а не тасует", () => {
    // Уровень собирается СВОИМ кодом (`app/adaptive/adaptive.js`), мимо `generateVariant`, и
    // поправка туда сначала не доехала: банк уровня узок — полоса трудности отсекает большую
    // часть темы, — поэтому выработка головы там заметнее, чем в обычной выдаче.
    const adaptiveSrc = readFileSync(
      resolve(process.cwd(), "server/scorm/template/app/adaptive/adaptive.js"),
      "utf8",
    );
    expect(adaptiveSrc).toContain("weightedPick(");
    expect(adaptiveSrc).toContain("exposureWeight");
    // Прежняя тасовка уровня снята: она не знала веса и давала неравномерную перестановку.
    expect(adaptiveSrc).not.toContain("shuffle(eligibleQuestions");
  });
});
