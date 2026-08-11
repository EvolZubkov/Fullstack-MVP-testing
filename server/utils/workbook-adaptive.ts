/**
 * @module server/utils/workbook-adaptive
 * @description The «Адаптивные уровни» sheet of the test workbook (PRD-48 §4, FR-16): ONE
 * contract read by both the export and the import.
 *
 * A level belongs to a TOPIC (`adaptive_levels.topic_id`), not to a section, but it only acts
 * for topics the test contains — so the sheet addresses it by «Раздел» + «Номер», the same
 * topic NAME every other sheet of the workbook uses as its key. Level ids are minted anew on
 * every import, and the level has no other natural key.
 *
 * Two things about this sheet cost an author a whole upload cycle if they are got wrong, and
 * both are settled here rather than at the call sites:
 *
 * - **«Номер» counts from 1, `level_index` counts from 0.** The book speaks the author's
 *   numbering («первый уровень» is №1), the model keeps the array index. The conversion lives
 *   in this module alone — parsing subtracts one, serialization adds one — because an
 *   off-by-one done twice in two places cancels out on a round trip and shows up only on the
 *   stand, as a test whose levels are shifted by one;
 * - **«Обратная связь» is PLAIN text.** `adaptive_levels.feedback` is a `text` column with no
 *   format beside it, so the sheet has no «Формат» column: offering one would promise a
 *   choice the model has nowhere to store. That is also why level feedback is HERE and not on
 *   the «Обратная связь» sheet, which does carry a format.
 *
 * Materials of a level are NOT on this sheet: they are `adaptive_level_links` rows, and they
 * ride «Рекомендации» with «Кому» = «Уровень» — see {@link module:server/utils/workbook-feedback}.
 * The address they use is spelled by {@link adaptiveLevelKey}, so the two sheets cannot start
 * keying levels differently.
 *
 * Row rules, in the workbook's usual shape: a row with an error is dropped and the rest are
 * applied; a level whose «Номер» is already taken inside its topic is such an error, since the
 * number is half of its address and a silent overwrite would lose a level.
 */
import { PASS_TYPE_FROM, PASS_TYPE_TO, cleanCell, normalizeCell } from "./workbook-settings";

/** Sheet name, as the workbook writes and the import looks it up. */
export const ADAPTIVE_LEVEL_SHEET_NAME = "Адаптивные уровни";

export const ADAPTIVE_LEVEL_HEADERS = [
  "Раздел", "Номер", "Название", "Сложность от", "Сложность до", "Вопросов",
  "Тип порога", "Порог", "Обратная связь",
];
export const ADAPTIVE_LEVEL_WIDTHS = [28, 8, 26, 14, 14, 12, 16, 10, 60];

/** Column keys, taken from the headers so a rename lands in one place. */
const [
  AL_TOPIC, AL_NUMBER, AL_NAME, AL_MIN, AL_MAX, AL_COUNT, AL_TYPE, AL_THRESHOLD, AL_FEEDBACK,
] = ADAPTIVE_LEVEL_HEADERS;

/** «Тема» is the legacy spelling of the «Раздел» column, accepted by every sheet here. */
const TOPIC_COL_LEGACY = "Тема";

/** `questions.difficulty` bounds — the scale a level's window is cut out of. */
const DIFFICULTY_MIN = 0;
const DIFFICULTY_MAX = 100;

/**
 * Values of the «Тип порога» column — the workbook template turns them into a drop-down.
 * The dictionary itself is the ONE «Структура» and «Пороги вариантов» use, imported rather
 * than copied: three sheets ask the same question, and a per-sheet copy is how one of them
 * starts offering a value the others no longer take.
 */
export const ADAPTIVE_PASS_TYPE_CHOICES = Object.values(PASS_TYPE_TO);

// ─── Shapes ──────────────────────────────────────────────────────────────────

/**
 * Export input: an `adaptive_levels` row. Deliberately looser than the row type — the export
 * feeds it whatever `GET /api/tests/:id` assembled, and a level written by an older version
 * may be missing a threshold type.
 */
export interface AdaptiveLevelSource {
  /** 0-based `level_index`; absent = take the position in the array. */
  levelIndex?: number | null;
  levelName?: string | null;
  minDifficulty?: number | null;
  maxDifficulty?: number | null;
  questionsCount?: number | null;
  passThreshold?: number | null;
  passThresholdType?: string | null;
  feedback?: string | null;
}

/** A topic's levels as the export sees them: addressed by NAME, the only key the sheet has. */
export interface AdaptiveTopicSource {
  topicName: string;
  levels?: readonly AdaptiveLevelSource[] | null;
}

/** One level as the sheet describes it — shaped like `AdaptiveLevelPayload` minus its links. */
export interface ParsedAdaptiveLevel {
  /** 0-based, as the model stores it: «Номер» minus one. */
  levelIndex: number;
  levelName: string;
  minDifficulty: number;
  maxDifficulty: number;
  questionsCount: number;
  passThreshold: number;
  passThresholdType: "percent" | "absolute";
  /** `null` = no feedback for this level. */
  feedback: string | null;
}

