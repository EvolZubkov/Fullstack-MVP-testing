/**
 * @module tests/template-package
 * @description Unit tests for the PRD-3 template ZIP read/extract/pack helpers:
 * the Zip-Slip guard, single-root stripping, and the extract -> export -> read
 * round trip.
 */
import { describe, it, expect, afterAll } from "vitest";
import fsp from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import {
  safeEntryPath,
  readZipEntries,
  writeTemplateFiles,
  buildTemplateExportZip,
  uploadedTemplatesDir,
  ZipSlipError,
} from "../server/services/template-package";

async function makeZip(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("safeEntryPath (Zip-Slip guard)", () => {
  it("returns null for directory entries", () => {
    expect(safeEntryPath("layouts/")).toBeNull();
    expect(safeEntryPath("/")).toBeNull();
  });

  it("normalises a nested file path", () => {
    expect(safeEntryPath("layouts\\question.html")).toBe("layouts/question.html");
    expect(safeEntryPath("./manifest.json")).toBe("manifest.json");
  });

  it("throws on a path escaping the root", () => {
    expect(() => safeEntryPath("../evil.txt")).toThrow(ZipSlipError);
    expect(() => safeEntryPath("a/../../evil.txt")).toThrow(ZipSlipError);
  });

  it("throws on an absolute path", () => {
    expect(() => safeEntryPath("/etc/passwd")).toThrow(ZipSlipError);
    expect(() => safeEntryPath("C:/Windows/x")).toThrow(ZipSlipError);
  });
});

describe("readZipEntries", () => {
  it("strips a single common top-level directory", async () => {
    const buf = await makeZip({
      "tpl/manifest.json": "{}",
      "tpl/layouts/question.html": "<div></div>",
    });
    const entries = await readZipEntries(buf);
    expect([...entries.keys()].sort()).toEqual(["layouts/question.html", "manifest.json"]);
  });

  it("keeps a root-level manifest as-is", async () => {
    const buf = await makeZip({ "manifest.json": "{}", "shell.html": "x" });
    const entries = await readZipEntries(buf);
    expect(entries.has("manifest.json")).toBe(true);
    expect(entries.has("shell.html")).toBe(true);
  });

  it("does not strip when files sit at the root alongside a folder", async () => {
    const buf = await makeZip({ "readme.txt": "x", "tpl/manifest.json": "{}" });
    const entries = await readZipEntries(buf);
    // No single common root, so nothing is stripped.
    expect(entries.has("tpl/manifest.json")).toBe(true);
  });
});

describe("extract -> write -> export -> read round trip", () => {
  const id = "zz-roundtrip-test";
  const root = path.join(uploadedTemplatesDir, id);

  afterAll(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it("preserves all entries through write + export", async () => {
    const src = {
      "manifest.json": JSON.stringify({ id }),
      "styles/base.css": "body{color:#000}",
      "layouts/question.html": "<div data-slot=\"question-interaction\"></div>",
    };
    const buf = await makeZip(src);

    const entries = await readZipEntries(buf);
    const writtenRoot = await writeTemplateFiles(id, entries);
    expect(writtenRoot).toBe(root);

    const zip = await buildTemplateExportZip(root);
    const reread = await readZipEntries(zip);

    expect([...reread.keys()].sort()).toEqual(
      ["layouts/question.html", "manifest.json", "styles/base.css"],
    );
    expect(reread.get("styles/base.css")!.toString("utf8")).toBe("body{color:#000}");
  });
});
