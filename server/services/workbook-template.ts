/**
 * @module server/services/workbook-template
 *
 * Builds the downloadable workbook template of the «Импорт» section
 * (`GET /api/workbook/template`) — the artifact an author starts from.
 *
 * The template ships three kinds of sheet:
 *
 * - ROLE SHEETS ({@link ROLE_SHEET_NAMES}) — header row only, so a downloaded
 *   file imports as a no-op until the author adds rows. Their headers are taken
 *   from the SAME constants the importer and the exporter use: a hand-kept copy
 *   is how a template silently lags behind the format it is meant to seed.
 *   «Настройки» is the one exception: it ships the full list of parameter NAMES
 *   with empty values, because it is a parameter/value list rather than a table
 *   and its header row alone would name none of the settings that exist. Empty
 *   values keep the download a no-op all the same.
 * - {@link HELP_SHEET} — a per-column reference: one row per (sheet, column)
 *   with obligation, meaning, accepted values and a concrete example. It is the
 *   only in-file documentation an author has, so it spells out every enumerated
 *   value the parsers accept and uses no internal document tags.
 * - {@link EXAMPLE_SHEET} — the same small, self-consistent test rendered as
 *   filled rows, block by block, ready to copy into the role sheets. It is a
 *   NON-role sheet on purpose: the importer matches sheets by role name, so the
 *   examples can never be imported by accident and pollute the question bank.
 *
 * {@link EXAMPLE_ROWS} backs the example sheet and is exercised against the real
 * importer in `tests/workbook-template.test.ts`, so the rows a reader copies are
 * known to produce a clean import plan rather than merely looking plausible.
 */
import ExcelJS from "exceljs";
import { addAoaSheet } from "../utils/excel";
import {
  QUESTION_HEADERS,
  QUESTION_WIDTHS,
  QUESTION_TYPE_CHOICES,
  SHUFFLE_CHOICES,
  FEEDBACK_MODE_CHOICES,
} from "./questions-export";
import {
  SCALE_HEADERS,
  SCALE_WIDTHS,
  RESULT_VAR_HEADERS,
  RESULT_VAR_WIDTHS,
  MEASUREMENT_HEADERS,
  MEASUREMENT_WIDTHS,
  STRUCTURE_HEADERS,
  STRUCTURE_WIDTHS,
  QUOTA_HEADERS,
  QUOTA_WIDTHS,
  SCORING_OVERRIDE_HEADERS,
  SCORING_OVERRIDE_WIDTHS,
  VARIANT_THRESHOLD_HEADERS,
  VARIANT_THRESHOLD_WIDTHS,
  VARIANTS_COLUMN,
  BOOL_CHOICES,
  VISIBILITY_CHOICES,
  VALENCE_CHOICES,
  CONTROLS_CHOICES,
  MEASUREMENT_SOURCE_CHOICES,
  PASS_TYPE_CHOICES,
  QUOTA_MODE_CHOICES,
  RESULT_VAR_SCORM_CHOICES,
  RESULT_VAR_TYPE_CHOICES,
  SCALE_AGGREGATION_CHOICES,
  SCALE_DIRECTION_CHOICES,
  SCALE_NORMALIZATION_CHOICES,
  SCALE_SCORM_CHOICES,
  SCALE_TYPE_CHOICES,
  STRUCTURE_PASS_TYPE_CHOICES,
  UNLOCK_MODE_CHOICES,
  SETTINGS_HEADERS,
  SETTINGS_WIDTHS,
  SETTING_PARAM_NAMES,
  FEEDBACK_HEADERS,
  FEEDBACK_WIDTHS,
  FEEDBACK_FORMAT_CHOICES,
  RECOMMENDATION_HEADERS,
  RECOMMENDATION_OWNER_CHOICES,
  RECOMMENDATION_WIDTHS,
  RECOMMENDATION_TYPE_CHOICES,
  OWNER_CHOICES,
  PAGE_SHEET_NAME,
  PAGE_FIELD_SHEET_NAME,
  PAGE_HEADERS,
  PAGE_WIDTHS,
  PAGE_FIELD_HEADERS,
  PAGE_FIELD_WIDTHS,
  PAGE_ZONE_CHOICES,
  PAGE_KIND_CHOICES,
  PAGE_MODE_CHOICES,
  PAGE_TARGET_CHOICES,
  ADAPTIVE_LEVEL_SHEET_NAME,
  ADAPTIVE_LEVEL_HEADERS,
  ADAPTIVE_LEVEL_WIDTHS,
  ADAPTIVE_PASS_TYPE_CHOICES,
} from "../utils/workbook-sheets";

/** Canonical role-sheet names (must match the importer/exporter). */
export const SHEET_SETTINGS = "Настройки";
export const SHEET_QUESTIONS = "Вопросы";
export const SHEET_STRUCTURE = "Структура";
export const SHEET_QUOTAS = "Квоты";
export const SHEET_VARIANT_THRESHOLDS = "Пороги вариантов";
export const SHEET_FEEDBACK = "Обратная связь";
export const SHEET_RECOMMENDATIONS = "Рекомендации";
// Taken from the sheet contract rather than spelled again: the importer looks these two
// sheets up by name, and a hand-kept copy here would rename the sheet for the template only.
export const SHEET_PAGES = PAGE_SHEET_NAME;
export const SHEET_PAGE_FIELDS = PAGE_FIELD_SHEET_NAME;
export const SHEET_ADAPTIVE_LEVELS = ADAPTIVE_LEVEL_SHEET_NAME;
export const SHEET_SCORING = "Оценка";
export const SHEET_SCALES = "Шкалы";
export const SHEET_RESULT_VARS = "Показатели";
export const SHEET_MEASUREMENTS = "Вклады вопросов";

/** Reference sheet name — documentation, never imported. */
export const HELP_SHEET = "Справка";
/** Filled-example sheet name — documentation, never imported. */
export const EXAMPLE_SHEET = "Пример";

/** One role sheet of the template: name, canonical headers, column widths. */
interface RoleSheet {
  name: string;
  headers: string[];
  widths: number[];
}

/** Optional per-test scoring columns the importer also accepts on «Вопросы». */
export const SCORING_COL_POINTS = "Балл";
export const SCORING_COL_PRICE = "Цена ответа";

/**
 * «Вопросы» headers OF THE TEMPLATE. Wider than the export's column list on
 * purpose: besides the bank fields it offers the local row alias, the variant
 * membership and the optional per-test scoring pair.
 *
 * «Балл»/«Цена ответа» are a property of the TEST, so the canonical place for
 * them is the «Оценка» sheet — and that is where the export always writes them.
 * The importer nonetheless reads them here (the layout pre-T-40 books use), and a
 * template that hides an accepted column turns it into a feature nobody can find.
 * They sit in their historical positions so an older book lines up column for
 * column. When a book fills both sources, «Оценка» wins and the import warns.
 */
function questionSheetSpec(): { headers: string[]; widths: number[] } {
  const headers = ["Ключ строки", ...QUESTION_HEADERS];
  const widths = [12, ...QUESTION_WIDTHS];

  const afterPrompt = headers.indexOf("Текст вопроса") + 1;
  headers.splice(afterPrompt, 0, SCORING_COL_POINTS);
  widths.splice(afterPrompt, 0, 8);

  headers.push(SCORING_COL_PRICE, VARIANTS_COLUMN);
  widths.push(46, 16);

  return { headers, widths };
}

/**
 * Role sheets in the order the template writes them — the same order the export
 * uses, so a book downloaded here and a book exported from a test read alike.
 */
const ROLE_SHEETS: RoleSheet[] = [
  // «Ключ строки» leads (the local alias «Оценка»/«Вклады вопросов» reference);
  // the scoring pair and «Варианты теста» are added by the spec helper.
  // PRD-30 FR-22: настройки САМОГО теста — список «параметр/значение»,
  // первым листом: он описывает всю книгу, а остальные — её содержимое.
  { name: SHEET_SETTINGS, headers: SETTINGS_HEADERS, widths: SETTINGS_WIDTHS },
  { name: SHEET_QUESTIONS, ...questionSheetSpec() },
  { name: SHEET_STRUCTURE, headers: STRUCTURE_HEADERS, widths: STRUCTURE_WIDTHS },
  { name: SHEET_QUOTAS, headers: QUOTA_HEADERS, widths: QUOTA_WIDTHS },
  { name: SHEET_VARIANT_THRESHOLDS, headers: VARIANT_THRESHOLD_HEADERS, widths: VARIANT_THRESHOLD_WIDTHS },
  // PRD-48 FR-12/FR-13: обратная связь принадлежит структуре теста, а не оценке,
  // поэтому оба листа стоят перед «Оценкой» — тем же порядком, что пишет выгрузка.
  { name: SHEET_FEEDBACK, headers: FEEDBACK_HEADERS, widths: FEEDBACK_WIDTHS },
  { name: SHEET_RECOMMENDATIONS, headers: RECOMMENDATION_HEADERS, widths: RECOMMENDATION_WIDTHS },
  // PRD-48 FR-14/FR-15: страницы теста — тоже его структура, а не оценка, поэтому оба
  // листа идут за «Рекомендациями» и перед «Оценкой» — тем же порядком, что пишет выгрузка.
  { name: SHEET_PAGES, headers: PAGE_HEADERS, widths: PAGE_WIDTHS },
  { name: SHEET_PAGE_FIELDS, headers: PAGE_FIELD_HEADERS, widths: PAGE_FIELD_WIDTHS },
  // PRD-48 FR-16: уровни адаптивных тем — последний структурный лист, снова перед
  // «Оценкой» и тем же порядком, что пишет выгрузка.
  { name: SHEET_ADAPTIVE_LEVELS, headers: ADAPTIVE_LEVEL_HEADERS, widths: ADAPTIVE_LEVEL_WIDTHS },
  { name: SHEET_SCORING, headers: SCORING_OVERRIDE_HEADERS, widths: SCORING_OVERRIDE_WIDTHS },
  { name: SHEET_SCALES, headers: SCALE_HEADERS, widths: SCALE_WIDTHS },
  { name: SHEET_RESULT_VARS, headers: RESULT_VAR_HEADERS, widths: RESULT_VAR_WIDTHS },
  { name: SHEET_MEASUREMENTS, headers: MEASUREMENT_HEADERS, widths: MEASUREMENT_WIDTHS },
];

/** Names of the sheets the importer reads (everything else is ignored). */
export const ROLE_SHEET_NAMES: string[] = ROLE_SHEETS.map((s) => s.name);

