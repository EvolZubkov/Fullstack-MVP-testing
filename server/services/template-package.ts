/**
 * @module server/services/template-package
 * @description ZIP read/extract/pack helpers for the PRD-3 template lifecycle.
 *
 * The server never executes template HTML/JS (PRD-3 NFR-02): it only reads a ZIP
 * into an in-memory entry map for structural validation, persists the entries to
 * the uploaded-templates store after validation passes, and repacks a template
 * directory into a downloadable ZIP for export.
 *
 * All path handling is hardened against Zip-Slip: archive entry names are
 * normalised and any entry that escapes its root (via `..` or an absolute path)
 * is rejected rather than written.
 */
import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { buildZip } from "../scorm/zip";

/** Root directory for extracted uploaded template packages. */
export const uploadedTemplatesDir = path.resolve(process.cwd(), "uploads", "templates");

/** A flat map of POSIX-style relative entry paths to their raw bytes. */
export type TemplateEntries = Map<string, Buffer>;

/** Thrown when an archive entry name would escape the extraction root. */
export class ZipSlipError extends Error {
  constructor(public readonly entryName: string) {
    super(`Unsafe archive entry path: ${entryName}`);
    this.name = "ZipSlipError";
  }
}

/**
 * Normalises a ZIP entry name to a safe POSIX-style relative path.
 * Returns `null` for directory markers (trailing slash) that carry no bytes.
 * Throws {@link ZipSlipError} for absolute paths or paths escaping the root.
 * Exported for direct unit testing of the Zip-Slip guard.
 */
export function safeEntryPath(name: string): string | null {
  const posix = name.replace(/\\/g, "/");
  if (posix.endsWith("/")) return null; // directory entry
  // Reject absolute paths (POSIX or Windows drive) outright.
  if (posix.startsWith("/") || /^[a-zA-Z]:/.test(posix)) throw new ZipSlipError(name);
  const normalized = path.posix.normalize(posix);
  if (normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/")) {
    throw new ZipSlipError(name);
  }
  return normalized;
}

/**
 * If every entry sits under a single common top-level directory (the
 * `template-id/...` layout recommended by spec-template-platform §4), strip that
 * prefix so the entry map is rooted at `manifest.json`. A package already rooted
 * at `manifest.json` is returned unchanged.
 */
function stripCommonRoot(entries: TemplateEntries): TemplateEntries {
  if (entries.has("manifest.json")) return entries;
  const tops = new Set<string>();
  for (const key of entries.keys()) {
    const slash = key.indexOf("/");
    if (slash < 0) {
      tops.add(""); // a file at the root with no leading dir — cannot strip
      break;
    }
    tops.add(key.slice(0, slash));
  }
  if (tops.size !== 1 || tops.has("")) return entries;
  const prefix = `${[...tops][0]}/`;
  const stripped: TemplateEntries = new Map();
  for (const [key, val] of entries) stripped.set(key.slice(prefix.length), val);
  return stripped;
}

/**
 * Reads a ZIP buffer into a normalised entry map. Rejects Zip-Slip entries.
 * The map is rooted at `manifest.json` when the archive wraps content in a
 * single top-level directory.
 */
export async function readZipEntries(buffer: Buffer): Promise<TemplateEntries> {
  const zip = await JSZip.loadAsync(buffer);
  const entries: TemplateEntries = new Map();
  const files = Object.values(zip.files);
  for (const file of files) {
    const rel = safeEntryPath(file.name);
    if (rel === null) continue;
    const content = await file.async("nodebuffer");
    entries.set(rel, content);
  }
  return stripCommonRoot(entries);
}

/**
 * Persists a validated entry map under `uploads/templates/<id>/`, replacing any
 * previous extraction for that id. Returns the absolute root directory.
 */
export async function writeTemplateFiles(id: string, entries: TemplateEntries): Promise<string> {
  const root = path.join(uploadedTemplatesDir, id);
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.mkdir(root, { recursive: true });
  for (const [rel, content] of entries) {
    const target = path.join(root, rel);
    // Defence in depth: re-check containment after joining to the real root.
    const resolved = path.resolve(target);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new ZipSlipError(rel);
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, content);
  }
  return root;
}

