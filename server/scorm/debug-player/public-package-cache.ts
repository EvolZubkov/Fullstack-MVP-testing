/**
 * @module server/scorm/debug-player/public-package-cache
 * @description Built packages served under a public test link. One package per published
 * snapshot (or per live revision of a pre-snapshot test) is shared by every visitor: the package is read-only, the visitor's state lives
 * in their own browser (shim + localStorage), so building it per visitor would only burn CPU.
 */
import { buildScormExportData } from "../build-export-data";
import { generateScormPackage } from "../../scorm-exporter";
import { unzipPackage } from "./session-store";

/** An unpacked package ready to serve file by file. */
export interface PublicPackage {
  files: Map<string, Buffer>;
  launch: string;
}

/** How many packages stay cached at once; the oldest is dropped first. */
const MAX_ENTRIES = 20;

/** How long a package built from LIVE content stays valid (ms). */
export const LIVE_PACKAGE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  pending: Promise<PublicPackage>;
  /** Epoch ms after which the entry is rebuilt; `null` = never (snapshot-keyed). */
  expiresAt: number | null;
}

const cache = new Map<string, CacheEntry>();

/**
 * The package of a published test, built once per `(testId, key)`. `key` is `snap:<id>` for a
 * published snapshot (immutable, so no TTL) or `live:<updatedAt>` for a test published before
 * snapshots existed (its content is read live; pass `ttlMs`, because edits of bank questions
 * do not touch the test row). Concurrent callers share one in-flight build; a failed build is
 * evicted so the next request retries instead of serving the error forever.
 */
export function getPublicPackage(
  testId: string,
  key: string,
  options: { ttlMs?: number } = {},
): Promise<PublicPackage> {
  const cacheKey = `${testId}:${key}`;
  const hit = cache.get(cacheKey);
  if (hit && (hit.expiresAt === null || hit.expiresAt > Date.now())) {
    cache.delete(cacheKey);
    cache.set(cacheKey, hit);
    return hit.pending;
  }
  const pending = (async () => {
    const data = await buildScormExportData(testId, { source: "export" });
    const buffer = await generateScormPackage({ ...data, telemetry: null });
    return unzipPackage(buffer);
  })();
  const entry: CacheEntry = {
    pending,
    expiresAt: options.ttlMs === undefined ? null : Date.now() + options.ttlMs,
  };
  pending.catch(() => {
    if (cache.get(cacheKey) === entry) cache.delete(cacheKey);
  });
  cache.delete(cacheKey);
  cache.set(cacheKey, entry);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return pending;
}

/** Test-only reset. */
export function __clearPublicPackages(): void {
  cache.clear();
}
