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
 * PRD-50 FR-36: a `tag("<section>::<key>")` composite key checks its section part
 * strictly and its key part as a warning.
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
import { parseGroupThreshold } from "./scale-group";

/** Infer a coarse return type from the AST shape. `unknown` skips type checking. */
function inferType(node: Ast): ValueType | "unknown" {
  switch (node.type) {
    case "number":
    case "percent":
    case "score":
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
    case "scaleRank":
      // `key`/`label` are strings, the rest numbers — the same split the accessor uses.
      return node.prop === "key" || node.prop === "label" ? "string" : "number";
    case "scaleGroup":
      // `code` — строка-набор, `count`/`max` — числа. Тот же раскол, что у ранга.
      return node.prop === "code" ? "string" : "number";
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
      if (n.fn === "topicByName" && refs.topicNames && !refs.topicNames.has(n.arg)) {
        errors.push({ code: "unknown-topic", message: `Неизвестная тема «${n.arg}»` });
      }
      if (n.fn === "sectionById" && refs.sectionKeys && !refs.sectionKeys.has(n.arg)) {
        errors.push({ code: "unknown-section", message: `Неизвестная секция «${n.arg}»` });
      }
      if (n.fn === "tag" && n.arg.includes("::")) {
        // PRD-50 FR-36: composite key «<section>::<key>». The section part is checked
        // strictly — a typo there yields an eternal zero; the key itself only warns,
        // since it may well have been added to the questions afterwards. Split on the
        // FIRST separator only: the section id never contains one, while a breakdown key
        // may, and `split("::")[1]` would then check a truncated key.
        // Checked against `refs.scopeKeys`, NOT `refs.sectionKeys` — see the JSDoc on
        // `ValidationRefs.scopeKeys` for why the two must stay independent.
        const sep = n.arg.indexOf("::");
        const scopeKey = n.arg.slice(0, sep);
        const tagKey = n.arg.slice(sep + 2);
        if (refs.scopeKeys && !refs.scopeKeys.has(scopeKey)) {
          errors.push({ code: "unknown-section", message: `Неизвестная секция «${scopeKey}»` });
        }
        if (refs.tagKeys && refs.tagKeys.size > 0 && !refs.tagKeys.has(tagKey)) {
          warnings.push({ code: "tag-unresolved", message: `Ключ «${tagKey}» не найден в вопросах теста` });
        }
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
    if (n.type === "scaleRank") {
      if (n.keys.length === 0) {
        errors.push({
          code: "scale-rank-empty",
          message: `«${n.fn}» нужен непустой список ключей шкал`,
        });
      }
      if (n.place < 1) {
        errors.push({
          code: "scale-rank-place",
          message: `Место в рейтинге считается с единицы, получено ${n.place}`,
        });
      }
      if (refs.scaleKeys && refs.scaleKeys.size > 0) {
        for (const key of n.keys) {
          if (!refs.scaleKeys.has(key)) {
            errors.push({ code: "unknown-scale", message: `Неизвестная шкала «${key}»` });
          }
        }
      }
      if (n.prop === "key") {
        // Проверка «строковый показатель возвращает только объявленные коды исходов»
        // на этом свойстве не работает: код приходит из ДАННЫХ, а не литералом. Поэтому
        // предупреждение с подсказкой, а не ошибка (FR-24).
        warnings.push({
          code: "scale-rank-key",
          message: "Ключи шкал должны совпадать с кодами исходов показателя",
        });
      }
    }
    if (n.type === "scaleGroup") {
      if (n.keys.length < 2) {
        errors.push({
          code: "scale-group-small",
          message: "В группе профиля нужны хотя бы две шкалы",
        });
      }
      const threshold = parseGroupThreshold(n.threshold);
      if (threshold === null) {
        errors.push({
          code: "scale-group-threshold",
          message: "Порог верхней зоны — неотрицательное число или строка вида «10%»",
        });
      }
      if (refs.scaleKeys && refs.scaleKeys.size > 0) {
        for (const key of n.keys) {
          if (!refs.scaleKeys.has(key)) {
            errors.push({ code: "unknown-scale", message: `Неизвестная шкала «${key}»` });
          }
        }
      }
      // Абсолютный порог на группе с разной нормализацией сравнивает несопоставимые величины:
      // у одной шкалы «5» это пять баллов, у другой — пять процентов. Долевой порог от этого
      // свободен, поэтому предупреждение только для абсолютного.
      if (threshold?.kind === "abs" && refs.scaleNormalizations) {
        const modes = new Set(
          n.keys.map((key) => refs.scaleNormalizations?.[key]).filter((mode): mode is string => !!mode),
        );
        if (modes.size > 1) {
          warnings.push({
            code: "scale-group-normalization",
            message:
              "Шкалы группы нормализованы по-разному: порог в баллах сравнивает несопоставимые" +
              " величины. Задайте порог долей от максимума",
          });
        }
      }
      if (n.prop === "code") {
        // Проверить, что коды исходов покрывают все наборы, здесь нельзя: коды приходят из
        // ДАННЫХ показателя, а не из формулы. Отсюда подсказка, а не ошибка — как у `topScale`.
        warnings.push({
          code: "scale-group-code",
          message: "Коды исходов должны быть наборами ключей шкал через «+»",
        });
      }
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
