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
 *
 * A parameter NAME is part of that contract, because the sheet matches a row by it. Renaming
 * one therefore adds {@link SettingParam.aliases} rather than replacing the name: the export
 * prints the new name, the import goes on accepting the old one, and a workbook downloaded
 * before the rename keeps applying.
 */
import type { Test } from "@shared/schema";
import { ELIGIBILITY_PLUGINS } from "@shared/eligibility/registry";
// Порядок и отбраковку блоков читает тот же нормализатор, что и оба хоста при печати итогов:
// иначе книга показала бы автору не тот список, который увидит ученик.
import { normalizeSectionGroups } from "@shared/scoring/section-groups";

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
  /**
   * PRD-61: тексты по исходу — своя корзина на каждую пару (выдача, исход), потому что каждая
   * сливается в СВОЮ вложенную ветвь `intro_json.<выдача>.<исход>`.
   */
  introResultsPassed: Record<string, unknown>;
  introResultsFailed: Record<string, unknown>;
  introReportPassed: Record<string, unknown>;
  introReportFailed: Record<string, unknown>;
  /** Merged onto `breakdown_display_json` (PRD-50 FR-13/FR-44). */
  breakdown: Record<string, unknown>;
  /**
   * Названия блоков итогов в порядке автора (`tests.section_groups_json`, PRD-50 FR-11).
   *
   * Именно НАЗВАНИЯ, а не ключи: книга всюду адресует сущности так, как их видит автор, а
   * `key` — внутренний идентификатор, на который ссылается раздел. Импорт сам сопоставляет
   * названия с ключами теста-приёмника и заводит ключ только новому блоку.
   *
   * `undefined` = книга о блоках промолчала, и список теста остаётся как был.
   */
  sectionGroupLabels?: string[];
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
    introResultsPassed: {},
    introResultsFailed: {},
    introReportPassed: {},
    introReportFailed: {},
    breakdown: {},
  };
}

/** Draft branches available to plain parameters (everything except the scalar fields). */
type Bucket = "test" | "router" | "overall" | "retake" | "attemptInterval" | "plugin"
  | "introResults" | "introReport" | "introRoot" | "breakdown"
  | "introResultsPassed" | "introResultsFailed" | "introReportPassed" | "introReportFailed";

export interface SettingParam {
  /** Text of the «Параметр» cell — the editor's label, verbatim. */
  name: string;
  /**
   * Names this parameter USED to be printed under. Accepted on import forever, never
   * written: the sheet always exports {@link name}.
   *
   * A parameter name is a CONTRACT with workbooks already in the wild. The sheet matches a
   * row by its name, and an author's copy lives on their own disk — there is no release
   * after which every such copy has been reissued. So a rename adds an alias instead of
   * replacing a name, and the alias stays: dropping it later breaks exactly the workbooks
   * that were never re-downloaded.
   */
  aliases?: readonly string[];
  /** Value for the export; empty string when the test carries nothing. */
  read(src: SettingsSource): string;
  /** Apply a NON-EMPTY cell to the draft; return an error message or nothing. */
  write(raw: string, draft: SettingsDraft): string | undefined;
}

/** Options every parameter constructor accepts: the former names of this parameter. */
type AliasOpts = { aliases?: readonly string[] };

/** `aliases` as a spreadable fragment, so a parameter without them carries no key at all. */
function aliasesOf({ aliases }: AliasOpts): Pick<SettingParam, "aliases"> {
  return aliases && aliases.length > 0 ? { aliases } : {};
}

const YES = "Да";
const NO = "Нет";

/**
 * Strip the junk a cell collects on its way through Excel and Word: non-breaking and
 * zero-width spaces, a BOM, and runs of ordinary spaces. Applied to parameter NAMES and to
 * the values of closed-vocabulary parameters — never to free text, where the inner spacing
 * is content the author typed.
 *
 * Exported because other sheets of the SAME workbook must clean a cell identically: a topic
 * name spelled with a non-breaking space has to match the one the «Структура» sheet wrote.
 */
export function cleanCell(raw: string): string {
  return raw.replace(/[\s ​﻿]+/g, " ").trim();
}

/**
 * {@link cleanCell} plus case folding — the form in which names and labels are compared,
 * and the form in which a sheet keys its owners (a parameter name, a topic name).
 */
