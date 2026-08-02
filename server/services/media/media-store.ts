/**
 * @module server/services/media/media-store
 *
 * The storage port of the media library. Everything above it — the registry, the
 * permission rule, the usage index, dedup — works with a `storageKey` string and
 * knows nothing about where bytes live. Swapping the filesystem for an S3-compatible
 * store is therefore one module, with no table or route changes.
 *
 * The key is derived from the content checksum (`media/<ab>/<cd>/<sha256><ext>`), which
 * makes writing identical bytes idempotent and gives the two-level shard that keeps a
 * directory from holding tens of thousands of entries. In an object store the shard is
 * unnecessary but harmless, so the key transfers unchanged.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** What a successful write reports back to the registry. */
export interface StoredObject {
  storageKey: string;
  checksum: string;
  byteSize: number;
}

/** Inclusive byte range, as it arrives from an HTTP `Range` header. */
export interface ByteRange {
  start: number;
  end: number;
}

/** The storage port. */
export interface MediaStore {
  /** Moves `sourcePath` into the store. The source is consumed either way. */
  putFile(sourcePath: string, ext: string): Promise<StoredObject>;
  openRead(storageKey: string, range?: ByteRange): Promise<NodeJS.ReadableStream>;
  stat(storageKey: string): Promise<{ byteSize: number } | null>;
  remove(storageKey: string): Promise<void>;
}

/** `media/<ab>/<cd>/<sha256><ext>`; `ext` includes the dot or is empty. */
export function storageKeyFor(checksum: string, ext: string): string {
  return `media/${checksum.slice(0, 2)}/${checksum.slice(2, 4)}/${checksum}${ext}`;
}

/** Hashes a file without holding it in memory. */
function checksumOf(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** Filesystem-backed store rooted at `root`. */
export function createFsMediaStore(root: string): MediaStore {
  const absRoot = path.resolve(root);

  /** Resolves a key inside the root, refusing anything that escapes it. */
  function resolveKey(storageKey: string): string {
    const abs = path.resolve(absRoot, storageKey);
    const rootWithSep = absRoot.endsWith(path.sep) ? absRoot : absRoot + path.sep;
    if (abs !== absRoot && !abs.startsWith(rootWithSep)) {
      throw new Error(`storage key resolves outside the media root: ${storageKey}`);
    }
    return abs;
  }

  return {
    async putFile(sourcePath, ext) {
      const checksum = await checksumOf(sourcePath);
      const byteSize = fs.statSync(sourcePath).size;
      const storageKey = storageKeyFor(checksum, ext);
      const target = resolveKey(storageKey);
      if (fs.existsSync(target)) {
        // Same bytes already stored: drop the upload's copy rather than rewrite.
        fs.rmSync(sourcePath, { force: true });
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(sourcePath, target);
      }
      return { storageKey, checksum, byteSize };
    },

    async openRead(storageKey, range) {
      const abs = resolveKey(storageKey);
      return range
        ? fs.createReadStream(abs, { start: range.start, end: range.end })
        : fs.createReadStream(abs);
    },

    async stat(storageKey) {
      const abs = resolveKey(storageKey);
      if (!fs.existsSync(abs)) return null;
      return { byteSize: fs.statSync(abs).size };
    },

    async remove(storageKey) {
      fs.rmSync(resolveKey(storageKey), { force: true });
    },
  };
}

/** The application-wide store: the same `uploads` volume the service already mounts. */
export const mediaStore: MediaStore = createFsMediaStore(path.resolve(process.cwd(), "uploads"));
