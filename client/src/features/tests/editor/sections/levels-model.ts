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

import { formatAuthorNumber, parseAuthorNumber } from "../numeric-input";
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
  return draft.levels.map((l, i) => {
    // Raw, unnormalised strings on purpose: the editor re-derives the draft from
    // these on every render, so anything reformatted here would fight the author
    // mid-keystroke (see the module note above).
    const { from, to } = levelBounds(draft, i);
    return {
      clientKey: l.clientKey,
      min: from,
      max: to,
      label: l.label,
      level: l.level,
      text: l.text,
      tone: l.tone,
      feedback: l.feedback,
    };
  });
}

/**
 * Where level `i` starts and ends in the draft: the outer bounds for the first and
 * last level, the surrounding cuts for everything between. The SAME rule
 * {@link draftToBands} folds by — a card header that computed it separately would
 * be a second source of truth for the one thing this module exists to own.
 *
 * Raw strings, not numbers: the caller renders half-typed input as readily as valid
 * input, and parsing here would erase the difference.
 *
 * @public
 */
export function levelBounds(draft: LevelsDraft, i: number): { from: string; to: string } {
  const last = draft.levels.length - 1;
  return {
    from: i === 0 ? draft.start : draft.cuts[i - 1],
    to: i === last ? draft.end : draft.cuts[i],
  };
}

/** Per-field messages plus the blocking one that stops saving. */
export type LevelsErrors = {
  start: string | null;
  cuts: Array<string | null>;
  end: string | null;
  blocking: string | null;
  /**
   * WHICH of the two blocking conditions fired, as a token rather than prose.
   * The coverage ribbon cannot be drawn in either case and has to say why — and
   * «границы заданы не полностью» is a lie when all four fields hold numbers and
   * only their order is wrong. Sniffing {@link LevelsErrors.blocking} for that
   * would tie the ribbon's wording to the banner's; this cannot drift.
   */
  kind: "incomplete" | "order" | null;
};

type Slot = { raw: string; name: string };

/** The boundary row the author sees, left to right, each with its role name. */
function slots(draft: LevelsDraft): Slot[] {
  return [
    { raw: draft.start, name: "начала" },
    ...draft.cuts.map((c) => ({ raw: c, name: "порога" })),
    { raw: draft.end, name: "конца" },
  ];
}

/**
 * The only two things that can go wrong once boundaries are cut points: a field
 * that is not a number, and a row that stops ascending. Overlaps and gaps are
 * unrepresentable by construction.
 *
 * @public
 */
export function draftErrors(draft: LevelsDraft): LevelsErrors {
  const out: LevelsErrors = {
    start: null,
    cuts: draft.cuts.map(() => null),
    end: null,
    blocking: null,
    kind: null,
  };
  if (draft.levels.length === 0) return out;

  const row = slots(draft);
  const values = row.map((slot) => parseAuthorNumber(slot.raw.trim()));
  // First message wins: the author fixes one field at a time, and a field
  // carrying two complaints at once reads as noise.
  const set = (i: number, message: string) => {
    if (i === 0) out.start = out.start ?? message;
    else if (i === row.length - 1) out.end = out.end ?? message;
    else out.cuts[i - 1] = out.cuts[i - 1] ?? message;
  };

  values.forEach((v, i) => {
    if (v === null) set(i, "Укажите число");
  });
  if (values.some((v) => v === null)) {
    out.blocking = "Границы уровней заданы не полностью: укажите числа во всех полях.";
    out.kind = "incomplete";
    return out;
  }

  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1] as number;
    const cur = values[i] as number;
    // Non-strict: a zero-width level is legal, exactly as a single band 0..0 is today.
    if (cur >= prev) continue;
    set(i - 1, `Больше следующего ${row[i].name} ${formatAuthorNumber(cur)}`);
    set(i, `Меньше предыдущего ${row[i - 1].name} ${formatAuthorNumber(prev)}`);
    out.blocking = "Числа в ряду «Начало — пороги — Конец» должны идти по возрастанию.";
    out.kind = "order";
  }
  return out;
}

