/**
 * @module server/utils/scoring-excel
 *
 * Excel-cell <-> `questions.scoring_json` (PRD-10) serialization for the
 * question-bank import/export (PRD-14 §7, "Цена ответа"). The grammar is the
 * single authoring surface for graded scoring in Excel and mirrors the editor's
 * `ScoringBuilder` (client/src/pages/author/scoring-builder.tsx) so a question
 * round-trips through either UI.
 *
 * Grammar (PRD-14 format §7):
 * - empty / `точное`              -> null (exact match, 0/1; FR-02 default)
 * - `веса: w1 # w2 # ...`         -> weighted (single only); fewer weights than
 *   options pad with 0, more is an error; optional `; sMax=<n>`
 * - `%A2B1C1D0`                   -> weighted (single only); the РТК answer-key
 *   notation (scoring-model §11.3) accepted as a positional alias of `веса`:
 *   letters name options by position and must run A, B, C… in order. Import-only —
 *   `serializeScoring` always writes the canonical `веса:` form
 * - `ступени: <correct|wrong><op><rhs>[& ...] => <score>; ...` -> tiered (multiple/
 *   matching/ranking); tiers split by `;` or `,`, conditions by `&`; score uses
 *   a dot decimal (comma is a list separator); `rhs` is a number or the keyword
 *   `total` (всего верных); optional `sMax=<n>` segment. Legacy single-letter
 *   tokens (`c`/`x`/`T`/`P`/`N`) are still accepted on import for back-compat.
 *
 * The result is validated by `questionScoringSchema`; a mode that does not match
 * the question type, or any malformed segment, returns `{ ok: false }`.
 */

import { questionScoringSchema, type QuestionScoring } from "@shared/schema";
import { distributesBudget, isSingleIndexChoice } from "@shared/questions/question-type";

/** Question types accepted by the scoring grammar. */
export type ScoringQuestionType = "single" | "multiple" | "matching" | "ranking" | "scale" | "allocation";

/** Parse outcome: a validated scoring config (or null = exact), or an error. */
export type ParseScoringResult =
  | { ok: true; value: QuestionScoring | null }
  | { ok: false; error: string };

/**
 * Serialize a `scoring_json` value back to the Excel "Цена ответа" grammar.
 * Returns "" for exact / null (an empty cell re-imports as exact).
 */
export function serializeScoring(scoring: QuestionScoring | null | undefined): string {
  if (!scoring || scoring.kind === "exact") return "";

  if (scoring.kind === "weighted") {
    const base = `веса: ${scoring.weights.join(" # ")}`;
    return scoring.sMax != null ? `${base}; sMax=${scoring.sMax}` : base;
  }

  // tiered — write the readable keywords (correct/wrong/total), not c/x/T.
  const lhsTo: Record<string, string> = { c: "correct", x: "wrong" };
  const rhsTo = (rhs: number | string): string =>
    rhs === "T" || rhs === "P" || rhs === "N" ? "total" : String(rhs);
  const tiers = scoring.tiers
    .map((t) => {
      const conds = t.when.all.map((c) => `${lhsTo[c.lhs] ?? c.lhs} ${c.op} ${rhsTo(c.rhs)}`).join(" & ");
      return `${conds} => ${t.score}`;
    })
    .join("; ");
  const base = `ступени: ${tiers}`;
  return scoring.sMax != null ? `${base}; sMax=${scoring.sMax}` : base;
}

/** Pull `; sMax=<n>` out of a `;`-separated body (weighted form). */
function extractSMax(body: string): { main: string; sMax?: number; error?: string } {
  const segments = body.split(";");
  const mainSegs: string[] = [];
  let sMax: number | undefined;
  for (const seg of segments) {
    const m = /^\s*sMax\s*=\s*(.+?)\s*$/i.exec(seg);
    if (m) {
      const n = Number(m[1]);
      if (!Number.isFinite(n) || n <= 0) return { main: "", error: `некорректный sMax "${m[1]}"` };
      sMax = n;
    } else if (seg.trim().length > 0) {
      mainSegs.push(seg);
    }
  }
  return { main: mainSegs.join(";"), sMax };
}

