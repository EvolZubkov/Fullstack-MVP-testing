/**
 * @module server/services/media/media-mime
 *
 * The ONE table of file extensions by media type. It lived in two copies — the SCORM packer's
 * and the SCORM resolver's — differing only in the leading dot, which is precisely the kind of
 * duplication that ends with a package naming the same file two ways.
 *
 * Pure module: no database, no filesystem.
 */

/** Extension WITHOUT the leading dot, by bare media type. */
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",

  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",

  "video/mp4": "mp4",
  "video/webm": "webm",

  "application/pdf": "pdf",
};

/**
 * The file extension a media type asks for, WITHOUT the leading dot, or `null` when the type
 * is unknown. Parameters and case are ignored, so `image/PNG; charset=binary` still answers.
 *
 * @param mimeType - A media type as stored on the asset or read off a `data:` URL.
 */
export function extensionForMime(mimeType: string | null | undefined): string | null {
  const key = (mimeType ?? "").split(";")[0].trim().toLowerCase();
  return EXT_BY_MIME[key] ?? null;
}
