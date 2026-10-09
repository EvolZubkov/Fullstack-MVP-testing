/**
 * @module tests/breakdown-formula-context
 * @description PRD-50 FR-35/FR-36: `tag()` and `sectionById()` stop being dead accessors.
 * Both maps used to be handed to the evaluator empty, so a formula reading them returned
 * zeros while passing validation.
 *
 * The last block is the two-HOST parity pin. The maps are built twice — by the web host
 * (`buildEvalBase`) and by the SCORM package's plain-JS `buildResultVarContext`, lifted
 * out of the runtime source and bound to an injected `TEST_DATA`. Nothing but a test can
 * catch them drifting: a divergence would surface as a formula that means one thing on
 * the results screen and another inside the package, on a live LMS.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildEvalBase, computeAttemptResult } from "../server/services/result-compute";
import { validate } from "../shared/formula/validate";

const base = {
  percent: 50,
  topicResults: [
    { topicId: "law-id", code: "law", topicName: "Право", percent: 50, passed: false, earnedPoints: 1 },
  ],
  breakdowns: [
    { scope: "test", axis: "tag", key: "ПДн", items: 2, answered: 2, earned: 1, possible: 2,
      unitEarned: 1, unitPossible: 2, percentPoints: 50, percentUnits: 50 },
    { scope: "section:law-id", axis: "tag", key: "ПДн", items: 2, answered: 2, earned: 2, possible: 2,
      unitEarned: 2, unitPossible: 2, percentPoints: 100, percentUnits: 100 },
  ],
};

const config = (formula: string) => ({
  scales: [],
  measurements: [],
  budgets: {},
  resultVariables: [{ name: "v", type: "number" as const, formula, sortOrder: 0 }],
});

describe("контекст формул", () => {
  it("tag() читает область теста", () => {
    const out = computeAttemptResult(config('tag("ПДн").percent'), {}, {}, base as never);
    expect(out.resultVariables.v).toBe(50);
  });

  it("tag() с составным ключом читает область раздела (FR-36)", () => {
    const out = computeAttemptResult(config('tag("law::ПДн").percent'), {}, {}, base as never);
    expect(out.resultVariables.v).toBe(100);
  });

  it("tag() с составным ключом принимает и id раздела", () => {
    const out = computeAttemptResult(config('tag("law-id::ПДн").percent'), {}, {}, base as never);
    expect(out.resultVariables.v).toBe(100);
  });

  it("sectionById() возвращает результат темы, а не нули", () => {
    const out = computeAttemptResult(config('sectionById("law").percent'), {}, {}, base as never);
    expect(out.resultVariables.v).toBe(50);
  });

  it("sectionById() принимает и id раздела", () => {
    const out = computeAttemptResult(config('sectionById("law-id").percent'), {}, {}, base as never);
    expect(out.resultVariables.v).toBe(50);
  });

  it("тег без разрезов остаётся нулём, а не падает", () => {
    const out = computeAttemptResult(config('tag("нет такого").percent'), {}, {}, {
      percent: 50,
      topicResults: [],
    } as never);
    expect(out.resultVariables.v).toBe(0);
  });
});

// `scopeKeys` (not `sectionKeys`): the composite `tag("<scope>::<key>")` scope check runs
// off its OWN reference set, independent of the plain `sectionById(...)` gate — see the
// `ValidationRefs.scopeKeys` JSDoc for why the two must not share one set.
const refs = { scopeKeys: new Set(["law", "law-id"]), tagKeys: new Set(["ПДн"]) };

describe("валидатор составного ключа", () => {
  it("опечатка в разделе — ошибка", () => {
    const out = validate('tag("нет::ПДн").percent', "number", refs);
    expect(out.valid).toBe(false);
    expect(out.errors.map((e) => e.code)).toContain("unknown-section");
  });

  it("незнакомый ключ при верном разделе — только предупреждение", () => {
    const out = validate('tag("law::нет").percent', "number", refs);
    expect(out.valid).toBe(true);
    expect(out.warnings.map((w) => w.code)).toContain("tag-unresolved");
  });

  it("составной ключ целиком известен — ни ошибок, ни предупреждений", () => {
    const out = validate('tag("law::ПДн").percent', "number", refs);
    expect(out.errors).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  it("одиночное двоеточие составным ключом не считается", () => {
    const out = validate('tag("scale:EE").count', "number", refs);
    expect(out.errors).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  it("ключ с двумя разделителями режется по первому", () => {
    // «law::a::b» = раздел law, ключ «a::b» — не «a».
    const out = validate('tag("law::a::b").percent', "number", {
      scopeKeys: new Set(["law"]),
      tagKeys: new Set(["a::b"]),
    });
    expect(out.errors).toEqual([]);
    expect(out.warnings).toEqual([]);
  });
});

// ─── Паритет двух хостов ─────────────────────────────────────────────────────

const runtimeSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/render/resultsPage.js"),
  "utf8",
);

/** Lift the package's plain-JS `buildResultVarContext` out and bind it to a `TEST_DATA`. */
function makeBuildResultVarContext(testData: unknown): (results: unknown, scales: unknown) => any {
  const match = runtimeSrc.match(/function buildResultVarContext\([\s\S]*?\n\}/);
  if (!match) throw new Error("buildResultVarContext not found in resultsPage.js");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function("TEST_DATA", `${match[0]}\n;return buildResultVarContext;`)(testData);
}

