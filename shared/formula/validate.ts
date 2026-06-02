/**
 * @module shared/formula/validate
 *
 * Static validation for result-variable formulas (PRD-2 §4.3). Parses the source
 * (syntax), infers a coarse return type and compares it with the declared `type`,
 * and checks references: `topicById`/`sectionById` must resolve to existing
 * entities (error), `var()` may only reference variables with a smaller
 * `sort_order` (error, guarantees an acyclic indicator graph — scoring-model
 * §10.9), `scaleById` resolves to warnings while scales are unavailable (Этап A),
 * and `countScales` level arguments that fall outside a scale's band levels warn.
 */

import {
  type Ast,
  type ValidationRefs,
  type ValidationResult,
  type ValidationMessage,
  type ValueType,
  FormulaSyntaxError,
} from "./types";
import { parse } from "./parser";

/** Infer a coarse return type from the AST shape. `unknown` skips type checking. */
function inferType(node: Ast): ValueType | "unknown" {
  switch (node.type) {
    case "number":
    case "percent":
    case "nullary":
    case "count":
      return "number";
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "accessor": {
      if (node.prop === "passed" || node.prop === "completed" || node.prop === "hasValue") return "boolean";
      if (node.prop === "level" || node.prop === "label") return "string";
      return "number";
    }
    case "var":
      return "unknown";
    case "unary":
      return node.op === "NOT" ? "boolean" : "number";
    case "binary": {
      if (node.op === "AND" || node.op === "OR") return "boolean";
      if (["=", "!=", ">", ">=", "<", "<="].includes(node.op)) return "boolean";
      return "number"; // arithmetic
    }
    case "if": {
      const a = inferType(node.then);
      const b = inferType(node.otherwise);
      if (a === b) return a;
      if (a === "unknown") return b;
      if (b === "unknown") return a;
      return "unknown";
    }
  }
}

function walk(node: Ast, visit: (n: Ast) => void): void {
  visit(node);
  switch (node.type) {
    case "if":
      walk(node.cond, visit);
      walk(node.then, visit);
      walk(node.otherwise, visit);
      break;
    case "unary":
      walk(node.operand, visit);
      break;
    case "binary":
      walk(node.left, visit);
      walk(node.right, visit);
      break;
    default:
      break;
  }
}

/**
 * Validate a formula. `declaredType` is the result-variable's `type`; `refs`
 * supplies the entity sets to check against (any omitted set disables its check).
 */
export function validate(
  src: string,
  declaredType: ValueType,
  refs: ValidationRefs = {},
): ValidationResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];

  let ast: Ast;
  try {
    ast = parse(src);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Синтаксическая ошибка";
    return {
      valid: false,
      errors: [{ code: "syntax", message }],
      warnings: [],
      returnType: "unknown",
    };
  }

  walk(ast, (n) => {
    if (n.type === "accessor") {
      if (n.fn === "topicById" && refs.topicIds && !refs.topicIds.has(n.arg)) {
        errors.push({ code: "unknown-topic", message: `Неизвестная тема «${n.arg}»` });
      }
      if (n.fn === "sectionById" && refs.sectionKeys && !refs.sectionKeys.has(n.arg)) {
        errors.push({ code: "unknown-section", message: `Неизвестная секция «${n.arg}»` });
      }
      if (n.fn === "scaleById") {
        const known = refs.scaleKeys && refs.scaleKeys.size > 0 && refs.scaleKeys.has(n.arg);
        if (!known) {
          warnings.push({
            code: "scale-unresolved",
            message: `Шкала «${n.arg}» пока недоступна (шкалы появятся в PRD-5)`,
          });
        }
      }
    }
    if (n.type === "var" && refs.priorVarNames && !refs.priorVarNames.has(n.name)) {
      errors.push({
        code: "var-order",
        message: `«var("${n.name}")» должен ссылаться на показатель выше по порядку (sort_order)`,
      });
    }
    if (n.type === "count" && n.fn === "countScales" && refs.scaleBandLevels) {
      for (const key of n.keys) {
        const levels = refs.scaleBandLevels[key];
        if (levels && !levels.has(n.level)) {
          warnings.push({
            code: "count-scales-level",
            message: `Уровень «${n.level}» не входит в диапазоны шкалы «${key}»`,
          });
        }
      }
    }
  });

  const returnType = inferType(ast);
  if (returnType !== "unknown" && returnType !== declaredType) {
    errors.push({
      code: "type-mismatch",
      message: `Формула возвращает ${returnType}, а тип показателя — ${declaredType}`,
    });
  }

  return { valid: errors.length === 0, errors, warnings, returnType };
}

export { FormulaSyntaxError };
