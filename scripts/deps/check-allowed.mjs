/**
 * @module scripts/deps/check-allowed
 * @description `npm run deps:check` — asks the corporate system whether every package in
 * package-lock.json is allowed, and reports what it found.
 *
 * Design: docs/specs/tooling/deps-check.md. The run is deliberately slow (about twelve minutes
 * for a full lockfile) because the pace is chosen not to look like an attack on somebody
 * else's production system; the cache makes every later run cost only what changed.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { classify, failed } from "./classify.mjs";
import { CACHE, readCached as defaultReadCached, writeCached as defaultWriteCached } from "./cache.mjs";
import { PACE } from "./pace.mjs";
import { createTokenSource as defaultCreateTokenSource } from "./repo-auth.mjs";
import { createClient as defaultCreateClient } from "./repo-client.mjs";
import { exitCodeFor, formatFlags, renderConsole, renderMarkdown, summarize, toJson } from "./report.mjs";
import { parseLockfile } from "./lockfile.mjs";

/** Cache entry lifetime in whole days, for the human-readable freshness note in the report. */
const CACHE_TTL_DAYS = CACHE.ttlMs / (24 * 60 * 60 * 1000);

/**
 * Package label for a short console line: `scope/name` or bare `name`. Mirrors
 * `report.mjs`'s own `packageLabel`, kept as a tiny local copy rather than an import — this one
 * formats a raw lockfile package (`{name, scope}`), not a `Verdict`, and the two shapes are close
 * enough that importing across the module boundary for one line would cost more clarity than it
 * saves.
 *
 * @param {{name: string, scope: string}} pkg
 * @returns {string}
 */
function packageLabel(pkg) {
  return pkg.scope ? `${pkg.scope}/${pkg.name}` : pkg.name;
}

/**
 * Russian noun form for "minute" after «около», which governs the genitive case throughout the
 * phrase regardless of the usual nominative-numeral agreement rules: «около 1 минуты», «около 2
 * минут», «около 11 минут», «около 21 минуты». Only the "ends in 1, but not 11" case takes the
 * genitive singular; everything else takes the genitive plural.
 *
 * @param {number} n
 * @returns {"минуты"|"минут"}
 */
function minutesAfterOkolo(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  return mod10 === 1 && mod100 !== 11 ? "минуты" : "минут";
}

/**
 * Usage text for `--help`/`-h`. The tool has seven flags and, until now, no help at all — asking
 * for one produced the same "Неверные аргументы" as any other typo, because `--help` was not a
 * recognised option.
 *
 * @returns {string}
 */
export function usageText() {
  return [
    "npm run deps:check -- [флаги]",
    "",
    "Спрашивает корпоративную систему (repository.rt.ru), разрешён ли каждый пакет из lock-файла.",
    "Полный прогон медленный (около 12 минут на ~690 пакетов) — темп щадящий и флагами не ускоряется.",
    "Прервать прогон можно в любой момент: кэш пишется по каждому пакету, следующий запуск",
    "продолжит с того, что уже проверено.",
    "",
    "Флаги:",
    "  --lock <путь>      package-lock.json для проверки (по умолчанию package-lock.json)",
    "  --out <каталог>    куда писать отчёт (по умолчанию tmp/deps-report)",
    `  --cache <каталог>  каталог кэша ответов (по умолчанию ${CACHE.dir})`,
    "  --prod             проверять только продакшен-граф, dev-зависимости пропустить",
    "  --strict-dev       находка в dev-графе тоже даёт код возврата 1",
    "  --no-cache         не читать и не писать кэш ответов",
    `  --delay <мс>       пауза перед запросом; можно только УВЕЛИЧИТЬ (минимум ${PACE.baseDelayMs} мс)`,
    "  --help, -h         показать эту справку",
    "",
  ].join("\n");
}

/**
 * Validates `--delay`. It exists so a run can be made MORE cautious than the default (a slow
 * corporate network, a first cautious run), never less: the pace in `pace.mjs` is deliberately
 * frozen and tested against the spec (section 5) precisely because "make it a bit faster" is the
 * single most tempting edit to this tool, and the cost of being wrong is a blocked human account,
 * not a slow build. Letting a CLI flag undercut that floor would reopen exactly the door the
 * frozen constant was built to close, so a value below the documented minimum is refused rather
 * than silently clamped — clamping would let a typo like `--delay 5` quietly run at 500ms anyway
 * without ever telling the caller their flag was ignored.
 *
 * @param {string} raw Raw `--delay` value from argv.
 * @returns {{ok: true, value: number}|{ok: false, message: string}}
 */
