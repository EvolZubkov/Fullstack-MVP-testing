/**
 * @module features/tests/editor/sections/levels-model
 * @description PRD-45. The pure conversion between the stored interpretation
 * (`bands` — pairs of min/max) and what the author actually edits: a start value,
 * N-1 cut points and an end value. Framework-free on purpose — the arithmetic is
 * the risky part (legacy compatibility, ordering) and is unit tested without a DOM.
 *
 * The editor component holds NO state of its own: it derives the draft from
 * `bands` on every render and folds it back on every edit. That works because a
 * cut is written to BOTH neighbours as the same raw string, so the round trip
 * «string → bands → string» is lossless and half-typed input survives a render.
 */

import type { LevelTone } from "@shared/scales/interpretation";

import type { ScaleBandModel } from "../test-editor.types";
import type { FeedbackEditorValue } from "./feedback-editor-modal";

/** One level's content — everything a band carries except its boundaries. */
export type LevelDraft = {
  clientKey: string;
  label: string;
  level: string;
  text: string;
  tone: LevelTone | "";
  feedback?: FeedbackEditorValue;
};

/**
 * What the author edits. `cuts[i]` separates `levels[i]` from `levels[i + 1]`,
 * so `cuts.length === levels.length - 1` whenever there is at least one level.
 * Values stay strings: a half-typed «1,» must survive until it parses.
 */
export type LevelsDraft = {
  start: string;
  cuts: string[];
  end: string;
  levels: LevelDraft[];
};

let localKeyCounter = 0;

function nextKey(): string {
  localKeyCounter += 1;
  return `level-${localKeyCounter}`;
}

/** A level with no content yet. @public */
export function emptyLevel(): LevelDraft {
  return { clientKey: nextKey(), label: "", level: "", text: "", tone: "" };
}

/** Unfold stored bands into the draft the author edits. @public */
export function bandsToDraft(bands: ScaleBandModel[]): LevelsDraft {
  if (bands.length === 0) return { start: "", cuts: [], end: "", levels: [] };
  return {
    start: bands[0].min,
    // The cut comes from the LOWER band's max, never the upper band's min: a
    // legacy gap («0-15» / «16-29») then closes downwards, so no score that
    // already had a level changes level — only scores from the gap gain one.
    cuts: bands.slice(0, -1).map((b) => b.max),
    end: bands[bands.length - 1].max,
    levels: bands.map((b, i) => ({
      clientKey: b.clientKey ?? `band-${i}`,
      label: b.label,
      level: b.level,
      text: b.text,
      tone: b.tone,
      feedback: b.feedback,
    })),
  };
}

/** Fold the draft back into stored bands. @public */
export function draftToBands(draft: LevelsDraft): ScaleBandModel[] {
  const last = draft.levels.length - 1;
  return draft.levels.map((l, i) => ({
    clientKey: l.clientKey,
    min: i === 0 ? draft.start : draft.cuts[i - 1],
    max: i === last ? draft.end : draft.cuts[i],
    label: l.label,
    level: l.level,
    text: l.text,
    tone: l.tone,
    feedback: l.feedback,
  }));
}
