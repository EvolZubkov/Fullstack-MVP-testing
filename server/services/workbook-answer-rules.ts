/**
 * @module server/services/workbook-answer-rules
 *
 * The «Номера правильных ответов» cell of a TYPED question: the comparison rules of a
 * short answer and of every blank, read and written in one place (PRD-57 FR-31, Э10).
 *
 * The rules live in the answer-key column rather than in one of their own because they
 * ARE the answer key: `questions.correct_json` is what the publication snapshot, the
 * SCORM bake and the test transfer already carry, and a second column would have to be
 * taught to each of them.
 *
 * Grammar (spec `docs/specs/questions-import/format.md` §5.5 — §5.7):
 *
 *   - one rule per cell LINE, order preserved (stepped scoring reads it);
 *   - a textual rule is written as it is compared; a regular expression is prefixed with
 *     `регулярное:` (alias `regex:`), and a prefix of `регулярное (долгое):` carries the
 *     save-time verdict of the measurement — without it the package would run an
 *     expression the editor already timed as catastrophic;
 *   - a numeric rule is `<operator> <number> [± tolerance]`, the operator one of
 *     `=`, `<>` / `!=`, `>`, `>=`, `<`, `<=`;
 *   - a blank's rule is preceded by its name in square brackets.
 *
 * A RANGE has no notation of its own: it is two rules and the set's join, exactly as in
 * the editor (FR-28aa3). The workbook repeats the product's construction rather than
 * inventing a second one.
 */

import { parseNumericAnswer, type AnswerRule, type NumericOp } from "@shared/answer-check";
import type { PromptFormat } from "@shared/questions/prompt-format";

/** Enumerated cell values of the columns that describe a typed answer. */
const ANSWER_KIND_CELL: Record<string, "text" | "number"> = {
  "текст": "text",
  "число": "number",
  text: "text",
  number: "number",
};

const JOIN_CELL: Record<string, "any" | "all"> = {
  "любое": "any",
  "все": "all",
  any: "any",
  all: "all",
};

/** Canonical spellings the export writes back. */
export const ANSWER_KIND_CHOICES = ["текст", "число"];
export const JOIN_CHOICES = ["любое", "все"];

/** Operator spellings accepted on import, longest first so `>=` wins over `>`. */
const OPERATORS: Array<{ text: string; op: NumericOp }> = [
  { text: ">=", op: "gte" },
  { text: "<=", op: "lte" },
  { text: "<>", op: "ne" },
  { text: "!=", op: "ne" },
  { text: "=", op: "eq" },
  { text: ">", op: "gt" },
  { text: "<", op: "lt" },
];

/** What the export prints for each operator. */
const OPERATOR_TEXT: Record<NumericOp, string> = {
  eq: "=",
  ne: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
};

const REGEX_PREFIX = /^(регулярное|regex)\s*(\(\s*(долгое|slow)\s*\))?\s*:\s*/i;
/**
 * `[имя]` перед правилом — и, в строке БЕЗ правила, объявление пропуска с его видом
 * ответа и связкой: `[year: число, все]`.
 *
 * Атрибуты живут в скобках, а не в колонках, по одной причине: колонка одна на задание, а
 * вид ответа и связка — свойства КАЖДОГО пропуска, и у одного задания они разные («город»
 * текстом, «год» числом). Колонка их не выразила бы, а первая попавшаяся молча подменила
 * бы эталон остальных.
 */
const BLANK_PREFIX = /^\[\s*([A-Za-z0-9_]+)\s*(?::\s*([^\]]*))?\]\s*/;
const TOLERANCE_SEPARATOR = /\s*(?:±|\+-)\s*/;

/** One set of rules of one blank: the set plus the name of the field it checks. */
export interface BlankRules {
  id: string;
  answerKind: "text" | "number";
  join: "any" | "all";
  rules: AnswerRule[];
  unit?: string;
}

export interface RuleSetCell {
  answerKind: "text" | "number";
  join: "any" | "all";
  rules: AnswerRule[];
  unit?: string;
}

export interface ParseRulesOptions {
  /** Question type: only these three carry rules. */
  type: "short" | "blanks" | "long";
  /** `Вид ответа` cell; empty = derive from the rules themselves. */
  answerKind?: string;
  /** `Связка правил` cell; empty = «любое». */
  join?: string;
  /** `Единица измерения` cell; kept for a numeric set only. */
  unit?: string;
  /** Blank names in the ORDER THEY APPEAR IN THE PROMPT — required for `blanks`. */
  blankIds?: readonly string[];
}

