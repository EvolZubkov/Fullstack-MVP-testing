/**
 * @module tests/media-schema
 * @description The media registry tables must expose the columns the registry, the dedup
 * rule and the usage index rely on. A schema test is cheap insurance: a renamed column
 * would otherwise surface as a runtime query error deep inside the delivery route.
 */
import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { mediaAssets, mediaUsages } from "../shared/schema";

describe("media registry schema", () => {
  it("media_assets carries the registry columns", () => {
    const names = getTableConfig(mediaAssets).columns.map((c) => c.name).sort();
    expect(names).toEqual([
      "byte_size", "checksum", "created_at", "id", "kind", "mime_type",
      "original_name", "owner_id", "storage_key", "title", "visibility",
    ]);
  });

  it("media_usages is keyed by asset, entity and field", () => {
    const names = getTableConfig(mediaUsages).columns.map((c) => c.name).sort();
    expect(names).toEqual(["asset_id", "entity_id", "entity_type", "field"]);
  });
});
