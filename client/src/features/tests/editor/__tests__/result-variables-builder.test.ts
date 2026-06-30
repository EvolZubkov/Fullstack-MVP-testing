/**
 * @module features/tests/editor/__tests__/result-variables-builder.test
 * @description Unit tests for the «Показатели» visual-builder DSL generation
 * (PRD-2 §4.1). Every generated formula is also fed through the shared DSL
 * validator to prove the builder only emits syntactically valid, correctly-typed
 * DSL (the same engine the runtime uses).
 */
import { describe, it, expect } from "vitest";
import { validate } from "@shared/formula/validate";
import {
  conditionToDsl,
  thresholdDsl,
  verdictDsl,
  categoryDsl,
  weightedDsl,
  elementOptions,
  propertyOptions,
  levelOptions,
  unitOf,
  firstProperty,
  defaultCondition,
  type Condition,
  type ScaleRef,
  type TopicRef,
} from "../result-variables-builder";

const TOPICS: TopicRef[] = [
  { id: "t-ethics", name: "Этика", code: null },
  { id: "t-law", name: "Право", code: "law_code" },
];
const SCALES: ScaleRef[] = [
  { key: "fin", label: "Финансы", levels: ["high", "mid", "low"] },
  { key: "law", label: "Право", levels: ["high", "low"] },
];

const refs = {
  // topicById accepts UUIDs and custom codes; topicByName accepts names.
  topicIds: new Set([...TOPICS.map((t) => t.id), "law_code"]),
  topicNames: new Set(TOPICS.map((t) => t.name)),
  scaleKeys: new Set(SCALES.map((s) => s.key)),
};

describe("result-variables-builder · condition DSL", () => {
  it("numeric scale property → `scaleById(key).prop op value`", () => {
    const c: Condition = { element: "scale:fin", property: "raw", op: ">=", value: "7" };
    expect(conditionToDsl(c)).toBe('scaleById("fin").raw >= 7');
  });

  it("overall percent/score map to the bare keywords", () => {
    expect(conditionToDsl({ element: "overall", property: "percent", op: ">=", value: "75" })).toBe(
      "percent >= 75",
    );
    expect(conditionToDsl({ element: "overall", property: "score", op: ">=", value: "10" })).toBe(
      "score >= 10",
    );
  });

  it("topic boolean property → bare accessor (no operator/value)", () => {
    expect(conditionToDsl({ element: "topic:t-ethics", property: "passed", op: ">=", value: "" })).toBe(
      'topicById("t-ethics").passed',
    );
  });

  it("scale level → equality against a quoted level", () => {
    expect(conditionToDsl({ element: "scale:fin", property: "level", op: "=", value: "high" })).toBe(
      'scaleById("fin").level = "high"',
    );
    expect(conditionToDsl({ element: "scale:fin", property: "level", op: "!=", value: "low" })).toBe(
      'scaleById("fin").level != "low"',
    );
  });

  it("empty numeric value falls back to 0", () => {
    expect(conditionToDsl({ element: "scale:fin", property: "percent", op: ">", value: "" })).toBe(
      'scaleById("fin").percent > 0',
    );
  });
});

