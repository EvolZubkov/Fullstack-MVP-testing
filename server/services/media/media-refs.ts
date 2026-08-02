/**
 * @module server/services/media/media-refs
 *
 * The single walker that finds media references inside a content entity. It is used by
 * BOTH the write-time usage index and the full re-sync — one implementation, because two
 * would drift, and they would drift silently in the direction of refusing access.
 *
 * Pure module: no database, no filesystem. Resolving a reference to a registry row is the
 * caller's job ({@link module:server/services/media/usage-index}).
 *
 * Two address shapes are recognised. The canonical `/api/media/<uuid>` is what content
 * stores from now on; the legacy `/uploads/media/<file>` is what pre-registry content
 * still holds and is resolved through the asset's storage key until it is rewritten.
 */

/** The canonical address: the asset id IS the address. */
const CANONICAL = /^\/api\/media\/([0-9a-fA-F-]{36})$/;
/** The pre-registry address served by the old static mount. */
const LEGACY = /^\/uploads\/(media\/[^?#]+)$/;

/** A recognised reference to a stored file. */
export type MediaRef =
  | { kind: "canonical"; id: string }
  | { kind: "legacy"; storageKey: string };

/** One reference together with where inside the entity it was found. */
export interface FoundMediaRef {
  /** Dotted path, e.g. `data.options.0.image`. */
  field: string;
  ref: MediaRef;
}

/**
 * Recognises one value AS A WHOLE — the entire trimmed string must be the address.
 * Returns `null` for anything that is not a stored file, including a string that merely
 * CONTAINS one (an `<img src="…">` inside markup): use {@link findMediaRefsInText} for
 * that case. The distinction matters for Задача 15's canonicalisation, where "the field
 * IS the address" (safe to replace outright) has to stay separate from "the address sits
 * inside markup" (replacing the whole value would corrupt it).
 */
export function parseMediaRef(value: unknown): MediaRef | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const canonical = CANONICAL.exec(raw);
  if (canonical) return { kind: "canonical", id: canonical[1] };
  const legacy = LEGACY.exec(raw.replace(/\\/g, "/"));
  if (legacy) return { kind: "legacy", storageKey: legacy[1] };
  return null;
}

/**
 * Both address shapes, ANYWHERE inside a string — an `<img src="…">` in a rich-text
 * field is as real a usage as a bare `mediaUrl` column, and content pages have an
 * `html` mode. One alternation, so matches come back in the order they appear.
 *
 * The errors here are asymmetric: a missed reference loses the file (orphan collection
 * would delete it and delivery would refuse it), while a spurious one only keeps a file
 * alive. So this errs towards finding too much, and does not try to parse markup.
 */
const MEDIA_IN_TEXT = /\/api\/media\/([0-9a-fA-F-]{36})|\/uploads\/(media\/[^\s"'<>?#\\]+)/g;

/** Trailing punctuation that belongs to the sentence, not to the file name. */
const TRAILING_PUNCTUATION = /[.,;:!)\]]+$/;

/**
 * What may stand immediately before an address for it to BE the address rather than the tail
 * of a longer one: the value's own start, a quote, whitespace, `=`, `(`, `,`, `;` or `>`.
 * Spelled as "nothing other than a boundary character precedes it", which is also true at
 * position 0 — so the start of the value needs no separate alternative.
 */
const ADDRESS_BOUNDARY = `(?<![^"'\\s=(,;>])`;

/**
 * The regular expression that finds one address IN TEXT for rewriting — the counterpart of
 * matching, and the only correct way to look an address up again.
 *
 * It differs from a plain substring search in two ways that both matter:
 *
 * - it requires the address to stand on a boundary, undoing this module's deliberate
 *   over-finding (see {@link findMediaAddressesInText}). `https://cms.example.com/uploads/media/logo.png`
 *   is an address to somebody else's host; rewriting the path inside it would mangle the value
 *   and could pull an unrelated local file of the same name into whatever is being built;
 * - it accepts either separator, because matching normalises `\` to `/` and can therefore
 *   report an address the literal text does not contain.
 *
 * A fresh regex per call on purpose: it is global, so `test()` would leave `lastIndex` behind
 * for the next caller.
 *
 * @param address - An address as reported by {@link findMediaAddressesInText}.
 */
export function mediaAddressPattern(address: string): RegExp {
  const escaped = address
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\//g, "[\\\\/]");
  return new RegExp(ADDRESS_BOUNDARY + escaped, "g");
}

/**
 * One address the walker matched: either accepted, and then it denotes a reference, or
 * refused, and then it carries the ground for the refusal. The two states are separate
 * shapes so that "refused without a ground" and "accepted with one" cannot be written.
 *
 * Refusals are reported rather than swallowed because the consumers need opposite things
 * from them: the usage index may ignore an address it will never serve, while the SCORM
 * packer must still WIPE it — an address that leaves the package pointing at the Skill'Ум
 * server is exactly the failure the packer exists to prevent, and a refusal nobody hears
 * about is a silent one.
 */
export type MediaAddressMatch =
  /** The address denotes a stored file. `address` is spelled with `/` separators. */
  | { status: "accepted"; address: string; ref: MediaRef }
  /** The address is not usable; `reason` says why, for a human reading a log. */
  | { status: "refused"; address: string; reason: string };

/** The address that names a reference — the inverse of matching. */
function addressOf(ref: MediaRef): string {
  return ref.kind === "canonical" ? `/api/media/${ref.id}` : `/uploads/${ref.storageKey}`;
}

/**
 * Every distinct address inside one string, in order of appearance, refusals included.
 *
 * Deduplication is by address: the same file mentioned five times is one entry, which is
 * what every consumer wants (one usage row, one file in the package).
 *
 * NOTE the asymmetry between the two ways of using the result. A consumer that only READS
 * the addresses takes them as they come — over-finding is safe for it, and this walker
 * deliberately over-finds. A consumer that REWRITES the text must not: an address found
 * inside `https://other.host/uploads/media/x.png` is not the value's own address. Such a
 * consumer must locate it again through {@link mediaAddressPattern}, never by plain
 * substring replacement.
 */
export function findMediaAddressesInText(value: string): MediaAddressMatch[] {
  const out: MediaAddressMatch[] = [];
  const seen = new Set<string>();
  // The copy is worth avoiding: this runs on every string of every entity, including whole
  // content pages, and a backslash in one is the rare case.
  const text = value.includes("\\") ? value.replace(/\\/g, "/") : value;
  for (const m of text.matchAll(MEDIA_IN_TEXT)) {
    const ref: MediaRef = m[1]
      ? { kind: "canonical", id: m[1] }
      : { kind: "legacy", storageKey: m[2].replace(TRAILING_PUNCTUATION, "") };
    const address = addressOf(ref);
    if (seen.has(address)) continue;
    seen.add(address);
    if (ref.kind === "legacy" && ref.storageKey.split("/").some((seg) => seg === "..")) {
      out.push({ status: "refused", address, reason: "escapes the media directory" });
      continue;
    }
    out.push({ status: "accepted", address, ref });
  }
  return out;
}

/** Every distinct reference inside one string, in order of appearance. */
export function findMediaRefsInText(value: string): MediaRef[] {
  const out: MediaRef[] = [];
  for (const match of findMediaAddressesInText(value)) {
    if (match.status === "accepted") out.push(match.ref);
  }
  return out;
}

/** Walks an entity and returns every media reference it holds, in traversal order. */
export function collectMediaRefs(entity: unknown): FoundMediaRef[] {
  const found: FoundMediaRef[] = [];

  function visit(node: unknown, path: string): void {
    if (typeof node === "string") {
      for (const ref of findMediaRefsInText(node)) found.push({ field: path, ref });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, path ? `${path}.${i}` : String(i)));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        visit(value, path ? `${path}.${key}` : key);
      }
    }
  }

  visit(entity, "");
  return found;
}

/**
 * Returns a copy of `entity` with every recognised media reference replaced by whatever
 * `mapping` returns for it. A `null` from the mapping leaves the value as it stands —
 * blanking an address that resolves to nothing would erase a picture the author still
 * sees, which is worse than carrying a stale string.
 */
export function rewriteMediaRefs(
  entity: unknown,
  mapping: (ref: MediaRef) => string | null,
): unknown {
  if (typeof entity === "string") {
    const ref = parseMediaRef(entity);
    if (!ref) return entity;
    return mapping(ref) ?? entity;
  }
  if (Array.isArray(entity)) return entity.map((item) => rewriteMediaRefs(item, mapping));
  if (entity && typeof entity === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entity as Record<string, unknown>)) {
      out[key] = rewriteMediaRefs(value, mapping);
    }
    return out;
  }
  return entity;
}
