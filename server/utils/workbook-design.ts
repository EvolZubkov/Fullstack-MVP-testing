/**
 * @module server/utils/workbook-design
 * @description The «Оформление» sheet of the test workbook (PRD-48 Э5, FR-17/FR-18): ONE
 * contract read by both the export and the import.
 *
 * Design and report live on ONE sheet because they are one subject: both describe how the
 * test LOOKS, and both are typed by the same template manifest. Five columns carry four
 * kinds of statement, told apart by «Что»:
 *
 * - `Шаблон` — `designSettingsJson.templateId`. The template itself is NOT carried by the
 *   workbook (it is installed as a ZIP through the admin registry), and neither are
 *   `templateVersion` / `templateApiVersion`: a version from the SOURCE stand would raise the
 *   «Шаблон обновлён» banner on the receiver, whose one button drops every parameter the new
 *   manifest no longer declares. The server stamps both itself;
 * - `Тема теста` — the palette pinned by the author (PRD-23), or «Авто» when it is the
 *   viewer's choice;
 * - `Параметр` — one manifest parameter. An empty «Тема» puts it flat into `params`; a filled
 *   one puts it into `paramsByTheme[<палитра>]`. Both forms exist in the model and which one
 *   a value sits in depends on the test's edit history, so the sheet writes back the form the
 *   source had — inventing the other one would either duplicate the colour or lose it;
 * - `Отчёт` — `reportSettingsJson`. «Выдавать отчёт» is COMMON (it has no «Режим»), while the
 *   chosen variant and its field values belong to a mode BRANCH. Both branches travel
 *   regardless of the test's current mode: the inactive branch is kept on purpose so the
 *   setting is not lost when the mode is switched back.
 *
 * What this module does NOT do, and must not start doing:
 * - it does not know the MANIFEST, so it neither filters keys nor types values. A parameter
 *   the receiving template never declared travels through here as itself, and every value is
 *   a string (or a decoded object) until someone checks it against the manifest. That someone
 *   is {@link import("../services/design-fields")}, called by the import — the workbook must
 *   not become an entry point past the checks the design route performs;
 * - it does not resolve a report branch that names no variant. A branch WITHOUT `variantKey`
 *   is legal (settings saved before PRD-35 look exactly like that) and must survive the round
 *   trip as it is: filling in the receiver's default would silently pin a variant the author
 *   never chose.
 *
 * Cell rules:
 * - «Значение» is TEXT, encoded by {@link encodeFieldValue}: a scalar keeps its literal
 *   spelling (`5`, `true`) because that is what the manifest coercion reads back, and a
 *   structured value — a media envelope, a `multiselect` array — travels as compact JSON and
 *   is decoded back into an object, so the round trip does not flatten it into a string;
 * - a `null` value is NOT written. In this model an absent parameter means «the template's
 *   own value applies» — that is exactly what the editor stores when the author clears an
 *   override — so a row saying «nothing» would only be noise;
 * - «Выдавать отчёт» has THREE states: «Да», «Нет» and empty. Empty means «оставить как
 *   есть», because the ABSENCE of the setting means «выдавать» (PRD-27 §7.1) and reading an
 *   empty cell as «выключено» would take the report away from every test whose author never
 *   touched the switch.
 */
import { isReportEnabled, type ReportSettings } from "@shared/schema";
import { isTestTheme, type TestTheme } from "@shared/template/themes";
import {
  MODE_LABELS,
  byLabelOrValue,
  cleanCell,
  decodeFieldValue,
  encodeFieldValue,
  normalizeCell,
} from "./workbook-settings";

/** Sheet name, as the workbook writes it and the import looks it up. */
export const DESIGN_SHEET_NAME = "Оформление";

export const DESIGN_HEADERS = ["Что", "Режим", "Тема", "Ключ", "Значение"];
export const DESIGN_WIDTHS = [16, 16, 16, 34, 60];

/** Column keys, taken from the headers so a rename lands in one place. */
const [DS_WHAT, DS_MODE, DS_THEME, DS_KEY, DS_VALUE] = DESIGN_HEADERS;

