/**
 * @module server/routes/media
 *
 * The media library API.
 *
 * `POST /upload` — accepts a file, moves it into the store under a checksum-derived key
 * and writes (or reuses) a registry row. The answer keeps its historical field names
 * (`url`, `mime`, `originalName`, `size`) because the editor reads them; `url` is now the
 * canonical `/api/media/<id>` instead of a path into a public static mount.
 */
import { Router, type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { storage } from "../storage";
import { mediaUpload } from "../middleware/upload";
import { mediaStore } from "../services/media/media-store";
import { logger } from "../logger";
import { getEffectiveRoles } from "../services/access";
import { canDeliverAsset } from "../services/media/asset-access";
import { requirePermission } from "../middleware/auth";
import { reindexAllUsages } from "../services/media/usage-index";
import { isAdminOrSuper } from "../services/test-access";
import type { MediaAsset } from "@shared/schema";

const router = Router();

/** Rejects an unauthenticated caller. Media is never anonymous, not even to upload. */
function requireAuth(req: Request, res: Response, next: () => void) {
  if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

/** Maps a MIME type onto the registry's coarse kind. */
function kindOf(mime: string): "image" | "audio" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

router.post("/upload", requireAuth, mediaUpload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const ownerId = req.session.userId as string;
  // Busboy decodes the multipart filename as latin1 by default, so a UTF-8
  // (e.g. Cyrillic) original name arrives mojibake — re-decode it to UTF-8.
  const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");

  try {
    const ext = path.extname(originalName).toLowerCase();
    const stored = await mediaStore.putFile(req.file.path, ext);

    // Dedup is per OWNER: identical bytes from another author get their own row.
    let asset = await storage.findMediaAssetByOwnerChecksum(ownerId, stored.checksum);
    if (!asset) {
      try {
        asset = await storage.createMediaAsset({
          checksum: stored.checksum,
          storageKey: stored.storageKey,
          mimeType: req.file.mimetype,
          byteSize: stored.byteSize,
          kind: kindOf(req.file.mimetype),
          originalName,
          title: originalName.replace(/\.[^.]+$/, "") || originalName,
          ownerId,
          // Shared by default: a picture used by a question of a SHARED topic must stay
          // reachable when another author picks that topic up. Privacy is an explicit act.
          visibility: "shared",
        });
      } catch (error) {
        // Lost the race: a concurrent upload of the same bytes by the same author got
        // there first. The partial unique index (owner_id, checksum) turned that into a
        // conflict; re-read and use the row that won, which is exactly what dedup would
        // have returned anyway.
        if ((error as { code?: string }).code !== "23505") throw error;
        asset = await storage.findMediaAssetByOwnerChecksum(ownerId, stored.checksum);
        if (!asset) throw error;
      }
    }

    res.json({
      id: asset.id,
      url: `/api/media/${asset.id}`,
      mime: asset.mimeType,
      originalName,
      size: asset.byteSize,
    });
  } catch (error) {
    // The scratch file must not survive a failed registration.
    if (req.file?.path) fs.rmSync(req.file.path, { force: true });
    logger.error(`Media upload failed: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to store media" });
  }
});

/**
 * POST /reindex — rebuild the usage index from scratch and report orphans. An
 * administrative operation: it reads every content entity, so it is not on any hot path.
 */
router.post("/reindex", requirePermission("media.manage"), async (_req: Request, res: Response) => {
  try {
    const report = await reindexAllUsages();
    const orphans = await storage.listOrphanMediaAssets();
    res.json({ ...report, orphans });
  } catch (error) {
    logger.error(`Media reindex failed: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to reindex media usages" });
  }
});

/**
 * DELETE /:id — remove an asset.
 *
 * Refused with `409` while anything uses it, listing where, exactly as the PRD-15
 * content-guard refuses to delete content a test depends on. A published snapshot counts
 * as a usage: an issued version must not lose its picture after the fact.
 *
 * The PHYSICAL file goes only when no other registry row holds the same checksum — dedup
 * means another author may own a row over the same bytes.
 */
router.delete("/:id", requirePermission("media.manage"), async (req: Request, res: Response) => {
  try {
    const asset = await storage.getMediaAsset(req.params.id);
    if (!asset) return res.status(404).json({ error: "Not found" });

    const roles = req.effectiveRoles ?? [];
    const isOwner = !!asset.ownerId && asset.ownerId === req.session.userId;
    if (!isOwner && !isAdminOrSuper(roles)) return res.status(403).json({ error: "Forbidden" });

    const usages = await storage.getMediaUsagesByAsset(asset.id);
    if (usages.length > 0) {
      return res.status(409).json({
        error: "media_in_use",
        message: "Файл используется и не может быть удалён",
        usages: usages.map((u) => ({ entityType: u.entityType, entityId: u.entityId, field: u.field })),
      });
    }

    if (req.query.dryRun === "true") return res.json({ wouldDelete: true, usages: [] });

    try {
      await storage.deleteMediaAsset(asset.id);
    } catch (error) {
      // Race window between the usage check above and this delete: a concurrent request
      // may have written a `media_usages` row in between. The FK (deliberately without
      // cascade) then rejects the delete with `23503` — turn that into the same 409 the
      // up-front check would have given, instead of letting it surface as a 500.
      if ((error as { code?: string }).code === "23503") {
        const lateUsages = await storage.getMediaUsagesByAsset(asset.id);
        return res.status(409).json({
          error: "media_in_use",
          message: "Файл используется и не может быть удалён",
          usages: lateUsages.map((u) => ({ entityType: u.entityType, entityId: u.entityId, field: u.field })),
        });
      }
      throw error;
    }
    // Reference counting on the physical layer: the bytes are shared across owners.
    if ((await storage.countMediaAssetsByChecksum(asset.checksum)) === 0) {
      await mediaStore.remove(asset.storageKey);
    }
    res.json({ deleted: true });
  } catch (error) {
    logger.error(`Media delete failed: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to delete media" });
  }
});

/**
 * Parses `bytes=<start>-<end>`; an open end runs to the last byte.
 *
 * Three outcomes, deliberately distinct: `null` when there is no usable Range header at
 * all (serve the whole file), `"unsatisfiable"` when the header parsed but asks for bytes
 * past the end (RFC 9110 §15.5.17 — answer 416, or a client resuming a download silently
 * receives the whole file again instead of an error), and a range otherwise.
 */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  if (!m[1] && !m[2]) return null;
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Number(m[2]) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  // Checked BEFORE `start > end`: for an open end (`bytes=999999-`) `end` defaults to
  // `size - 1`, which would make an out-of-range start look like a mere `start > end`
  // parse failure (silently served in full) instead of the 416 the caller must see.
  if (start >= size) return "unsatisfiable";
  if (start > end) return null;
  return { start, end: Math.min(end, size - 1) };
}

/**
 * Sends one resolved asset: permission rule, headers, range, body.
 *
 * Shared by the canonical `GET /:id` route and the compatibility `legacyUploadsAlias` —
 * both resolve an asset by a different key, but everything past that point (the
 * permission check, ETag/range headers, and stream-error handling) must behave
 * identically, or the legacy shape of an address would become a way to dodge a rule the
 * canonical route enforces.
 */
async function deliverAsset(req: Request, res: Response, asset: MediaAsset): Promise<void> {
  const user = await storage.getUser(req.session.userId as string);
  if (!user || user.status === "inactive") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const roles = await getEffectiveRoles(user);
  if (!(await canDeliverAsset(asset, user.id, roles))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const etag = `"${asset.checksum}"`;
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "private, max-age=3600");
  // The answer depends on WHO asked, and `private` alone does not say so: a browser
  // keeps one cache per profile, and logging out does not clear it. On a shared machine
  // — a classroom being the obvious case — the next learner would be served the previous
  // one's file straight from cache, never reaching the permission rule. Keying the entry
  // on the session cookie makes a different session a different cache entry.
  res.setHeader("Vary", "Cookie");
  res.setHeader("Content-Type", asset.mimeType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
  );
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }

  const stat = await mediaStore.stat(asset.storageKey);
  if (!stat) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const range = parseRange(req.headers.range as string | undefined, stat.byteSize);
  if (range === "unsatisfiable") {
    // RFC 9110 §15.5.17: the response must say what the real extent is.
    res.setHeader("Content-Range", `bytes */${stat.byteSize}`);
    res.status(416).end();
    return;
  }
  if (range) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${stat.byteSize}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
  } else {
    res.setHeader("Content-Length", String(stat.byteSize));
  }

  const stream = await mediaStore.openRead(asset.storageKey, range ?? undefined);
  // The store rejects a missing key up front, but the file can still vanish mid-read.
  // An unhandled `error` event on a piped stream takes the process down, so the socket
  // is closed instead: the headers are already sent, there is no status left to send.
  stream.on("error", (streamError) => {
    logger.error(`Media stream failed for ${asset.id}: ${(streamError as Error).message}`);
    res.destroy();
  });
  stream.pipe(res);
}

/**
 * GET /:id — deliver one file.
 *
 * This route is what replaced the public `/uploads` static mount, so everything the mount
 * used to do for free is done here: ranged reads (without them audio and video do not
 * seek, and Safari refuses to start a video at all), an ETag over the checksum, and a
 * PRIVATE cache — the answer depends on who is asking, and a shared cache would hand one
 * learner's file to another.
 */
router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const asset = await storage.getMediaAsset(req.params.id);
    if (!asset) return res.status(404).json({ error: "Not found" });
    await deliverAsset(req, res, asset);
  } catch (error) {
    logger.error(`Media delivery failed: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to deliver media" });
  }
});

export default router;

/**
 * The compatibility mount for addresses stored before the registry existed. The static
 * `/uploads` mount is gone, so without this the switch-off breaks silently — a broken
 * picture in the editor, not an error anyone would notice. Resolution goes through the
 * storage key the backfill wrote, and the SAME permission rule applies: the legacy shape
 * of an address must not be a way around it.
 */
export const legacyUploadsAlias = Router();

legacyUploadsAlias.get(/^\/media\/.+$/, requireAuth, async (req: Request, res: Response) => {
  try {
    const storageKey = `media/${req.path.replace(/^\/media\//, "")}`;
    const asset = await storage.getMediaAssetByStorageKey(storageKey);
    if (!asset) return res.status(404).json({ error: "Not found" });
    await deliverAsset(req, res, asset);
  } catch (error) {
    logger.error(`Legacy media delivery failed: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to deliver media" });
  }
});
