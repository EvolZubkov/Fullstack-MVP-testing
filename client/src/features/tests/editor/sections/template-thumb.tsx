/**
 * @module features/tests/editor/sections/template-thumb
 * @description The template thumbnail shown on the design tab's template card and
 * on every card of the «Заменить шаблон» gallery.
 *
 * It renders the template's OWN preview image — `manifest.assets.preview`, the same
 * asset the PRD-3 admin registry shows — served by
 * `GET /api/templates/:id/assets/*` (any signed-in user; see
 * {@link module:server/routes/templates}). Both call sites previously drew a
 * hand-built sketch of coloured `div`s ported from the wireframe, so every template
 * looked identical no matter what was imported.
 *
 * The sketch survives as the FALLBACK, passed in as children: a template may declare
 * no `assets.preview`, and a package installed before the validator required one may
 * declare a file that is no longer there. The second case only surfaces when the
 * request fails, so the fallback also covers a load error at runtime.
 */
import { useState, type ReactNode } from "react";

/** The subset of a template row this component needs. */
export interface ThumbTemplate {
  id: string;
  manifest?: { assets?: { preview?: string | null } | null } | null;
}

/**
 * URL of a template's preview asset, or null when it declares none.
 *
 * The manifest of an uploaded template is untrusted input: an absolute or
 * protocol-relative reference would point the browser off-host (the package
 * validator rejects those at import, but a row installed earlier may carry one), and
 * a `..` segment would try to escape the template directory. Both are refused here
 * rather than handed to the server route — which would answer 400 anyway, costing a
 * round-trip before the fallback appears.
 */
export function templatePreviewUrl(template: ThumbTemplate): string | null {
  const rel = template.manifest?.assets?.preview;
  if (typeof rel !== "string") return null;
  const trimmed = rel.trim();
  if (trimmed === "" || /^(?:[a-z]+:)?\/\//i.test(trimmed)) return null;
  const segments = trimmed.split(/[\\/]/).filter((s) => s !== "" && s !== ".");
  if (segments.length === 0 || segments.includes("..")) return null;
  const path = segments.map(encodeURIComponent).join("/");
  return `/api/templates/${encodeURIComponent(template.id)}/assets/${path}`;
}

export interface TemplateThumbProps {
  template: ThumbTemplate;
  /** Template name, used for the image's alt text. */
  name: string;
  /** Schematic fallback, rendered when there is no preview asset or it fails. */
  children: ReactNode;
}

export function TemplateThumb({ template, name, children }: TemplateThumbProps) {
  const url = templatePreviewUrl(template);
  // Track the URL that failed, not a boolean: the design card keeps ONE instance
  // across template switches, and a boolean would keep suppressing a good image for
  // every template picked after a broken one.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!url || failedUrl === url) return <>{children}</>;
  return (
    <img
      className="tpl-thumb__img"
      src={url}
      alt={`Превью «${name}»`}
      loading="lazy"
      onError={() => setFailedUrl(url)}
      data-testid="template-thumb-image"
    />
  );
}
