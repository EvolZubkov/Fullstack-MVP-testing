/**
 * @module server/services/analytics/indicator-values
 * @description PRD-56 FR-21e: reading a STORED indicator value in the indicator's own type.
 *
 * Indicator values reach analytics from three places in two shapes. A web attempt keeps them
 * native in `result_json.resultVariables` (`64`, `true`, `"kom"`); live telemetry and an imported
 * LMS export keep them in `scorm_attempts.variables_json` as STRINGS (`"64"`, `"true"`), because
 * the package sends them as text and the export holds nothing but text. Analytics never
 * recomputes a value from the answers: what the run stored is what the run produced.
 *
 * So the one thing left to do is to read both shapes alike. Without it a numeric indicator
 * would average only its web runs and silently drop every LMS one.
 */

/** Indicator types of `result_variables.type`. */
export type IndicatorType = "number" | "string" | "boolean";

/** A stored indicator value after normalisation. */
export type IndicatorValue = number | string | boolean;

/**
 * Read one stored value in the type of its indicator.
 *
 * An LMS export may carry a decimal comma (`"3,5"`), so the comma is accepted as well. A value
 * that does not fit the type is `null`: it is not the indicator's value, and guessing would put
 * a number into an average that the run never produced.
 *
 * @param type the indicator type (`number` / `boolean` / `string`)
 * @param raw the stored value as found in either record
 * @returns the value, or `null` when the run holds no usable value
 */
export function indicatorValueOf(type: string, raw: unknown): IndicatorValue | null {
  if (raw === null || raw === undefined || raw === "") return null;

  if (type === "number") {
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    if (typeof raw !== "string") return null;
    const text = raw.trim();
    if (text === "") return null;
    const n = Number(text.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  if (type === "boolean") {
    if (typeof raw === "boolean") return raw;
    const word = String(raw).trim().toLowerCase();
    if (word === "true" || word === "1") return true;
    if (word === "false" || word === "0") return false;
    return null;
  }

  return String(raw);
}

/**
 * Normalise a whole stored record against the test's indicators.
 *
 * Keys the test does not define are dropped: a renamed or deleted indicator has no row to be
 * shown in, and its old values must not resurface under a name nobody recognises.
 *
 * @param variables the test's indicators (name and type)
 * @param raw the stored record «name -> value», or nothing
 * @returns only the indicators that hold a value
 */
export function indicatorValuesOf(
  variables: ReadonlyArray<{ name: string; type: string }>,
  raw: Record<string, unknown> | null | undefined,
): Record<string, IndicatorValue> {
  const out: Record<string, IndicatorValue> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const variable of variables) {
    const value = indicatorValueOf(variable.type, raw[variable.name]);
    if (value !== null) out[variable.name] = value;
  }
  return out;
}