export function normalizeCell(raw: string): string {
  return cleanCell(raw).toLowerCase();
}

/**
 * A closed-vocabulary cell → the stored value: by its label first, then by the stored value
 * itself, so a sheet filled by hand with `html` loads as well as one filled with «HTML».
 *
 * Lives here rather than next to the sheet that first needed it: «Страницы», «Оформление» and
 * every later sheet read their dictionaries the same way, and a per-sheet copy is how one of
 * them starts accepting a spelling the others reject.
 *
 * @param labels Stored value → cell label.
 * @param raw The cell.
 * @param extra Stored values accepted on import but absent from `labels` (legacy spellings).
 */
export function byLabelOrValue<T extends string>(
  labels: Record<T, string>,
  raw: string,
  extra: readonly string[] = [],
): T | undefined {
  const normalized = normalizeCell(raw);
  const entry = (Object.entries(labels) as [T, string][])
    .find(([, label]) => normalizeCell(label) === normalized);
  if (entry) return entry[0];
  const cleaned = cleanCell(raw);
  if (Object.prototype.hasOwnProperty.call(labels, cleaned)) return cleaned as T;
  if ((extra as readonly string[]).includes(cleaned)) return cleaned as T;
  return undefined;
}

/**
 * A stored field value as a cell. Scalars keep their literal spelling so the import's
 * coercion (`Number(raw)`, `raw === "true"`) reads them back; anything structured travels as
 * compact JSON, which {@link decodeFieldValue} turns back into an object.
 *
 * Shared by every sheet that carries values typed by a MANIFEST rather than by this module —
 * «Поля страниц» and «Оформление» — because both are read back by the same coercion rules.
 */
export function encodeFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * A cell back into a field value.
 *
 * Only text that is ENTIRELY a JSON object or array is decoded; a scalar spelling stays a
 * string, because a text placeholder holding `5` or `true` is the author's text and must not
 * silently change type. Author prose that is a complete JSON object is not something the
 * editor can produce, whereas a `resultField` placeholder or a media envelope is — so the
 * asymmetry is worth it.
 */
