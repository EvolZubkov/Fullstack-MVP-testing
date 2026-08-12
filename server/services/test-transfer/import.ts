/**
 * @module server/services/test-transfer/import
 *
 * Reads a `.tbtest` package and stores it as a NEW test on this installation.
 *
 * Three passes, in this order and no other:
 *
 * 1. **Media.** Files are registered first, because the renumbering pass needs the address
 *    each file will have HERE before it can rewrite the content that points at it.
 * 2. **Renumbering** (`plan`), pure and tested on its own.
 * 3. **Write**, one transaction (`storage.writeImportedTest`): a half-imported test is worse
 *    than no test, because nothing about it announces that it is half.
 *
 * Media is deduplicated by checksum: the same picture already in this installation's library
 * is reused, not stored twice. Ownership of a NEW asset goes to the importer, matching what
 * an upload through the editor would produce.
 *
 * Every port is injectable, so the orchestration is testable without a database, a
 * filesystem or a ZIP.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { storage } from "../../storage";
import { mediaStore } from "../media/media-store";
import { extensionForMime } from "../media/media-mime";
import { collectSourceIds, planImport, UnsupportedPackageError } from "./plan";
import { buildIdMap } from "./identity";
import { readTransferPackage, InvalidPackageError } from "./inspect";
import { type TestTransferPackage, type TransferMediaEntry } from "./package";
import type JSZip from "jszip";
import type { ImportWriteResult } from "../../storage/test-transfer-repository";

export { UnsupportedPackageError, InvalidPackageError };

/** Registers one file here and answers with the address content should use. */
export type MediaRegistrar = (
  entry: TransferMediaEntry,
  bytes: Buffer,
  ownerId: string,
) => Promise<{ address: string; reused: boolean }>;

export interface ImportOptions {
  ownerId: string;
  newId?: () => string;
  /**
   * Identifiers already occupied on this installation.
   *
   * Supplying it switches the import to the `preserve` mode: source identifiers are KEPT, and
   * only genuine collisions are renumbered, so a repeat import of the same package recognises
   * the rows it created last time. Omitting it means `copy`: everything is renumbered, which
   * is what makes a second independent copy of the source possible.
   *
   * It is data rather than a port on purpose — the caller that knows the target already reads
   * its state for the diff, and a second, per-row lookup here would be both slower and a
   * second source of truth.
   */
  takenIds?: Set<string>;
  registerMedia?: MediaRegistrar;
  write?: (content: Awaited<ReturnType<typeof planImport>>) => Promise<ImportWriteResult>;
}

/** What the author is told about an import that succeeded. */
export interface ImportReport {
  testId: string;
  title: string;
  counts: Record<string, number>;
  renamedTopics: string[];
  mediaReused: number;
  mediaCreated: number;
  /** Addresses the SOURCE could not resolve at export time; they arrive broken. */
  missingMedia: string[];
}

/** Coarse kind of a file, mirroring what the upload route records. */
function kindOf(mimeType: string): "image" | "audio" | "video" | "document" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

/**
 * The production registrar: reuse by checksum, otherwise store and index.
 *
 * `putFile` consumes a path, not a buffer, so the bytes go through a temporary file. It is
 * removed by the store on success; the `finally` covers the failure path, where it would
 * otherwise be left behind.
 */
export const registryMediaRegistrar: MediaRegistrar = async (entry, bytes, ownerId) => {
  const existing = await storage.findMediaAssetByOwnerChecksum(ownerId, entry.checksum);
  if (existing) return { address: `/api/media/${existing.id}`, reused: true };

  const mimeType = entry.mimeType ?? "application/octet-stream";
  const ext = path.extname(entry.originalName ?? "") || `.${extensionForMime(mimeType) ?? "bin"}`;
  const tempPath = path.join(os.tmpdir(), `tbtest-${randomUUID()}${ext}`);

  try {
    fs.writeFileSync(tempPath, bytes);
    const stored = await mediaStore.putFile(tempPath, ext);
    const asset = await storage.createMediaAsset({
      checksum: stored.checksum,
      storageKey: stored.storageKey,
      mimeType,
      byteSize: stored.byteSize,
      kind: kindOf(mimeType),
      originalName: entry.originalName ?? `file${ext}`,
      ownerId,
      visibility: "private",
    });
    return { address: `/api/media/${asset.id}`, reused: false };
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
};

/**
 * Registers every file of the package here and answers with the address map.
 *
 * Shared by both import paths — the whole copy and the selective apply — because a file is
 * registered the same way whichever of them runs; two passes would drift into two libraries.
 */
export async function registerPackageMedia(
  zip: JSZip,
  pkg: TestTransferPackage,
  ownerId: string,
  registerMedia: MediaRegistrar,
): Promise<{ mediaAddressMap: Map<string, string>; mediaReused: number; mediaCreated: number }> {
  const mediaAddressMap = new Map<string, string>();
  let mediaReused = 0;
  let mediaCreated = 0;

  for (const entry of pkg.media ?? []) {
    const file = zip.file(entry.path);
    if (!file) {
      throw new InvalidPackageError(`В пакете нет файла ${entry.path}, указанного в манифесте`);
    }
    const bytes = await file.async("nodebuffer");
    const { address, reused } = await registerMedia(entry, bytes, ownerId);
    mediaAddressMap.set(entry.address, address);
    if (reused) mediaReused++;
    else mediaCreated++;
  }

  return { mediaAddressMap, mediaReused, mediaCreated };
}

/** Imports a package into this installation as a new test. */
export async function importTestPackage(
  archive: Buffer,
  opts: ImportOptions,
): Promise<ImportReport> {
  const newId = opts.newId ?? randomUUID;
  const registerMedia = opts.registerMedia ?? registryMediaRegistrar;
  const write = opts.write ?? ((content) => storage.writeImportedTest(content));

  // Opening and validating the package is the inspect step's job; a second reader here would
  // be a second answer to "is this file readable".
  const { zip, pkg } = await readTransferPackage(archive);

  // Pass 1 — media. The address map must be complete before renumbering runs.
  const { mediaAddressMap, mediaReused, mediaCreated } = await registerPackageMedia(
    zip,
    pkg,
    opts.ownerId,
    registerMedia,
  );

  // Pass 2 — renumbering. With `takenIds` only collisions move (preserve); without it
  // every identifier does (copy).
  const idMap = opts.takenIds
    ? buildIdMap(collectSourceIds(pkg.content), { taken: opts.takenIds, newId })
    : undefined;
  const plan = planImport(pkg, { newId, idMap, ownerId: opts.ownerId, mediaAddressMap });

  // Pass 3 — one transaction.
  const written = await write(plan);

  return {
    testId: written.testId,
    title: String((plan.test as unknown as { title: string }).title ?? ""),
    counts: written.counts,
    renamedTopics: written.renamedTopics,
    mediaReused,
    mediaCreated,
    missingMedia: pkg.missingMedia ?? [],
  };
}