// ─── input validation: pick a value instead of typing it ─────────────────────
//
// Every column whose meaning is a closed set gets an Excel dropdown. A typo in
// such a cell is not a small mistake: «Сумма балов» or «условнная» costs the
// author a whole upload-and-read-the-errors cycle, and the ones that fall back
// to a default silently (an unrecognised «Следование вариантов ответов» simply
// means "shuffle") are worse — they never surface at all.
//
// The offered values come from {@link module:server/utils/workbook-sheets} and
// {@link module:server/services/questions-export}, where they are derived from
// the export mappings and the schema enums, so a template can never advertise a
// value the importer stopped taking.

/** Sheet holding the dropdown sources — hidden: it is plumbing, not content. */
export const CHOICES_SHEET = "Значения";

/**
 * How many rows of each role sheet the dropdowns cover. The sheets ship empty,
 * so this is a guess at "more rows than anyone will paste"; ExcelJS folds
 * identical validations into ranges, so the cost of a generous bound is a few
 * bytes rather than 500 XML entries per column.
 */
const VALIDATED_ROWS = 500;

/** Enumerated columns per role sheet: header → the values offered. */
const VALIDATED_COLUMNS: Record<string, Record<string, string[]>> = {
  [SHEET_QUESTIONS]: {
    "Тип вопроса": QUESTION_TYPE_CHOICES,
    "Следование вариантов ответов": SHUFFLE_CHOICES,
    "Режим ОС": FEEDBACK_MODE_CHOICES,
  },
  // The «Значение» column gets NO dropdown: every parameter has its own range of
  // values, and one list for the whole column would offer «Перемешивание» where a
  // «Да» is expected.
  [SHEET_SETTINGS]: {
    "Параметр": SETTING_PARAM_NAMES,
  },
  [SHEET_STRUCTURE]: {
    "Тип порога": STRUCTURE_PASS_TYPE_CHOICES,
    "Обязательный": BOOL_CHOICES,
    "Случайный порядок вопросов": BOOL_CHOICES,
    "Выдавать все вопросы темы": BOOL_CHOICES,
    // Three long phrases nobody retypes correctly, and a near miss is a hard row
    // error rather than a default — exactly the case a dropdown exists for.
    "Доступность раздела": UNLOCK_MODE_CHOICES,
  },
  [SHEET_QUOTAS]: {
    "Режим": QUOTA_MODE_CHOICES,
  },
  [SHEET_VARIANT_THRESHOLDS]: {
    "Тип порога": PASS_TYPE_CHOICES,
  },
  // «Раздел» списка не получает: имя темы — свободный текст, и книга каждого теста
  // называет свои темы. «Кому» же — закрытый список, а опечатка в нём уводит строку
  // не к тому владельцу или отвергает её целиком.
  [SHEET_FEEDBACK]: {
    "Кому": OWNER_CHOICES,
    "Формат": FEEDBACK_FORMAT_CHOICES,
  },
  // Владельцев тут ТРОЕ, а не двое: материал адаптивного уровня едет этим же листом.
  [SHEET_RECOMMENDATIONS]: {
    "Кому": RECOMMENDATION_OWNER_CHOICES,
    "Тип": RECOMMENDATION_TYPE_CHOICES,
  },
  // Адресные колонки страницы закрыты обе и на обоих листах: адрес, набранный руками,
  // не находит страницу, а «Вид» вдобавок решает, ищется строка или создаётся.
  // «Раздел» списка не получает — это имя темы, оно у каждой книги своё.
  [SHEET_PAGES]: {
    "Зона": PAGE_ZONE_CHOICES,
    "Вид": PAGE_KIND_CHOICES,
    "Режим": PAGE_MODE_CHOICES,
    "Автопереход": BOOL_CHOICES,
  },
  [SHEET_PAGE_FIELDS]: {
    "Зона": PAGE_ZONE_CHOICES,
    "Вид": PAGE_KIND_CHOICES,
    "Куда": PAGE_TARGET_CHOICES,
  },
  // «Раздел» списка не получает — это имя темы. «Тип порога» тут короче, чем на
  // «Структуре»: у уровня порог всегда конкретное число, наследовать ему не у кого.
  [SHEET_ADAPTIVE_LEVELS]: {
    "Тип порога": ADAPTIVE_PASS_TYPE_CHOICES,
  },
  [SHEET_SCALES]: {
    "Тип": SCALE_TYPE_CHOICES,
    "Агрегация": SCALE_AGGREGATION_CHOICES,
    "Нормализация": SCALE_NORMALIZATION_CHOICES,
    "Направление": SCALE_DIRECTION_CHOICES,
    "Благоприятное направление": VALENCE_CHOICES,
    "Показывать ученику": VISIBILITY_CHOICES,
    "SCORM": SCALE_SCORM_CHOICES,
  },
  [SHEET_RESULT_VARS]: {
    "Тип": RESULT_VAR_TYPE_CHOICES,
    "Показывать ученику": VISIBILITY_CHOICES,
    "SCORM": RESULT_VAR_SCORM_CHOICES,
    "Управляет статусом": CONTROLS_CHOICES,
  },
  [SHEET_MEASUREMENTS]: {
    "Источник": MEASUREMENT_SOURCE_CHOICES,
  },
};

/**
 * Write every distinct value list as a column of the hidden sheet and return the
 * absolute range of each, keyed by the list itself.
 *
 * Ranges rather than an inline `"a,b,c"` formula on purpose: the inline form is
 * capped at 255 characters AND is split by Excel's LOCALE list separator, which
 * is `;` in a Russian install — the same file would then show one dropdown item
 * containing all the commas. A range reference behaves the same everywhere.
 */
function planChoiceLists(): { lists: string[][]; ranges: Map<string, string> } {
  const lists: string[][] = [];
  const ranges = new Map<string, string>();
  for (const columns of Object.values(VALIDATED_COLUMNS)) {
    for (const choices of Object.values(columns)) {
      const key = choices.join("|");
      if (ranges.has(key)) continue;
      const letter = colLetter(lists.length + 1);
      lists.push(choices);
      ranges.set(key, `'${CHOICES_SHEET}'!$${letter}$2:$${letter}$${choices.length + 1}`);
    }
  }
  return { lists, ranges };
}

/**
 * Add the hidden lists sheet. Written LAST so the visible tab order still opens
 * on «Вопросы»: plumbing must not push the sheet the author came for aside.
 */
function writeChoiceSheet(wb: ExcelJS.Workbook, lists: string[][]): void {
  const ws = wb.addWorksheet(CHOICES_SHEET);
  const height = Math.max(...lists.map((l) => l.length));
  ws.addRow(lists.map((_, i) => `список ${i + 1}`));
  for (let r = 0; r < height; r += 1) {
    ws.addRow(lists.map((list) => list[r] ?? ""));
  }
  // Hidden, not veryHidden: an author who unhides it finds the source of the
  // dropdowns rather than a mystery, and nothing here is secret.
  ws.state = "hidden";
}

/** Spreadsheet column letter for a 1-based index (A, B, … Z, AA). */
function colLetter(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Longest enumeration a hint may spell out. Excel caps the input message at 255
 * characters and the error message at 225, and a file over the cap opens through
 * the "found unreadable content" repair — which strips the very validations this
 * module adds. The «Параметр» column alone lists thirty-eight names, so past this
 * bound the hint names no values at all and points at the dropdown instead: the
 * list is one click away, whereas a repaired file has lost it.
 */
const MAX_LISTED_CHARS = 140;

/**
 * Attach the dropdowns of one role sheet.
 *
 * The error is a WARNING rather than a hard stop: the importer accepts more
 * spellings than the template advertises (English synonyms, `single`/`multiple`,
 * `%`), so a book assembled elsewhere must keep pasting cleanly. The dropdown
 * exists to make the right value easy, not to make every other value impossible.
 */
function applyColumnValidations(
  ws: ExcelJS.Worksheet,
  sheetName: string,
  headers: string[],
  ranges: Map<string, string>,
): void {
  const columns = VALIDATED_COLUMNS[sheetName];
  if (!columns) return;
  for (const [column, choices] of Object.entries(columns)) {
    const index = headers.indexOf(column);
    if (index < 0) continue;
    const formula = ranges.get(choices.join("|"));
    if (!formula) continue;
    const listed = choices.join(", ");
    const short = listed.length <= MAX_LISTED_CHARS;
    const prompt = short
      ? `Выберите значение из списка: ${listed}`
      : "Выберите значение из выпадающего списка ячейки.";
    const error = short
      ? `Ожидается одно из: ${listed}. Другое значение загрузка может не принять или понять иначе.`
      : "Ожидается значение из выпадающего списка. Другое загрузка может не принять или понять иначе.";
    for (let row = 2; row <= VALIDATED_ROWS + 1; row += 1) {
      ws.getCell(row, index + 1).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [formula],
        showInputMessage: true,
        promptTitle: column,
        prompt,
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: "Значение не из списка",
        error,
      };
    }
  }
}

// ─── Example test ─────────────────────────────────────────────────────────────
//
// One small but COMPLETE test: three topics, all four question types, graded
// scoring in both notations, per-tag quotas, a variant section with per-variant
// thresholds, a scale with bands, contributions and two indicators. Every cross
// reference resolves (topics ↔ sections, «Ключ строки» ↔ «Оценка»/«Вклады»,
// tags ↔ quotas, variant numbers ↔ thresholds) — the import test proves it.

