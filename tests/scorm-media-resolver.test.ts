/**
 * @module tests/scorm-media-resolver
 * @description Резолв ссылки медиатеки в байты для SCORM-пакета: реестр -> хранилище, с
 * запасным чтением с диска для легаси-адреса, чей файл в реестр не попал.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import fs from "node:fs";
import path from "node:path";

const { storageMock, storeMock } = vi.hoisted(() => ({
  storageMock: { getMediaAsset: vi.fn(), getMediaAssetByStorageKey: vi.fn() },
  storeMock: { openRead: vi.fn() },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/media/media-store", () => ({ mediaStore: storeMock }));

import { registryMediaResolver } from "../server/scorm/builders/media-resolver";

const ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  storeMock.openRead.mockResolvedValue(Readable.from([Buffer.from("bytes")]));
});

describe("registryMediaResolver", () => {
  it("резолвит канонический адрес в байты и путь внутри пакета", async () => {
    storageMock.getMediaAsset.mockResolvedValue({
      id: ID,
      storageKey: `media/ab/cd/${"a".repeat(64)}.png`,
      mimeType: "image/png",
      originalName: "picture.png",
    });
    const resolved = await registryMediaResolver({ kind: "canonical", id: ID });
    expect(resolved).toEqual({ zipPath: `assets/media/${ID}.png`, buffer: Buffer.from("bytes") });
  });

  it("берёт расширение из MIME, когда исходное имя без него", async () => {
    storageMock.getMediaAsset.mockResolvedValue({
      id: ID,
      storageKey: "media/ab/cd/x",
      mimeType: "application/pdf",
      originalName: "памятка",
    });
    const resolved = await registryMediaResolver({ kind: "canonical", id: ID });
    expect(resolved?.zipPath).toBe(`assets/media/${ID}.pdf`);
  });

  it("возвращает null, когда актива нет в реестре", async () => {
    storageMock.getMediaAsset.mockResolvedValue(undefined);
    expect(await registryMediaResolver({ kind: "canonical", id: ID })).toBeNull();
  });

  it("легаси-адрес резолвится через storage key и сохраняет исторический путь в пакете", async () => {
    storageMock.getMediaAssetByStorageKey.mockResolvedValue({
      id: ID,
      storageKey: "media/track.mp3",
      mimeType: "audio/mpeg",
      originalName: "track.mp3",
    });
    const resolved = await registryMediaResolver({ kind: "legacy", storageKey: "media/track.mp3" });
    expect(resolved?.zipPath).toBe("assets/media/track.mp3");
  });

  it("расширение исходного имени сильнее MIME", async () => {
    storageMock.getMediaAsset.mockResolvedValue({
      id: ID,
      storageKey: "media/ab/cd/x",
      mimeType: "image/jpeg",
      originalName: "scan.PNG",
    });
    const resolved = await registryMediaResolver({ kind: "canonical", id: ID });
    expect(resolved?.zipPath).toBe(`assets/media/${ID}.png`);
  });

  it("возвращает null, когда актив в реестре есть, а байты пропали", async () => {
    storageMock.getMediaAsset.mockResolvedValue({
      id: ID,
      storageKey: "media/ab/cd/x.png",
      mimeType: "image/png",
      originalName: "picture.png",
    });
    storeMock.openRead.mockRejectedValue(new Error("ENOENT"));
    expect(await registryMediaResolver({ kind: "canonical", id: ID })).toBeNull();
  });

  it("легаси-адрес вне реестра дочитывается с диска", async () => {
    storageMock.getMediaAssetByStorageKey.mockResolvedValue(undefined);
    const name = `__resolver-probe-${process.pid}-${Date.now()}.bin`;
    const abs = path.resolve(process.cwd(), "uploads", "media", name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "legacy bytes");
    try {
      const resolved = await registryMediaResolver({ kind: "legacy", storageKey: `media/${name}` });
      expect(resolved).toEqual({ zipPath: `assets/media/${name}`, buffer: Buffer.from("legacy bytes") });
    } finally {
      fs.rmSync(abs, { force: true });
    }
  });

  it("запасное чтение не выпускает за корень uploads", async () => {
    storageMock.getMediaAssetByStorageKey.mockResolvedValue(undefined);
    const escaped = await registryMediaResolver({ kind: "legacy", storageKey: "media/../../package.json" });
    expect(escaped).toBeNull();
  });
});
