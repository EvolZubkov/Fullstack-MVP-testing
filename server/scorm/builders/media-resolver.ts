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
import { mediaStore } from "../../services/media/media-store";
import { storage } from "../../storage";

/** What the packer needs to place one file into the ZIP. */
export interface ResolvedMedia {
  /** Path inside the package, e.g. `assets/media/<id>.png`. */
  zipPath: string;
  buffer: Buffer;
}

/** Extension by MIME for assets whose original name carries none. */
const EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "application/pdf": ".pdf",
};

/** Reads a whole stream into memory: the packer builds the ZIP from buffers. */
async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** The legacy root: files indexed in place by the backfill still live under it. */
const uploadsRoot = path.resolve(process.cwd(), "uploads");

/** Bare media type, without parameters or case, as the table above is keyed. */
function mimeKey(mimeType: string | null | undefined): string {
  return (mimeType ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * Resolves one reference, or `null` when nothing can be delivered.
 *
 * A canonical reference is named by the asset id, so the file inside the package is named by it
 * too — one asset used twice is packed once. A legacy reference keeps its historical path
 * (`assets/media/<file>`), so packages built before and after this work address it identically.
 */
export async function registryMediaResolver(ref: MediaRef): Promise<ResolvedMedia | null> {
  if (ref.kind === "canonical") {
    const asset = await storage.getMediaAsset(ref.id);
    if (!asset) return null;
    const ext =
      path.extname(asset.originalName ?? "").toLowerCase() || EXT_BY_MIME[mimeKey(asset.mimeType)] || ".bin";
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
