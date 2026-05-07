/**
 * Tests for server/scorm/builders/media-assets.ts
 * extractEmbeddedMediaIntoAssets — converts data: URLs and /uploads/ paths
 * into zip-ready asset buffers and rewrites mediaUrl in-place.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";

// ─── Mock node:fs so we don't touch the real filesystem ───────────────────────
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import fs from "node:fs";
import { extractEmbeddedMediaIntoAssets } from "../server/scorm/builders/media-assets";

const fsMock = fs as unknown as { existsSync: ReturnType<typeof vi.fn>; readFileSync: ReturnType<typeof vi.fn> };

// 1x1 transparent PNG as base64
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`;

beforeEach(() => {
  vi.resetAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("extractEmbeddedMediaIntoAssets — base64 data URLs", () => {
  it("converts a PNG data URL to an asset file", () => {
    const testObj = { mediaUrl: PNG_DATA_URL };
    const { assets, missing } = extractEmbeddedMediaIntoAssets(testObj);

    expect(missing).toHaveLength(0);
    const keys = Object.keys(assets);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^assets\/media\/.+\.png$/);
    expect(assets[keys[0]]).toBeInstanceOf(Buffer);
  });

  it("rewrites mediaUrl in-place to the zip path", () => {
    const testObj = { mediaUrl: PNG_DATA_URL };
    extractEmbeddedMediaIntoAssets(testObj);
    expect(testObj.mediaUrl).toMatch(/^assets\/media\/.+\.png$/);
  });

  it("maps image/jpeg mime to .jpg extension", () => {
    const jpgData = `data:image/jpeg;base64,${PNG_B64}`;
    const testObj = { mediaUrl: jpgData };
    const { assets } = extractEmbeddedMediaIntoAssets(testObj);
    expect(Object.keys(assets)[0]).toMatch(/\.jpg$/);
  });

  it("maps audio/mpeg mime to .mp3 extension", () => {
    const audioData = `data:audio/mpeg;base64,AAAA`;
    const testObj = { mediaUrl: audioData };
    const { assets } = extractEmbeddedMediaIntoAssets(testObj);
    expect(Object.keys(assets)[0]).toMatch(/\.mp3$/);
  });

  it("maps unknown mime to .bin extension", () => {
    const unknownData = `data:application/octet-stream;base64,AAAA`;
    const testObj = { mediaUrl: unknownData };
    const { assets } = extractEmbeddedMediaIntoAssets(testObj);
    expect(Object.keys(assets)[0]).toMatch(/\.bin$/);
  });

  it("generates unique filenames for different images", () => {
    const obj1 = { mediaUrl: PNG_DATA_URL };
    const obj2 = { mediaUrl: PNG_DATA_URL };
    extractEmbeddedMediaIntoAssets(obj1);
    extractEmbeddedMediaIntoAssets(obj2);
    // Different calls → different nanoid filenames
    expect(obj1.mediaUrl).not.toBe(PNG_DATA_URL);
    expect(obj2.mediaUrl).not.toBe(PNG_DATA_URL);
  });

  it("processes mediaUrl in nested objects", () => {
    const testObj = {
      sections: [
        { questions: [{ mediaUrl: PNG_DATA_URL }] },
      ],
    };
    const { assets } = extractEmbeddedMediaIntoAssets(testObj);
    expect(Object.keys(assets)).toHaveLength(1);
    expect(testObj.sections[0].questions[0].mediaUrl).toMatch(/^assets\/media\//);
  });

  it("leaves non-mediaUrl fields untouched", () => {
    const testObj = { title: "Test", imageUrl: PNG_DATA_URL, mediaUrl: PNG_DATA_URL };
    extractEmbeddedMediaIntoAssets(testObj);
    // imageUrl is not a mediaUrl field — should be unchanged
    expect(testObj.imageUrl).toBe(PNG_DATA_URL);
    // mediaUrl is changed
    expect(testObj.mediaUrl).not.toBe(PNG_DATA_URL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("extractEmbeddedMediaIntoAssets — /uploads/ file paths", () => {
  it("embeds an existing upload file into assets", () => {
    const fakeBuf = Buffer.from("audio-data");
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(fakeBuf);

    const testObj = { mediaUrl: "/uploads/media/track.mp3" };
    const { assets, missing } = extractEmbeddedMediaIntoAssets(testObj, {
      uploadsRoot: "/app/uploads",
      uploadsUrlPrefix: "/uploads/",
    });

    expect(missing).toHaveLength(0);
    expect(assets["assets/media/track.mp3"]).toBe(fakeBuf);
    expect(testObj.mediaUrl).toBe("assets/media/track.mp3");
  });

  it("adds to missing when file does not exist on disk", () => {
    fsMock.existsSync.mockReturnValue(false);

    const testObj = { mediaUrl: "/uploads/media/ghost.mp3" };
    const { assets, missing } = extractEmbeddedMediaIntoAssets(testObj, {
      uploadsRoot: "/app/uploads",
      uploadsUrlPrefix: "/uploads/",
    });

    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/missing file/i);
    expect(Object.keys(assets)).toHaveLength(0);
    // mediaUrl is NOT rewritten when file is missing
    expect(testObj.mediaUrl).toBe("/uploads/media/ghost.mp3");
  });

  it("blocks path traversal attempts", () => {
    const testObj = { mediaUrl: "/uploads/../../../etc/passwd" };
    const { assets, missing } = extractEmbeddedMediaIntoAssets(testObj, {
      uploadsRoot: "/app/uploads",
      uploadsUrlPrefix: "/uploads/",
    });

    expect(missing.some(m => /blocked|path traversal/i.test(m))).toBe(true);
    expect(Object.keys(assets)).toHaveLength(0);
  });

  it("deduplicates the same upload file referenced multiple times", () => {
    const fakeBuf = Buffer.from("shared-audio");
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(fakeBuf);

    const testObj = {
      q1: { mediaUrl: "/uploads/media/shared.mp3" },
      q2: { mediaUrl: "/uploads/media/shared.mp3" },
    };
    const { assets } = extractEmbeddedMediaIntoAssets(testObj, {
      uploadsRoot: "/app/uploads",
      uploadsUrlPrefix: "/uploads/",
    });

    // readFileSync called only once despite two references
    expect(fsMock.readFileSync).toHaveBeenCalledTimes(1);
    expect(Object.keys(assets)).toHaveLength(1);
  });

  it("adds to missing when readFileSync throws", () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockImplementation(() => { throw new Error("EACCES: permission denied"); });

    const testObj = { mediaUrl: "/uploads/media/locked.mp3" };
    const { missing } = extractEmbeddedMediaIntoAssets(testObj, {
      uploadsRoot: "/app/uploads",
      uploadsUrlPrefix: "/uploads/",
    });

    expect(missing.some(m => /failed to read/i.test(m))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("extractEmbeddedMediaIntoAssets — edge cases", () => {
  it("ignores nodes with no mediaUrl", () => {
    const testObj = { title: "No media here", sections: [] };
    const { assets, missing } = extractEmbeddedMediaIntoAssets(testObj);
    expect(assets).toEqual({});
    expect(missing).toHaveLength(0);
  });

  it("ignores mediaUrl that is not a data URL or /uploads/ path", () => {
    const testObj = { mediaUrl: "https://external.example.com/image.png" };
    const { assets, missing } = extractEmbeddedMediaIntoAssets(testObj);
    // External URLs are left unchanged — not embedded
    expect(assets).toEqual({});
    expect(missing).toHaveLength(0);
    expect(testObj.mediaUrl).toBe("https://external.example.com/image.png");
  });

  it("handles null and primitive values without crashing", () => {
    const testObj = { a: null, b: 42, c: true, d: "string" };
    expect(() => extractEmbeddedMediaIntoAssets(testObj)).not.toThrow();
  });

  it("returns the same testObj reference", () => {
    const testObj = { mediaUrl: PNG_DATA_URL };
    const { testObj: returned } = extractEmbeddedMediaIntoAssets(testObj);
    expect(returned).toBe(testObj);
  });
});