/** Result of reading the sheet. */
export interface ParsedAdaptiveSheet {
  /**
   * Levels by {@link normalizeCell}-normalized topic name — the key «Структура» uses for a
   * section — each list ordered by «Номер».
   */
  byTopic: Map<string, ParsedAdaptiveLevel[]>;
  /**
   * The same keys mapped to the spelling the author used. The import reports a topic the test
   * does not contain, and the author can only find it by the name they typed.
   */
  topicNames: Map<string, string>;
  /**
   * Addresses of every level read, in the spelling {@link adaptiveLevelKey} gives them. This
   * is what «Рекомендации» checks a level row against: a level that is not here has no row to
   * attach a material to.
   */
  levelKeys: Set<string>;
  errors: string[];
}

/**
 * The address of a level as BOTH sheets spell it: the normalized topic name plus the 1-based
 * number of the book, never the 0-based index. Exported so «Рекомендации» keys its level rows
 * through the same function instead of building the string by hand.
 */
export function adaptiveLevelKey(topicKey: string, levelNumber: number): string {
  return `${topicKey}|${levelNumber}`;
}

// ─── Export ──────────────────────────────────────────────────────────────────

/** A stored threshold type as a label; an unknown value travels as itself, not as an empty cell. */
function passTypeLabel(type: unknown): string {
  const value = String(type ?? "");
  if (value === "") return PASS_TYPE_TO.percent;
  return PASS_TYPE_TO[value] ?? value;
}

/**
 * Export of the «Адаптивные уровни» sheet: one row per level, topics in the order they were
 * given, levels of a topic ordered by their index.
 *
 * A topic with no name is skipped rather than written as an unloadable row — the sheet holds
 * no other key for it. A level whose index is missing takes its position in the array, so a
 * legacy row without one still round-trips.
 */
export function serializeAdaptiveLevelRows(
  topics: readonly AdaptiveTopicSource[] = [],
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const topic of topics) {
    const topicName = cleanCell(String(topic.topicName ?? ""));
    if (topicName === "") continue;

    const levels = (topic.levels ?? []).map((level, position) => ({
      level,
      index: typeof level.levelIndex === "number" && Number.isFinite(level.levelIndex)
        ? level.levelIndex
        : position,
    }));
    levels.sort((a, b) => a.index - b.index);

    for (const { level, index } of levels) {
      rows.push({
        [AL_TOPIC]: topicName,
        // The one place the offset is added; {@link parseAdaptiveLevelSheet} is the one place
        // it is taken away.
        [AL_NUMBER]: index + 1,
        [AL_NAME]: String(level.levelName ?? ""),
        [AL_MIN]: level.minDifficulty ?? DIFFICULTY_MIN,
        [AL_MAX]: level.maxDifficulty ?? DIFFICULTY_MAX,
        [AL_COUNT]: level.questionsCount ?? 1,
        [AL_TYPE]: passTypeLabel(level.passThresholdType),
        [AL_THRESHOLD]: level.passThreshold ?? 0,
        [AL_FEEDBACK]: String(level.feedback ?? ""),
      });
    }
  }
  return rows;
}

// ─── Import ──────────────────────────────────────────────────────────────────

/** Is every cell of the row blank? Excel keeps trailing rows that carry nothing. */
function isBlankRow(row: Record<string, unknown>, headers: string[]): boolean {
  return headers.every((h) => String(row[h] ?? "").trim() === "");
}

/** A whole-number cell within bounds; an empty cell yields `undefined`. */
function readInt(
  row: Record<string, unknown>,
  col: string,
  bounds: { min: number; max?: number },
): { ok: true; value?: number } | { ok: false; error: string } {
  const raw = String(row[col] ?? "");
  const cleaned = cleanCell(raw);
  if (cleaned === "") return { ok: true };
  const value = Number(cleaned);
  if (!Number.isInteger(value)) {
    return { ok: false, error: `«${col}»: нужно целое число, получено "${raw}"` };
  }
  if (value < bounds.min || (bounds.max !== undefined && value > bounds.max)) {
    const range = bounds.max === undefined ? `≥ ${bounds.min}` : `${bounds.min}..${bounds.max}`;
    return { ok: false, error: `«${col}»: нужно целое ${range}, получено "${raw}"` };
  }
  return { ok: true, value };
}

/** The same reading, but the cell is required: a level cannot leave the column empty. */
function readRequiredInt(
  row: Record<string, unknown>,
  col: string,
  bounds: { min: number; max?: number },
): { ok: true; value: number } | { ok: false; error: string } {
  const parsed = readInt(row, col, bounds);
  if (!parsed.ok) return parsed;
  if (parsed.value === undefined) return { ok: false, error: `не указано «${col}»` };
  return { ok: true, value: parsed.value };
}

/**
 * Read the sheet into per-topic levels.
 *
 * Rows are independent: a row with an error is dropped and the rest are applied, as on every
 * other sheet of the workbook. An empty «Номер» takes the next free number inside its topic —
 * a hand-written sheet need not number a topic that has one level, and a number taken this way
 * can never collide. A number that IS taken is an error rather than an overwrite: it is half
 * of the level's address, and the losing level would vanish without a word.
 */
