/**
 * @module shared/template/__tests__/router-card-images
 *
 * The card-pictures rule of the router hub: the stored map is keyed by canonical item key,
 * a picture belongs to the variant that declares the property, and a key whose item left the
 * test is dropped.
 */
import { describe, expect, it } from "vitest";
import {
  CARD_IMAGES_SETTING_KEY,
  cardImageFor,
  cardImagesForVariant,
  normalizeCardImageEntries,
  parseCardImages,
  pruneCardImageEntries,
  variantDeclaresCardImages,
} from "../router-card-images";

const WITH_IMAGES = {
  key: "router.menu-images",
  settings: [{ key: CARD_IMAGES_SETTING_KEY, type: "itemImages" }],
};
const WITHOUT_IMAGES = { key: "router.menu" };

describe("parseCardImages", () => {
  it("brings keys to the canonical form and envelopes to plain addresses", () => {
    expect(
      parseCardImages({
        "t-1": "/api/media/a",
        "topic:t-2": { url: "/api/media/b", name: "b.png" },
        "scenario:s-1": "/api/media/c",
      }),
    ).toEqual({
      "topic:t-1": "/api/media/a",
      "topic:t-2": "/api/media/b",
      "scenario:s-1": "/api/media/c",
    });
  });

  it("drops empty addresses and foreign shapes", () => {
    expect(parseCardImages({ "topic:t-1": "", "topic:t-2": { name: "x.png" }, "topic:t-3": 7 })).toEqual({});
    expect(parseCardImages(null)).toEqual({});
    expect(parseCardImages(["/api/media/a"])).toEqual({});
    expect(parseCardImages("/api/media/a")).toEqual({});
  });
});

describe("cardImageFor", () => {
  const images = { "topic:t-1": "/api/media/a", "scenario:s-1": "/api/media/c" };

  it("finds a topic by its bare id — the key a delivered section carries", () => {
    expect(cardImageFor(images, "t-1")).toBe("/api/media/a");
    expect(cardImageFor(images, "topic:t-1")).toBe("/api/media/a");
  });

  it("finds a scenario item by its prefixed key", () => {
    expect(cardImageFor(images, "scenario:s-1")).toBe("/api/media/c");
  });

  it("answers an item without a picture with an empty string", () => {
    expect(cardImageFor(images, "t-9")).toBe("");
    expect(cardImageFor(null, "t-1")).toBe("");
  });
});

describe("normalizeCardImageEntries / pruneCardImageEntries", () => {
  it("keeps the file name next to the address and nothing else", () => {
    expect(
      normalizeCardImageEntries({
        "t-1": { url: "/api/media/a", name: " a.png ", size: 10 },
        "scenario:s-1": "/api/media/c",
      }),
    ).toEqual({
      "topic:t-1": { url: "/api/media/a", name: "a.png" },
      "scenario:s-1": { url: "/api/media/c" },
    });
  });

  it("drops the pictures of items that are no longer in the test", () => {
    const stored = {
      "topic:t-1": { url: "/api/media/a", name: "a.png" },
      "topic:t-2": { url: "/api/media/b" },
      "scenario:s-1": { url: "/api/media/c" },
    };
    expect(pruneCardImageEntries(stored, ["t-1", "scenario:s-1"])).toEqual({
      "topic:t-1": { url: "/api/media/a", name: "a.png" },
      "scenario:s-1": { url: "/api/media/c" },
    });
    expect(pruneCardImageEntries(stored, [])).toEqual({});
  });
});

describe("cardImagesForVariant", () => {
  const settings = { [CARD_IMAGES_SETTING_KEY]: { "topic:t-1": { url: "/api/media/a", name: "a.png" } } };

  it("shows the pictures through a variant that declares the property", () => {
    expect(variantDeclaresCardImages(WITH_IMAGES)).toBe(true);
    expect(cardImagesForVariant(WITH_IMAGES, settings)).toEqual({ "topic:t-1": "/api/media/a" });
  });

  it("shows none through a variant without the property, whatever the page holds", () => {
    expect(variantDeclaresCardImages(WITHOUT_IMAGES)).toBe(false);
    expect(cardImagesForVariant(WITHOUT_IMAGES, settings)).toEqual({});
    expect(cardImagesForVariant(null, settings)).toEqual({});
  });

  it("does not take a property of the same key but another type", () => {
    const lookalike = { settings: [{ key: CARD_IMAGES_SETTING_KEY, type: "image" }] };
    expect(cardImagesForVariant(lookalike, settings)).toEqual({});
  });

  it("is empty when the page has no pictures yet", () => {
    expect(cardImagesForVariant(WITH_IMAGES, {})).toEqual({});
    expect(cardImagesForVariant(WITH_IMAGES, null)).toEqual({});
  });
});
