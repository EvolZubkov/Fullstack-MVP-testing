/**
 * @module shared/questions/psycho-hash
 *
 * PRD-66 FR-09a: the fingerprint of a question's CONTENT, used to split observations
 * into series. Editing a question makes the answers given before and after it
 * psychometrically different items: difficulty and discrimination collected on the old
 * wording say nothing about the new one. Statistics are therefore aggregated by this
 * fingerprint frozen at answer time, never by the (possibly already edited) row.
 *
 * NOT the same thing as `questions.content_hash`, and deliberately a separate column.
 * That one is compared by PRD-15 — `test_question_scoring.pinned_content_hash` pins a
 * per-test price to a revision — so changing how it is computed would mark every price
 * override stale at once. Different purposes, different fields.
 *
 * What the fingerprint covers: type, prompt, options/pairs and the correct answer. What
 * it deliberately does NOT cover:
 *
 * - price and partial-credit rules (BRD PA-15d) — since migration 028 scoring belongs to
 *   the TEST, so at the moment a question is saved there is nothing to hash; the grading
 *   rule is the second element of the series key instead;
 * - the ORDER of answer options (PA-15b) — a reshuffle that keeps the same correct answer
 *   is the same instrument, and breaking the series over it would throw away data.
 *   Positional distractor analysis is out of scope for the CTT iteration.
 *
 * Pure and framework-free: the same function serves the server, the web host and the
 * import pipeline, so one question yields one fingerprint everywhere.
 */
import { createHash } from "node:crypto";

/** The content fields a fingerprint is built from. Anything else is ignored. */
export interface PsychoHashInput {
  type: string;
  prompt: string;
  dataJson: unknown;
  correctJson: unknown;
}

/** A JSON value with object keys in a stable order. */
type Canonical = string | number | boolean | null | Canonical[] | { [key: string]: Canonical };

/**
 * Order object keys so that two equal structures serialise identically.
 *
 * `JSON.stringify` preserves insertion order, and the same question read through two code
 * paths (editor save, workbook import) can carry its keys in different order — without
 * this the fingerprint would change for a question nobody touched.
 */
function canonical(value: unknown): Canonical {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: { [key: string]: Canonical } = {};
    for (const key of Object.keys(source).sort()) result[key] = canonical(source[key]);
    return result;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return value === undefined ? null : (value as null);
}

/** Read an options array from the shapes the product actually stores. */
function readOptions(dataJson: unknown): string[] | null {
  if (!dataJson || typeof dataJson !== "object") return null;
  const options = (dataJson as { options?: unknown }).options;
  if (!Array.isArray(options)) return null;
  return options.map((option) => {
    if (typeof option === "string") return option;
    if (option && typeof option === "object") {
      const text = (option as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
    return JSON.stringify(canonical(option));
  });
}

/** Indexes marked correct, whichever of the stored shapes the question uses. */
function readCorrectIndexes(correctJson: unknown): Set<number> {
  const marked = new Set<number>();
  if (!correctJson || typeof correctJson !== "object") return marked;
  const source = correctJson as { correctIndex?: unknown; correctIndexes?: unknown; correct?: unknown };
  const single = source.correctIndex ?? source.correct;
  if (typeof single === "number") marked.add(single);
  const many = source.correctIndexes ?? source.correct;
  if (Array.isArray(many)) for (const index of many) if (typeof index === "number") marked.add(index);
  return marked;
}

/**
 * Options as «text -> is it correct» pairs, sorted by text.
 *
 * This is what makes a reshuffle invisible to the fingerprint (PA-15b): the pairs carry
 * the meaning, the positions do not. Returns null when the question is not option-based,
 * and the caller falls back to hashing the raw structures.
 */
function optionPairs(dataJson: unknown, correctJson: unknown): Canonical | null {
  const options = readOptions(dataJson);
  if (!options) return null;
  const marked = readCorrectIndexes(correctJson);
  return options
    .map((text, index) => [text, marked.has(index)] as Canonical)
    .sort((left, right) => String((left as Canonical[])[0]).localeCompare(String((right as Canonical[])[0])));
}

/**
 * The SHA-256 fingerprint of a question's content, as 64 lowercase hex characters.
 *
 * Ranking is not given the option-pair treatment on purpose: there the order IS the
 * answer, so its structures are hashed as stored.
 */
export function computePsychoHash(question: PsychoHashInput): string {
  const { type, prompt, dataJson, correctJson } = question;
  const orderMatters = type === "ranking";
  const pairs = orderMatters ? null : optionPairs(dataJson, correctJson);

  const shape = pairs
    ? { type, prompt: prompt.trim(), options: pairs, data: stripOptions(dataJson), correct: null }
    : { type, prompt: prompt.trim(), options: null, data: canonical(dataJson), correct: canonical(correctJson) };

  return createHash("sha256").update(JSON.stringify(shape)).digest("hex");
}

/**
 * The stamp of a question AS DELIVERED: the one stored on the row when it is there,
 * computed from the content when it is not.
 *
 * The fallback is what keeps two legitimate cases out of the «версия неизвестна» bucket:
 * a publication snapshot (PRD-15) frozen before the column existed, and a row not yet
 * touched by the backfill. Both carry the full content, so the fingerprint is computable
 * — and computing it cannot disagree with the stored one, since the same content always
 * yields the same hash.
 */
export function resolvePsychoHash(question: PsychoHashInput & { psychoHash?: string | null }): string {
  return question.psychoHash || computePsychoHash(question);
}

/** Everything in `dataJson` except the options already folded into pairs. */
function stripOptions(dataJson: unknown): Canonical {
  if (!dataJson || typeof dataJson !== "object") return canonical(dataJson);
  const source = dataJson as Record<string, unknown>;
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(source)) if (key !== "options") rest[key] = source[key];
  return canonical(rest);
}
