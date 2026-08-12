import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)); // .../server/scorm/assets

/**
 * Candidate locations of a packaged asset, dev first then the bundled server — the
 * same ladder {@link readAsset} walks, factored out so binary assets resolve identically.
 */
function assetCandidates(name: string): string[] {
  return [
    path.resolve(here, name),
    path.resolve(here, "..", "template", name),
    path.resolve(process.cwd(), "dist", "scorm", "assets", name),
    path.resolve(process.cwd(), "dist", "scorm", "template", name),
    path.resolve(process.cwd(), "scorm", "assets", name),
    path.resolve(process.cwd(), "scorm", "template", name),
  ];
}

/**
 * Read a BINARY packaged asset.
 *
 * Resolves through the same ladder as everything else the package ships, so production
 * works wherever SCORM export already does.
 *
 * @param name Asset path relative to `server/scorm/assets` (e.g. `media/logo-dark.png`).
 * @returns The file's bytes, or `null` when the deploy does not carry it.
 */
export function readBinaryAsset(name: string): Buffer | null {
  for (const p of assetCandidates(name)) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p);
    } catch {
      continue;
    }
  }
  return null;
}

export function readAsset(name: string): string {
  // 1) DEV: server/scorm/assets/<name>
  const devAssetsPath = path.resolve(here, name);
  if (fs.existsSync(devAssetsPath)) {
    return fs.readFileSync(devAssetsPath, "utf8");
  }

  // 1b) DEV: server/scorm/template/<name>
  const devTemplatePath = path.resolve(here, "..", "template", name);
  if (fs.existsSync(devTemplatePath)) {
    return fs.readFileSync(devTemplatePath, "utf8");
  }

  // 2) PROD: dist/scorm/assets/<name>
  const prodAssetsPath = path.resolve(process.cwd(), "dist", "scorm", "assets", name);
  if (fs.existsSync(prodAssetsPath)) {
    return fs.readFileSync(prodAssetsPath, "utf8");
  }

  // 2b) PROD: dist/scorm/template/<name>
  const prodTemplatePath = path.resolve(process.cwd(), "dist", "scorm", "template", name);
  if (fs.existsSync(prodTemplatePath)) {
    return fs.readFileSync(prodTemplatePath, "utf8");
  }

  // 3) fallback: scorm/assets/<name>
  const prodAltAssetsPath = path.resolve(process.cwd(), "scorm", "assets", name);
  if (fs.existsSync(prodAltAssetsPath)) {
    return fs.readFileSync(prodAltAssetsPath, "utf8");
  }

  // 3b) fallback: scorm/template/<name>
  const prodAltTemplatePath = path.resolve(process.cwd(), "scorm", "template", name);
  if (fs.existsSync(prodAltTemplatePath)) {
    return fs.readFileSync(prodAltTemplatePath, "utf8");
  }

  throw new Error(
    `SCORM asset not found: ${name}. Tried: ` +
      `${devAssetsPath}, ${devTemplatePath}, ` +
      `${prodAssetsPath}, ${prodTemplatePath}, ` +
      `${prodAltAssetsPath}, ${prodAltTemplatePath}`
  );
}
