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
  /** Called with the `data-action` value when a button inside the screen is clicked. */
  onAction?: (action: string) => void;
  className?: string;
}

export function TemplateScreen({ layout, context, css, slots, content, cssVars, onAction, className }: TemplateScreenProps) {
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
        css.replace(/:root/g, ":host").replace(/\bbody\b(?=\s*\{)/g, ":host") +
        "\n:host{padding:0;}";
      shadow.appendChild(style);
    }
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
    renderScreenInto(screen, { layout, context, slots, content });
    fitToWidth();
  }, [layout, context, css, slots, content, cssVars, fitToWidth]);

  // Re-fit when the host (modal) width changes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fitToWidth());
    ro.observe(host);
    return () => ro.disconnect();
  }, [fitToWidth]);

  // Delegate clicks on [data-action] elements to the host (bound once).
  useEffect(() => {
    const shadow = shadowRef.current;
    if (!shadow) return;
    const handler = (e: Event) => {
      const target = e.target as Element | null;
      const actionEl = target?.closest?.("[data-action]");
      const action = actionEl?.getAttribute("data-action");
      if (action) onActionRef.current?.(action);
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
