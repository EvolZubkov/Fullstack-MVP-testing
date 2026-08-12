/**
 * @module scripts/db/transfer-test-settings
 *
 * One-off repair for a test carried between installations by the Excel workbook.
 *
 * The workbook is a format for CONTENT: it moves questions, structure, scales,
 * measurements and the FORMULAS of result variables, and it moves none of the jsonb
 * that decides how the results screen reads. A test imported into another installation
 * therefore arrives with empty outcome dictionaries (the results card prints the raw
 * formula value — a scale key such as `vdo` — instead of the outcome's label), with no
 * intro block, with default appearance and with the default 70% pass rule.
 *
 * This script carries exactly those fields across, matching records BY KEY rather than by
 * id: the two installations assign different identifiers, but a result variable's `name`
 * and a content page's `kind`+`sort_order` are stable handles. See
 * `docs/plans/2026-08-11-test-transfer-without-losses.md` (срез 0).
 *
 * Three groups travel: test-level jsonb ({@link TEST_FIELDS}), the outcome dictionaries of
 * result variables (`config_json`), and content-page configuration ({@link PAGE_FIELDS}) —
 * the last one is where the results screen actually lives, so omitting it would leave the
 * chart and the score-summary suppression behind.
 *
 * It UPDATES what the target already has and never creates rows: creating pages, scales or
 * variables is content transfer, which is the package's job (срез B/C of the plan).
 *
 * Temporary by design. It is deleted once the transfer package (срез C of the same plan)
 * can update an existing test, which is the supported way to do this.
 *
 * Run (dry by default — nothing is written without `--apply`):
 *
 * ```
 * SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... \
 *   npx tsx scripts/db/transfer-test-settings.ts --source-test <id> [--target-test <id>]
 * ```
 *
 * Deviation from the plan, deliberately: the plan said `--dry` prints the diff, which
 * implies writing is the default. Inverted here — a script pointed at production must not
 * write because a flag was forgotten. `--dry` is still accepted and is a no-op.
 */
import pg from "pg";

const { Client } = pg;

/** Test-level jsonb columns the workbook does not carry. */
const TEST_FIELDS = [
  "intro_json",
  "design_settings_json",
  "report_settings_json",
  "overall_pass_rule_json",
] as const;

type TestField = (typeof TEST_FIELDS)[number];

/**
 * Content-page columns the workbook does not carry.
 *
 * This is where the results screen is actually configured: `settings_json` of the
 * `results` page holds the chart kind (PRD-46 «роза»), the per-scale colours and icons,
 * and `scoreSummary: "hide"` — without which a measurement test shows «0 из 0, порог 70%,
 * Пройден». `values_json` holds the page's own texts. Both are separate from
 * `tests.report_settings_json`, which configures the printable REPORT.
 */
const PAGE_FIELDS = [
  "values_json",
  "settings_json",
  "template_key",
  "auto_advance",
  "auto_advance_delay_ms",
] as const;

/** One planned change, ready to print and to apply. */
interface Change {
  /** What the change is applied to. Carries the key, so applying never re-parses text. */
  target:
    | { kind: "test" }
    | { kind: "resultVariable"; name: string }
    | { kind: "contentPage"; id: string };
  /** Human-readable subject for the diff output. */
  subject: string;
  column: string;
  before: unknown;
  after: unknown;
}

/** What a run found, whether or not it wrote anything. */
export interface TransferReport {
  changes: Change[];
  warnings: string[];
}

/**
 * Deep structural equality for jsonb values.
 *
 * NOT `JSON.stringify` comparison: postgres normalizes jsonb key order, so two documents
 * that differ only in key order stringify differently and would be reported as a change
 * that writes the same content back. The same trap was hit comparing template manifests.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  return keys.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
}

/** One-line preview of a jsonb value for the diff output. */
function preview(value: unknown): string {
  if (value === null || value === undefined) return "(пусто)";
  const text = JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

/** Parses `--flag value` pairs; bare flags become `"true"`. */
function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[name] = next;
      i++;
    } else {
      args[name] = "true";
    }
  }
  return args;
}

