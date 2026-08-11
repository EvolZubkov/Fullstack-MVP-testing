/**
 * @module server/utils/workbook-pages
 * @description The «Страницы» and «Поля страниц» sheets of the test workbook
 * (PRD-48 §4, FR-14/FR-15): ONE contract read by both the export and the import.
 *
 * A page has NO natural key. `id` is a uuid local to the stand, `sort_order` is not unique
 * by contract, and `settings_json.sequenceId` is deliberately SHARED by a group of pages
 * (it marks a sequence, it does not identify a row). So a page is addressed by a synthetic
 * four-part key — «Зона» + «Раздел» + «Вид» + «Номер» — and «Поля страниц» is subordinate to
 * «Страницы» exactly as «Рекомендации» is subordinate to «Обратная связь»: a field row whose
 * address is not on the page sheet has nowhere to be stored, and is a row error rather than
 * a silently invented page.
 *
 * Zone and section are TWO columns, not one, for the same reason as on «Обратная связь»:
 * a topic literally named «До теста» exists in the bank, and a reserved word in a shared
 * column would quietly move that topic's pages up to the test scope.
 *
 * What this module does NOT do, and must not start doing:
 * - it does not know the variant MANIFEST, so it neither filters keys nor types values.
 *   A key the variant never declared travels through here as itself. Filtering against the
 *   manifest and sanitising the value is the IMPORT's duty (`server/services/
 *   content-page-fields.ts`, the same service the page editor calls). Skipping it would make
 *   the workbook an entry point past the sanitiser — the one thing PRD-48 Э3 must not allow;
 * - it does not assume the import will always have a manifest to check against. When the
 *   variant is unknown the import has to decide what to do with an unchecked value; nothing
 *   here may be written so that "the manifest was resolved" is taken for granted;
 * - it does not create or delete pages. System pages are materialised by the lifecycle
 *   service, and the sheets can only find one and update it.
 *
 * Cell rules:
 * - «Значение» is TEXT. A value stored as a number or a boolean is written as its literal
 *   (`5`, `true`) because that is what {@link
 *   import("../services/content-page-fields").normalizeSettingsForTemplate} reads back
 *   (`raw === "true"`, `Number(raw)`); «Да»/«Нет» would quietly become `false`. A structured
 *   value — a `resultField` placeholder is the only one in practice — travels as compact
 *   JSON and is decoded back into an object, so the round trip does not flatten it into a
 *   string;
 * - a cell is TRIMMED before it goes any further. A cell holding one space looks empty and
 *   is trimmed to empty, whereas `Number(" ")` is `0`: without the trim a stray space in a
 *   numeric setting would arrive as a confident zero;
 * - an EMPTY «Значение» is a meaningful empty string, NOT "leave as is". The «Настройки»
 *   sheet reads an empty cell as "leave as is" because it always lists every parameter, so
 *   an empty cell there carries no intent. Here the sheet has one row per field and a row
 *   exists only because the author wrote the key down: the row IS the statement "this field
 *   holds this", and the way to say "leave as is" is to delete the row. (What an empty value
 *   then means for a page setting is the settings model's business, not the sheet's: a
 *   declared `default` fills it in.)
 */
import { contentPages } from "@shared/schema";
import { cleanCell, normalizeCell } from "./workbook-settings";

/** Sheet names, as the workbook writes and the import looks them up. */
export const PAGE_SHEET_NAME = "Страницы";
export const PAGE_FIELD_SHEET_NAME = "Поля страниц";

export const PAGE_HEADERS = [
  "Зона", "Раздел", "Вид", "Номер", "Вариант", "Режим", "Автопереход", "Задержка, мс",
];
export const PAGE_WIDTHS = [16, 28, 20, 8, 24, 16, 14, 14];

export const PAGE_FIELD_HEADERS = ["Зона", "Раздел", "Вид", "Номер", "Куда", "Ключ", "Значение"];
export const PAGE_FIELD_WIDTHS = [16, 28, 20, 8, 14, 30, 80];

