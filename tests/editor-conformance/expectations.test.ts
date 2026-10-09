import { describe, expect, it } from "vitest";

import { parseOverrides } from "../../scripts/check/editor-conformance/expectations.mjs";

const STYLE = [
  "      .ou-drawer__head { padding: var(--ou-space-6); }            /* ui-kit: 20 -> 24 */",
  "      .ou-tabs__list { padding-inline: var(--ou-space-6); }       /* ui-kit: 0 -> 24 */",
  "      .ou-drawer__rail { padding: var(--ou-space-6); }            /* ui-kit: 24/16 -> 24 */",
  "      .ou-btn { gap: var(--ou-space-1); }                         /* ui-kit: 8 -> 4 */",
  "      .tb-level-grid { gap: var(--ou-space-4); }                  /* проектный слой: 8 -> 16 */",
  "      .tb-settings-content { padding: var(--ou-space-6); }",
  "      .some-rule { color: red; }                                  /* ui-kit: не про отступы */",
].join("\n");

describe("parseOverrides", () => {
  it("вынимает селектор, свойство и ожидаемое значение", () => {
    const { expectations } = parseOverrides(STYLE);

    expect(expectations).toContainEqual({ selector: ".ou-drawer__head", property: "padding", expected: "24px" });
    expect(expectations).toContainEqual({ selector: ".ou-tabs__list", property: "padding-inline", expected: "24px" });
    expect(expectations).toContainEqual({ selector: ".ou-btn", property: "gap", expected: "4px" });
  });

  it("берёт и перебивки проектного слоя, не только ui-kit", () => {
    expect(parseOverrides(STYLE).expectations).toContainEqual({
      selector: ".tb-level-grid",
      property: "gap",
      expected: "16px",
    });
  });

  it("понимает составное исходное значение вида 24/16", () => {
    expect(parseOverrides(STYLE).expectations).toContainEqual({
      selector: ".ou-drawer__rail",
      property: "padding",
      expected: "24px",
    });
  });

  it("пропускает правило без комментария-перебивки", () => {
    const { expectations } = parseOverrides(STYLE);

    expect(expectations.some((r: { selector: string }) => r.selector === ".tb-settings-content")).toBe(false);
  });

  it("пропускает перебивку, не относящуюся к отступам", () => {
    const { expectations } = parseOverrides(STYLE);

    expect(expectations.some((r: { selector: string }) => r.selector === ".some-rule")).toBe(false);
  });

  it("сообщает о противоречии токена и комментария, но не роняет разбор", () => {
    const broken = [
      ".ou-btn { gap: var(--ou-space-1); }        /* ui-kit: 8 -> 4 */",
      ".ou-acc__body { gap: var(--ou-space-4); }  /* ui-kit: 2 -> 4 */",
    ].join("\n");

    const { expectations, contradictions } = parseOverrides(broken);

    expect(contradictions).toEqual([
      { selector: ".ou-acc__body", property: "gap", token: 16, stated: 4 },
    ]);
    expect(expectations).toEqual([{ selector: ".ou-btn", property: "gap", expected: "4px" }]);
  });

  it("не превращает противоречивое правило в ожидание: иначе гейт упал бы на верном коде", () => {
    const broken = ".ou-acc__body { gap: var(--ou-space-4); } /* ui-kit: 2 -> 4 */";

    expect(parseOverrides(broken).expectations).toEqual([]);
  });
});
