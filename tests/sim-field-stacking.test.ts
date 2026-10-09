/**
 * @module tests/sim-field-stacking
 * @description Where a field of a «Сценарий в ИС» scene sits among the scene's elements
 * (`fieldStacking`, `shared/sim/diff`). Every field used to be drawn above every element: a
 * full-frame dictionary dialog showed the form's values through itself, and an editable field under
 * the dialog swallowed the clicks meant for the dialog's rows.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { fieldStacking } from "@shared/sim/diff";
import type { MediaItem, Scenario, Scene } from "@shared/sim/contract";

const example = JSON.parse(
  readFileSync(resolve(process.cwd(), "docs/specs/sim-scenario/example/scenario.json"), "utf8"),
) as Scenario;
const media = new Map<string, MediaItem>(example.media.map((m) => [m.id, m]));
const sceneOf = (id: string) => example.scenes.find((s) => s.id === id) as Scene;
const shownUnlessHidden = (scene: Scene) => (id: string) => !scene.elements.find((e) => e.id === id)?.hidden;

describe("fieldStacking", () => {
  it("a full-frame dictionary dialog covers the form's fields instead of adopting them", () => {
    const scene = sceneOf("form-dir");
    for (const field of scene.fields ?? []) {
      const st = fieldStacking(scene, field, media, shownUnlessHidden(scene));
      expect(scene.elements[st.host].id).toBe("bg");
      expect(st.covered).toBe(true);
      expect(st.shown).toBe(true);
    }
  });

  it("on the plain form nothing covers the fields; a hidden error message does not count", () => {
    const scene = sceneOf("form");
    for (const field of scene.fields ?? []) {
      const st = fieldStacking(scene, field, media, shownUnlessHidden(scene));
      expect(scene.elements[st.host].id).toBe("bg");
      expect(st.covered).toBe(false);
    }
  });

  it("a dialog box adopts the field typed into it, which stays reachable above it", () => {
    const scene: Scene = {
      id: "s",
      elements: [
        { id: "bg", media: "m", x: 0, y: 0, w: 1920, h: 1200 },
        { id: "box", media: "m", x: 500, y: 300, w: 800, h: 400 },
      ],
      fields: [{ field: "q", x: 540, y: 380, w: 400, h: 60, editable: true }],
    } as Scene;
    const st = fieldStacking(scene, scene.fields![0], new Map(), () => true);
    expect(scene.elements[st.host].id).toBe("box");
    expect(st.covered).toBe(false);
  });

  it("a field of a hidden form is hidden with it; a field no element holds stays on top", () => {
    const scene: Scene = {
      id: "s",
      elements: [{ id: "panel", media: "m", x: 0, y: 0, w: 600, h: 600 }],
      fields: [
        { field: "a", x: 10, y: 10, w: 100, h: 40 },
        { field: "b", x: 900, y: 900, w: 100, h: 40 },
      ],
    } as Scene;
    expect(fieldStacking(scene, scene.fields![0], new Map(), () => false)).toEqual({ host: 0, shown: false, covered: false });
    expect(fieldStacking(scene, scene.fields![1], new Map(), () => true)).toEqual({ host: -1, shown: true, covered: false });
  });
});
