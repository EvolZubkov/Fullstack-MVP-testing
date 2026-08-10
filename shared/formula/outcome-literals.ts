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
