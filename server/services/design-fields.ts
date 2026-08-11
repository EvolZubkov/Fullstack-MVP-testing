/**
 * @module server/services/design-fields
 * @description The normalisation rules for a test's DESIGN parameters and for the field
 * values of its report — the single place they exist.
 *
 * Nothing in the product typed these values before. `PUT /api/tests/:id/design` checks the
 * SET of keys against `manifest.params[]` and stores whatever came with them, because its
 * only caller is the editor, whose controls already produce a boolean for a switch, a number
 * for a spinner and a `{url, name}` envelope for an upload. The Excel workbook has no
 * controls: every cell arrives as a string, and stored unchecked it would paint a design in
 * which `showProgressBar` is the string `"false"` — truthy — and a logo is a bare URL nothing
 * knows how to render. Report values were never checked by anyone at all (PRD-48 Э5 plan,
 * ограничение 7): `resolveReportVariant` answers an unknown variant key with the default
 * variant and no diagnostic, so a workbook could «successfully» transfer a report and hand
 * the learner a document of another kind.
 *
 * The module is PURE: a manifest in, values out. It does not read the database, does not
 * decide whether the receiving template is installed and active (the caller does that — a
 * missing template rejects the whole sheet, see the plan) and never speaks HTTP. Errors come
 * back as text in `errors`.
 *
 * Contract of a call:
 * - `errors` — a value that cannot be brought to the type its manifest declares. The offending
 *   KEY is skipped and the rest is applied, the way a bad row on a sheet is dropped while the
 *   sheet is applied;
 * - `dropped` — keys the receiving manifest does not declare. Dropped rather than stored,
 *   because the design route answers an undeclared key with a 422 for the WHOLE request; and
 *   named rather than swallowed, because otherwise the author reads «оформление перенесено»
 *   with half the settings missing.
 *
 * Deliberate difference from {@link import("./content-page-fields").normalizeSettingsForTemplate},
 * whose shape this module otherwise follows: a `select` outside its options and a
 * non-numeric `number` are ERRORS here rather than silent drops. A page setting is edited in
 * a form where the wrong value cannot be typed; these values are typed by hand into a cell,
 * and the workbook's rule is that a transfer never loses anything quietly.
 */
import { reportKindForMode, reportVariants, type ReportVariantDecl } from "@shared/report/report-variants";
import { colorParamKeys } from "@shared/template/theme-params";
import { declaredThemes, isTestTheme, supportsThemes, type TestTheme } from "@shared/template/themes";

/** One `manifest.params[]` declaration, as much of it as typing a value needs. */
export interface DesignParamDef {
  key: string;
  type?: string;
  options?: string[];
  /** Human labels of `options`; accepted on input so a hand-filled cell also loads. */
  optionLabels?: Record<string, string>;
  default?: unknown;
}

/** Design values as they arrive from the workbook: every value still untyped. */
export interface DesignInput {
  theme?: unknown;
  params?: Record<string, unknown>;
  paramsByTheme?: Record<string, Record<string, unknown>>;
}

/** Design values brought to the types the manifest declares. */
export interface NormalizedDesign {
  /** Palette to pin; `undefined` = nothing to pin (or the template offers no choice). */
  theme?: TestTheme;
  params: Record<string, unknown>;
  paramsByTheme: Record<string, Record<string, unknown>>;
  /** Keys the manifest does not declare. The caller warns about them. */
  dropped: string[];
  errors: string[];
}

/** One report branch as it arrives from the workbook. */
export interface ReportBranchInput {
  variantKey?: string;
  values?: Record<string, unknown>;
}

/** A report branch brought to the types the chosen variant declares. */
export interface NormalizedReportBranch {
  /**
   * The branch to store, or `undefined` when it cannot be applied at all — the receiving
   * manifest declares no such variant. The branch is refused rather than quietly re-pointed
   * at the default: that substitution is exactly the product behaviour the workbook must not
   * inherit (plan, ограничение 7).
   */
  branch?: { variantKey?: string; values: Record<string, unknown> };
  dropped: string[];
  errors: string[];
}