export function decodeFieldValue(raw: string): unknown {
  const text = raw.trim();
  if (text === "") return "";
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === "object") return parsed;
    } catch {
      // Text that merely looks like JSON is text.
    }
  }
  return text;
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
  opts: AliasOpts = {},
): SettingParam {
  return {
    name,
    ...aliasesOf(opts),
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
  opts: { min?: number; max?: number; zeroIsNull?: boolean } & AliasOpts = {},
): SettingParam {
  const { min = 0, max = Number.MAX_SAFE_INTEGER, zeroIsNull = false } = opts;
  return {
    name,
    ...aliasesOf(opts),
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
  opts: AliasOpts = {},
): SettingParam {
  return {
    name,
    ...aliasesOf(opts),
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
  opts: { open?: boolean } & AliasOpts = {},
): SettingParam {
  const byLabel = new Map(
    Object.entries(labels).map(([value, label]) => [normalizeCell(label), value]),
  );
  return {
    name,
    ...aliasesOf(opts),
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

/**
 * Test mode labels. Exported for the same reason as {@link FORMAT_LABELS}: the «Оформление»
 * sheet names the same two modes when it splits the report settings by branch, and a second
 * copy of the pair is how the two sheets start spelling a mode differently.
 */
export const MODE_LABELS = { standard: "Стандартный", adaptive: "Адаптивный" };

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

/**
 * «Тест пройден, если» — что ЗНАЧИТ пройденный тест (`tests.pass_decision_policy`).
 *
 * Подписи — продолжения фразы, как в радиогруппе редактора: ячейка книги читается вместе с
 * именем параметра, и «достигнут общий проходной порог теста» в паре с ним складывается в то
 * же предложение, что видит автор.
 */
const DECISION_POLICY_LABELS = {
  overall_only: "достигнут общий проходной порог теста",
  overall_and_required_topics: "достигнут общий проходной порог и пройдены все обязательные темы",
  required_topics_only: "пройдены все обязательные темы",
  all_topics_passed: "пройдена каждая выбранная тема",
};

/** Что SCORM-пакет отдаёт в LMS при нескольких попытках (`tests.lms_attempt_result`). */
const LMS_ATTEMPT_LABELS = { best: "Лучшая попытка", last: "Последняя попытка" };

/** PRD-50 FR-13/FR-44: показ подытогов по подтемам — вид, база и место. */
const BREAKDOWN_VISIBILITY_LABELS = {
  hidden: "Не показывать",
  bar: "Полоса",
  bar_and_value: "Полоса и число",
};

const BREAKDOWN_BASIS_LABELS = { units: "Доля вопросов", points: "Доля баллов" };

const BREAKDOWN_PLACEMENT_LABELS = {
  topics: "В карточках тем",
  block: "Отдельным блоком в итогах",
  both: "В карточках тем и отдельным блоком",
};

/** PRD-8 §3.2: the meaning of the policies cut down to a cell's length, terms from there. */
const COMPLETION_LABELS = {
  all_required_completed: "После завершения всех обязательных разделов",
  all_required_passed: "Только если все обязательные разделы пройдены",
};

/**
 * Rich-text format labels. Exported as the ONE vocabulary of the workbook: the same three
 * labels name the format of an intro block here and the format of feedback on the
 * «Обратная связь» sheet, and a second copy of them would eventually drift.
 */
export const FORMAT_LABELS = { plain: "Простой", richText: "Форматированный", html: "HTML" };

/**
 * Threshold-type labels of the TABLE sheets — «Структура», «Пороги вариантов» and
 * «Адаптивные уровни». Exported for the same reason as {@link FORMAT_LABELS}: three sheets
 * ask the same question, and a per-sheet copy is how one of them starts offering a value
 * the others no longer take.
 *
 * NOT the same wording as {@link OVERALL_TYPE_LABELS} above, on purpose: the «Настройки»
 * sheet names the test's OVERALL rule in a parameter list, where «Процент» alone would not
 * say percent of what. In a «Тип порога» column the header already says it.
 */
export const PASS_TYPE_TO: Record<string, string> = { percent: "Процент", absolute: "Сумма баллов" };

/**
 * A «Тип порога» cell → the stored type. Wider than {@link PASS_TYPE_TO} reversed: the
 * synonyms and the English spellings keep older, hand-written books loading.
 */
export const PASS_TYPE_FROM: Record<string, "percent" | "absolute"> = {
  "процент": "percent",
  "%": "percent",
  "percent": "percent",
  "сумма баллов": "absolute",
  "баллы": "absolute",
  "балл": "absolute",
  "absolute": "absolute",
};

const FAIL_POLICY_LABELS = { failOpen: "Разрешить старт", failClosed: "Заблокировать" };

/** Eligibility plugins — by their human name from the shared registry, not by key. */
const PLUGIN_LABELS: Record<string, string> = Object.fromEntries(
  ELIGIBILITY_PLUGINS.map((p) => [p.key, p.name]),
);

/** Разделитель списка в одной ячейке — тот же, что у «Зависит от разделов». */
const LIST_SEPARATOR = ";";

/**
 * «Блоки итогов» — именованные блоки разделов на экране итогов (PRD-50 FR-11).
 *
 * Единственный параметр листа, чьё значение — СПИСОК: блоков у теста несколько, а строка на
 * листе одна. Поэтому у него собственные `read`/`write` вместо конструктора: значение — это
 * названия блоков в порядке автора через «;», а членство разделов книга везёт колонкой
 * «Блок итогов» листа «Структура» — одна строка на раздел там уже есть.
 *
 * Ключи блоков в книгу не попадают: `key` — внутренний идентификатор, на который ссылается
 * раздел, и автору он не виден нигде. Импорт сопоставляет названия с ключами приёмника сам.
 */
const SECTION_GROUPS_PARAM: SettingParam = {
  name: "Блоки итогов",
  read: (s) => normalizeSectionGroups(s.sectionGroupsJson).map((g) => g.label).join(`${LIST_SEPARATOR} `),
  write: (raw, draft) => {
    const labels = String(raw)
      .split(LIST_SEPARATOR)
      .map((s) => s.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    for (const label of labels) {
      const key = normalizeCell(label);
      // Два блока с одним названием делают членство раздела неоднозначным: колонка
      // «Структура» адресует блок именно названием, и выбирать за автора нельзя.
      if (seen.has(key)) return `повторяющееся название блока: "${label}"`;
      seen.add(key);
    }
    draft.sectionGroupLabels = labels;
    return;
  },
};

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * Row order = the group order of the editor's «Настройки» tab. An author opening the
 * workbook reads it top to bottom in the same order in which they configured the test.
 */
export const SETTING_PARAMS: SettingParam[] = [
  // ── Basics ──
  textParam("Название", (s) => s.title, "test", "title"),
  textParam("Описание", (s) => s.description, "test", "description"),
  // PRD-59 FR-04: формат едет рядом с текстом. Отдельным параметром, а не разметкой
  // внутри ячейки: ячейка книги — это ИСХОДНИК, и читать его надо тем же способом,
  // каким его читает продукт.
  enumParam("Формат описания", FORMAT_LABELS, (s) => s.descriptionFormat, "test", "descriptionFormat"),
  {
    name: "Папка",
    read: (s) => String(s.folderPath ?? ""),
    write: (raw, draft) => { draft.folderPath = raw; return; },
  },
  enumParam("Режим теста", MODE_LABELS, (s) => s.mode, "test", "mode"),
  {
    // The editor's field keeps the full «Сценарий прохождения» label (audit decision 26);
    // outside its panel — the workbook, validation, the guides — the parameter is named by
    // what it holds, «Тип сценария» (Э5.1).
    name: "Тип сценария",
    aliases: ["Сценарий прохождения"],
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
  // Ф-19: the highlight is printed right after the answer, not at the end of the test, so
  // the old name promised the wrong moment (Э5.2).
  boolParam("Показывать правильные ответы после ответа", (s) => s.showCorrectAnswers, "test", "showCorrectAnswers", {
    aliases: ["Показывать правильные ответы после прохождения"],
  }),
  boolParam("Показывать уровень сложности при прохождении", (s) => s.showDifficultyLevel, "test", "showDifficultyLevel"),

  // ── Pass rules ──
  // Первым — то, что решает СМЫСЛ пройденного теста: общее правило ниже лишь одна из его
  // составляющих, и книга, назвавшая порог без политики, читалась бы как полный ответ.
  enumParam("Тест пройден, если", DECISION_POLICY_LABELS, (s) => s.passDecisionPolicy, "test", "passDecisionPolicy"),
  // PRD-50 §16 (FR-53): гейт подтем стоит сразу за смыслом вердикта — он его уточняет.
  boolParam(
    "Учитывать подтемы в вердикте темы",
    (s) => s.breakdownGateEnabled,
    "test",
    "breakdownGateEnabled",
  ),
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
  boolParam("Свободная навигация внутри раздела", (s) => s.allowFreeSectionNavigation, "test", "allowFreeSectionNavigation"),
  boolParam("Позволить изменять ответ до завершения", (s) => s.allowAnswerChange, "test", "allowAnswerChange"),
  boolParam("Не показывать обзор, если отвечены все вопросы", (s) => s.skipReviewWhenComplete, "test", "skipReviewWhenComplete"),
  boolParam("Переходить к следующему вопросу сразу после ответа", (s) => s.quickAdvance, "test", "quickAdvance"),
  boolParam("Показывать итоги раздела", (s) => s.showSectionResults, "test", "showSectionResults"),
  boolParam("Закрывать раздел при выходе", (s) => s.closeSectionOnLeave, "test", "closeSectionOnLeave"),
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
  boolParam("Отправлять телеметрию о прохождении", (s) => s.telemetryEnabled, "test", "telemetryEnabled"),
  // Действует только в SCORM-пакете: в вебе внешней системы нет, и попытки показываются
  // каждая сама по себе.
  enumParam("Результат для LMS при нескольких попытках", LMS_ATTEMPT_LABELS, (s) => s.lmsAttemptResult, "test", "lmsAttemptResult"),

  // ── Intro blocks of the results screen and of the report ──
  textParam("Вводный текст на экране итогов", (s) => branch(s.introJson, "results").text, "introResults", "text"),
  enumParam("Формат вводного текста на экране итогов", FORMAT_LABELS, (s) => branch(s.introJson, "results").format, "introResults", "format"),
  textParam("Вводный текст в отчёте", (s) => branch(s.introJson, "report").text, "introReport", "text"),
  enumParam("Формат вводного текста в отчёте", FORMAT_LABELS, (s) => branch(s.introJson, "report").format, "introReport", "format"),
  boolParam("В отчёте — тот же текст, что на экране итогов", (s) => branch(s.introJson).reportSameAsResults, "introRoot", "reportSameAsResults"),

  // PRD-61: тексты по исходу. ОТДЕЛЬНЫЕ строки, а не один столбец с разделителем: книга
  // правится руками, и склеенное поле автор порвёт первым же переносом строки. Имена
  // полные — лист плоский, и другого способа сказать, чей это текст, у него нет.
  textParam("Вводный текст на экране итогов, если тест пройден", (s) => branch(s.introJson, "results", "passed").text, "introResultsPassed", "text"),
  enumParam("Формат вводного текста на экране итогов, если тест пройден", FORMAT_LABELS, (s) => branch(s.introJson, "results", "passed").format, "introResultsPassed", "format"),
  textParam("Вводный текст на экране итогов, если тест не пройден", (s) => branch(s.introJson, "results", "failed").text, "introResultsFailed", "text"),
  enumParam("Формат вводного текста на экране итогов, если тест не пройден", FORMAT_LABELS, (s) => branch(s.introJson, "results", "failed").format, "introResultsFailed", "format"),
  textParam("Вводный текст в отчёте, если тест пройден", (s) => branch(s.introJson, "report", "passed").text, "introReportPassed", "text"),
  enumParam("Формат вводного текста в отчёте, если тест пройден", FORMAT_LABELS, (s) => branch(s.introJson, "report", "passed").format, "introReportPassed", "format"),
  textParam("Вводный текст в отчёте, если тест не пройден", (s) => branch(s.introJson, "report", "failed").text, "introReportFailed", "text"),
  enumParam("Формат вводного текста в отчёте, если тест не пройден", FORMAT_LABELS, (s) => branch(s.introJson, "report", "failed").format, "introReportFailed", "format"),

  // ── Состав итогов (PRD-50) ──
  enumParam("Подытоги по подтемам (тегам)", BREAKDOWN_VISIBILITY_LABELS, (s) => branch(s.breakdownDisplayJson).visibility, "breakdown", "visibility"),
  enumParam("База подытогов", BREAKDOWN_BASIS_LABELS, (s) => branch(s.breakdownDisplayJson).basis, "breakdown", "basis"),
  enumParam("Где показывать подытоги", BREAKDOWN_PLACEMENT_LABELS, (s) => branch(s.breakdownDisplayJson).placement, "breakdown", "placement"),
  // Показ ТОЛКОВАНИЙ подтем. Живёт в той же настройке, что и сами подытоги: без полосы
  // толкованию не под чем печататься. Тексты при этом задаются на листе «Обратная связь».
  boolParam("Показывать толкование подтем", (s) => branch(s.breakdownDisplayJson).showInterpretation, "breakdown", "showInterpretation"),
  SECTION_GROUPS_PARAM,
];

/**
 * Parameter by cell name: compared case-insensitively and free of Excel's sticky spaces.
 *
 * Current names are indexed FIRST and an alias never overwrites one: if a rename ever hands
 * one parameter the former name of another, the sheet keeps meaning what it prints today,
 * and the older book loses one row instead of writing into the wrong column.
 */
const PARAM_BY_NAME = new Map(SETTING_PARAMS.map((p) => [normalizeCell(p.name), p]));
for (const param of SETTING_PARAMS) {
  for (const alias of param.aliases ?? []) {
    const key = normalizeCell(alias);
    if (!PARAM_BY_NAME.has(key)) PARAM_BY_NAME.set(key, param);
  }
}

/**
 * Параметры, снятые с листа. Книга, выгруженная до снятия, несёт их строкой, и такая строка
 * пропускается молча: ошибка «неизвестный параметр» на каждой старой книге была бы шумом о
 * том, что автор ничего не сделал не так.
 *
 * «Webhook URL» снят 2026-09-30: рантайм пакета его никогда не читал, а адрес, куда пакет
 * шлёт данные, — адрес телеметрии из конфигурации установки, а не настройка теста.
 */
const RETIRED_PARAM_NAMES = new Set(["Webhook URL"].map(normalizeCell));

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
    if (RETIRED_PARAM_NAMES.has(normalizeCell(name))) return;
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
