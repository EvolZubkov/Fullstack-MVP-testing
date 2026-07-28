import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, mkdir, cp, writeFile } from "fs/promises";
import { buildSharedRuntimeBundle, SHARED_RUNTIME_FILENAME } from "../server/scorm/builders/shared-runtime";


// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
// Dependencies to bundle (reduces cold start syscalls)
// Note: archiver and bcryptjs excluded due to ESM/CJS interop issues
const allowlist = [
  "@google/generative-ai",
  // ESM-only wrapper: bundle it into the CJS output so the production build does
  // not `require()` an ES module at runtime. Its only runtime dependency, `pino`,
  // stays external (kept in node_modules) so pino's own runtime file resolution
  // is not disturbed by the bundler.
  "@vvlad1973/pino-logger-tree",
  // ESM-only config utilities (getConfig). Bundled so the CJS app does not
  // `require()` an ES module (Node 20 in the image cannot require ESM).
  "@vvlad1973/utils",
  "axios",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "pg",
  "stripe",
  "uuid",
  "zod",
];

// Force these to be external even if in allowlist (ESM/CJS issues).
// `pino` is a transitive dependency (pulled in by @vvlad1973/pino-logger-tree, not a
// direct dependency), so it is not part of the computed externals list. It must be
// pinned external explicitly: the wrapper is bundled, and esbuild would otherwise
// follow its `import 'pino'` and bundle pino too — breaking pino's runtime resolution
// of its own worker/transport internals. Kept external, pino resolves normally at runtime.
const forceExternal = ["archiver", "bcryptjs", "@vvlad1973/crypto", "pino"];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = [
    ...allDeps.filter((dep) => !allowlist.includes(dep)),
    ...forceExternal,
  ];

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    banner: {
      js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;",
    },
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.url": "__importMetaUrl",
      "import.meta.dirname": "__dirname",
    },
    minify: false,
    external: externals,
    logLevel: "info",
  });
  
  // Deploy-time data steps live next to the server bundle: the production image
  // is installed with `--omit=dev`, so there is no tsx to run a TS script, and a
  // hand-written JS twin would be a second copy of the text pipeline. Bundling
  // them with the same esbuild config means the migration runs the SAME code the
  // application does.
  console.log("building deploy scripts...");
  await esbuild({
    entryPoints: ["script/backfill-page-text.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/backfill-page-text.cjs",
    banner: {
      js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;",
    },
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.url": "__importMetaUrl",
      "import.meta.dirname": "__dirname",
    },
    minify: false,
    external: externals,
    logLevel: "info",
  });

  console.log("copying scorm assets...");
  await mkdir("dist/scorm/assets", { recursive: true });
  await cp("server/scorm/assets", "dist/scorm/assets", { recursive: true });

  console.log("copying scorm template...");
  await mkdir("dist/scorm/template", { recursive: true });
  await cp("server/scorm/template", "dist/scorm/template", { recursive: true });

  // PRD-18 in-service debug player: the browser RTE shim + inspector compute are
  // read at request time (server/scorm/debug-player/assets.ts). They live OUTSIDE
  // server/scorm/{assets,template}, so copy them explicitly or /debug/shim.js 404s
  // in the bundled server.
  console.log("copying debug-player assets...");
  await mkdir("dist/scorm/debug-player/assets", { recursive: true });
  await cp("server/scorm/debug-player/assets", "dist/scorm/debug-player/assets", { recursive: true });

  // PRD-12 (2-7): pre-bundle the shared template runtime so the production
  // exporter reads it as a static asset (no esbuild at request time in prod).
  console.log("bundling shared template runtime...");
  const sharedRuntime = await buildSharedRuntimeBundle();
  await writeFile(`dist/scorm/assets/${SHARED_RUNTIME_FILENAME}`, sharedRuntime, "utf8");

}


buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
