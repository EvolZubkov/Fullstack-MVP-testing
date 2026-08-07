/**
 * @module shared/template/scales-chart
 *
 * Decides WHICH cross-scale diagram the results screen draws — the radar of PRD-35, the rose
 * of PRD-46, or neither.
 *
 * The decision is deliberately split from both geometries. Each builder already refuses what
 * it cannot draw (too few axes, no domain, nothing to divide), and those refusals are about
 * the figure. This module answers the question above them: what does the author want said
 * about these scales, and does the data support saying it.
 *
 * Pure — no DOM, no Node.
 */

/** Values of the author's setting, in the order the manifest lists them. */
export type ScalesChartKind = "none" | "auto" | "radar" | "rose";

/** What the renderer should build, or `null` when no diagram is drawn. */
export type ResolvedChartKind = "radar" | "rose" | null;

/**
 * Block settings this module reads. `showCompetencyRadar` is PRD-35's boolean, kept for the
 * tests saved before the setting became four-valued.
 */
export interface ChartKindSettings {
  scalesChartKind?: ScalesChartKind;
  showCompetencyRadar?: boolean;
}

const KINDS: readonly string[] = ["none", "auto", "radar", "rose"];

/**
 * The author's choice, with PRD-35's boolean migrated.
 *
 * Absence resolves to `none`, never to `auto`: `auto` draws, and a default that draws would
 * put a diagram on every existing test whose author never asked for one (PRD-35 §9 forbids
 * exactly that). An unknown value degrades the same way — a saved setting the current build
 * does not understand must not silently pick a picture.
 */
export function chartKindSetting(settings: ChartKindSettings): ScalesChartKind {
  const explicit = settings.scalesChartKind;
  if (typeof explicit === "string") return KINDS.includes(explicit) ? explicit : "none";
  return settings.showCompetencyRadar === true ? "radar" : "none";
}

export interface ChartKindInput {
  setting: ScalesChartKind;
  /** Do the scales divide one whole? See `shared/scales/composition`. */
  ipsative: boolean;
  /** Is at least one visible scale showing a level instead of its value? */
  hasHiddenValue: boolean;
}

/**
 * Resolve the setting against the data.
 *
 * Two refusals of an explicitly chosen rose, for different reasons:
 *
 *   - scales that do NOT divide a whole still draw. Ipsativity is inferred from the model, and
 *     the author may know something about their method that the inference cannot see; the
 *     editor warns instead of overriding them.
 *   - a hidden value does NOT draw. That is not a judgement call: the rose states shares of a
 *     whole, and a share quantized to the middle of a band is no longer that share (PRD-46
 *     §3.4). `auto` falls back to the radar there, which survives quantization because its
 *     rays are independent.
 */
export function resolveChartKind(input: ChartKindInput): ResolvedChartKind {
  switch (input.setting) {
    case "none":
      return null;
    case "radar":
      return "radar";
    case "rose":
      return input.hasHiddenValue ? null : "rose";
    case "auto":
      return input.ipsative && !input.hasHiddenValue ? "rose" : "radar";
    default:
      return null;
  }
}
