/**
 * @module shared/answer-check/simplify
 *
 * «Тот же ответ поймает обычное сравнение» (PRD-57 FR-28p): перевод регулярного выражения
 * в шаблон §6.1, когда перевод ТОЧЕН.
 *
 * Зачем это вообще нужно: долгое выражение — почти всегда не злой умысел, а привычка
 * писать `(\S+\s?)+` там, где хватает звёздочки. Показать замену дешевле, чем объяснять
 * словами, чем плох откат.
 *
 * Отказ здесь — нормальный исход, и он лучше приблизительной замены: правило после
 * неточной замены засчитывало бы не то, а автор об этом не узнал бы. Поэтому переводятся
 * только якоря, буквальные куски, `.*` и одиночная `.`; всё остальное — `null`.
 *
 * Одна оговорка, которую автор видит глазами: обычное сравнение работает по форме §6.1 —
 * без учёта регистра, «ё» и «е», кавычек и лишних пробелов. Замена поэтому чуть мягче
 * исходного выражения, и предлагается она кнопкой, а не подставляется молча.
 *
 * Pure and framework-free — safe to bundle into the SCORM runtime.
 */

/** Знаки, которые в регулярном выражении что-то значат, а после `\` — уже нет. */
const ESCAPABLE = ".[]{}()*+?|^$/\\-";

/**
 * Перевести выражение в шаблон обычного сравнения.
 *
 * @param source Выражение автора.
 * @returns Шаблон с `*` и `?` либо `null`, если точного перевода нет.
 */
export function simplifyExpression(source: string): string | null {
  if (typeof source !== "string" || source === "") return null;

  let at = 0;
  let anchoredStart = false;
  let anchoredEnd = false;
  if (source[at] === "^") {
    anchoredStart = true;
    at += 1;
  }
  let body = source;
  if (body.endsWith("$") && !body.endsWith("\\$")) {
    anchoredEnd = true;
    body = body.slice(0, -1);
  }

  let pattern = "";
  while (at < body.length) {
    const ch = body[at];

    if (ch === "\\") {
      const next = body[at + 1];
      // `\d`, `\w`, `\s`, `\b`, ссылка на группу — в обычном сравнении их нет.
      if (next === undefined || ESCAPABLE.indexOf(next) === -1) return null;
      // Буквальные `*` и `?` перевести некуда: в обычном сравнении экранирования нет
      // (см. wildcard.ts — синтаксис, о котором автору не сказали, хуже его отсутствия).
      if (next === "*" || next === "?") return null;
      pattern += next;
      at += 2;
      continue;
    }

    if (ch === ".") {
      if (body[at + 1] === "*") {
        pattern += "*";
        at += 2;
        continue;
      }
      // `.+` не переводится: звёздочка принимает и пустое продолжение, а `.+` требует
      // хотя бы один символ. Различие на глаз не видно — значит, замена неточная.
      if (body[at + 1] === "+" || body[at + 1] === "?" || body[at + 1] === "{") return null;
      pattern += "?";
      at += 1;
      continue;
    }

    // Любой другой знак с собственным смыслом — отказ.
    if ("[]{}()*+?|^$".indexOf(ch) !== -1) return null;

    pattern += ch;
    at += 1;
  }

  if (pattern === "") return null;
  return `${anchoredStart ? "" : "*"}${pattern}${anchoredEnd ? "" : "*"}`;
}
