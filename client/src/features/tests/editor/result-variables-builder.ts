/**
 * @module features/tests/editor/result-variables-builder
 * @description Pure helpers for the «Показатели» visual formula builder (PRD-2
 * §4.1): the object/property catalog, the condition primitive, and canonical-DSL
 * generation for the four templates (Порог / Категория по уровням шкалы /
 * Взвешенная сумма / Сертификация-вердикт). Framework-free and pure so the
 * generation is unit-testable and the section component stays a thin view.
 *
 * Объект адресуется по имени для автора (тема — `topicId`, шкала — `scale.key`),
 * но в формулу пишется каноничный DSL (`topicById("id")` / `scaleById("key")`).
 * Единица свойства определяет оператор и контрол значения.
 */
import type { ResultVariableType } from "./test-editor.types";

/** Visual-builder templates (PRD-2 §4.1.3). */
export type BuilderTemplate = "threshold" | "category" | "weighted" | "verdict";

/** Minimal option shape compatible with the DS `Select` `options` prop. */
export type BuilderOption = { value: string; label: string; group?: string };

export const TEMPLATE_OPTIONS: Array<{ value: BuilderTemplate; label: string }> = [
  { value: "threshold", label: "Порог" },
  { value: "category", label: "Категория по уровням шкалы" },
  { value: "weighted", label: "Взвешенная сумма" },
  { value: "verdict", label: "Сертификация / вердикт" },
];

/** Result type each template produces (derived, never author-chosen). */
export const TEMPLATE_TYPE: Record<BuilderTemplate, ResultVariableType> = {
  threshold: "boolean",
  category: "string",
  weighted: "number",
  verdict: "boolean",
};

export type TopicRef = { id: string; name: string; code?: string | null };
export type ScaleRef = { key: string; label: string; levels: string[] };

/** One condition in the «Порог»/«Вердикт» primitive. */
export type Condition = {
  /** `"overall"` | `topic:${topicId}` | `scale:${scaleKey}`. */
  element: string;
  /** percent|score|passed (тема) · raw|percent|level (шкала) · percent|score (общий). */
  property: string;
  /** Comparison; `=`/`!=` for level, the five comparisons for numbers. */
  op: string;
  /** Number (numeric units) or a level name (level unit). Unused for boolean. */
  value: string;
};

/** Value-unit of a property — drives operator set and value control. */
export type Unit = "num" | "bool" | "level";

export const NUM_OPERATORS: Array<{ value: string; label: string }> = [
  { value: ">=", label: "≥" },
  { value: ">", label: ">" },
  { value: "=", label: "=" },
  { value: "<=", label: "≤" },
  { value: "<", label: "<" },
];

export const LEVEL_OPERATORS: Array<{ value: string; label: string }> = [
  { value: "=", label: "=" },
  { value: "!=", label: "≠" },
];

type PropDef = { value: string; label: string; unit: Unit };

const OVERALL_PROPS: PropDef[] = [
  { value: "percent", label: "процент", unit: "num" },
  { value: "score", label: "балл", unit: "num" },
];
const TOPIC_PROPS: PropDef[] = [
  { value: "percent", label: "процент", unit: "num" },
  { value: "score", label: "балл", unit: "num" },
  { value: "passed", label: "пройдена", unit: "bool" },
];
const SCALE_PROPS: PropDef[] = [
  { value: "raw", label: "сырой балл", unit: "num" },
  { value: "percent", label: "процент", unit: "num" },
  { value: "level", label: "уровень", unit: "level" },
];

export type ElementKind = "overall" | "topic" | "scale";

export function elementKind(el: string): ElementKind {
  if (el.startsWith("topic:")) return "topic";
  if (el.startsWith("scale:")) return "scale";
  return "overall";
}

function propsForElement(el: string): PropDef[] {
  switch (elementKind(el)) {
    case "topic":
      return TOPIC_PROPS;
    case "scale":
      return SCALE_PROPS;
    default:
      return OVERALL_PROPS;
  }
}

/** Unit of `property` on `element` (defaults to numeric for unknown pairs). */
export function unitOf(el: string, property: string): Unit {
  return propsForElement(el).find((p) => p.value === property)?.unit ?? "num";
}

/** «Свойство» options for the chosen element. */
export function propertyOptions(el: string): BuilderOption[] {
  return propsForElement(el).map((p) => ({ value: p.value, label: p.label }));
}

/** First property of an element kind — used when the element kind changes. */
export function firstProperty(el: string): string {
  return propsForElement(el)[0]?.value ?? "percent";
}

/** Grouped «Элемент» options: «Общий результат», then «Темы», then «Шкалы». */
export function elementOptions(topics: TopicRef[], scales: ScaleRef[]): BuilderOption[] {
  const opts: BuilderOption[] = [{ value: "overall", label: "Общий результат" }];
  for (const t of topics) opts.push({ value: `topic:${t.id}`, label: t.name, group: "Темы" });
  for (const s of scales) opts.push({ value: `scale:${s.key}`, label: s.label || s.key, group: "Шкалы" });
  return opts;
}

/** Level options for the value select when the property unit is «уровень». */
export function levelOptions(el: string, scales: ScaleRef[]): BuilderOption[] {
  if (elementKind(el) !== "scale") return [];
  const key = el.slice("scale:".length);
  const levels = scales.find((s) => s.key === key)?.levels ?? [];
  return levels.map((l) => ({ value: l, label: l }));
}

/**
 * Accessor expression for an element. Topics are addressed readably: by their
 * custom code (`topicById("code")`) when set, else by name (`topicByName("…")`);
 * the opaque UUID is only a last-resort fallback when the topic is unknown.
 */
