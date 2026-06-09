#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const result = spawnSync(
  process.execPath,
  [
    path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs"),
    path.resolve(__dirname, "create-admin.ts"),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);
