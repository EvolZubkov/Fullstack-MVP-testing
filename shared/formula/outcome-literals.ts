/**
 * @module shared/formula/outcome-literals
 *
 * Reconciles a string indicator's formula with its declared outcome list.
 *
 * The formula returns an outcome CODE, and nothing checks that the codes it can
 * return actually exist: a one-character typo silently produces an empty card, and
 * only for the learner who lands in that branch. Walking the AST turns that into an
 * editing-time error.
 *
 * Entity references are NOT string nodes — `scaleById("ee")` parses to
 * `{ type: "accessor", fn, arg, prop }` with the key in `arg`, and `var` / `count`
 * hold their names the same way. So a `{ type: "string" }` node is always a VALUE
 * literal, which is exactly an outcome code. The filtering is structural; no list of
 * accessor names is needed or wanted.
 *
 * The walk is an exhaustive switch over the `Ast` union rather than a generic object
 * traversal: adding a node type then becomes a compile error here instead of a
 * silently skipped branch.
 *
 * Pure — no DOM, no Node.
 */

import { parse } from "./parser";
import type { Ast } from "./types";

function walk(node: Ast, out: Set<string>): void {
  switch (node.type) {
    case "string":
      out.add(node.value);
      return;
    case "if":
      walk(node.cond, out);
      walk(node.then, out);
      walk(node.otherwise, out);
      return;
    case "unary":
      walk(node.operand, out);
      return;
    case "binary":
      walk(node.left, out);
      walk(node.right, out);
      return;
    case "number":
    case "boolean":
    case "percent":
    case "score":
    case "accessor":
    case "var":
    case "nullary":
    case "count":
    case "scaleRank":
    case "scaleGroup":
      // Строки внутри этих узлов — ключи сущностей и порог, а не коды исходов: они лежат в
      // ПОЛЯХ узла, а не отдельными строковыми узлами, и в выдачу попасть не могут.
      return;
  }
}

/**
 * Every distinct string literal the formula can yield. An unparseable formula gives
 * an empty list: the author is mid-edit, and a syntax error is already reported by
 * the editor's own validation.
 */
export function collectStringLiterals(formula: string): string[] {
  try {
    const out = new Set<string>();
    walk(parse(formula), out);
    return Array.from(out);
  } catch {
    return [];
  }
}

/** The profile group a formula declares: its scale keys and the upper-zone threshold. */
export type ScaleGroupRef = { keys: string[]; threshold: number | string };

/** Depth-first search for the first `topGroup(...)` node. */
function findGroup(node: Ast): ScaleGroupRef | null {
  switch (node.type) {
    case "scaleGroup":
      return { keys: [...node.keys], threshold: node.threshold };
    case "if":
      return findGroup(node.cond) ?? findGroup(node.then) ?? findGroup(node.otherwise);
    case "unary":
      return findGroup(node.operand);
    case "binary":
      return findGroup(node.left) ?? findGroup(node.right);
    default:
      return null;
  }
}

/**
 * The profile group of a formula, or `null` when it declares none.
 *
 * The editor needs the group WITHOUT re-deriving it from its own form state: the form
 * is rebuilt from scratch when a card is reopened, while the formula is what was saved.
 * Reading it back from the source keeps the matrix generator and the coverage warning
 * honest about the indicator as it actually stands (PRD-53 §5.2, §5.3.2).
 *
 * The FIRST group wins. A formula with two of them is not a shape the template
 * produces, and picking one arbitrarily beats refusing to help the author at all.
 */
export function readScaleGroup(formula: string): ScaleGroupRef | null {
  try {
    return findGroup(parse(formula));
  } catch {
    return null;
  }
}

/** The indicator a formula reads WHOLE, or `null` when it reads none. */
function readVarRef(formula: string): string | null {
  try {
    const ast = parse(formula);
    return ast.type === "var" ? ast.name : null;
  } catch {
    return null;
  }
}

/**
 * The profile group an indicator's VALUE carries — its own, or that of the indicator it
 * reads through `var()`.
 *
 * Нужен там, где решение зависит не от того, КТО считает набор, а от того, ЧТО показатель
 * несёт. Такова карточка «шкалы вне профиля»: её поля правятся у показателя, который её
 * печатает, а печатает её не обязательно тот, кто считает. Разойтись они обязаны по
 * устройству продукта: карточка печатается вместе со СВОИМ владельцем и по методике идёт
 * последней, значит владелец стоит НИЖЕ по порядку, — а `var()` читает только то, что
 * посчитано РАНЬШЕ, то есть выше. Владелец блока и вычислитель не могут быть одним
 * показателем (находка F6 приёмки PRD-53, 2026-09-07).
 *
 * Ссылка разбирается, только когда формула читает показатель ЦЕЛИКОМ (`var("x")`): в
 * выражении вроде `IF(var("a") > 1, …)` единого профиля нет, и угадывать его — врать.
 * Цепочка ограничена и защищена от круга: сослаться на себя или закольцеваться формулы
 * автору никто не запрещает, а зациклиться редактор не имеет права.
 */
export function resolveScaleGroup(
  formula: string,
  formulaOf: (name: string) => string | undefined,
  maxHops = 4,
): ScaleGroupRef | null {
  let current = formula;
  const seen = new Set<string>();
  for (let hop = 0; hop <= maxHops; hop += 1) {
    const own = readScaleGroup(current);
    if (own) return own;
    const ref = readVarRef(current);
    if (ref === null || seen.has(ref)) return null;
    seen.add(ref);
    const next = formulaOf(ref);
    if (next === undefined) return null;
    current = next;
  }
  return null;
}

/**
 * Literals the formula can return that the outcome list does not declare. An empty
 * outcome list yields nothing: the author has not started declaring outcomes yet, and
 * flagging every literal at that point would be noise.
 */
export function findUnknownOutcomes(formula: string, codes: string[]): string[] {
  if (codes.length === 0) return [];
  const known = new Set(codes);
  return collectStringLiterals(formula).filter((literal) => !known.has(literal));
}
