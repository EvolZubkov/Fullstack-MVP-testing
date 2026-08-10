/**
 * @module server/utils/workbook-settings
 * @description The «Настройки» sheet of the test workbook (PRD-48 §4.1): ONE declarative
 * registry of parameters read by both the export and the import.
 *
 * A registry rather than two functions: before PRD-48 the export and the import each kept
 * their own list, and the lists drifted apart — the sheet carried a single parameter while
 * the test had thirty. Here a parameter has one cell name, one read and one write, and
 * there is nowhere for them to drift.
 *
 * Cell rules (spec §4.4): an empty «Значение» means "leave as is", so a workbook taken
 * before a parameter existed resets nothing; `0` in a limit means "no limit", verbatim as
 * the editor's hint puts it; a boolean is «Да»/«Нет».
 *
 * The workbook is never STRICTER than the editor (spec §9). Two consequences run through
 * the whole registry: an out-of-range number is clamped to the boundary exactly as the
 * editor's `clampIntervalHours`/`clampCooldown` do, and a value the registry does not
 * recognise survives the round trip instead of being dropped — the editor keeps an unknown
 * plugin key selectable, and the workbook must not be the thing that deletes it.
 *
 * Several parameters write into one JSON column, so the sheet is applied not to the `tests`
 * row but to a DRAFT ({@link SettingsDraft}): the import merges its branches onto the test's
 * current state and only then calls the settings service.
 */
import type { Test } from "@shared/schema";
import { ELIGIBILITY_PLUGINS } from "@shared/eligibility/registry";

/** Sheet headers. The sheet is a «параметр — значение» list, not a table of columns. */
export const SETTINGS_HEADERS = ["Параметр", "Значение"];
export const SETTINGS_WIDTHS = [46, 44];

/** The two column keys, taken from {@link SETTINGS_HEADERS} so a rename lands in one place. */
const [PARAM_COL, VALUE_COL] = SETTINGS_HEADERS;

/** Export source: the test row plus its folder path (resolved by the route). */
export type SettingsSource = Partial<Test> & { folderPath?: string | null };

/** Draft branches the parameters write into. */
export interface SettingsDraft {
  /** Direct `tests` columns. */
  test: Record<string, unknown>;
  /** `flow_policy_json.mode`; `undefined` means the workbook named no scenario. */
  flowMode?: "linear_flat" | "linear_by_topics" | "router_by_topics";
  /** Merged onto the current `flow_policy_json.router`. */
  router: Record<string, unknown>;
  /** Merged onto the current `overall_pass_rule_json`. */
  overall: Record<string, unknown>;
  /** Merged onto the current `retake_policy_json`. */
  retake: Record<string, unknown>;
  /** Merged onto `retake_policy_json.attemptInterval`. */
  attemptInterval: Record<string, unknown>;
  /** Merged onto `retake_policy_json.eligibilityPlugin`. */
  plugin: Record<string, unknown>;
  /** Merged onto `intro_json.results` / `.report` / its root. */
  introResults: Record<string, unknown>;
  introReport: Record<string, unknown>;
  introRoot: Record<string, unknown>;
  /** Folder path; the import turns it into `folderId` — it is the one with storage access. */
  folderPath?: string;
}

/** Empty draft. A separate function: tests compare against it for "the workbook changed nothing". */
export function emptySettingsDraft(): SettingsDraft {
  return {
    test: {},
    router: {},
    overall: {},
    retake: {},
    attemptInterval: {},
    plugin: {},
    introResults: {},
    introReport: {},
    introRoot: {},
  };
}

/** Draft branches available to plain parameters (everything except the scalar fields). */
type Bucket = "test" | "router" | "overall" | "retake" | "attemptInterval" | "plugin"
  | "introResults" | "introReport" | "introRoot";

export interface SettingParam {
  /** Text of the «Параметр» cell — the editor's label, verbatim. */
  name: string;
  /** Value for the export; empty string when the test carries nothing. */
  read(src: SettingsSource): string;
  /** Apply a NON-EMPTY cell to the draft; return an error message or nothing. */
  write(raw: string, draft: SettingsDraft): string | undefined;
}