export function validateDelay(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return { ok: false, message: `--delay: ожидалось число миллисекунд, получено «${raw}»` };
  }
  if (value < PACE.baseDelayMs) {
    return {
      ok: false,
      message:
        `--delay не может быть меньше ${PACE.baseDelayMs} мс — это темп, который защищает учётную запись ` +
        `человека от блокировки корпоративной системой (docs/specs/tooling/deps-check.md §5). Флагом можно ` +
        `только ЗАМЕДЛИТЬ прогон, не ускорить; чтобы пересмотреть сам минимум, правьте scripts/deps/pace.mjs ` +
        `и его тест, который сверяет числа со спекой.`,
    };
  }
  return { ok: true, value };
}

/**
 * Reads and parses `package-lock.json` into the flat package list, turning both a bad path and a
 * bad `lockfileVersion` into one short, readable line instead of a raw stack trace — this is the
 * first thing a person sees when the command was run from the wrong directory or against a
 * lockfile that predates npm 7.
 *
 * @param {string} path
 * @returns {{ok: true, packages: Array<object>}|{ok: false, message: string}}
 */
export function loadPackages(path) {
  const full = resolve(path);
  let lock;
  try {
    lock = JSON.parse(readFileSync(full, "utf8"));
  } catch (error) {
    return { ok: false, message: `Не удалось прочитать lock-файл «${full}»: ${error.message}` };
  }
  try {
    return { ok: true, packages: parseLockfile(lock) };
  } catch (error) {
    return { ok: false, message: `${error.message} (файл: «${full}»)` };
  }
}

/**
 * Parses CLI arguments. Split out from `main()` purely so a targeted test can exercise argument
 * handling (bad `--delay`, `--prod` filtering, …) without touching the network.
 *
 * @param {string[]} argv `process.argv.slice(2)`-shaped arguments.
 */
export function parseCliArgs(argv) {
  return parseArgs({
    args: argv,
    options: {
      lock: { type: "string", default: "package-lock.json" },
      out: { type: "string", default: join("tmp", "deps-report") },
      // Mirrors `pace.mjs`'s own pattern for `PACE.baseDelayMs` below: the default comes from
      // `CACHE.dir` (cache.mjs), not a second hand-written "tmp/deps-cache" literal — otherwise a
      // future edit to that frozen constant would change nothing here, and `cache.test.ts`'s
      // check that CACHE matches the spec would go on passing while guarding a value the CLI
      // never actually reads.
      cache: { type: "string", default: CACHE.dir },
      prod: { type: "boolean", default: false },
      "strict-dev": { type: "boolean", default: false },
      "no-cache": { type: "boolean", default: false },
      delay: { type: "string", default: String(PACE.baseDelayMs) },
    },
  }).values;
}

/**
 * Runs the whole check: reads the lockfile, asks the corporate system about each package at the
 * documented pace, writes the report, and returns the process exit code. Never calls
 * `process.exit()` itself — see the note above the call site in `main()` for why.
 *
 * @param {string[]} argv
 * @param {Object} [options]
 * @param {Object} [options.deps] Dependency overrides, for tests only: a real run never passes
 *   this. It exists because the network/browser/cache calls this function makes are otherwise
 *   completely un-injectable, which made three of this module's own behaviours — a login failure
 *   stopping the run immediately, a per-package failure being printed as it happens, a cache
 *   write failure not erasing an answer already in hand — unreachable from `tests/deps/cli.test
 *   .ts` no matter how the assertions were written.
 * @param {typeof defaultCreateClient} [options.deps.createClient]
 * @param {typeof defaultCreateTokenSource} [options.deps.createTokenSource]
 * @param {typeof defaultReadCached} [options.deps.readCached]
 * @param {typeof defaultWriteCached} [options.deps.writeCached]
 * @returns {Promise<number>} 0 clean, 1 a package is forbidden, 2 the run is incomplete, refused
 *   outright (nothing left to check after filtering) or the input could not even be read.
 */
