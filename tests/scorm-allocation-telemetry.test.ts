/**
 * @module tests/scorm-allocation-telemetry
 *
 * PRD-44 FR-54: как распределение попадает во взаимодействие SCORM.
 *
 * Ответ у типа ВЕКТОРНЫЙ — несколько «индекс: балл» на один вопрос, — и это исключает
 * оба напрашивающихся типа взаимодействия. `numeric` описывает ОДНО число, а `matching`
 * семантически ложен: пар в ответе нет, есть распределение. Остаётся `other` со строкой,
 * которую отчёт LMS может разобрать.
 *
 * Функции извлекаются из рантайма пакета тем же приёмом, что в scoring-pass-rule.test.ts:
 * это ровно тот код, который уезжает в пакет, а не его пересказ.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/render/resultsPage.js"),
  "utf8",
);
const qtypeSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/qtype.js"),
  "utf8",
);

function extract(name: string): string {
  const m = src.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\}`));
  if (!m) throw new Error(`${name} не найдена в resultsPage.js`);
  return m[0];
}

const runtime = new Function(
  `${qtypeSrc}
  ${extract("to1")}
  ${extract("mapScormType")}
  ${extract("formatResponse")}
  return { mapScormType: mapScormType, formatResponse: formatResponse };`,
)() as {
  mapScormType: (q: { type: string }) => string;
  formatResponse: (q: { type: string }, ans: unknown) => string;
};

const ALLOC = { type: "allocation" };

describe("тип взаимодействия (FR-54)", () => {
  it("распределение пишется как other", () => {
    expect(runtime.mapScormType(ALLOC)).toBe("other");
  });

  it("остальные типы не затронуты", () => {
    expect(runtime.mapScormType({ type: "single" })).toBe("choice");
    expect(runtime.mapScormType({ type: "scale" })).toBe("choice");
    expect(runtime.mapScormType({ type: "multiple" })).toBe("choice");
    expect(runtime.mapScormType({ type: "matching" })).toBe("matching");
    expect(runtime.mapScormType({ type: "ranking" })).toBe("sequencing");
  });
});

describe("исход взаимодействия", () => {
  // Извлекается вместе с окружением: строка исхода собирается в теле цикла, поэтому
  // проверяется правило, а не переписанная копия.
  const src2 = readFileSync(
    resolve(process.cwd(), "server/scorm/template/app/render/resultsPage.js"),
    "utf8",
  );

  it("измерительный вопрос помечается neutral, а не incorrect", () => {
    // `incorrect` показал бы в отчёте LMS ошибку ученика там, где эталона нет вовсе.
    expect(src2).toContain("measurementOnly ? 'neutral'");
  });

  it("правило опирается на признак типа, а не на сравнение с литералом", () => {
    expect(src2).toContain("TBQType.isMeasurementOnly(q)");
  });
});

describe("строка ответа (FR-54)", () => {
  it("вектор «индекс[.]балл» через запятую", () => {
    expect(runtime.formatResponse(ALLOC, { 0: 3, 1: 1, 2: 1, 3: 2 })).toBe("0[.]3,1[.]1,2[.]1,3[.]2");
  });

  it("нули не выбрасываются: аналитике важно «поставил ноль», а не «не дошёл»", () => {
    expect(runtime.formatResponse(ALLOC, { 0: 7, 1: 0, 2: 0, 3: 0 })).toBe("0[.]7,1[.]0,2[.]0,3[.]0");
  });

  it("порядок числовой, а не лексикографический", () => {
    const out = runtime.formatResponse(ALLOC, { 10: 1, 2: 3, 1: 2 });
    expect(out).toBe("1[.]2,2[.]3,10[.]1");
  });

  it("нетронутый вопрос даёт пустую строку", () => {
    expect(runtime.formatResponse(ALLOC, null)).toBe("");
    expect(runtime.formatResponse(ALLOC, undefined)).toBe("");
  });

  it("строки остальных типов не изменились", () => {
    expect(runtime.formatResponse({ type: "single" }, 2)).toBe("3");
    expect(runtime.formatResponse({ type: "multiple" }, [0, 2])).toBe("1,3");
    expect(runtime.formatResponse({ type: "ranking" }, [2, 0, 1])).toBe("3,1,2");
    expect(runtime.formatResponse({ type: "matching" }, { 0: 1, 1: 0 })).toBe("1-2,2-1");
  });
});
