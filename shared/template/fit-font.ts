/**
 * @module shared/template/fit-font
 *
 * Length-driven font sizing for the learner scene (revision «Стандартный» on ui-kit).
 * The question prompt (18–32px) and the answer options (14–22px) shrink as their text
 * grows, so a long prompt/option stays inside the fixed stage without the runtime
 * measuring the DOM. Computed in ONE place and passed to both hosts via the context;
 * the layout/emission substitute it inline (`--tb-question-fs` / `--tb-answer-fs`).
 *
 * Ported from the ui-kit reference `fit()`: from `max`, subtract `per` px for every
 * character past `from`, clamped to `[min, max]`. Pure — no DOM, no Node.
 */

import { stripMarkdown } from "../text/plain";

/** Fit configuration: clamp `[min, max]`, start shrinking past `from` chars, `per` px/char. */
export interface FitFontConfig {
  max: number;
  min: number;
  from: number;
  per: number;
}

/** The question prompt scale (32 → 16). */
export const QUESTION_FIT: FitFontConfig = { max: 32, min: 16, from: 58, per: 0.17 };
/** The answer-option scale (22 → 14). */
export const OPTION_FIT: FitFontConfig = { max: 22, min: 14, from: 38, per: 0.14 };

/**
 * Font size (in `px`) for a text of `len` characters under `cfg`: `max` minus `per` per
 * character past `from`, clamped to `[min, max]`, rounded.
 */
export function fitFont(len: number, cfg: FitFontConfig): string {
  const shrink = Math.max(0, (Number(len) || 0) - cfg.from) * cfg.per;
  const size = Math.min(cfg.max, Math.max(cfg.min, cfg.max - shrink));
  return Math.round(size) + "px";
}

/**
 * Question prompt font from its text length.
 *
 * Length is measured on the VISIBLE text: markdown markers become tags, and a
 * link's URL never reaches the screen at all, so counting those characters would
 * shrink a prompt for text the learner cannot see.
 */
export function questionFont(prompt: unknown): string {
  return fitFont(stripMarkdown(String(prompt ?? "")).length, QUESTION_FIT);
}

/**
 * Answer-option font for a whole question — sized to the LONGEST option so every option
 * shares one readable size (the emission sets `--tb-answer-fs` once for the group).
 */
export function optionFont(texts: unknown[] | null | undefined): string {
  const longest = (texts ?? []).reduce(
    (m: number, t) => Math.max(m, stripMarkdown(String(t ?? "")).length),
    0,
  );
  return fitFont(longest, OPTION_FIT);
}
