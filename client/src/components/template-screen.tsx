/**
 * @module client/components/template-screen
 *
 * React host for the unified template renderer (PRD-12 web-host). It mounts the
 * shared renderer ({@link module:shared/template/render-screen}) into a Shadow DOM
 * root so the design template's CSS is isolated from the app's styles (and vice
 * versa). The component owns the imperative inner DOM; React only manages the host
 * element. `data-action` clicks inside the rendered screen are delegated to
 * `onAction`, so the host can wire template buttons (e.g. restart) to app navigation.
 */

import { useCallback, useEffect, useRef } from "react";
import { renderScreenInto, type ContentPageData } from "@shared/template/render-screen";
import { attachPointerDnd } from "@shared/template/dnd/pointer-dnd";

export interface TemplateScreenProps {
  /** Layout HTML from the selected design template. */
  layout: string;
  /** Public render context (see render-screen / context contract). */
  context: unknown;
  /** Template CSS, injected (isolated) into the shadow root. */
  css?: string;
  /** Controlled HTML for `data-slot` regions. */
  slots?: Record<string, string>;
  /** Content-page placeholder data, when rendering a content screen. */
  content?: ContentPageData;
  /**
   * Design-param overrides as CSS custom properties (e.g. `{ "--background": "0 0% 100%" }`,
   * built via {@link module:shared/template/params-css buildTemplateCssVars}). Applied on
   * the shadow host so they override the template's `theme.css` `:root` tokens — this is
   * how per-test branding renders in the preview, the SAME mapping the runtime uses.
   */
  cssVars?: Record<string, string>;
  /**
   * PRD-23: per-theme colour overrides as a CSS block (built by the shared
   * {@link module:shared/template/theme-css buildTemplateThemeCss} against `:host`).
   * Injected as the LAST stylesheet in the shadow root, so at equal specificity the
   * test's palette wins over the template's own `theme.css`. Unlike {@link cssVars}
   * these cannot be inline custom properties: a media query cannot scope those, and
   * scoping to `prefers-color-scheme` is the entire point of a themed template.
   */
  themeCss?: string;
  /**
   * PRD-23: the palette the author pinned, set as `data-theme` on the shadow host.
   * Leave undefined for «Авто» — the attribute must be absent for the template's own
   * `prefers-color-scheme` rules to decide.
   */
  dataTheme?: "light" | "dark";
  /** Called with the `data-action` value when a button inside the screen is clicked. */
  onAction?: (action: string) => void;
  className?: string;
  /**
   * Optional design-template shell HTML (the `shell` layout, containing an `#app`
   * mount). When provided, the screen is rendered INSIDE the shell instead of at the
   * root — so FIXED-STAGE templates (whose screens use container-query units cqh/cqw
   * relative to the shell's `container-type:size` stage) get their stage context and
   * scale to the host WIDTH. Without it, container units resolve against the viewport
   * and the screen renders at full-viewport size (unscaled). Pass it only for
   * templates that ship a fixed-stage shell (manifest `mountShell`).
   */
  shell?: string;
}