/** Left-hand keyword → stored token. `correct`/`wrong` are canonical; the
 *  single letters and Russian words are accepted aliases (back-compat / UX). */
const LHS_FROM: Record<string, "c" | "x"> = {
  correct: "c", c: "c", верно: "c", верных: "c",
  wrong: "x", x: "x", неверно: "x", неверных: "x", лишних: "x",
};

/**
 * Parse one tier condition `<correct|wrong> <op> <rhs>`. `rhs` is a number or the
 * keyword `total` (всего верных), which maps to the per-type counter token
 * `totalToken` (`T`/`P`/`N`). The legacy single-letter tokens are still accepted.
 */
function parseCondition(
  raw: string,
  totalToken: "T" | "P" | "N",
): { ok: true; cond: { lhs: string; op: string; rhs: number | string } } | { ok: false; error: string } {
  const m = /^([A-Za-zА-Яа-я]+)\s*(==|>=|<=|<|>)\s*(.+)$/.exec(raw.trim());
  if (!m) return { ok: false, error: `некорректное условие "${raw.trim()}"` };
  const lhs = LHS_FROM[m[1].toLowerCase()];
  if (!lhs) {
    return { ok: false, error: `некорректная левая часть условия "${m[1]}" (ожидается correct/wrong)` };
  }
  const rhsRaw = m[3].trim();
  const rhsLower = rhsRaw.toLowerCase();
  const rhsUpper = rhsRaw.toUpperCase();
  let rhs: number | string;
  if (rhsLower === "total" || rhsLower === "всего") {
    rhs = totalToken;
  } else if (rhsUpper === "T" || rhsUpper === "P" || rhsUpper === "N") {
    rhs = rhsUpper;
  } else {
    const n = Number(rhsRaw);
    if (!Number.isFinite(n)) return { ok: false, error: `некорректная правая часть условия "${rhsRaw}"` };
    rhs = n;
  }
  return { ok: true, cond: { lhs, op: m[2], rhs } };
}

/**
 * Parse a "Цена ответа" cell into a `scoring_json` value (or null = exact).
 *
 * @param raw         Cell value.
 * @param type        Question type (gates weighted vs tiered).
 * @param optionCount Number of answer options (weighted: pad/limit weights).
 */
