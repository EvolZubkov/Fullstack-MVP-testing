/**
 * @module server/scorm/builders/media-assets
 *
 * Makes the package self-contained: every address the content holds is replaced by a path
 * inside the ZIP, and the bytes travel with it.
 *
 * Three address shapes are handled — an inline `data:` URL, the canonical media-library
 * address `/api/media/<id>`, and the pre-registry `/uploads/media/<file>`. Recognition of the
 * latter two is delegated to `media-refs`, the same walker the usage index uses: two ideas of
 * "what a media address is" would drift, and the drift here is invisible until the package is
 * opened in a real LMS.
 *
 * The address is looked for INSIDE a string, not only when the whole value is one: content
 * pages carry markup with `<img src="…">`, and a picture inside markup is as real as a bare
 * `mediaUrl` column. It must, however, stand on a boundary — the recogniser's own
 * `mediaAddressPattern` decides that.
 *
 * What this module deliberately does NOT touch is an ABSOLUTE URL — including one pointing at
 * our own host. Such a value is a supported authoring form (see `shared/report/report-assets`),
 * it is indistinguishable here from a link to a third-party CDN, and reporting every one of
 * them would bury the real losses in noise. It travels into the package unchanged, and whether
 * the learner's LMS can reach it is the author's business, not the packer's.
 *
 * Resolving a reference to bytes is NOT this module's job: it takes a `resolveRef` port, so it
 * stays a pure string walk — no database, no filesystem, and its tests need neither.
 *
 * A RELATIVE address that cannot be resolved — the resolver returned nothing or threw, or the
 * recogniser refused the address as walking out of the media directory — is BLANKED rather than
 * left in place. A package that carries a relative address to the Skill'Ум server is not
 * self-contained: inside an LMS that is a foreign origin with no session, so the learner would
 * meet a broken picture instead of an absent one. Every such loss is reported through `missing`,
 * because a loss nobody hears about is how this defect lived unnoticed in the first place.
 */
import { nanoid } from "nanoid";
import {
  findMediaAddressesInText,
  mediaAddressPattern,
  type MediaRef,
} from "../../services/media/media-refs";
import { extensionForMime } from "../../services/media/media-mime";
import type { ResolvedMedia } from "./media-resolver";

/**
 * Resolves a reference to bytes, or `null` when nothing can be delivered.
 *
 * MAY throw: the packer treats a throw exactly as a `null` — the address is dropped and the
 * reason reported — so one unreachable file cannot fail a whole export. An implementation is
 * therefore free to let a storage error out instead of swallowing it.
 */
export type MediaRefResolver = (ref: MediaRef) => Promise<ResolvedMedia | null>;

/** What the packer needs from its host. */
export interface ExtractOptions {
  resolveRef: MediaRefResolver;
}

/** What the packer produces: the patched tree, the ZIP entries, and what was lost. */
export interface ExtractResult {
  testObj: any;
  assets: Record<string, Buffer>;
  missing: string[];
}

/** The whole value must be the `data:` URL; one inside markup already travels with the text. */
const DATA_URL = /^data:([^;]+);base64,(.+)$/i;

function parseDataUrl(input: string): { mime: string; buffer: Buffer } | null {
  const m = DATA_URL.exec(input.trim());
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], "base64") };
}

/**
 * Rewrites every media address inside `testObj` (IN PLACE) to a path inside the package and
 * returns the bytes to put there.
 *
 * @param testObj - The parsed `TEST_DATA` tree; mutated and returned as-is.
 * @param opts - The resolver port.
 * @returns The same `testObj`, the ZIP entries keyed by in-package path, and the addresses
 *   that could not be resolved (they have been blanked in the tree).
 */
export async function extractEmbeddedMediaIntoAssets(
  testObj: any,
  opts: ExtractOptions,
): Promise<ExtractResult> {
  const assets: Record<string, Buffer> = {};
  const missing: string[] = [];
  /** Decisions already taken, so one asset referenced ten times is resolved once. */
  const decided = new Map<string, string | null>();

  async function zipPathFor(address: string, ref: MediaRef): Promise<string | null> {
    const known = decided.get(address);
    if (known !== undefined) return known;

    // A resolver throw is a lost file, not a lost export: one deleted object must not cost the
    // author the whole package. The address is dropped and named, exactly as a `null` would be.
    let resolved: ResolvedMedia | null = null;
    try {
      resolved = await opts.resolveRef(ref);
    } catch (e) {
      missing.push(`failed media reference: ${address} (${(e as Error)?.message ?? e})`);
      decided.set(address, null);
      return null;
    }
    if (!resolved) {
      missing.push(`unresolved media reference: ${address}`);
      decided.set(address, null);
      return null;
    }
    assets[resolved.zipPath] = resolved.buffer;
    decided.set(address, resolved.zipPath);
    return resolved.zipPath;
  }

  /** Rewrites every reference inside one string; returns the new value. */
  async function packString(input: string): Promise<string> {
    const parsed = parseDataUrl(input);
    if (parsed) {
      const zipPath = `assets/media/${nanoid(10)}.${extensionForMime(parsed.mime) ?? "bin"}`;
      assets[zipPath] = parsed.buffer;
      return zipPath;
    }

    const matches = findMediaAddressesInText(input);
    if (matches.length === 0) return input;
    // Longest address first: one legacy name can be a prefix of another
    // (`…/a.png` inside `…/a.png.bak`), and replacing the shorter one first would
    // corrupt the longer.
    const ordered = [...matches].sort((a, b) => b.address.length - a.address.length);

    let out = input;
    for (const match of ordered) {
      // Not standing on a boundary means this is somebody else's address (a host name in
      // front of it): it is not ours to touch, and it must not reach the resolver either.
      if (!mediaAddressPattern(match.address).test(out)) continue;

      let replacement = "";
      if (match.status === "accepted") {
        replacement = (await zipPathFor(match.address, match.ref)) ?? "";
      } else if (!decided.has(match.address)) {
        // Refused by the recogniser. The bytes are unreachable, but the address still has to
        // go: a package must carry no address back to the server. Reported once, like any
        // other decision about this address.
        missing.push(`refused media reference: ${match.address} (${match.reason})`);
        decided.set(match.address, null);
      }
      // Replacement as a function: a `$` in the path must stay a `$`, not a capture reference.
      out = out.replace(mediaAddressPattern(match.address), () => replacement);
    }
    return out;
  }

  async function visit(node: any): Promise<void> {
    if (!node || typeof node !== "object") return;
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (value && typeof value === "object") {
        await visit(value);
      } else if (typeof value === "string") {
        const packed = await packString(value);
        if (packed !== value) node[key] = packed;
      }
    }
  }

  await visit(testObj);

  return { testObj, assets, missing };
}