/** Column keys, taken from the headers so a rename lands in one place. */
const [PG_ZONE, PG_TOPIC, PG_KIND, PG_INDEX, PG_VARIANT, PG_MODE, PG_AUTO, PG_DELAY] = PAGE_HEADERS;
const [PF_ZONE, PF_TOPIC, PF_KIND, PF_INDEX, PF_TARGET, PF_KEY, PF_VALUE] = PAGE_FIELD_HEADERS;

/** «Тема» is the legacy spelling of the «Раздел» column, accepted by every sheet here. */
const TOPIC_COL_LEGACY = "Тема";

const YES = "Да";
const NO = "Нет";

// ─── Value dictionaries ──────────────────────────────────────────────────────

/** `content_pages.position` — the zone a page lives in. */
const ZONE_TO = {
  before: "До теста",
  after: "После теста",
  before_topic: "До темы",
  after_topic: "После темы",
} as const;

export type PageZone = keyof typeof ZONE_TO;

/** Zones addressed by a topic; the other two belong to the test as a whole. */
const TOPIC_ZONES = new Set<PageZone>(["before_topic", "after_topic"]);

/**
 * `content_pages.kind` — the functional role of a page. Of these only `info` is authored;
 * the rest are materialised by the lifecycle service from the scenario and the topic list.
 *
 * `summary` is deliberately ABSENT: PRD-19 replaced the legacy per-topic `intro`/`summary`
 * pair with the `review` / `section-results` nodes, so the workbook does not offer it. It is
 * still a valid column value on old rows, so {@link parsePageSheets} accepts it spelled as
 * the stored value — see {@link LEGACY_KINDS}.
 */
const KIND_TO = {
  start: "Стартовая",
  questions: "Вопросы",
  router: "Маршрутизатор",
  intro: "Введение раздела",
  review: "Обзор",
  "section-results": "Итоги раздела",
  results: "Итоги",
  info: "Авторская",
} as const;

export type PageKind = (typeof contentPages.kind.enumValues)[number];

/** Kinds accepted on import but never offered by the template. */
const LEGACY_KINDS: readonly PageKind[] = ["summary"];

/** `content_pages.mode` — how the page is rendered. */
const MODE_TO = { template: "Шаблон", standard: "Стандартный", html: "HTML" } as const;

export type PageMode = keyof typeof MODE_TO;

/** «Куда» — which of the page's two field columns a row belongs to. */
const TARGET_TO = { values_json: "Содержание", settings_json: "Настройка" } as const;

export type PageFieldTarget = keyof typeof TARGET_TO;

/** Values of the closed columns — the workbook template turns them into drop-downs. */
export const PAGE_ZONE_CHOICES = Object.values(ZONE_TO);
export const PAGE_KIND_CHOICES = Object.values(KIND_TO);
export const PAGE_MODE_CHOICES = Object.values(MODE_TO);
export const PAGE_TARGET_CHOICES = Object.values(TARGET_TO);

// ─── Shapes ──────────────────────────────────────────────────────────────────

/**
 * Export input: a `content_pages` row with its topic resolved to a NAME — the only key the
 * sheet has for a topic. Deliberately looser than the row type: the JSON columns are `jsonb`
 * and rows written by older versions carry other shapes there.
 */
export interface PageSource {
  position: string;
  /** Topic name for the topic zones; empty or absent for the test zones. */
  topicName?: string | null;
  kind: string;
  templateKey?: string | null;
  mode?: string | null;
  autoAdvance?: boolean | null;
  autoAdvanceDelayMs?: number | null;
  /** `values_json` as stored: authored values live under `values`. */
  valuesJson?: unknown;
  settingsJson?: unknown;
}

/** One page as the two sheets describe it. */
export interface ParsedPage {
  zone: PageZone;
  /** Topic name as the author spelled it; empty for the test zones. */
  topicName: string;
  /** {@link normalizeCell}-normalised topic name — the key «Структура» uses for a section. */
  topicKey: string;
  kind: PageKind;
  /** Ordinal within the zone, from 1. Part of the address, not of the page's state. */
  index: number;
  /** `undefined` = the column was empty, so the page keeps whatever it has now. */
  templateKey?: string;
  mode?: PageMode;
  autoAdvance?: boolean;
  autoAdvanceDelayMs?: number;
  /** Keys of `values_json.values` named by «Поля страниц». */
  values: Record<string, unknown>;
  /** Keys of `settings_json` named by «Поля страниц». */
  settings: Record<string, unknown>;
}