/** Filled example rows per role sheet, keyed by sheet name. */
export const EXAMPLE_ROWS: Record<string, Record<string, unknown>[]> = {
  [SHEET_QUESTIONS]: [
    {
      "Ключ строки": "q1",
      "ID": "",
      "Тема": "Финансы",
      "Тип вопроса": "multiple_choice",
      "Текст вопроса": "Что показывает отчёт о прибылях и убытках?",
      "Сложность": 40,
      "Тексты вариантов ответа": "Финансовый результат за период # Остаток денег на счетах # Стоимость активов",
      "Номера правильных ответов": "1",
      "Бюджет распределения": "",
      "Минимум на вариант": "",
      "Максимум на вариант": "",
      "Следование вариантов ответов": "Random",
      "Обратная связь": "Отчёт о прибылях и убытках показывает результат работы за период.",
      "Теги": "базовый",
      "Режим ОС": "общая",
      "ОС при верном": "",
      "ОС при неверном": "",
      [VARIANTS_COLUMN]: "",
    },
    {
      "Ключ строки": "q2",
      "ID": "",
      "Тема": "Финансы",
      "Тип вопроса": "multiple_response",
      "Текст вопроса": "Какие отчёты входят в обязательную финансовую отчётность?",
      "Сложность": 60,
      "Тексты вариантов ответа": "Отчёт о прибылях и убытках # Отчёт о движении денежных средств # Табель учёта рабочего времени",
      "Номера правильных ответов": "1,2",
      "Бюджет распределения": "",
      "Минимум на вариант": "",
      "Максимум на вариант": "",
      "Следование вариантов ответов": "Random",
      "Обратная связь": "",
      "Теги": "базовый",
      "Режим ОС": "условная",
      "ОС при верном": "Верно: оба отчёта входят в обязательную отчётность.",
      "ОС при неверном": "Табель учёта рабочего времени к финансовой отчётности не относится.",
      [VARIANTS_COLUMN]: "",
    },
    {
      "Ключ строки": "q3",
      "ID": "",
      "Тема": "Финансы",
      "Тип вопроса": "matching",
      "Текст вопроса": "Соотнесите термин и его определение",
      "Сложность": 70,
      "Тексты вариантов ответа":
        "Выручка # Прибыль || Доход от продаж # Разница между доходами и расходами # Остаток на расчётном счёте",
      "Номера правильных ответов": "1-1, 2-2",
      "Бюджет распределения": "",
      "Минимум на вариант": "",
      "Максимум на вариант": "",
      "Следование вариантов ответов": "Fixed",
      "Обратная связь": "Третье определение — лишнее, оно описывает остаток денег.",
      "Теги": "продвинутый",
      "Режим ОС": "общая",
      "ОС при верном": "",
      "ОС при неверном": "",
      [VARIANTS_COLUMN]: "",
    },
    {
      "Ключ строки": "q4",
      "ID": "",
      "Тема": "Право",
      "Тип вопроса": "ranking",
      "Текст вопроса": "Расставьте этапы заключения договора в правильном порядке",
      "Сложность": 50,
      "Тексты вариантов ответа": "Подписание # Согласование условий # Исполнение обязательств",
      "Номера правильных ответов": "2,1,3",
      "Бюджет распределения": "",
      "Минимум на вариант": "",
      "Максимум на вариант": "",
      "Следование вариантов ответов": "Fixed",
      "Обратная связь": "Сначала согласование, затем подписание, затем исполнение.",
      "Теги": "базовый",
      "Режим ОС": "общая",
      "ОС при верном": "",
      "ОС при неверном": "",
      [VARIANTS_COLUMN]: "",
    },
    {
      "Ключ строки": "q5",
      "ID": "",
      "Тема": "Аттестация",
      "Тип вопроса": "multiple_choice",
      "Текст вопроса": "Кто утверждает годовой бюджет компании?",
      "Сложность": 50,
      "Тексты вариантов ответа": "Совет директоров # Главный бухгалтер # Секретарь",
      "Номера правильных ответов": "1",
      "Бюджет распределения": "",
      "Минимум на вариант": "",
      "Максимум на вариант": "",
      "Следование вариантов ответов": "Random",
      "Обратная связь": "",
      "Теги": "",
      "Режим ОС": "общая",
      "ОС при верном": "",
      "ОС при неверном": "",
      [VARIANTS_COLUMN]: "1",
    },
    {
      "Ключ строки": "q6",
      "ID": "",
      "Тема": "Аттестация",
      "Тип вопроса": "multiple_choice",
      "Текст вопроса": "Кто подписывает договор поставки от лица компании?",
      "Сложность": 50,
      "Тексты вариантов ответа": "Директор # Кладовщик # Юрисконсульт",
      "Номера правильных ответов": "1",
      "Бюджет распределения": "",
      "Минимум на вариант": "",
      "Максимум на вариант": "",
      "Следование вариантов ответов": "Random",
      "Обратная связь": "",
      "Теги": "",
      "Режим ОС": "общая",
      "ОС при верном": "",
      "ОС при неверном": "",
      [VARIANTS_COLUMN]: "2",
    },
    // PRD-26: шкала — утверждение с упорядоченными градациями. Правильного ответа
    // здесь нет, поэтому колонка «Номера правильных ответов» ПУСТАЯ: вопрос не
    // проверяется и не приносит баллов, а работает только на шкалу «Нагрузка»
    // (см. листы «Шкалы» и «Вклады вопросов»).
    {
      "Ключ строки": "q7",
      "ID": "",
      "Тема": "Самооценка",
      "Тип вопроса": "scale",
      "Текст вопроса": "После работы я чувствую себя опустошённым",
      "Сложность": 50,
      "Тексты вариантов ответа": "Никогда # Редко # Иногда # Часто # Постоянно",
      "Номера правильных ответов": "",
      "Бюджет распределения": "",
      "Минимум на вариант": "",
      "Максимум на вариант": "",
      "Следование вариантов ответов": "",
      "Обратная связь": "",
      "Теги": "",
      "Режим ОС": "общая",
      "ОС при верном": "",
      "ОС при неверном": "",
      [VARIANTS_COLUMN]: "",
    },
    // PRD-44: распределение баллов — учащийся делит бюджет между утверждениями.
    // Правильного распределения не существует, поэтому «Номера правильных ответов»
    // ПУСТЫ, а бюджет и домен варианта задаются тремя своими колонками. Утверждения
    // едут в той же колонке «Тексты вариантов ответа», что и варианты остальных типов.
    {
      "Ключ строки": "q8",
      "ID": "",
      "Тема": "Самооценка",
      "Тип вопроса": "allocation",
      "Текст вопроса": "Как вы распределите внимание между задачами руководителя?",
      "Сложность": 50,
      "Тексты вариантов ответа": "Разбор задачи # Знакомство с командой # Регламент # Смысл работы",
      "Номера правильных ответов": "",
      "Бюджет распределения": 7,
      "Минимум на вариант": "",
      "Максимум на вариант": "",
      "Следование вариантов ответов": "",
      "Обратная связь": "",
      "Теги": "",
      "Режим ОС": "общая",
      "ОС при верном": "",
      "ОС при неверном": "",
      [VARIANTS_COLUMN]: "",
    },
  ],

  // Three parameters of three different shapes — a vocabulary, another vocabulary
  // and a number — so the reader sees that «Значение» is read per parameter and not
  // as one common list. The rest of the names are on the «Настройки» sheet itself.
  [SHEET_SETTINGS]: [
    { "Параметр": "Сценарий прохождения", "Значение": "Линейный по темам" },
    { "Параметр": "Порядок выдачи вопросов", "Значение": "Перемешивание" },
    { "Параметр": "Максимум попыток", "Значение": 3 },
  ],

  [SHEET_STRUCTURE]: [
    // Колонки первой строки задают состав листа целиком, поэтому пустая ячейка
    // «Обратная связь при непройденном уровне» стоит и здесь: без неё колонка не
    // доехала бы до строки, которая её заполняет.
    { "Раздел": "Финансы", "Порядок": 1, "Вопросов в выборке": 3, "Тип порога": "Сумма баллов", "Порог": 4, "Обязательный": "да", "Случайный порядок вопросов": "да", "Обратная связь при непройденном уровне": "" },
    // У этого раздела ниже описаны адаптивные уровни, поэтому здесь же стоит текст,
    // который прочитает не взявший уровень: значение ОДНО на тему.
    {
      "Раздел": "Право", "Порядок": 2, "Вопросов в выборке": 1, "Тип порога": "Процент",
      "Порог": 50, "Обязательный": "да",
      "Обратная связь при непройденном уровне": "Вернитесь к материалам уровня и повторите попытку.",
    },
    { "Раздел": "Аттестация", "Порядок": 3, "Вопросов в выборке": 1, "Тип порога": "По вариантам", "Порог": "", "Обязательный": "нет" },
    // Раздел-опросник: оценивать в нём нечего, поэтому порога нет вовсе.
    // Порядок пунктов задан методикой, поэтому выдача идёт по индексу (PRD-30).
    { "Раздел": "Самооценка", "Порядок": 4, "Вопросов в выборке": 1, "Тип порога": "Нет", "Порог": "", "Обязательный": "нет", "Случайный порядок вопросов": "нет" },
  ],

  [SHEET_QUOTAS]: [
    { "Раздел": "Финансы", "Тег": "базовый", "Количество": 2, "Режим": "Ровно" },
  ],

  [SHEET_VARIANT_THRESHOLDS]: [
    { "Раздел": "Аттестация", "Вариант": 1, "Тип порога": "Сумма баллов", "Порог": 1 },
    { "Раздел": "Аттестация", "Вариант": 2, "Тип порога": "Сумма баллов", "Порог": 1 },
  ],

  // Обратная связь двух владельцев: теста и одного раздела. Строки листа
  // «Рекомендации» ниже ссылаются ровно на этих двоих — владелец, которого нет здесь,
  // рекомендацию принять не может, и пример обязан быть согласованным.
  [SHEET_FEEDBACK]: [
    {
      "Кому": "Тест",
      "Раздел": "",
      "Формат": "Простой",
      "Текст": "Спасибо за работу. Ниже — материалы, которые помогут закрепить результат.",
    },
    {
      "Кому": "Раздел",
      "Раздел": "Финансы",
      "Формат": "Форматированный",
      "Текст": "<p>Разберите отчёт о прибылях и убытках на примере своей компании.</p>",
    },
  ],

  [SHEET_RECOMMENDATIONS]: [
    // «Номер уровня» пуста у всех троих владельцев, кроме уровня, и стоит уже в первой
    // строке: состав колонок листа задаёт именно она.
    { "Кому": "Тест", "Раздел": "", "Номер уровня": "", "Тип": "Курс", "Заголовок": "Финансы для руководителя", "Ссылка": "https://example.test/finance" },
    { "Кому": "Тест", "Раздел": "", "Номер уровня": "", "Тип": "Материал", "Заголовок": "Памятка по отчётности", "Ссылка": "https://example.test/memo.pdf" },
    // У мероприятия ссылки может не быть вовсе: очная встреча живёт в расписании,
    // а не на странице записи.
    { "Кому": "Тест", "Раздел": "", "Номер уровня": "", "Тип": "Мероприятие", "Заголовок": "Вебинар «Разбор отчётности»", "Ссылка": "" },
    { "Кому": "Раздел", "Раздел": "Финансы", "Номер уровня": "", "Тип": "Курс", "Заголовок": "Основы финансового учёта", "Ссылка": "https://example.test/accounting" },
    // Третий владелец — адаптивный уровень: адрес у него из двух колонок, а тип только
    // «Курс». Уровень с таким номером описан ниже, на листе «Адаптивные уровни».
    {
      "Кому": "Уровень", "Раздел": "Право", "Номер уровня": 1, "Тип": "Курс",
      "Заголовок": "Договорное право с нуля", "Ссылка": "https://example.test/contract-law",
    },
  ],

  // Лестница уровней одной темы: два уровня с непересекающимися окнами сложности и
  // порогами разного типа. Тема «Право» есть на листе «Структура» — уровень темы, не
  // входящей в тест, был бы ошибкой строки.
  [SHEET_ADAPTIVE_LEVELS]: [
    {
      "Раздел": "Право", "Номер": 1, "Название": "Базовый", "Сложность от": 0,
      "Сложность до": 50, "Вопросов": 1, "Тип порога": "Процент", "Порог": 60,
      "Обратная связь": "Повторите порядок заключения договора.",
    },
    {
      "Раздел": "Право", "Номер": 2, "Название": "Продвинутый", "Сложность от": 51,
      "Сложность до": 100, "Вопросов": 1, "Тип порога": "Сумма баллов", "Порог": 1,
      "Обратная связь": "",
    },
  ],

  // Две страницы одной зоны: системная, которую книга может только НАЙТИ и обновить, и
  // авторская, которую она создаёт. Номер считается внутри зоны и общий у обоих видов —
  // поэтому у авторской он второй. Ключи полей взяты у вариантов «Стандартного» шаблона:
  // ключ, которого вариант не объявляет, загрузка отбросит с предупреждением.
  [SHEET_PAGES]: [
    {
      "Зона": "После теста", "Раздел": "", "Вид": "Итоги", "Номер": 1,
      "Вариант": "results.standard", "Режим": "Шаблон", "Автопереход": "нет", "Задержка, мс": "",
    },
    {
      "Зона": "После теста", "Раздел": "", "Вид": "Авторская", "Номер": 2,
      "Вариант": "info.text-lead", "Режим": "Шаблон", "Автопереход": "нет", "Задержка, мс": "",
    },
  ],

  [SHEET_PAGE_FIELDS]: [
    {
      "Зона": "После теста", "Раздел": "", "Вид": "Итоги", "Номер": 1,
      "Куда": "Настройка", "Ключ": "scalesChartKind", "Значение": "rose",
    },
    {
      "Зона": "После теста", "Раздел": "", "Вид": "Авторская", "Номер": 2,
      "Куда": "Содержание", "Ключ": "title", "Значение": "Что делать дальше",
    },
    {
      "Зона": "После теста", "Раздел": "", "Вид": "Авторская", "Номер": 2,
      "Куда": "Содержание", "Ключ": "body",
      "Значение": "<p>Повторите разделы, в которых не хватило баллов, и запишитесь на курс.</p>",
    },
    {
      "Зона": "После теста", "Раздел": "", "Вид": "Авторская", "Номер": 2,
      "Куда": "Настройка", "Ключ": "nextLabel", "Значение": "Завершить",
    },
  ],

  [SHEET_SCORING]: [
    { "Вопрос": "q1", "Балл": 1, "Цена ответа": "", "Сложность": "" },
    {
      "Вопрос": "q2",
      "Балл": 2,
      "Цена ответа": "ступени: correct == total & wrong == 0 => 2; correct >= 1 & wrong <= 1 => 1",
      "Сложность": "",
    },
    { "Вопрос": "q3", "Балл": 2, "Цена ответа": "ступени: correct >= 2 => 2; correct >= 1 => 1", "Сложность": "" },
    { "Вопрос": "q4", "Балл": 1, "Цена ответа": "точное", "Сложность": "" },
    { "Вопрос": "q5", "Балл": 2, "Цена ответа": "веса: 2 # 1 # 0", "Сложность": "" },
    { "Вопрос": "q6", "Балл": 2, "Цена ответа": "%A2B1C0", "Сложность": "" },
  ],

  [SHEET_SCALES]: [
    {
      "Ключ": "finlit",
      "Название": "Финансовая грамотность",
      "Описание": "Владение базовой финансовой терминологией",
      "Тип": "number",
      "Агрегация": "sum",
      "Нормализация": "percent",
      "Направление": "positive",
      "Диапазоны": "0..49 low «Базовый»; 50..79 mid «Уверенный»; 80..100 high «Экспертный»",
      "Границы шкалы": "0..100",
      "Предел показа": "",
      "Благоприятное направление": "Чем больше, тем лучше",
      "Показывать ученику": "уровень и значение",
      "SCORM": "both",
    },
    // Накопитель для вопроса-шкалы: у опросника нет правильных ответов, весь его
    // результат — это значение шкалы и его диапазон.
    {
      "Ключ": "workload",
      "Название": "Нагрузка",
      "Описание": "Субъективная оценка нагрузки по самоотчёту",
      "Тип": "number",
      "Агрегация": "sum",
      "Нормализация": "none",
      "Направление": "positive",
      "Диапазоны": "0..1 low «Низкая»; 2..2 mid «Умеренная»; 3..4 high «Высокая»",
      "Границы шкалы": "0..4",
      // Домен опросника мал, и фигура на диаграмме и так занимает всё поле —
      // предел показа здесь не нужен, поэтому ячейка пустая.
      "Предел показа": "",
      // Большая нагрузка — это плохо: уровни красятся в обратном порядке.
      "Благоприятное направление": "Чем больше, тем хуже",
      "Показывать ученику": "уровень",
      "SCORM": "both",
    },
  ],

  [SHEET_RESULT_VARS]: [
    {
      "Имя": "passed",
      "Метка": "Тест сдан",
      "Тип": "boolean",
      "Формула": "percent >= 70",
      "Показывать ученику": "уровень и значение",
      "SCORM": "both",
      "Управляет статусом": "успех",
    },
    {
      "Имя": "grade",
      "Метка": "Оценка",
      "Тип": "string",
      "Формула": 'IF(percent >= 90, "Отлично", IF(percent >= 70, "Хорошо", "Нужно повторить"))',
      "Показывать ученику": "уровень и значение",
      "SCORM": "both",
      "Управляет статусом": "нет",
    },
  ],

  [SHEET_MEASUREMENTS]: [
    { "Вопрос": "q1", "Шкала": "finlit", "Источник": "вариант", "Ключ источника": "0", "Значение": 2, "Вес": 1 },
    { "Вопрос": "q2", "Шкала": "finlit", "Источник": "вопрос", "Ключ источника": "", "Значение": 3, "Вес": 1 },
    { "Вопрос": "q3", "Шкала": "finlit", "Источник": "пара", "Ключ источника": "0:0", "Значение": 1, "Вес": 1 },
    // Шкала q7: каждая градация даёт в накопитель своё число. Ключ источника —
    // номер градации с НУЛЯ, в том же порядке, что «Тексты вариантов ответа».
    { "Вопрос": "q7", "Шкала": "workload", "Источник": "вариант", "Ключ источника": "0", "Значение": 0, "Вес": 1 },
    { "Вопрос": "q7", "Шкала": "workload", "Источник": "вариант", "Ключ источника": "1", "Значение": 1, "Вес": 1 },
    { "Вопрос": "q7", "Шкала": "workload", "Источник": "вариант", "Ключ источника": "2", "Значение": 2, "Вес": 1 },
    { "Вопрос": "q7", "Шкала": "workload", "Источник": "вариант", "Ключ источника": "3", "Значение": 3, "Вес": 1 },
    { "Вопрос": "q7", "Шкала": "workload", "Источник": "вариант", "Ключ источника": "4", "Значение": 4, "Вес": 1 },
    // PRD-44: утверждение вопроса-распределения питает шкалу. Ключ — индекс утверждения
    // с нуля, значение — коэффициент: 1 означает «балл учащегося равен вкладу».
    { "Вопрос": "q8", "Шкала": "workload", "Источник": "распределение", "Ключ источника": "0", "Значение": 1, "Вес": 1 },
    { "Вопрос": "q8", "Шкала": "workload", "Источник": "распределение", "Ключ источника": "3", "Значение": 1, "Вес": 1 },
  ],
};

