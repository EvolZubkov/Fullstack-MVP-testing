/**
 * @module features/questions/answer-rules/answer-rules-model
 *
 * The editing STATE of a question's answer check (PRD-57 §6.1), kept apart from its
 * markup so the rules that matter can be tested without a DOM.
 *
 * The draft holds BOTH answer kinds at once. FR-28d requires that switching text to
 * number and back loses nothing before the question is saved, and the only way to
 * promise that is to keep the other set alive rather than convert it: a text rule has
 * no honest numeric counterpart, so a conversion would silently invent one.
 *
 * The automatic-check switch works the same way — turning it off empties the SAVED set
 * (a question with no rules collects text and earns nothing, §5.3) while the draft keeps
 * what the author wrote, so switching back does not ask them to type it again.
 *
 * Every function is pure and returns a NEW draft: the block re-renders from the returned
 * value, and an accidental mutation cannot desync React from what is about to be saved.
 */
import type { AnswerRule, AnswerRuleSet, NumericRule, TextRule } from "@shared/answer-check";

/** Answer kind the author is editing. */
export type AnswerKind = AnswerRuleSet["answerKind"];

/** The draft: one rule list per kind, plus what applies to the whole set. */
export interface AnswerRulesDraft {
  autoCheck: boolean;
  answerKind: AnswerKind;
  join: AnswerRuleSet["join"];
  unit: string;
  text: TextRule[];
  number: NumericRule[];
  /** What the question carried when the drawer opened — the baseline for {@link isDirty}. */
  initial: AnswerRuleSet;
}

/** A blank set: the shape a question without an answer check carries. */
const EMPTY: AnswerRuleSet = { answerKind: "text", join: "any", rules: [] };

/** A brand-new rule of the given kind, with the defaults the editor shows. */
function blankRule(kind: AnswerKind): AnswerRule {
  return kind === "number"
    ? { kind: "number", op: "eq", value: 0 }
    : { kind: "text", match: "wildcard", value: "" };
}

/** Read a stored set defensively — `correct_json` reaches the editor as `unknown`. */
export function createDraft(stored: AnswerRuleSet | null | undefined): AnswerRulesDraft {
  const isNew = !stored || !Array.isArray(stored.rules);
  const set: AnswerRuleSet = isNew ? EMPTY : (stored as AnswerRuleSet);
  const rules = set.rules ?? [];
  return {
    // A BRAND-NEW question starts with checking on: automatic checking is what the type
    // is for, and making the author flip a switch before writing the first rule is a step
    // that buys nothing. A question that was SAVED with no rules is the other case — the
    // author turned checking off on purpose (§5.3), and reopening it must not turn it
    // back on behind their back.
    autoCheck: isNew || rules.length > 0,
    answerKind: set.answerKind === "number" ? "number" : "text",
    join: set.join === "all" ? "all" : "any",
    unit: typeof set.unit === "string" ? set.unit : "",
    text: rules.filter((r): r is TextRule => r.kind === "text"),
    number: rules.filter((r): r is NumericRule => r.kind === "number"),
    initial: set,
  };
}

/** Rules of the kind currently being edited. */
function currentRules(draft: AnswerRulesDraft): AnswerRule[] {
  return draft.answerKind === "number" ? draft.number : draft.text;
}

/** Replace the rules of the kind currently being edited. */
function withRules(draft: AnswerRulesDraft, rules: AnswerRule[]): AnswerRulesDraft {
  return draft.answerKind === "number"
    ? { ...draft, number: rules as NumericRule[] }
    : { ...draft, text: rules as TextRule[] };
}

/** Switch the answer kind. The other kind's rules stay in the draft (FR-28d). */
export function switchKind(draft: AnswerRulesDraft, answerKind: AnswerKind): AnswerRulesDraft {
  return { ...draft, answerKind };
}

/** «Любое правило» / «Все правила» — one per set (FR-28c). */
export function setJoin(draft: AnswerRulesDraft, join: AnswerRuleSet["join"]): AnswerRulesDraft {
  return { ...draft, join };
}

/** Turn automatic checking on or off without discarding what was typed. */
export function setAutoCheck(draft: AnswerRulesDraft, autoCheck: boolean): AnswerRulesDraft {
  return { ...draft, autoCheck };
}

/** Display unit of a numeric answer (`°C`) — a property of the question, not of a rule. */
export function setUnit(draft: AnswerRulesDraft, unit: string): AnswerRulesDraft {
  return { ...draft, unit };
}

/**
 * Append an empty rule of the current kind.
 *
 * Adding a rule turns automatic checking ON: writing a rule IS the intent to check, and
 * a rule saved into a set that is switched off would be silently dropped by
 * {@link toCorrectJson} — the author would see their work vanish on save.
 */
export function addRule(draft: AnswerRulesDraft): AnswerRulesDraft {
  const next = withRules(draft, [...currentRules(draft), blankRule(draft.answerKind)]);
  return { ...next, autoCheck: true };
}

/** Patch one rule in place; indices outside the list are ignored. */
export function updateRule(
  draft: AnswerRulesDraft,
  index: number,
  patch: Partial<TextRule> | Partial<NumericRule>,
): AnswerRulesDraft {
  const rules = currentRules(draft);
  if (index < 0 || index >= rules.length) return draft;
  const next = rules.slice();
  next[index] = { ...next[index], ...patch } as AnswerRule;
  return withRules(draft, next);
}

/** Drop one rule; indices outside the list are ignored. */
export function removeRule(draft: AnswerRulesDraft, index: number): AnswerRulesDraft {
  const rules = currentRules(draft);
  if (index < 0 || index >= rules.length) return draft;
  return withRules(draft, rules.filter((_, i) => i !== index));
}

/**
 * The set as it will be stored in `questions.correct_json`.
 *
 * Only the CURRENT kind is written: the other list exists for the undo promise of
 * FR-28d and has no meaning once the question is saved.
 */
export function toCorrectJson(draft: AnswerRulesDraft): AnswerRuleSet {
  const rules = draft.autoCheck ? currentRules(draft) : [];
  const set: AnswerRuleSet = { answerKind: draft.answerKind, join: draft.join, rules };
  if (draft.answerKind === "number" && draft.unit.trim() !== "") set.unit = draft.unit.trim();
  return set;
}

/** Has anything changed since the drawer opened? Drives the «вернуть» action. */
export function isDirty(draft: AnswerRulesDraft): boolean {
  return JSON.stringify(toCorrectJson(draft)) !== JSON.stringify(normalizeStored(draft.initial));
}

/** The baseline in the same shape {@link toCorrectJson} produces, so the two compare. */
function normalizeStored(set: AnswerRuleSet): AnswerRuleSet {
  const rules = Array.isArray(set.rules) ? set.rules : [];
  const normalized: AnswerRuleSet = {
    answerKind: set.answerKind === "number" ? "number" : "text",
    join: set.join === "all" ? "all" : "any",
    rules,
  };
  if (normalized.answerKind === "number" && typeof set.unit === "string" && set.unit.trim() !== "") {
    normalized.unit = set.unit.trim();
  }
  return normalized;
}
