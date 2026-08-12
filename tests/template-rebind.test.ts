/**
 * @module tests/template-rebind
 * @description Unit tests for the pure {@link rebindToDefault} helper (PRD-3
 * §5.3): repointing a test's design slepok to `default` must NOT leave the
 * removed template's params / version snapshot behind — it keeps only params
 * whose keys still exist in `default`'s manifest and re-stamps the version.
 */
import { describe, it, expect } from "vitest";
import {
  rebindToDefault,
  manifestParamKeys,
  DEFAULT_TEMPLATE_ID,
  type DefaultTemplateInfo,
} from "../server/services/template-rebind";

const DEFAULT_INFO: DefaultTemplateInfo = {
  version: "2.0.0",
  templateApiVersion: "1.0",
  // `default` declares only a primaryColor param in this fixture.
  paramKeys: ["primaryColor"],
};

describe("rebindToDefault", () => {
  it("repoints templateId to `default`", () => {
    const next = rebindToDefault({ templateId: "acme" }, DEFAULT_INFO);
    expect(next.templateId).toBe(DEFAULT_TEMPLATE_ID);
    expect(next.templateId).toBe("default");
  });

  it("re-stamps the version fields to `default`'s", () => {
    const next = rebindToDefault(
      { templateId: "acme", templateVersion: "1.0.0", templateApiVersion: "0.9" },
      DEFAULT_INFO,
    );
    expect(next.templateVersion).toBe("2.0.0");
    expect(next.templateApiVersion).toBe("1.0");
  });

  it("drops params whose keys are not in `default`'s manifest, keeps compatible ones", () => {
    const next = rebindToDefault(
      {
        templateId: "acme",
        params: { primaryColor: "10 20% 30%", logoUrl: "x.png", companyName: "Acme" },
      },
      DEFAULT_INFO,
    );
    // primaryColor exists in `default` → preserved; logoUrl/companyName → dropped.
    expect(next.params).toEqual({ primaryColor: "10 20% 30%" });
  });

  it("yields empty params when none of the saved keys are compatible", () => {
    const next = rebindToDefault(
      { templateId: "acme", params: { logoUrl: "x.png" } },
      DEFAULT_INFO,
    );
    expect(next.params).toEqual({});
  });

  it("handles a null/undefined prior slepok", () => {
    expect(rebindToDefault(null, DEFAULT_INFO)).toEqual({
      templateId: "default",
      templateVersion: "2.0.0",
      templateApiVersion: "1.0",
      params: {},
    });
    expect(rebindToDefault(undefined, DEFAULT_INFO).templateId).toBe("default");
  });

  it("falls back to the prior version when `default` info lacks one", () => {
    const next = rebindToDefault(
      { templateId: "acme", templateVersion: "1.0.0", templateApiVersion: "0.9" },
      { version: null, templateApiVersion: null, paramKeys: [] },
    );
    expect(next.templateVersion).toBe("1.0.0");
    expect(next.templateApiVersion).toBe("0.9");
  });

  it("does not mutate the input slepok", () => {
    const prev = { templateId: "acme", params: { logoUrl: "x.png" } };
    rebindToDefault(prev, DEFAULT_INFO);
    expect(prev).toEqual({ templateId: "acme", params: { logoUrl: "x.png" } });
  });
});

describe("manifestParamKeys", () => {
  it("extracts string keys from a manifest's params array", () => {
    expect(
      manifestParamKeys({ params: [{ key: "a" }, { key: "b" }, { label: "no-key" }] }),
    ).toEqual(["a", "b"]);
  });

  it("returns [] for a manifest without a params array", () => {
    expect(manifestParamKeys({})).toEqual([]);
    expect(manifestParamKeys(null)).toEqual([]);
    expect(manifestParamKeys(undefined)).toEqual([]);
    expect(manifestParamKeys({ params: "nope" })).toEqual([]);
  });
});
