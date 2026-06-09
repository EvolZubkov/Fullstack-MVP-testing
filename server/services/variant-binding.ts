/**
 * @module server/services/variant-binding
 * @description Silent variant binding for system variant kinds (PRD-1 §4.3.2,
 * PRD-7 §1.4). Pure functions — no DB, no I/O. Called from the test settings
 * service when a system page (`questions` / `router` / `summary` / `intro`)
 * needs a variant key assigned automatically.
 *
 * Binding rules per number of variants of the requested `kind` in the template:
 *   - 1 variant  → bind silently
 *   - N > 1      → bind isDefault (or first) + signal `hasMultipleChoices`
 *   - 0          → fall back to the same kind in the default template + signal `fallbackUsed`
 *
 * If even the default template lacks the requested kind, returns `null` so the
 * caller can surface this as a hard configuration error.
 */
import type {
  TemplateManifest,
  VariantKind,
} from "@shared/schema";

/** A single contentTemplate entry from the parsed manifest. */
export interface VariantEntry {
  key: string;
  label: string;
  kind: VariantKind;
  isDefault?: boolean;
  /** Other fields (placeholders, pageKind, textFit, …) preserved via passthrough. */
  [extra: string]: unknown;
}

/** Result of a system-variant binding attempt for one (template, kind) pair. */
export interface VariantBindingResult {
  /** `contentTemplates[].key` of the variant that should be persisted. */
  variantKey: string;
  /** "template" — found in the test's own template; "default-fallback" — taken from the default template. */
  source: "template" | "default-fallback";
  /** True when the test's template has more than one variant of this kind (UI hint). */
  hasMultipleChoices: boolean;
  /** True when `source === "default-fallback"` — the test's template lacked this kind. */
  fallbackUsed: boolean;
}

/**
 * Returns every contentTemplate entry of the given kind in the manifest, in
 * declared order. Empty array if the manifest has no entry of this kind.
 */
export function findVariantsByKind(manifest: TemplateManifest, kind: VariantKind): VariantEntry[] {
  return (manifest.contentTemplates as VariantEntry[]).filter((ct) => ct.kind === kind);
}

/**
 * Picks the default variant from a non-empty list: the first entry with
 * `isDefault: true`, falling back to the first entry in declared order.
 * Returns `null` for an empty input — callers should check `length > 0` first.
 */
export function selectDefaultVariant(variants: VariantEntry[]): VariantEntry | null {
  if (variants.length === 0) return null;
  return variants.find((v) => v.isDefault === true) ?? variants[0];
}

/**
 * Resolves a variant key for a system kind, applying the silent-binding rules
 * from PRD-1 §4.3.2. `defaultManifest` is consulted only when the test's own
 * template (`manifest`) has zero variants of the requested kind.
 *
 * Returns `null` only when both the test's template and the default template
 * lack any variant of the requested kind — the caller decides whether this is
 * a hard error (e.g., for `questions` it should not happen because the default
 * template is required to declare one — see `defaultTemplateManifestSchema`).
 */
export function bindSystemVariant(
  manifest: TemplateManifest,
  defaultManifest: TemplateManifest,
  kind: VariantKind,
): VariantBindingResult | null {
  const own = findVariantsByKind(manifest, kind);

  if (own.length > 0) {
    const picked = selectDefaultVariant(own)!;
    return {
      variantKey: picked.key,
      source: "template",
      hasMultipleChoices: own.length > 1,
      fallbackUsed: false,
    };
  }

  const fallback = findVariantsByKind(defaultManifest, kind);
  if (fallback.length === 0) return null;

  const picked = selectDefaultVariant(fallback)!;
  return {
    variantKey: picked.key,
    source: "default-fallback",
    hasMultipleChoices: false,
    fallbackUsed: true,
  };
}
