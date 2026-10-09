/**
 * @module shared/questions/short-answer
 *
 * The EFFECTIVE length limit of a typed answer (PRD-57 FR-28v).
 *
 * The author's limit lives in `questions.data_json`; when it is absent, the installation's
 * ceiling applies (`limits.shortAnswerMaxLength`). Resolving the two is a one-line rule,
 * and it lives here rather than in either host for a concrete reason: the SCORM package has
 * no configuration at run time, so the number has to be baked in BEFORE the package is
 * built — while the web host resolves it when it hands the question to the learner. Two
 * call sites, one rule; a second copy would let a package and a web run disagree about how
 * long an answer may be.
 *
 * The ceiling is passed IN, never read here: this module is pure and ships inside the
 * package bundle, where `server/config` does not exist.
 */
import { isTextEntry } from "./question-type";

/** The `data_json` shape this module reads and writes. */
export interface ShortAnswerDataShape {
  maxLength?: number;
}

/**
 * The effective limit for a question, or `null` when the type has no field to limit.
 *
 * A stored limit ABOVE the ceiling is clamped rather than honoured: the ceiling may have
 * been lowered after the question was written (a WebTutor measurement is expected to move
 * it, #51), and an answer the LMS cannot carry is worse than a shorter field.
 *
 * @param type    Question type.
 * @param data    The question's `data_json`.
 * @param ceiling The installation's ceiling.
 */
export function effectiveMaxLength(type: string, data: unknown, ceiling: number): number | null {
  if (!isTextEntry(type)) return null;
  const own = (data as ShortAnswerDataShape | null | undefined)?.maxLength;
  const limit = typeof own === "number" && Number.isInteger(own) && own > 0 ? own : ceiling;
  return Math.min(limit, ceiling);
}

/**
 * The question's `data_json` with the effective limit written into it, ready for a host.
 *
 * Returns the ORIGINAL object for every other type, so callers may run it over a whole
 * delivery without branching on the type themselves.
 */
export function withEffectiveMaxLength(type: string, data: unknown, ceiling: number): unknown {
  const limit = effectiveMaxLength(type, data, ceiling);
  if (limit === null) return data;
  return { ...((data as object | null) ?? {}), maxLength: limit };
}
