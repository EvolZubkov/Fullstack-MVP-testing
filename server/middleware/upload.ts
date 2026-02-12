import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { Response } from "express";

// Директория для медиа-файлов
const mediaDir = path.resolve(process.cwd(), "uploads", "media");
fs.mkdirSync(mediaDir, { recursive: true });

/**
 * Multer для загрузки в память (Excel импорт и т.д.)
 */
export const memoryUpload = multer({ storage: multer.memoryStorage() });

/**
 * Multer для загрузки медиа-файлов на диск
 */
export const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, mediaDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      cb(null, `${Date.now()}_${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("audio/") ||
      file.mimetype.startsWith("video/");
    cb(ok ? null : (new Error("Unsupported media type") as any), ok);
  },
});

/**
 * Проверка на base64 в mediaUrl (запрещено)
 * @returns true если base64 обнаружен и ответ отправлен
 */
export function rejectBase64MediaUrl(mediaUrl: unknown, res: Response): boolean {
  if (typeof mediaUrl !== "string") return false;
  const v = mediaUrl.trim();
  if (v.startsWith("data:")) {
    res.status(413).json({
      error:
        "Base64 (data:...) запрещён. Загрузи файл через /api/media/upload и сохрани url вида /uploads/media/...",
    });
    return true;
  }
  return false;
}

export { mediaDir };