// ─── «Справка»: per-column reference ─────────────────────────────────────────

/** Header of the reference table. */
const HELP_HEADERS = ["Лист", "Колонка", "Обяз.", "Что писать", "Пример"];
const HELP_WIDTHS = [18, 30, 8, 78, 46];

/** One reference row: sheet, column, required flag, meaning, example. */
type HelpRow = [string, string, string, string, string];

/** A blank separator row between sheet blocks. */
const GAP: HelpRow = ["", "", "", "", ""];

/** Section title row inside the reference table. */
const title = (text: string): HelpRow => ["", "", "", text, ""];

const HELP_ROWS: HelpRow[] = [
  title("КАК ЧИТАТЬ ЭТУ СПРАВКУ"),
  ["", "", "", "Первая строка каждого листа — заголовки. Данные заполняются со второй строки.", ""],
  ["", "", "", "Пустая ячейка = «не задано»: подставится значение по умолчанию. Это не ошибка.", ""],
  ["", "", "", "Листы распознаются по названию. Переименованный лист не будет прочитан.", ""],
  ["", "", "", "Порядок колонок не важен, ненужные можно удалить. Названия менять нельзя.", ""],
  ["", "", "", "Обязателен только лист «Вопросы». Все остальные добавляют возможности.", ""],
  ["", "", "", "Лист «Пример» этой книги — готовые заполненные строки, их можно копировать.", ""],
  GAP,

  title("ЛИСТ «Вопросы» — сами задания. Одна строка = один вопрос. Единственный обязательный лист."),
  [SHEET_QUESTIONS, "Ключ строки", "нет", "Ваша метка вопроса в пределах файла: на неё ссылаются листы «Оценка» и «Вклады вопросов». В базу не попадает. Нужна, только если эти листы используются.", "q1"],
  [SHEET_QUESTIONS, "ID", "нет", "Оставьте пустым — вопрос будет создан. Заполняют только чтобы обновить существующий вопрос (берут ID из выгрузки).", "(пусто)"],
  [SHEET_QUESTIONS, "Тема", "да", "Название темы, в которой лежит вопрос. Если темы нет — она будет создана. Регистр и лишние пробелы не важны, опечатка создаст лишнюю тему.", "Финансы"],
  [SHEET_QUESTIONS, "Тип вопроса", "да", "Одно из: multiple_choice (одиночный выбор) | multiple_response (множественный) | matching (сопоставление) | ranking (ранжирование) | scale (шкала) | allocation (распределение баллов). От типа зависит формат двух следующих колонок.", "multiple_choice"],
  [SHEET_QUESTIONS, "Текст вопроса", "да", "Формулировка задания. Разметка из Word и с веб-страниц преобразуется автоматически.", "Что показывает отчёт о прибылях и убытках?"],
  [SHEET_QUESTIONS, "Сложность", "нет", "Целое 0..100, по умолчанию 50. Ваша пометка для фильтров и статистики; на баллы не влияет. Явный 0 сохраняется как ноль.", "40"],
  [SHEET_QUESTIONS, "Индекс в теме", "нет", "Место вопроса внутри своей темы, целое число. Пусто — порядок не задан: такие вопросы идут последними. Одинаковый индекс у нескольких вопросов допустим — внутри такой группы порядок случайный. Задавайте с шагом 10, чтобы вставлять вопросы между соседними. Действует, только когда на листе «Структура» у раздела выключен случайный порядок.", "20"],
  [SHEET_QUESTIONS, "Тексты вариантов ответа", "да", "Варианты через «#». Для matching два списка через «||»: «лево # лево || право # право» — правый может быть длиннее, лишние станут ловушками. Для ranking — элементы в произвольном порядке. Для scale — градации шкалы по порядку, от одного полюса к другому. Для allocation — утверждения, между которыми распределяется бюджет, от 2 до 10.", "Прибыль # Денежный поток # Активы"],
  [SHEET_QUESTIONS, "Номера правильных ответов", "да", "Счёт с 1. multiple_choice: один номер «2». multiple_response: несколько «1,3». matching: пары «лево-право» через запятую «1-1, 2-2» (пусто = по порядку). ranking: правильный порядок номеров «2,1,3», каждый ровно один раз. scale: ОДИН номер либо ПУСТО — пустая ячейка означает опросник без правильного ответа. allocation: ВСЕГДА пусто — правильного распределения не существует.", "1,2"],
  [SHEET_QUESTIONS, "Бюджет распределения", "нет", "Только для allocation: сколько баллов учащийся распределяет между утверждениями. Целое от 1 до 1000, обязательно для этого типа. У других типов колонку оставьте пустой.", "7"],
  [SHEET_QUESTIONS, "Минимум на вариант", "нет", "Только для allocation: наименьший балл на одно утверждение. Пусто — 0. Ненулевой минимум предзаполняет поля, а не запрещает ввод.", "(пусто)"],
  [SHEET_QUESTIONS, "Максимум на вариант", "нет", "Только для allocation: наибольший балл на одно утверждение. Пусто — весь бюджет. Должно выполняться: количество утверждений x минимум <= бюджет <= количество утверждений x максимум, иначе распределение нельзя заполнить и строка отвергается.", "(пусто)"],
  [SHEET_QUESTIONS, "Следование вариантов ответов", "нет", "Fixed — не перемешивать варианты. Любое другое значение или пусто — перемешивать (по умолчанию). Fixed нужен, когда есть «все перечисленное». К типу scale колонка не применяется: градации никогда не перемешиваются.", "Fixed"],
  [SHEET_QUESTIONS, "Обратная связь", "нет", "Пояснение, которое ученик видит после ответа. Используется при режиме «общая».", "Верный ответ — первый."],
  [SHEET_QUESTIONS, "Теги", "нет", "Метки через «;» или «,». На них опирается лист «Квоты»: без тегов выдача внутри раздела просто случайная.", "финансы; базовый"],
  [SHEET_QUESTIONS, "Режим ОС", "нет", "общая (по умолчанию) — один текст в колонке «Обратная связь». условная — разные тексты в двух следующих колонках.", "условная"],
  [SHEET_QUESTIONS, "ОС при верном", "нет", "Текст при верном ответе. Работает только при режиме «условная».", "Верно, оба отчёта обязательны."],
  [SHEET_QUESTIONS, "ОС при неверном", "нет", "Текст при неверном ответе. Работает только при режиме «условная».", "Табель к отчётности не относится."],
  [SHEET_QUESTIONS, VARIANTS_COLUMN, "нет", "Номера вариантов теста, в которые входит вопрос, через «;». Речь НЕ о вариантах ответа: вариант теста — это заранее собранный набор заданий для потока. Пусто = обычная случайная выдача. У темы должно быть не меньше двух разных номеров, иначе варианты не создадутся.", "1; 2"],
  ["", "", "", "Раньше эта колонка называлась просто «Варианты». Старое имя по-прежнему принимается, поэтому ранее выгруженные файлы читаются без правок; выгрузка теперь пишет новое имя.", ""],
  [SHEET_QUESTIONS, SCORING_COL_POINTS, "нет", "Цена вопроса В ЭТОМ ТЕСТЕ, целое от 0. Запасной способ: то же самое задаётся на листе «Оценка», и он основной. Пусто — цена берётся из умолчания раздела, затем теста, затем системного (1 балл).", "2"],
  [SHEET_QUESTIONS, SCORING_COL_PRICE, "нет", "Правило частичного зачёта для этого теста. Запасной способ — то же, что колонка «Цена ответа» листа «Оценка»; грамматика описана там же.", "веса: 2 # 1 # 0"],
  ["", "", "", "ВНИМАНИЕ: две последние колонки читаются, ТОЛЬКО если в книге нет листа «Оценка». Если лист есть, оценка берётся с него, а эти колонки не читаются вовсе — импорт об этом предупредит. Держите оценку в одном месте: либо здесь, либо на листе «Оценка».", ""],
  ["", "", "", "Почему два места: цена — свойство ТЕСТА, а не вопроса (один вопрос может стоить по-разному в разных тестах), поэтому основной адрес у неё — лист «Оценка». Колонки здесь оставлены для книг, где вопрос и его цену удобнее держать в одной строке.", ""],
  GAP,

  title("ЛИСТ «Настройки» — настройки САМОГО теста. Одна строка = один параметр."),
  [SHEET_SETTINGS, "Параметр", "да", "Имя настройки — так же, как она подписана в редакторе теста. Все имена уже вписаны в колонку на самом листе «Настройки», выдумывать их не нужно: лишние строки можно удалить. Незнакомый параметр — ошибка импорта, а не молчаливый пропуск.", "Порядок выдачи вопросов"],
  [SHEET_SETTINGS, "Значение", "нет", "Читается по своему параметру: переключатель — «Да» или «Нет»; число — целое, причём 0 у ограничений означает «без ограничения»; название или текст — как есть; параметр с выбором — та же подпись, что в редакторе. Пусто — настройка теста не меняется, поэтому очистить значение книгой нельзя.", "Перемешивание"],
  ["", "", "", "«Порядок выдачи вопросов»: «Фиксированный порядок» (темы и вопросы по индексу) | «Перемешивание» (по умолчанию: внутри темы, темы блоками) | «Полное перемешивание» (вопросы всех тем одним потоком).", "Перемешивание"],
  ["", "", "", "«Сценарий прохождения»: «Линейный» | «Линейный по темам» | «Через страницу-маршрутизатор». Только последний включает страницу выбора разделов, и только при нём действуют колонки доступности листа «Структура».", "Линейный по темам"],
  ["", "", "", "Тема может отклониться от правила теста — колонкой «Случайный порядок вопросов» на листе «Структура». При «Полном перемешивании» тема с фиксированным порядком выдаётся неразрывным блоком в случайном месте потока.", ""],
  GAP,

  title("ЛИСТ «Структура» — разделы теста. Одна строка = один раздел. Заменяет структуру теста целиком."),
  [SHEET_STRUCTURE, "Раздел", "да", "Название темы — побуквенно как на листе «Вопросы». Раздел теста всегда ссылается ровно на одну тему.", "Финансы"],
  [SHEET_STRUCTURE, "Код темы", "нет", "Короткий код темы — по нему формулы показателей зовут тему: topicById(\"фин\"). Пусто — код не переносится. Тема, у которой код уже есть, его сохраняет: одна книга не вправе сменить адрес, по которому тему зовут формулы других тестов.", "фин"],
  [SHEET_STRUCTURE, "Порядок", "нет", "Номер раздела в тесте. Пусто — используется порядок строк.", "1"],
  [SHEET_STRUCTURE, "Вопросов в выборке", "да", "Сколько вопросов темы получит ученик, целое от 1. Не может превышать число вопросов в теме. Остальные вопросы темы останутся в запасе и достанутся другим попыткам.", "3"],
  [SHEET_STRUCTURE, "Тип порога", "нет", "Как проверять сдачу раздела: пусто или «Как у теста» (наследовать общий порог) | «Нет» (не проверять) | «Процент» | «Сумма баллов» | «По вариантам» (пороги — на листе «Пороги вариантов»).", "Сумма баллов"],
  [SHEET_STRUCTURE, "Порог", "нет", "Число для типов «Процент» (0..100) и «Сумма баллов» (в баллах). Для остальных типов остаётся пустым.", "4"],
  [SHEET_STRUCTURE, "Обязательный", "нет", "да (по умолчанию) | нет. Принимаются также yes/true/1/истина.", "да"],
  [SHEET_STRUCTURE, "Случайный порядок вопросов", "нет", "Переопределение правила теста для ОДНОГО раздела. Пусто (по умолчанию) — раздел следует листу «Настройки». да — вопросы раздела перемешиваются. нет — выдаются по колонке «Индекс в теме» листа «Вопросы»; в режиме вариантов — в порядке списка варианта.", ""],
  [SHEET_STRUCTURE, "Выдавать все вопросы темы", "нет", "да — ученик получает ВСЕ вопросы темы, а «Вопросов в выборке» не действует. нет (по умолчанию) или пусто — выдаётся выборка.", "нет"],
  [SHEET_STRUCTURE, "Лимит времени темы", "нет", "Сколько минут даётся на раздел, целое от 0. Пусто — раздел без ограничения времени.", "15"],
  [SHEET_STRUCTURE, "Балл по умолчанию в секции", "нет", "Цена вопроса этого раздела, целое от 0, если у вопроса нет своей цены на листе «Оценка». Пусто — цена берётся из умолчания теста, затем системного (1 балл).", "2"],
  [SHEET_STRUCTURE, "Доступность раздела", "нет", "Когда раздел открывается ученику на странице-маршрутизатора: «Доступен сразу» | «После завершения выбранных разделов» | «После успешного прохождения выбранных разделов». Пусто — правила доступности не переносятся вовсе.", "Доступен сразу"],
  [SHEET_STRUCTURE, "Зависит от разделов", "нет", "Названия разделов через «;», от которых зависит открытие. Заполняется для двух последних значений предыдущей колонки. Название, которого нет среди разделов книги, — ошибка загрузки.", "Вводный; Правовой"],
  [SHEET_STRUCTURE, "Обратная связь при непройденном уровне", "нет", "Текст, который видит ученик адаптивной темы, не взявший уровень. Значение ОДНО на тему, поэтому оно здесь, а не на листе «Адаптивные уровни». Пусто — текст остаётся прежним; чтобы стереть его, поставьте в ячейке прочерк «-». Применяется только вместе со строками уровней темы на листе «Адаптивные уровни»: текст хранится рядом с ними.", "Вернитесь к материалам уровня и повторите попытку."],
  ["", "", "", "Правила доступности действуют только в сценарии со страницей-маршрутизатором. Сам сценарий задаёт лист «Настройки»: этот лист тест маршрутизатором не делает.", ""],
  GAP,

  title("ЛИСТ «Квоты» — состав выдачи по тегам. Нужен, только если внутри раздела важно, КАКИЕ вопросы выпадут. Требует листа «Структура»."),
  [SHEET_QUOTAS, "Раздел", "да", "Название темы — как на листе «Структура».", "Финансы"],
  [SHEET_QUOTAS, "Тег", "да", "Тег из колонки «Теги» листа «Вопросы». Тег должен стоять у достаточного числа вопросов темы.", "базовый"],
  [SHEET_QUOTAS, "Количество", "да", "Сколько вопросов с этим тегом выдать, целое от 1. Сумма по разделу не может превышать его «Вопросов в выборке»; оставшиеся места добираются случайно.", "2"],
  [SHEET_QUOTAS, "Режим", "нет", "Ровно (по умолчанию) — ровно столько вопросов с тегом. Не менее — не менее столько.", "Ровно"],
  GAP,

  title("ЛИСТ «Пороги вариантов» — свой порог для каждого варианта. Заполняется только для разделов с типом порога «По вариантам»."),
  [SHEET_VARIANT_THRESHOLDS, "Раздел", "да", "Название темы — как на листе «Структура».", "Аттестация"],
  [SHEET_VARIANT_THRESHOLDS, "Вариант", "да", "Номер варианта — тот же, что в колонке «Варианты теста» листа «Вопросы». Можно писать «2» или «Вариант 2».", "1"],
  [SHEET_VARIANT_THRESHOLDS, "Тип порога", "да", "Процент | Сумма баллов.", "Сумма баллов"],
  [SHEET_VARIANT_THRESHOLDS, "Порог", "да", "Число. Порог нужен КАЖДОМУ варианту раздела: если хотя бы один останется без порога, загрузка сообщит об ошибке.", "1"],
  GAP,

  title("ЛИСТ «Обратная связь» — что ученик читает после теста и после раздела. Одна строка = один владелец."),
  [SHEET_FEEDBACK, "Кому", "да", "Чья это обратная связь: Тест (общая, на экране итогов) | Раздел (по одной теме).", "Раздел"],
  [SHEET_FEEDBACK, "Раздел", "да, для «Кому» = «Раздел»", "Название темы — как на листе «Структура». Для «Кому» = «Тест» ячейка должна быть ПУСТОЙ: заполненная — ошибка строки, а не молчаливо отброшенное значение.", "Финансы"],
  [SHEET_FEEDBACK, "Формат", "нет", "Как читать текст: Простой (по умолчанию) | Форматированный | HTML. Те же значения, что у вводных текстов на листе «Настройки».", "Форматированный"],
  [SHEET_FEEDBACK, "Текст", "нет", "Сам текст обратной связи. Пустая ячейка при отсутствии строк на листе «Рекомендации» означает «обратной связи нет»: она будет стёрта у этого владельца.", "Спасибо за работу."],
  ["", "", "", "Владелец и раздел разведены двумя колонками намеренно: тема с названием «Тест» — обычное дело, и в одной общей колонке такая строка молча ушла бы на уровень всего теста.", ""],
  ["", "", "", "Владелец, названный на листе, получает обратную связь ЦЕЛИКОМ из книги: текст, формат и все свои строки с листа «Рекомендации». Названный без рекомендаций останется без них.", ""],
  ["", "", "", "Владелец, НЕ названный на листе, не меняется вовсе. Книги без этого листа обратную связь не трогают ни у кого — ни у теста, ни у разделов.", ""],
  ["", "", "", "Раздел можно назвать только вместе с листом «Структура»: без него разделы теста не переписываются, и обратной связи некуда попасть.", ""],
  GAP,

  title("ЛИСТ «Рекомендации» — курсы, материалы и мероприятия, приложенные к обратной связи. Одна строка = одна рекомендация. Требует листа «Обратная связь»."),
  [SHEET_RECOMMENDATIONS, "Кому", "да", "Чьей обратной связи принадлежит рекомендация: Тест | Раздел | Уровень (материал уровня адаптивной темы). Тест и Раздел читаются так же, как на листе «Обратная связь».", "Тест"],
  [SHEET_RECOMMENDATIONS, "Раздел", "да, кроме «Кому» = «Тест»", "Название темы. Для «Кому» = «Тест» ячейка пустая. Владелец обязан быть назван на листе «Обратная связь», иначе строка отвергается: рекомендация хранится внутри его обратной связи.", "Финансы"],
  [SHEET_RECOMMENDATIONS, "Номер уровня", "да, для «Кому» = «Уровень»", "Номер уровня внутри темы — тот же, что на листе «Адаптивные уровни», с 1. Для «Тест» и «Раздел» ячейка пустая. Уровня, не описанного на листе «Адаптивные уровни», быть не должно: такая строка отвергается.", "1"],
  [SHEET_RECOMMENDATIONS, "Тип", "да", "Курс | Материал | Мероприятие. От типа зависит только строгость колонки «Ссылка». Уровню доступен ТОЛЬКО «Курс»: у его материала есть лишь заголовок и ссылка.", "Курс"],
  [SHEET_RECOMMENDATIONS, "Заголовок", "да", "Подпись, которую видит ученик. Строка без заголовка отвергается.", "Финансы для руководителя"],
  [SHEET_RECOMMENDATIONS, "Ссылка", "да для курса", "Адрес. У курса обязателен и проверяется. У материала и мероприятия может быть пустым: у очной встречи страницы записи может не быть вовсе.", "https://example.test/finance"],
  ["", "", "", "Файлы по ссылкам не переносятся: книга везёт адрес, а не сам файл. Ссылка на файл другого стенда на новом месте не откроется — загрузите файл заново и поправьте адрес.", ""],
  GAP,

  title("ЛИСТ «Страницы» — экраны теста: стартовый, итоговый, вводные и ваши собственные. Одна строка = одна страница."),
  [SHEET_PAGES, "Зона", "да", "Где в тесте стоит страница: До теста | После теста | До темы | После темы. Первые две относятся к тесту целиком, вторые две — к одному разделу.", "После теста"],
  [SHEET_PAGES, "Раздел", "да, для зон темы", "Название темы — как на листе «Структура». Для зон «До теста» и «После теста» ячейка должна быть ПУСТОЙ: заполненная — ошибка строки.", "Финансы"],
  [SHEET_PAGES, "Вид", "да", "Роль страницы: Стартовая | Вопросы | Маршрутизатор | Введение раздела | Обзор | Итоги раздела | Итоги — их создаёт сам тест; Авторская — ваша страница с текстом.", "Итоги"],
  [SHEET_PAGES, "Номер", "нет", "Место страницы внутри своей зоны, с 1. Считается по всем видам зоны сразу. Пусто — берётся следующий свободный номер.", "2"],
  [SHEET_PAGES, "Вариант", "нет", "Ключ варианта оформления из шаблона теста: он решает, какие поля у страницы есть. Пусто — вариант не меняется. Варианта, которого нет в шаблоне приёмника, быть не должно: такая строка отвергается.", "info.text-lead"],
  [SHEET_PAGES, "Режим", "нет", "Как рисуется страница: Шаблон (по умолчанию — поля варианта) | Стандартный | HTML. Пусто — режим не меняется.", "Шаблон"],
  [SHEET_PAGES, "Автопереход", "нет", "да — страница сама уходит дальше, не дожидаясь кнопки. нет (по умолчанию) — ученик нажимает кнопку.", "нет"],
  [SHEET_PAGES, "Задержка, мс", "нет", "Сколько миллисекунд ждать до автоперехода, целое. Пусто — без задержки. Работает только при «Автопереход» = да.", "3000"],
  ["", "", "", "Все виды, кроме «Авторская», создаёт сам тест — из сценария прохождения и состава тем. Книга может только НАЙТИ такую страницу и обновить её. Страницы, которой в тесте нет, загрузка не изобретает: это ошибка, и почти всегда она значит, что книга и тест разошлись сценарием или составом разделов.", ""],
  ["", "", "", "Авторские страницы названной зоны заменяются набором из книги ЦЕЛИКОМ: у них нет собственного ключа, и предсказуемо только правило «зона, названная в книге, выглядит как в книге». Зона, не названная ни одной строкой, не трогается вовсе.", ""],
  ["", "", "", "Зону называет ЛЮБАЯ строка с её адресом, в том числе строка системной страницы. Если оставить в книге только её, а свои страницы той же зоны удалить, авторские страницы в тесте будут удалены — загрузка об этом предупредит.", ""],
  ["", "", "", "Книга без этого листа страницы не трогает вовсе. Ссылки на файлы внутри страницы переносятся адресами, сами файлы — нет.", ""],
  GAP,

  title("ЛИСТ «Поля страниц» — что написано на странице и как она настроена. Одна строка = одно поле. Требует листа «Страницы»."),
  [SHEET_PAGE_FIELDS, "Зона", "да", "Адрес страницы — те же четыре колонки, что на листе «Страницы», и ровно теми же значениями.", "После теста"],
  [SHEET_PAGE_FIELDS, "Раздел", "да, для зон темы", "Название темы. Для зон теста ячейка пустая.", ""],
  [SHEET_PAGE_FIELDS, "Вид", "да", "Роль страницы — как на листе «Страницы».", "Авторская"],
  [SHEET_PAGE_FIELDS, "Номер", "нет", "Номер страницы в зоне. Пусто допустимо, только если страница такого вида в зоне одна; иначе загрузка попросит номер, а не выберет за вас.", "2"],
  [SHEET_PAGE_FIELDS, "Куда", "да", "Содержание — то, что ученик читает (заголовок, текст, картинка). Настройка — свойство страницы (подпись кнопки, вид диаграммы).", "Содержание"],
  [SHEET_PAGE_FIELDS, "Ключ", "да", "Имя поля у варианта оформления. Ключ, которого вариант не объявляет, применён не будет — загрузка об этом предупредит.", "title"],
  [SHEET_PAGE_FIELDS, "Значение", "нет", "Само значение. Число и переключатель пишутся как есть (5, true). Пустая ячейка означает пустое значение: чтобы оставить поле как есть, удалите строку.", "Что делать дальше"],
  ["", "", "", "Строка с адресом, которого нет на листе «Страницы», отвергается: значение поля хранится НА странице, и без неё ему негде лежать.", ""],
  ["", "", "", "Названные поля накладываются поверх текущих: поле, которого книга не назвала, у страницы сохраняется. Тексты проходят ту же очистку, что и при сохранении из редактора страниц.", ""],
  ["", "", "", "Настройки переносятся в объёме, общем у двух шаблонов: если у теста-приёмника вариант объявляет не те же поля, лишние применены не будут. Об отброшенных ключах загрузка предупреждает.", ""],
  GAP,

  title("ЛИСТ «Адаптивные уровни» — ступени адаптивной темы. Одна строка = один уровень. Нужен, только если тест идёт в адаптивном режиме."),
  [SHEET_ADAPTIVE_LEVELS, "Раздел", "да", "Название темы — как на листе «Структура». Уровни темы, не входящей в разделы теста, применить некуда: такая строка отвергается.", "Право"],
  [SHEET_ADAPTIVE_LEVELS, "Номер", "нет", "Место уровня в лестнице темы, с 1. Пусто — берётся следующий свободный номер. Повторный номер внутри одной темы — ошибка строки: по нему уровень адресуется с листа «Рекомендации».", "1"],
  [SHEET_ADAPTIVE_LEVELS, "Название", "нет", "Имя уровня — его видит ученик на экране перехода. Пусто — «Уровень N» по номеру, ровно как у уровня, добавленного в редакторе.", "Базовый"],
  [SHEET_ADAPTIVE_LEVELS, "Сложность от", "да", "Нижняя граница окна сложности уровня, целое 0..100. Вопросы этого уровня берутся из темы по колонке «Сложность» листа «Вопросы».", "0"],
  [SHEET_ADAPTIVE_LEVELS, "Сложность до", "да", "Верхняя граница окна, целое 0..100 и не меньше нижней. Окна соседних уровней обычно не пересекаются: 0..50, затем 51..100.", "50"],
  [SHEET_ADAPTIVE_LEVELS, "Вопросов", "да", "Сколько вопросов выдаётся на этом уровне, целое от 1. В теме должно найтись достаточно вопросов с подходящей сложностью.", "1"],
  [SHEET_ADAPTIVE_LEVELS, "Тип порога", "нет", "Как считается взятие уровня: Процент | Сумма баллов. Пусто — Процент. Другое значение — ошибка строки: порог, прочитанный не тем способом, пропускает всех либо никого.", "Процент"],
  [SHEET_ADAPTIVE_LEVELS, "Порог", "да", "Число: проценты (0..100) или баллы, смотря по предыдущей колонке.", "60"],
  [SHEET_ADAPTIVE_LEVELS, "Обратная связь", "нет", "Текст, который ученик читает, взяв этот уровень. Только простой текст: колонки формата у уровня нет, и поэтому же уровень не называют на листе «Обратная связь».", "Повторите порядок заключения договора."],
  ["", "", "", "Материалы уровня едут листом «Рекомендации»: строка с «Кому» = «Уровень», названием темы и номером уровня. Уровню доступен только тип «Курс».", ""],
  ["", "", "", "Текст для НЕ взявшего уровень — один на всю тему, поэтому он живёт колонкой «Обратная связь при непройденном уровне» листа «Структура», а не здесь.", ""],
  ["", "", "", "Книга без этого листа адаптивные настройки не трогает вовсе. Лист с одними заголовками — тоже: уровни темы переписываются, только если книга их назвала. Книга адаптивного теста без уровней не сохранится: в адаптивном режиме уровни нужны КАЖДОМУ разделу.", ""],
  GAP,

  title("ЛИСТ «Оценка» — сколько стоит вопрос В ЭТОМ ТЕСТЕ. Три колонки независимы, пустая = не переопределять. Заменяет оценку теста целиком."),
  [SHEET_SCORING, "Вопрос", "да", "«Ключ строки» с листа «Вопросы» либо ID существующего вопроса.", "q2"],
  [SHEET_SCORING, "Балл", "нет", "Цена вопроса в этом тесте, целое от 0. Пусто — цена берётся из умолчания раздела, затем теста, затем системного (1 балл).", "2"],
  [SHEET_SCORING, "Цена ответа", "нет", "Как начислять баллы за ЧАСТИЧНО верный ответ. Пусто или «точное» — всё или ничего. Иначе один из двух способов, см. строки ниже.", "ступени: correct >= 2 => 2"],
  [SHEET_SCORING, "Сложность", "нет", "Переопределение сложности 0..100 только для этого теста. Пусто — сложность вопроса не меняется.", "80"],
  ["", "", "", "«веса» — ТОЛЬКО для multiple_choice и scale: свой балл за каждый вариант (градацию), по порядку. Недостающие веса считаются нулями, лишние — ошибка. Максимум за вопрос = наибольший вес.", "веса: 2 # 1 # 0"],
  ["", "", "", "То же можно записать буквенным ключом: буква называет вариант по позиции, число — вес. Буквы только латинские и строго по порядку A, B, C.", "%A2B1C0"],
  ["", "", "", "«ступени» — ТОЛЬКО для multiple_response, matching, ranking: лестница условий. Ступени через «;», условия внутри ступени через «&», операторы == >= <= < >. Проверяются сверху вниз, побеждает первая подошедшая, иначе 0. Для multiple_choice и scale способ недоступен: там выбран один вариант, счётчик всегда 0 или 1.", "ступени: correct == total & wrong == 0 => 2; correct >= 1 => 1"],
  ["", "", "", "Величины в условиях: correct — сколько верных единиц выбрал ученик; wrong — сколько неверных; total — сколько верных единиц в вопросе всего. Десятичный разделитель в баллах — точка.", "correct == total"],
  ["", "", "", "Если листа «Оценка» нет, но на листе «Вопросы» есть колонки «Балл» и «Цена ответа», оценка берётся оттуда. Когда лист «Оценка» есть — он главный.", ""],
  GAP,

  title("ЛИСТ «Шкалы» — именованные накопители баллов (компетенции, факторы). Нужны для профильных тестов; для обычного «верно/неверно» не требуются."),
  [SHEET_SCALES, "Ключ", "да", "Идентификатор шкалы: строчные латинские буквы, цифры и «_», начинается с буквы, до 64 символов. На него ссылается лист «Вклады вопросов».", "finlit"],
  [SHEET_SCALES, "Название", "нет", "Человекочитаемое имя для экрана результата.", "Финансовая грамотность"],
  [SHEET_SCALES, "Описание", "нет", "Пояснение к шкале.", "Владение базовой терминологией"],
  [SHEET_SCALES, "Тип", "да", "number | boolean | category | level.", "number"],
  [SHEET_SCALES, "Агрегация", "нет", "Как складывать вклады: sum (по умолчанию) | avg | weighted_avg | max | min.", "sum"],
  [SHEET_SCALES, "Нормализация", "нет", "none (по умолчанию) | percent | custom.", "percent"],
  [SHEET_SCALES, "Направление", "нет", "positive (по умолчанию) | inverse. inverse — когда большое значение это плохо, например уровень выгорания.", "positive"],
  [SHEET_SCALES, "Диапазоны", "нет", "Именованные интервалы: «мин..макс код «подпись»», через «;». Границы включаются. Подпись необязательна. Толкование уровня и его рекомендации в книгу не выгружаются и правятся в редакторе: загрузка сохраняет их за уровнем с тем же КОДОМ.", "0..49 low «Базовый»; 50..100 high «Экспертный»"],
  [SHEET_SCALES, "Границы шкалы", "нет", "Минимум и максимум одной ячейкой: «мин..макс». Пусто — границы берутся из охвата уровней. Ноль — законная граница, а не признак «не задано», поэтому пара пишется целиком или не пишется вовсе.", "0..100"],
  [SHEET_SCALES, "Предел показа", "нет", "На сколько тянется полный луч диаграммы, если это не максимум шкалы. Нужен, когда до максимума никто не доходит и фигура сминается. Пусто — луч тянется до максимума.", "35"],
  [SHEET_SCALES, "Благоприятное направление", "нет", "Как читать значение: «Чем больше, тем лучше» | «Чем больше, тем хуже» | «Без оценки» (по умолчанию). Красит уровни и разворачивает шкалу оценок. НЕ путать с колонкой «Направление»: та переворачивает само значение при подсчёте, эта не меняет числа.", "Чем больше, тем хуже"],
  [SHEET_SCALES, "Показывать ученику", "нет", "Что видит ученик: нет (по умолчанию) | уровень | уровень и значение. «Уровень» открывает название уровня и его толкование, но прячет сам балл. Книги прежнего формата читаются: «да» = уровень и значение.", "уровень"],
  [SHEET_SCALES, "SCORM", "нет", "Куда публиковать в систему обучения: none (по умолчанию) | suspend_data | interaction | both.", "both"],
  GAP,

  title("ЛИСТ «Вклады вопросов» — что именно вопрос добавляет в шкалу. Одна строка = один вклад."),
  [SHEET_MEASUREMENTS, "Вопрос", "да", "«Ключ строки» с листа «Вопросы» либо ID существующего вопроса.", "q1"],
  [SHEET_MEASUREMENTS, "Шкала", "да", "«Ключ» с листа «Шкалы».", "finlit"],
  [SHEET_MEASUREMENTS, "Источник", "да", "За что начисляется: вопрос (за верный ответ целиком) | вариант | пара (для matching) | позиция (для ranking) | распределение (для allocation — вклад равен баллу, который учащийся присвоил утверждению).", "вариант"],
  [SHEET_MEASUREMENTS, "Ключ источника", "нет", "ВНИМАНИЕ: счёт с НУЛЯ, в отличие от «Номеров правильных ответов». Для источника «вопрос» — пусто. Для «вариант» и «распределение» — номер варианта или утверждения: 0, 1, 2. Для «пара» и «позиция» — два числа через двоеточие.", "0"],
  [SHEET_MEASUREMENTS, "Значение", "да", "Число, которое добавится в шкалу.", "2"],
  [SHEET_MEASUREMENTS, "Вес", "нет", "Множитель значения, по умолчанию 1.", "1"],
  GAP,

  title("ЛИСТ «Показатели» — вычисляемые значения для экрана результата."),
  [SHEET_RESULT_VARS, "Имя", "да", "Идентификатор: строчные латинские буквы, цифры и «_», начинается с буквы. На него ссылаются формулы других показателей.", "passed"],
  [SHEET_RESULT_VARS, "Метка", "нет", "Подпись, которую видит ученик.", "Тест сдан"],
  [SHEET_RESULT_VARS, "Тип", "да", "boolean | number | string. Тип должен соответствовать тому, что возвращает формула.", "boolean"],
  [SHEET_RESULT_VARS, "Формула", "да", "Выражение. Доступны percent (процент за тест), score (баллы), IF(условие, тогда, иначе), обращения к темам, разделам и шкалам. Формулы удобнее собирать в редакторе теста: там есть подсказки и проверка на лету.", "percent >= 70"],
  [SHEET_RESULT_VARS, "Показывать ученику", "нет", "Что видит ученик: нет (по умолчанию) | уровень | уровень и значение. «Уровень» открывает толкование, но прячет само значение. Книги прежнего формата читаются: «да» = уровень и значение.", "уровень и значение"],
  [SHEET_RESULT_VARS, "SCORM", "нет", "both (по умолчанию) | interaction | suspend_data | none.", "both"],
  [SHEET_RESULT_VARS, "Управляет статусом", "нет", "нет (по умолчанию) | успех | завершение. Показатель сообщает системе обучения итог попытки. Успехом может управлять не более одного показателя теста, завершением — тоже не более одного.", "успех"],
  GAP,

  title("ПОРЯДОК ЧТЕНИЯ ЛИСТОВ ПРИ ЗАГРУЗКЕ"),
  ["", "", "", "Вопросы → Шкалы → Показатели → Вклады вопросов → Оценка → Структура + Квоты + Пороги вариантов + Обратная связь + Рекомендации + Адаптивные уровни → Страницы + Поля страниц. Поэтому ссылки на вопросы, созданные этим же файлом, работают.", ""],
  ["", "", "", "Страницы читаются последними не случайно: системные страницы создаёт сам тест по сценарию и составу разделов, и найти их можно только после того, как настройки и структура уже сохранены.", ""],
  ["", "", "", "Файл, в котором есть ТОЛЬКО лист «Вопросы», загружается в общий банк — целевой тест указывать не нужно. Любой другой лист относится к тесту и потребует выбрать его.", ""],
  ["", "", "", "Перед загрузкой всегда делайте предпросмотр: он читает файл целиком, показывает план и все ошибки, но ничего не записывает.", ""],
];

