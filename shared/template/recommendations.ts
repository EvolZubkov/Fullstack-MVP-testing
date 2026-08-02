/**
 * @module shared/template/recommendations
 *
 * Collects the recommendations that fired into the ONE block at the bottom of the
 * results screen. Four sources feed it — the test's own feedback, the outcome of a
 * result variable, the band of each scale, and the attachments of the topics/sections
 * the attempt covered (PRD-32) — and a measurement test easily fires all of them at
 * once. Rendering each in place would scatter partly-overlapping lists across the
 * screen, so they are merged instead.
 *
 * The block is structured by RESOURCE TYPE, not by cause: which level produced a
 * given recommendation is carried by its own wording, and a "because your exhaustion
 * is high" caption would add noise without information. A topic's attachment is no
 * exception — it joins the same «Материалы» list rather than opening a per-topic one.
 *
 * Order inside each list follows the caller's source order (test, then indicator,
 * then scales, then topics/sections), so the general precedes the specific and dedup
 * keeps the general copy.
 *
 * Pure — no DOM, no Node.
 */

import type { FeedbackBlock, RecommendationLink } from "../scales/interpretation";

export interface CtxRecommendations {
  texts: string[];
  links: RecommendationLink[];
  events: RecommendationLink[];
  assets: RecommendationLink[];
  hasAny: boolean;
}

function dedupLinks(items: RecommendationLink[]): RecommendationLink[] {
  const seen = new Set<string>();
  const out: RecommendationLink[] = [];
  for (const item of items) {
    const key = `${item.title}|${item.url ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Merge the fired feedback blocks in source order. Absent sources are skipped. */
export function collectRecommendations(
  sources: Array<FeedbackBlock | null | undefined>,
): CtxRecommendations {
  const present = sources.filter((s): s is FeedbackBlock => !!s);
  const texts: string[] = [];
  const seenText = new Set<string>();
  for (const source of present) {
    const text = String(source.text ?? "").trim();
    if (!text || seenText.has(text)) continue;
    seenText.add(text);
    texts.push(text);
  }
  const links = dedupLinks(present.flatMap((s) => s.links ?? []));
  const events = dedupLinks(present.flatMap((s) => s.events ?? []));
  const assets = dedupLinks(present.flatMap((s) => s.assets ?? []));
  return {
    texts,
    links,
    events,
    assets,
    hasAny: texts.length > 0 || links.length > 0 || events.length > 0 || assets.length > 0,
  };
}
