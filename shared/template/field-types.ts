/**
 * @module shared/template/field-types
 *
 * The SINGLE registry of field types a design template may declare (PRD-22).
 *
 * A variant declares two kinds of fields, split by nature:
 *   - `placeholders[]` — CONTENT the layout renders into `[data-placeholder]`
 *     regions;
 *   - `settings[]` — PROPERTIES of the page: they drive behaviour and styling and
 *     never end up in the layout as content.
 *
 * Both lists are closed: a type outside this registry is a template error, not a
 * silently degraded field. Before this module the accepted types lived in two
 * independent `switch` statements — the editor control and the renderer — plus
 * prose in the spec, and nothing validated the manifest at all. The two had
 * already drifted (`select` had an editor control but no render rule), and a typo
 * such as `richtext` produced a single-line input with no diagnostic anywhere.
 *
 * Consumers derive their behaviour from here:
 *   - the manifest validator checks declared types and their attributes;
 *   - the editor maps every type to a control (exhaustively, so a missing control
 *     is a compile error);
 *   - the renderer maps every content type to a render rule.
 *
 * Framework-free and browser-safe: bundled verbatim into the SCORM package.
 */

/** Content field types — values rendered into the layout. */
export const PLACEHOLDER_TYPES = [
  "text",
  "textarea",
  "richText",
  "html",
  "image",
  "resultField",
] as const;

export type PlaceholderType = (typeof PLACEHOLDER_TYPES)[number];

/** Page-property field types — values that drive behaviour, never rendered as content. */
export const SETTING_TYPES = [
  "number",
  "boolean",
  "select",
  "text",
  "image",
  /** Identifier of a page sequence; drives the navigation indicator (PRD-22). */
  "sequence",
  /**
   * Per-scale look for the rose — colour and pictogram, as a MAP keyed by scale key
   * (PRD-46 §7, `shared/template/scale-appearance`).
   *
   * A type of its own rather than a generic «object» one: the control is not a text box over
   * JSON but a row per scale of the test, and the registry exists precisely so a field the
   * editor cannot draw is a template error instead of a silently degraded input.
   */
  "scaleAppearance",
] as const;

export type SettingType = (typeof SETTING_TYPES)[number];

/** Text-entry modes a content field may offer (PRD-22 FR-32). */
export const INPUT_MODES = ["plain", "rich", "html"] as const;

export type InputMode = (typeof INPUT_MODES)[number];

/**
 * Modes each content type allows, in ascending order of freedom. The declared
 * type is the CEILING: the author may drop to a simpler mode but never rise
 * above it, so a template that asks for plain text can never receive markup.
 * Types absent from this map take no free-form author input at all.
 */
export const MODES_BY_PLACEHOLDER_TYPE: Partial<Record<PlaceholderType, readonly InputMode[]>> = {
  text: ["plain"],
  textarea: ["plain"],
  richText: ["plain", "rich"],
  html: ["plain", "rich", "html"],
};

export function isPlaceholderType(value: unknown): value is PlaceholderType {
  return typeof value === "string" && (PLACEHOLDER_TYPES as readonly string[]).indexOf(value) !== -1;
}

export function isSettingType(value: unknown): value is SettingType {
  return typeof value === "string" && (SETTING_TYPES as readonly string[]).indexOf(value) !== -1;
}

/** Entry modes offered for a content field of `type` (empty when it takes none). */
export function inputModesFor(type: PlaceholderType): readonly InputMode[] {
  return MODES_BY_PLACEHOLDER_TYPE[type] ?? [];
}

/** One problem found in a declared field. `field` is the declared key, if any. */
export interface FieldTypeIssue {
  /** `placeholders` | `settings` — which list the field came from. */
  list: "placeholders" | "settings";
  field: string;
  message: string;
}

interface DeclaredField {
  key?: unknown;
  type?: unknown;
  options?: unknown;
  default?: unknown;
}

/** Human-readable key for diagnostics when the declaration has no usable `key`. */
function fieldLabel(field: DeclaredField, index: number): string {
  return typeof field.key === "string" && field.key.length > 0 ? field.key : `#${index + 1}`;
}

/**
 * Validates one variant's field declarations against the registry.
 *
 * Checks the type itself and the attributes that type requires — `select` without
 * choices is the case that used to pass validation and then render an empty
 * dropdown for the author.
 */
export function validateVariantFields(variant: {
  placeholders?: unknown;
  settings?: unknown;
}): FieldTypeIssue[] {
  const issues: FieldTypeIssue[] = [];

  const check = (
    list: "placeholders" | "settings",
    raw: unknown,
    isValidType: (v: unknown) => boolean,
    allowed: readonly string[],
  ): void => {
    if (raw === undefined || raw === null) return;
    if (!Array.isArray(raw)) {
      issues.push({ list, field: "", message: `${list} должен быть массивом` });
      return;
    }
    raw.forEach((entry, index) => {
      const field = (entry ?? {}) as DeclaredField;
      const label = fieldLabel(field, index);
      if (!isValidType(field.type)) {
        issues.push({
          list,
          field: label,
          message:
            `неизвестный тип "${String(field.type)}"; допустимы: ${allowed.join(", ")}`,
        });
        return;
      }
      if (field.type === "select") {
        const options = field.options;
        if (!Array.isArray(options) || options.length === 0) {
          issues.push({ list, field: label, message: 'тип "select" требует непустой список options' });
        }
      }
    });
  };

  check("placeholders", variant.placeholders, isPlaceholderType, PLACEHOLDER_TYPES);
  check("settings", variant.settings, isSettingType, SETTING_TYPES);

  return issues;
}
