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
 * `mediaUrl` column. It must, however, STAND ON A BOUNDARY (see `ADDRESS_BOUNDARY`) — an
 * absolute URL to a foreign host that happens to end in the same path is not ours.
 *
 * Resolving a reference to bytes is NOT this module's job: it takes a `resolveRef` port, so it
 * stays a pure string walk — no database, no filesystem, and its tests need neither.
 *
 * An address that cannot be resolved — or that the recogniser refused, e.g. one walking out of
 * the media directory — is BLANKED rather than left in place. A package that carries an address
 * to the Skill'Ум server is not self-contained: inside an LMS that is a foreign origin with no
 * session, so the learner would meet a broken picture instead of an absent one. Every such loss
 * is reported through `missing`, because a loss nobody hears about is how this defect lived
 * unnoticed in the first place.
 */
import { nanoid } from "nanoid";
import { findMediaMatchesInText, type MediaRef } from "../../services/media/media-refs";
import type { ResolvedMedia } from "./media-resolver";

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

/** Resolves a reference to bytes, or `null` when nothing can be delivered. */
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

/** Cheap gate so the `trim()` copy below is not paid for every string in the tree. */
const LOOKS_LIKE_DATA_URL = /^\s*data:/i;
const DATA_URL = /^data:([^;]+);base64,(.+)$/i;

function parseDataUrl(input: string): { mime: string; buffer: Buffer } | null {
  if (!LOOKS_LIKE_DATA_URL.test(input)) return null;
  const m = DATA_URL.exec(input.trim());
  if (!m) return null;
  return { mime: m[1].toLowerCase(), buffer: Buffer.from(m[2], "base64") };
}

/**
 * What may stand immediately before an address for it to BE the address rather than the tail
 * of a longer one: the value's own start, a quote, whitespace, `=`, `(`, `,`, `;` or `>`.
 *
 * The recogniser deliberately errs towards finding too much, because for the usage index a
 * spurious find is harmless — it only keeps a file alive. Here the asymmetry is the OPPOSITE:
 * a spurious find is destructive. `https://cms.example.com/uploads/media/logo.png` is a form
 * the product supports (see `shared/report/report-assets`), and rewriting the path inside it
 * would both mangle the value and, worse, pull whatever local file happens to share that name
 * into the package. So the guard lives here, and the recogniser stays one for the whole system.
 */
const ADDRESS_BOUNDARY = `(?<![^"'\\s=(,;>])`;

/**
 * The address as it may actually be spelled in the string. The walker normalises `\` to `/`
 * before matching, so it can report an address the literal text does not contain; matching
 * either separator here keeps "found" and "replaced" the same set — otherwise a reference
 * would be reported as packed while the old address stayed in the data.
 *
 * A fresh regex per call on purpose: it is global, and `test()` would leave `lastIndex`
 * behind for the next caller.
 */
function addressPattern(address: string): RegExp {
  const escaped = address
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\//g, "[\\\\/]");
  return new RegExp(ADDRESS_BOUNDARY + escaped, "g");
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

    const resolved = await opts.resolveRef(ref);
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
      const ext = EXT_BY_MIME[parsed.mime] || "bin";
      const zipPath = `assets/media/${nanoid(10)}.${ext}`;
      assets[zipPath] = parsed.buffer;
      return zipPath;
    }

    const matches = findMediaMatchesInText(input);
    if (matches.length === 0) return input;
    // Longest address first: one legacy name can be a prefix of another
    // (`…/a.png` inside `…/a.png.bak`), and replacing the shorter one first would
    // corrupt the longer.
    const ordered = [...matches].sort((a, b) => b.address.length - a.address.length);

    let out = input;
    for (const match of ordered) {
      // Not standing on a boundary means this is somebody else's address (a host name in
      // front of it): it is not ours to touch, and it must not reach the resolver either.
      if (!addressPattern(match.address).test(out)) continue;

      let replacement = "";
      if (match.ref) {
        replacement = (await zipPathFor(match.address, match.ref)) ?? "";
      } else if (!decided.has(match.address)) {
        // Refused by the recogniser. The bytes are unreachable, but the address still has to
        // go: a package must carry no address back to the server. Reported once, like any
        // other decision about this address.
        missing.push(`refused media reference: ${match.address} (${match.reason})`);
        decided.set(match.address, null);
      }
      // Replacement as a function: a `$` in the path must stay a `$`, not a capture reference.
      out = out.replace(addressPattern(match.address), () => replacement);
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
