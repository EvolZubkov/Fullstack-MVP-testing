/**
 * @module shared/template/page-sequences
 *
 * PRD-22: which content pages form a SEQUENCE, and what the navigation indicator
 * on each of them shows.
 *
 * The author marks pages with a sequence identifier (the `sequence` setting of
 * the variant); everything else the system derives. Before this module the count
 * of dots and the current position were two numbers typed in by hand, so any edit
 * to the structure silently invalidated them.
 *
 * The rules (PRD-22 FR-17..FR-19):
 *   - a SEGMENT of the structure is the stretch of author pages between
 *     structural elements: the test-scope zones «До теста» / «После теста» and
 *     the per-topic zones. The «После теста» zone is split by the results
 *     boundary, so a page before the results screen and a page after it never
 *     join — the counter must not survive the results screen;
 *   - within one segment, a SEQUENCE is the maximal run of ADJACENT pages sharing
 *     the same non-empty identifier. A page with another identifier interrupts
 *     it; the next run with the same identifier is a NEW sequence;
 *   - a sequence needs at least two pages. A run of one yields no dots: an
 *     indicator with a single dot navigates nowhere.
 *
 * `canGoBack` is NOT decided here: whether the learner can step back depends on
 * the host's run state (in router mode the first page of a topic goes back to the
 * hub), so the host passes it in.
 *
 * The module also owns the rest of the `page.*` namespace a content layout binds
 * against — currently the `nextLabel` setting (FR-26) — so every host reads the
 * page's own properties through one place and applies the same fallbacks.
 *
 * Framework-free and browser-safe: bundled verbatim into the SCORM package.
 */

import type { FlowContentPage } from "../flow/page-sequence";
import { isFlowContentPage } from "../flow/page-sequence";

/** A content page reduced to what sequence computation needs. */
export interface SequenceContentPage extends FlowContentPage {
  /** Page settings (`content_pages.settings_json`); the identifier lives here. */
  settingsJson?: Record<string, unknown> | null;
  /** Shape the SCORM package ships (test-json flattens the column). */
  settings?: Record<string, unknown> | null;
}

/** Position of one page inside its sequence. */
export interface SequencePlacement {
  /** 1-based position within the run. */
  index: number;
  /** Size of the run. Always >= 2 — shorter runs are not sequences. */
  total: number;
  /** The identifier the author chose (useful for diagnostics/UI). */
  sequenceId: string;
}

/** One dot of the navigation indicator. */
export interface SequenceDot {
  /** `is-current` on the active page, empty otherwise — layouts bind it as a class. */
  statusClass: string;
}

/** The `page.*` namespace a content layout binds against. */
export interface PageContext {
  dots: SequenceDot[];
  /** 1-based position; 0 when the page is not in a sequence. */
  dotIndex: number;
  dotsTotal: number;
  canGoBack: boolean;
  /** Caption of the layout's forward button (the `nextLabel` setting, PRD-22 FR-26). */
  nextLabel: string;
}

/** The declared setting key that carries the sequence identifier. */
export const SEQUENCE_SETTING_KEY = "sequenceId";

/** The declared setting key that carries the forward button's caption (FR-26). */
export const NEXT_LABEL_SETTING_KEY = "nextLabel";

/** Caption used when the page declares none — the manifest default. */
export const DEFAULT_NEXT_LABEL = "Далее";

/** The settings bag of a page, whichever shape the host ships it in. */
function settingsOf(page: SequenceContentPage | null | undefined): Record<string, unknown> | null {
  if (!page) return null;
  return (page.settingsJson ?? page.settings ?? null) as Record<string, unknown> | null;
}

