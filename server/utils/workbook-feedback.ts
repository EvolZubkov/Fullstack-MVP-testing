/**
 * @module server/utils/workbook-feedback
 * @description The «Обратная связь» and «Рекомендации» sheets of the test workbook
 * (PRD-48 §4, FR-12/FR-13): ONE contract read by both the export and the import.
 *
 * Feedback belongs to an OWNER — the test (`tests.feedback_json`) or a section
 * (`test_sections.feedback_json`); the shape is the same on both. Recommended courses,
 * materials and events are not separate entities: they live INSIDE the owner's
 * `feedback_json` (`links` / `assets` / `events` of `feedbackContentSchema`). That is why
 * «Рекомендации» is subordinate to «Обратная связь» exactly as «Квоты» is subordinate to
 * «Структура»: a recommendation whose owner is not named on «Обратная связь» has nowhere
 * to be stored, and is a row error rather than a silent new owner.
 *
 * The owner is addressed by TWO columns, «Уровень» and «Раздел», not by one. A topic
 * literally named «Тест» exists in the bank, and a reserved word in a shared column would
 * quietly move that topic's feedback up to the test level.
 *
 * Application rules (spec §4, plan «Правила применения»):
 * - an absent «Обратная связь» sheet changes nobody's feedback. An absent «Рекомендации»
 *   sheet is NOT the same thing: an owner named on «Обратная связь» takes its whole
 *   feedback from the workbook, so with no rows to attach it ends up with no courses,
 *   materials or events. That is the price of "named = whole", and the import warns about
 *   it rather than staying silent — an author who kept only the feedback sheet to fix a
 *   typo would otherwise lose every attachment without a word;
 * - an owner named on the sheet takes its feedback WHOLE from the workbook: text and format
 *   from its own row, courses/materials/events from the «Рекомендации» rows with the same
 *   owner. Named without recommendations means it ends up without them — recommendations
 *   are a branch of its feedback, and "no rows" here reads as "none", not "leave as is";
 * - an owner NOT named on the sheet is not touched at all;
 * - an owner named TWICE is applied by its LAST occurrence: the sheet is a list of owners,
 *   of which there is one row each, so a duplicate is a hand-edit artefact and the author
 *   reads the sheet top to bottom. Recommendations, being keyed by owner rather than by
 *   row, accumulate across all of that owner's rows;
 * - empty «Текст» with no recommendations means "there is no feedback": the owner is given
 *   `null`, not an empty structure.
 */
import {
  feedbackLinkSchema,
  feedbackAssetSchema,
  feedbackEventSchema,
  type FeedbackContent,
  type FeedbackFormat,
  type FeedbackLink,
  type FeedbackAsset,
  type FeedbackEvent,
} from "@shared/schema";
import { FORMAT_LABELS, cleanCell, normalizeCell } from "./workbook-settings";

/** Sheet names, as the workbook writes and the import looks them up. */
export const FEEDBACK_SHEET_NAME = "Обратная связь";
export const RECOMMENDATION_SHEET_NAME = "Рекомендации";

export const FEEDBACK_HEADERS = ["Уровень", "Раздел", "Формат", "Текст"];
export const FEEDBACK_WIDTHS = [12, 28, 20, 80];

export const RECOMMENDATION_HEADERS = ["Уровень", "Раздел", "Тип", "Заголовок", "Ссылка"];
export const RECOMMENDATION_WIDTHS = [12, 28, 16, 34, 46];

/** Column keys, taken from the headers so a rename lands in one place. */
const [FB_LEVEL, FB_TOPIC, FB_FORMAT, FB_TEXT] = FEEDBACK_HEADERS;
const [RC_LEVEL, RC_TOPIC, RC_TYPE, RC_TITLE, RC_URL] = RECOMMENDATION_HEADERS;

/** «Тема» is the legacy spelling of the «Раздел» column, accepted by every sheet here. */
const TOPIC_COL_LEGACY = "Тема";

