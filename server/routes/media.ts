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

/** Parses `bytes=<start>-<end>`; an open end runs to the last byte. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Number(m[2]) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
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

    const user = await storage.getUser(req.session.userId as string);
    if (!user || user.status === "inactive") return res.status(403).json({ error: "Forbidden" });
    const roles = await getEffectiveRoles(user);
    if (!(await canDeliverAsset(asset, user.id, roles))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const etag = `"${asset.checksum}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Content-Type", asset.mimeType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
    );
    if (req.headers["if-none-match"] === etag) return res.status(304).end();

    const stat = await mediaStore.stat(asset.storageKey);
    if (!stat) return res.status(404).json({ error: "Not found" });

    const range = parseRange(req.headers.range as string | undefined, stat.byteSize);
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
  } catch (error) {
    logger.error(`Media delivery failed: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to deliver media" });
  }
});

export default router;