/**
 * Resolves the test on the target side.
 *
 * An explicit id always wins. Without one the title is matched, and an ambiguous title is
 * an ERROR rather than a pick: writing settings into the wrong copy of a test is exactly
 * the kind of silent damage this script exists to undo.
 */
async function resolveTargetTest(
  target: pg.Client,
  explicitId: string | undefined,
  sourceTitle: string,
): Promise<string> {
  if (explicitId) {
    const { rows } = await target.query<{ id: string }>("SELECT id FROM tests WHERE id = $1", [explicitId]);
    if (!rows.length) throw new Error(`в приёмнике нет теста с id ${explicitId}`);
    return explicitId;
  }

  const { rows } = await target.query<{ id: string; title: string }>(
    "SELECT id, title FROM tests WHERE title = $1",
    [sourceTitle],
  );
  if (!rows.length) throw new Error(`в приёмнике нет теста с названием "${sourceTitle}" — укажите --target-test`);
  if (rows.length > 1) {
    throw new Error(
      `в приёмнике ${rows.length} теста с названием "${sourceTitle}" (${rows.map((r) => r.id).join(", ")}) — укажите --target-test`,
    );
  }
  return rows[0].id;
}

/** Collects every field-level difference between the two installations. */
async function collectChanges(
  source: pg.Client,
  target: pg.Client,
  sourceTestId: string,
  targetTestId: string,
): Promise<TransferReport> {
  const report: TransferReport = { changes: [], warnings: [] };

  const columns = TEST_FIELDS.join(", ");
  const srcTest = await source.query(`SELECT ${columns} FROM tests WHERE id = $1`, [sourceTestId]);
  const tgtTest = await target.query(`SELECT ${columns} FROM tests WHERE id = $1`, [targetTestId]);
  if (!srcTest.rows.length) throw new Error(`в источнике нет теста с id ${sourceTestId}`);

  for (const field of TEST_FIELDS) {
    const before = tgtTest.rows[0][field as TestField];
    const after = srcTest.rows[0][field as TestField];
    if (deepEqual(before, after)) continue;
    report.changes.push({ target: { kind: "test" }, subject: "тест", column: field, before, after });
  }

  // Result variables are matched by `name` — the handle a formula uses and the author
  // keeps stable. `label` is display text and may legitimately differ.
  const srcVars = await source.query<{ name: string; config_json: unknown }>(
    "SELECT name, config_json FROM result_variables WHERE test_id = $1",
    [sourceTestId],
  );
  const tgtVars = await target.query<{ id: string; name: string; config_json: unknown }>(
    "SELECT id, name, config_json FROM result_variables WHERE test_id = $1",
    [targetTestId],
  );
  const tgtByName = new Map(tgtVars.rows.map((v) => [v.name, v]));

  for (const srcVar of srcVars.rows) {
    const tgtVar = tgtByName.get(srcVar.name);
    if (!tgtVar) {
      report.warnings.push(`показатель "${srcVar.name}" есть в источнике, но не в приёмнике — пропущен`);
      continue;
    }
    if (deepEqual(tgtVar.config_json, srcVar.config_json)) continue;
    report.changes.push({
      target: { kind: "resultVariable", name: srcVar.name },
      subject: `показатель "${srcVar.name}"`,
      column: "config_json",
      before: tgtVar.config_json,
      after: srcVar.config_json,
    });
  }

  const srcNames = new Set(srcVars.rows.map((v) => v.name));
  for (const tgtVar of tgtVars.rows) {
    if (!srcNames.has(tgtVar.name)) {
      report.warnings.push(`показатель "${tgtVar.name}" есть в приёмнике, но не в источнике — не тронут`);
    }
  }

  await collectPageChanges(source, target, sourceTestId, targetTestId, report);
  return report;
}

