/**
 * @module tests/sim-player-shadow-root
 * @description The «Сценарий в ИС» player mounted inside a shadow root — how the web host plays a
 * scenario next to the design template's stylesheet, so a template skin (`.tbsim …`) reaches the
 * player as it does in the package document. Inside a shadow root `document.activeElement` is the
 * shadow HOST and a document-level key listener sees the host as the target, so the player has to
 * ask its own root node for both; otherwise typing is lost on a redraw and plain letters typed into
 * a field fire the scenario's key bindings.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { Scenario } from "@shared/sim/contract";
import { mountPlayer, type MountedPlayer } from "@shared/sim/player";

/** One scene: a form with an editable field, a hidden notice, and two key bindings showing it. */
const scenario = {
  format: "skillum.sim-scenario",
  version: 1,
  meta: { title: "Форма", task: "Заполните поле" },
  media: [
    { id: "form", file: "form.png", w: 400, h: 200 },
    { id: "note", file: "note.png", w: 100, h: 20 },
  ],
  fields: [
    {
      id: "name",
      title: "имя",
      fill: "keyboard",
      check: { answerKind: "text", join: "any", rules: [{ kind: "text", match: "wildcard", value: "Пётр" }] },
    },
  ],
  start: "form",
  scenes: [
    {
      id: "form",
      elements: [
        { id: "bg", media: "form", x: 0, y: 0 },
        { id: "note", media: "note", x: 0, y: 0, hidden: true },
      ],
      fields: [{ field: "name", x: 10, y: 10, w: 200, h: 40, editable: true }],
      keys: [
        { id: "letter", keys: "A", effects: [{ show: "note" }] },
        { id: "save", keys: "Ctrl+S", effects: [{ show: "note" }] },
      ],
      zones: [],
    },
  ],
} as unknown as Scenario;

let mounted: MountedPlayer | null = null;
let host: HTMLElement | null = null;

/** Mount the player into a fresh shadow root; returns the root and the field input. */
function mountInShadow(): { shadow: ShadowRoot; input: HTMLInputElement } {
  host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const root = document.createElement("div");
  shadow.appendChild(root);
  mounted = mountPlayer(root, { scenario, mediaUrl: (f) => f, onClose: () => undefined });
  const input = shadow.querySelector<HTMLInputElement>(".tbsim__input");
  if (!input) throw new Error("field input not drawn");
  return { shadow, input };
}

/** Whether the notice is shown: a hidden element is drawn all along, only its visibility flips. */
function noteShown(shadow: ShadowRoot): boolean {
  const note = [...shadow.querySelectorAll<HTMLImageElement>(".tbsim__el")].find((img) => img.src.endsWith("note.png"));
  return note?.style.visibility === "visible";
}

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  host?.remove();
  host = null;
  document.getElementById("tbsim-css")?.remove();
});

describe("плеер внутри shadow root", () => {
  it("кладёт свою таблицу стилей в shadow root, а не в head документа", () => {
    const { shadow } = mountInShadow();
    expect(shadow.getElementById("tbsim-css")).not.toBeNull();
    expect(document.getElementById("tbsim-css")).toBeNull();
  });

  it("буква, набранная в поле, не срабатывает клавишей сценария", () => {
    const { shadow, input } = mountInShadow();
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", bubbles: true, composed: true }));
    expect(noteShown(shadow)).toBe(false);
  });

  it("перерисовка во время набора не стирает незафиксированный текст поля", () => {
    const { shadow, input } = mountInShadow();
    input.focus();
    expect(shadow.activeElement).toBe(input);
    input.value = "Пёт";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true, bubbles: true, composed: true }));
    expect(noteShown(shadow)).toBe(true);
    expect(input.value).toBe("Пёт");
  });
});

describe("плеер в документе", () => {
  it("по-прежнему кладёт таблицу стилей в head", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    mounted = mountPlayer(host, { scenario, mediaUrl: (f) => f, onClose: () => undefined });
    expect(document.head.querySelector("#tbsim-css")).not.toBeNull();
  });
});
