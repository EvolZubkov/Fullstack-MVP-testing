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

export default router;