/** Display name of a page in the diff and in warnings. */
function pageLabel(page: { kind: string; sort_order: number }): string {
  return `${page.kind}#${page.sort_order}`;
}

/**
 * Pairs source pages with target pages.
 *
 * `sort_order` is NOT part of the identity. The two installations number pages
 * independently — a workbook import leaves every page at 0 while the editor spreads them
 * 0/2/4/6 — so keying on it silently fails to match the very page that matters (`results`,
 * where the chart kind and the score-summary suppression live).
 *
 * A system page (`start`, `questions`, `results`, `review`, ...) is unique by KIND within a
 * test, which is the case that must always work. When a kind legitimately has several pages
 * (author content pages), the group falls back to pairing by `sort_order`, and anything
 * left unpaired is reported rather than guessed.
 */
function pairPages<T extends { kind: string; sort_order: number }>(
  sourcePages: T[],
  targetPages: T[],
  warn: (message: string) => void,
): Array<[T, T]> {
  const groupBy = (pages: T[]): Map<string, T[]> => {
    const groups = new Map<string, T[]>();
    for (const page of pages) {
      const list = groups.get(page.kind) ?? [];
      list.push(page);
      groups.set(page.kind, list);
    }
    return groups;
  };

  const srcGroups = groupBy(sourcePages);
  const tgtGroups = groupBy(targetPages);
  const pairs: Array<[T, T]> = [];

  for (const [kind, srcGroup] of srcGroups) {
    const tgtGroup = tgtGroups.get(kind) ?? [];
    if (!tgtGroup.length) {
      for (const page of srcGroup) {
        warn(`страница ${pageLabel(page)} есть в источнике, но не в приёмнике — пропущена (создание страниц не входит в задачу скрипта)`);
      }
      continue;
    }

    if (srcGroup.length === 1 && tgtGroup.length === 1) {
      pairs.push([srcGroup[0], tgtGroup[0]]);
      continue;
    }

    // Several pages of one kind: `sort_order` is the only ordering the two sides share.
    const byOrder = new Map(tgtGroup.map((p) => [p.sort_order, p]));
    for (const srcPage of srcGroup) {
      const tgtPage = byOrder.get(srcPage.sort_order);
      if (!tgtPage) {
        warn(`страница ${pageLabel(srcPage)}: в приёмнике ${tgtGroup.length} страниц вида "${kind}" и ни одна не совпала по порядку — пропущена`);
        continue;
      }
      byOrder.delete(srcPage.sort_order);
      pairs.push([srcPage, tgtPage]);
    }
  }

  return pairs;
}

/**
 * Adds content-page differences to the report.
 *
 * Pages are matched by `kind` + `sort_order`. A page MISSING on the target is reported as
 * a warning and skipped rather than created: this script repairs settings, and creating
 * pages is content transfer — the job of the package (срез B/C of the plan).
 */
async function collectPageChanges(
  source: pg.Client,
  target: pg.Client,
  sourceTestId: string,
  targetTestId: string,
  report: TransferReport,
): Promise<void> {
  const columns = `id, kind, sort_order, ${PAGE_FIELDS.join(", ")}`;
  const srcPages = await source.query(`SELECT ${columns} FROM content_pages WHERE test_id = $1`, [sourceTestId]);
  const tgtPages = await target.query(`SELECT ${columns} FROM content_pages WHERE test_id = $1`, [targetTestId]);

  const pairs = pairPages(srcPages.rows, tgtPages.rows, (message) => report.warnings.push(message));

  for (const [srcPage, tgtPage] of pairs) {
    for (const field of PAGE_FIELDS) {
      if (deepEqual(tgtPage[field], srcPage[field])) continue;
      report.changes.push({
        target: { kind: "contentPage", id: String(tgtPage.id) },
        subject: `страница ${pageLabel(srcPage)}`,
        column: field,
        before: tgtPage[field],
        after: srcPage[field],
      });
    }
  }
}

/** Columns whose values must be serialized; every other transferred column is scalar. */
const JSONB_COLUMNS = new Set<string>([...TEST_FIELDS, "config_json", "values_json", "settings_json"]);