// ─── «Пример»: filled rows, ready to copy ────────────────────────────────────

/** Order of example blocks on the «Пример» sheet. */
const EXAMPLE_ORDER = [
  SHEET_SETTINGS,
  SHEET_QUESTIONS,
  SHEET_STRUCTURE,
  SHEET_QUOTAS,
  SHEET_VARIANT_THRESHOLDS,
  SHEET_FEEDBACK,
  SHEET_RECOMMENDATIONS,
  SHEET_PAGES,
  SHEET_PAGE_FIELDS,
  SHEET_ADAPTIVE_LEVELS,
  SHEET_SCORING,
  SHEET_SCALES,
  SHEET_RESULT_VARS,
  SHEET_MEASUREMENTS,
];

/** What a line of the «Пример» sheet is, so the renderer can dress it. */
type ExampleLineKind = "title" | "note" | "caption" | "header" | "data" | "blank";

/** One rendered line of the «Пример» sheet. */
interface ExampleLine {
  kind: ExampleLineKind;
  cells: unknown[];
}

/**
 * Render the example test as stacked blocks: a caption, the sheet's header row
 * and its filled rows. Rendering from {@link EXAMPLE_ROWS} through the canonical
 * headers keeps the example aligned with the real columns automatically.
 *
 * Each line carries its kind, because the sheet is read by eye: eight blocks of
 * bare rows run together into one wall, and the reader's first question — where
 * does the block for THIS sheet start and which cell is a heading — has to be
 * answerable at a glance. {@link styleExampleSheet} turns the kinds into format.
 */
