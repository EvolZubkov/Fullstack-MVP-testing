/**
 * @module server/storage/media-repository
 * @description Data access for the media registry (`media_assets`) and its reverse
 * usage index (`media_usages`). Dedup lookup is per OWNER, not per checksum: one row
 * per checksum would hand a private file to anyone who uploaded the same bytes.
 * Usage rows are always replaced per entity, so a re-sync of one question cannot leave
 * a stale reference behind. Exposed through the `IStorage` facade, never imported by
 * routes.
 */
import { randomUUID } from "crypto";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  mediaAssets, mediaUsages,
  type MediaAsset, type InsertMediaAsset, type MediaUsage, type MediaEntityType,
} from "@shared/schema";

/** One reference found inside an entity. */
export interface MediaUsageRef {
  assetId: string;
  field: string;
}

/** Repository for `media_assets` and `media_usages`. */
export class MediaRepository {
  async createAsset(asset: Omit<InsertMediaAsset, "id">): Promise<MediaAsset> {
    const [row] = await db.insert(mediaAssets).values({ id: randomUUID(), ...asset }).returning();
    return row;
  }

  async getAsset(id: string): Promise<MediaAsset | undefined> {
    const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id));
    return row || undefined;
  }

  /** Legacy addresses (`/uploads/media/<file>`) resolve through the storage key. */
  async getAssetByStorageKey(storageKey: string): Promise<MediaAsset | undefined> {
    const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.storageKey, storageKey));
    return row || undefined;
  }

  /** Dedup lookup on upload. A null owner matches the backfilled legacy bucket. */
  async findAssetByOwnerChecksum(ownerId: string | null, checksum: string): Promise<MediaAsset | undefined> {
    const [row] = await db
      .select()
      .from(mediaAssets)
      .where(and(
        ownerId === null ? isNull(mediaAssets.ownerId) : eq(mediaAssets.ownerId, ownerId),
        eq(mediaAssets.checksum, checksum),
      ));
    return row || undefined;
  }

  /** Reference count of the PHYSICAL file: 0 means the bytes may be removed. */
  async countAssetsByChecksum(checksum: string): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(mediaAssets)
      .where(eq(mediaAssets.checksum, checksum));
    return row?.n ?? 0;
  }

  async listAssetsByOwner(ownerId: string): Promise<MediaAsset[]> {
    return db.select().from(mediaAssets).where(eq(mediaAssets.ownerId, ownerId));
  }

  async deleteAsset(id: string): Promise<boolean> {
    const rows = await db.delete(mediaAssets).where(eq(mediaAssets.id, id)).returning();
    return rows.length > 0;
  }

  /** Replaces ALL usage rows of one entity in a single transaction. */
  async replaceUsages(entityType: MediaEntityType, entityId: string, refs: MediaUsageRef[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(mediaUsages).where(and(
        eq(mediaUsages.entityType, entityType),
        eq(mediaUsages.entityId, entityId),
      ));
      if (refs.length === 0) return;
      await tx.insert(mediaUsages).values(
        refs.map((r) => ({ assetId: r.assetId, entityType, entityId, field: r.field })),
      ).onConflictDoNothing();
    });
  }

  async getUsagesByAsset(assetId: string): Promise<MediaUsage[]> {
    return db.select().from(mediaUsages).where(eq(mediaUsages.assetId, assetId));
  }

  /** Assets no entity references. Input to orphan collection. */
  async listOrphanAssets(): Promise<MediaAsset[]> {
    const used = await db.selectDistinct({ assetId: mediaUsages.assetId }).from(mediaUsages);
    const ids = used.map((u) => u.assetId);
    if (ids.length === 0) return db.select().from(mediaAssets);
    return db.select().from(mediaAssets).where(notInArray(mediaAssets.id, ids));
  }

  /** Drops every usage row. Only the full reindex uses this. */
  async clearAllUsages(): Promise<void> {
    await db.delete(mediaUsages);
  }
}
