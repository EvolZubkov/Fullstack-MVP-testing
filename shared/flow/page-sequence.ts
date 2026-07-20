/**
 * @module shared/flow/page-sequence
 *
 * The SINGLE source of truth for «what the learner is shown, in what order».
 *
 * A test's structure is a mix of author content pages (four placements: the
 * test-scope zones «До теста» / «После теста», and the per-topic zones «перед
 * темой» / «после темы») and the drawn question stream. Turning that structure
 * into a linear run is subtle enough that two independent implementations WILL
 * drift — and did: the SCORM runtime carried the whole thing in plain JS while
 * the web host had no notion of content pages at all, so «Структура» promised
 * screens the web run never delivered (PRD-12 FR-6 parity).
 *
 * This module owns the rules; hosts own their state and rendering:
 *   - SCORM  — `server/scorm/template/app/contentFlow.js` via the `TBTemplate`
 *     global (bundled through `shared/template/runtime-entry.ts`);
 *   - web    — `client/src/pages/learner/take-test.tsx`.
 *
 * Framework-free and browser-safe on purpose (no Node, no React) — it is bundled
 * verbatim into the SCORM package.
 */

/** Placement of a content page relative to the test / a topic. */
export type FlowPosition = "before" | "after" | "before_topic" | "after_topic";

/** The subset of a content page this module needs. Hosts may carry more. */
export interface FlowContentPage {
  id: string;
  /** Page kind. System kinds never flow as author pages — see {@link SYSTEM_FLOW_KINDS}. */
  kind?: string | null;
  /** Legacy type; `summary` still marks the results boundary in the «after» zone. */
  type?: string | null;
  topicId?: string | null;
  position?: string | null;
  sortOrder?: number | null;
}

/** A test section (topic) in author-defined structure order. */
export interface FlowSection {
  topicId: string;
}

/** A drawn question, reduced to what ordering needs. */
export interface FlowQuestionRef {
  topicId: string;
}

/** One step of the run. `questionIndex` indexes the host's flat question list. */
export type FlowItem =
  | { kind: "content"; page: FlowContentPage; isRouter: boolean }
  | { kind: "question"; questionIndex: number }
  | { kind: "adaptive-session"; topicId: string };

export interface PageSequenceInput {
  /** `linear_flat` | `linear_by_topics` | `router_by_topics`. */
  flowMode?: string | null;
  /** `standard` | `adaptive`. */
  testMode?: string | null;
  sections?: FlowSection[] | null;
  contentPages?: FlowContentPage[] | null;
  flatQuestions?: FlowQuestionRef[] | null;
}

export interface PageSequenceResult {
  /** The run, in order. */
  sequence: FlowItem[];
  /**
   * «После теста» pages that follow the `summary` boundary — rendered AFTER the
   * built-in results screen, not inside {@link PageSequenceResult.sequence}.
   */
  postResultsPages: FlowContentPage[];
}

/**
 * Kinds that must NEVER enter the content-page flow as a page. They are either
 * design bindings or runtime nodes, each rendered by its own phase:
 *   - `start` / `results`      — landing and final-results screens;
 *   - `questions`              — the question-stream DESIGN BINDING (the «Вопросы»
 *     row); leaking it renders a blank page with just «Далее» at the section start;
 *   - `review` / `section-results` — PRD-19 обзор / итоги раздела.
 *
 * `router` is deliberately absent: the hub legitimately occupies a slot in the
 * test-scope «before» zone, flagged via `isRouter`.
 */
export const SYSTEM_FLOW_KINDS = [
  "start",
  "results",
  "questions",
  "review",
  "section-results",
] as const;

function isSystemKind(kind: string | null | undefined): boolean {
  return (SYSTEM_FLOW_KINDS as readonly string[]).indexOf(kind ?? "") !== -1;
}

