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
 * One address the walker matched, accepted or refused.
 *
 * The refused ones are reported rather than swallowed because the two consumers need
 * opposite things from them: the usage index may ignore an address it will never serve,
 * while the SCORM packer must still WIPE it — an address that leaves the package pointing
 * at the Skill'Ум server is exactly the failure the packer exists to prevent, and a refusal
 * nobody hears about is a silent one.
 */
export interface MediaTextMatch {
  /** The address as it denotes the file, separators normalised to `/`. */
  address: string;
  /** The reference, or `null` when the address was refused. */
  ref: MediaRef | null;
  /** Human-readable ground for the refusal; absent on an accepted match. */
  reason?: string;
}

/** The address that names a reference — the inverse of matching. */
function addressOf(ref: MediaRef): string {
  return ref.kind === "canonical" ? `/api/media/${ref.id}` : `/uploads/${ref.storageKey}`;
}

/**
 * Every distinct address inside one string, in order of appearance, refusals included.
 *
 * Deduplication is by address: the same file mentioned five times is one entry, which is
 * what both consumers want (one usage row, one file in the package).
 */
export function findMediaMatchesInText(value: string): MediaTextMatch[] {
  const out: MediaTextMatch[] = [];
  const seen = new Set<string>();
  for (const m of value.replace(/\\/g, "/").matchAll(MEDIA_IN_TEXT)) {
    const ref: MediaRef = m[1]
      ? { kind: "canonical", id: m[1] }
      : { kind: "legacy", storageKey: m[2].replace(TRAILING_PUNCTUATION, "") };
    const address = addressOf(ref);
    if (seen.has(address)) continue;
    seen.add(address);
    if (ref.kind === "legacy" && ref.storageKey.split("/").some((seg) => seg === "..")) {
      out.push({ address, ref: null, reason: "escapes the media directory" });
      continue;
    }
    out.push({ address, ref });
  }
  return out;
}

/** Every distinct reference inside one string, in order of appearance. */
export function findMediaRefsInText(value: string): MediaRef[] {
  const out: MediaRef[] = [];
  for (const match of findMediaMatchesInText(value)) {
    if (match.ref) out.push(match.ref);
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