const LEVEL_TEST = "Тест";
const LEVEL_SECTION = "Раздел";

/** Values of the «Уровень» column — the workbook template turns them into a drop-down. */
export const LEVEL_CHOICES = [LEVEL_TEST, LEVEL_SECTION];

/**
 * Recommendation kinds by the branch of `feedback_json` they live in. The labels are the
 * editor's: «Курсы» are links, «Материалы» are assets, «Мероприятия» are events.
 */
const RECOMMENDATION_TYPE_TO = {
  link: "Курс",
  asset: "Материал",
  event: "Мероприятие",
} as const;

type RecommendationKind = keyof typeof RECOMMENDATION_TYPE_TO;

/** Values of the «Тип» column — the workbook template turns them into a drop-down. */
export const RECOMMENDATION_TYPE_CHOICES = Object.values(RECOMMENDATION_TYPE_TO);

/**
 * Values of the «Формат» column. The dictionary itself is the ONE the «Настройки» sheet
 * uses for intro-block formats — imported, never copied, so the labels cannot drift apart.
 */
export const FEEDBACK_FORMAT_CHOICES = Object.values(FORMAT_LABELS);

/** What the sheets produce for an owner: a feedback structure, or `null` for "none". */
export type FeedbackPayload = FeedbackContent;

/** One recommendation as it is stored: everything below has a title and an optional URL. */
interface RecommendationSource {
  title?: string | null;
  url?: string | null;
}

/**
 * Export input. Deliberately looser than {@link FeedbackContent}: the column is `jsonb`,
 * and rows written before `events` existed carry neither the field nor a format.
 */
export interface FeedbackSource {
  format?: string | null;
  text?: string | null;
  links?: readonly RecommendationSource[] | null;
  assets?: readonly RecommendationSource[] | null;
  events?: readonly RecommendationSource[] | null;
}

/** A section as the export sees it: addressed by TOPIC NAME, the only key the sheet has. */
export interface FeedbackSectionSource {
  topicName: string;
  feedback?: FeedbackSource | null;
}

/** Result of reading both sheets. */
export interface ParsedFeedbackSheets {
  /** `undefined` = the test level was not named at all, so its feedback is not touched. */
  test?: FeedbackPayload | null;
  /** Keyed by {@link normalizeCell}-normalized topic name, as «Структура» keys sections. */
  byTopic: Map<string, FeedbackPayload | null>;
  /**
   * The same keys mapped to the spelling the author used. The import reports a section that
   * «Структура» does not contain, and the author can only find it by the name they typed.
   */
  topicNames: Map<string, string>;
  errors: string[];
}

/** Owner of a row, resolved from the «Уровень» + «Раздел» pair. */
type Owner = { kind: "test" } | { kind: "section"; key: string; name: string };

/** Accumulator of one owner's feedback while both sheets are being read. */
interface OwnerDraft {
  format: FeedbackFormat;
  text: string;
  links: FeedbackLink[];
  assets: FeedbackAsset[];
  events: FeedbackEvent[];
}

// ─── Export ──────────────────────────────────────────────────────────────────

/** Label of a stored format; an unknown value travels as itself rather than as an empty cell. */
function formatLabel(format: unknown): string {
  if (typeof format !== "string" || format === "") return FORMAT_LABELS.plain;
  return FORMAT_LABELS[format as FeedbackFormat] ?? format;
}

function recommendationsOf(fb: FeedbackSource): readonly RecommendationSource[] {
  return [...(fb.links ?? []), ...(fb.assets ?? []), ...(fb.events ?? [])];
}

/**
 * Does the owner carry anything worth a row? An owner with neither text nor recommendations
 * is NOT written out: a row would mean "erase the target's feedback", and the source has
 * nothing to transfer. An author who wants the target's feedback gone clears the «Текст»
 * cell of the row that is there — that is the documented way to say "none".
 */