function buildExampleLines(): ExampleLine[] {
  const out: ExampleLine[] = [
    { kind: "title", cells: ["ПРИМЕР ЗАПОЛНЕНИЯ — небольшой, но полностью рабочий тест"] },
    { kind: "note", cells: ["Этот лист НЕ импортируется: книгу читают только листы с ролевыми названиями."] },
    { kind: "note", cells: ["Скопируйте нужные строки на одноимённый лист — под его строку заголовков."] },
    { kind: "blank", cells: [] },
    { kind: "note", cells: ["Что описано: три темы, все четыре типа вопросов, частичный зачёт, квоты по тегам,"] },
    { kind: "note", cells: ["раздел с двумя вариантами и своими порогами, шкала с диапазонами, два показателя,"] },
    { kind: "note", cells: ["обратная связь теста и раздела с приложенными курсом, материалом и мероприятием,"] },
    { kind: "note", cells: ["страница итогов с диаграммой и своя страница с текстом после теста,"] },
    { kind: "note", cells: ["а также лестница адаптивных уровней одной темы с материалом на первом из них."] },
    { kind: "blank", cells: [] },
  ];

  for (const name of EXAMPLE_ORDER) {
    const rows = EXAMPLE_ROWS[name];
    if (!rows?.length) continue;
    const spec = ROLE_SHEETS.find((s) => s.name === name)!;
    out.push({ kind: "caption", cells: [`ЛИСТ «${name}»`] });
    out.push({ kind: "header", cells: spec.headers });
    for (const row of rows) {
      out.push({ kind: "data", cells: spec.headers.map((h) => row[h] ?? "") });
    }
    out.push({ kind: "blank", cells: [] });
  }
  return out;
}

