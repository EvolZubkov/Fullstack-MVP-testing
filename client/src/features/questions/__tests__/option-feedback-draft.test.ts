/**
 * @module features/questions/__tests__/option-feedback-draft
 *
 * Editor state of per-option feedback texts. The list is aligned by position with the
 * options, so every reorder, removal and the blank-option filter on save must be mirrored
 * here — otherwise a text silently lands under a neighbouring option.
 */
import { describe, expect, it } from "vitest";
import {
  draftAt,
  draftsFromStored,
  moveDraft,
  removeDraft,
  storedFromDrafts,
  updateDraft,
} from "../option-feedback-draft";

describe("option feedback draft", () => {
  it("starts an option with a stored text switched on", () => {
    expect(draftsFromStored([null, "Почему Б"])).toEqual([
      { on: false, text: "" },
      { on: true, text: "Почему Б" },
    ]);
    expect(draftsFromStored(null)).toEqual([]);
  });

  it("reads a position past the end as switched off", () => {
    expect(draftAt([], 3)).toEqual({ on: false, text: "" });
  });

  it("keeps the text when the switch goes off and on again", () => {
    let drafts = updateDraft([], 1, { on: true });
    drafts = updateDraft(drafts, 1, { text: "Почему Б" });
    drafts = updateDraft(drafts, 1, { on: false });
    drafts = updateDraft(drafts, 1, { on: true });
    expect(draftAt(drafts, 1)).toEqual({ on: true, text: "Почему Б" });
  });

  it("moves the text together with its option", () => {
    const drafts = draftsFromStored([null, "Почему Б"]);
    const moved = moveDraft(drafts, 3, 1, 2);
    expect(moved.map((d) => d.text)).toEqual(["", "", "Почему Б"]);
  });

  it("removes the text of a removed option", () => {
    const drafts = draftsFromStored(["Почему А", "Почему Б", "Почему В"]);
    expect(removeDraft(drafts, 1).map((d) => d.text)).toEqual(["Почему А", "Почему В"]);
  });

  it("filters texts with the same mask as blank options on save", () => {
    const drafts = draftsFromStored([null, null, "Почему В"]);
    expect(storedFromDrafts(["А", "  ", "В"], drafts)).toEqual([null, "Почему В"]);
  });

  it("does not save the text of a switched-off option", () => {
    const drafts = updateDraft(draftsFromStored(["Почему А"]), 0, { on: false });
    expect(storedFromDrafts(["А", "Б"], drafts)).toBeNull();
  });

  it("saves nothing when no option carries a text", () => {
    expect(storedFromDrafts(["А", "Б"], [{ on: true, text: "   " }])).toBeNull();
  });
});
