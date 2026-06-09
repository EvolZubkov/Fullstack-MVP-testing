/**
 * @module server/scorm/builders/shared-runtime
 *
 * Bundles the shared template runtime ({@link module:shared/template/runtime-entry})
 * into a browser IIFE for inclusion in the SCORM package (PRD-12 task 2-7). The
 * package then consumes the SAME `@shared` engines as the web host instead of a
 * drifting plain-JS port.
 *
 * Resolution: in production the bundle is pre-built by `script/build.ts` into
 * `dist/scorm/assets/shared-runtime.js` and read via {@link readAsset}; in dev
 * (no build step) it is bundled from the TS sources on demand and cached. esbuild
 * is imported dynamically so it never enters the production server's load path
 * (it is a devDependency).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAsset } from "../assets/read-asset";

const here = path.dirname(fileURLToPath(import.meta.url)); // .../server/scorm/builders

/** Global the bundle attaches the shared renderer to inside the package. */
export const SHARED_RUNTIME_GLOBAL = "TBTemplate";
/** Asset filename the production build writes / the runtime reads. */
export const SHARED_RUNTIME_FILENAME = "shared-runtime.js";

/** Absolute path to the bundle entry (resolved relative to this module). */
function entryPath(): string {
  return path.resolve(here, "..", "..", "..", "shared", "template", "runtime-entry.ts");
}

/** esbuild the shared template runtime into a self-contained browser IIFE. */
export async function buildSharedRuntimeBundle(): Promise<string> {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: [entryPath()],
    bundle: true,
    format: "iife",
    globalName: SHARED_RUNTIME_GLOBAL,
    platform: "browser",
    target: "es2018",
    write: false,
    legalComments: "none",
  });
  return result.outputFiles[0].text;
}

let _cache: string | null = null;

/**
 * The shared runtime bundle, cached per process. Prefers the pre-built asset
 * (production); falls back to bundling from sources (dev).
 */
export async function getSharedRuntimeBundle(): Promise<string> {
  if (_cache !== null) return _cache;
  try {
    _cache = readAsset(SHARED_RUNTIME_FILENAME);
    return _cache;
  } catch {
    // No pre-built asset (dev): bundle from the TS sources below.
  }
  if (process.env.VITEST) {
    // esbuild's TextEncoder/Uint8Array invariant fails under vitest's jsdom
    // environment. The bundle has its own node-env test
    // (tests/scorm-shared-bundle.test.ts), so skip it during the suite — package
    // generation tests don't execute the bundled JS.
    _cache = "";
    return _cache;
  }
  _cache = await buildSharedRuntimeBundle();
  return _cache;
}
