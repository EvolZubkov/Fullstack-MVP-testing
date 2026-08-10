/**
 * @module server/scorm/builders/media-resolver
 *
 * Turns a media reference into the bytes and the in-package path the SCORM packer needs.
 *
 * It exists as its own module so the packer itself stays a pure string walk: the packer knows
 * nothing about the registry or the store, and the tests of each side stay independent. The
 * ONLY recogniser of an address is `media-refs` — the same one the usage index uses, because
 * two ideas of "what a media reference is" would drift silently (spec §5).
 */
import fs from "node:fs";
import path from "node:path";
import type { MediaRef } from "../../services/media/media-refs";
import { extensionForMime } from "../../services/media/media-mime";
import { mediaStore } from "../../services/media/media-store";
import { storage } from "../../storage";

/** What the packer needs to place one file into the ZIP. */
export interface ResolvedMedia {
  /** Path inside the package, e.g. `assets/media/<id>.png`. */
  zipPath: string;
  buffer: Buffer;
}

/** Reads a whole stream into memory: the packer builds the ZIP from buffers. */
async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** The legacy root: files indexed in place by the backfill still live under it. */
const uploadsRoot = path.resolve(process.cwd(), "uploads");

/**
 * Resolves one reference, or `null` when nothing can be delivered.
 *
 * A canonical reference is named by the asset id, so the file inside the package is named by it
 * too — the same CANONICAL address used twice yields one file. (An asset addressed both
 * canonically and by its legacy path is packed twice: the packer decides per address, and the
 * two spellings are not known here to be the same asset.) A legacy reference keeps its
 * historical path (`assets/media/<file>`), so packages built before and after this work address
 * it identically.
 */
export async function registryMediaResolver(ref: MediaRef): Promise<ResolvedMedia | null> {
  if (ref.kind === "canonical") {
    const asset = await storage.getMediaAsset(ref.id);
    if (!asset) return null;
    const fromMime = extensionForMime(asset.mimeType);
    const ext =
      path.extname(asset.originalName ?? "").toLowerCase() || (fromMime ? `.${fromMime}` : ".bin");
    const buffer = await readStored(asset.storageKey);
    if (!buffer) return null;
    return { zipPath: `assets/media/${asset.id}${ext}`, buffer };
  }

  const asset = await storage.getMediaAssetByStorageKey(ref.storageKey);
  const buffer = asset ? await readStored(asset.storageKey) : readFromDisk(ref.storageKey);
  if (!buffer) return null;
  return { zipPath: `assets/${ref.storageKey}`, buffer };
}

/** Reads bytes through the storage port; `null` if the object has gone. */
async function readStored(storageKey: string): Promise<Buffer | null> {
  try {
    return await readAll(await mediaStore.openRead(storageKey));
  } catch {
    return null;
  }
}

/**
 * The last resort for a legacy address whose file never reached the registry. Kept because the
 * switch-off of the static mount must not also silently empty packages of older content.
 */
function readFromDisk(storageKey: string): Buffer | null {
  const abs = path.resolve(uploadsRoot, storageKey);
  const rootWithSep = uploadsRoot.endsWith(path.sep) ? uploadsRoot : uploadsRoot + path.sep;
  if (abs !== uploadsRoot && !abs.startsWith(rootWithSep)) return null;
  try {
    return fs.readFileSync(abs);
  } catch {
    return null;
  }
}
