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

// Force these to be external even if in allowlist (ESM/CJS issues)
const forceExternal = ["archiver", "bcryptjs", "@vvlad1973/crypto"];

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
