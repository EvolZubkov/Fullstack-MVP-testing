/**
 * @module server/services/sim/scenario-archive
 *
 * The exchange archive of a «Сценарий в ИС» question (`docs/specs/sim-scenario/exchange-format.md`):
 * reading an uploaded `.scenario.zip` into question content, and building one back from a saved
 * question.
 *
 * Import is two steps with one rule set. {@link inspectScenarioArchive} reads and checks the
 * archive and touches nothing. {@link importScenarioArchive} does the same and, only when there are
 * no errors, registers the images in the media library and rewrites `media/<name>` paths to their
 * library addresses — the form the question stores. The checks are `shared/sim/validate`, the same
 * the save route runs on stored content, so «accepted on upload» and «accepted on save» cannot
 * disagree.
 *
 * After import the file name is gone for good: the scenario is named by `meta.title`, and the
 * archive offered for download is assembled anew from what is stored.
 */
import crypto from "node:crypto";
import path from "node:path";
import JSZip from "jszip";
import type { Scenario } from "@shared/sim/contract";
import { summarizeScenario, validateScenario, type ArchiveImage, type ScenarioSummary } from "@shared/sim/validate";
import { storage } from "../../storage";
import { mediaStore } from "../media/media-store";
import { registryMediaRegistrar, type MediaRegistrar } from "../test-transfer/import";
import { readImageInfo } from "./image-info";

/** Largest archive accepted, bytes. */
export const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024;

/** The archive itself cannot be read: not a ZIP, or no `scenario.json` in it. */
export class ScenarioArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioArchiveError";
  }
}

/** What the author is told about an archive. */
export interface ScenarioInspection {
  /** No errors: the scenario can be saved. */
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Numbers of the scenario; `null` when it is too broken to count. */
  summary: ScenarioSummary | null;
  /** Total size of the images, bytes. */
  mediaBytes: number;
}

/** An accepted archive: the inspection plus the question content to store. */
export interface ScenarioImport extends ScenarioInspection {
  /** `dataJson` of the question; present only when `ok`. */
  dataJson?: { scenario: Scenario };
  mediaCreated: number;
  mediaReused: number;
}

interface ReadArchive {
  scenario: unknown;
  /** Images of the archive keyed by their path relative to the scenario root (`media/x.png`). */
  images: Map<string, { info: ArchiveImage; bytes: Buffer; mimeType: string | null }>;
}

/**
 * Open the archive and find the scenario in it.
 *
 * `scenario.json` is expected at the root. An archive made by zipping a FOLDER has it one level
 * down; that single wrapping folder is accepted too, since it is how authors usually pack.
 */
async function readArchive(buffer: Buffer): Promise<ReadArchive> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new ScenarioArchiveError("Файл не является ZIP-архивом");
  }

  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  let root = "";
  if (!zip.file("scenario.json")) {
    const nested = names.filter((name) => /^[^/]+\/scenario\.json$/.test(name));
    if (nested.length !== 1) throw new ScenarioArchiveError("В архиве нет scenario.json");
    root = nested[0].slice(0, -"scenario.json".length);
  }

  let scenario: unknown;
  try {
    scenario = JSON.parse(await zip.file(`${root}scenario.json`)!.async("string"));
  } catch {
    throw new ScenarioArchiveError("scenario.json — не JSON");
  }

  const images: ReadArchive["images"] = new Map();
  for (const name of names) {
    if (!name.startsWith(`${root}media/`)) continue;
    const relative = name.slice(root.length);
    const bytes = await zip.file(name)!.async("nodebuffer");
    const info = readImageInfo(bytes);
    images.set(relative, {
      bytes,
      mimeType: info.mimeType,
      info: { path: relative, byteSize: bytes.length, format: info.format, width: info.width, height: info.height },
    });
  }
  return { scenario, images };
}