/** Header fill of an example block — light enough to print and to read on. */
const HEADER_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFEDEDF5" },
};

/** Grid of an example block. */
const CELL_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD5D5E0" } },
  left: { style: "thin", color: { argb: "FFD5D5E0" } },
  bottom: { style: "thin", color: { argb: "FFD5D5E0" } },
  right: { style: "thin", color: { argb: "FFD5D5E0" } },
};

/**
 * Dress the «Пример» sheet: each block reads as a table with a marked header,
 * and the prose around it stays visibly prose.
 *
 * Data cells wrap rather than spill: an option list or a graded-scoring rule is
 * long, and a row of half-shown text is what made the sheet unreadable in the
 * first place. Row heights are left unset on purpose so Excel fits them to the
 * wrapped content.
 */
function styleExampleSheet(ws: ExcelJS.Worksheet, lines: ExampleLine[]): void {
  lines.forEach((line, index) => {
    const row = ws.getRow(index + 1);
    switch (line.kind) {
      case "title":
        row.getCell(1).font = { bold: true, size: 14 };
        break;
      case "note":
        row.getCell(1).font = { italic: true, color: { argb: "FF666677" } };
        break;
      case "caption":
        row.getCell(1).font = { bold: true, size: 12, color: { argb: "FF3B3B8F" } };
        break;
      case "header":
        for (let c = 1; c <= line.cells.length; c += 1) {
          const cell = row.getCell(c);
          cell.font = { bold: true };
          cell.fill = HEADER_FILL;
          cell.border = CELL_BORDER;
          cell.alignment = { vertical: "middle", wrapText: true };
        }
        break;
      case "data":
        for (let c = 1; c <= line.cells.length; c += 1) {
          const cell = row.getCell(c);
          cell.border = CELL_BORDER;
          cell.alignment = { vertical: "top", wrapText: true };
        }
        break;
      case "blank":
        break;
    }
  });
}