// Один и тот же набор данных, поданный обоим хостам в их собственной форме: раздел
// с кодом, раздел без кода, обе области разреза и запись раздела, которого в итогах
// нет (проверяет одинаковый запасной ключ).
const parityTopics = [
  { topicId: "law-id", topicName: "Право", percent: 50, passed: false, earnedPoints: 1 },
  { topicId: "sec-id", topicName: "Безопасность", percent: 100, passed: true, earnedPoints: 3 },
];

const entry = (scope: string, key: string, earned: number) => ({
  scope, axis: "tag", key, items: 2, answered: 2, earned, possible: 2,
  unitEarned: earned, unitPossible: 2, percentPoints: (earned / 2) * 100, percentUnits: (earned / 2) * 100,
});

const parityBreakdowns = [
  entry("test", "ПДн", 1),
  entry("test", "ИБ", 2),
  entry("section:law-id", "ПДн", 2),
  entry("section:sec-id", "ИБ", 2),
  entry("section:ghost-id", "Сирота", 0),
];

const webBase = {
  percent: 62.5,
  topicResults: [
    { ...parityTopics[0], code: "law" },
    { ...parityTopics[1], code: null },
  ],
  breakdowns: parityBreakdowns,
};

const packageResults = { percent: 62.5, topicResults: parityTopics, breakdowns: parityBreakdowns };

const packageTestData = {
  sections: [
    { topicId: "law-id", topicCode: "law", topicName: "Право" },
    { topicId: "sec-id", topicCode: null, topicName: "Безопасность" },
  ],
};

describe("паритет контекста формул: веб-хост и рантайм пакета", () => {
  const web = buildEvalBase(webBase as never, {});
  const pkg = makeBuildResultVarContext(packageTestData)(packageResults, null);

  it("карты тегов совпадают целиком, вместе с набором ключей", () => {
    expect(Object.keys(pkg.tags).sort()).toEqual(Object.keys(web.tags).sort());
    expect(pkg.tags).toEqual(web.tags);
  });

  it("карты разделов совпадают целиком, вместе с набором ключей", () => {
    expect(Object.keys(pkg.sections).sort()).toEqual(Object.keys(web.sections).sort());
    expect(pkg.sections).toEqual(web.sections);
  });

  it("остальной контекст тоже совпадает", () => {
    expect(pkg).toEqual(web);
  });

  it("набор ключей — тот, ради которого всё делалось", () => {
    // Страж самого теста: если обе карты выродятся в пустые, сравнение выше пройдёт.
    expect(Object.keys(web.tags).sort()).toEqual(
      ["ghost-id::Сирота", "law-id::ПДн", "law::ПДн", "sec-id::ИБ", "ИБ", "ПДн"].sort(),
    );
    expect(Object.keys(web.sections).sort()).toEqual(["law", "law-id", "sec-id"].sort());
  });
});