const YES = "Да";
const NO = "Нет";

// ─── Value dictionaries ──────────────────────────────────────────────────────

/** «Что» — the kind of statement a row makes. */
const WHAT_TO = {
  template: "Шаблон",
  theme: "Тема теста",
  param: "Параметр",
  report: "Отчёт",
} as const;

type DesignWhat = keyof typeof WHAT_TO;

/**
 * «Тема теста» and the «Тема» column. `auto` is a valid CHOICE of the test but not a palette:
 * a parameter cannot be overridden «for auto», and the column rejects it.
 */
const THEME_TO: Record<TestTheme, string> = {
  light: "Светлая",
  dark: "Тёмная",
  auto: "Авто",
};

/** Report mode branches — the keys of `report_settings_json`, not manifest kinds. */
export type ReportMode = keyof typeof MODE_LABELS;

/** «Ключ» of the two report rows that are not manifest fields. */
export const REPORT_VARIANT_KEY = "Вид отчёта";
export const REPORT_ENABLED_KEY = "Выдавать отчёт";

/** Values of the closed columns — the workbook template turns them into drop-downs. */
export const DESIGN_WHAT_CHOICES = Object.values(WHAT_TO);
export const DESIGN_MODE_CHOICES = Object.values(MODE_LABELS);
export const DESIGN_THEME_CHOICES = Object.values(THEME_TO);
/** Palettes only: «Авто» is the absence of a palette and cannot scope an override. */
export const DESIGN_PALETTE_CHOICES = [THEME_TO.light, THEME_TO.dark];

// ─── Shapes ──────────────────────────────────────────────────────────────────

/**
 * Export input: `tests.design_settings_json` as stored. Deliberately loose — the column is
 * `jsonb`, and rows written by older versions carry other shapes there.
 */
export interface DesignSource {
  templateId?: unknown;
  theme?: unknown;
  params?: unknown;
  paramsByTheme?: unknown;
}

/** Export input: `tests.report_settings_json` as stored, equally loose. */
export interface ReportSource {
  enabled?: unknown;
  standard?: unknown;
  adaptive?: unknown;
}

/** One mode branch of the report as the sheet describes it. */
export interface ParsedReportBranch {
  /**
   * Variant chosen by the author. `undefined` = the branch names no variant — a legal state
   * the import must NOT fill in (see the module note).
   */
  variantKey?: string;
  /** Values of the variant's `settings[]`, untyped: the manifest is not read here. */
  values: Record<string, unknown>;
}

/** Result of reading the sheet. */
export interface ParsedDesignSheet {
  /** `undefined` = the sheet named no template, so there is no design to apply. */
  templateId?: string;
  /** `undefined` = the sheet named no palette, so the test keeps whatever it has. */
  theme?: TestTheme;
  /** Flat parameter values, keyed by manifest key. */
  params: Record<string, unknown>;
  /** Per-palette overrides, keyed by palette id then by manifest key. */
  paramsByTheme: Record<string, Record<string, unknown>>;
  /** «Выдавать отчёт»; `undefined` = the cell was empty, so the setting is left as is. */
  reportEnabled?: boolean;
  /** Mode branches named by the sheet; an absent branch is not touched by the import. */
  report: Partial<Record<ReportMode, ParsedReportBranch>>;
  errors: string[];
}

// ─── Export ──────────────────────────────────────────────────────────────────

/** A branch of a `jsonb` column as a map, safe against `null` and against a foreign shape. */
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A palette id as a cell: its label when known, the stored id otherwise. */
function themeLabel(id: string): string {
  return Object.prototype.hasOwnProperty.call(THEME_TO, id) ? THEME_TO[id as TestTheme] : id;
}

/**
 * Export of the «Оформление» sheet: the design first, then the report.
 *
 * Design rows are written only when the source names a TEMPLATE. Parameters typed by a
 * manifest are meaningless without the template that declares them, and the import cannot
 * apply a single one of them without knowing which manifest to check against — a sheet of
 * bare keys would only invite the author to fix a design that was never there.
 *
 * @param design `tests.design_settings_json`.
 * @param report `tests.report_settings_json`; absent means the report was never configured,
 *   and the sheet then says nothing about it rather than pinning today's defaults.
 */
