/**
 * @module tests/asset-base
 * @description PRD-22 FR-36: relative links in author content resolve against
 * the template's files, and the base differs per host. Pure: no DOM, no DB.
 *
 * The rule these tests pin down: the STORED value is host-independent
 * (`images/x.png`), so nothing but the base may differ between the SCORM package
 * and the web host — and absolute links (author media, anchors, data URIs) must
 * never be touched, or a picture uploaded by the author would break.
 */
import { describe, it, expect } from "vitest";
import { withTemplateAssetBase, withTemplateAssetBaseInValues } from "@shared/template/asset-base";

describe("withTemplateAssetBase — relative references", () => {
  it("prefixes a relative src with the host's base", () => {
    expect(withTemplateAssetBase('<img src="images/logo.png">', "template/")).toBe(
      '<img src="template/images/logo.png">',
    );
  });

  it("prefixes a relative href the same way", () => {
    expect(withTemplateAssetBase('<a href="docs/rules.pdf">Правила</a>', "/api/templates/cert/assets/")).toBe(
      '<a href="/api/templates/cert/assets/docs/rules.pdf">Правила</a>',
    );
  });

  it("handles single quotes and several references in one fragment", () => {
    const html = `<img src='a.png'><img src="b.png">`;
    expect(withTemplateAssetBase(html, "template/")).toBe(
      `<img src='template/a.png'><img src="template/b.png">`,
    );
  });

  it("joins with exactly one slash regardless of how the base ends", () => {
    expect(withTemplateAssetBase('<img src="a.png">', "base")).toBe('<img src="base/a.png">');
    expect(withTemplateAssetBase('<img src="/a.png">', "base/")).toBe('<img src="/a.png">');
  });
});

describe("withTemplateAssetBase — what must stay untouched", () => {
  it("author media stays absolute", () => {
    const html = '<img src="/uploads/media/photo.jpg">';
    expect(withTemplateAssetBase(html, "template/")).toBe(html);
  });

  it("data URIs, anchors and protocol links stay as they are", () => {
    for (const url of ["data:image/png;base64,AAA", "#section", "mailto:a@b.c", "https://example.com"]) {
      const html = `<a href="${url}">x</a>`;
      expect(withTemplateAssetBase(html, "template/")).toBe(html);
    }
  });

  it("no base ⇒ the fragment is returned unchanged", () => {
    const html = '<img src="images/logo.png">';
    expect(withTemplateAssetBase(html, "")).toBe(html);
  });

  it("empty input is safe", () => {
    expect(withTemplateAssetBase("", "template/")).toBe("");
  });
});

describe("withTemplateAssetBaseInValues", () => {
  it("rewrites every string value and leaves the rest alone", () => {
    const values = {
      body: '<p><img src="images/a.png"></p>',
      title: "Без ссылок",
      meta: { path: "images/b.png" },
      count: 3,
    };

    const out = withTemplateAssetBaseInValues(values, "template/");

    expect(out.body).toBe('<p><img src="template/images/a.png"></p>');
    expect(out.title).toBe("Без ссылок");
    // Non-string values pass through untouched — an image placeholder stores a
    // plain URL and resultField stores an object.
    expect(out.meta).toEqual({ path: "images/b.png" });
    expect(out.count).toBe(3);
  });

  it("no base ⇒ values are copied unchanged", () => {
    const values = { body: '<img src="images/a.png">' };
    expect(withTemplateAssetBaseInValues(values, "")).toEqual(values);
  });

  it("absent values yield an empty object", () => {
    expect(withTemplateAssetBaseInValues(undefined, "template/")).toEqual({});
  });
});