function inspect(read: ReadArchive): ScenarioInspection {
  const files = new Map([...read.images].map(([p, image]) => [p, image.info]));
  const { errors, warnings } = validateScenario(read.scenario, { mode: "archive", files });
  const mediaBytes = [...read.images.values()].reduce((n, image) => n + image.info.byteSize, 0);
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: errors.length === 0 ? summarizeScenario(read.scenario as Scenario) : null,
    mediaBytes,
  };
}

/**
 * Read and check an archive without storing anything.
 *
 * @throws ScenarioArchiveError when the file is not a ZIP or has no readable `scenario.json`.
 */
export async function inspectScenarioArchive(buffer: Buffer): Promise<ScenarioInspection> {
  return inspect(await readArchive(buffer));
}

/**
 * Read, check and — when the scenario is valid — import an archive.
 *
 * Images go to the media library of `ownerId`; an image the owner already has (same bytes) is
 * reused, not copied. Nothing is registered when the scenario has errors.
 *
 * @throws ScenarioArchiveError when the file is not a ZIP or has no readable `scenario.json`.
 */
export async function importScenarioArchive(
  buffer: Buffer,
  ownerId: string,
  registerMedia: MediaRegistrar = registryMediaRegistrar,
): Promise<ScenarioImport> {
  const read = await readArchive(buffer);
  const verdict = inspect(read);
  if (!verdict.ok) return { ...verdict, mediaCreated: 0, mediaReused: 0 };

  const scenario = structuredClone(read.scenario) as Scenario;
  const addresses = new Map<string, string>();
  let mediaCreated = 0;
  let mediaReused = 0;
  for (const item of scenario.media) {
    let address = addresses.get(item.file);
    if (!address) {
      const image = read.images.get(item.file)!;
      const registered = await registerMedia(
        {
          address: item.file,
          path: item.file,
          checksum: crypto.createHash("sha256").update(image.bytes).digest("hex"),
          mimeType: image.mimeType,
          originalName: path.posix.basename(item.file),
        },
        image.bytes,
        ownerId,
      );
      address = registered.address;
      addresses.set(item.file, address);
      if (registered.reused) mediaReused++;
      else mediaCreated++;
    }
    item.file = address;
  }

  return { ...verdict, dataJson: { scenario }, mediaCreated, mediaReused };
}

/**
 * Check scenario content as a question stores it.
 *
 * @returns The errors; empty when the content is a valid stored scenario.
 */
export function storedScenarioErrors(dataJson: unknown): string[] {
  const scenario = dataJson && typeof dataJson === "object" ? (dataJson as { scenario?: unknown }).scenario : undefined;
  if (scenario === undefined) return ["Сценарий не загружен"];
  return validateScenario(scenario, { mode: "stored" }).errors;
}

/** Extension of an archive image by its MIME type. */
function extensionOf(mimeType: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  return ".png";
}

/** Turn a title into a safe archive file name. */
export function archiveFileName(title: string): string {
  const base = title.trim().replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").slice(0, 80).trim();
  return `${base || "scenario"}.scenario.zip`;
}

/**
 * Build an exchange archive from a stored scenario.
 *
 * Library addresses become `media/<id><ext>` again, so the archive imports back into this or any
 * other installation.
 *
 * @throws Error when a referenced image is missing from the library.
 */
export async function buildScenarioArchive(scenario: Scenario): Promise<Buffer> {
  const zip = new JSZip();
  const copy = structuredClone(scenario);
  const paths = new Map<string, string>();
  for (const item of copy.media) {
    let target = paths.get(item.file);
    if (!target) {
      const id = item.file.replace(/^\/api\/media\//, "");
      const asset = await storage.getMediaAsset(id);
      if (!asset) throw new Error(`Изображения ${item.id} нет в медиатеке`);
      const stream = await mediaStore.openRead(asset.storageKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stream as AsyncIterable<Buffer | string>) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      target = `media/${item.id}${extensionOf(asset.mimeType)}`;
      zip.file(target, Buffer.concat(chunks));
      paths.set(item.file, target);
    }
    item.file = target;
  }
  zip.file("scenario.json", JSON.stringify(copy, null, 2));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