/** Media-typed params: all four store the same envelope (PRD-7 S12-G4). */
const MEDIA_TYPES = new Set(["image", "asset", "file", "downloadLink"]);

/** Fields of the media envelope that are carried over; anything else is not stored. */
const MEDIA_FIELDS = ["url", "name", "mime", "size", "mediaId", "label"] as const;

/** Types whose empty value is a MEANINGFUL empty string rather than «nothing was set». */
const EMPTY_MEANS_VALUE = new Set(["text", "url", "color"]);

const TRUE_WORDS = new Set(["true", "да", "1", "yes"]);
const FALSE_WORDS = new Set(["false", "нет", "0", "no"]);

/** A `jsonb`-ish value as a map, safe against `null`, an array and a foreign shape. */
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Declarations by key, ignoring entries without a usable key. */
function byKey(defs: readonly DesignParamDef[] | undefined): Map<string, DesignParamDef> {
  const out = new Map<string, DesignParamDef>();
  for (const def of defs ?? []) {
    if (def && typeof def.key === "string" && def.key !== "") out.set(def.key, def);
  }
  return out;
}

/** `manifest.params[]`, defensively — the manifest is `jsonb` and may be anything. */
function manifestParams(manifest: unknown): DesignParamDef[] {
  const raw = (manifest as { params?: unknown } | null)?.params;
  return Array.isArray(raw) ? (raw as DesignParamDef[]) : [];
}

/** Is the value «nothing was written here»? */
function isEmpty(raw: unknown): boolean {
  return raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
}

/** File name from a URL, so an envelope built from a bare address still has a caption. */
function nameFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0];
  const last = path.split("/").filter(Boolean).pop() ?? "";
  return last;
}

/** The media envelope: only the declared fields, and only when there is an address. */
function coerceMedia(raw: unknown): { value: unknown } | { error: string } {
  if (typeof raw === "string") {
    const url = raw.trim();
    return { value: { url, name: nameFromUrl(url) } };
  }
  const source = record(raw);
  const url = source.url;
  if (typeof url !== "string" || url.trim() === "") {
    return { error: "ожидается адрес файла или конверт вида {\"url\": \"…\", \"name\": \"…\"}" };
  }
  const out: Record<string, unknown> = {};
  for (const field of MEDIA_FIELDS) {
    const value = source[field];
    if (value !== undefined && value !== null) out[field] = value;
  }
  if (typeof out.name !== "string" || out.name === "") out.name = nameFromUrl(url);
  return { value: out };
}

/** One option value: itself, or the human label the manifest gives it. */
function optionFor(def: DesignParamDef, raw: string): string | undefined {
  const options = Array.isArray(def.options) ? def.options.map(String) : [];
  if (options.length === 0) return raw;
  if (options.includes(raw)) return raw;
  const labels = record(def.optionLabels);
  for (const [value, label] of Object.entries(labels)) {
    if (String(label) === raw && options.includes(value)) return value;
  }
  return undefined;
}

/**
 * One value brought to the type the declaration names.
 *
 * A type the registry does not know is passed through unchanged: the manifest validator
 * already refuses unknown types at activation, and guessing here would be a second, weaker
 * opinion about what a template may declare.
 *
 * @param def The `params[]` / `settings[]` declaration.
 * @param raw The value as the workbook read it — a string, or an object/array the cell
 *   carried as JSON.
 */
