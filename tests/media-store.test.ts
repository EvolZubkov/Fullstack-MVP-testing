/**
 * @module tests/media-store
 * @description The storage port hides WHERE bytes live. Two behaviours are load-bearing:
 * putting identical bytes twice yields ONE physical file (dedup), and a ranged read
 * returns exactly the requested slice (audio/video seeking).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFsMediaStore } from "../server/services/media/media-store";

let root: string;
let tmp: string;

/** Writes a scratch source file and returns its path. */
function sourceFile(name: string, content: string): string {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, content);
  return p;
}

/** Drains a readable stream into a string. */
async function read(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "media-store-"));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "media-src-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("createFsMediaStore", () => {
  it("derives the key from the checksum and shards by its prefix", async () => {
    const store = createFsMediaStore(root);
    const stored = await store.putFile(sourceFile("a.png", "hello"), ".png");
    expect(stored.checksum).toHaveLength(64);
    expect(stored.byteSize).toBe(5);
    expect(stored.storageKey).toBe(
      `media/${stored.checksum.slice(0, 2)}/${stored.checksum.slice(2, 4)}/${stored.checksum}.png`,
    );
    expect(fs.existsSync(path.join(root, stored.storageKey))).toBe(true);
  });

  it("stores identical bytes once and consumes the source both times", async () => {
    const store = createFsMediaStore(root);
    const first = sourceFile("one.png", "same");
    const second = sourceFile("two.png", "same");
    const a = await store.putFile(first, ".png");
    const b = await store.putFile(second, ".png");
    expect(b.storageKey).toBe(a.storageKey);
    expect(fs.existsSync(first)).toBe(false);
    expect(fs.existsSync(second)).toBe(false);
  });

  it("reads a byte range", async () => {
    const store = createFsMediaStore(root);
    const stored = await store.putFile(sourceFile("r.txt", "0123456789"), ".txt");
    expect(await read(await store.openRead(stored.storageKey, { start: 2, end: 4 }))).toBe("234");
    expect(await read(await store.openRead(stored.storageKey))).toBe("0123456789");
  });

  it("reports size and removes", async () => {
    const store = createFsMediaStore(root);
    const stored = await store.putFile(sourceFile("s.txt", "abc"), ".txt");
    expect(await store.stat(stored.storageKey)).toEqual({ byteSize: 3 });
    await store.remove(stored.storageKey);
    expect(await store.stat(stored.storageKey)).toBeNull();
  });

  it("refuses a key that escapes the root", async () => {
    const store = createFsMediaStore(root);
    await expect(store.stat("../../etc/passwd")).rejects.toThrow(/outside/i);
  });
});
