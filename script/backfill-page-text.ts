/**
 * @module script/backfill-page-text
 *
 * One-off (but re-runnable) data step: bring the stored text of every content
 * page to its canonical form — canonical whitespace plus Russian typography,
 * markup preserved to the byte, markdown never interpreted.
 *
 * WHY a script and not a SQL migration: the rule is code, not SQL. Typography has
 * to know where a tag ends and prose begins, and that logic lives in
 * `shared/text`. Reimplementing it in SQL would be a second, drifting copy of the
 * exact thing this work exists to unify — so the deploy runs this bundled script
 * right after `drizzle-kit migrate`.
 *
 * WHY it is needed at all: page fields get their typography ON SAVE (unlike a
 * question prompt, which gets it at render time). Without this step, pages saved
 * before the feature would keep straight quotes and hyphens until an author
 * happened to re-save them, so two pages of the same test could read differently.
 *
 * Idempotent: it writes only rows whose value actually changes, and the pass is a
 * no-op on its own output — a re-run touches nothing and reports 0 updated.
 *
 * Usage (inside the production image, as the deploy does it):
 *   node dist/backfill-page-text.cjs [--dry-run]
 */
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { contentPages } from "@shared/schema";
import { initConfig } from "../server/config";
import { loadEnv } from "../server/config-loader.mjs";
import { normalizePageValuesJson } from "../server/services/content-page-text";

/** Result of one run, printed as the deploy log line. */
interface BackfillReport {
  scanned: number;
  updated: number;
  skipped: number;
}

/**
 * Rewrite every content page whose values are not yet canonical.
 *
 * @param dryRun When set, computes the report without writing anything.
 */
export async function backfillPageText(dryRun = false): Promise<BackfillReport> {
  const pages = await db.select().from(contentPages);

  const report: BackfillReport = { scanned: pages.length, updated: 0, skipped: 0 };

  for (const page of pages) {
    const { valuesJson, changed } = normalizePageValuesJson(page.valuesJson);
    if (!changed) {
      report.skipped++;
      continue;
    }
    if (!dryRun) {
      await db.update(contentPages).set({ valuesJson }).where(eq(contentPages.id, page.id));
    }
    report.updated++;
  }

  return report;
}

/** CLI entry: `node dist/backfill-page-text.cjs [--dry-run]`. */
async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  // Same bootstrap order as the server: env first, then the config loader that
  // maps DATABASE_URL onto `config.database.url`.
  loadEnv();
  await initConfig();

  const report = await backfillPageText(dryRun);
  const mode = dryRun ? " (dry run)" : "";
  console.log(
    `[backfill-page-text] pages: ${report.scanned}, updated: ${report.updated}, ` +
      `already canonical: ${report.skipped}${mode}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-page-text] failed:", err);
    process.exit(1);
  });
