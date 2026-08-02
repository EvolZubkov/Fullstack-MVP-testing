/**
 * @module server/services/media/usage-index
 *
 * Keeps `media_usages` in step with content. Called from the save path of every entity
 * that can hold a media reference, and from the full re-sync.
 *
 * A reference that cannot be resolved to a registry row is DROPPED, not written: a
 * dangling row would later be read by the delivery rule, and reading it would grant or
 * refuse access on the strength of a file that does not exist.
 */
import { storage } from "../../storage";
import type { MediaEntityType } from "@shared/schema";
import type { MediaUsageRef } from "../../storage/media-repository";
import { collectMediaRefs, rewriteMediaRefs } from "./media-refs";
import { clearAssetAccessCache } from "./asset-access";
import { logger } from "../../logger";

/** Resolves every reference inside `entity` to registry ids. */
export async function resolveEntityUsages(entity: unknown): Promise<MediaUsageRef[]> {
  const found = collectMediaRefs(entity);
  const refs: MediaUsageRef[] = [];
  for (const { field, ref } of found) {
    if (ref.kind === "canonical") {
      refs.push({ assetId: ref.id, field });
      continue;
    }
    const asset = await storage.getMediaAssetByStorageKey(ref.storageKey);
    if (asset) refs.push({ assetId: asset.id, field });
  }
  return refs;
}

/** Replaces the index rows of ONE entity. Safe to call on every save. */
export async function syncEntityUsages(
  entityType: MediaEntityType,
  entityId: string,
  entity: unknown,
): Promise<void> {
  const refs = await resolveEntityUsages(entity);
  await storage.replaceMediaUsages(entityType, entityId, refs);
  clearAssetAccessCache();
}

/**
 * Best-effort media-index cleanup for entities removed by a CASCADE delete that does not
 * go through their own save/delete route handler — the topic and folder cascades over
 * questions/content pages (`server/storage/topics-repository.ts`). Mirrors the pattern the
 * single-entity delete routes already use (`syncEntityUsages(type, id, null)` to clear an
 * entity's rows): a failure is logged and swallowed per entry, not thrown — the cascade
 * delete already committed, so one bad index write must not fail the whole request, and
 * anything missed here is caught by the next `POST /api/media/reindex`.
 */
export async function clearCascadedUsages(
  entries: ReadonlyArray<{ entityType: MediaEntityType; entityId: string }>,
): Promise<void> {
  for (const { entityType, entityId } of entries) {
    try {
      await syncEntityUsages(entityType, entityId, null);
    } catch (error) {
      logger.error(`Media usage cleanup failed for ${entityType} ${entityId}: ${(error as Error).message}`);
    }
  }
}

/** What a full rebuild processed. */
export interface ReindexReport {
  entities: number;
}