const YES = "Да";
const NO = "Нет";

/**
 * Strip the junk a cell collects on its way through Excel and Word: non-breaking and
 * zero-width spaces, a BOM, and runs of ordinary spaces. Applied to parameter NAMES and to
 * the values of closed-vocabulary parameters — never to free text, where the inner spacing
 * is content the author typed.
 */
function cleanCell(raw: string): string {
  return raw.replace(/[\s ​﻿]+/g, " ").trim();
}

/** {@link cleanCell} plus case folding — the form in which names and labels are compared. */
function normalizeCell(raw: string): string {
  return cleanCell(raw).toLowerCase();
}

/**
 * A yes/no parameter. Reads as «Да»/«Нет» and accepts either spelling in any case; a cell
 * that is neither is a row error, since there is no third reading of a switch.
 */
function boolParam(
  name: string,
  get: (s: SettingsSource) => unknown,
  bucket: Bucket,
  key: string,
): SettingParam {
  return {
    name,
    read: (s) => {
      const v = get(s);
      return v === true ? YES : v === false ? NO : "";
    },
    write: (raw, draft) => {
      const v = normalizeCell(raw);
      if (v === normalizeCell(YES)) { draft[bucket][key] = true; return; }
      if (v === normalizeCell(NO)) { draft[bucket][key] = false; return; }
      return `значение должно быть «${YES}» или «${NO}», получено "${raw}"`;
    },
  };
}

/**
 * A whole-number parameter.
 *
 * `zeroIsNull` marks a LIMIT, where the editor spells "no limit" as `0`: such a parameter
 * reads an absent value back as «0» and stores `null` when the cell says `0`, so the round
 * trip carries "unlimited" rather than losing it to an empty cell.
 *
 * `min`/`max` CLAMP, they do not reject. The editor silently clamps the same fields
 * (`clampIntervalHours`, `Math.min(3650, Math.max(1, …))`), and per spec §9 the workbook
 * must not be stricter than the editor: rejecting would let the export produce a cell its
 * own import refuses, breaking the transfer FR-21 promises. A non-integer cell IS a row
 * error — that is a typo, not a value out of range, and guessing at it would be worse.
 */
function intParam(
  name: string,
  get: (s: SettingsSource) => unknown,
  bucket: Bucket,
  key: string,
  opts: { min?: number; max?: number; zeroIsNull?: boolean } = {},
): SettingParam {
  const { min = 0, max = Number.MAX_SAFE_INTEGER, zeroIsNull = false } = opts;
  return {
    name,
    read: (s) => {
      const v = get(s);
      if (v == null) return zeroIsNull ? "0" : "";
      return String(v);
    },
    write: (raw, draft) => {
      const cleaned = cleanCell(raw);
      if (!/^-?\d+$/.test(cleaned)) return `нужно целое число, получено "${raw}"`;
      const n = Number(cleaned);
      if (zeroIsNull && n === 0) { draft[bucket][key] = null; return; }
      draft[bucket][key] = Math.min(max, Math.max(min, n));
    },
  };
}

/**
 * A free-text parameter. The cell is stored verbatim — inner spacing is the author's text,
 * not junk, so {@link cleanCell} deliberately stays away from it.
 */
function textParam(
  name: string,
  get: (s: SettingsSource) => unknown,
  bucket: Bucket,
  key: string,
): SettingParam {
  return {
    name,
    read: (s) => String(get(s) ?? ""),
    // An empty cell never reaches here (parseSettingsSheet filters it out), so a text
    // parameter cannot be cleared by the workbook — a deliberate consequence of the
    // "empty = leave as is" rule.
    write: (raw, draft) => { draft[bucket][key] = raw; return; },
  };
}

