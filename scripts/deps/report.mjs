/**
 * @module scripts/deps/report
 * @description Renders verdicts: a console summary, a Markdown report and raw JSON.
 *
 * Only findings are printed. A list of six hundred permitted packages buries the four that
 * matter, and the whole point of the tool is to make those four impossible to miss.
 */

import { OUTCOME } from "./classify.mjs";
import { PACE } from "./pace.mjs";

/**
 * @typedef {import("./classify.mjs").Verdict} Verdict
 */

/**
 * @typedef {Object} Summary
 * @property {Verdict[]} results All verdicts, unfiltered.
 * @property {{ok: number, warn: number, block: number, error: number}} counts Outcome counts.
 * @property {Verdict[]} blockedProd `block` outcomes in the production graph (`dev === false`).
 * @property {Verdict[]} blockedDev `block` outcomes that are dev-only.
 * @property {Verdict[]} warnings `warn` outcomes.
 * @property {Verdict[]} errors `error` outcomes (the system was never asked, or never answered).
 */

/**
 * Groups results by outcome and counts them. The prod/dev split on `block` exists because the
 * two have different consequences for the exit code and for what a human does next: a
 * production finding blocks a build, a dev-only one is reported but does not.
 *
 * The count keys come from {@link OUTCOME} itself, not a hand-written literal, and an outcome
 * missing from it is a hard error rather than a `NaN`/`undefined` bucket. A caller that passes a
 * typo'd outcome (a plausible one: "blocked" instead of "block") must not get back a report that
 * looks clean — a silently zeroed counter and an exit code of 0 is exactly the "finding lost
 * without a trace" failure this whole tool exists to prevent.
 *
 * @param {Verdict[]} results
 * @returns {Summary}
 * @throws {Error} When a result's `outcome` is not one of {@link OUTCOME}'s values.
 */
export function summarize(results) {
  const counts = Object.fromEntries(Object.values(OUTCOME).map((outcome) => [outcome, 0]));
  for (const r of results) {
    if (!Object.hasOwn(counts, r.outcome)) {
      throw new Error(
        `report.summarize: unknown outcome "${r.outcome}" on ${r.id ?? "(no id)"} — it is not one of ` +
          `${Object.values(OUTCOME).join("/")}. Refusing to report a clean run that may not be one.`,
      );
    }
    counts[r.outcome] += 1;
  }
  const blocked = results.filter((r) => r.outcome === OUTCOME.BLOCK);
  return {
    results,
    counts,
    blockedProd: blocked.filter((r) => !r.dev),
    blockedDev: blocked.filter((r) => r.dev),
    warnings: results.filter((r) => r.outcome === OUTCOME.WARN),
    errors: results.filter((r) => r.outcome === OUTCOME.ERROR),
  };
}

/**
 * Decides the process exit code from a summary.
 *
 * `0` — everything is permitted. `1` — there is a finding. `2` — the run is incomplete (some
 * packages could not be asked about). A finding outranks incompleteness: if something is already
 * forbidden, the fact that three other packages timed out does not make that answer any less
 * final, so a run with both a block and an error still exits `1`, not `2`.
 *
 * @param {Summary} summary
 * @param {{strictDev?: boolean}} [options] `strictDev` folds dev-only findings into the
 *   production ones (spec §7: `--strict-dev`).
 * @returns {number} 0, 1 or 2.
 */
export function exitCodeFor(summary, { strictDev = false } = {}) {
  const blocking = strictDev ? summary.blockedProd.length + summary.blockedDev.length : summary.blockedProd.length;
  if (blocking > 0) {
    return 1;
  }
  if (summary.errors.length > 0) {
    return 2;
  }
  return 0;
}

/**
 * Formats a package identity with its scope, e.g. "@electric-sql/pglite" or "express".
 *
 * @param {Verdict} r
 * @returns {string}
 */
function packageLabel(r) {
  return r.scope ? `${r.scope}/${r.name}` : r.name;
}

/**
 * Marks a status this module's vocabulary does not recognise (`classify.mjs`'s `known: false`).
 * Growing that vocabulary is one of the spec's three open questions (section 11) — closing it
 * needs a human to actually SEE the unfamiliar word, in the report they open, not just in the
 * JSON's `known` flag nobody reads by hand.
 *
 * @param {Verdict} r
 * @returns {string} "" when the status is recognised.
 */
function unknownTag(r) {
  return r.known === false ? " [незнакомый статус]" : "";
}

