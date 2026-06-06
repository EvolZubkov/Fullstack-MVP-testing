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

import { useEffect, useRef } from "react";
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
  /** Called with the `data-action` value when a button inside the screen is clicked. */
  onAction?: (action: string) => void;
  className?: string;
}

export function TemplateScreen({ layout, context, css, slots, content, onAction, className }: TemplateScreenProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

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
      // isolation.
      style.textContent =
        ":host{display:block;background:var(--background);color:var(--foreground);" +
        "font-family:var(--font-sans);line-height:1.55;min-height:100%;}\n" +
        css.replace(/:root/g, ":host").replace(/\bbody\b(?=\s*\{)/g, ":host");
      shadow.appendChild(style);
    }
    const screen = document.createElement("div");
    shadow.appendChild(screen);
    renderScreenInto(screen, { layout, context, slots, content });
  }, [layout, context, css, slots, content]);

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