/**
 * Build the «Импорт» section's workbook template: empty role sheets (headers
 * only, with dropdowns on the enumerated columns; «Настройки» additionally lists
 * every parameter name), the per-column reference and the filled example.
 */
export async function buildWorkbookTemplate(): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const { lists, ranges } = planChoiceLists();

  for (const sheet of ROLE_SHEETS) {
    const ws = addAoaSheet(wb, sheet.name, [sheet.headers], sheet.widths);
    // The header row is the contract of the sheet: it must stay legible and stay
    // on screen while the author scrolls into row 300.
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { vertical: "middle", wrapText: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    applyColumnValidations(ws, sheet.name, sheet.headers, ranges);
  }

  // «Настройки» is the ONLY role sheet that ships non-empty: it is a parameter/value
  // list, and an empty sheet would not tell the author which parameters exist. The
  // values stay blank, and a blank cell changes nothing (PRD-48 §4.4).
  //
  // Written by explicit row index rather than with `addRow`: attaching the dropdowns
  // above materialized rows 2..501, so `addRow` would append the list BELOW them —
  // out of sight and out of the importer's reach.
  const settingsSheet = wb.worksheets.find((w) => w.name === SHEET_SETTINGS);
  if (settingsSheet) {
    SETTING_PARAM_NAMES.forEach((name, i) => {
      settingsSheet.getCell(i + 2, 1).value = name;
    });
  }

  addAoaSheet(wb, HELP_SHEET, [HELP_HEADERS, ...HELP_ROWS], HELP_WIDTHS);
  const help = wb.getWorksheet(HELP_SHEET)!;
  help.getRow(1).font = { bold: true };
  help.views = [{ state: "frozen", ySplit: 1 }];

  const lines = buildExampleLines();
  const example = addAoaSheet(
    wb,
    EXAMPLE_SHEET,
    lines.map((l) => l.cells),
    [14, 36, 20, 56, 30, 18, 16, 16, 22, 18],
  );
  styleExampleSheet(example, lines);

  writeChoiceSheet(wb, lists);
  return wb;
}