function hasFeedback(fb?: FeedbackSource | null): fb is FeedbackSource {
  if (!fb) return false;
  const text = String(fb.text ?? "").trim();
  return text !== "" || recommendationsOf(fb).length > 0;
}

/** Owners in sheet order: the test first, then the sections as «Структура» lists them. */
function ownersOf(
  testFeedback: FeedbackSource | null | undefined,
  sections: readonly FeedbackSectionSource[],
): { level: string; topicName: string; feedback: FeedbackSource }[] {
  const owners: { level: string; topicName: string; feedback: FeedbackSource }[] = [];
  if (hasFeedback(testFeedback)) {
    owners.push({ level: LEVEL_TEST, topicName: "", feedback: testFeedback });
  }
  for (const section of sections) {
    // A section with no topic name cannot be addressed by the sheet at all — the sheet has
    // no other key for it — so it is skipped instead of producing an unloadable row.
    if (!hasFeedback(section.feedback) || !String(section.topicName ?? "").trim()) continue;
    owners.push({
      level: LEVEL_SECTION,
      topicName: String(section.topicName),
      feedback: section.feedback,
    });
  }
  return owners;
}

/** Export of the «Обратная связь» sheet: one row per owner that has feedback. */
export function serializeFeedbackRows(
  testFeedback: FeedbackSource | null | undefined,
  sections: readonly FeedbackSectionSource[] = [],
): Record<string, unknown>[] {
  return ownersOf(testFeedback, sections).map((owner) => ({
    [FB_LEVEL]: owner.level,
    [FB_TOPIC]: owner.topicName,
    [FB_FORMAT]: formatLabel(owner.feedback.format),
    [FB_TEXT]: String(owner.feedback.text ?? ""),
  }));
}

/**
 * Export of the «Рекомендации» sheet: one row per course, material and event of every owner
 * named on «Обратная связь», in that order.
 *
 * An entry with a blank title is dropped: `feedbackContentSchema` requires a title, so such
 * an entry cannot be stored on the far side either — writing it would give the export a row
 * its own import is bound to refuse.
 */
export function serializeRecommendationRows(
  testFeedback: FeedbackSource | null | undefined,
  sections: readonly FeedbackSectionSource[] = [],
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const owner of ownersOf(testFeedback, sections)) {
    const branches: [RecommendationKind, readonly RecommendationSource[]][] = [
      ["link", owner.feedback.links ?? []],
      ["asset", owner.feedback.assets ?? []],
      ["event", owner.feedback.events ?? []],
    ];
    for (const [kind, items] of branches) {
      for (const item of items) {
        const title = String(item?.title ?? "").trim();
        if (!title) continue;
        rows.push({
          [RC_LEVEL]: owner.level,
          [RC_TOPIC]: owner.topicName,
          [RC_TYPE]: RECOMMENDATION_TYPE_TO[kind],
          [RC_TITLE]: title,
          [RC_URL]: String(item?.url ?? ""),
        });
      }
    }
  }
  return rows;
}

// ─── Import ──────────────────────────────────────────────────────────────────

/** Format by label or by the stored value itself, so a hand-filled `html` also loads. */
function parseFormat(raw: string): { ok: true; value: FeedbackFormat } | { ok: false; error: string } {
  const cleaned = cleanCell(raw);
  if (cleaned === "") return { ok: true, value: "plain" };
  const byLabel = Object.entries(FORMAT_LABELS).find(([, l]) => normalizeCell(l) === normalizeCell(raw));
  if (byLabel) return { ok: true, value: byLabel[0] as FeedbackFormat };
  if (Object.prototype.hasOwnProperty.call(FORMAT_LABELS, cleaned)) {
    return { ok: true, value: cleaned as FeedbackFormat };
  }
  return {
    ok: false,
    error: `недопустимый «${FB_FORMAT}»: "${raw}"; ожидается одно из: ${FEEDBACK_FORMAT_CHOICES.join(", ")}`,
  };
}