function coerceValue(def: DesignParamDef, raw: unknown): { value: unknown } | { error: string } {
  const type = typeof def.type === "string" ? def.type : "";

  if (type === "boolean") {
    if (typeof raw === "boolean") return { value: raw };
    const word = String(raw).trim().toLowerCase();
    if (TRUE_WORDS.has(word)) return { value: true };
    if (FALSE_WORDS.has(word)) return { value: false };
    return { error: `ожидается «Да» или «Нет» (true/false), получено "${String(raw)}"` };
  }

  if (type === "number") {
    const n = typeof raw === "number" ? raw : Number(String(raw).trim().replace(",", "."));
    if (!Number.isFinite(n)) return { error: `ожидается число, получено "${String(raw)}"` };
    return { value: n };
  }

  if (type === "select") {
    const chosen = optionFor(def, String(raw).trim());
    if (chosen === undefined) {
      return { error: `значение "${String(raw)}" не объявлено шаблоном; допустимы: ${(def.options ?? []).join(", ")}` };
    }
    return { value: chosen };
  }

  if (type === "multiselect") {
    // A cell may carry the value either as JSON (`["a","b"]`, decoded by the sheet) or as
    // the list a human types; both mean the same set.
    const list = Array.isArray(raw)
      ? raw.map((v) => String(v).trim())
      : String(raw).split(/[,;]/).map((v) => v.trim());
    const items = list.filter((v) => v !== "");
    const out: string[] = [];
    for (const item of items) {
      const chosen = optionFor(def, item);
      if (chosen === undefined) {
        return { error: `значение "${item}" не объявлено шаблоном; допустимы: ${(def.options ?? []).join(", ")}` };
      }
      out.push(chosen);
    }
    return { value: out };
  }

  if (type === "color") {
    if (typeof raw !== "string") return { error: `ожидается цвет строкой, получено "${String(raw)}"` };
    return { value: raw.trim() };
  }

  if (MEDIA_TYPES.has(type)) return coerceMedia(raw);

  if (type === "scaleAppearance") {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { error: `ожидается объект вида {"<шкала>": {…}}, получено "${String(raw)}"` };
    }
    return { value: raw };
  }

  if (type === "text" || type === "url" || type === "sequence") return { value: String(raw) };

  return { value: raw };
}

/**
 * Apply one map of values against one set of declarations.
 *
 * @param source Incoming values.
 * @param defs Declarations by key.
 * @param where Prefix of an error message, naming the owner of the values.
 * @param keepEmpty Whether an empty value is stored as an empty string. False for design
 *   params, where the ABSENCE of a key means «the template's own value applies» — exactly
 *   what the editor stores when the author clears an override, so storing `""` there would
 *   pin a blank colour instead of releasing it.
 * @param out Collected result.
 */
function applyValues(
  source: Record<string, unknown>,
  defs: Map<string, DesignParamDef>,
  where: string,
  keepEmpty: boolean,
  out: { values: Record<string, unknown>; dropped: string[]; errors: string[] },
): void {
  for (const [key, raw] of Object.entries(source)) {
    const def = defs.get(key);
    if (!def) {
      out.dropped.push(key);
      continue;
    }
    if (isEmpty(raw)) {
      if (keepEmpty && EMPTY_MEANS_VALUE.has(String(def.type))) out.values[key] = "";
      continue;
    }
    const result = coerceValue(def, raw);
    if ("error" in result) {
      out.errors.push(`${where}, «${key}»: ${result.error}`);
      continue;
    }
    out.values[key] = result.value;
  }
}

/**
 * Bring design parameters to the types the RECEIVING manifest declares.
 *
 * Repeats the checks `PUT /api/tests/:id/design` performs, because the workbook import does
 * not go to itself over HTTP and a second, looser copy of them is how the workbook would
 * become a way past the route: per-palette overrides are accepted only from a template that
 * declares palettes, only for palettes it declares, and only for parameters of type `color`
 * — every other parameter paints the same in both palettes, and a per-palette value for one
 * would be a value nothing ever reads.
 *
 * @param input Values as the «Оформление» sheet read them.
 * @param manifest The receiving template's manifest.
 */