describe("result-variables-builder · template DSL is valid", () => {
  function assertValid(formula: string, expectedType: "number" | "string" | "boolean") {
    const res = validate(formula, expectedType, refs);
    expect(res.errors, formula).toEqual([]);
    expect(res.valid, formula).toBe(true);
    expect(res.returnType, formula).toBe(expectedType);
  }

  it("threshold → boolean", () => {
    const f = thresholdDsl({ element: "scale:fin", property: "percent", op: ">=", value: "70" });
    expect(f).toBe('scaleById("fin").percent >= 70');
    assertValid(f, "boolean");
  });

  it("verdict → conjunction of conditions, boolean", () => {
    const f = verdictDsl(
      [
        { element: "scale:fin", property: "percent", op: ">=", value: "70" },
        { element: "scale:law", property: "percent", op: ">=", value: "70" },
        { element: "topic:t-ethics", property: "percent", op: ">=", value: "60" },
      ],
      TOPICS,
    );
    expect(f).toBe(
      'scaleById("fin").percent >= 70 AND scaleById("law").percent >= 70 AND topicByName("Этика").percent >= 60',
    );
    assertValid(f, "boolean");
  });

  it("category → nested IF over scale level, string", () => {
    const f = categoryDsl(
      "fin",
      [
        { level: "high", label: "Эксперт" },
        { level: "mid", label: "Базовый" },
      ],
      "Недостаточно",
    );
    expect(f).toBe(
      'IF(scaleById("fin").level = "high", "Эксперт", IF(scaleById("fin").level = "mid", "Базовый", "Недостаточно"))',
    );
    assertValid(f, "string");
  });

  it("category skips rows with an empty level", () => {
    const f = categoryDsl("fin", [{ level: "", label: "x" }, { level: "high", label: "Эксперт" }], "Иначе");
    expect(f).toBe('IF(scaleById("fin").level = "high", "Эксперт", "Иначе")');
    assertValid(f, "string");
  });

  it("weighted → Σ scaleById(k).raw * weight, number", () => {
    const f = weightedDsl([
      { scaleKey: "fin", weight: "0.5" },
      { scaleKey: "law", weight: "0.5" },
    ]);
    expect(f).toBe('scaleById("fin").raw * 0.5 + scaleById("law").raw * 0.5');
    assertValid(f, "number");
  });
});

describe("result-variables-builder · topic addressing (PRD-2 §4.2)", () => {
  it("topic with a custom code → topicById(code), readable", () => {
    const f = conditionToDsl({ element: "topic:t-law", property: "percent", op: ">=", value: "70" }, TOPICS);
    expect(f).toBe('topicById("law_code").percent >= 70');
    expect(validate(f, "boolean", refs).errors).toEqual([]);
  });

  it("topic without a code → topicByName(name), never the raw UUID", () => {
    const f = conditionToDsl({ element: "topic:t-ethics", property: "percent", op: ">=", value: "60" }, TOPICS);
    expect(f).toBe('topicByName("Этика").percent >= 60');
    expect(f).not.toMatch(/topicById\("t-ethics"\)/);
    expect(validate(f, "boolean", refs).errors).toEqual([]);
  });

  it("unknown topic falls back to topicById(uuid)", () => {
    const f = conditionToDsl({ element: "topic:t-missing", property: "passed", op: "=", value: "" }, TOPICS);
    expect(f).toBe('topicById("t-missing").passed');
  });
});

describe("result-variables-builder · pickers", () => {
  it("element options are grouped: overall, then Темы, then Шкалы", () => {
    const opts = elementOptions(TOPICS, SCALES);
    expect(opts[0]).toEqual({ value: "overall", label: "Общий результат" });
    expect(opts.find((o) => o.value === "topic:t-ethics")).toMatchObject({ label: "Этика", group: "Темы" });
    expect(opts.find((o) => o.value === "scale:fin")).toMatchObject({ label: "Финансы", group: "Шкалы" });
  });

  it("property options and units are contextual to the element kind", () => {
    expect(propertyOptions("scale:fin").map((o) => o.value)).toEqual(["raw", "percent", "level"]);
    expect(propertyOptions("topic:t-ethics").map((o) => o.value)).toEqual(["percent", "score", "passed"]);
    expect(propertyOptions("overall").map((o) => o.value)).toEqual(["percent", "score"]);
    expect(unitOf("scale:fin", "level")).toBe("level");
    expect(unitOf("topic:t-ethics", "passed")).toBe("bool");
    expect(unitOf("overall", "score")).toBe("num");
  });

  it("level options come from the chosen scale's bands", () => {
    expect(levelOptions("scale:fin", SCALES).map((o) => o.value)).toEqual(["high", "mid", "low"]);
    expect(levelOptions("overall", SCALES)).toEqual([]);
  });

  it("firstProperty / defaultCondition pick sane defaults", () => {
    expect(firstProperty("scale:fin")).toBe("raw");
    expect(firstProperty("topic:t-ethics")).toBe("percent");
    expect(defaultCondition(SCALES)).toEqual({ element: "scale:fin", property: "percent", op: ">=", value: "70" });
    expect(defaultCondition([])).toEqual({ element: "overall", property: "percent", op: ">=", value: "70" });
  });
});
