/**
 * @module shared/formula/parser
 *
 * Recursive-descent parser for the result-variable formula DSL (PRD-2 §4.2).
 * Consumes the {@link Token} stream and produces an {@link Ast}. Precedence,
 * lowest to highest: OR < AND < comparison < (+ -) < (* /) < unary (NOT/neg) <
 * primary. Comparisons are non-associative (a single comparison per level).
 * Never uses `eval` / `Function`.
 */

import {
  type Ast,
  type AccessorFn,
  type CountFn,
  type NullaryFn,
  type ScaleRankFn,
  ACCESSOR_PROPS,
  SCALE_RANK_PROPS,
  FormulaSyntaxError,
} from "./types";
import { tokenize, type Token } from "./tokens";

const ACCESSOR_FNS = new Set<AccessorFn>(["topicById", "topicByName", "tag", "scaleById", "sectionById"]);
const NULLARY_FNS = new Set<NullaryFn>(["countPassed", "countTopics", "avgPercent"]);
const COUNT_FNS = new Set<CountFn>(["countVars", "countScales"]);
const SCALE_RANK_FNS = new Set<ScaleRankFn>(["topScale", "bottomScale"]);
const COMPARISONS = new Set(["=", "!=", ">", ">=", "<", "<="]);

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  private isIdent(value: string): boolean {
    const t = this.peek();
    return t.type === "ident" && t.value === value;
  }

  private expectPunct(value: string): void {
    const t = this.next();
    if (t.type !== "punct" || t.value !== value) {
      throw new FormulaSyntaxError(`Ожидалось «${value}»`, t.pos);
    }
  }

  parse(): Ast {
    const expr = this.parseOr();
    const t = this.peek();
    if (t.type !== "eof") {
      throw new FormulaSyntaxError(`Лишний токен «${t.value}»`, t.pos);
    }
    return expr;
  }

  private parseOr(): Ast {
    let left = this.parseAnd();
    while (this.isIdent("OR")) {
      this.next();
      left = { type: "binary", op: "OR", left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Ast {
    let left = this.parseComparison();
    while (this.isIdent("AND")) {
      this.next();
      left = { type: "binary", op: "AND", left, right: this.parseComparison() };
    }
    return left;
  }

  private parseComparison(): Ast {
    const left = this.parseAddSub();
    const t = this.peek();
    if (t.type === "op" && COMPARISONS.has(t.value)) {
      this.next();
      const op = t.value as "=" | "!=" | ">" | ">=" | "<" | "<=";
      return { type: "binary", op, left, right: this.parseAddSub() };
    }
    return left;
  }

  private parseAddSub(): Ast {
    let left = this.parseMulDiv();
    while (this.peek().type === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.next().value as "+" | "-";
      left = { type: "binary", op, left, right: this.parseMulDiv() };
    }
    return left;
  }

  private parseMulDiv(): Ast {
    let left = this.parseUnary();
    while (this.peek().type === "op" && (this.peek().value === "*" || this.peek().value === "/")) {
      const op = this.next().value as "*" | "/";
      left = { type: "binary", op, left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): Ast {
    if (this.isIdent("NOT")) {
      this.next();
      return { type: "unary", op: "NOT", operand: this.parseUnary() };
    }
    if (this.peek().type === "op" && this.peek().value === "-") {
      this.next();
      return { type: "unary", op: "neg", operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Ast {
    const t = this.peek();

    if (t.type === "number") {
      this.next();
      return { type: "number", value: Number(t.value) };
    }
    if (t.type === "string") {
      this.next();
      return { type: "string", value: t.value };
    }
    if (t.type === "punct" && t.value === "(") {
      this.next();
      const expr = this.parseOr();
      this.expectPunct(")");
      return expr;
    }
    if (t.type === "ident") {
      return this.parseIdent(t);
    }

    throw new FormulaSyntaxError(`Неожиданный токен «${t.value || "конец"}»`, t.pos);
  }

  /** `["k1","k2"]` — the shared key-list argument of the counting and ranking sources. */
  private parseKeyList(): string[] {
    this.expectPunct("[");
    const keys: string[] = [];
    if (!(this.peek().type === "punct" && this.peek().value === "]")) {
      keys.push(this.parseString());
      while (this.peek().type === "punct" && this.peek().value === ",") {
        this.next();
        keys.push(this.parseString());
      }
    }
    this.expectPunct("]");
    return keys;
  }

  private parseString(): string {
    const t = this.next();
    if (t.type !== "string") throw new FormulaSyntaxError("Ожидалась строка-аргумент", t.pos);
    return t.value;
  }

  private parseIdent(t: Token): Ast {
    const name = t.value;

    if (name === "true" || name === "false") {
      this.next();
      return { type: "boolean", value: name === "true" };
    }

    if (name === "IF") {
      this.next();
      this.expectPunct("(");
      const cond = this.parseOr();
      this.expectPunct(",");
      const then = this.parseOr();
      this.expectPunct(",");
      const otherwise = this.parseOr();
      this.expectPunct(")");
      return { type: "if", cond, then, otherwise };
    }

    if (name === "percent") {
      this.next();
      return { type: "percent" };
    }

    if (name === "score") {
      this.next();
      return { type: "score" };
    }

    if (ACCESSOR_FNS.has(name as AccessorFn)) {
      this.next();
      this.expectPunct("(");
      const arg = this.parseString();
      this.expectPunct(")");
      this.expectPunct(".");
      const propTok = this.next();
      if (propTok.type !== "ident") throw new FormulaSyntaxError("Ожидалось свойство", propTok.pos);
      const fn = name as AccessorFn;
      if (!ACCESSOR_PROPS[fn].includes(propTok.value)) {
        throw new FormulaSyntaxError(`У «${fn}» нет свойства «${propTok.value}»`, propTok.pos);
      }
      return { type: "accessor", fn, arg, prop: propTok.value };
    }

    if (name === "var") {
      this.next();
      this.expectPunct("(");
      const varName = this.parseString();
      this.expectPunct(")");
      return { type: "var", name: varName };
    }

    if (NULLARY_FNS.has(name as NullaryFn)) {
      this.next();
      this.expectPunct("(");
      this.expectPunct(")");
      return { type: "nullary", fn: name as NullaryFn };
    }

    // `topScale(["k1","k2"], 1).key` — the counting form plus property access. The place
    // is a NUMBER (a rank), unlike `countScales`, whose second argument is a level string.
    if (SCALE_RANK_FNS.has(name as ScaleRankFn)) {
      this.next();
      this.expectPunct("(");
      const keys = this.parseKeyList();
      this.expectPunct(",");
      const placeTok = this.next();
      if (placeTok.type !== "number") {
        throw new FormulaSyntaxError("Ожидалось место в рейтинге числом", placeTok.pos);
      }
      this.expectPunct(")");
      this.expectPunct(".");
      const propTok = this.next();
      if (propTok.type !== "ident") throw new FormulaSyntaxError("Ожидалось свойство", propTok.pos);
      if (!SCALE_RANK_PROPS.includes(propTok.value)) {
        throw new FormulaSyntaxError(`У «${name}» нет свойства «${propTok.value}»`, propTok.pos);
      }
      return {
        type: "scaleRank",
        fn: name as ScaleRankFn,
        keys,
        place: Number(placeTok.value),
        prop: propTok.value,
      };
    }

    if (COUNT_FNS.has(name as CountFn)) {
      this.next();
      this.expectPunct("(");
      const keys = this.parseKeyList();
      this.expectPunct(",");
      const level = this.parseString();
      this.expectPunct(")");
      return { type: "count", fn: name as CountFn, keys, level };
    }

    throw new FormulaSyntaxError(`Неизвестный источник «${name}»`, t.pos);
  }
}

/** Parse formula source into an {@link Ast}. Throws {@link FormulaSyntaxError}. */
export function parse(src: string): Ast {
  return new Parser(tokenize(src)).parse();
}
