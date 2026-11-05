/**
 * @module tests/sim-example-v2
 * @description The example of the exchange format is version 2 and passes the archive checks
 * clean, as its version 1 copy did.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { validateScenario, type ArchiveImage } from "@shared/sim/validate";

const ROOT = resolve(process.cwd(), "docs/specs/sim-scenario/example");

describe("пример формата обмена", () => {
  it("версия 2, проверка архива без ошибок и предупреждений", () => {
    const scenario = JSON.parse(readFileSync(resolve(ROOT, "scenario.json"), "utf8"));
    expect(scenario.version).toBe(2);
    const files = new Map<string, ArchiveImage>();
    for (const name of readdirSync(resolve(ROOT, "media"))) {
      const bytes = readFileSync(resolve(ROOT, "media", name));
      files.set(`media/${name}`, { path: `media/${name}`, byteSize: statSync(resolve(ROOT, "media", name)).size, format: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
    }
    expect(validateScenario(scenario, { mode: "archive", files })).toEqual({ errors: [], warnings: [] });
  });
});
