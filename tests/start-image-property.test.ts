/**
 * @module tests/start-image-property
 *
 * PRD-22: the illustration of the start screen belongs to the START PAGE — the
 * variant that shows it (`start.image-right`) declares it as a page PROPERTY, so
 * the author uploads it in «Структура», on the page whose variant they picked. The
 * test-wide branding param `startImageUrl` fills that property in when the page has
 * no picture of its own (tests configured before the property existed).
 *
 * A variant that does NOT declare the property shows no illustration at all: while
 * the branding param painted every start variant, «Старт: стандартный» rendered the
 * same screen as «Старт: изображение справа» and the variant picker looked frozen.
 *
 * Pinned here:
 *   1. both shipped templates declare the property (without it the editor has no
 *      field to render — the page form comes ONLY from the manifest, FR-04);
 *   2. the SCORM runtime resolves the picture through the shared rule.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { startImageForVariant } from "../shared/template/start-image";

const manifestOf = (rel: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), rel), "utf8")) as {
    contentTemplates?: Array<{
      key?: string;
      settings?: Array<{ key?: string; type?: string; label?: string }>;
    }>;
  };

const startPageSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/render/startPage.js"),
  "utf8",
);

/** Extract the plain-JS `resolveStartImage` and run it with injected globals. */
function makeResolver(testData: unknown, tbTemplate: unknown, manifest?: unknown): (params: unknown) => string {
  const match = startPageSrc.match(/function resolveStartImage\([\s\S]*?\n\}/);
  if (!match) throw new Error("resolveStartImage not found in startPage.js");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    "TEST_DATA",
    "window",
    "state",
    `${match[0]}\n;return resolveStartImage;`,
  )(testData, { TBTemplate: tbTemplate }, { templateManifest: manifest ?? {} }) as (params: unknown) => string;
}

describe("templates declare the start illustration as a page property", () => {
  for (const rel of [
    "server/scorm/templates/default/manifest.json",
    "templates/certification/manifest.json",
  ]) {
    it(`${rel}: start.image-right offers an image property`, () => {
      const variant = (manifestOf(rel).contentTemplates ?? []).find((c) => c.key === "start.image-right");
      expect(variant, "the variant must exist").toBeTruthy();
      const setting = (variant!.settings ?? []).find((s) => s.key === "image");
      expect(setting, "the illustration must be declared, or the editor shows no field").toBeTruthy();
      expect(setting!.type).toBe("image");
      expect(setting!.label).toBeTruthy();
    });

    it(`${rel}: the standard start variant declares no illustration`, () => {
      const variant = (manifestOf(rel).contentTemplates ?? []).find((c) => c.key === "start.standard");
      expect((variant?.settings ?? []).some((s) => s.key === "image")).toBe(false);
    });
  }
});

describe("SCORM runtime resolves the start illustration", () => {
  // The REAL shared helper the package bundles as TBTemplate.
  const TB = { startImageForVariant };
  // The runtime reads the variant declaration from the bundled manifest.
  const manifest = {
    contentTemplates: [
      { key: "start.image-right", settings: [{ key: "image", type: "image" }] },
      { key: "start.standard", settings: [] },
    ],
  };
  const testData = (settings: unknown, templateKey = "start.image-right") => ({
    contentPages: [{ kind: "start", templateKey, settings }],
  });
  const branding = { startImageUrl: { url: "/uploads/media/brand.png" } };

  it("prefers the start page's own picture", () => {
    const resolver = makeResolver(testData({ image: "/uploads/media/page.png" }), TB, manifest);
    expect(resolver(branding)).toBe("/uploads/media/page.png");
  });

  it("falls back to the branding param when the page has none", () => {
    const resolver = makeResolver(testData({}), TB, manifest);
    expect(resolver(branding)).toBe("/uploads/media/brand.png");
  });

  it("shows no illustration on a variant that does not declare one", () => {
    const resolver = makeResolver(testData({ image: "/uploads/media/page.png" }, "start.standard"), TB, manifest);
    expect(resolver(branding)).toBe("");
  });

  it("degrades to the branding param when the bundle predates the shared helper", () => {
    // An older package: `TBTemplate.startImageForVariant` is absent, and the start
    // screen must still show the branding illustration instead of throwing.
    const resolver = makeResolver(testData({ image: "/uploads/media/page.png" }), {}, manifest);
    expect(resolver({ startImageUrl: "/uploads/media/brand.png" })).toBe("/uploads/media/brand.png");
    expect(resolver({})).toBe("");
  });

  it("tolerates a test with no start page at all", () => {
    const resolver = makeResolver({ contentPages: [] }, TB, manifest);
    expect(resolver(branding)).toBe("");
  });
});
