/**
 * @module features/tests/editor/__tests__/page-settings
 * @description PRD-22: page PROPERTIES in the structure editor's draft —
 * seeding declared defaults at creation and carrying settings across a variant
 * switch. Pure helpers, no React.
 */
import { describe, it, expect } from "vitest";
import {
  defaultSettingsFor,
  migrateSettings,
  type ContentTemplateVariant,
} from "../use-content-pages";

const gallery: ContentTemplateVariant = {
  key: "gallery.card",
  label: "Галерея: карточка",
  kind: "info",
  placeholders: [],
  settings: [
    { key: "sequenceId", type: "sequence", label: "Последовательность" },
    { key: "nextLabel", type: "text", label: "Подпись кнопки", default: "Далее" },
    { key: "backgroundImage", type: "image", label: "Фон" },
  ],
};

const plain: ContentTemplateVariant = {
  key: "info.text",
  label: "Информация",
  kind: "info",
  placeholders: [],
};

describe("defaultSettingsFor", () => {
  it("seeds declared defaults so the page behaves as the template promises", () => {
    expect(defaultSettingsFor(gallery)).toEqual({ nextLabel: "Далее" });
  });

  it("settings without a default stay unset — «пусто» is a valid state", () => {
    expect(defaultSettingsFor(gallery).sequenceId).toBeUndefined();
    expect(defaultSettingsFor(gallery).backgroundImage).toBeUndefined();
  });

  it("a variant without settings yields an empty object", () => {
    expect(defaultSettingsFor(plain)).toEqual({});
    expect(defaultSettingsFor(undefined)).toEqual({});
  });
});

describe("migrateSettings — variant switch", () => {
  it("keeps values of settings the new variant declares", () => {
    const next = migrateSettings({ sequenceId: "Галерея", nextLabel: "Начать" }, gallery);
    expect(next).toEqual({ sequenceId: "Галерея", nextLabel: "Начать" });
  });

  it("fills a declared setting from its default when the page had no value", () => {
    expect(migrateSettings({ sequenceId: "Галерея" }, gallery).nextLabel).toBe("Далее");
  });

  it("keeps the sequence identifier even when the new variant does not declare it (FR-29)", () => {
    const next = migrateSettings({ sequenceId: "Галерея", nextLabel: "Начать" }, plain);
    // The caption belonged to the old variant and is dropped; the identifier
    // survives, so switching back restores the page's place in the sequence.
    expect(next).toEqual({ sequenceId: "Галерея" });
  });

  it("drops values of settings neither variant declares", () => {
    expect(migrateSettings({ stale: "x" }, gallery)).toEqual({ nextLabel: "Далее" });
  });

  it("a page with no settings gets the new variant's defaults", () => {
    expect(migrateSettings(undefined, gallery)).toEqual({ nextLabel: "Далее" });
  });
});