/** True when `page` may flow in a sequence as an author page (hub excluded). */
export function isFlowContentPage(page: FlowContentPage | null | undefined): boolean {
  return !!page && !isSystemKind(page.kind) && page.kind !== "router";
}

/**
 * Author content pages for one (topic, placement) slot, in author order.
 * `topicId` is `null` for the test-scope zones. The hub is included so the
 * caller can position it; every other system kind is filtered out.
 */
export function contentPagesFor(
  contentPages: FlowContentPage[] | null | undefined,
  topicId: string | null,
  position: FlowPosition,
): FlowContentPage[] {
  return (contentPages || [])
    .filter(
      (p) =>
        !isSystemKind(p.kind) &&
        (p.topicId ?? null) === topicId &&
        p.position === position,
    )
    .slice()
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

/**
 * The test-scope «До теста» zone.
 *
 * In router mode the hub TERMINATES this zone: the editor renders it below every
 * author page of the zone («Структура»: ДО ТЕСТА → ВНУТРИ ТЕСТА) and offers no
 * way to place a page after it. `sortOrder` cannot express that — the hub is
 * created with sortOrder 0 (`server/services/test-settings.ts`) while the editor
 * numbers author pages from 0 within a list that EXCLUDES the hub, so the two
 * share a numbering space and collide. Sorting alone left the hub first, and
 * every page behind it became unreachable, because selecting a topic REPLACES
 * the sequence with that topic's chunk. Ordering the hub last is what makes the
 * run match the structure the author sees.
 */
export function buildBeforeZone(
  contentPages: FlowContentPage[] | null | undefined,
  flowMode: string | null | undefined,
): FlowItem[] {
  let pages = contentPagesFor(contentPages, null, "before");
  if (flowMode === "router_by_topics") {
    pages = pages
      .filter((p) => p.kind !== "router")
      .concat(pages.filter((p) => p.kind === "router"));
  }
  return pages.map((page) => ({
    kind: "content" as const,
    page,
    isRouter: page.kind === "router",
  }));
}

/**
 * The test-scope «После теста» zone, split at the `summary` boundary: pages
 * before it render ahead of the built-in results screen, pages after it are
 * deferred to {@link PageSequenceResult.postResultsPages}. The `summary` page
 * itself is not rendered — the results screen IS the score page.
 */
export function buildAfterZone(contentPages: FlowContentPage[] | null | undefined): {
  preResults: FlowItem[];
  postResultsPages: FlowContentPage[];
} {
  const preResults: FlowItem[] = [];
  const postResultsPages: FlowContentPage[] = [];
  let seenSummary = false;
  for (const page of contentPagesFor(contentPages, null, "after")) {
    if (page.type === "summary") {
      seenSummary = true;
      continue;
    }
    if (seenSummary) postResultsPages.push(page);
    else preResults.push({ kind: "content", page, isRouter: false });
  }
  return { preResults, postResultsPages };
}

/**
 * One topic's run: «перед темой» → its questions → «после темы». Used for the
 * router's per-topic chunks and for the section-driven linear build.
 *
 * The topic itself is the anchor, so a section that drew NO questions still
 * shows its pages — a question-driven build anchors them on the first / last
 * drawn question and silently loses both when the draw came back empty.
 */
export function buildTopicChunk(
  contentPages: FlowContentPage[] | null | undefined,
  topicId: string,
  questionIndices: number[],
): FlowItem[] {
  const seq: FlowItem[] = [];
  for (const page of contentPagesFor(contentPages, topicId, "before_topic")) {
    seq.push({ kind: "content", page, isRouter: false });
  }
  for (const questionIndex of questionIndices) {
    seq.push({ kind: "question", questionIndex });
  }
  for (const page of contentPagesFor(contentPages, topicId, "after_topic")) {
    seq.push({ kind: "content", page, isRouter: false });
  }
  return seq;
}

/** Groups flat question indices by topic, preserving draw order within a topic. */
export function questionIndicesByTopic(
  flatQuestions: FlowQuestionRef[] | null | undefined,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  (flatQuestions || []).forEach((fq, index) => {
    const key = fq.topicId;
    if (!out[key]) out[key] = [];
    out[key].push(index);
  });
  return out;
}

/**
 * Builds the whole run for a test.
 *
 * Mode by mode:
 *   - `router_by_topics` — the sequence STOPS after the «До теста» zone; the hub
 *     is the last item and takes over navigation. Topic chunks are built on
 *     demand ({@link buildTopicChunk}) and the «После теста» zone only after the
 *     learner finishes at the hub ({@link buildAfterZone}).
 *   - `linear_by_topics` — section-driven: sections in structure order, each as a
 *     {@link buildTopicChunk}. Adaptive tests get one `adaptive-session` marker
 *     per section instead of that section's questions.
 *   - `linear_flat` — question-driven: topics may interleave in a flat stream, so
 *     a topic's pages bracket its first / last question wherever those land.
 */
export function buildPageSequence(input: PageSequenceInput): PageSequenceResult {
  const flowMode = input.flowMode || "linear_flat";
  const contentPages = input.contentPages || [];
  const sections = input.sections || [];
  const flatQuestions = input.flatQuestions || [];

  const sequence: FlowItem[] = buildBeforeZone(contentPages, flowMode);

  // Router mode: the hub is the terminus of the seeded sequence. Everything
  // beyond it is built on demand by the host's router runtime.
  if (flowMode === "router_by_topics") {
    return { sequence, postResultsPages: [] };
  }

  const byTopic = questionIndicesByTopic(flatQuestions);

  if (flowMode === "linear_by_topics" && sections.length) {
    const placed: Record<string, boolean> = {};
    const adaptive = input.testMode === "adaptive";
    for (const section of sections) {
      placed[section.topicId] = true;
      if (adaptive) {
        // Adaptive replaces the topic's question stretch with a single marker;
        // the host's engine takes over rendering until the topic completes.
        for (const page of contentPagesFor(contentPages, section.topicId, "before_topic")) {
          sequence.push({ kind: "content", page, isRouter: false });
        }
        sequence.push({ kind: "adaptive-session", topicId: section.topicId });
        for (const page of contentPagesFor(contentPages, section.topicId, "after_topic")) {
          sequence.push({ kind: "content", page, isRouter: false });
        }
        continue;
      }
      for (const item of buildTopicChunk(contentPages, section.topicId, byTopic[section.topicId] || [])) {
        sequence.push(item);
      }
    }
    // Defensive: a drifted variant may carry questions whose topic is absent
    // from `sections`. Deliver them rather than dropping them silently.
    flatQuestions.forEach((fq, index) => {
      if (!placed[fq.topicId]) sequence.push({ kind: "question", questionIndex: index });
    });
  } else {
    // Flat stream (and any by-topics test with no sections declared).
    const remaining: Record<string, number> = {};
    const started: Record<string, boolean> = {};
    for (const fq of flatQuestions) {
      remaining[fq.topicId] = (remaining[fq.topicId] || 0) + 1;
    }
    flatQuestions.forEach((fq, index) => {
      if (!started[fq.topicId]) {
        started[fq.topicId] = true;
        for (const page of contentPagesFor(contentPages, fq.topicId, "before_topic")) {
          sequence.push({ kind: "content", page, isRouter: false });
        }
      }
      sequence.push({ kind: "question", questionIndex: index });
      remaining[fq.topicId] -= 1;
      if (remaining[fq.topicId] === 0) {
        for (const page of contentPagesFor(contentPages, fq.topicId, "after_topic")) {
          sequence.push({ kind: "content", page, isRouter: false });
        }
      }
    });
  }

  const after = buildAfterZone(contentPages);
  for (const item of after.preResults) sequence.push(item);

  return { sequence, postResultsPages: after.postResultsPages };
}