export function parseScoringCell(
  raw: unknown,
  type: ScoringQuestionType,
  optionCount: number,
): ParseScoringResult {
  const text = String(raw ?? "").trim();
  if (!text || text.toLowerCase() === "точное") return { ok: true, value: null };

  // PRD-44 FR-10: градуированная цена к распределению баллов неприменима — тип не
  // проверяется вовсе, поэтому ни «веса», ни «ступени» не с чем сопоставлять. Сказать
  // это прямо лучше, чем позволить формуле разобраться и молча ничего не посчитать.
  if (distributesBudget(type)) {
    return { ok: false, error: "распределение баллов не проверяется, «Цена ответа» к нему неприменима" };
  }

  const lower = text.toLowerCase();
  let value: unknown;

  if (lower.startsWith("веса:")) {
    // Шкала оценивается теми же весами по позициям градаций (PRD-26 FR-07).
    if (!isSingleIndexChoice(type)) {
      return { ok: false, error: "«веса» допустимы только для одиночного выбора и шкалы" };
    }
    const { main, sMax, error } = extractSMax(text.slice(text.indexOf(":") + 1));
    if (error) return { ok: false, error };

    const tokens = main.split("#").map((s) => s.trim());
    const weights: number[] = [];
    for (const tok of tokens) {
      if (tok === "") {
        weights.push(0);
        continue;
      }
      const n = Number(tok);
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: `некорректный вес "${tok}"` };
      weights.push(n);
    }
    if (weights.length > optionCount) {
      return { ok: false, error: `весов (${weights.length}) больше числа вариантов (${optionCount})` };
    }
    while (weights.length < optionCount) weights.push(0);

    value = { kind: "weighted", weights, ...(sMax != null ? { sMax } : {}) };
  } else if (text.startsWith("%")) {
    // РТК answer-key notation (`%A2B1C1D0`) — the source format the certification
    // banks are authored in (scoring-model §11.3). Positional alias of `веса`:
    // the letter names the option by position, the number is its weight. Latin
    // letters only — Cyrillic А/В/С are visually identical but order differently,
    // so accepting them would silently mis-assign weights.
    if (!isSingleIndexChoice(type)) {
      return { ok: false, error: "ключ «%…» допустим только для одиночного выбора и шкалы" };
    }
    const body = text.slice(1);
    const tokens = [...body.matchAll(/([A-Za-z])\s*(\d+(?:[.,]\d+)?)/g)];
    const consumed = tokens.map((m) => m[0]).join("");
    if (tokens.length === 0 || consumed.replace(/\s+/g, "") !== body.replace(/\s+/g, "")) {
      return { ok: false, error: `некорректный ключ «${text}» (ожидается вид «%A2B1C1D0»)` };
    }

    const weights: number[] = [];
    for (const [i, m] of tokens.entries()) {
      const letter = m[1].toUpperCase();
      const expected = String.fromCharCode(65 + i);
      if (letter !== expected) {
        return {
          ok: false,
          error: `буквы ключа должны идти по порядку A, B, C…: на позиции ${i + 1} стоит «${letter}», ожидалась «${expected}»`,
        };
      }
      const n = Number(m[2].replace(",", "."));
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: `некорректный вес "${m[2]}"` };
      weights.push(n);
    }
    if (weights.length > optionCount) {
      return { ok: false, error: `весов (${weights.length}) больше числа вариантов (${optionCount})` };
    }
    while (weights.length < optionCount) weights.push(0);

    value = { kind: "weighted", weights };
  } else if (lower.startsWith("ступени:")) {
    // Ступени считают по счётчикам выбранных единиц, а у одного индекса счётчик
    // всегда 0 или 1 — способ бессмысленный и для одиночного выбора, и для шкалы.
    if (isSingleIndexChoice(type)) {
      return { ok: false, error: "«ступени» недопустимы для одиночного выбора и шкалы" };
    }
    // `total` resolves to the per-type counter token: options/pairs/items.
    const totalToken: "T" | "P" | "N" = type === "matching" ? "P" : type === "ranking" ? "N" : "T";
    const body = text.slice(text.indexOf(":") + 1);
    const segments = body.split(/[;,]/).map((s) => s.trim()).filter(Boolean);

    const tiers: Array<{ when: { all: Array<{ lhs: string; op: string; rhs: number | string }> }; score: number }> = [];
    let sMax: number | undefined;

    for (const seg of segments) {
      const sm = /^sMax\s*=\s*(.+)$/i.exec(seg);
      if (sm) {
        const n = Number(sm[1].trim());
        if (!Number.isFinite(n) || n <= 0) return { ok: false, error: `некорректный sMax "${sm[1]}"` };
        sMax = n;
        continue;
      }

      const arrowIdx = seg.indexOf("=>");
      if (arrowIdx === -1) return { ok: false, error: `ступень без "=>": "${seg}"` };
      const condsStr = seg.slice(0, arrowIdx).trim();
      const scoreStr = seg.slice(arrowIdx + 2).trim();

      const score = Number(scoreStr);
      if (!Number.isFinite(score) || score < 0) return { ok: false, error: `некорректный балл ступени "${scoreStr}"` };

      const condParts = condsStr.split("&").map((s) => s.trim()).filter(Boolean);
      if (condParts.length === 0) return { ok: false, error: `ступень без условий: "${seg}"` };

      const all: Array<{ lhs: string; op: string; rhs: number | string }> = [];
      for (const cp of condParts) {
        const parsed = parseCondition(cp, totalToken);
        if (!parsed.ok) return parsed;
        all.push(parsed.cond);
      }
      tiers.push({ when: { all }, score });
    }

    if (tiers.length === 0) return { ok: false, error: "не указано ни одной ступени" };
    value = { kind: "tiered", tiers, ...(sMax != null ? { sMax } : {}) };
  } else {
    return { ok: false, error: `неизвестный формат «Цены ответа»: "${text}"` };
  }

  const parsed = questionScoringSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: "невалидная конфигурация «Цены ответа»" };
  return { ok: true, value: parsed.data };
}
