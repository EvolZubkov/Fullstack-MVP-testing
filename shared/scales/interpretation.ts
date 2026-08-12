/**
 * @module shared/scales/interpretation
 *
 * The interpretation model shared by scales (PRD-5) and result variables (PRD-2):
 * an ordered list of outcomes carrying a label, an explanatory text, an optional
 * tone override and optional feedback. Only the MATCH differs — a numeric band for
 * numbers, an exact code for strings and booleans.
 *
 * Reading is defensive by design: the source is a jsonb column an author edits, so
 * every accessor degrades to a neutral default rather than throwing. A missing
 * domain falls back to the span of the bands, which is what a legacy scale (bands
 * without an explicit domain) effectively means.
 *
 * Pure — no DOM, no Node — bundled verbatim into the SCORM package.
 */

import type { RichTextFormat } from "../template/rich-text";

export type LevelTone = "favorable" | "neutral" | "attention" | "critical";
export type Valence = "higher_is_better" | "lower_is_better" | "none";
export type LearnerVisibility = "hidden" | "level" | "level_and_value";

export interface RecommendationLink { title: string; url?: string }

export interface FeedbackBlock {
  text?: string;
  /**
   * В каком виде автор написал `text` (`feedback_json.format`, PRD-7 §3.4).
   *
   * Ехало до базы и там останавливалось: выдача везла один голый текст, и «Форматированный»
   * с «HTML» приходили слушателю сплошным абзацем. Отсутствие поля = `plain` — так выглядят
   * и старые записи, и всякий хост, который про формат ещё не знает.
   */
  format?: RichTextFormat;
  links?: RecommendationLink[];
  events?: RecommendationLink[];
  assets?: RecommendationLink[];
}

export interface InterpretationBand {
  min: number;
  max: number;
  level: string;
  label?: string;
  text?: string;
  tone?: LevelTone;
  feedback?: FeedbackBlock;
}

export interface InterpretationOutcome {
  code: string;
  label: string;
  text?: string;
  tone?: LevelTone;
  feedback?: FeedbackBlock;
}

export interface ScaleInterpretation {
  domainMin: number | null;
  domainMax: number | null;
  /**
   * PRD-46 §6: what the author wants a FULL ray of the radar to stand for, when that is not
   * the domain. Optional and read by nothing else — the domain still decides what the scale
   * MEASURES, this only decides how far the drawing stretches.
   *
   * The case it exists for: a domain nobody ever approaches. A scale scored 0..98 whose real
   * answers sit between 10 and 35 draws a figure crumpled into a third of the field, and the
   * differences between scales — the only thing a profile is read for — disappear with it.
   * `null` = not set; the radar then falls back to `domainMax`, which is what it always did.
   */
  displayMax: number | null;
  valence: Valence;
  bands: InterpretationBand[];
}

export interface IndicatorInterpretation {
  domainMin: number | null;
  domainMax: number | null;
  valence: Valence;
  bands: InterpretationBand[];
  outcomes: InterpretationOutcome[];
}

const VALENCES: readonly Valence[] = ["higher_is_better", "lower_is_better", "none"];

/**
 * A number, or null when the config carries no number here.
 *
 * `null` and `""` are rejected BEFORE `Number()` because both convert to a finite
 * zero. The editor stores an unfilled domain as an explicit `domainMin: null` (not as
 * an absent key), and an empty numeric form field arrives as `""` — so the plain
 * conversion turned «no domain» into the domain 0..0, and the results screen printed
 * «18 из 0» to the learner. A band missing a bound is dropped for the same reason:
 * a zero invented for it would silently move the boundary of a neighbouring level.
 */
