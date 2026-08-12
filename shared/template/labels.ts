/**
 * @module shared/template/labels
 *
 * Resolves the interface labels of the results screens (PRD-49).
 *
 * A label is a named string the TEMPLATE declares with a default text and the TEST may
 * reword or switch off. Three states have to stay distinguishable — untouched, reworded,
 * switched off — so a stored value is a record with a switch, never a bare string: an
 * empty string would be indistinguishable from «I never opened this field».
 *
 * Pure — no DOM, no Node.
 */

/** Screens a label can carry a distinct default for. */
export type LabelScreen = "results" | "results.adaptive" | "section-results" | "report";

/** A label as the template manifest declares it (`manifest.labels[]`). */
export interface LabelDeclaration {
  key: string;
  /** Grouping in the editor: fifteen fields in one flat list are unreadable. */
  group: string;
  /** Field caption shown to the author. */
  label: string;
  /** Text used when the test stored nothing. Required by the manifest check. */
  default: string;
  /** Per-screen defaults, for the screens whose wording differs from the shared one. */
  defaults?: Partial<Record<LabelScreen, string>>;
}

/** What the test stores for a label. Absent key = the template default stands. */
export interface LabelValue {
  on?: boolean;
  text?: string;
}

export type LabelValues = Record<string, LabelValue>;

/** Effective texts by key. An empty string means «do not print this label». */
export type ResolvedLabels = Record<string, string>;

function pick(decl: LabelDeclaration, screen: LabelScreen): string {
  return decl.defaults?.[screen] ?? decl.default;
}

/**
 * One layer of author values over the template default. Returns `null` when the layer
 * says nothing about this label, so the caller can fall through to the layer below.
 */
function applyLayer(value: LabelValue | undefined, fallback: string): string | null {
  if (!value) return null;
  if (value.on === false) return "";
  // A cleared field is NOT «no label»: switching off is what the toggle is for. Falling
  // back to the template text also keeps a test following the template's later edits.
  const text = (value.text ?? "").trim();
  return text ? text : fallback;
}

/** Named-parameter input for {@link resolveLabels} — `values` and `overrides` share a
 * type and sit next to each other conceptually, so a positional signature would let a
 * transposed call slip past the compiler unnoticed. */
export interface ResolveLabelsInput {
  declarations: readonly LabelDeclaration[];
  /** What the test stores for every screen. */
  values: LabelValues;
  /** The rendering screen's own layer; absent for a screen that has none. */
  overrides?: LabelValues;
  screen: LabelScreen;
}

/**
 * Effective label texts for one screen: template default, the test's shared values on top,
 * then the CALLER's own override layer on top of those. `overrides` belongs to whichever
 * screen is being rendered, not to any particular screen by name — the resolver has no
 * opinion on who gets to override. Today only the report screen fills this layer
 * (`report_settings_json.labels`); every other caller simply omits `overrides` and gets the
 * shared wording. Keys the template does not declare are dropped — the test may have been
 * moved to another template.
 */
export function resolveLabels({
  declarations,
  values,
  overrides = {},
  screen,
}: ResolveLabelsInput): ResolvedLabels {
  const out: ResolvedLabels = {};
  for (const decl of declarations) {
    const fallback = pick(decl, screen);
    const shared = applyLayer(values[decl.key], fallback);
    const own = applyLayer(overrides[decl.key], shared ?? fallback);
    out[decl.key] = own ?? shared ?? fallback;
  }
  return out;
}

/**
 * Turns the flat map into the nested object the DSL addresses: `resolvePath` splits a
 * template path on dots, so `labels["results.scales"]` would never be reachable from
 * `{{ labels.results.scales }}`.
 *
 * Invariant: keys must not be mutual prefixes (e.g. `"results"` and `"results.heading"`
 * together). A prefix key would need to hold both a string leaf and a nested object at the
 * same path, and whichever is written second silently overwrites the first — a real label
 * would vanish from the tree with no error. The manifest never declares such a pair today,
 * but this function is generic, so the collision is rejected explicitly instead of trusting
 * every future caller to avoid it.
 */
export function labelsTree(labels: ResolvedLabels): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, text] of Object.entries(labels)) {
    const parts = key.split(".");
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      const existing = node[part];
      if (typeof existing === "string") {
        throw new Error(
          `labelsTree: key "${parts.slice(0, i + 1).join(".")}" collides with key "${key}" — keys must not be mutual prefixes`,
        );
      }
      if (typeof existing !== "object" || existing === null) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    const leaf = parts[parts.length - 1];
    if (typeof node[leaf] === "object" && node[leaf] !== null) {
      throw new Error(`labelsTree: key "${key}" collides with a longer key under the same prefix — keys must not be mutual prefixes`);
    }
    node[leaf] = text;
  }
  return root;
}
