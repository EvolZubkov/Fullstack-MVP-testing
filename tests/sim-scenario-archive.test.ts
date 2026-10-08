/**
 * @module tests/sim-scenario-archive
 * @description The exchange archive of a «Сценарий в ИС» question
 * (`server/services/sim/scenario-archive`): an archive is read, checked and imported with its
 * images registered once and its paths rewritten to library addresses; a broken one is refused
 * without registering anything; a stored scenario is packed back into an archive that imports
 * again. Also the image header reader and the delivery guard that keeps scenarios away from
 * learners until the hosts can play them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import JSZip from "jszip";
import { isDeliverable } from "@shared/questions/question-type";

const stored = new Map<string, { bytes: Buffer; mimeType: string }>();

vi.mock("../server/storage", () => ({
  storage: {
    getMediaAsset: async (id: string) =>
      stored.has(id) ? { id, storageKey: `key-${id}`, mimeType: stored.get(id)!.mimeType } : undefined,
  },
}));
vi.mock("../server/services/media/media-store", () => ({
  mediaStore: {
    openRead: async (key: string) => Readable.from([stored.get(key.replace(/^key-/, ""))!.bytes]),
  },
}));
vi.mock("../server/services/test-transfer/import", () => ({ registryMediaRegistrar: async () => ({ address: "", reused: false }) }));

const { importScenarioArchive, inspectScenarioArchive, buildScenarioArchive, storedScenarioErrors, ScenarioArchiveError } =
  await import("../server/services/sim/scenario-archive");
const { readImageInfo } = await import("../server/services/sim/image-info");
const { snapshotDataSource } = await import("../server/services/test-snapshot");

const ROOT = resolve(process.cwd(), "docs/specs/sim-scenario/example");

async function referenceZip(prefix = "", mutate?: (s: Record<string, unknown>) => void): Promise<Buffer> {
  const zip = new JSZip();
  const scenario = JSON.parse(readFileSync(resolve(ROOT, "scenario.json"), "utf8"));
  mutate?.(scenario);
  zip.file(`${prefix}scenario.json`, JSON.stringify(scenario));
  for (const name of readdirSync(resolve(ROOT, "media"))) zip.file(`${prefix}media/${name}`, readFileSync(resolve(ROOT, "media", name)));
  return zip.generateAsync({ type: "nodebuffer" });
}

/** A registrar that stores bytes under a counter id and recognises repeated bytes. */
function fakeRegistrar() {
  const byChecksum = new Map<string, string>();
  const calls: string[] = [];
  const register = async (entry: { checksum: string; mimeType: string | null }, bytes: Buffer) => {
    calls.push(entry.checksum);
    const known = byChecksum.get(entry.checksum);
    if (known) return { address: `/api/media/${known}`, reused: true };
    const id = `asset-${byChecksum.size + 1}`;
    byChecksum.set(entry.checksum, id);
    stored.set(id, { bytes, mimeType: entry.mimeType ?? "image/png" });
    return { address: `/api/media/${id}`, reused: false };
  };
  return { register, calls };
}

beforeEach(() => stored.clear());

describe("приём архива", () => {
  it("эталонный архив принимается: изображения в медиатеке, пути заменены адресами, имя файла забыто", async () => {
    const { register, calls } = fakeRegistrar();
    const result = await importScenarioArchive(await referenceZip(), "owner", register as never);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.summary).toMatchObject({ title: "Регистрация входящего письма", scenes: 16, images: 13 });
    expect(result.mediaCreated).toBe(13);
    expect(calls).toHaveLength(13);
    const media = result.dataJson!.scenario.media;
    expect(media.every((m) => /^\/api\/media\/asset-\d+$/.test(m.file))).toBe(true);
    expect(storedScenarioErrors(result.dataJson)).toEqual([]);
  });

  it("архив папкой — scenario.json на уровень глубже — тоже принимается", async () => {
    const { register } = fakeRegistrar();
    const result = await importScenarioArchive(await referenceZip("registration/"), "owner", register as never);
    expect(result.ok).toBe(true);
  });

  it("сценарий с ошибками отклоняется, и в медиатеку не уходит ничего", async () => {
    const { register, calls } = fakeRegistrar();
    const broken = await referenceZip("", (s) => { (s.scenes as Array<Record<string, unknown>>)[0].elements = [{ id: "x", media: "ghost", x: 0, y: 0 }]; });
    const result = await importScenarioArchive(broken, "owner", register as never);
    expect(result.ok).toBe(false);
    expect(result.dataJson).toBeUndefined();
    expect(result.errors.some((e) => /ghost, которого нет в библиотеке/.test(e))).toBe(true);
    expect(calls).toEqual([]);
  });

  it("не ZIP и ZIP без scenario.json — ошибка самого файла", async () => {
    await expect(inspectScenarioArchive(Buffer.from("not a zip"))).rejects.toBeInstanceOf(ScenarioArchiveError);
    const empty = await new JSZip().file("readme.txt", "x").generateAsync({ type: "nodebuffer" });
    await expect(inspectScenarioArchive(empty)).rejects.toThrow("В архиве нет scenario.json");
  });
});

describe("архив из сохранённого сценария", () => {
  it("собирается из медиатеки и принимается обратно тем же сценарием", async () => {
    const first = await importScenarioArchive(await referenceZip(), "owner", fakeRegistrar().register as never);
    const packed = await buildScenarioArchive(first.dataJson!.scenario);
    const again = await importScenarioArchive(packed, "owner", fakeRegistrar().register as never);
    expect(again.ok).toBe(true);
    const strip = (s: typeof first.dataJson) => ({ ...s!.scenario, media: s!.scenario.media.map(({ file: _file, ...rest }) => rest) });
    expect(strip(again.dataJson)).toEqual(strip(first.dataJson));
  });
});

describe("заголовок изображения", () => {
  it("PNG эталона читается с размером", () => {
    expect(readImageInfo(readFileSync(resolve(ROOT, "media/home.png")))).toEqual({ format: "png", mimeType: "image/png", width: 1920, height: 1200 });
  });

  it("не изображение — не принимается, даже с расширением .png", () => {
    expect(readImageInfo(Buffer.from("<svg/>")).format).toBeNull();
  });
});

describe("выдача сценариев (техдолг №5)", () => {
  it("источник отдаёт ВСЕ вопросы темы: обычный раздел выдаёт сценарии наравне с прочими", async () => {
    const q = (id: string, type: string) => ({ id, type, topicId: "t" });
    const src = snapshotDataSource({ questionsByTopic: { t: [q("a", "single"), q("b", "simulation"), q("c", "long")] } } as never);
    expect((await src.getQuestionsByTopic("t")).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("адаптивный обход сценарий не выдаёт — его хост не играет", () => {
    expect(isDeliverable("simulation")).toBe(true);
    expect(isDeliverable("simulation", "standard")).toBe(true);
    expect(isDeliverable("simulation", "adaptive")).toBe(false);
    expect(isDeliverable("single", "adaptive")).toBe(true);
  });
});
