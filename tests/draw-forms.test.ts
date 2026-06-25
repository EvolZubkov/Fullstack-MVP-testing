/**
 * @module tests/draw-forms
 * @description Unit tests for the PRD-17 variant-selection engine
 * (shared/draw/forms.ts). A deterministic injected `shuffle` makes both the
 * variant pick (`shuffle(candidates)[0]`) and the delivery order
 * (`shuffle(questionIds)`) exactly assertable (PRD-17 §5; FR-04/07/15/17).
 */
import { describe, it, expect } from "vitest";
import { selectForm } from "../shared/draw/forms";
import type { Form } from "../shared/schema";

const identity = <T,>(a: T[]): T[] => a;
const reverse = <T,>(a: T[]): T[] => a.slice().reverse();
/** Moves the first element to the end — lets us assert `shuffle` actually drives selection. */
const rotateLeft = <T,>(a: T[]): T[] => (a.length ? [...a.slice(1), a[0]] : a);

const V1: Form = { id: "v1", label: "Вариант 1", questionIds: ["a", "b", "c"] };
const V2: Form = { id: "v2", label: "Вариант 2", questionIds: ["d", "e", "f"] };
const V3: Form = { id: "v3", label: "Вариант 3", questionIds: ["g", "h"] };
const FORMS: Form[] = [V1, V2, V3];

describe("selectForm — pick + whole delivery (FR-04)", () => {
  it("no history: identity shuffle picks the first variant and delivers it whole, in order", () => {
    const r = selectForm(FORMS, { previousFormIds: [], shuffle: identity });
    expect(r).toEqual({ formId: "v1", questionIds: ["a", "b", "c"] });
  });

  it("selection is driven by the injected shuffle (not list position)", () => {
    const r = selectForm(FORMS, { previousFormIds: [], shuffle: rotateLeft });
    // rotateLeft([V1,V2,V3])[0] = V2; rotateLeft(["d","e","f"]) = ["e","f","d"]
    expect(r).toEqual({ formId: "v2", questionIds: ["e", "f", "d"] });
  });
});

describe("selectForm — rotation on retake (FR-07)", () => {
  it("excludes variants used in prior attempts (identity → first remaining)", () => {
    const r = selectForm(FORMS, { previousFormIds: ["v1"], shuffle: identity });
    expect(r.formId).toBe("v2");
  });

  it("excludes several used variants", () => {
    const r = selectForm(FORMS, { previousFormIds: ["v1", "v2"], shuffle: identity });
    expect(r.formId).toBe("v3");
  });

  it("all variants used → exclusion resets (cycle), picks among all again", () => {
    const r = selectForm(FORMS, { previousFormIds: ["v1", "v2", "v3"], shuffle: identity });
    expect(r.formId).toBe("v1");
  });

  it("unknown ids in history don't exclude anything", () => {
    const r = selectForm(FORMS, { previousFormIds: ["gone", "v1"], shuffle: identity });
    expect(r.formId).toBe("v2"); // only v1 actually excluded
  });
});

describe("selectForm — random presentation order (FR-15)", () => {
  it("delivery order follows the shuffle", () => {
    const r = selectForm([V3, V1], { previousFormIds: [], shuffle: reverse });
    // reverse([V3,V1])[0] = V1; reverse(["a","b","c"]) = ["c","b","a"]
    expect(r).toEqual({ formId: "v1", questionIds: ["c", "b", "a"] });
  });
});

describe("selectForm — soft shortfall when a variant question left the bank (FR-17)", () => {
  it("drops questions absent from availableIds, never duplicates, no padding", () => {
    const available = new Set(["a", "c"]); // "b" removed from the topic bank
    const r = selectForm(FORMS, { previousFormIds: [], shuffle: identity, availableIds: available });
    expect(r).toEqual({ formId: "v1", questionIds: ["a", "c"] });
  });

  it("availableIds omitted keeps the whole variant", () => {
    const r = selectForm(FORMS, { previousFormIds: [], shuffle: identity, availableIds: null });
    expect(r.questionIds).toEqual(["a", "b", "c"]);
  });
});

describe("selectForm — purity", () => {
  it("does not mutate the input forms or their questionIds", () => {
    const snapshot = JSON.parse(JSON.stringify(FORMS));
    selectForm(FORMS, { previousFormIds: [], shuffle: reverse });
    expect(FORMS).toEqual(snapshot);
  });
});
