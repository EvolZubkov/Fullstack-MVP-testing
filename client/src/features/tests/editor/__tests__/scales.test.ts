/**
 * @module features/tests/editor/__tests__/scales
 * @description Unit tests for the PRD-5 scale editor logic: the load mapper
 * (apiToEditorModel — buildScalesFromApi, bands lifted from config_json), the
 * synchronous validation rules (validateScales), the diff-on-save orchestrator
 * (saveScales) and the calculation preview client (previewScales).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiToEditorModel, emptyEditorModel } from "../test-editor.mappers";
import { validateTestEditor } from "../test-editor.validation";
import { saveScales, saveMeasurements, loadContributionQuestions, previewScales } from "../scales-api";
import type {
  QuestionMeasurementModel,
  ResultVariableModel,
  ScaleBandModel,
  ScaleModel,
  TestEditorModel,
} from "../test-editor.types";

function band(overrides: Partial<ScaleBandModel> = {}): ScaleBandModel {
  return { min: "0", max: "10", label: "Низкий", level: "low", text: "", tone: "", ...overrides };
}

function scale(overrides: Partial<ScaleModel> = {}): ScaleModel {
  return {
    key: "ee",
    label: "Истощение",
    type: "number",
    aggregation: "sum",
    normalization: "none",
    direction: "positive",
    bands: [],
    domainMin: null,
    domainMax: null,
    valence: "none",
    learnerVisibility: "hidden",
    scormTarget: "none",
    sortOrder: 0,
    ...overrides,
  };
}

function modelWith(scales: ScaleModel[]): TestEditorModel {
  return { ...emptyEditorModel({ folderId: null }), scales };
}

const scaleErrors = (scales: ScaleModel[]) =>
  validateTestEditor(modelWith(scales)).errors.filter((e) => e.field.startsWith("scales"));

// ─── Mapper ───────────────────────────────────────────────────────────────────

describe("apiToEditorModel — scales", () => {
  it("maps the array, orders it by sortOrder and lifts bands from config_json", () => {
    const model = apiToEditorModel({
      id: "t1",
      title: "T",
      scales: [
        {
          id: "b",
          key: "d",
          label: "D",
          type: "number",
          aggregation: "avg",
          normalization: "percent",
          direction: "inverse",
          configJson: { bands: [{ min: 0, max: 27, level: "high", label: "Высокий" }] },
          scormTarget: "both",
          learnerVisibility: "level_and_value",
          sortOrder: 2,
        },
        { id: "a", key: "ee", label: "EE", type: "number", configJson: {}, sortOrder: 1 },
      ],
    });
    expect(model.scales.map((s) => s.key)).toEqual(["ee", "d"]);
    const d = model.scales[1];
    expect(d.aggregation).toBe("avg");
    expect(d.normalization).toBe("percent");
    expect(d.direction).toBe("inverse");
    expect(d.scormTarget).toBe("both");
    expect(d.learnerVisibility).toBe("level_and_value");
    expect(d.bands).toEqual([{ min: "0", max: "27", label: "Высокий", level: "high", text: "", tone: "" }]);
  });

  it("defaults unknown enum values and missing fields safely", () => {
    const model = apiToEditorModel({
      id: "t1",
      title: "T",
      scales: [{ id: "x", key: "x", label: "X", type: "weird", aggregation: "??", scormTarget: "??" }],
    });
    const s = model.scales[0];
    expect(s.type).toBe("number");
    expect(s.aggregation).toBe("sum");
    expect(s.normalization).toBe("none");
    expect(s.direction).toBe("positive");
    expect(s.scormTarget).toBe("none");
    expect(s.bands).toEqual([]);
  });

  it("yields an empty array when the response omits scales", () => {
    expect(apiToEditorModel({ id: "t1", title: "T" }).scales).toEqual([]);
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe("validateTestEditor — scales", () => {
  it("accepts a well-formed scale", () => {
    expect(scaleErrors([scale()])).toEqual([]);
  });

  it("requires a key but treats the label as optional", () => {
    const errors = scaleErrors([scale({ key: "", label: "  " })]);
    expect(errors.some((e) => e.field === "scales[0].key" && e.code === "required")).toBe(true);
    // Label is optional (per the approved wireframe) — empty must not be an error.
    expect(errors.some((e) => e.field === "scales[0].label")).toBe(false);
  });

  it("accepts a scale with a valid key and an empty label", () => {
    expect(scaleErrors([scale({ label: "" })])).toEqual([]);
  });

  it("flags an invalid key grammar", () => {
    expect(scaleErrors([scale({ key: "Bad Key" })]).some((e) => e.code === "format")).toBe(true);
  });

  it("flags a duplicate key", () => {
    const errors = scaleErrors([scale({ key: "dup" }), scale({ key: "dup", sortOrder: 1 })]);
    expect(errors.some((e) => e.code === "duplicate")).toBe(true);
  });

  it("accepts ascending non-overlapping numeric bands", () => {
    const bands = [band({ min: "0", max: "16" }), band({ min: "17", max: "30" })];
    expect(scaleErrors([scale({ bands })])).toEqual([]);
  });

  it("rejects a non-numeric band", () => {
    const errors = scaleErrors([scale({ bands: [band({ min: "", max: "x" })] })]);
    expect(errors.some((e) => e.code === "band_number")).toBe(true);
  });

  it("rejects min greater than max", () => {
    const errors = scaleErrors([scale({ bands: [band({ min: "30", max: "10" })] })]);
    expect(errors.some((e) => e.code === "band_order")).toBe(true);
  });

  it("rejects overlapping bands", () => {
    const bands = [band({ min: "0", max: "20" }), band({ min: "15", max: "30" })];
    expect(scaleErrors([scale({ bands })]).some((e) => e.code === "band_overlap")).toBe(true);
  });

  it("requires a level code, and says so per level", () => {
    // The code is the level's identity: `parseScaleInterpretation` DROPS a level
    // without one, so saving it would quietly delete the level on the next read.
    const bands = [band({ min: "0", max: "16" }), band({ min: "16", max: "30", level: "  " })];
    const errors = scaleErrors([scale({ bands })]);
    expect(errors.some((e) => e.field === "scales[0].bands[1]" && e.code === "band_code")).toBe(true);
    expect(errors.some((e) => e.field === "scales[0].bands[0]")).toBe(false);
  });

  it("keeps the level LABEL optional — only the code is required", () => {
    expect(scaleErrors([scale({ bands: [band({ label: "" })] })])).toEqual([]);
  });

  it("ignores a fully-empty trailing band row", () => {
    const bands = [band({ min: "0", max: "16" }), { min: "", max: "", label: "", level: "", text: "", tone: "" as const }];
    expect(scaleErrors([scale({ bands })])).toEqual([]);
  });

  // PRD-45 FR-11: the levels editor writes ONE threshold into both neighbours, so
  // touching boundaries are what every scale it creates looks like. A gate that
  // rejected `min === prevMax` would block saving every such scale, and the
  // non-adjacent pair above (16/17) would not notice the regression.
  it("accepts touching band boundaries (the levels editor's own output)", () => {
    const bands = [band({ min: "0", max: "15" }), band({ min: "15", max: "29" })];
    expect(scaleErrors([scale({ bands })])).toEqual([]);
  });

  // PRD-45: «Добавить уровень» seeds the new threshold as the midpoint of the last
  // level, formatted through `formatAuthorNumber` — a ru-decimal comma. Parsing it
  // with a bare `Number` yielded NaN, so «Сохранить» went dead with the card green
  // and no field highlighted.
  it("accepts a fractional threshold written with a ru-decimal comma", () => {
    const bands = [band({ min: "0", max: "73,5" }), band({ min: "73,5", max: "98" })];
    expect(scaleErrors([scale({ bands })])).toEqual([]);
  });
});

// ─── Validation — numeric indicator bands (PRD-45 FR-09/FR-14) ─────────────────

describe("validateTestEditor — bands of a numeric result variable", () => {
  const variable = (over: Partial<ResultVariableModel> = {}): ResultVariableModel => ({
    name: "idx",
    label: "Индекс",
    type: "number",
    formula: "1",
    learnerVisibility: "hidden",
    scormTarget: "none",
    controlsStatus: "none",
    bands: [],
    outcomes: [],
    domainMin: null,
    domainMax: null,
    valence: "none",
    sortOrder: 0,
    ...over,
  });
  const varErrors = (vars: ResultVariableModel[]) =>
    validateTestEditor({ ...emptyEditorModel({ folderId: null }), resultVariables: vars }).errors.filter((e) =>
      e.field.startsWith("resultVariables"),
    );

  it("blocks a descending pair — it would leave every score without a level", () => {
    const bands = [band({ min: "0", max: "42" }), band({ min: "42", max: "29" })];
    const errors = varErrors([variable({ bands })]);
    expect(errors.some((e) => e.field === "resultVariables[0].bands[1]" && e.code === "band_order")).toBe(true);
  });

  it("accepts a well-formed ascending pair", () => {
    const bands = [band({ min: "0", max: "42" }), band({ min: "42", max: "60" })];
    expect(varErrors([variable({ bands })])).toEqual([]);
  });

  it("leaves a non-numeric indicator's bands alone", () => {
    // A boolean indicator interprets through `outcomes`; stale numeric bands from
    // a type flip must not block saving.
    const bands = [band({ min: "0", max: "42" }), band({ min: "42", max: "29" })];
    expect(varErrors([variable({ type: "boolean", bands })])).toEqual([]);
  });
});

// ─── Save orchestrator ──────────────────────────────────────────────────────

describe("apiToEditorModel — домен и направление шкалы (PRD-29)", () => {
  const readScale = (configJson: unknown) =>
    apiToEditorModel({
      id: "t1",
      title: "T",
      scales: [{ id: "a", key: "ee", label: "EE", type: "number", configJson, sortOrder: 0 }],
    }).scales[0];

  it("читает заданные границы и направление", () => {
    const s = readScale({ bands: [], domainMin: 0, domainMax: 45, valence: "lower_is_better" });
    expect(s.domainMin).toBe(0);
    expect(s.domainMax).toBe(45);
    expect(s.valence).toBe("lower_is_better");
  });

  it("ноль читается как граница, а не как «не задано»", () => {
    expect(readScale({ domainMin: 0, domainMax: 0 })).toMatchObject({ domainMin: 0, domainMax: 0 });
  });

  it("границ нет → null, направления нет → «без оценки»", () => {
    // Охват интервалов НЕ подставляется: редактору нужно отличать заданный
    // домен от выводимого, иначе переключатель ручных границ соврёт.
    const s = readScale({ bands: [{ min: 0, max: 45, level: "low" }] });
    expect(s.domainMin).toBeNull();
    expect(s.domainMax).toBeNull();
    expect(s.valence).toBe("none");
  });

  it("половина пары границ = границы не заданы", () => {
    expect(readScale({ domainMin: 0 })).toMatchObject({ domainMin: null, domainMax: null });
  });

  it("неизвестное направление вырождается в «без оценки»", () => {
    expect(readScale({ valence: "sideways" }).valence).toBe("none");
  });
});

describe("saveScales — diff on save", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: "new" }) }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const base = "/api/tests/t1/scales";
  const calls = () => fetchMock.mock.calls.map((c) => [c[1]?.method ?? "GET", c[0]]);

  it("POSTs new scales (no id) with bands in config_json", async () => {
    await saveScales("t1", [scale({ key: "fresh", bands: [band()] })], []);
    expect(calls()).toEqual([["POST", base]]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.key).toBe("fresh");
    expect(body.configJson.bands).toEqual([{ min: 0, max: 10, level: "low", label: "Низкий" }]);
  });

  it("omits an empty band label so the runtime falls back to the level code", async () => {
    await saveScales("t1", [scale({ bands: [band({ label: "  " })] })], []);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.configJson.bands[0]).toEqual({ min: 0, max: 10, level: "low" });
  });

  it("кладёт границы и направление в config_json (PRD-29)", async () => {
    await saveScales(
      "t1",
      [scale({ key: "ee", domainMin: 0, domainMax: 45, valence: "lower_is_better" })],
      [],
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.configJson).toMatchObject({ domainMin: 0, domainMax: 45, valence: "lower_is_better" });
  });

  it("не задан домен → в config_json его нет, но направление пишется всегда", async () => {
    await saveScales("t1", [scale({ key: "ee" })], []);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.configJson).not.toHaveProperty("domainMin");
    expect(body.configJson.valence).toBe("none");
  });

  it("PUTs when only the domain changed", async () => {
    const snap = [scale({ id: "a", key: "a" })];
    const draft = [scale({ id: "a", key: "a", domainMin: 0, domainMax: 45 })];
    await saveScales("t1", draft, snap);
    expect(calls()).toEqual([["PUT", `${base}/a`]]);
  });

  it("PUTs when only the valence changed", async () => {
    const snap = [scale({ id: "a", key: "a" })];
    const draft = [scale({ id: "a", key: "a", valence: "higher_is_better" })];
    await saveScales("t1", draft, snap);
    expect(calls()).toEqual([["PUT", `${base}/a`]]);
  });

  it("DELETEs scales dropped from the draft", async () => {
    await saveScales("t1", [], [scale({ id: "a", key: "a" })]);
    expect(calls()).toEqual([["DELETE", `${base}/a`]]);
  });

  it("PUTs scales whose fields changed", async () => {
    const snap = [scale({ id: "a", key: "a", label: "Old" })];
    const draft = [scale({ id: "a", key: "a", label: "New" })];
    await saveScales("t1", draft, snap);
    expect(calls()).toEqual([["PUT", `${base}/a`]]);
  });

  it("PUTs when only the bands changed", async () => {
    const snap = [scale({ id: "a", key: "a", bands: [band({ max: "10" })] })];
    const draft = [scale({ id: "a", key: "a", bands: [band({ max: "12" })] })];
    await saveScales("t1", draft, snap);
    expect(calls()).toEqual([["PUT", `${base}/a`]]);
  });

  it("skips unchanged scales", async () => {
    const row = scale({ id: "a", key: "a", bands: [band()] });
    await saveScales("t1", [{ ...row }], [{ ...row }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs deletes before creates/updates", async () => {
    const snap = [scale({ id: "a", key: "a" }), scale({ id: "b", key: "b", sortOrder: 1 })];
    const draft = [scale({ id: "b", key: "b", sortOrder: 1, label: "B2" }), scale({ key: "c", sortOrder: 1 })];
    await saveScales("t1", draft, snap);
    const methods = calls().map((c) => c[0]);
    expect(methods[0]).toBe("DELETE");
    expect(methods).toContain("PUT");
    expect(methods).toContain("POST");
  });

  it("throws with the server error message when a mutation fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: "key conflict" }),
    });
    await expect(saveScales("t1", [scale({ key: "x" })], [])).rejects.toThrow(/key conflict/);
  });
});

// ─── Preview client ────────────────────────────────────────────────────────────

describe("previewScales", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs the demo answers and returns the computed result", async () => {
    const result = { values: { ee: { raw: 7, normalized: 0, percent: 0, level: "", label: "", hasValue: true } }, errors: [] };
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => result }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await previewScales("t1", { q1: 0 });
    expect(out).toEqual(result);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tests/t1/scales/preview");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ answers: { q1: 0 } });
  });
});

// ─── Measurements mapper (buildMeasurementsFromApi via apiToEditorModel) ──────────

describe("apiToEditorModel — measurements", () => {
  const apiBase = {
    id: "t1",
    title: "T",
    scales: [{ id: "sc-uuid", key: "ee", label: "EE", type: "number" }],
  };

  it("maps measurements, resolving scaleId to the stable key", () => {
    const model = apiToEditorModel({
      ...apiBase,
      measurements: [
        { id: "m1", questionId: "q1", scaleId: "sc-uuid", sourceType: "option", sourceKey: "2", valueJson: 3, weight: 1 },
      ],
    });
    expect(model.measurements).toEqual([
      { questionId: "q1", scaleKey: "ee", sourceType: "option", sourceKey: "2", value: 3, weight: 1 },
    ]);
  });

  it("drops measurements whose scaleId resolves to no scale", () => {
    const model = apiToEditorModel({
      ...apiBase,
      measurements: [{ id: "m1", questionId: "q1", scaleId: "missing", sourceType: "question", sourceKey: null, valueJson: 1 }],
    });
    expect(model.measurements).toEqual([]);
  });

  it("yields an empty array when the response omits measurements", () => {
    expect(apiToEditorModel(apiBase).measurements).toEqual([]);
  });
});

// ─── saveMeasurements — per-question diff ─────────────────────────────────────────

describe("saveMeasurements — per-question diff", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const keyToId = new Map([["ee", "sc-uuid"]]);

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const meas = (over: Partial<QuestionMeasurementModel> = {}): QuestionMeasurementModel => ({
    questionId: "q1",
    scaleKey: "ee",
    sourceType: "option",
    sourceKey: "0",
    value: 2,
    weight: 1,
    ...over,
  });
  const calls = () => fetchMock.mock.calls.map((c) => [c[1]?.method ?? "GET", c[0]]);

  it("PUTs only the questions whose row set changed, resolving scaleKey to id", async () => {
    await saveMeasurements("t1", [meas()], [], keyToId);
    expect(calls()).toEqual([["PUT", "/api/tests/t1/measurements/q1"]]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual([
      { scaleId: "sc-uuid", sourceType: "option", sourceKey: "0", valueJson: 2, weight: 1 },
    ]);
  });

  it("clears a question (PUT []) when its rows were all removed", async () => {
    await saveMeasurements("t1", [], [meas()], keyToId);
    expect(calls()).toEqual([["PUT", "/api/tests/t1/measurements/q1"]]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual([]);
  });

  it("skips a question whose rows are unchanged", async () => {
    await saveMeasurements("t1", [meas()], [meas()], keyToId);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips rows whose scaleKey has no persisted id", async () => {
    await saveMeasurements("t1", [meas({ scaleKey: "unknown" })], [], new Map());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual([]);
  });
});

// ─── loadContributionQuestions — unit enumeration + correctness ───────────────────

describe("loadContributionQuestions", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(questions: unknown[]) {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => questions })));
  }

  it("enumerates single-choice options and marks the correct one", async () => {
    stub([
      { id: "q1", topicId: "t", type: "single", prompt: "Q", dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 1 } },
      { id: "qx", topicId: "other", type: "single", dataJson: { options: ["x"] }, correctJson: {} },
    ]);
    const out = await loadContributionQuestions(["t"]);
    expect(out).toHaveLength(1);
    expect(out[0].units.map((u) => [u.sourceKey, u.correct])).toEqual([
      ["0", false],
      ["1", true],
    ]);
    expect(out[0].units[0].sourceType).toBe("option");
  });

  it("marks multiple-choice correct indices", async () => {
    stub([{ id: "q", topicId: "t", type: "multiple", dataJson: { options: ["A", "B", "C"] }, correctJson: { correctIndices: [0, 2] } }]);
    const out = await loadContributionQuestions(["t"]);
    expect(out[0].units.map((u) => u.correct)).toEqual([true, false, true]);
  });

  it("enumerates matching as directed pairs and marks the correct pair", async () => {
    stub([
      {
        id: "q",
        topicId: "t",
        type: "matching",
        dataJson: { left: ["L0", "L1"], right: ["R0", "R1"] },
        correctJson: { pairs: [{ left: 0, right: 1 }] },
      },
    ]);
    const out = await loadContributionQuestions(["t"]);
    expect(out[0].units.map((u) => u.sourceKey)).toEqual(["0:0", "0:1", "1:0", "1:1"]);
    expect(out[0].units.find((u) => u.sourceKey === "0:1")?.correct).toBe(true);
    expect(out[0].units.find((u) => u.sourceKey === "0:0")?.correct).toBe(false);
  });

  it("enumerates ranking as item@position placements and marks the correct placement", async () => {
    stub([{ id: "q", topicId: "t", type: "ranking", dataJson: { items: ["I0", "I1"] }, correctJson: { correctOrder: [1, 0] } }]);
    const out = await loadContributionQuestions(["t"]);
    // sourceKey = item:pos; correctOrder[pos] === item
    expect(out[0].units.find((u) => u.sourceKey === "1:0")?.correct).toBe(true);
    expect(out[0].units.find((u) => u.sourceKey === "0:1")?.correct).toBe(true);
    expect(out[0].units.find((u) => u.sourceKey === "0:0")?.correct).toBe(false);
  });
});