export function parseAdaptiveLevelSheet(
  rows: Record<string, unknown>[] = [],
): ParsedAdaptiveSheet {
  const errors: string[] = [];
  const byTopic = new Map<string, ParsedAdaptiveLevel[]>();
  const topicNames = new Map<string, string>();
  const levelKeys = new Set<string>();
  /** Highest number used inside a topic so far — an empty «Номер» takes the next one. */
  const maxNumberByTopic = new Map<string, number>();

  rows.forEach((row, i) => {
    if (isBlankRow(row, ADAPTIVE_LEVEL_HEADERS)) return;
    const where = `Лист «${ADAPTIVE_LEVEL_SHEET_NAME}», строка ${i + 2}`;

    const topicName = cleanCell(String(row[AL_TOPIC] ?? row[TOPIC_COL_LEGACY] ?? ""));
    if (topicName === "") {
      errors.push(`${where}: не указан раздел (тема)`);
      return;
    }
    const topicKey = normalizeCell(topicName);

    const parsedNumber = readInt(row, AL_NUMBER, { min: 1 });
    if (!parsedNumber.ok) {
      errors.push(`${where}: ${parsedNumber.error}`);
      return;
    }
    const number = parsedNumber.value ?? (maxNumberByTopic.get(topicKey) ?? 0) + 1;
    const key = adaptiveLevelKey(topicKey, number);
    if (levelKeys.has(key)) {
      errors.push(`${where}: уровень №${number} раздела «${topicName}» уже описан выше`);
      return;
    }

    // A level has NO default name: it is what the learner sees on the transition screen and
    // what the author recognises the row by, so an empty cell is an error rather than
    // «Уровень 2» invented here.
    const levelName = cleanCell(String(row[AL_NAME] ?? ""));
    if (levelName === "") {
      errors.push(`${where}: не указано «${AL_NAME}» уровня`);
      return;
    }

    const min = readRequiredInt(row, AL_MIN, { min: DIFFICULTY_MIN, max: DIFFICULTY_MAX });
    if (!min.ok) {
      errors.push(`${where}: ${min.error}`);
      return;
    }
    const max = readRequiredInt(row, AL_MAX, { min: DIFFICULTY_MIN, max: DIFFICULTY_MAX });
    if (!max.ok) {
      errors.push(`${where}: ${max.error}`);
      return;
    }
    if (min.value > max.value) {
      errors.push(`${where}: «${AL_MIN}» больше «${AL_MAX}» (${min.value} > ${max.value})`);
      return;
    }

    const count = readRequiredInt(row, AL_COUNT, { min: 1 });
    if (!count.ok) {
      errors.push(`${where}: ${count.error}`);
      return;
    }

    // An empty cell takes the column's own default (`percent`, as in the DB); a cell that is
    // filled in with something else is a hard error — a level whose threshold is read as a
    // percent instead of a point total lets everybody through or nobody.
    const typeRaw = String(row[AL_TYPE] ?? "");
    let passThresholdType: "percent" | "absolute" = "percent";
    if (cleanCell(typeRaw) !== "") {
      const type = PASS_TYPE_FROM[normalizeCell(typeRaw)];
      if (!type) {
        errors.push(
          `${where}: неизвестный «${AL_TYPE}»: "${typeRaw}"; `
          + `ожидается одно из: ${ADAPTIVE_PASS_TYPE_CHOICES.join(", ")}`,
        );
        return;
      }
      passThresholdType = type;
    }

    const threshold = readRequiredInt(row, AL_THRESHOLD, { min: 0 });
    if (!threshold.ok) {
      errors.push(`${where}: ${threshold.error}`);
      return;
    }

    // Free text is stored verbatim — its inner spacing is what the author typed. Only a
    // whitespace-only cell is levelled to `null`, so that it reads as "no feedback".
    const feedbackRaw = String(row[AL_FEEDBACK] ?? "");
    const feedback = feedbackRaw.trim() === "" ? null : feedbackRaw;

    maxNumberByTopic.set(topicKey, Math.max(maxNumberByTopic.get(topicKey) ?? 0, number));
    levelKeys.add(key);
    topicNames.set(topicKey, topicName);

    const levels = byTopic.get(topicKey) ?? [];
    levels.push({
      // The one place the offset is taken away; {@link serializeAdaptiveLevelRows} is the one
      // place it is added.
      levelIndex: number - 1,
      levelName,
      minDifficulty: min.value,
      maxDifficulty: max.value,
      questionsCount: count.value,
      passThreshold: threshold.value,
      passThresholdType,
      feedback,
    });
    byTopic.set(topicKey, levels);
  });

  // The rows may be written in any order; the levels of a topic are a LADDER, and the engine
  // walks them by index — so the sheet's order never reaches the model.
  for (const levels of byTopic.values()) levels.sort((a, b) => a.levelIndex - b.levelIndex);

  return { byTopic, topicNames, levelKeys, errors };
}
