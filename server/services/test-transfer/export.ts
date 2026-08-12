/**
 * @module server/services/test-transfer/export
 *
 * Assembles a `.tbtest` package: the test serialized whole plus the bytes of every picture
 * and attachment its content addresses.
 *
 * The snapshot deliverable is reused rather than re-derived. `buildSnapshotContent` already
 * freezes a test completely for publication, which is the same question this format asks —
 * "what IS this test" — so a second assembler would be a second answer, free to drift from
 * the first.
 *
 * Both outside dependencies enter through ports (`loadContent`, `resolveRef`), so the packer
 * is a pure walk over data in tests: no database, no filesystem.
 */
import crypto from "node:crypto";
import path from "node:path";
import { buildSnapshotContent, type TestSnapshotContent } from "../test-snapshot";
import { collectMediaRefs, type MediaRef } from "../media/media-refs";
import { extensionForMime } from "../media/media-mime";
import { mediaStore } from "../media/media-store";
import { storage } from "../../storage";
import { buildZip } from "../../scorm/zip";
import {
  TRANSFER_FORMAT_VERSION,
  TRANSFER_MANIFEST_NAME,
  TRANSFER_MEDIA_DIR,
  type TestTransferPackage,
  type TransferMediaEntry,
} from "./package";

export {
  TRANSFER_FORMAT_VERSION,
  TRANSFER_MANIFEST_NAME,
  TRANSFER_MEDIA_DIR,
  type TestTransferPackage,
  type TransferMediaEntry,
};

/** Bytes of one referenced file, with what is known about them. */
export interface ResolvedTransferMedia {
  buffer: Buffer;
  mimeType: string | null;
  originalName: string | null;
}

/**
 * Resolves a reference to bytes, or `null` when nothing can be delivered.
 *
 * MAY throw: a throw is treated exactly as `null`, so one unreachable file cannot fail a
 * whole export — it is reported instead.
 */
export type TransferMediaResolver = (ref: MediaRef) => Promise<ResolvedTransferMedia | null>;

/** Ports the packer needs; both default to the real installation. */
export interface BuildTransferOptions {
  loadContent?: (testId: string) => Promise<TestSnapshotContent | null>;
  resolveRef?: TransferMediaResolver;
}

/** What the packer produces: the manifest, and the ZIP entries keyed by path. */
export interface BuiltTransferPackage {
  pkg: TestTransferPackage;
  files: Record<string, Buffer>;
}

/** Thrown when the export cannot proceed; the route turns it into a 404/422. */
export class TransferExportError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "TransferExportError";
  }
}

/** The address a reference is spelled as inside content. */
function addressOf(ref: MediaRef): string {
  return ref.kind === "canonical" ? `/api/media/${ref.id}` : `/uploads/${ref.storageKey}`;
}

/** Extension for the packed file: the original name wins, the MIME type is the fallback. */
function extensionFor(media: ResolvedTransferMedia): string {
  const fromName = path.extname(media.originalName ?? "").toLowerCase();
  if (fromName) return fromName;
  const fromMime = media.mimeType ? extensionForMime(media.mimeType) : null;
  return fromMime ? `.${fromMime}` : ".bin";
}

/**
 * Builds the package for one test.
 *
 * Media is collected by ADDRESS: the same address met twice is one entry and one file, while
 * two spellings of one asset (canonical and legacy) stay separate, because content holds them
 * separately and the import rewrites each occurrence by its own spelling.
 */
export async function buildTransferPackage(
  testId: string,
  opts: BuildTransferOptions = {},
): Promise<BuiltTransferPackage> {
  const loadContent = opts.loadContent ?? buildSnapshotContent;
  const resolveRef = opts.resolveRef ?? registryTransferResolver;

  const content = await loadContent(testId);
  if (!content) throw new TransferExportError(`Тест ${testId} не найден`, 404);

  const byAddress = new Map<string, MediaRef>();
  for (const found of collectMediaRefs(content)) {
    const address = addressOf(found.ref);
    if (!byAddress.has(address)) byAddress.set(address, found.ref);
  }

  const media: TransferMediaEntry[] = [];
  const missingMedia: string[] = [];
  const files: Record<string, Buffer> = {};

  for (const [address, ref] of byAddress) {
    let resolved: ResolvedTransferMedia | null = null;
    try {
      resolved = await resolveRef(ref);
    } catch {
      resolved = null;
    }
    if (!resolved) {
      missingMedia.push(address);
      continue;
    }

    const checksum = crypto.createHash("sha256").update(resolved.buffer).digest("hex");
    // Identical bytes reached from two addresses are ONE file with two manifest entries.
    const packedPath = `${TRANSFER_MEDIA_DIR}/${checksum}${extensionFor(resolved)}`;
    files[packedPath] = resolved.buffer;
    media.push({
      address,
      path: packedPath,
      checksum,
      mimeType: resolved.mimeType,
      originalName: resolved.originalName,
    });
  }

  const pkg: TestTransferPackage = {
    formatVersion: TRANSFER_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: process.env.npm_package_version ?? "",
    content,
    media,
    missingMedia,
  };

  return { pkg, files };
}

/** Builds the package and serializes it to a `.tbtest` ZIP. */
export async function buildTransferZip(
  testId: string,
  opts: BuildTransferOptions = {},
): Promise<{ buffer: Buffer; pkg: TestTransferPackage }> {
  const { pkg, files } = await buildTransferPackage(testId, opts);
  const entries: Record<string, string | Buffer> = {
    [TRANSFER_MANIFEST_NAME]: JSON.stringify(pkg, null, 2),
    ...files,
  };
  return { buffer: await buildZip(entries), pkg };
}

/** Reads bytes through the storage port; `null` if the object has gone. */
async function readStored(storageKey: string): Promise<Buffer | null> {
  try {
    const stream = await mediaStore.openRead(storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

/** The production resolver: the media registry, then the store. */
export async function registryTransferResolver(ref: MediaRef): Promise<ResolvedTransferMedia | null> {
  const asset =
    ref.kind === "canonical"
      ? await storage.getMediaAsset(ref.id)
      : await storage.getMediaAssetByStorageKey(ref.storageKey);
  if (!asset) return null;

  const buffer = await readStored(asset.storageKey);
  if (!buffer) return null;

  return { buffer, mimeType: asset.mimeType ?? null, originalName: asset.originalName ?? null };
}
