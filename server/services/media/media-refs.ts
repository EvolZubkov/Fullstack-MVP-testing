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

/** Recognises one value. Returns `null` for anything that is not a stored file. */
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

/** Walks an entity and returns every media reference it holds, in traversal order. */
export function collectMediaRefs(entity: unknown): FoundMediaRef[] {
  const found: FoundMediaRef[] = [];

  function visit(node: unknown, path: string): void {
    if (typeof node === "string") {
      const ref = parseMediaRef(node);
      if (ref) found.push({ field: path, ref });
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