function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asBands(value: unknown): InterpretationBand[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const b = raw as Record<string, unknown>;
      const min = asNumber(b.min);
      const max = asNumber(b.max);
      if (min === null || max === null) return null;
      // Same answer as {@link asOutcomes} gives an outcome without a code, and for the
      // same reason: the code is the level's IDENTITY, not one of its texts. Without it
      // the level cannot be marked as the current one on the ruler (`band.level ===
      // currentLevel` degenerates), cannot be named by a result-variable formula, is
      // published to the LMS as an empty `scale.<ключ>.level`, and loses its own text and
      // feedback the moment the book carries it. The LABEL is what may be absent — every
      // reader falls back to `label ?? level`.
      const level = String(b.level ?? "");
      if (!level) return null;
      const band: InterpretationBand = { min, max, level };
      if (b.label) band.label = String(b.label);
      if (b.text) band.text = String(b.text);
      if (b.tone) band.tone = b.tone as LevelTone;
      if (b.feedback) band.feedback = b.feedback as FeedbackBlock;
      return band;
    })
    .filter((b): b is InterpretationBand => b !== null)
    .sort((a, b) => a.min - b.min);
}

function asOutcomes(value: unknown): InterpretationOutcome[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const o = raw as Record<string, unknown>;
      const code = String(o.code ?? "");
      if (!code) return null;
      const outcome: InterpretationOutcome = { code, label: String(o.label ?? code) };
      if (o.text) outcome.text = String(o.text);
      if (o.tone) outcome.tone = o.tone as LevelTone;
      if (o.feedback) outcome.feedback = o.feedback as FeedbackBlock;
      return outcome;
    })
    .filter((o): o is InterpretationOutcome => o !== null);
}

function asValence(value: unknown): Valence {
  return VALENCES.indexOf(value as Valence) !== -1 ? (value as Valence) : "none";
}

/** Domain from the config, falling back to the span the bands themselves cover. */
function resolveDomain(
  config: Record<string, unknown>,
  bands: InterpretationBand[],
): { domainMin: number | null; domainMax: number | null } {
  const explicitMin = asNumber(config.domainMin);
  const explicitMax = asNumber(config.domainMax);
  if (explicitMin !== null && explicitMax !== null) {
    return { domainMin: explicitMin, domainMax: explicitMax };
  }
  if (bands.length === 0) return { domainMin: null, domainMax: null };
  return { domainMin: bands[0].min, domainMax: bands[bands.length - 1].max };
}

/** Parse a scale's `config_json` into its interpretation. Never throws. */
export function parseScaleInterpretation(configJson: unknown): ScaleInterpretation {
  const config = (configJson ?? {}) as Record<string, unknown>;
  const bands = asBands(config.bands);
  return {
    ...resolveDomain(config, bands),
    // NOT folded into `resolveDomain`: there is no fallback to invent here. An absent display
    // limit means «draw to the domain», and that answer belongs to the radar, which is the
    // only reader — inventing one from the bands would silently rescale existing charts.
    displayMax: asNumber(config.displayMax),
    valence: asValence(config.valence),
    bands,
  };
}

/** Parse a result variable's `config_json` into its interpretation. Never throws. */
export function parseIndicatorInterpretation(configJson: unknown): IndicatorInterpretation {
  const config = (configJson ?? {}) as Record<string, unknown>;
  const bands = asBands(config.bands);
  return {
    ...resolveDomain(config, bands),
    valence: asValence(config.valence),
    bands,
    outcomes: asOutcomes(config.outcomes),
  };
}

/** The band a numeric value falls into; both bounds are inclusive. */
export function findBand(bands: InterpretationBand[], value: number): InterpretationBand | null {
  for (const band of bands) {
    if (value >= band.min && value <= band.max) return band;
  }
  return null;
}

/** The outcome a string/boolean value maps to, matched by exact code. */
export function findOutcome(
  outcomes: InterpretationOutcome[],
  value: string | boolean | null | undefined,
): InterpretationOutcome | null {
  if (value === null || value === undefined) return null;
  const code = String(value);
  for (const outcome of outcomes) {
    if (outcome.code === code) return outcome;
  }
  return null;
}
