/**
 * @module shared/formula/tokens
 *
 * Tokenizer (lexer) for the result-variable formula DSL (PRD-2 §4.2). Turns
 * source text into a flat token list consumed by the parser. Recognises numbers,
 * double-quoted strings, identifiers (sources and keywords), operators and
 * punctuation. Keywords (`IF`/`AND`/`OR`/`NOT`) and source names are returned as
 * `ident` tokens; the parser resolves their meaning by exact text.
 */

import { FormulaSyntaxError } from "./types";

export type TokenType = "number" | "string" | "ident" | "op" | "punct" | "eof";

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

/** Multi-char operators must precede their single-char prefixes. */
const OPERATORS = ["!=", ">=", "<=", "=", ">", "<", "+", "-", "*", "/"];
const PUNCT = new Set(["(", ")", ",", "[", "]", "."]);

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

/**
 * Tokenize a formula. Throws {@link FormulaSyntaxError} on an unexpected
 * character or an unterminated string. Always ends with an `eof` token.
 */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i];

    // Whitespace.
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // Number: digits with an optional single decimal part.
    if (isDigit(ch)) {
      const start = i;
      while (i < n && isDigit(src[i])) i++;
      if (i < n && src[i] === "." && isDigit(src[i + 1] ?? "")) {
        i++;
        while (i < n && isDigit(src[i])) i++;
      }
      tokens.push({ type: "number", value: src.slice(start, i), pos: start });
      continue;
    }

    // Double-quoted string with `\"` and `\\` escapes.
    if (ch === '"') {
      const start = i;
      i++;
      let value = "";
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < n) {
          const next = src[i + 1];
          value += next === "n" ? "\n" : next;
          i += 2;
        } else {
          value += src[i];
          i++;
        }
      }
      if (i >= n) throw new FormulaSyntaxError("Незакрытая строка", start);
      i++; // closing quote
      tokens.push({ type: "string", value, pos: start });
      continue;
    }

    // Identifier (source name or keyword).
    if (isIdentStart(ch)) {
      const start = i;
      while (i < n && isIdentPart(src[i])) i++;
      tokens.push({ type: "ident", value: src.slice(start, i), pos: start });
      continue;
    }

    // Punctuation.
    if (PUNCT.has(ch)) {
      tokens.push({ type: "punct", value: ch, pos: i });
      i++;
      continue;
    }

    // Operators (longest match first).
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      tokens.push({ type: "op", value: op, pos: i });
      i += op.length;
      continue;
    }

    throw new FormulaSyntaxError(`Неожиданный символ «${ch}»`, i);
  }

  tokens.push({ type: "eof", value: "", pos: n });
  return tokens;
}