/**
 * True when the STORED bands leave a hole between neighbours — a legacy pair
 * («0-15» / «16-29»). Drives the notice that opening the card closed the hole.
 *
 * @public
 */
export function hasStoredGap(bands: ScaleBandModel[]): boolean {
  for (let i = 0; i < bands.length - 1; i++) {
    const upper = parseAuthorNumber(bands[i].max.trim());
    const lower = parseAuthorNumber(bands[i + 1].min.trim());
    if (upper === null || lower === null) continue;
    if (upper !== lower) return true;
  }
  return false;
}

/** One stripe of the coverage ribbon. */
export type CoverageSegment =
  | { kind: "level"; index: number; from: number; to: number }
  | { kind: "gap"; from: number; to: number };

/**
 * The ribbon above the level list. Null while the row does not parse or does not
 * ascend — a ribbon drawn from broken numbers would lie about the coverage.
 *
 * @public
 */
export function coverageSegments(
  draft: LevelsDraft,
  domain: { min: number; max: number } | null,
): CoverageSegment[] | null {
  if (draft.levels.length === 0) return null;

  const bounds: number[] = [];
  for (const raw of [draft.start, ...draft.cuts, draft.end]) {
    const v = parseAuthorNumber(raw.trim());
    if (v === null) return null;
    bounds.push(v);
  }
  for (let i = 1; i < bounds.length; i++) {
    if (bounds[i] < bounds[i - 1]) return null;
  }

  const levels: CoverageSegment[] = draft.levels.map((_, i) => ({
    kind: "level",
    index: i,
    from: bounds[i],
    to: bounds[i + 1],
  }));
  if (domain === null) return levels;

  const from = bounds[0];
  const to = bounds[bounds.length - 1];
  const head: CoverageSegment[] = domain.min < from ? [{ kind: "gap", from: domain.min, to: from }] : [];
  const tail: CoverageSegment[] = domain.max > to ? [{ kind: "gap", from: to, to: domain.max }] : [];
  return [...head, ...levels, ...tail];
}

/**
 * Append a level. The first one spans the whole known domain; every next one is
 * cut off the last level at its midpoint, so the author never starts from an
 * invalid row.
 *
 * @public
 */
export function addLevel(draft: LevelsDraft, domain: { min: number; max: number } | null): LevelsDraft {
  if (draft.levels.length === 0) {
    return {
      start: formatAuthorNumber(domain?.min ?? 0),
      cuts: [],
      end: formatAuthorNumber(domain?.max ?? 0),
      levels: [emptyLevel()],
    };
  }
  const lowerRaw = draft.cuts.length > 0 ? draft.cuts[draft.cuts.length - 1] : draft.start;
  const lower = parseAuthorNumber(lowerRaw.trim());
  const upper = parseAuthorNumber(draft.end.trim());
  const cut = lower === null || upper === null ? "" : formatAuthorNumber((lower + upper) / 2);
  return { ...draft, cuts: [...draft.cuts, cut], levels: [...draft.levels, emptyLevel()] };
}

/**
 * Remove a level together with ONE adjacent cut — the one below it, or the one
 * above it for the first level. Whichever goes, the neighbours close ranks and
 * the covered span stays exactly as it was.
 *
 * @public
 */
export function removeLevel(draft: LevelsDraft, index: number): LevelsDraft {
  const levels = draft.levels.filter((_, i) => i !== index);
  if (levels.length === 0) return { start: "", cuts: [], end: "", levels: [] };
  const cutToDrop = index === 0 ? 0 : index - 1;
  return { ...draft, cuts: draft.cuts.filter((_, i) => i !== cutToDrop), levels };
}

/**
 * Reorder level CONTENT. Boundaries are positional and stay put: the author is
 * saying «these texts belong to the other end of the scale», not «move the
 * threshold».
 *
 * @public
 */
export function moveLevel(draft: LevelsDraft, from: number, to: number): LevelsDraft {
  if (from === to || to < 0 || to >= draft.levels.length) return draft;
  const levels = [...draft.levels];
  const [moved] = levels.splice(from, 1);
  levels.splice(to, 0, moved);
  return { ...draft, levels };
}
