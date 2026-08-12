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

  it("replaces the previous render on re-render — no scene accumulation", () => {
    // Regression: the take-test host builds a fresh context object per render, so the
    // mount effect re-runs; the per-render wipe MUST clear the prior scene. A wipe via
    // `querySelectorAll(":scope > …")` matches NOTHING on a ShadowRoot, so the old
    // wipe removed nothing and every re-render stacked another scene (duplicated screens
    // on the live web host). jsdom reproduces the `:scope`-on-ShadowRoot behaviour.
    const layout = '<div class="tb-scene"><span data-path="course.title"></span></div>';
    const { container, rerender } = render(<TemplateScreen layout={layout} context={{ course: { title: "A" } }} />);
    rerender(<TemplateScreen layout={layout} context={{ course: { title: "B" } }} />);
    rerender(<TemplateScreen layout={layout} context={{ course: { title: "C" } }} />);
    const shadow = shadowOf(container);
    expect(shadow.querySelectorAll(".tb-scene")).toHaveLength(1);
    expect(shadow.querySelector(".tb-scene span")?.textContent).toBe("C");
    // The persistent DS stylesheet survives the wipe — exactly one, never duplicated.
    expect(shadow.querySelectorAll("style[data-tb-ds]")).toHaveLength(1);
    cleanup();
  });

  it("injects template CSS into the shadow root (isolated from the app)", () => {
    const { container } = render(<TemplateScreen layout="<div>x</div>" context={{}} css=".r{color:red}" />);
    const shadow = shadowOf(container);
    // The design system is the first (persistent) stylesheet; the template CSS is a
    // separate node — select it explicitly rather than by document order.
    expect(shadow.querySelector("style[data-tb-ds]")).not.toBeNull();
    expect(shadow.querySelector("style:not([data-tb-ds])")?.textContent).toContain(".r{color:red}");
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

// ─── PRD-23: themed templates ────────────────────────────────────────────────

describe("TemplateScreen — themes (PRD-23)", () => {
  it("rewrites :root WITH a condition into the functional :host(...) form", () => {
    // `:host[data-theme="dark"]` is invalid — the browser drops the whole rule and
    // the template's dark palette silently never applies. Caught in a real browser
    // after the naive `:root` → `:host` replacement; pinned here so it stays fixed.
    const css =
      ':root { --a: 1 }\n' +
      ':root[data-theme="dark"] { --a: 2 }\n' +
      '@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --a: 3 } }';
    const { container } = render(<TemplateScreen layout="<div>x</div>" context={{}} css={css} />);
    const text = shadowOf(container).querySelector("style:not([data-tb-ds])")!.textContent!;
    expect(text).toContain(':host([data-theme="dark"])');
    expect(text).toContain(':host(:not([data-theme="light"]))');
    expect(text).not.toContain(":host[");
    expect(text).not.toContain(":host:not(");
    cleanup();
  });

  it("puts the per-theme block after the template stylesheet and pins the palette", () => {
    const { container } = render(
      <TemplateScreen
        layout="<div>x</div>"
        context={{}}
        css=":root { --a: 1 }"
        themeCss=':host { --a: 9 }'
        dataTheme="dark"
      />,
    );
    const shadow = shadowOf(container);
    // Only the sheets that carry a PALETTE. The protection sheet (PRD-34) is injected
    // into the shadow tree by the renderer itself, lands after everything and holds
    // print rules and the toast — no colours. Counting it made this check read as a
    // regression while nothing about the palette order had changed.
    const styles = [...shadow.children].filter(
      (n) => n.tagName === "STYLE" && !n.hasAttribute("data-tb-protection"),
    );
    // Equal specificity → the LAST rule wins, so the test's palette must come last.
    expect(styles.at(-1)?.getAttribute("data-tb-theme")).not.toBeNull();
    const host = container.querySelector("[data-template-screen]") as HTMLElement;
    expect(host.getAttribute("data-theme")).toBe("dark");
    cleanup();
  });

  it("leaves data-theme off for «Авто» so the media query decides", () => {
    const { container } = render(
      <TemplateScreen layout="<div>x</div>" context={{}} css=":root { --a: 1 }" themeCss=":host { --a: 9 }" />,
    );
    const host = container.querySelector("[data-template-screen]") as HTMLElement;
    expect(host.hasAttribute("data-theme")).toBe(false);
    cleanup();
  });

  // The DS palette class is what actually paints the scene, and the package resolves
  // it through the SHARED `resolveSceneTheme`. jsdom reports «no dark preference», so
  // these two cases are exactly the light-system learner whose web run used to open
  // white while the package opened dark.
  it("под «Авто» нетемированный шаблон открывается в своей (тёмной) палитре", () => {
    const { container } = render(<TemplateScreen layout="<div>x</div>" context={{}} />);
    const host = container.querySelector("[data-template-screen]") as HTMLElement;
    expect(host.classList.contains("ou--dark")).toBe(true);
    expect(host.classList.contains("ou--light")).toBe(false);
    cleanup();
  });

  it("под «Авто» темированный шаблон следует системе", () => {
    const { container } = render(<TemplateScreen layout="<div>x</div>" context={{}} themed />);
    const host = container.querySelector("[data-template-screen]") as HTMLElement;
    expect(host.classList.contains("ou--light")).toBe(true);
    cleanup();
  });
});