/**
 * A parameter chosen from a vocabulary. Reads as the human label and accepts either that
 * label or the stored value itself, so a workbook hand-filled with `percent` still loads.
 *
 * A value missing from the vocabulary is read back RAW rather than as an empty cell:
 * empty means "leave as is" on import, so blanking it would delete the setting silently.
 * With `open` the raw value is also accepted back — the vocabulary is a registry that grows
 * outside this module (eligibility plugins), and the editor likewise keeps an unknown key
 * selectable instead of dropping it. Closed vocabularies stay closed: their values are
 * constrained by the schema, and an unknown one there is a typo worth reporting.
 */
function enumParam(
  name: string,
  labels: Record<string, string>,
  get: (s: SettingsSource) => unknown,
  bucket: Bucket,
  key: string,
  opts: { open?: boolean } = {},
): SettingParam {
  const byLabel = new Map(
    Object.entries(labels).map(([value, label]) => [normalizeCell(label), value]),
  );
  return {
    name,
    read: (s) => {
      const v = get(s);
      if (typeof v !== "string" || v === "") return "";
      return labels[v] ?? v;
    },
    write: (raw, draft) => {
      const cleaned = cleanCell(raw);
      const byLabelMatch = byLabel.get(normalizeCell(raw));
      if (byLabelMatch) { draft[bucket][key] = byLabelMatch; return; }
      // Case-sensitive on purpose: stored values are identifiers (`failClosed`), and
      // folding their case would hand the column a value the schema does not accept.
      if (Object.prototype.hasOwnProperty.call(labels, cleaned)) {
        draft[bucket][key] = cleaned;
        return;
      }
      if (opts.open) { draft[bucket][key] = cleaned; return; }
      return `недопустимое значение "${raw}"; ожидается одно из: ${Object.values(labels).join(", ")}`;
    },
  };
}

