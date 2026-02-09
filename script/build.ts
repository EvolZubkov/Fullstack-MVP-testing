import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, mkdir, cp } from "fs/promises";


// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
// Dependencies to bundle (reduces cold start syscalls)
// Note: archiver and bcryptjs excluded due to ESM/CJS interop issues
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
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
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
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

}


buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
