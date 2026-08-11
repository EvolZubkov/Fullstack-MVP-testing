import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { WorkbookReadError } from "../utils/excel";

// Директория для медиа-файлов
const mediaDir = path.resolve(process.cwd(), "uploads", "media");
fs.mkdirSync(mediaDir, { recursive: true });

/**
 * Multer для загрузки в память (Excel импорт и т.д.)
 */
export const memoryUpload = multer({ storage: multer.memoryStorage() });

/**
 * Upload ceiling for Excel workbooks. A real book is measured in hundreds of
 * kilobytes; the cap exists because the whole upload is held in memory, and
 * reading a book whose namespaces need normalizing holds it TWICE (original plus
 * rewritten package). Design-template zips keep using the unlimited
 * {@link memoryUpload} — they are a different shape of upload.
 */
export const WORKBOOK_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;

const workbookUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: WORKBOOK_UPLOAD_LIMIT_BYTES },
});

/**
 * Accept one uploaded workbook under `field`, answering `413` when it exceeds
 * {@link WORKBOOK_UPLOAD_LIMIT_BYTES}.
 *
 * The size check has to be translated here: multer reports the overflow by
 * calling `next(err)`, which skips the route handler entirely and would surface
 * as a bare 500 from the app-level error handler.
 *
 * @param field Multipart field name holding the file.
 */
export function workbookUploadSingle(field: string) {
  const handler = workbookUpload.single(field);
  return (req: Request, res: Response, next: NextFunction) =>
    handler(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: "Workbook is too large",
          code: "too_large",
          maxBytes: WORKBOOK_UPLOAD_LIMIT_BYTES,
        });
      }
      next(err);
    });
}

// Uploads land in a scratch directory; `MediaStore.putFile` moves them to their
// checksum-derived final key, so the upload never picks the storage layout itself.
const tmpDir = path.resolve(process.cwd(), "uploads", "tmp");
fs.mkdirSync(tmpDir, { recursive: true });

/**
 * Multer для загрузки медиа-файлов на диск (во временную директорию — окончательное
 * место выбирает `MediaStore` по контрольной сумме)
 */
export const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpDir),
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
      file.mimetype.startsWith("video/") ||
      // PRD-32: PDF-вложения обратной связи живут в том же реестре.
      file.mimetype === "application/pdf";
    cb(ok ? null : (new Error("Unsupported media type") as any), ok);
  },
});

/**
 * Answer a failed workbook read as a CLIENT error, carrying the reason code.
 *
 * A file the author picked is their input, not a server fault: every route that
 * reads an uploaded book used to let the failure fall into its generic `500`,
 * which told the author nothing and looked like an outage. Lives next to
 * {@link workbookUploadSingle} because both translate an upload-level problem
 * into the answer the client can act on.
 *
 * @param res Response to write to.
 * @param error The caught error, of any kind.
 * @returns true when the error WAS a read failure and the response is sent, so
 *   the caller can return; false to fall through to its own handling.
 */
export function respondWorkbookReadError(res: Response, error: unknown): boolean {
  if (!(error instanceof WorkbookReadError)) return false;
  res.status(400).json({ error: "Failed to read file", code: error.reason });
  return true;
}

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
        "Base64 (data:...) запрещён. Загрузи файл через /api/media/upload и сохрани url вида /api/media/...",
    });
    return true;
  }
  return false;
}

export { mediaDir };