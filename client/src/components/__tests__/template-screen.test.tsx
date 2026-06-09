// @vitest-environment jsdom
/**
 * @module client/components/template-screen.test
 *
 * Verifies the React host for the unified renderer (PRD-12 web-host): it mounts the
 * rendered screen into an isolated Shadow DOM, injects the template CSS, and
 * delegates `data-action` clicks to `onAction`.
 */

import { describe, it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TemplateScreen } from "../template-screen";

function shadowOf(container: HTMLElement): ShadowRoot {
  const host = container.querySelector("[data-template-screen]") as HTMLElement;
  return host.shadowRoot as ShadowRoot;
}

describe("TemplateScreen", () => {
  it("renders the layout against the context inside a shadow root", () => {
    const { container } = render(
      <TemplateScreen
        layout={'<div class="r"><span data-path="result.scorePercent"></span>% {{ course.title }}</div>'}
        context={{ course: { title: "Демо" }, result: { scorePercent: 60 } }}
      />,
    );
    const shadow = shadowOf(container);
    expect(shadow.querySelector('[data-path="result.scorePercent"]')?.textContent).toBe("60");
    expect(shadow.querySelector(".r")?.textContent).toContain("Демо");
    cleanup();
  });

  it("injects template CSS into the shadow root (isolated from the app)", () => {
    const { container } = render(<TemplateScreen layout="<div>x</div>" context={{}} css=".r{color:red}" />);
    const shadow = shadowOf(container);
    expect(shadow.querySelector("style")?.textContent).toContain(".r{color:red}");
    cleanup();
  });

  it("delegates data-action clicks to onAction", () => {
    const onAction = vi.fn();
    const { container } = render(
      <TemplateScreen
        layout={'<button data-action="restart">Заново</button>'}
        context={{}}
        onAction={onAction}
      />,
    );
    const shadow = shadowOf(container);
    (shadow.querySelector('[data-action="restart"]') as HTMLElement).click();
    expect(onAction).toHaveBeenCalledWith("restart");
    cleanup();
  });
});