export async function run(argv, { deps = {} } = {}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usageText());
    return 0;
  }

  const createClient = deps.createClient ?? defaultCreateClient;
  const createTokenSource = deps.createTokenSource ?? defaultCreateTokenSource;
  const readCached = deps.readCached ?? defaultReadCached;
  const writeCached = deps.writeCached ?? defaultWriteCached;

  let values;
  try {
    values = parseCliArgs(argv);
  } catch (error) {
    // node:util's parseArgs already refuses an unknown flag or a missing value with a short,
    // specific message ("Unknown option '--bogus'") — worth keeping verbatim rather than
    // reinventing, just framed so it reads as this command's own refusal, not a bare stack trace.
    process.stderr.write(`Неверные аргументы: ${error.message}\n`);
    return 2;
  }

  const delay = validateDelay(values.delay);
  if (!delay.ok) {
    process.stderr.write(`${delay.message}\n`);
    return 2;
  }

  const loaded = loadPackages(values.lock);
  if (!loaded.ok) {
    process.stderr.write(`${loaded.message}\n`);
    return 2;
  }
  const packages = values.prod ? loaded.packages.filter((p) => !p.dev) : loaded.packages;

  if (packages.length === 0) {
    // The exact defect `parseLockfile` was already fixed for (an empty package list reads as
    // "0 checked, all permitted", the one silently-wrong-in-the-safe-direction verdict this whole
    // tool exists to prevent) reappears at every OTHER point that can empty the set, not only the
    // one `parseLockfile` guards: `--prod` filtering every package away, a lock-file with no real
    // entries at all, or one where every entry is a workspace `link` (`isRealPackage` in
    // lockfile.mjs excludes those the same way it excludes an unset platform-skipped optional
    // dependency). "Проверять было нечего" and "мы ничего не проверили" read identically in a
    // report that says "всё разрешено" — the difference is invisible to whoever reads it, and the
    // cost of getting it wrong falls entirely on the second case. So ANY empty set refuses, not
    // just the one `--prod` produces.
    const reason =
      values.prod && loaded.packages.length > 0
        ? `--prod оставил 0 пакетов из ${loaded.packages.length}: в этом lock-файле весь граф — dev-only, ` +
          `проверять продакшен-граф нечем. Если это неожиданно, проверьте, тот ли lock-файл выбран флагом --lock.`
        : `В lock-файле не нашлось ни одного пакета для проверки: либо граф пуст, либо все записи в нём — ` +
          `ссылки на workspace-пакеты монорепозитория (npm их не устанавливает как обычные зависимости, ` +
          `parseLockfile их не считает).`;
    process.stderr.write(`${reason} Это не «всё разрешено» — отказ: нечего было спросить.\n`);
    return 2;
  }

  const flags = {
    prod: values.prod,
    strictDev: values["strict-dev"],
    noCache: values["no-cache"],
    delayMs: delay.value,
  };

  /** Rough runtime: pause plus a typical answer per package, plus a breather every fiftieth. */
  const minutes = Math.ceil(
    (packages.length * (delay.value + 400) + Math.floor(packages.length / PACE.longPauseEvery) * PACE.longPauseMs) /
      60000,
  );
  process.stdout.write(
    `Проверяю ${packages.length} пакетов. Темп щадящий, ожидаемое время — около ${minutes} ` +
      `${minutesAfterOkolo(minutes)}. Прервать можно в любой момент: кэш пишется по каждому пакету, ` +
      `следующий запуск продолжит с того, что уже проверено.\n`,
  );
  process.stdout.write(`Флаги: ${formatFlags(flags)}.\n`);

  const client = createClient({ getToken: createTokenSource(), delayMs: delay.value });
  const results = [];
  let fromCache = 0;
  let stoppedEarly = false;
  let stopReason = null;

  for (const [index, pkg] of packages.entries()) {
    const now = Date.now();
    let artifacts = values["no-cache"] ? null : readCached(values.cache, pkg, { now, ttlMs: CACHE.ttlMs });
    if (artifacts) {
      fromCache += 1;
    } else {
      try {
        artifacts = await client.findArtifacts(pkg);
      } catch (error) {
        results.push(failed(pkg, error));
        // Printed as it happens, not only inside the report a human opens twelve minutes later —
        // the loop used to run silent on this branch, so "25 из 690", "50 из 690" looked like a
        // clean run right up until the summary named two hundred failures at the very end.
        process.stdout.write(`  ! ${packageLabel(pkg)}@${pkg.version} — ${error.message}\n`);
        // `stopRun` is a flag repo-client.mjs and repo-auth.mjs set on the errors that mean "stop
        // asking altogether" (dead login, repeated refusals, a Retry-After past a minute) —
        // checked as a property, not sniffed out of the message text, so a reworded message can
        // never silently turn a required stop into "skip this package and carry on".
        if (error?.stopRun) {
          stoppedEarly = true;
          stopReason = error.message;
          process.stdout.write(`\nОстановка: ${error.message}\n`);
          break;
        }
        continue;
      }
      try {
        // Deliberately its OWN try, after `findArtifacts` has already returned successfully: a
        // full disk, a locked cache directory or an antivirus hold on the write must never turn
        // an honest `PERMITTED` we already hold into "не удалось спросить" — the answer was never
        // in doubt, only where to park it.
        writeCached(values.cache, pkg, artifacts, { now });
      } catch (cacheError) {
        process.stdout.write(
          `  (кэш не записан для ${packageLabel(pkg)}@${pkg.version}: ${cacheError.message} — ` +
            `ответ учтён в этом прогоне, просто не сохранён)\n`,
        );
      }
    }
    results.push(classify(pkg, artifacts));
    if ((index + 1) % 25 === 0) {
      process.stdout.write(`  ${index + 1} из ${packages.length}\n`);
    }
  }

  const summary = summarize(results);
  // Console first, report files second: if rendering or writing the report throws below (a full
  // disk, a bad --out path), the person still sees what the run found instead of twelve minutes
  // of waiting ending in a bare stack trace and nothing printed at all.
  process.stdout.write(`\n${renderConsole(summary)}\n\n`);
  if (stoppedEarly) {
    process.stdout.write(
      `ВНИМАНИЕ: прогон неполон — проверено ${results.length} из ${packages.length}. Остаток не спрошен.\n`,
    );
  }
  process.stdout.write(
    `Из кэша: ${fromCache} из ${results.length} (запись кэша живёт ${CACHE_TTL_DAYS} дней — часть ответов ` +
      `может быть такой давности, а не свежее, чем «Дата проверки» отчёта).\n`,
  );

  const meta = {
    checkedAt: new Date().toISOString(),
    total: results.length,
    flags,
    fromCache,
    cacheTtlDays: CACHE_TTL_DAYS,
  };

  try {
    mkdirSync(values.out, { recursive: true });
    let markdown = renderMarkdown(results, meta);
    const json = toJson(results, meta);
    if (stoppedEarly) {
      // An incomplete run that LOOKS like a full one is the specific silent-wrong-answer shape a
      // verdict tool cannot afford: "690 checked, none forbidden" and "212 checked before the
      // system asked us to stop, none forbidden so far" call for very different next actions, and
      // `total: results.length` alone does not tell them apart.
      const note =
        `ПРОГОН ОСТАНОВЛЕН ДОСРОЧНО: проверено ${results.length} из ${packages.length} запланированных ` +
        `пакетов. ${stopReason}`;
      markdown = `> ${note}\n\n${markdown}`;
      json.incomplete = true;
      json.plannedTotal = packages.length;
      json.stopReason = stopReason;
    }
    writeFileSync(join(values.out, "report.md"), markdown, "utf8");
    writeFileSync(join(values.out, "report.json"), JSON.stringify(json, null, 2), "utf8");
    process.stdout.write(`Отчёт: ${join(values.out, "report.md")}\n`);
  } catch (reportError) {
    // The verdict itself (the exit code below) is unaffected — it comes from `summary`, computed
    // and already printed above, not from this block — so a report-writing failure degrades to
    // "no file, but you saw the console" instead of "twelve minutes, then a bare stack trace and
    // nothing at all".
    process.stderr.write(`Отчёт не записан на диск: ${reportError.message}. Сводка выше — это всё, что есть.\n`);
  }

  return exitCodeFor(summary, { strictDev: values["strict-dev"] });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  // `process.exit()` after writes that just happened can truncate stdout on Windows, where
  // console output is not guaranteed to be flushed synchronously before the process tears down —
  // exactly the report summary this command exists to show. Setting `exitCode` and letting the
  // event loop drain on its own gives Node the chance to flush first; the process still exits
  // with the right code once there is nothing left to do.
  process.exitCode = await run(process.argv.slice(2));
}
