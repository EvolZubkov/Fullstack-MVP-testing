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
import { collectMediaRefs } from "./media-refs";

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
}