/**
 * Binds a collected value for the UPDATE.
 *
 * A jsonb column takes serialized text; a scalar column (`template_key`, `auto_advance`,
 * `auto_advance_delay_ms`) must be passed THROUGH — serializing it would store the string
 * `"results.standard"`, quotes included.
 */
function bindValue(column: string, value: unknown): unknown {
  if (!JSONB_COLUMNS.has(column)) return value ?? null;
  return value === null || value === undefined ? null : JSON.stringify(value);
}

/** Applies the collected changes inside ONE transaction: all of them, or none. */
async function applyChanges(
  target: pg.Client,
  targetTestId: string,
  report: TransferReport,
): Promise<void> {
  await target.query("BEGIN");
  try {
    for (const change of report.changes) {
      const value = bindValue(change.column, change.after);
      if (change.target.kind === "test") {
        // Column names come from the *_FIELDS literals, never from input.
        await target.query(`UPDATE tests SET ${change.column} = $1, updated_at = now() WHERE id = $2`, [
          value,
          targetTestId,
        ]);
      } else if (change.target.kind === "resultVariable") {
        await target.query(
          "UPDATE result_variables SET config_json = $1 WHERE test_id = $2 AND name = $3",
          [value, targetTestId, change.target.name],
        );
      } else {
        await target.query(
          `UPDATE content_pages SET ${change.column} = $1, updated_at = now() WHERE id = $2`,
          [value, change.target.id],
        );
      }
    }
    await target.query("COMMIT");
  } catch (error) {
    await target.query("ROLLBACK");
    throw error;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  const targetUrl = process.env.TARGET_DATABASE_URL;
  const sourceTestId = args["source-test"];
  const apply = args.apply === "true";

  if (!sourceUrl || !targetUrl) {
    throw new Error("нужны переменные окружения SOURCE_DATABASE_URL и TARGET_DATABASE_URL");
  }
  if (!sourceTestId) {
    throw new Error("нужен --source-test <id> — идентификатор теста в источнике");
  }
  if (sourceUrl === targetUrl) {
    throw new Error("SOURCE_DATABASE_URL и TARGET_DATABASE_URL совпадают — переносить нечего");
  }

  const source = new Client({ connectionString: sourceUrl });
  const target = new Client({ connectionString: targetUrl });
  await source.connect();
  await target.connect();

  try {
    const srcTitle = await source.query<{ title: string }>("SELECT title FROM tests WHERE id = $1", [sourceTestId]);
    if (!srcTitle.rows.length) throw new Error(`в источнике нет теста с id ${sourceTestId}`);
    const title = srcTitle.rows[0].title;

    const targetTestId = await resolveTargetTest(target, args["target-test"], title);

    console.log(`Тест: "${title}"`);
    console.log(`  источник: ${sourceTestId}`);
    console.log(`  приёмник: ${targetTestId}`);
    console.log("");

    const report = await collectChanges(source, target, sourceTestId, targetTestId);

    for (const warning of report.warnings) console.log(`ПРЕДУПРЕЖДЕНИЕ: ${warning}`);
    if (report.warnings.length) console.log("");

    if (!report.changes.length) {
      console.log("Расхождений нет — переносить нечего.");
      return;
    }

    console.log(`Расхождений: ${report.changes.length}`);
    for (const change of report.changes) {
      console.log(`  ${change.subject} · ${change.column}`);
      console.log(`    было:  ${preview(change.before)}`);
      console.log(`    стало: ${preview(change.after)}`);
    }
    console.log("");

    if (!apply) {
      console.log("Сухой прогон: ничего не записано. Повторите с --apply, чтобы применить.");
      return;
    }

    await applyChanges(target, targetTestId, report);
    console.log(`Применено изменений: ${report.changes.length}`);
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((error: Error) => {
  console.error(`ОШИБКА: ${error.message}`);
  process.exit(1);
});