/**
 * One console line about a package: what it is and who pulls it in. The chain is capped at
 * three links on the console (the full chain belongs in the Markdown table) because the
 * terminal summary is meant to be scanned, not read line by line.
 *
 * The system's own `comment` is appended when present: without it, a truncated answer ("не
 * дочитали", classify.mjs / repo-client.mjs `MAX_RECORDS`) and an outright network failure both
 * just read "ERROR" on the console — the one piece of text that tells them apart never made it
 * to the terminal, only to the Markdown table.
 *
 * @param {Verdict} r
 * @returns {string}
 */
function consoleLine(r) {
  const chain = r.requiredBy.length ? ` <- ${r.requiredBy.slice(0, 3).join(", ")}` : "";
  // MAIN is the unremarkable zone — printing it on nearly every line would just be noise next to
  // the findings that need a human's attention, so only a non-MAIN (ISOLATED, or unfamiliar) zone
  // earns a tag.
  const zone = r.zone && r.zone !== "MAIN" ? ` [${r.zone}]` : "";
  const dev = r.dev ? " (dev)" : "";
  const comment = r.comment ? ` :: ${r.comment}` : "";
  return `  ${packageLabel(r)}@${r.version} — ${r.status}${unknownTag(r)}${zone}${dev}${chain}${comment}`;
}

/**
 * Console text: the outcome summary, then every non-permitted package grouped by section.
 * Permitted packages are never listed — see the module description for why.
 *
 * @param {Summary} summary
 * @returns {string}
 */
export function renderConsole(summary) {
  const { counts } = summary;
  const parts = [
    `Разрешено: ${counts.ok}   Предупреждений: ${counts.warn}   Запрещено: ${counts.block}   Ошибок: ${counts.error}`,
  ];
  const section = (title, rows) => {
    if (!rows.length) {
      return;
    }
    parts.push("", `${title} (${rows.length}):`, ...rows.map(consoleLine));
  };
  section("Запрещено или нет в базе — продакшен", summary.blockedProd);
  section("Запрещено или нет в базе — только dev", summary.blockedDev);
  section("Требует внимания", summary.warnings);
  section("Не удалось спросить", summary.errors);
  return parts.join("\n");
}

/**
 * Escapes characters that would break a Markdown table cell: `|` ends the cell early, and a
 * literal newline (the system's `comment` field is free text, so nothing rules one out) would
 * split the row across lines.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeCell(text) {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Markdown table rows for one section. Unlike the console, the full `requiredBy` chain is
 * printed here: this is the file a human opens specifically to decide what to do about a
 * transitive dependency, and truncating the chain would hide exactly the information that
 * decision needs.
 *
 * Every cell goes through {@link escapeCell}, not just the free-text ones. `status` and `zone`
 * come straight from the corporate system, and this module's own contract (an unfamiliar status
 * is printed verbatim, never swallowed — see `classify.mjs`) means a `|` inside one of them is
 * only ever one unfamiliar vocabulary entry away.
 *
 * @param {Verdict[]} rows
 * @returns {string[]}
 */
function markdownRows(rows) {
  return rows.map((r) => {
    const chain = r.requiredBy.length ? r.requiredBy.join(", ") : "—";
    const note = r.comment ? r.comment : "—";
    const status = `${r.status}${unknownTag(r)}`;
    const cells = [packageLabel(r), r.version, status, r.zone ?? "—", r.dev ? "dev" : "прод", chain, note];
    return `| ${cells.map((cell) => escapeCell(String(cell))).join(" | ")} |`;
  });
}

/**
 * Human description of the run's flags, for the report header and the console. Only flags that
 * move the run away from its default are named — a silent default (base pace, cache on, dev
 * included) is not a finding, so it stays out of the line the same way `zone: MAIN` stays out of
 * `consoleLine`. `delayMs` is worth naming only above the documented floor: it can never go
 * below `PACE.baseDelayMs` (`validateDelay`), so at the floor it is not a decision anyone made.
 *
 * @param {{prod?: boolean, strictDev?: boolean, noCache?: boolean, delayMs?: number}} [flags]
 * @returns {string}
 */
export function formatFlags(flags = {}) {
  const parts = [];
  if (flags.prod) parts.push("--prod (только продакшен-граф, dev не спрошен)");
  if (flags.strictDev) parts.push("--strict-dev (находка в dev тоже даёт код 1)");
  if (flags.noCache) parts.push("--no-cache (кэш не читался)");
  if (typeof flags.delayMs === "number" && flags.delayMs > PACE.baseDelayMs) {
    parts.push(`--delay ${flags.delayMs} мс`);
  }
  return parts.length ? parts.join(", ") : "обычный прогон (весь граф, кэш разрешён, темп по умолчанию)";
}