/** A branch of the source's JSON column, safe against `null` and against a foreign shape. */
function branch(value: unknown, ...path: string[]): Record<string, unknown> {
  let cur: unknown = value;
  for (const key of path) {
    if (typeof cur !== "object" || cur === null) return {};
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "object" && cur !== null ? (cur as Record<string, unknown>) : {};
}

// ─── Value dictionaries (labels verbatim from the editor and from PRD-8) ─────

const MODE_LABELS = { standard: "Стандартный", adaptive: "Адаптивный" };

const FLOW_LABELS = {
  linear_flat: "Линейный",
  linear_by_topics: "Линейный по темам",
  router_by_topics: "Через страницу-маршрутизатор",
};

const ORDER_LABELS = {
  fixed: "Фиксированный порядок",
  random: "Перемешивание",
  shuffle_all: "Полное перемешивание",
};

const OVERALL_TYPE_LABELS = {
  percent: "Процент правильных ответов",
  absolute: "Сумма баллов",
  none: "Не задано",
};

/** PRD-8 §3.2: the meaning of the policies cut down to a cell's length, terms from there. */
const COMPLETION_LABELS = {
  all_required_completed: "После завершения всех обязательных разделов",
  all_required_passed: "Только если все обязательные разделы пройдены",
};

const FORMAT_LABELS = { plain: "Простой", richText: "Форматированный", html: "HTML" };

const FAIL_POLICY_LABELS = { failOpen: "Разрешить старт", failClosed: "Заблокировать" };

/** Eligibility plugins — by their human name from the shared registry, not by key. */
const PLUGIN_LABELS: Record<string, string> = Object.fromEntries(
  ELIGIBILITY_PLUGINS.map((p) => [p.key, p.name]),
);

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * Row order = the group order of the editor's «Настройки» tab. An author opening the
 * workbook reads it top to bottom in the same order in which they configured the test.
 */
export const SETTING_PARAMS: SettingParam[] = [
  // ── Basics ──
  textParam("Название", (s) => s.title, "test", "title"),
  textParam("Описание", (s) => s.description, "test", "description"),
  {
    name: "Папка",
    read: (s) => String(s.folderPath ?? ""),
    write: (raw, draft) => { draft.folderPath = raw; return; },
  },
  enumParam("Режим теста", MODE_LABELS, (s) => s.mode, "test", "mode"),
  {
    name: "Сценарий прохождения",
    read: (s) => {
      const mode = branch(s.flowPolicyJson).mode;
      const key = typeof mode === "string" && FLOW_LABELS[mode as keyof typeof FLOW_LABELS]
        ? (mode as keyof typeof FLOW_LABELS)
        : "linear_flat";
      return FLOW_LABELS[key];
    },
    write: (raw, draft) => {
      const entry = Object.entries(FLOW_LABELS).find(([, l]) => normalizeCell(l) === normalizeCell(raw));
      if (!entry) {
        return `недопустимое значение "${raw}"; ожидается одно из: ${Object.values(FLOW_LABELS).join(", ")}`;
      }
      draft.flowMode = entry[0] as SettingsDraft["flowMode"];
      return;
    },
  },
  enumParam("Порядок выдачи вопросов", ORDER_LABELS, (s) => s.questionOrder, "test", "questionOrder"),
  boolParam("Показывать правильные ответы после прохождения", (s) => s.showCorrectAnswers, "test", "showCorrectAnswers"),
  boolParam("Показывать уровень сложности при прохождении", (s) => s.showDifficultyLevel, "test", "showDifficultyLevel"),

  // ── Pass rules ──
  enumParam("Тип общего правила", OVERALL_TYPE_LABELS, (s) => branch(s.overallPassRuleJson).type, "overall", "type"),
  intParam("Порог", (s) => branch(s.overallPassRuleJson).value, "overall", "value"),
  enumParam(
    "Политика завершения маршрутизатора",
    COMPLETION_LABELS,
    (s) => branch(s.flowPolicyJson, "router").completionPolicy,
    "router",
    "completionPolicy",
  ),

  // ── Limits ──
  intParam("Максимум попыток", (s) => s.maxAttempts, "test", "maxAttempts", { zeroIsNull: true }),
  intParam("Лимит времени теста", (s) => s.timeLimitMinutes, "test", "timeLimitMinutes", { zeroIsNull: true }),
  intParam("Балл за вопрос по умолчанию", (s) => s.defaultQuestionPoints, "test", "defaultQuestionPoints"),
  boolParam("Разрешить возврат к неотвеченным вопросам", (s) => s.allowReturnToUnanswered, "test", "allowReturnToUnanswered"),
  boolParam("Позволить изменять ответ до завершения", (s) => s.allowAnswerChange, "test", "allowAnswerChange"),
  boolParam("Не показывать обзор, если отвечены все вопросы", (s) => s.skipReviewWhenComplete, "test", "skipReviewWhenComplete"),
  boolParam("Переходить к следующему вопросу сразу после ответа", (s) => s.quickAdvance, "test", "quickAdvance"),
  boolParam("Показывать итоги раздела", (s) => s.showSectionResults, "test", "showSectionResults"),
  boolParam("Защищать текст задания от копирования", (s) => s.copyProtection, "test", "copyProtection"),
  boolParam("Показывать водяной знак", (s) => s.protectionWatermark, "test", "protectionWatermark"),
  boolParam("Скрывать задание при уходе из окна", (s) => s.protectionHideOnBlur, "test", "protectionHideOnBlur"),

  // ── Retaking ──
  boolParam("Ограничить повторное прохождение", (s) => branch(s.retakePolicyJson).enabled, "retake", "enabled"),
  intParam("Период охлаждения, календарных дней", (s) => branch(s.retakePolicyJson).cooldownPeriodDays, "retake", "cooldownPeriodDays", { min: 1, max: 3650 }),
  boolParam("Разделять период по результату попытки", (s) => branch(s.retakePolicyJson).cooldownByOutcome, "retake", "cooldownByOutcome"),
  intParam("При успешном прохождении, дней", (s) => branch(s.retakePolicyJson).cooldownPeriodDaysPassed, "retake", "cooldownPeriodDaysPassed", { min: 1, max: 3650 }),
  intParam("При неуспешном прохождении, дней", (s) => branch(s.retakePolicyJson).cooldownPeriodDaysFailed, "retake", "cooldownPeriodDaysFailed", { min: 1, max: 3650 }),
  enumParam("Способ проверки (плагин)", PLUGIN_LABELS, (s) => branch(s.retakePolicyJson, "eligibilityPlugin").key, "plugin", "key", { open: true }),
  enumParam("При ошибке проверки допуска", FAIL_POLICY_LABELS, (s) => branch(s.retakePolicyJson, "eligibilityPlugin").failPolicy, "plugin", "failPolicy"),
  boolParam("Ограничение между попытками", (s) => branch(s.retakePolicyJson, "attemptInterval").enabled, "attemptInterval", "enabled"),
  intParam("Интервал, часов", (s) => branch(s.retakePolicyJson, "attemptInterval").hours, "attemptInterval", "hours", { min: 1, max: 8760 }),

  // ── Integration ──
  textParam("Webhook URL", (s) => s.webhookUrl, "test", "webhookUrl"),
  boolParam("Отправлять телеметрию о прохождении", (s) => s.telemetryEnabled, "test", "telemetryEnabled"),

  // ── Intro blocks of the results screen and of the report ──
  textParam("Вводный текст на экране итогов", (s) => branch(s.introJson, "results").text, "introResults", "text"),
  enumParam("Формат вводного текста на экране итогов", FORMAT_LABELS, (s) => branch(s.introJson, "results").format, "introResults", "format"),
  textParam("Вводный текст в отчёте", (s) => branch(s.introJson, "report").text, "introReport", "text"),
  enumParam("Формат вводного текста в отчёте", FORMAT_LABELS, (s) => branch(s.introJson, "report").format, "introReport", "format"),
  boolParam("В отчёте — тот же текст, что на экране итогов", (s) => branch(s.introJson).reportSameAsResults, "introRoot", "reportSameAsResults"),
];

/** Parameter by cell name: compared case-insensitively and free of Excel's sticky spaces. */
const PARAM_BY_NAME = new Map(SETTING_PARAMS.map((p) => [normalizeCell(p.name), p]));

/** Export: one row per registry parameter, always all of them. */
export function serializeSettingsRows(src: SettingsSource): Record<string, unknown>[] {
  return SETTING_PARAMS.map((p) => ({ [PARAM_COL]: p.name, [VALUE_COL]: p.read(src) }));
}

/**
 * Sheet import. Returns the draft and per-row errors: a row with an error is dropped and
 * the rest are applied — as with every other sheet of the workbook.
 *
 * Rows are applied in order, so a parameter repeated twice ends up at its LAST occurrence.
 * The sheet is a list of settings, of which a test has one each; a duplicate is a hand-edit
 * artefact, and taking the last one matches how the author reads the sheet top to bottom.
 */
export function parseSettingsSheet(rows: Record<string, unknown>[]): {
  draft: SettingsDraft;
  errors: string[];
} {
  const draft = emptySettingsDraft();
  const errors: string[] = [];

  rows.forEach((row, i) => {
    const where = `Лист «Настройки», строка ${i + 2}`;
    const name = cleanCell(String(row[PARAM_COL] ?? ""));
    if (!name) {
      errors.push(`${where}: не указан «${PARAM_COL}»`);
      return;
    }
    const param = PARAM_BY_NAME.get(normalizeCell(name));
    if (!param) {
      errors.push(`${where}: неизвестный параметр: "${name}"`);
      return;
    }
    const raw = String(row[VALUE_COL] ?? "").trim();
    if (raw === "") return; // "leave as is"
    const error = param.write(raw, draft);
    if (error) errors.push(`${where}: «${name}» — ${error}`);
  });

  return { draft, errors };
}

/** Names of all parameters — the workbook template fills the «Параметр» column with them. */
export const SETTING_PARAM_NAMES: string[] = SETTING_PARAMS.map((p) => p.name);