export function serializeDesignRows(
  design?: DesignSource | null,
  report?: ReportSource | null,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const push = (what: string, mode: string, theme: string, key: string, value: string): void => {
    rows.push({
      [DS_WHAT]: what,
      [DS_MODE]: mode,
      [DS_THEME]: theme,
      [DS_KEY]: key,
      [DS_VALUE]: value,
    });
  };

  const templateId = cleanCell(String(design?.templateId ?? ""));
  if (templateId !== "") {
    push(WHAT_TO.template, "", "", "", templateId);
    if (isTestTheme(design?.theme)) push(WHAT_TO.theme, "", "", "", THEME_TO[design.theme]);

    for (const [key, value] of Object.entries(record(design?.params))) {
      if (value === null || value === undefined) continue;
      push(WHAT_TO.param, "", "", key, encodeFieldValue(value));
    }
    for (const [themeId, values] of Object.entries(record(design?.paramsByTheme))) {
      for (const [key, value] of Object.entries(record(values))) {
        if (value === null || value === undefined) continue;
        push(WHAT_TO.param, "", themeLabel(themeId), key, encodeFieldValue(value));
      }
    }
  }

  if (!report) return rows;

  // Reuses the model's own reading of the switch: absence means «выдавать», and spelling
  // that rule a second time here is how the sheet would start disagreeing with the product.
  push(WHAT_TO.report, "", "", REPORT_ENABLED_KEY, isReportEnabled(report as ReportSettings) ? YES : NO);

  for (const mode of Object.keys(MODE_LABELS) as ReportMode[]) {
    const raw = report[mode];
    if (typeof raw !== "object" || raw === null) continue;
    const branch = raw as { variantKey?: unknown; values?: unknown };
    const label = MODE_LABELS[mode];
    // Written even when empty: the row is what says «this branch exists», and a branch
    // without a variant is a state the round trip has to preserve.
    push(WHAT_TO.report, label, "", REPORT_VARIANT_KEY, cleanCell(String(branch.variantKey ?? "")));
    for (const [key, value] of Object.entries(record(branch.values))) {
      if (value === null || value === undefined) continue;
      push(WHAT_TO.report, label, "", key, encodeFieldValue(value));
    }
  }

  return rows;
}

// ─── Import ──────────────────────────────────────────────────────────────────

/** Is every cell of the row blank? Excel keeps trailing rows that carry nothing. */
function isBlankRow(row: Record<string, unknown>): boolean {
  return DESIGN_HEADERS.every((h) => String(row[h] ?? "").trim() === "");
}

/** An empty result — also the shape a sheet of nothing but blank rows yields. */
function emptySheet(): ParsedDesignSheet {
  return { params: {}, paramsByTheme: {}, report: {}, errors: [] };
}

/**
 * Read the «Оформление» sheet.
 *
 * Rows are independent: a row with an error is dropped and the rest are applied, as on every
 * other sheet of the workbook. A key repeated for the same owner ends up at its LAST row —
 * the sheet is a list of statements and the author reads it top to bottom.
 *
 * Nothing here is checked against a manifest: see the module note. In particular an unknown
 * report variant is NOT an error at this level — this module cannot know the receiver's
 * manifest, and the strict check the plan requires lives in the import.
 */