/** Result of reading both sheets. */
export interface ParsedPageSheets {
  /** Pages in sheet order; the import walks them as the author reads them. */
  pages: ParsedPage[];
  errors: string[];
}

/** A page that can be addressed by the sheet, with its ordinal already assigned. */
interface AddressedPage {
  page: PageSource;
  zone: PageZone;
  topicName: string;
  kind: PageKind;
  index: number;
}

// ─── Export ──────────────────────────────────────────────────────────────────

function isZone(value: string): value is PageZone {
  return Object.prototype.hasOwnProperty.call(ZONE_TO, value);
}

function isKind(value: string): value is PageKind {
  return (contentPages.kind.enumValues as readonly string[]).includes(value);
}

/** A branch of a `jsonb` column, safe against `null` and against a foreign shape. */
function branch(value: unknown, ...path: string[]): Record<string, unknown> {
  let cur: unknown = value;
  for (const key of path) {
    if (typeof cur !== "object" || cur === null) return {};
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "object" && cur !== null ? (cur as Record<string, unknown>) : {};
}

/**
 * Pages in sheet order with their ordinals, shared by BOTH serializers so the addresses on
 * the two sheets cannot drift apart.
 *
 * The ordinal counts within the ZONE and not within «вид + зона»: the zone is what the
 * import replaces wholesale for author pages, so it is the unit the numbering has to be
 * stable inside.
 *
 * A page that cannot be addressed is skipped rather than written as an unloadable row: an
 * unknown zone or kind has no cell spelling, and a topic-zone page without a topic name has
 * no second address part — the sheet holds no other key for it.
 */
function addressed(pages: readonly PageSource[]): AddressedPage[] {
  const out: AddressedPage[] = [];
  const nextByZone = new Map<string, number>();

  for (const page of pages) {
    const zone = String(page.position ?? "");
    const kind = String(page.kind ?? "");
    if (!isZone(zone) || !isKind(kind)) continue;
    const topicName = cleanCell(String(page.topicName ?? ""));
    if (TOPIC_ZONES.has(zone) !== (topicName !== "")) continue;

    const zoneKey = `${zone}|${normalizeCell(topicName)}`;
    const index = (nextByZone.get(zoneKey) ?? 0) + 1;
    nextByZone.set(zoneKey, index);
    out.push({ page, zone, topicName, kind, index });
  }
  return out;
}

/**
 * A field value as a cell. Scalars keep their literal spelling so the import's coercion
 * (`Number(raw)`, `raw === "true"`) reads them back; anything structured travels as compact
 * JSON, which {@link decodeFieldValue} turns back into an object.
 */
function encodeFieldValue(value: unknown): string {
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
 * editor can produce, whereas a `resultField` placeholder is — so the asymmetry is worth it.
 */
function decodeFieldValue(raw: string): unknown {
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

/** Export of the «Страницы» sheet: one row per addressable page. */
export function serializePageRows(pages: readonly PageSource[] = []): Record<string, unknown>[] {
  return addressed(pages).map(({ page, zone, topicName, kind, index }) => {
    const mode = String(page.mode ?? "");
    const delay = page.autoAdvanceDelayMs;
    return {
      [PG_ZONE]: ZONE_TO[zone],
      [PG_TOPIC]: topicName,
      [PG_KIND]: KIND_TO[kind as keyof typeof KIND_TO] ?? kind,
      [PG_INDEX]: index,
      [PG_VARIANT]: String(page.templateKey ?? ""),
      // An unknown mode travels as itself: an empty cell would read as "leave as is" and
      // quietly drop a value the editor still shows.
      [PG_MODE]: MODE_TO[mode as PageMode] ?? mode,
      [PG_AUTO]: page.autoAdvance ? YES : NO,
      [PG_DELAY]: typeof delay === "number" ? String(delay) : "",
    };
  });
}

/**
 * Export of the «Поля страниц» sheet: one row per key of `values_json.values` and of
 * `settings_json`, content first, in the order the columns store them.
 *
 * `values_json.placeholderStyles` is NOT written: an author font size survives only when the
 * variant opted into it, so it is a property of the variant rather than transferable content
 * (plan «Что план НЕ делает»).
 */
export function serializePageFieldRows(pages: readonly PageSource[] = []): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const { page, zone, topicName, kind, index } of addressed(pages)) {
    const address = {
      [PF_ZONE]: ZONE_TO[zone],
      [PF_TOPIC]: topicName,
      [PF_KIND]: KIND_TO[kind as keyof typeof KIND_TO] ?? kind,
      [PF_INDEX]: index,
    };
    const branches: [PageFieldTarget, Record<string, unknown>][] = [
      ["values_json", branch(page.valuesJson, "values")],
      ["settings_json", branch(page.settingsJson)],
    ];
    for (const [target, fields] of branches) {
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        rows.push({
          ...address,
          [PF_TARGET]: TARGET_TO[target],
          [PF_KEY]: key,
          [PF_VALUE]: encodeFieldValue(value),
        });
      }
    }
  }
  return rows;
}

