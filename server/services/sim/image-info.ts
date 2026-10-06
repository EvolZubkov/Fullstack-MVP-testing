/**
 * @module server/services/sim/image-info
 *
 * Format and pixel size of an image read from its own bytes — the extension of a file in an
 * uploaded archive says what the author named it, not what it is.
 *
 * Only the three formats a scenario accepts are recognised (PNG, JPEG, WebP); anything else is
 * `null`. Headers are read directly: no dependency is needed for a dozen bytes per format.
 */

/** What {@link readImageInfo} found. */
export interface ImageInfo {
  format: "png" | "jpeg" | "webp" | null;
  mimeType: string | null;
  width?: number;
  height?: number;
}

const MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const;

/**
 * Read the format and the pixel size of an image.
 *
 * @param bytes The whole file.
 * @returns The format (or `null` when it is not PNG, JPEG or WebP) and, when the header allows,
 *   the width and height.
 */
export function readImageInfo(bytes: Uint8Array): ImageInfo {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // PNG: signature, then the IHDR chunk with width and height as big-endian 32-bit integers.
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) {
    return { format: "png", mimeType: MIME.png, width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }

  // JPEG: walk the markers up to a start-of-frame segment, which carries the size.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const marker = b[i + 1];
      // Fill bytes and standalone markers carry no length.
      if (marker === 0xff) { i += 1; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const length = b.readUInt16BE(i + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { format: "jpeg", mimeType: MIME.jpeg, height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + length;
    }
    return { format: "jpeg", mimeType: MIME.jpeg };
  }

  // WebP: RIFF container; the size sits in the first chunk, differently for each of its kinds.
  if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const chunk = b.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
      return { format: "webp", mimeType: MIME.webp, width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    }
    if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { format: "webp", mimeType: MIME.webp, width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === "VP8 ") {
      return { format: "webp", mimeType: MIME.webp, width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    }
    return { format: "webp", mimeType: MIME.webp };
  }

  return { format: null, mimeType: null };
}
