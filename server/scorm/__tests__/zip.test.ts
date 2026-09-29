/**
 * @module server/scorm/__tests__/zip.test
 * @description Unit tests for the in-memory ZIP builder: round-trip of text and binary
 * entries, entry order, no synthetic directory entries, compression.
 */

import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { buildZip } from "../zip";

describe("buildZip", () => {
  it("round-trips UTF-8 text and binary entries byte for byte", async () => {
    const binary = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f]);
    const archive = await buildZip({
      "imsmanifest.xml": "<manifest>Тест</manifest>",
      "media/image.bin": binary,
    });

    const zip = await JSZip.loadAsync(archive);
    expect(await zip.file("imsmanifest.xml")!.async("string")).toBe("<manifest>Тест</manifest>");
    expect(Buffer.from(await zip.file("media/image.bin")!.async("uint8array"))).toEqual(binary);
  });

  it("keeps insertion order and emits no directory entries", async () => {
    const archive = await buildZip({
      "b.txt": "b",
      "deep/nested/c.txt": "c",
      "a.txt": "a",
    });

    const zip = await JSZip.loadAsync(archive);
    expect(Object.keys(zip.files)).toEqual(["b.txt", "deep/nested/c.txt", "a.txt"]);
  });

  it("compresses entries", async () => {
    const payload = "x".repeat(100_000);
    const archive = await buildZip({ "big.txt": payload });
    expect(archive.length).toBeLessThan(payload.length / 10);
  });

  it("builds a valid empty archive", async () => {
    const zip = await JSZip.loadAsync(await buildZip({}));
    expect(Object.keys(zip.files)).toEqual([]);
  });
});