/** Is every cell of the row blank? Excel keeps trailing rows that carry nothing. */
function isBlankRow(row: Record<string, unknown>, headers: string[]): boolean {
  return headers.every((h) => String(row[h] ?? "").trim() === "");
}

/**
 * Resolve the owner of a row from the «Уровень» + «Раздел» pair.
 *
 * A test-level row with a topic name is an ERROR rather than a topic name ignored: the two
 * columns exist so that an owner is never guessed at, and a copied-but-not-cleared cell is
 * exactly the mistake they are meant to catch.
 */
function readOwner(
  row: Record<string, unknown>,
  levelCol: string,
  topicCol: string,
): { ok: true; value: Owner } | { ok: false; error: string } {
  const levelRaw = String(row[levelCol] ?? "");
  const level = normalizeCell(levelRaw);
  const topicName = cleanCell(String(row[topicCol] ?? row[TOPIC_COL_LEGACY] ?? ""));

  if (level === normalizeCell(LEVEL_TEST)) {
    if (topicName !== "") {
      return { ok: false, error: `для уровня «${LEVEL_TEST}» колонка «${topicCol}» должна быть пустой` };
    }
    return { ok: true, value: { kind: "test" } };
  }
  if (level === normalizeCell(LEVEL_SECTION) || level === normalizeCell(TOPIC_COL_LEGACY)) {
    if (topicName === "") return { ok: false, error: "не указан раздел (тема)" };
    return { ok: true, value: { kind: "section", key: normalizeCell(topicName), name: topicName } };
  }
  return {
    ok: false,
    error: `неизвестный «${levelCol}»: "${levelRaw}"; ожидается одно из: ${LEVEL_CHOICES.join(", ")}`,
  };
}

/** An owner with neither text nor recommendations means "there is no feedback". */
function finalize(draft: OwnerDraft): FeedbackPayload | null {
  const empty = draft.text.trim() === ""
    && draft.links.length === 0
    && draft.assets.length === 0
    && draft.events.length === 0;
  if (empty) return null;
  return {
    format: draft.format,
    text: draft.text,
    links: draft.links,
    assets: draft.assets,
    events: draft.events,
  };
}

/**
 * Read a «Рекомендации» row into its owner's draft.
 *
 * The three kinds are validated by their OWN schemas, and their strictness differs on
 * purpose — do not level it out:
 * - a course ({@link feedbackLinkSchema}) requires a real URL;
 * - an event ({@link feedbackEventSchema}) may have no URL: an event need not have a
 *   registration page;
 * - a material ({@link feedbackAssetSchema}) has an optional and UNVALIDATED URL — PRD-42 §7
 *   technical debt: legacy descriptors keep the relative media-library address there, and a
 *   strict check would refuse to save any test carrying one.
 */
function applyRecommendation(
  draft: OwnerDraft,
  kind: RecommendationKind,
  title: string,
  url: string,
): string | undefined {
  if (kind === "link") {
    if (url === "") return `для типа «${RECOMMENDATION_TYPE_TO.link}» «${RC_URL}» обязательна`;
    const parsed = feedbackLinkSchema.safeParse({ title, url });
    if (!parsed.success) return `некорректная «${RC_URL}»: "${url}"`;
    draft.links.push(parsed.data);
    return;
  }
  if (kind === "asset") {
    const parsed = feedbackAssetSchema.safeParse({ title, url });
    if (!parsed.success) return `некорректный материал: "${title}"`;
    draft.assets.push(parsed.data);
    return;
  }
  const parsed = feedbackEventSchema.safeParse({ title, url });
  if (!parsed.success) return `некорректная «${RC_URL}»: "${url}"`;
  draft.events.push(parsed.data);
  return;
}

/**
 * Read both sheets into per-owner feedback.
 *
 * Rows are independent: a row with an error is dropped and the rest are applied, as on every
 * other sheet of the workbook. The «Рекомендации» sheet is read AFTER «Обратная связь», so
 * an owner missing from the first sheet makes its recommendation an orphan — reported with
 * the owner's name, since that name is the only thing the author can go and fix.
 */
