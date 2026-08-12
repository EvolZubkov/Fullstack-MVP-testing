/**
 * @module server/services/page-variant-audit
 *
 * PRD-22 (plan Э6): which tests hold content pages bound to a design-template
 * variant that template no longer declares.
 *
 * The condition is invisible until the author opens «Структура» — the page still
 * renders, through a substituted variant (see
 * {@link module:shared/template/content-page resolveContentTemplate}), so nothing
 * breaks loudly. The tests list therefore carries the count, and the list is a
 * page of many rows: the whole audit runs in TWO queries for the whole page (one
 * for the page bindings, one for the template catalogue) rather than a pair per
 * test.
 *
 * A template that cannot be resolved — inactive, deleted, or simply absent —
 * yields NO findings for its tests: the variants it declares are unknown, and
 * flagging every page of such a test would report a template problem as a content
 * problem. This mirrors the editor, which flags nothing while its catalogue is
 * empty.
 */

import { inArray } from "drizzle-orm";
import { db } from "../db";
import { templates } from "@shared/schema";
import { logger } from "../logger";
import type { IStorage } from "../storage";

/** The subset of a test this audit reads. */
export interface AuditableTest {
  id: string;
  designSettingsJson?: unknown;
}

/** Design template id of a test; absent selection means the built-in default. */
function templateIdOf(test: AuditableTest): string {
  const design = test.designSettingsJson as { templateId?: unknown } | null | undefined;
  return typeof design?.templateId === "string" && design.templateId ? design.templateId : "default";
}

/** Variant keys each of `ids` declares, read from the stored manifests in one query. */
async function readVariantKeys(ids: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ id: templates.id, manifest: templates.manifest, isActive: templates.isActive })
    .from(templates)
    .where(inArray(templates.id, ids));
  for (const row of rows) {
    if (!row.isActive) continue;
    const list = (row.manifest as { contentTemplates?: Array<{ key?: unknown }> } | null)?.contentTemplates;
    if (!Array.isArray(list)) continue;
    out.set(
      row.id,
      new Set(list.map((c) => c?.key).filter((k): k is string => typeof k === "string")),
    );
  }
  return out;
}

/**
 * Counts, per test, the content pages bound to a variant its design template does
 * not declare.
 *
 * Tests with no such page are absent from the map, so a caller can treat a missing
 * entry as «nothing to map».
 * @param tests    Tests to audit (the visible page of the list)
 * @param storage  Data access facade (page bindings)
 * @returns unmapped page count keyed by test id, omitting zeros
 */
export async function countUnmappedPages(
  tests: AuditableTest[],
  storage: IStorage,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (tests.length === 0) return counts;

  const templateIdByTest = new Map(tests.map((t) => [t.id, templateIdOf(t)]));
  let bindings: Awaited<ReturnType<IStorage["getContentPageBindings"]>>;
  let variantKeys: Map<string, Set<string>>;
  try {
    [bindings, variantKeys] = await Promise.all([
      storage.getContentPageBindings(tests.map((t) => t.id)),
      readVariantKeys([...new Set(templateIdByTest.values())]),
    ]);
  } catch (error) {
    // The mark is advisory; the list is not. A failing audit reports nothing
    // rather than taking the whole list down with it.
    logger.warn("Unmapped-page audit failed: " + (error as Error).message, "tests");
    return counts;
  }

  for (const binding of bindings) {
    if (!binding.templateKey) continue;
    const keys = variantKeys.get(templateIdByTest.get(binding.testId) ?? "");
    // Unknown catalogue ⇒ no verdict (see the module note).
    if (!keys || keys.size === 0) continue;
    if (keys.has(binding.templateKey)) continue;
    counts.set(binding.testId, (counts.get(binding.testId) ?? 0) + 1);
  }
  return counts;
}