/**
 * Rebuilds the whole index with the SAME walker the write path uses. The safety net under
 * a write-time index: any drift (a direct SQL write, e.g. the Excel question import, question
 * duplication or topic duplication that bypass the route handlers; a storage point added
 * without wiring the walker in) shows up here rather than as an access refusal nobody can
 * explain. It is also the only place that notices the OPPOSITE drift: an entity deleted
 * through a path that bypassed the write-time cleanup (a direct SQL cascade, e.g. the topic/
 * folder delete cascade) leaves its usage rows behind forever, holding a file no dependents
 * page will ever mention again.
 *
 * Covers every entity type the write path indexes: questions, content pages (including the
 * system pages `test-settings.ts` rewrites when the flow mode changes), test design
 * settings (`test_design`, PRD media-library Task 10b), and publication snapshots
 * (`snapshot`, PRD-15 block B — see `server/services/test-snapshot.ts`). Test design is
 * indexed on the SETTINGS OBJECT (`test.designSettingsJson`), not the whole test row — the
 * same choice `PUT /:id/design` makes in `server/routes/tests.ts`, so a rebuild and a save
 * land on the same rows. A snapshot is indexed on its FROZEN `contentJson`, not on live
 * storage — that is the whole point: an asset that only survives inside a published
 * snapshot must not read as an orphan (spec §8.2/§4.3).
 *
 * Deliberately NOT a clear-then-repopulate: the old shape wiped `media_usages` up front and
 * refilled it entity by entity, so a crash or a dropped connection midway left the delivery
 * rule refusing access to pictures whose questions/pages were never touched — every learner's
 * media on the whole test, gone until someone reran the rebuild. Instead every live entity is
 * re-synced FIRST (each `syncEntityUsages` call already replaces that one entity's rows
 * wholesale, so this alone brings every live entity's rows up to date), and only THEN are the
 * rows of entities that turned out to be gone dropped, per entity type
 * (`storage.deleteMediaUsagesExcept`). At every point during the walk the index is either the
 * OLD complete picture or the NEW one — never emptied in between.
 *
 * The id list each `deleteMediaUsagesExcept` call keeps is re-read right before that call,
 * not reused from the walk above: the walk can take a while over a large bank, and reusing
 * its (by-then-stale) snapshot would let a question saved WHILE the reindex was running — a
 * live entity synced under its own fresh id — get read as "not in the keep list" and have its
 * just-written rows deleted a moment later. Re-reading narrows that race to the gap between
 * the fresh id read and the delete statement, not the whole reindex duration.
 */
export async function reindexAllUsages(): Promise<ReindexReport> {
  let entities = 0;

  for (const question of await storage.getQuestions()) {
    await syncEntityUsages("question", question.id, question);
    entities += 1;
  }
  for (const page of await storage.getAllContentPages()) {
    await syncEntityUsages("content_page", page.id, page);
    entities += 1;
  }
  for (const test of await storage.getTests()) {
    await syncEntityUsages("test_design", test.id, test.designSettingsJson);
    entities += 1;
  }
  for (const snapshot of await storage.getAllSnapshots()) {
    await syncEntityUsages("snapshot", snapshot.id, snapshot.contentJson);
    entities += 1;
  }

  // Cleanup pass: drop the rows of entities that no longer exist. Scoped per
  // entity type the walk above actually covers — a type it never visits (the
  // reserved `test_feedback`/`topic_feedback`/`scale_feedback` kinds, not yet
  // wired to any writer) is left untouched rather than wiped.
  await storage.deleteMediaUsagesExcept("question", (await storage.getQuestions()).map((q) => q.id));
  await storage.deleteMediaUsagesExcept("content_page", (await storage.getAllContentPages()).map((p) => p.id));
  await storage.deleteMediaUsagesExcept("test_design", (await storage.getTests()).map((t) => t.id));
  await storage.deleteMediaUsagesExcept("snapshot", (await storage.getAllSnapshots()).map((s) => s.id));

  clearAssetAccessCache();
  return { entities };
}

/**
 * Rewrites pre-registry addresses inside an entity to the canonical `/api/media/<id>`
 * (spec §5). Called on the SAVE path, before the entity is persisted: this is what drains
 * the legacy shape out of content gradually, instead of one mass migration across JSON
 * documents the media library does not own.
 */
export async function canonicalizeEntityMedia<T>(entity: T): Promise<T> {
  const legacyKeys = collectMediaRefs(entity)
    .map((f) => f.ref)
    .filter((ref): ref is { kind: "legacy"; storageKey: string } => ref.kind === "legacy")
    .map((ref) => ref.storageKey);
  if (legacyKeys.length === 0) return entity;

  const resolved = new Map<string, string>();
  for (const key of new Set(legacyKeys)) {
    const asset = await storage.getMediaAssetByStorageKey(key);
    if (asset) resolved.set(key, asset.id);
  }
  if (resolved.size === 0) return entity;

  return rewriteMediaRefs(entity, (ref) => {
    if (ref.kind !== "legacy") return null;
    const id = resolved.get(ref.storageKey);
    return id ? `/api/media/${id}` : null;
  }) as T;
}
