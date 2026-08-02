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

/** What a full rebuild processed. */
export interface ReindexReport {
  entities: number;
}

/**
 * Rebuilds the whole index with the SAME walker the write path uses. The safety net under
 * a write-time index: any drift (a direct SQL write, e.g. the Excel question import, question
 * duplication or topic duplication that bypass the route handlers; a storage point added
 * without wiring the walker in) shows up here rather than as an access refusal nobody can
 * explain.
 *
 * Covers every entity type the write path indexes: questions, content pages (including the
 * system pages `test-settings.ts` rewrites when the flow mode changes), and test design
 * settings (`test_design`, PRD media-library Task 10b). Test design is indexed on the
 * SETTINGS OBJECT (`test.designSettingsJson`), not the whole test row — the same choice
 * `PUT /:id/design` makes in `server/routes/tests.ts`, so a rebuild and a save land on the
 * same rows.
 */
export async function reindexAllUsages(): Promise<ReindexReport> {
  await storage.clearAllMediaUsages();
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
