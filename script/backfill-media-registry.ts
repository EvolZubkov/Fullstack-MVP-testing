/**
 * @module script/backfill-media-registry
 *
 * One-off indexing of files that predate the registry. The old upload wrote
 * `uploads/media/<timestamp>_<uuid>.<ext>` and recorded nothing, so the author is
 * unknowable: rows land in the legacy bucket (`owner_id = null`, `shared`), which is what
 * lets the existing `/uploads/media/...` strings in content keep resolving.
 *
 * Files are NOT moved. The old flat name becomes the storage key as it stands, so the
 * addresses already stored in content resolve without rewriting a single JSON document.
 * New uploads use the checksum layout; the two coexist.
 *
 * Idempotent: a re-run finds every legacy file already indexed (via
 * `findMediaAssetByOwnerChecksum`) and skips it, so it reports 0 created and does not
 * insert duplicate rows.
 *
 * Run: `npx tsx script/backfill-media-registry.ts`
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { initConfig } from "../server/config";
import { loadEnv } from "../server/config-loader.mjs";
import { storage } from "../server/storage";

/** What one run did. */
export interface BackfillReport {
  created: number;
  skipped: number;
}

/** Maps a file extension onto the registry's coarse kind. */
function kindOf(ext: string): "image" | "audio" | "video" | "document" {
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) return "image";
  if ([".mp3", ".wav", ".ogg", ".m4a"].includes(ext)) return "audio";
  if ([".mp4", ".webm", ".ogv", ".mov"].includes(ext)) return "video";
  return "document";
}

/** Guesses a MIME type from the extension; the old upload stored none. */
function mimeOf(ext: string): string {
  const map: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".wav": "audio/wav",
    ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".mp4": "video/mp4", ".webm": "video/webm",
    ".mov": "video/quicktime", ".pdf": "application/pdf",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Indexes every file directly under `<uploadsRoot>/media`. */
export async function backfillMediaRegistry(uploadsRoot: string): Promise<BackfillReport> {
  const mediaDir = path.join(uploadsRoot, "media");
  if (!fs.existsSync(mediaDir)) return { created: 0, skipped: 0 };

  const report: BackfillReport = { created: 0, skipped: 0 };
  // Postgres treats NULL owners as distinct, so the unique index cannot stop duplicate
  // legacy rows — this run dedups them itself.
  const seen = new Set<string>();

  for (const name of fs.readdirSync(mediaDir).sort()) {
    const abs = path.join(mediaDir, name);
    if (!fs.statSync(abs).isFile()) continue;

    const checksum = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
    if (seen.has(checksum) || (await storage.findMediaAssetByOwnerChecksum(null, checksum))) {
      report.skipped += 1;
      continue;
    }
    seen.add(checksum);

    const ext = path.extname(name).toLowerCase();
    await storage.createMediaAsset({
      checksum,
      // The flat legacy name IS the key: content already addresses it this way.
      storageKey: `media/${name}`,
      mimeType: mimeOf(ext),
      byteSize: fs.statSync(abs).size,
      kind: kindOf(ext),
      originalName: name,
      title: name.replace(/\.[^.]+$/, "") || name,
      ownerId: null,
      visibility: "shared",
    });
    report.created += 1;
  }

  return report;
}

/** CLI entry: indexes the service's own `uploads/media` directory against the configured DB. */
async function main(): Promise<void> {
  // Same bootstrap order as the server: env first, then the config loader that
  // maps DATABASE_URL onto `config.database.url`, which `server/db` reads lazily.
  loadEnv();
  await initConfig();

  const report = await backfillMediaRegistry(path.resolve(process.cwd(), "uploads"));
  console.log(`Индексация завершена: создано ${report.created}, пропущено ${report.skipped}`);
}

// Direct invocation only: importing this module (e.g. from tests) must not touch the DB.
if (process.argv[1] && process.argv[1].endsWith("backfill-media-registry.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
