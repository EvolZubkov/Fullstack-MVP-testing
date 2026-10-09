/**
 * @module server/scorm/zip
 * @description In-memory ZIP builder shared by the SCORM export, the test transfer
 * package and the design-template package. Built on `jszip` (already used across the
 * server for reading archives), so the project needs no second ZIP library.
 */

import JSZip from "jszip";

/**
 * Builds a ZIP archive from a flat map of entries.
 *
 * Entries are written in the map's insertion order with maximum DEFLATE compression.
 * Only file entries are emitted: intermediate directory entries are NOT created for
 * nested paths (`createFolders: false`), matching what the archive always contained.
 *
 * @param {Record<string, string | Buffer>} files - Archive path -> content. A string is
 *   stored as UTF-8, a Buffer is stored byte for byte.
 * @returns {Promise<Buffer>} The complete ZIP archive.
 */
export async function buildZip(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();

  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content, { createFolders: false });
  }

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}