function elementExpr(el: string, topics: TopicRef[]): string {
  switch (elementKind(el)) {
    case "topic": {
      const uuid = el.slice("topic:".length);
      const t = topics.find((x) => x.id === uuid);
      if (t?.code) return `topicById("${t.code}")`;
      if (t?.name) return `topicByName(${JSON.stringify(t.name)})`;
      return `topicById("${uuid}")`;
    }
    case "scale":
      return `scaleById("${el.slice("scale:".length)}")`;
    default:
      return "";
  }
}

/** Canonical DSL for one condition. `topics` resolves a topic element to a readable ref. */
export function conditionToDsl(c: Condition, topics: TopicRef[] = []): string {
  const kind = elementKind(c.element);
  const unit = unitOf(c.element, c.property);
  const expr = kind === "overall" ? c.property : `${elementExpr(c.element, topics)}.${c.property}`;
  if (unit === "bool") return expr;
  if (unit === "level") {
    const op = c.op === "!=" ? "!=" : "=";
    return `${expr} ${op} ${JSON.stringify(c.value.trim())}`;
  }
  const num = c.value.trim() === "" ? "0" : c.value.trim();
  return `${expr} ${c.op} ${num}`;
}

/** «Порог» — one condition → boolean. */
export function thresholdDsl(c: Condition, topics: TopicRef[] = []): string {
  return conditionToDsl(c, topics);
}

/** «Вердикт» — conjunction of conditions → boolean. */
export function verdictDsl(conds: Condition[], topics: TopicRef[] = []): string {
  return conds.map((c) => conditionToDsl(c, topics)).filter(Boolean).join(" AND ");
}

/** «Категория по уровням шкалы» — nested IF over a scale's level → string. */
export function categoryDsl(
  scaleKey: string,
  rows: Array<{ level: string; label: string }>,
  elseLabel: string,
): string {
  if (!scaleKey) return "";
  const expr = `scaleById("${scaleKey}").level`;
  let acc = JSON.stringify(elseLabel);
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!r.level.trim()) continue;
    acc = `IF(${expr} = ${JSON.stringify(r.level)}, ${JSON.stringify(r.label)}, ${acc})`;
  }
  return acc;
}

/** «Взвешенная сумма» — Σ scaleById(k).raw * weight → number. */
export function weightedDsl(rows: Array<{ scaleKey: string; weight: string }>): string {
  return rows
    .filter((r) => r.scaleKey)
    .map((r) => `scaleById("${r.scaleKey}").raw * ${r.weight.trim() === "" ? "0" : r.weight.trim()}`)
    .join(" + ");
}

/** Default condition for a fresh threshold/verdict row (first scale, else overall). */
export function defaultCondition(scales: ScaleRef[]): Condition {
  if (scales.length > 0) {
    return { element: `scale:${scales[0].key}`, property: "percent", op: ">=", value: "70" };
  }
  return { element: "overall", property: "percent", op: ">=", value: "70" };
}

// ─── DSL function reference («Функции» modal, PRD-2 §4.2) ───────────────────────

/** One entry in the DSL «Функции» reference. `insert` is spliced at the cursor. */
export type DslFunctionItem = { sig: string; desc: string; insert: string };
export type DslFunctionGroup = { title: string; items: DslFunctionItem[] };

/**
 * Reference shown in the «Функции» modal of the DSL editor. Source of truth is the
 * parser (`shared/formula/parser.ts`). Teги/секции are intentionally excluded —
 * the runtime does not populate them (PRD-2 §4.2.4).
 */
export const DSL_FUNCTION_GROUPS: DslFunctionGroup[] = [
  {
    title: "Объекты результата",
    items: [
      { sig: "percent", desc: "общий процент за тест", insert: "percent" },
      { sig: "score", desc: "общий балл за тест", insert: "score" },
      { sig: 'topicById("…").percent', desc: "процент по теме", insert: 'topicById("").percent' },
      { sig: 'topicById("…").score', desc: "набранные баллы по теме", insert: 'topicById("").score' },
      { sig: 'topicById("…").passed', desc: "тема пройдена (да/нет)", insert: 'topicById("").passed' },
      { sig: 'scaleById("…").raw', desc: "сырой балл шкалы", insert: 'scaleById("").raw' },
      { sig: 'scaleById("…").percent', desc: "шкала в процентах", insert: 'scaleById("").percent' },
      { sig: 'scaleById("…").level', desc: "уровень шкалы (строка)", insert: 'scaleById("").level' },
      { sig: 'var("…")', desc: "значение показателя выше по порядку", insert: 'var("")' },
    ],
  },
  {
    title: "Агрегаты",
    items: [
      { sig: "countPassed()", desc: "сколько тем пройдено", insert: "countPassed()" },
      { sig: "countTopics()", desc: "сколько тем всего", insert: "countTopics()" },
      { sig: "avgPercent()", desc: "средний процент по темам", insert: "avgPercent()" },
      {
        sig: 'countScales(["…"], "high")',
        desc: "сколько перечисленных шкал на уровне",
        insert: 'countScales([""], "")',
      },
    ],
  },
  {
    title: "Условия и логика",
    items: [
      { sig: "IF(условие, то, иначе)", desc: "ветвление", insert: "IF(, , )" },
      { sig: "AND / OR / NOT", desc: "логические связки", insert: " AND " },
      { sig: ">= > = <= < !=", desc: "сравнения", insert: " >= " },
      { sig: "+ - * /", desc: "арифметика", insert: " + " },
    ],
  },
];