export function parseDesignSheet(rows: Record<string, unknown>[] = []): ParsedDesignSheet {
  const out = emptySheet();

  rows.forEach((row, i) => {
    if (isBlankRow(row)) return;
    const where = `Лист «${DESIGN_SHEET_NAME}», строка ${i + 2}`;
    const fail = (message: string): void => {
      out.errors.push(`${where}: ${message}`);
    };

    const whatRaw = String(row[DS_WHAT] ?? "");
    const what = byLabelOrValue(WHAT_TO, whatRaw) as DesignWhat | undefined;
    if (!what) {
      fail(`неизвестное «${DS_WHAT}»: "${whatRaw}"; ожидается одно из: ${DESIGN_WHAT_CHOICES.join(", ")}`);
      return;
    }

    const valueRaw = String(row[DS_VALUE] ?? "");
    const key = cleanCell(String(row[DS_KEY] ?? ""));

    if (what === "template") {
      const templateId = cleanCell(valueRaw);
      if (templateId === "") {
        fail(`строка «${WHAT_TO.template}» без «${DS_VALUE}»: нечего применять`);
        return;
      }
      out.templateId = templateId;
      return;
    }

    if (what === "theme") {
      const theme = byLabelOrValue(THEME_TO, valueRaw) as TestTheme | undefined;
      if (!theme) {
        fail(
          `неизвестная «${WHAT_TO.theme}»: "${valueRaw}"; `
          + `ожидается одно из: ${DESIGN_THEME_CHOICES.join(", ")}`,
        );
        return;
      }
      out.theme = theme;
      return;
    }

    if (what === "param") {
      if (key === "") {
        fail(`строка «${WHAT_TO.param}» без «${DS_KEY}»: неизвестно, что настраивается`);
        return;
      }
      const themeRaw = cleanCell(String(row[DS_THEME] ?? ""));
      if (themeRaw === "") {
        out.params[key] = decodeFieldValue(valueRaw);
        return;
      }
      // An unknown palette id travels as itself: the palettes are declared by the RECEIVER's
      // manifest, which this module does not read, so refusing one here would reject a
      // palette the receiving template may well declare.
      const palette = (byLabelOrValue(THEME_TO, themeRaw) as TestTheme | undefined) ?? themeRaw;
      if (palette === "auto") {
        fail(`«${DS_THEME}»: «${THEME_TO.auto}» — не палитра; переопределять по ней нечего`);
        return;
      }
      (out.paramsByTheme[palette] ??= {})[key] = decodeFieldValue(valueRaw);
      return;
    }

    // what === "report"
    if (key === "") {
      fail(`строка «${WHAT_TO.report}» без «${DS_KEY}»: неизвестно, что настраивается`);
      return;
    }
    const modeRaw = cleanCell(String(row[DS_MODE] ?? ""));

    if (normalizeCell(key) === normalizeCell(REPORT_ENABLED_KEY)) {
      if (modeRaw !== "") {
        fail(`«${REPORT_ENABLED_KEY}» — общая настройка; «${DS_MODE}» должен быть пустым`);
        return;
      }
      const value = normalizeCell(valueRaw);
      if (value === "") return; // «оставить как есть» — see the module note.
      if (value === normalizeCell(YES)) out.reportEnabled = true;
      else if (value === normalizeCell(NO)) out.reportEnabled = false;
      else fail(`«${REPORT_ENABLED_KEY}»: ожидается «${YES}», «${NO}» или пусто, получено "${valueRaw}"`);
      return;
    }

    if (modeRaw === "") {
      fail(`строка «${WHAT_TO.report}» без «${DS_MODE}»: непонятно, к какому режиму относится «${key}»`);
      return;
    }
    const mode = byLabelOrValue(MODE_LABELS, modeRaw) as ReportMode | undefined;
    if (!mode) {
      fail(`неизвестный «${DS_MODE}»: "${modeRaw}"; ожидается одно из: ${DESIGN_MODE_CHOICES.join(", ")}`);
      return;
    }

    // The branch is created by the row that mentions it, whatever the row says: a branch
    // named with an empty «Вид отчёта» is the pre-PRD-35 shape and has to survive as such.
    const branch = (out.report[mode] ??= { values: {} });
    if (normalizeCell(key) === normalizeCell(REPORT_VARIANT_KEY)) {
      const variantKey = cleanCell(valueRaw);
      branch.variantKey = variantKey === "" ? undefined : variantKey;
      return;
    }
    branch.values[key] = decodeFieldValue(valueRaw);
  });

  return out;
}
