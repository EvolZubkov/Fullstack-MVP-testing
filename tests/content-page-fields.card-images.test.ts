/**
 * @module tests/content-page-fields.card-images
 * @description The `itemImages` page property (router hub card pictures) through the settings
 * normaliser every writer of a page goes through: canonical keys, `{url, name?}` entries,
 * nothing foreign, an empty map stored as «no value», and the value dropped by a variant that
 * does not declare it.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../server/db", () => ({ db: {} }));

import { normalizeSettingsForTemplate } from "../server/services/content-page-fields";

const DECLARED = [{ key: "cardImages", type: "itemImages", label: "Картинки карточек" }];

describe("normalizeSettingsForTemplate — itemImages", () => {
  it("stores canonical keys with the address and the file name only", () => {
    const out = normalizeSettingsForTemplate(
      {
        cardImages: {
          "t-1": { url: "/api/media/a", name: "a.png", size: 123 },
          "scenario:s-1": "/api/media/c",
        },
      },
      DECLARED as never,
    );
    expect(out).toEqual({
      cardImages: {
        "topic:t-1": { url: "/api/media/a", name: "a.png" },
        "scenario:s-1": { url: "/api/media/c" },
      },
    });
  });

  it("drops entries without an address and treats an empty map as no value", () => {
    expect(normalizeSettingsForTemplate({ cardImages: { "topic:t-1": { name: "x.png" } } }, DECLARED as never)).toEqual({});
    expect(normalizeSettingsForTemplate({ cardImages: {} }, DECLARED as never)).toEqual({});
    expect(normalizeSettingsForTemplate({ cardImages: "nonsense" }, DECLARED as never)).toEqual({});
  });

  it("does not keep the pictures for a variant that has no place for them", () => {
    const existing = { cardImages: { "topic:t-1": { url: "/api/media/a" } } };
    expect(normalizeSettingsForTemplate(undefined, [], existing)).toEqual({});
  });

  it("carries the pictures over to another variant that declares the same property", () => {
    const existing = { cardImages: { "topic:t-1": { url: "/api/media/a", name: "a.png" } } };
    expect(normalizeSettingsForTemplate(undefined, DECLARED as never, existing)).toEqual(existing);
  });
});
