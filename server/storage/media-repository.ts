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
import { and, eq, isNull, notExists, sql } from "drizzle-orm";
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

/**
 * Formats a Postgres `text[]` array literal (`{"a","b"}`) by hand, instead of handing the
 * JS array to the driver as a bind value and relying on it to serialize the array itself.
 * That reliance is NOT safe across drivers: `pg` (production) special-cases `Array.isArray`
 * bind values, but `@electric-sql/pglite` (the integration-test harness,
 * `tests/it/db-harness.ts`) does not — a bare JS array arrives as its default
 * `Array.prototype.toString()` (no braces, and a single-element array loses even the
 * separator), which Postgres then rejects as a malformed array literal. Building the literal
 * ourselves and binding it as one plain STRING parameter sidesteps driver-specific behaviour
 * entirely; `::text[]` in the SQL casts it on the server side.
 */
function pgTextArrayLiteral(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/[\\"]/g, "\\$&")}"`).join(",")}}`;
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

  /**
   * Assets no entity references. Input to orphan collection. Anti-join instead
   * of `NOT IN (ids...)`: the id list would grow without bound as the registry
   * grows, and Postgres caps a prepared statement at 65535 parameters.
   */
  async listOrphanAssets(): Promise<MediaAsset[]> {
    return db
      .select()
      .from(mediaAssets)
      .where(
        notExists(
          db.select({ one: sql`1` }).from(mediaUsages).where(eq(mediaUsages.assetId, mediaAssets.id)),
        ),
      );
  }

  /**
   * Drops the usage rows of ONE entity type whose entity id is NOT in `keepIds` —
   * the cleanup step of a full reindex (`reindexAllUsages`), applied AFTER every
   * live entity of that type has already been re-synced. What is left afterwards
   * is exactly the rows of entities that vanished without going through the
   * write-time index (a direct SQL cascade that bypassed the walker, e.g. the
   * topic/folder delete cascade or a bulk delete) — a reindex is the only place
   * that can notice this, since it is the only pass that enumerates every entity.
   *
   * `keepIds` travels as ONE array-typed bind parameter (`<> ALL($1)`), not one
   * bind parameter per id the way `inArray`/`notInArray` would build it: at tens
   * of thousands of entities that hits Postgres's 65535-parameter cap on a
   * prepared statement — the exact failure `listOrphanAssets` above already
   * avoids with an anti-join instead of `NOT IN (ids...)`. An empty `keepIds`
   * means no entity of this type currently exists, so every row of the type is
   * dropped.
   */
  async deleteUsagesExcept(entityType: MediaEntityType, keepIds: string[]): Promise<void> {
    if (keepIds.length === 0) {
      await db.delete(mediaUsages).where(eq(mediaUsages.entityType, entityType));
      return;
    }
    await db.delete(mediaUsages).where(
      and(
        eq(mediaUsages.entityType, entityType),
        sql`${mediaUsages.entityId} <> ALL(${pgTextArrayLiteral(keepIds)}::text[])`,
      ),
    );
  }
}
