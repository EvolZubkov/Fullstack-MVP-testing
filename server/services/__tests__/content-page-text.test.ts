/**
 * @module server/services/__tests__/content-page-text
 * @description The single rule for bringing a content page's stored values to
 * their canonical form. The write path and the deploy backfill share it, so a
 * page saved today and a page migrated tonight end up byte-identical.
 */
import { describe, it, expect } from "vitest";
import { normalizePageValuesJson } from "../content-page-text";

describe("normalizePageValuesJson", () => {
  it("applies canonical whitespace and typography to a string value", () => {
    const { valuesJson, changed } = normalizePageValuesJson({
      values: { title: '  Раздел "новый" - тут  ' },
    });
    expect(valuesJson).toEqual({ values: { title: "Раздел «новый» — тут" } });
    expect(changed).toBe(true);
  });

  it("keeps markup intact and transforms only its text", () => {
    const { valuesJson } = normalizePageValuesJson({
      values: { body: '<p class="lead">Слово "важное" - тут</p>' },
    });
    expect((valuesJson.values as Record<string, unknown>).body).toBe(
      '<p class="lead">Слово «важное» — тут</p>',
    );
  });

  it("never interprets markdown", () => {
    const { valuesJson } = normalizePageValuesJson({ values: { body: "<p>**жирный**</p>" } });
    expect((valuesJson.values as Record<string, unknown>).body).toBe("<p>**жирный**</p>");
  });

  it("reports no change when the values are already canonical", () => {
    const { changed } = normalizePageValuesJson({ values: { title: "Раздел «новый» — тут" } });
    expect(changed).toBe(false);
  });

  it("leaves non-string values alone: a resultField is configuration, not prose", () => {
    const { valuesJson, changed } = normalizePageValuesJson({
      values: { score: { path: "result.percent", renderer: "core.badge" }, count: 3, on: true },
    });
    expect(valuesJson.values).toEqual({
      score: { path: "result.percent", renderer: "core.badge" },
      count: 3,
      on: true,
    });
    expect(changed).toBe(false);
  });

  it("keeps everything outside `values` as it was", () => {
    const { valuesJson } = normalizePageValuesJson({
      values: { title: "Заголовок" },
      placeholderStyles: { title: { fontSize: 24 } },
    });
    expect(valuesJson.placeholderStyles).toEqual({ title: { fontSize: 24 } });
  });

  it("tolerates a missing or malformed payload", () => {
    expect(normalizePageValuesJson(undefined).changed).toBe(false);
    expect(normalizePageValuesJson(null).changed).toBe(false);
    expect(normalizePageValuesJson("текст" as unknown as object).changed).toBe(false);
  });

  it("is idempotent, so re-running the backfill changes nothing", () => {
    const once = normalizePageValuesJson({ values: { body: '<p>a - b "c"</p>' } }).valuesJson;
    const twice = normalizePageValuesJson(once);
    expect(twice.valuesJson).toEqual(once);
    expect(twice.changed).toBe(false);
  });
});
