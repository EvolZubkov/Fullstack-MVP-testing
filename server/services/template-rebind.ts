/**
 * @module server/services/template-rebind
 * @description Pure helper for rebinding a test's design slepok to the built-in
 * `default` template when its current template is deactivated or removed
 * (PRD-3 §5.3).
 *
 * The bug this prevents: the deactivate cascade used to flip only
 * `designSettingsJson.templateId` to `"default"`, leaving `params`,
 * `templateVersion` and `templateApiVersion` from the REMOVED template behind.
 * The `default` template then rendered with foreign params (and a stale version
 * snapshot), and authors had to manually reset the test before a freshly
 * re-uploaded template under the same id was picked up cleanly.
 *
 * {@link rebindToDefault} produces a slepok that is consistent with `default`:
 * it keeps only the params whose keys still exist in `default`'s manifest (the
 * honest reading of §5.3 "compatible params preserved") and re-stamps the
 * version fields to `default`'s. Pure — no DB, no DOM — so it is trivially
 * unit-testable and can be reused by every code path that repoints tests to
 * `default` (the deactivate route, the startup reconcile).
 */

/** Minimal shape of a test's `designSettingsJson` slepok. */
export interface DesignSlepok {
  templateId?: string;
  templateVersion?: string;
  templateApiVersion?: string;
  params?: Record<string, unknown>;
  /** Forward-compatible: preserve any other persisted keys untouched. */
  [key: string]: unknown;
}

/** The `default` template facts needed to build a consistent slepok. */
export interface DefaultTemplateInfo {
  /** `default.version` to stamp into the slepok (null falls back to the prior value). */
  version?: string | null;
  /** `default.templateApiVersion` to stamp (null falls back to the prior value). */
  templateApiVersion?: string | null;
  /** The param keys declared by `default`'s manifest — params outside this set are dropped. */
  paramKeys: string[];
}

export const DEFAULT_TEMPLATE_ID = "default";

/**
 * Rebinds a design slepok to the `default` template, dropping params that no
 * longer map to a `default` manifest key and re-stamping the version fields.
 * Always returns a fresh object; never mutates `prev`.
 */
export function rebindToDefault(
  prev: DesignSlepok | null | undefined,
  def: DefaultTemplateInfo,
): DesignSlepok {
  const prevParams = (prev?.params ?? {}) as Record<string, unknown>;
  const allowed = new Set(def.paramKeys);
  const params: Record<string, unknown> = {};
  for (const key of Object.keys(prevParams)) {
    if (allowed.has(key)) params[key] = prevParams[key];
  }
  return {
    ...(prev ?? {}),
    templateId: DEFAULT_TEMPLATE_ID,
    templateVersion: def.version ?? prev?.templateVersion,
    templateApiVersion: def.templateApiVersion ?? prev?.templateApiVersion,
    params,
  };
}

/** Extracts the param keys declared by a template manifest (tolerant of shape). */
export function manifestParamKeys(manifest: unknown): string[] {
  const params = (manifest as { params?: unknown } | null | undefined)?.params;
  if (!Array.isArray(params)) return [];
  return params
    .map((p) => (p && typeof p === "object" ? (p as { key?: unknown }).key : undefined))
    .filter((k): k is string => typeof k === "string");
}