/** Sequence identifier of a page, or `""` when it is not in one. */
export function sequenceIdOf(page: SequenceContentPage | null | undefined): string {
  const bag = settingsOf(page);
  const raw = bag ? bag[SEQUENCE_SETTING_KEY] : undefined;
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Forward-button caption of a page, falling back to «Далее».
 *
 * The fallback lives here rather than in each layout so a variant that declares
 * the setting but whose page has no value yet (an older page, or one the author
 * cleared) still gets a labelled button on every host.
 */
export function nextLabelOf(page: SequenceContentPage | null | undefined): string {
  const bag = settingsOf(page);
  const raw = bag ? bag[NEXT_LABEL_SETTING_KEY] : undefined;
  return (typeof raw === "string" ? raw.trim() : "") || DEFAULT_NEXT_LABEL;
}

/**
 * Segment key of a page. Pages of different segments never join, even when they
 * are adjacent in the delivered run (FR-17).
 *
 * The «После теста» zone carries a second dimension: the legacy `summary` page is
 * the results boundary the flow builder splits on (`buildAfterZone`), so pages
 * after it belong to their own segment.
 */
function segmentKeyOf(page: SequenceContentPage, afterResults: boolean): string {
  const topic = page.topicId ?? "";
  const position = page.position ?? "";
  return position === "after" ? `${topic}|after|${afterResults ? 1 : 0}` : `${topic}|${position}`;
}

/** Ascending by `sortOrder`; ties keep their original order (stable sort). */
function bySortOrder(a: SequenceContentPage, b: SequenceContentPage): number {
  return (a.sortOrder || 0) - (b.sortOrder || 0);
}

/**
 * Groups a test's content pages into segments, in author order.
 *
 * System pages (start / results / questions / review / section-results) never
 * take part: they are runtime nodes, and a sequence may not span them. The router
 * hub is excluded too — it terminates the «До теста» zone.
 */
function groupIntoSegments(pages: SequenceContentPage[]): Map<string, SequenceContentPage[]> {
  const segments = new Map<string, SequenceContentPage[]>();
  const authorPages = pages.filter((p) => isFlowContentPage(p) && p.kind !== "router");

  // The results boundary is per-zone state, so «после теста» is walked in order.
  const afterZone = authorPages
    .filter((p) => (p.position ?? "") === "after" && (p.topicId ?? null) === null)
    .slice()
    .sort(bySortOrder);
  const afterResults = new Set<string>();
  let seenResultsBoundary = false;
  for (const page of afterZone) {
    if (page.type === "summary") {
      seenResultsBoundary = true;
      continue;
    }
    if (seenResultsBoundary) afterResults.add(page.id);
  }

  for (const page of authorPages) {
    if (page.type === "summary") continue; // boundary marker, not a page of its own
    const key = segmentKeyOf(page, afterResults.has(page.id));
    const bucket = segments.get(key);
    if (bucket) bucket.push(page);
    else segments.set(key, [page]);
  }

  for (const bucket of segments.values()) bucket.sort(bySortOrder);
  return segments;
}

/**
 * Computes the sequence placement of every page of a test, keyed by page id.
 *
 * Pages outside a sequence are simply absent from the map — a caller that finds
 * nothing renders no indicator, which is exactly the «degrades to a plain page»
 * rule (FR-23).
 */
export function buildSequencePlacements(
  pages: SequenceContentPage[] | null | undefined,
): Map<string, SequencePlacement> {
  const placements = new Map<string, SequencePlacement>();
  if (!pages || pages.length === 0) return placements;

  for (const segment of groupIntoSegments(pages).values()) {
    let runStart = 0;
    while (runStart < segment.length) {
      const id = sequenceIdOf(segment[runStart]);
      if (!id) {
        runStart += 1;
        continue;
      }
      let runEnd = runStart + 1;
      while (runEnd < segment.length && sequenceIdOf(segment[runEnd]) === id) runEnd += 1;

      const total = runEnd - runStart;
      // FR-19: a run of one page is not a sequence.
      if (total >= 2) {
        for (let i = runStart; i < runEnd; i++) {
          placements.set(segment[i].id, { index: i - runStart + 1, total, sequenceId: id });
        }
      }
      runStart = runEnd;
    }
  }

  return placements;
}

/**
 * Builds the `page.*` context for one page.
 *
 * `canGoBack` comes from the host: only it knows whether there is a screen to
 * return to in the current run (in router mode the first page of a topic returns
 * to the hub, which no structural rule can tell).
 */
export function buildPageContext(
  placement: SequencePlacement | null | undefined,
  options?: { canGoBack?: boolean; nextLabel?: string },
): PageContext {
  const canGoBack = options?.canGoBack === true;
  const nextLabel = options?.nextLabel?.trim() || DEFAULT_NEXT_LABEL;
  if (!placement) return { dots: [], dotIndex: 0, dotsTotal: 0, canGoBack, nextLabel };

  const dots: SequenceDot[] = [];
  for (let i = 1; i <= placement.total; i++) {
    dots.push({ statusClass: i === placement.index ? "is-current" : "" });
  }
  return { dots, dotIndex: placement.index, dotsTotal: placement.total, canGoBack, nextLabel };
}

/**
 * Convenience for hosts that hold the whole page list: computes placements and
 * returns the context of one page in a single call. The forward-button caption is
 * read off the page itself, so a host that has the page list needs to know nothing
 * about the setting.
 */
export function buildPageContextFor(
  pageId: string,
  pages: SequenceContentPage[] | null | undefined,
  options?: { canGoBack?: boolean; nextLabel?: string },
): PageContext {
  const page = (pages ?? []).find((p) => p.id === pageId);
  return buildPageContext(buildSequencePlacements(pages).get(pageId), {
    ...options,
    nextLabel: options?.nextLabel ?? nextLabelOf(page),
  });
}

/**
 * Sequence identifiers already used in a test, in first-appearance order — the
 * choices the editor offers the author (FR-16). Only pages that CURRENTLY take
 * part are counted, so an identifier stored on a page whose variant no longer
 * declares the setting stays out of the list.
 */
export function collectSequenceIds(pages: SequenceContentPage[] | null | undefined): string[] {
  const seen: string[] = [];
  for (const page of pages ?? []) {
    const id = sequenceIdOf(page);
    if (id && seen.indexOf(id) === -1) seen.push(id);
  }
  return seen;
}