export function normalizeDesignParams(input: DesignInput, manifest: unknown): NormalizedDesign {
  const defs = byKey(manifestParams(manifest));
  const out: NormalizedDesign = { params: {}, paramsByTheme: {}, dropped: [], errors: [] };
  const flat = { values: out.params, dropped: out.dropped, errors: out.errors };

  applyValues(record(input.params), defs, "Оформление", false, flat);

  const themed = supportsThemes(manifest);
  const themeIds = new Set<string>(declaredThemes(manifest).map((t) => t.id));
  const colors = colorParamKeys(manifestParams(manifest));
  const templateId = String((manifest as { id?: unknown } | null)?.id ?? "");

  if (input.theme !== undefined) {
    if (!isTestTheme(input.theme)) {
      out.errors.push(`Оформление, «Тема теста»: неизвестная палитра "${String(input.theme)}"`);
    } else if (!themed) {
      // Not an error when it is «Авто»: that is what a themeless test always was.
      if (input.theme !== "auto") {
        out.errors.push(`Оформление, «Тема теста»: шаблон «${templateId}» палитр не объявляет`);
      }
    } else {
      out.theme = input.theme;
    }
  }

  for (const [themeId, values] of Object.entries(record(input.paramsByTheme))) {
    if (!themed) {
      out.errors.push(
        `Оформление, палитра «${themeId}»: шаблон «${templateId}» палитр не объявляет, `
        + "переопределять по палитре нечего",
      );
      continue;
    }
    if (!themeIds.has(themeId)) {
      out.errors.push(
        `Оформление, палитра «${themeId}»: шаблон «${templateId}» её не объявляет; `
        + `объявлены: ${[...themeIds].join(", ")}`,
      );
      continue;
    }
    // A declared NON-colour key is an error rather than a drop: it names a parameter the
    // template really has, and the author has to learn that this one does not split per
    // palette. An UNDECLARED key falls through to the common pass and is dropped there.
    const colourOnly: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(record(values))) {
      if (defs.has(key) && !colors.has(key)) {
        out.errors.push(`Оформление, палитра «${themeId}», «${key}»: по палитре настраивается только цвет`);
        continue;
      }
      colourOnly[key] = raw;
    }
    const bucket: Record<string, unknown> = {};
    applyValues(colourOnly, defs, `Оформление, палитра «${themeId}»`, false, {
      values: bucket,
      dropped: out.dropped,
      errors: out.errors,
    });
    if (Object.keys(bucket).length > 0) out.paramsByTheme[themeId] = bucket;
  }

  out.dropped = [...new Set(out.dropped)];
  return out;
}

/**
 * Bring one report branch to the variant the RECEIVING manifest declares.
 *
 * A branch that names NO variant is legal and stays that way: settings saved before PRD-35
 * look exactly like that, and filling in the receiver's default would pin a variant the
 * author never chose (the receiver's default may not be the source's). Its values are still
 * typed — against the variant that will actually render them, which is the one
 * `resolveReportVariant` picks for a branch without a key.
 *
 * @param input The branch as the «Оформление» sheet read it.
 * @param manifest The receiving template's manifest.
 * @param mode Test mode the branch belongs to; it picks the report KIND.
 */
export function normalizeReportBranch(
  input: ReportBranchInput | undefined,
  manifest: unknown,
  mode: "standard" | "adaptive",
): NormalizedReportBranch {
  const out: NormalizedReportBranch = { dropped: [], errors: [] };
  if (!input) return out;

  const kind = reportKindForMode(mode);
  const declared = reportVariants(manifest, kind);
  const modeLabel = mode === "adaptive" ? "Адаптивный" : "Стандартный";

  let variant: ReportVariantDecl | null = null;
  if (input.variantKey) {
    variant = declared.find((v) => v.key === input.variantKey) ?? null;
    if (!variant) {
      out.errors.push(
        `Отчёт («${modeLabel}»), «Вид отчёта»: шаблон не объявляет вида "${input.variantKey}"`
        + (declared.length > 0 ? `; объявлены: ${declared.map((v) => v.key).join(", ")}` : ""),
      );
      return out;
    }
  } else {
    // No key: the values are typed against the variant the host will actually use.
    variant = declared.find((v) => v.isDefault === true) ?? declared[0] ?? null;
  }

  const defs = byKey(Array.isArray(variant?.settings) ? (variant?.settings as DesignParamDef[]) : []);
  const values: Record<string, unknown> = {};
  applyValues(record(input.values), defs, `Отчёт («${modeLabel}»)`, true, {
    values,
    dropped: out.dropped,
    errors: out.errors,
  });

  out.branch = { variantKey: input.variantKey || undefined, values };
  return out;
}