/**
 * Full Markdown report for a human to read or forward: a heading, a totals line, then one
 * table per non-empty section (production findings, dev-only findings, warnings, errors).
 *
 * @param {Verdict[]} results All verdicts, not just findings — `summarize` does the filtering.
 * @param {Object} meta
 * @param {string} meta.checkedAt ISO timestamp of the run.
 * @param {number} meta.total Count of packages the run covered.
 * @param {{prod?: boolean, strictDev?: boolean, noCache?: boolean, delayMs?: number}} [meta.flags]
 *   CLI flags the run was made with — see {@link formatFlags}.
 * @param {number} [meta.fromCache] How many of `total` were answered from the on-disk cache
 *   rather than asked live — see the module doc on why `checkedAt` alone is misleading here.
 * @param {number} [meta.cacheTtlDays] Cache entry lifetime in days (mirrors `CACHE.ttlMs` from
 *   `cache.mjs`), so a reader can judge how stale a cached answer might be.
 * @returns {string} Markdown text ending in a trailing newline.
 */
export function renderMarkdown(results, { checkedAt, total, flags, fromCache, cacheTtlDays }) {
  const summary = summarize(results);
  const head = "| Пакет | Версия | Статус | Зона | Граф | Кто тянет | Комментарий системы |";
  const sep = "| --- | --- | --- | --- | --- | --- | --- |";
  const out = [
    "# Отчёт о допустимости зависимостей",
    "",
    `Проверено пакетов: ${total}. Дата проверки: ${checkedAt}.`,
    `Флаги: ${formatFlags(flags)}.`,
  ];
  if (typeof fromCache === "number") {
    // Kept to one short line (MD013, 120 chars): the point that a cached answer can predate
    // "Дата проверки" above by up to the cache's own TTL, not a full restatement of why.
    const ttl = typeof cacheTtlDays === "number" ? ` на срок жизни кэша (${cacheTtlDays} дней)` : "";
    out.push(`Из кэша: ${fromCache} из ${total} — эти ответы могут быть старше «Даты проверки»${ttl}.`);
  }
  out.push(
    "",
    `Разрешено: ${summary.counts.ok}. Предупреждений: ${summary.counts.warn}. ` +
      `Запрещено: ${summary.counts.block}. Ошибок: ${summary.counts.error}.`,
  );
  const section = (title, rows) => {
    if (!rows.length) {
      return;
    }
    out.push("", `## ${title}`, "", head, sep, ...markdownRows(rows));
  };
  section("Запрещено или нет в базе — продакшен", summary.blockedProd);
  section("Запрещено или нет в базе — только dev", summary.blockedDev);
  section("Требует внимания", summary.warnings);
  section("Не удалось спросить", summary.errors);
  // Built from the same four row groups just rendered above, not from `counts`, so a future
  // outcome that lands in a new bucket cannot be forgotten here the way three hand-listed
  // counters could be.
  const totalFindings =
    summary.blockedProd.length + summary.blockedDev.length + summary.warnings.length + summary.errors.length;
  if (totalFindings === 0) {
    out.push("", "Все проверенные пакеты разрешены.");
  }
  out.push("");
  return out.join("\n");
}

/**
 * Raw data for a later comparison of two runs: every result, not only findings — the report's
 * "only findings" rule is about what a human reads, not about what gets persisted.
 *
 * `flags` and `fromCache` are carried through verbatim (not reworded like {@link formatFlags}
 * does for humans) precisely because this file is the one a script, not a person, reads later —
 * see the module doc on `checkedAt` alone being misleading when part of the run came from a
 * week-old cache entry.
 *
 * @param {Verdict[]} results
 * @param {Object} meta
 * @param {string} meta.checkedAt
 * @param {number} meta.total
 * @param {{prod?: boolean, strictDev?: boolean, noCache?: boolean, delayMs?: number}} [meta.flags]
 * @param {number} [meta.fromCache]
 * @param {number} [meta.cacheTtlDays]
 * @returns {{checkedAt: string, total: number, flags: object|undefined, fromCache:
 *   number|undefined, cacheTtlDays: number|undefined, summary: {ok: number, warn: number, block:
 *   number, error: number}, results: Verdict[]}}
 */
export function toJson(results, { checkedAt, total, flags, fromCache, cacheTtlDays }) {
  return { checkedAt, total, flags, fromCache, cacheTtlDays, summary: summarize(results).counts, results };
}