/** Recursively collects every file under `dir` as POSIX-relative paths. */
async function collectFiles(dir: string, base = dir): Promise<Record<string, Buffer>> {
  const out: Record<string, Buffer> = {};
  const dirents = await fsp.readdir(dir, { withFileTypes: true });
  for (const ent of dirents) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      Object.assign(out, await collectFiles(full, base));
    } else if (ent.isFile()) {
      const rel = path.relative(base, full).split(path.sep).join("/");
      out[rel] = await fsp.readFile(full);
    }
  }
  return out;
}

/**
 * Reads a template root directory into an entry map for re-validation
 * (PRD-3 `POST /:id/validate`), mirroring {@link readZipEntries}.
 */
export async function readDirEntries(rootDir: string): Promise<TemplateEntries> {
  const files = await collectFiles(rootDir);
  const entries: TemplateEntries = new Map();
  for (const [rel, buf] of Object.entries(files)) entries.set(rel, buf);
  return entries;
}

/** The render files a host needs to preview a template's screens client-side. */
export interface TemplateBundle {
  /** Parsed `manifest.json` (params, contentTemplates, layouts, preview.routes). */
  manifest: Record<string, unknown>;
  /** Parsed `preview.demoData` dataset, or null when the template declares none. */
  demo: unknown | null;
  /**
   * Inner layout HTML keyed by BOTH `manifest.layouts` key and
   * `contentTemplates[].layoutFile` path (the `shell` is skipped) — the two ways a
   * screen names its layout (spec §8.2). One map serves both lookups.
   */
  layouts: Record<string, string>;
  /** Concatenated `manifest.assets.styles` (theme + base), the unified host CSS. */
  css: string;
}

/**
 * Reads a template DIRECTORY into the {@link TemplateBundle} the unified renderer
 * needs (manifest + demo + per-screen layouts + css). Files are read, never
 * executed (NFR-02). Shared by every author-facing preview endpoint so there is
 * ONE bundle reader — no per-host copy. `sourceDir` is resolved by the caller via
 * {@link module:server/services/template-dir} (built-in or uploaded path).
 */
export async function readTemplateBundle(sourceDir: string): Promise<TemplateBundle> {
  const entries = await readDirEntries(sourceDir);
  const read = (rel: string): string | undefined => entries.get(rel)?.toString("utf8");

  const manifestRaw = read("manifest.json");
  const manifest = (manifestRaw ? JSON.parse(manifestRaw) : {}) as Record<string, unknown>;
  const m = manifest as {
    layouts?: Record<string, string>;
    contentTemplates?: Array<{ layoutFile?: string }>;
    assets?: { styles?: string[] };
    preview?: { demoData?: string };
  };

  // Every declared layout, INCLUDING the shell. No screen ever resolves to the
  // `shell` key (resolveLayoutKey returns route keys / layoutFile paths), but the
  // hosts need the shell itself to mount a fixed-stage template (manifest
  // `mountShell`): without it a template whose CSS is scoped to its stage
  // (`.tb-frame > .tb-stage > #app.tb-pad`) previews unscoped — nothing like its
  // real design.
  const layouts: Record<string, string> = {};
  for (const [key, rel] of Object.entries(m.layouts ?? {})) {
    const html = read(rel);
    if (html != null) layouts[key] = html;
  }
  // Variant-backed screens name their layout by `contentTemplates[].layoutFile`
  // (spec §8.2), so the map is keyed by that path too — the resolver
  // (`preview-context.resolveLayoutKey`) returns whichever the screen declares.
  for (const ct of m.contentTemplates ?? []) {
    const rel = ct?.layoutFile;
    if (!rel || layouts[rel] != null) continue;
    const html = read(rel);
    if (html != null) layouts[rel] = html;
  }

  let demo: unknown = null;
  const demoRel = m.preview?.demoData;
  if (demoRel) {
    const raw = read(demoRel);
    if (raw != null) {
      try {
        demo = JSON.parse(raw);
      } catch {
        demo = null;
      }
    }
  }

  const css = (m.assets?.styles ?? [])
    .map((rel) => read(rel))
    .filter((s): s is string => s != null)
    .join("\n");

  return { manifest, demo, layouts, css };
}

/**
 * Packs a template root directory into a ZIP buffer for export (PRD-3 §7
 * `GET /export`). Works for both built-in and uploaded template directories.
 */
export async function buildTemplateExportZip(rootDir: string): Promise<Buffer> {
  if (!fs.existsSync(rootDir)) {
    throw new Error(`Template directory not found: ${rootDir}`);
  }
  const files = await collectFiles(rootDir);
  return buildZip(files);
}