// ─── Import ──────────────────────────────────────────────────────────────────

/** Is every cell of the row blank? Excel keeps trailing rows that carry nothing. */
function isBlankRow(row: Record<string, unknown>, headers: string[]): boolean {
  return headers.every((h) => String(row[h] ?? "").trim() === "");
}

/** A value by its label or by the stored value itself, so a hand-filled `html` also loads. */
function byLabelOrValue<T extends string>(
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

/** The zone + section half of an address, shared by both sheets. */
type Scope = { zone: PageZone; topicName: string; topicKey: string };

/**
 * Read the «Зона» + «Раздел» pair.
 *
 * A test-zone row carrying a topic name is an ERROR rather than a name ignored: the two
 * columns exist so that a page's scope is never guessed at, and a copied-but-not-cleared
 * cell is exactly the mistake they are meant to catch. A topic zone without a name is the
 * mirror error — there is nothing to attach the page to.
 */
function readScope(row: Record<string, unknown>, zoneCol: string, topicCol: string):
  { ok: true; value: Scope } | { ok: false; error: string } {
  const zoneRaw = String(row[zoneCol] ?? "");
  const zone = byLabelOrValue(ZONE_TO, zoneRaw);
  if (!zone) {
    return {
      ok: false,
      error: `неизвестная «${zoneCol}»: "${zoneRaw}"; ожидается одно из: ${PAGE_ZONE_CHOICES.join(", ")}`,
    };
  }
  const topicName = cleanCell(String(row[topicCol] ?? row[TOPIC_COL_LEGACY] ?? ""));
  if (TOPIC_ZONES.has(zone)) {
    if (topicName === "") return { ok: false, error: `для зоны «${ZONE_TO[zone]}» не указан «${topicCol}»` };
  } else if (topicName !== "") {
    return { ok: false, error: `для зоны «${ZONE_TO[zone]}» колонка «${topicCol}» должна быть пустой` };
  }
  return { ok: true, value: { zone, topicName, topicKey: normalizeCell(topicName) } };
}

/** Read the «Вид» column. */
function readKind(row: Record<string, unknown>, kindCol: string):
  { ok: true; value: PageKind } | { ok: false; error: string } {
  const raw = String(row[kindCol] ?? "");
  const kind = byLabelOrValue(KIND_TO, raw, LEGACY_KINDS) as PageKind | undefined;
  if (!kind) {
    return {
      ok: false,
      error: `неизвестный «${kindCol}»: "${raw}"; ожидается одно из: ${PAGE_KIND_CHOICES.join(", ")}`,
    };
  }
  return { ok: true, value: kind };
}

/** Read a whole-number cell; an empty cell yields `undefined`. */
function readInt(row: Record<string, unknown>, col: string):
  { ok: true; value?: number } | { ok: false; error: string } {
  const raw = String(row[col] ?? "");
  const cleaned = cleanCell(raw);
  if (cleaned === "") return { ok: true };
  if (!/^\d+$/.test(cleaned)) return { ok: false, error: `«${col}»: нужно целое число, получено "${raw}"` };
  return { ok: true, value: Number(cleaned) };
}

/** Address key of a page: the four parts, with the topic folded the way «Структура» folds it. */
function addressKey(scope: Scope, kind: PageKind, index: number): string {
  return `${scope.zone}|${scope.topicKey}|${kind}|${index}`;
}

/** Human spelling of an address, for an error the author can act on. */
function addressLabel(scope: Scope, kind: PageKind, index?: number): string {
  const parts: string[] = [ZONE_TO[scope.zone]];
  if (scope.topicName) parts.push(scope.topicName);
  parts.push(KIND_TO[kind as keyof typeof KIND_TO] ?? kind);
  if (index !== undefined) parts.push(`№${index}`);
  return parts.join(" / ");
}

/**
 * Human spelling of a parsed page's address — «До теста / Стартовая / №1».
 *
 * Exported because the IMPORT reports about a page too («не найдена на приёмнике», «вариант
 * не объявлен шаблоном»), and an address spelled by hand there would drift from the one the
 * sheets print the moment a label changes.
 */
export function formatPageAddress(page: ParsedPage): string {
  const scope: Scope = { zone: page.zone, topicName: page.topicName, topicKey: page.topicKey };
  return addressLabel(scope, page.kind, page.index);
}

/**
 * Read both sheets into a set of pages with their field values.
 *
 * Rows are independent: a row with an error is dropped and the rest are applied, as on every
 * other sheet of the workbook. «Поля страниц» is read AFTER «Страницы», so a field row whose
 * address is not on the first sheet is an orphan — reported with the address spelled out,
 * since that is the only thing the author can go and fix.
 *
 * The values themselves are NOT checked here against anything: this module has no manifest.
 * The import must run every key and value through the page-fields service before storing —
 * see the module note.
 */
export function parsePageSheets(
  pageRows: Record<string, unknown>[] = [],
  fieldRows: Record<string, unknown>[] = [],
): ParsedPageSheets {
  const errors: string[] = [];
  const pages: ParsedPage[] = [];
  const byAddress = new Map<string, ParsedPage>();
  /** Highest ordinal used in a zone so far — an empty «Номер» takes the next one. */
  const maxIndexByZone = new Map<string, number>();

  pageRows.forEach((row, i) => {
    if (isBlankRow(row, PAGE_HEADERS)) return;
    const where = `Лист «${PAGE_SHEET_NAME}», строка ${i + 2}`;

    const scope = readScope(row, PG_ZONE, PG_TOPIC);
    if (!scope.ok) {
      errors.push(`${where}: ${scope.error}`);
      return;
    }
    const kind = readKind(row, PG_KIND);
    if (!kind.ok) {
      errors.push(`${where}: ${kind.error}`);
      return;
    }
    const parsedIndex = readInt(row, PG_INDEX);
    if (!parsedIndex.ok) {
      errors.push(`${where}: ${parsedIndex.error}`);
      return;
    }
    if (parsedIndex.value === 0) {
      errors.push(`${where}: «${PG_INDEX}» считается с 1`);
      return;
    }

    const zoneKey = `${scope.value.zone}|${scope.value.topicKey}`;
    // An empty «Номер» takes the next free ordinal of its zone: a hand-written sheet need
    // not number a zone that holds one page, and the number can never collide this way.
    const index = parsedIndex.value ?? (maxIndexByZone.get(zoneKey) ?? 0) + 1;
    maxIndexByZone.set(zoneKey, Math.max(maxIndexByZone.get(zoneKey) ?? 0, index));

    const key = addressKey(scope.value, kind.value, index);
    if (byAddress.has(key)) {
      errors.push(`${where}: адрес «${addressLabel(scope.value, kind.value, index)}» уже занят выше`);
      return;
    }

    const mode = cleanCell(String(row[PG_MODE] ?? ""));
    const modeValue = mode === "" ? undefined : byLabelOrValue(MODE_TO, mode);
    if (mode !== "" && !modeValue) {
      errors.push(
        `${where}: неизвестный «${PG_MODE}»: "${mode}"; ожидается одно из: ${PAGE_MODE_CHOICES.join(", ")}`,
      );
      return;
    }

    const autoRaw = normalizeCell(String(row[PG_AUTO] ?? ""));
    let autoAdvance: boolean | undefined;
    if (autoRaw === normalizeCell(YES)) autoAdvance = true;
    else if (autoRaw === normalizeCell(NO)) autoAdvance = false;
    else if (autoRaw !== "") {
      errors.push(`${where}: «${PG_AUTO}» должен быть «${YES}» или «${NO}», получено "${String(row[PG_AUTO])}"`);
      return;
    }

    const delay = readInt(row, PG_DELAY);
    if (!delay.ok) {
      errors.push(`${where}: ${delay.error}`);
      return;
    }
    const templateKey = cleanCell(String(row[PG_VARIANT] ?? ""));

    const page: ParsedPage = {
      zone: scope.value.zone,
      topicName: scope.value.topicName,
      topicKey: scope.value.topicKey,
      kind: kind.value,
      index,
      templateKey: templateKey === "" ? undefined : templateKey,
      mode: modeValue,
      autoAdvance,
      autoAdvanceDelayMs: delay.value,
      values: {},
      settings: {},
    };
    pages.push(page);
    byAddress.set(key, page);
  });

  fieldRows.forEach((row, i) => {
    if (isBlankRow(row, PAGE_FIELD_HEADERS)) return;
    const where = `Лист «${PAGE_FIELD_SHEET_NAME}», строка ${i + 2}`;

    const scope = readScope(row, PF_ZONE, PF_TOPIC);
    if (!scope.ok) {
      errors.push(`${where}: ${scope.error}`);
      return;
    }
    const kind = readKind(row, PF_KIND);
    if (!kind.ok) {
      errors.push(`${where}: ${kind.error}`);
      return;
    }
    const parsedIndex = readInt(row, PF_INDEX);
    if (!parsedIndex.ok) {
      errors.push(`${where}: ${parsedIndex.error}`);
      return;
    }

    let page: ParsedPage | undefined;
    if (parsedIndex.value !== undefined) {
      page = byAddress.get(addressKey(scope.value, kind.value, parsedIndex.value));
    } else {
      // An empty «Номер» means "the page of this kind in this zone". Ambiguity is an error
      // rather than a guess: picking the first would attach the value to the wrong page.
      const candidates = pages.filter(
        (p) => p.zone === scope.value.zone && p.topicKey === scope.value.topicKey && p.kind === kind.value,
      );
      if (candidates.length > 1) {
        errors.push(
          `${where}: в зоне «${addressLabel(scope.value, kind.value)}» несколько страниц; укажите «${PF_INDEX}»`,
        );
        return;
      }
      page = candidates[0];
    }
    if (!page) {
      errors.push(
        `${where}: страница «${addressLabel(scope.value, kind.value, parsedIndex.value)}» `
        + `не названа на листе «${PAGE_SHEET_NAME}»`,
      );
      return;
    }

    const targetRaw = String(row[PF_TARGET] ?? "");
    const target = byLabelOrValue(TARGET_TO, targetRaw);
    if (!target) {
      errors.push(
        `${where}: неизвестное «${PF_TARGET}»: "${targetRaw}"; ожидается одно из: ${PAGE_TARGET_CHOICES.join(", ")}`,
      );
      return;
    }
    const key = cleanCell(String(row[PF_KEY] ?? ""));
    if (key === "") {
      errors.push(`${where}: не указан «${PF_KEY}»`);
      return;
    }

    // A key repeated for the same page ends up at its LAST row: the sheet is a list of
    // fields, of which a page has one each, and the author reads it top to bottom.
    const bucket = target === "values_json" ? page.values : page.settings;
    bucket[key] = decodeFieldValue(String(row[PF_VALUE] ?? ""));
  });

  return { pages, errors };
}
