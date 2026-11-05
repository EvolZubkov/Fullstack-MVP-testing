/**
 * @module shared/template/router-card-images
 *
 * Pictures of the router hub's cards — the ONE rule the editor, both learner hosts, the
 * previews, the package bake and the save path follow.
 *
 * A card picture is a DESIGN property of the hub, not a property of the test item (owner's
 * decision 2026-10-15): it lives in the settings of the router page, as the property
 * {@link CARD_IMAGES_SETTING_KEY} of type `itemImages` that the router variant declares in its
 * manifest. A template that has no place for pictures on its cards simply does not declare it,
 * and then no picture is shown and no field is offered.
 *
 * The value is a MAP «item key → picture address», keyed by the same item keys the unlock rules
 * and the item order use (`shared/test-items`): `topic:<topicId>` for a topic, `scenario:<id>`
 * for a scenario item. The topic key holds the id of the topic in the bank, so a picture
 * survives every re-save of the test (sections are re-created on save, topics are not), a
 * rename and a reorder.
 *
 * The map is only ever READ through the item list: a key whose item has left the test is never
 * drawn, and {@link pruneCardImageEntries} drops it on save and on bake so its file does not ride
 * into the package.
 *
 * Pure string processing — no DOM, no Node — so it is safe to bundle into the SCORM package
 * (`TBTemplate.cardImagesForVariant`).
 */
import { canonicalItemKey } from "../test-items";
import { mediaUrlOf } from "./start-image";

/** Key of the card-pictures property on a router variant. */
export const CARD_IMAGES_SETTING_KEY = "cardImages";

/** Field type of the card-pictures property (`shared/template/field-types`). */
export const CARD_IMAGES_SETTING_TYPE = "itemImages";

/** Card pictures: canonical item key → picture address. */
export type CardImages = Record<string, string>;

/** A router variant as the manifest declares it — only the properties are read. */
export interface CardImagesVariantDecl {
  settings?: Array<{ key?: string; type?: string } | null | undefined> | null;
}

/**
 * The stored value brought to a clean map: canonical keys, plain addresses, nothing empty.
 *
 * Accepts a picture both as a plain address (what the editor stores) and as the media envelope
 * `{ url, … }` (a value copied from a design parameter or typed into a workbook cell), the same
 * tolerance the start illustration has.
 */
export function parseCardImages(raw: unknown): CardImages {
  const out: CardImages = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== "string" || key.trim() === "") continue;
    const url = mediaUrlOf(value);
    if (url) out[canonicalItemKey(key.trim())] = url;
  }
  return out;
}

/** The picture of one item, or `""` when it has none. The item key may be bare or canonical. */
export function cardImageFor(images: CardImages | null | undefined, itemKey: string): string {
  if (!images) return "";
  return images[canonicalItemKey(itemKey)] ?? "";
}

/**
 * One picture as it is STORED: the address and, when the editor knew it, the uploaded file's
 * name — the editor shows the name in the item's caption, the hosts read only the address.
 */
export interface StoredCardImage {
  url: string;
  name?: string;
}

/**
 * The stored value brought to the shape that is saved: canonical keys, `{ url, name? }` entries,
 * nothing empty and no foreign fields. A plain address becomes `{ url }`.
 */
export function normalizeCardImageEntries(raw: unknown): Record<string, StoredCardImage> {
  const out: Record<string, StoredCardImage> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== "string" || key.trim() === "") continue;
    const url = mediaUrlOf(value);
    if (!url) continue;
    const name = value && typeof value === "object" ? (value as { name?: unknown }).name : undefined;
    out[canonicalItemKey(key.trim())] = typeof name === "string" && name.trim() !== "" ? { url, name: name.trim() } : { url };
  }
  return out;
}

/**
 * The stored pictures of the items that are still in the test.
 *
 * @param raw The stored map.
 * @param itemKeys Keys of the test's current items, bare or canonical.
 */
export function pruneCardImageEntries(raw: unknown, itemKeys: Iterable<string>): Record<string, StoredCardImage> {
  const keep = new Set<string>();
  for (const key of itemKeys) keep.add(canonicalItemKey(key));
  const out: Record<string, StoredCardImage> = {};
  for (const [key, entry] of Object.entries(normalizeCardImageEntries(raw))) {
    if (keep.has(key)) out[key] = entry;
  }
  return out;
}

/**
 * A variant as any host holds it. Hosts carry their own variant types (the web host's
 * `ContentTemplateDef`, the preview's `PreviewContentTemplate`) and not all of them type
 * `settings`, so the functions below accept any object and read the property defensively.
 */
type AnyVariant = CardImagesVariantDecl | object | null | undefined;

/** Does this router variant have a place for card pictures, i.e. declare the property? */
export function variantDeclaresCardImages(variant: AnyVariant): boolean {
  const settings = (variant as CardImagesVariantDecl | null | undefined)?.settings;
  if (!Array.isArray(settings)) return false;
  return settings.some((s) => s?.key === CARD_IMAGES_SETTING_KEY && s?.type === CARD_IMAGES_SETTING_TYPE);
}

/**
 * The card pictures a hub rendered through `variant` must show.
 *
 * A property belongs to the variant that declares it: a variant without a place for pictures
 * shows none, even when the page still carries a map from the template it was bound to before.
 * The rule is the same in a run and in every preview, so what the author picks is what the
 * learner sees.
 *
 * @param variant The router variant the page renders through.
 * @param pageSettings `content_pages.settings_json` of the router page (the package ships it as
 *   `contentPages[].settings`).
 */
export function cardImagesForVariant(
  variant: AnyVariant,
  pageSettings: Record<string, unknown> | null | undefined,
): CardImages {
  if (!variantDeclaresCardImages(variant)) return {};
  return parseCardImages(pageSettings ? pageSettings[CARD_IMAGES_SETTING_KEY] : null);
}
