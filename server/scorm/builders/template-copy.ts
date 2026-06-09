/**
 * @module server/scorm/builders/template-copy
 * @description Utilities to copy built-in design template files into the SCORM ZIP.
 * The server copies the template directory as static files — it does not execute
 * template.js or render any HTML.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../../logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Recursively copies all files under `dir` into `files` map prefixed by `zipPrefix`. */
export function copyDirToFiles(dir: string, zipPrefix: string, files: Record<string, string | Buffer>): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const zipPath = `${zipPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      copyDirToFiles(fullPath, zipPath, files);
    } else {
      files[zipPath] = fs.readFileSync(fullPath);
    }
  }
}

/**
 * Adds all files from the selected design template directory into the files map
 * under the `template/` prefix. Falls back to "default" if the directory is missing.
 */
export function addTemplateFilesToZip(
  templateId: string,
  templatesRoot: string,
  files: Record<string, string | Buffer>,
): void {
  const templateDir = path.join(templatesRoot, templateId);

  if (!fs.existsSync(templateDir)) {
    logger.warn(`Template directory not found for "${templateId}", falling back to default`, "scorm-export");
    const defaultDir = path.join(templatesRoot, "default");
    if (fs.existsSync(defaultDir)) {
      copyDirToFiles(defaultDir, "template", files);
    }
    return;
  }

  copyDirToFiles(templateDir, "template", files);
}

/** Returns the resolved path to the built-in templates root directory. */
export function getTemplatesRootDir(): string {
  return path.resolve(__dirname, "..", "templates");
}