export function parseFeedbackSheets(
  feedbackRows: Record<string, unknown>[] = [],
  recommendationRows: Record<string, unknown>[] = [],
): ParsedFeedbackSheets {
  const errors: string[] = [];
  const topicDrafts = new Map<string, OwnerDraft>();
  const topicNames = new Map<string, string>();
  let testDraft: OwnerDraft | undefined;

  const newDraft = (format: FeedbackFormat, text: string): OwnerDraft =>
    ({ format, text, links: [], assets: [], events: [] });

  feedbackRows.forEach((row, i) => {
    if (isBlankRow(row, FEEDBACK_HEADERS)) return;
    const where = `Лист «${FEEDBACK_SHEET_NAME}», строка ${i + 2}`;

    const owner = readOwner(row, FB_LEVEL, FB_TOPIC);
    if (!owner.ok) {
      errors.push(`${where}: ${owner.error}`);
      return;
    }
    const format = parseFormat(String(row[FB_FORMAT] ?? ""));
    if (!format.ok) {
      errors.push(`${where}: ${format.error}`);
      return;
    }
    // Free text is stored verbatim — its inner spacing is what the author typed. Only a
    // whitespace-only cell is levelled to "" so that it reads as "there is no feedback".
    const raw = String(row[FB_TEXT] ?? "");
    const text = raw.trim() === "" ? "" : raw;

    if (owner.value.kind === "test") {
      // Last occurrence wins; recommendations already collected for the owner survive,
      // because they are keyed by owner rather than by row.
      testDraft = testDraft
        ? { ...testDraft, format: format.value, text }
        : newDraft(format.value, text);
      return;
    }
    const { key, name } = owner.value;
    const existing = topicDrafts.get(key);
    topicDrafts.set(key, existing ? { ...existing, format: format.value, text } : newDraft(format.value, text));
    topicNames.set(key, name);
  });

  recommendationRows.forEach((row, i) => {
    if (isBlankRow(row, RECOMMENDATION_HEADERS)) return;
    const where = `Лист «${RECOMMENDATION_SHEET_NAME}», строка ${i + 2}`;

    const owner = readOwner(row, RC_LEVEL, RC_TOPIC);
    if (!owner.ok) {
      errors.push(`${where}: ${owner.error}`);
      return;
    }
    const draft = owner.value.kind === "test" ? testDraft : topicDrafts.get(owner.value.key);
    if (!draft) {
      const who = owner.value.kind === "test"
        ? `уровень «${LEVEL_TEST}»`
        : `раздел «${owner.value.name}»`;
      errors.push(`${where}: ${who} не назван на листе «${FEEDBACK_SHEET_NAME}»`);
      return;
    }

    const typeRaw = String(row[RC_TYPE] ?? "");
    const kindEntry = Object.entries(RECOMMENDATION_TYPE_TO)
      .find(([, label]) => normalizeCell(label) === normalizeCell(typeRaw));
    if (!kindEntry) {
      errors.push(
        `${where}: неизвестный «${RC_TYPE}»: "${typeRaw}"; `
        + `ожидается одно из: ${RECOMMENDATION_TYPE_CHOICES.join(", ")}`,
      );
      return;
    }
    const title = String(row[RC_TITLE] ?? "").trim();
    if (!title) {
      errors.push(`${where}: не указан «${RC_TITLE}»`);
      return;
    }
    const error = applyRecommendation(draft, kindEntry[0] as RecommendationKind, title, String(row[RC_URL] ?? "").trim());
    if (error) errors.push(`${where}: ${error}`);
  });

  const byTopic = new Map<string, FeedbackPayload | null>();
  for (const [key, draft] of topicDrafts) byTopic.set(key, finalize(draft));

  return {
    test: testDraft ? finalize(testDraft) : undefined,
    byTopic,
    topicNames,
    errors,
  };
}
