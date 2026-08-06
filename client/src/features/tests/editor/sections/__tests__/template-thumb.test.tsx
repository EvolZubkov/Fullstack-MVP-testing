/**
 * @module features/tests/editor/sections/__tests__/template-thumb
 * @description The design-tab / gallery thumbnail must show the TEMPLATE's own
 * preview asset, and degrade to the schematic sketch whenever it cannot.
 *
 * The regression these cover: both call sites used to render the sketch
 * unconditionally, so every template looked identical no matter what was imported.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TemplateThumb, templatePreviewUrl } from "../template-thumb";

const FALLBACK = <div data-testid="sketch">схема</div>;

function row(preview: unknown, id = "certification") {
  return { id, manifest: { assets: { preview } } } as never;
}

describe("templatePreviewUrl", () => {
  it("builds the asset URL from manifest.assets.preview", () => {
    expect(templatePreviewUrl(row("preview.svg"))).toBe(
      "/api/templates/certification/assets/preview.svg",
    );
  });

  it("encodes the id and each path segment", () => {
    expect(templatePreviewUrl(row("img/пре вью.svg", "my template"))).toBe(
      "/api/templates/my%20template/assets/img/%D0%BF%D1%80%D0%B5%20%D0%B2%D1%8C%D1%8E.svg",
    );
  });

  it("returns null when the template declares no preview", () => {
    expect(templatePreviewUrl(row(undefined))).toBeNull();
    expect(templatePreviewUrl(row(null))).toBeNull();
    expect(templatePreviewUrl(row("   "))).toBeNull();
    expect(templatePreviewUrl({ id: "x" } as never)).toBeNull();
  });

  // An uploaded manifest is untrusted: these must never reach the browser as a src.
  it("refuses external references", () => {
    expect(templatePreviewUrl(row("https://evil.example/p.svg"))).toBeNull();
    expect(templatePreviewUrl(row("//evil.example/p.svg"))).toBeNull();
  });

  it("refuses paths that escape the template directory", () => {
    expect(templatePreviewUrl(row("../../secrets/key.svg"))).toBeNull();
    expect(templatePreviewUrl(row("img/../../x.svg"))).toBeNull();
  });
});

describe("TemplateThumb", () => {
  it("renders the template's preview image", () => {
    render(
      <TemplateThumb template={row("preview.svg")} name="Сертификация (РТК)">
        {FALLBACK}
      </TemplateThumb>,
    );
    const img = screen.getByTestId("template-thumb-image");
    expect(img).toHaveAttribute("src", "/api/templates/certification/assets/preview.svg");
    expect(img).toHaveAttribute("alt", "Превью «Сертификация (РТК)»");
    expect(screen.queryByTestId("sketch")).toBeNull();
  });

  it("falls back to the sketch when the template declares no preview", () => {
    render(
      <TemplateThumb template={row(undefined)} name="Без превью">
        {FALLBACK}
      </TemplateThumb>,
    );
    expect(screen.getByTestId("sketch")).toBeInTheDocument();
    expect(screen.queryByTestId("template-thumb-image")).toBeNull();
  });

  it("falls back to the sketch when the declared asset fails to load", () => {
    render(
      <TemplateThumb template={row("gone.svg")} name="Битая ссылка">
        {FALLBACK}
      </TemplateThumb>,
    );
    fireEvent.error(screen.getByTestId("template-thumb-image"));
    expect(screen.getByTestId("sketch")).toBeInTheDocument();
    expect(screen.queryByTestId("template-thumb-image")).toBeNull();
  });

  // The design card keeps ONE instance across template switches: a failure for one
  // template must not suppress the next template's perfectly good image.
  it("retries for a different template after a failure", () => {
    const { rerender } = render(
      <TemplateThumb template={row("gone.svg")} name="Битая ссылка">
        {FALLBACK}
      </TemplateThumb>,
    );
    fireEvent.error(screen.getByTestId("template-thumb-image"));
    expect(screen.getByTestId("sketch")).toBeInTheDocument();

    rerender(
      <TemplateThumb template={row("preview.svg", "default")} name="Стандартный">
        {FALLBACK}
      </TemplateThumb>,
    );
    expect(screen.getByTestId("template-thumb-image")).toHaveAttribute(
      "src",
      "/api/templates/default/assets/preview.svg",
    );
  });
});