export interface ParsedRulesCell {
  /** The short answer's set; absent when the cell could not be read or the type has none. */
  set?: RuleSetCell;
  /** One set per blank, in prompt order; absent when the cell could not be read. */
  blanks?: BlankRules[];
  /** Per-line reasons; a non-empty list means the row must not be imported. */
  errors: string[];
}

/** Split a cell into meaningful lines: an author's blank line is not a rule. */
function linesOf(raw: unknown): string[] {
  return String(raw ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** Read a number the way the author writes it — comma or dot, spaces as thousands. */
function numberOf(raw: string): number | null {
  const value = parseNumericAnswer(raw);
  return value === null || !Number.isFinite(value) ? null : value;
}

/** Print a number the way the author reads it: a comma, no floating-point dust. */
function printNumber(value: number): string {
  return String(Number(value.toFixed(6))).replace(".", ",");
}

/**
 * Read one numeric rule. Returns `null` when the line is not numeric AT ALL (no known
 * operator), and an error string when it looks numeric but cannot be read — the two are
 * different answers: the first lets the caller fall back to a textual rule, the second
 * must never be silently turned into text.
 */
function numericRuleOf(line: string): { rule?: AnswerRule; error?: string } | null {
  const found = OPERATORS.find((candidate) => line.startsWith(candidate.text));
  if (!found) return null;

  const rest = line.slice(found.text.length).trim();
  if (rest === "") return { error: `правило «${line}»: после оператора нет числа` };

  const [valueText, toleranceText, ...extra] = rest.split(TOLERANCE_SEPARATOR);
  if (extra.length > 0) return { error: `правило «${line}»: допуск указан дважды` };

  const value = numberOf(valueText);
  if (value === null) return { error: `правило «${line}»: «${valueText.trim()}» не число` };

  if (toleranceText === undefined) return { rule: { kind: "number", op: found.op, value } };

  const percent = toleranceText.trim().endsWith("%");
  const amount = numberOf(percent ? toleranceText.trim().slice(0, -1) : toleranceText);
  if (amount === null || amount < 0) {
    return { error: `правило «${line}»: допуск «${toleranceText.trim()}» не число` };
  }
  return {
    rule: {
      kind: "number",
      op: found.op,
      value,
      tolerance: { unit: percent ? "pct" : "abs", value: amount },
    },
  };
}

/** Read one textual rule — ordinary comparison unless the expression prefix says otherwise. */
function textRuleOf(line: string): AnswerRule {
  const prefix = REGEX_PREFIX.exec(line);
  if (!prefix) return { kind: "text", match: "wildcard", value: line };
  const rule: AnswerRule = { kind: "text", match: "regex", value: line.slice(prefix[0].length).trim() };
  // FR-28r: the measurement's verdict travels with the rule. Losing it through the
  // workbook would hand the package an expression it must not run.
  return prefix[2] ? { ...rule, slow: true } : rule;
}

/**
 * Read the rules of ONE set (a short answer, or one blank).
 *
 * @param lines rule lines without the blank prefix
 * @param declared answer kind the author declared; `undefined` = derive it
 * @param where what to name in an error message
 */
function rulesOf(
  lines: string[],
  declared: "text" | "number" | undefined,
  where: string,
): { rules?: AnswerRule[]; answerKind: "text" | "number"; errors: string[] } {
  const numeric = lines.map(numericRuleOf);
  // Derivation, used only when the author declared nothing: every line numeric means a
  // numeric answer. Declaring the kind always wins — `= 5` is a legitimate piece of text,
  // and guessing there would silently replace the author's answer key.
  const answerKind = declared ?? (lines.length > 0 && numeric.every((r) => r?.rule) ? "number" : "text");

  if (answerKind === "text") {
    return { answerKind, rules: lines.map(textRuleOf), errors: [] };
  }

  const errors: string[] = [];
  const rules: AnswerRule[] = [];
  lines.forEach((line, index) => {
    const parsed = numeric[index];
    if (!parsed) {
      errors.push(`${where}: правило «${line}» не числовое — нужен оператор =, <>, >, >=, < или <=`);
      return;
    }
    if (parsed.error) errors.push(`${where}: ${parsed.error}`);
    else rules.push(parsed.rule as AnswerRule);
  });
  return { answerKind, rules: errors.length === 0 ? rules : undefined, errors };
}

/**
 * Read the rules cell of a typed question.
 *
 * @param raw the cell value
 * @param options question type plus the cells that describe the answer
 * @returns the parsed set (or per-blank sets) and the reasons the row cannot be imported
 */
export function parseRulesCell(raw: unknown, options: ParseRulesOptions): ParsedRulesCell {
  const lines = linesOf(raw);
  const declared = options.answerKind ? ANSWER_KIND_CELL[options.answerKind.trim().toLowerCase()] : undefined;
  const join = (options.join ? JOIN_CELL[options.join.trim().toLowerCase()] : undefined) ?? "any";
  const unit = (options.unit ?? "").trim();

  if (options.type === "long") {
    // PRD-57 FR-13: у развёрнутого ответа эталона нет вовсе. Заполненная ячейка — ошибка
    // автора, а не значение, которое можно молча выбросить (прецедент PRD-44 FR-38).
    return {
      errors: lines.length === 0
        ? []
        : ["у развёрнутого ответа правил нет — колонка «Номера правильных ответов» должна быть пустой"],
    };
  }

  if (options.type === "blanks") {
    const ids = options.blankIds ?? [];
    const byId = new Map<string, string[]>(ids.map((id) => [id, []]));
    /** Вид ответа и связка, объявленные в скобках у самого пропуска. */
    const declaredOf = new Map<string, { answerKind?: "text" | "number"; join?: "any" | "all" }>();
    const errors: string[] = [];

    for (const line of lines) {
      const prefix = BLANK_PREFIX.exec(line);
      if (!prefix) {
        errors.push(`правило «${line}»: перед правилом нужно имя пропуска в квадратных скобках`);
        continue;
      }
      const id = prefix[1];
      const bucket = byId.get(id);
      if (!bucket) {
        errors.push(`пропуска «${id}» нет в тексте задания`);
        continue;
      }

      for (const word of (prefix[2] ?? "").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean)) {
        const attributes = declaredOf.get(id) ?? {};
        if (ANSWER_KIND_CELL[word]) attributes.answerKind = ANSWER_KIND_CELL[word];
        else if (JOIN_CELL[word]) attributes.join = JOIN_CELL[word];
        else errors.push(`пропуск «${id}»: непонятное свойство «${word}»`);
        declaredOf.set(id, attributes);
      }

      const rest = line.slice(prefix[0].length).trim();
      // `[имя]` или `[имя: свойства]` без правила — объявление пропуска.
      if (rest !== "") bucket.push(rest);
    }

    const blanks: BlankRules[] = [];
    for (const id of ids) {
      const attributes = declaredOf.get(id) ?? {};
      const parsed = rulesOf(byId.get(id) ?? [], attributes.answerKind ?? declared, `пропуск «${id}»`);
      errors.push(...parsed.errors);
      if (parsed.rules) {
        blanks.push({
          id,
          answerKind: parsed.answerKind,
          join: attributes.join ?? join,
          rules: parsed.rules,
        });
      }
    }
    return errors.length > 0 ? { errors } : { blanks, errors };
  }

  const parsed = rulesOf(lines, declared, "набор правил");
  if (!parsed.rules) return { errors: parsed.errors };
  const set: RuleSetCell = { answerKind: parsed.answerKind, join, rules: parsed.rules };
  // Единица — свойство ЧИСЛОВОГО ответа: у текста ей нечего сопровождать.
  if (parsed.answerKind === "number" && unit !== "") set.unit = unit;
  return { set, errors: [] };
}

/** Print one rule as the export writes it. */
function printRule(rule: AnswerRule): string {
  if (rule.kind === "number") {
    const head = `${OPERATOR_TEXT[rule.op]} ${printNumber(rule.value)}`;
    if (!rule.tolerance) return head;
    const suffix = rule.tolerance.unit === "pct" ? "%" : "";
    return `${head} ± ${printNumber(rule.tolerance.value)}${suffix}`;
  }
  if (rule.match !== "regex") return rule.value;
  return `${rule.slow ? "регулярное (долгое)" : "регулярное"}: ${rule.value}`;
}

/**
 * The declaration line of one blank — `[year: число, все]` — or `null` when the reading
 * alone restores the same set.
 *
 * Printed only where it is NEEDED: a numeric blank whose every rule is numeric is read
 * back as numeric without being told, and «любое» is the default. An always-printed
 * declaration would double the length of a cell that an author has to read.
 */
function blankDeclaration(blank: BlankRules, rules: AnswerRule[]): string | null {
  const words: string[] = [];
  const derivedNumeric = rules.length > 0 && rules.every((rule) => rule.kind === "number");
  if ((blank.answerKind === "number") !== derivedNumeric) {
    words.push(blank.answerKind === "number" ? "число" : "текст");
  }
  if (blank.join === "all") words.push("все");
  return words.length === 0 ? null : `[${blank.id}: ${words.join(", ")}]`;
}

/**
 * Print the rules cell of a typed question — the mirror of {@link parseRulesCell}.
 *
 * @param type question type
 * @param correct the question's stored `correct_json`
 * @returns the cell text; empty for a type that carries no rules
 */
export function printRulesCell(type: string, correct: unknown): string {
  const key = (correct ?? {}) as { rules?: AnswerRule[]; blanks?: BlankRules[] };

  if (type === "blanks") {
    const blanks = Array.isArray(key.blanks) ? key.blanks : [];
    return blanks
      .flatMap((blank) => {
        const rules = Array.isArray(blank.rules) ? blank.rules : [];
        const declaration = blankDeclaration(blank, rules);
        // Пропуск без правил печатается одним объявлением: иначе круг потерял бы сам
        // пропуск, и книга вернула бы задание, в котором его не было.
        if (rules.length === 0) return [declaration ?? `[${blank.id}]`];
        const lines = rules.map((rule) => `[${blank.id}] ${printRule(rule)}`);
        return declaration ? [declaration, ...lines] : lines;
      })
      .join("\n");
  }

  if (type !== "short") return "";
  const rules = Array.isArray(key.rules) ? key.rules : [];
  return rules.map(printRule).join("\n");
}

/**
 * `Вид ответа` cell for a stored question — empty where the type has no rules.
 *
 * Empty for BLANKS too, and deliberately: their kind and join belong to each blank and are
 * printed in the cell itself. On import the columns still work as a default for every
 * blank that declares nothing — a hand-written book is allowed to be terser.
 */
export function printAnswerKind(type: string, correct: unknown): string {
  if (type !== "short") return "";
  const kind = (correct as { answerKind?: string } | null)?.answerKind;
  return kind === "number" ? "число" : kind === "text" ? "текст" : "";
}

/** `Связка правил` cell for a stored question. */
export function printJoin(type: string, correct: unknown): string {
  if (type !== "short") return "";
  const join = (correct as { join?: string } | null)?.join;
  return join === "all" ? "все" : join === "any" ? "любое" : "";
}

/**
 * Написания формата текста задания в книге (PRD-57 §4.3).
 *
 * Русские слова, а не `markdown`/`richText`: колонку читает и заполняет автор, и «разметка»
 * он поймёт без словаря. Английские тоже принимаются — книгу дописывают и выгрузкой из
 * чужой системы.
 */
const PROMPT_FORMAT_CELL: Record<string, PromptFormat> = {
  "разметка": "markdown",
  "markdown": "markdown",
  "форматированный": "richText",
  "richtext": "richText",
  "html": "html",
};

/** Канонические написания колонки «Формат текста» для выпадающего списка шаблона. */
export const PROMPT_FORMAT_CHOICES = ["разметка", "форматированный", "html"];

/**
 * Прочитать ячейку «Формат текста».
 *
 * @param raw значение ячейки
 * @returns формат; пустая и незнакомая ячейка — разметка, потому что так написаны все
 *   задания, заведённые до появления режимов, и книга не вправе менять им формат молча
 */
export function parsePromptFormatCell(raw: unknown): PromptFormat {
  return PROMPT_FORMAT_CELL[String(raw ?? "").trim().toLowerCase()] ?? "markdown";
}

/**
 * Напечатать формат в ячейку.
 *
 * @param format формат задания
 * @returns каноническое написание; у разметки — ПУСТО: пустая ячейка и значит «как было»,
 *   и книга существующего банка от появления колонки не меняется ни в одной строке
 */
export function printPromptFormat(format: string): string {
  if (format === "html") return "html";
  if (format === "richText") return "форматированный";
  return "";
}
