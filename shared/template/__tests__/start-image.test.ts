/**
 * @module shared/template/__tests__/start-image.test
 *
 * PRD-22 + PRD-7: the start screen's illustration is a property of the START PAGE
 * (the variant declares it in `settings[]`), with the test-wide branding param
 * `startImageUrl` as the backward-compatible fallback. Both hosts and both editor
 * previews resolve it HERE, so the picture the author uploads on the page is the
 * picture every surface shows.
 */
import { describe, it, expect } from "vitest";
import {
  mediaUrlOf,
  resolveStartImageUrl,
  startImageForVariant,
  variantDeclaresStartImage,
  START_IMAGE_KEY,
} from "../start-image";

const WITH_IMAGE = { key: "start.image-right", settings: [{ key: "image", type: "image" }] };
const WITHOUT_IMAGE = { key: "start.standard", settings: [] };

describe("variantDeclaresStartImage", () => {
  it("is true only for a variant that declares the image property", () => {
    expect(variantDeclaresStartImage(WITH_IMAGE)).toBe(true);
    expect(variantDeclaresStartImage(WITHOUT_IMAGE)).toBe(false);
    expect(variantDeclaresStartImage({ key: "x" })).toBe(false);
    expect(variantDeclaresStartImage(null)).toBe(false);
    // A property of another type under the same key is not an illustration.
    expect(variantDeclaresStartImage({ key: "x", settings: [{ key: "image", type: "text" }] })).toBe(false);
  });
});

describe("startImageForVariant — what a preview of a CANDIDATE variant shows", () => {
  const pageSettings = { [START_IMAGE_KEY]: "/uploads/media/page.png" };
  const branding = { startImageUrl: { url: "/uploads/media/brand.png" } };

  it("shows the page's picture for the variant that owns the property", () => {
    expect(startImageForVariant(WITH_IMAGE, pageSettings, branding)).toBe("/uploads/media/page.png");
  });

  it("never lends the page's picture to a variant without the property", () => {
    // Otherwise «Старт: стандартный» previewed exactly like «изображение справа»
    // and the picker looked frozen — the two options rendered the same screen.
    expect(startImageForVariant(WITHOUT_IMAGE, pageSettings, {})).toBe("");
  });

  it("shows nothing for a variant without the property — even with a branding image", () => {
    // The branding illustration used to paint EVERY start variant, so «стандартный»
    // and «изображение справа» previewed identically and the picker looked frozen.
    expect(startImageForVariant(WITHOUT_IMAGE, pageSettings, branding)).toBe("");
    expect(startImageForVariant(WITHOUT_IMAGE, {}, branding)).toBe("");
  });

  it("falls back to branding for the owning variant when the page has no picture", () => {
    expect(startImageForVariant(WITH_IMAGE, {}, branding)).toBe("/uploads/media/brand.png");
  });
});

describe("mediaUrlOf", () => {
  it("unwraps the media envelope a design param stores", () => {
    expect(mediaUrlOf({ url: "/uploads/media/a.png", name: "a.png" })).toBe("/uploads/media/a.png");
  });

  it("takes a bare string (legacy values and page properties)", () => {
    expect(mediaUrlOf("/uploads/media/b.png")).toBe("/uploads/media/b.png");
    expect(mediaUrlOf("  /uploads/media/c.png  ")).toBe("/uploads/media/c.png");
  });

  it("returns an empty string for anything unusable", () => {
    expect(mediaUrlOf(null)).toBe("");
    expect(mediaUrlOf(undefined)).toBe("");
    expect(mediaUrlOf({})).toBe("");
    expect(mediaUrlOf({ url: 42 })).toBe("");
    expect(mediaUrlOf(7)).toBe("");
  });
});

describe("resolveStartImageUrl", () => {
  it("prefers the start page's own property over the branding param", () => {
    const url = resolveStartImageUrl(
      { [START_IMAGE_KEY]: "/uploads/media/page.png" },
      { startImageUrl: { url: "/uploads/media/brand.png" } },
    );
    expect(url).toBe("/uploads/media/page.png");
  });

  it("falls back to the branding param when the page carries no picture", () => {
    expect(resolveStartImageUrl({}, { startImageUrl: { url: "/uploads/media/brand.png" } })).toBe(
      "/uploads/media/brand.png",
    );
    expect(resolveStartImageUrl(null, { startImageUrl: "/uploads/media/legacy.png" })).toBe(
      "/uploads/media/legacy.png",
    );
  });

  it("treats an empty page value as absent (not as «no illustration»)", () => {
    expect(resolveStartImageUrl({ [START_IMAGE_KEY]: "   " }, { startImageUrl: "/uploads/media/brand.png" })).toBe(
      "/uploads/media/brand.png",
    );
  });

  it("returns an empty string when neither source holds a picture", () => {
    expect(resolveStartImageUrl(null, null)).toBe("");
    expect(resolveStartImageUrl({}, {})).toBe("");
  });
});