export function TemplateScreen({ layout, context, css, slots, content, cssVars, themeCss, dataTheme, onAction, className, shell }: TemplateScreenProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const screenRef = useRef<HTMLElement | null>(null);
  const appliedVarsRef = useRef<string[]>([]);
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  // Fit-to-width: some templates render a FIXED-size canvas (e.g. a 1280×720
  // Storyline-style layout). Scale it down so it fits the host width — no
  // horizontal scroll — mirroring how the runtime fits the canvas to the player.
  // Responsive layouts (natural width ≤ host width) are left untouched.
  const fitToWidth = useCallback(() => {
    const host = hostRef.current;
    const screen = screenRef.current;
    const root = screen?.firstElementChild as HTMLElement | null;
    if (!host || !screen || !root) return;
    // Reset before measuring the natural (unscaled) size.
    root.style.transform = "";
    root.style.transformOrigin = "top left";
    screen.style.height = "";
    screen.style.overflow = "";
    const naturalW = root.offsetWidth;
    const naturalH = root.offsetHeight;
    const containerW = host.clientWidth;
    if (naturalW > 0 && containerW > 0 && naturalW > containerW + 1) {
      const scale = containerW / naturalW;
      root.style.transform = `scale(${scale})`;
      screen.style.height = `${Math.ceil(naturalH * scale)}px`;
      screen.style.overflow = "hidden";
    }
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!shadowRef.current) {
      shadowRef.current = host.attachShadow({ mode: "open" });
    }
    const shadow = shadowRef.current;
    shadow.innerHTML = "";
    if (css) {
      const style = document.createElement("style");
      // Template CSS targets :root / body (light DOM). Inside the shadow root those
      // selectors don't match, so map them to :host and seed the theme basics — the
      // design CSS variables (theme.css :root) and base body styles then apply in
      // isolation. Tokens are HSL COMPONENTS (unified convention, PRD-12), so colors
      // wrap them as hsl(var(--x)). The mapped `body` rule may carry page padding
      // meant for the SCORM document; neutralise it on the embedded :host below.
      style.textContent =
        ":host{display:block;background:hsl(var(--background));color:hsl(var(--foreground));" +
        "font-family:var(--font-sans);line-height:1.55;min-height:100%;padding:0;}\n" +
        // `:root[data-theme="dark"]` must become `:host([data-theme="dark"])`, not
        // `:host[...]` — the suffix form is invalid on a shadow host and the browser
        // drops the whole rule, which is how a themed template lost its dark palette
        // on the web while keeping it in the package (PRD-23).
        css
          .replace(/:root((?:\[[^\]]*\]|:not\([^)]*\))+)/g, ":host($1)")
          .replace(/:root/g, ":host")
          .replace(/\bbody\b(?=\s*\{)/g, ":host") +
        "\n:host{padding:0;}";
      shadow.appendChild(style);
    }
    // PRD-23: per-theme colours go in AFTER the template stylesheet — same
    // specificity, later wins — and the pinned palette goes on the host, where the
    // `:host[data-theme="…"]` rules (the template's own and ours) can see it.
    if (themeCss) {
      const themeStyle = document.createElement("style");
      themeStyle.setAttribute("data-tb-theme", "");
      themeStyle.textContent = themeCss;
      shadow.appendChild(themeStyle);
    }
    if (dataTheme) host.setAttribute("data-theme", dataTheme);
    else host.removeAttribute("data-theme");
    // Apply design-param overrides on the host element. Inline custom properties
    // on the host win over the template's `:host{}` (`:root`-mapped) tokens and
    // inherit into the shadow tree — so per-test branding overrides theme.css.
    // Clear stale keys from a previous render before applying the current set.
    for (const name of appliedVarsRef.current) host.style.removeProperty(name);
    if (cssVars) {
      for (const [name, value] of Object.entries(cssVars)) host.style.setProperty(name, value);
      appliedVarsRef.current = Object.keys(cssVars);
    } else {
      appliedVarsRef.current = [];
    }

    const screen = document.createElement("div");
    shadow.appendChild(screen);
    screenRef.current = screen;
    if (shell) {
      // Fixed-stage: mount the screen inside the template's shell so its
      // container-query stage (container-type:size) scales the cqh/cqw content to
      // the host width. Override the shell's viewport-based stage sizing
      // (e.g. max-width: calc(100dvh*16/9)) so the stage fits the preview container.
      const fit = document.createElement("style");
      fit.textContent = ":host *:has(> #app){max-width:100%!important;width:100%!important;margin:0 auto;}";
      shadow.appendChild(fit);
      screen.innerHTML = shell;
      const app = screen.querySelector<HTMLElement>("#app");
      renderScreenInto(app ?? screen, { layout, context, slots, content });
    } else {
      renderScreenInto(screen, { layout, context, slots, content });
      fitToWidth();
    }
  }, [layout, context, css, slots, content, cssVars, themeCss, dataTheme, fitToWidth, shell]);

  // Re-fit when the host (modal) width changes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fitToWidth());
    ro.observe(host);
    return () => ro.disconnect();
  }, [fitToWidth]);

  // Delegate clicks on [data-action] elements to the host (bound once).
  //
  // `[data-nav]` is delegated too, as the action `"nav:<value>"`. Content-page
  // layouts express their «Далее» as `data-nav="next"` (the SCORM runtime wires
  // that attribute directly), so without this the web host would have to rewrite
  // the template's own navigation markup to make the same layout clickable —
  // i.e. diverge from the layout the package renders (PRD-12 FR-6).
  useEffect(() => {
    const shadow = shadowRef.current;
    if (!shadow) return;
    const handler = (e: Event) => {
      const target = e.target as Element | null;
      const actionEl = target?.closest?.("[data-action]");
      const action = actionEl?.getAttribute("data-action");
      if (action) {
        onActionRef.current?.(action);
        return;
      }
      const navEl = target?.closest?.("[data-nav]");
      const nav = navEl?.getAttribute("data-nav");
      if (nav) onActionRef.current?.("nav:" + nav);
    };
    shadow.addEventListener("click", handler);
    return () => shadow.removeEventListener("click", handler);
  }, []);

  // Delegate `change` on [data-change] controls (e.g. <select>): emit as the
  // action `"<data-change>=<value>"` so hosts can wire it via the same onAction.
  useEffect(() => {
    const shadow = shadowRef.current;
    if (!shadow) return;
    const handler = (e: Event) => {
      const target = e.target as (HTMLInputElement | HTMLSelectElement) | null;
      if (!target) return;
      const key = target.getAttribute("data-change");
      if (key) onActionRef.current?.(`${key}=${target.value}`);
    };
    shadow.addEventListener("change", handler);
    return () => shadow.removeEventListener("change", handler);
  }, []);

  // Drag-and-drop is delegated to the shared, framework-free pointer controller
  // (the SAME engine the SCORM host mounts on `document`). The host only maps a
  // completed drop to the app action `"drop:<dropId>:<dragId>"`.
  useEffect(() => {
    const shadow = shadowRef.current;
    if (!shadow) return;
    return attachPointerDnd(shadow, {
      onDrop: ({ dropId, dragId }) => onActionRef.current?.(`drop:${dropId}:${dragId}`),
    });
  }, []);

  return <div ref={hostRef} data-template-screen className={className} />;
}
