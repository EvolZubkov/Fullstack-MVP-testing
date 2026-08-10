/**
 * @module features/tests/editor/__tests__/result-variables
 * @description Unit tests for the PRD-2 result-variable editor logic: the
 * load mapper (apiToEditorModel), the synchronous validation rules
 * (validateTestEditor) and the diff-on-save orchestrator (saveResultVariables).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiToEditorModel, emptyEditorModel } from "../test-editor.mappers";
import { validateTestEditor } from "../test-editor.validation";
import { saveResultVariables, validateResultVariableFormula } from "../result-variables-api";
import type { ResultVariableModel, TestEditorModel } from "../test-editor.types";

function rv(overrides: Partial<ResultVariableModel> = {}): ResultVariableModel {
  return {
    name: "score",
    label: "Балл",
    type: "number",
    formula: "percent",
    learnerVisibility: "hidden",
    scormTarget: "both",
    controlsStatus: "none",
    bands: [],
    outcomes: [],
    domainMin: null,
    domainMax: null,
    valence: "none",
    sortOrder: 0,
    ...overrides,
  };
}

function modelWith(vars: ResultVariableModel[]): TestEditorModel {
  return { ...emptyEditorModel({ folderId: null }), resultVariables: vars };
}

const rvErrors = (vars: ResultVariableModel[]) =>
  validateTestEditor(modelWith(vars)).errors.filter((e) => e.field.startsWith("resultVariables"));

// ─── Mapper ───────────────────────────────────────────────────────────────────

describe("apiToEditorModel — result variables", () => {
  it("maps the array and orders it by sortOrder", () => {
    const model = apiToEditorModel({
      id: "t1",
      title: "T",
      resultVariables: [
        { id: "b", name: "b", label: "B", type: "string", formula: "1", sortOrder: 2 },
        { id: "a", name: "a", label: "A", type: "number", formula: "percent", sortOrder: 1 },
      ],
    });
    expect(model.resultVariables.map((v) => v.name)).toEqual(["a", "b"]);
    expect(model.resultVariables[0].id).toBe("a");
  });

  it("defaults unknown enum values and missing fields safely", () => {
    const model = apiToEditorModel({
      id: "t1",
      title: "T",
      resultVariables: [{ id: "x", name: "x", label: "X", type: "weird", scormTarget: "??" }],
    });
    const v = model.resultVariables[0];
    expect(v.type).toBe("number");
    expect(v.scormTarget).toBe("both");
    expect(v.controlsStatus).toBe("none");
    expect(v.formula).toBe("");
  });

  it("yields an empty array when the response omits result variables", () => {
    const model = apiToEditorModel({ id: "t1", title: "T" });
    expect(model.resultVariables).toEqual([]);
  });
});

describe("apiToEditorModel — домен и направление числового показателя (PRD-29+)", () => {
  const readVar = (configJson: unknown) =>
    apiToEditorModel({
      id: "t1",
      title: "T",
      resultVariables: [
        { id: "a", name: "score", label: "Балл", type: "number", formula: "percent", configJson, sortOrder: 0 },
      ],
    }).resultVariables[0];

  it("читает заданные границы и направление", () => {
    const v = readVar({ bands: [], domainMin: 0, domainMax: 45, valence: "lower_is_better" });
    expect(v.domainMin).toBe(0);
    expect(v.domainMax).toBe(45);
    expect(v.valence).toBe("lower_is_better");
  });

  it("границ нет → null, направления нет → «без оценки»", () => {
    const v = readVar({ bands: [{ min: 0, max: 45, level: "low" }] });
    expect(v.domainMin).toBeNull();
    expect(v.domainMax).toBeNull();
    expect(v.valence).toBe("none");
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe("validateTestEditor — result variables", () => {
  it("accepts a well-formed variable", () => {
    expect(rvErrors([rv()])).toEqual([]);
  });

  it("flags an invalid name", () => {
    const errors = rvErrors([rv({ name: "Bad Name" })]);
    expect(errors.some((e) => e.field === "resultVariables[0].name" && e.code === "format")).toBe(true);
  });

  it("flags a duplicate name", () => {
    const errors = rvErrors([rv({ name: "dup" }), rv({ name: "dup", sortOrder: 1 })]);
    expect(errors.some((e) => e.code === "duplicate")).toBe(true);
  });

  it("requires a formula but treats the label as optional (parity with scales)", () => {
    const errors = rvErrors([rv({ label: "", formula: "  " })]);
    // Label is OPTIONAL — an empty label is not an error (consumers fall back to name).
    expect(errors.some((e) => e.field === "resultVariables[0].label")).toBe(false);
    expect(errors.some((e) => e.field === "resultVariables[0].formula")).toBe(true);
  });

  it("rejects controls_status on a non-boolean variable", () => {
    const errors = rvErrors([rv({ type: "number", controlsStatus: "success" })]);
    expect(errors.some((e) => e.code === "type_mismatch")).toBe(true);
  });

  it("allows controls_status on a boolean variable", () => {
    const errors = rvErrors([rv({ type: "boolean", formula: "percent >= 50", controlsStatus: "success" })]);
    expect(errors).toEqual([]);
  });

  it("rejects two variables controlling the same status", () => {
    const errors = rvErrors([
      rv({ name: "a", type: "boolean", formula: "percent >= 50", controlsStatus: "success" }),
      rv({ name: "b", type: "boolean", formula: "percent >= 90", controlsStatus: "success", sortOrder: 1 }),
    ]);
    expect(errors.filter((e) => e.code === "duplicate_controller")).toHaveLength(2);
  });
});

// ─── Save orchestrator ──────────────────────────────────────────────────────

describe("saveResultVariables — diff on save", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: "new" }) }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const base = "/api/tests/t1/result-variables";
  const calls = () => fetchMock.mock.calls.map((c) => [c[1]?.method ?? "GET", c[0]]);

  it("POSTs new rows (no id)", async () => {
    await saveResultVariables("t1", [rv({ name: "fresh" })], []);
    expect(calls()).toEqual([["POST", base]]);
  });

  it("DELETEs rows dropped from the draft", async () => {
    await saveResultVariables("t1", [], [rv({ id: "a", name: "a" })]);
    expect(calls()).toEqual([["DELETE", `${base}/a`]]);
  });

  it("PUTs rows whose fields changed", async () => {
    const snap = [rv({ id: "a", name: "a", label: "Old" })];
    const draft = [rv({ id: "a", name: "a", label: "New" })];
    await saveResultVariables("t1", draft, snap);
    expect(calls()).toEqual([["PUT", `${base}/a`]]);
  });

  it("skips unchanged rows", async () => {
    const row = rv({ id: "a", name: "a", sortOrder: 0 });
    await saveResultVariables("t1", [{ ...row }], [{ ...row }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("кладёт границы и направление числового показателя в config_json (PRD-29+)", async () => {
    await saveResultVariables(
      "t1",
      [rv({ name: "score", domainMin: 0, domainMax: 45, valence: "lower_is_better" })],
      [],
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.configJson).toMatchObject({ domainMin: 0, domainMax: 45, valence: "lower_is_better" });
  });

  it("не задан домен → в config_json его нет, но направление пишется всегда", async () => {
    await saveResultVariables("t1", [rv({ name: "score" })], []);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.configJson).not.toHaveProperty("domainMin");
    expect(body.configJson.valence).toBe("none");
  });

  it("PUTs when only the domain changed", async () => {
    const snap = [rv({ id: "a", name: "a" })];
    const draft = [rv({ id: "a", name: "a", domainMin: 0, domainMax: 45 })];
    await saveResultVariables("t1", draft, snap);
    expect(calls()).toEqual([["PUT", `${base}/a`]]);
  });

  it("PUTs when only the valence changed", async () => {
    const snap = [rv({ id: "a", name: "a" })];
    const draft = [rv({ id: "a", name: "a", valence: "higher_is_better" })];
    await saveResultVariables("t1", draft, snap);
    expect(calls()).toEqual([["PUT", `${base}/a`]]);
  });

  it("normalizes sortOrder to the draft index", async () => {
    // Same fields but moved to index 0 → sortOrder 1→0 counts as a change → PUT.
    const snap = [rv({ id: "x", name: "x", sortOrder: 1 })];
    const draft = [rv({ id: "x", name: "x", sortOrder: 1 })]; // now at index 0
    await saveResultVariables("t1", draft, snap);
    expect(calls()).toEqual([["PUT", `${base}/x`]]);
  });

  it("runs deletes before creates/updates", async () => {
    const snap = [rv({ id: "a", name: "a" }), rv({ id: "b", name: "b", sortOrder: 1 })];
    const draft = [rv({ id: "b", name: "b", sortOrder: 1, label: "B2" }), rv({ name: "c", sortOrder: 1 })];
    await saveResultVariables("t1", draft, snap);
    const methods = calls().map((c) => c[0]);
    expect(methods[0]).toBe("DELETE");
    expect(methods).toContain("PUT");
    expect(methods).toContain("POST");
  });

  it("throws with the server error message when a mutation fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: "controls_status conflict" }),
    });
    await expect(saveResultVariables("t1", [rv({ name: "x" })], [])).rejects.toThrow(
      /controls_status conflict/,
    );
  });
});

// ─── Live validation wrapper ──────────────────────────────────────────────────

describe("validateResultVariableFormula", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs the formula and returns the validation result", async () => {
    const result = { valid: true, returnType: "number", errors: [], warnings: [] };
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => result }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await validateResultVariableFormula("t1", { formula: "percent", type: "number" });
    expect(out).toEqual(result);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tests/t1/result-variables/validate-formula");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("throws on a non-2xx response", async () => {
    fetchMock = vi.fn(async () => ({ ok: false, status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      validateResultVariableFormula("t1", { formula: "x", type: "number" }),
    ).rejects.toThrow(/500/);
  });
});
