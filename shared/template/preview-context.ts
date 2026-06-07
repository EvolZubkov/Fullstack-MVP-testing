/**
 * @module shared/template/preview-context
 *
 * PRD-3 Phase 2 (preview + работоспособность). Bridges a template's
 * `PreviewDemoDataset` (spec-template-platform §5.5) into per-screen render inputs
 * for the unified renderer ({@link module:shared/template/render-screen}). One
 * {@link ScreenSpec} per `manifest.preview.routes[]` entry: the resolved layout key,
 * the public render context (built via the shared
 * {@link module:shared/template/start-state}/{@link module:shared/template/result-context}/
 * {@link module:shared/template/transition-context} builders), the controlled slots
 * (question interaction, content skeleton) and the slots the smoke-runner must find
 * filled.
 *
 * Pure — no DOM, no Node — so it is unit-testable and safe to bundle for the browser.
 */

import { buildStartState } from "./start-state";
import { buildResultContext, buildAdaptiveResultContext, type ResultInput } from "./result-context";
import { buildTransitionContext } from "./transition-context";
import type { ScreenRenderInput, PlaceholderDef } from "./render-screen";

/** One preview route, normalized (`manifest.preview.routes[]` may be a string or object). */
export interface PreviewRouteTarget {
  route: string;
  label?: string;
  pageId?: string;
  templateKey?: string;
  questionId?: string;
}

/** A content template declaration (`manifest.contentTemplates[]`, subset). */
export interface PreviewContentTemplate {
  key: string;
  kind?: string;
  pageKind?: string;
  placeholders?: PlaceholderDef[];
}

/** Template manifest (subset used by the preview bridge). */
export interface PreviewManifest {
  layouts?: Record<string, string>;
  contentTemplates?: PreviewContentTemplate[];
  systemPages?: Array<{ id: string; layout: string }>;
  preview?: { defaultRoute?: string; routes?: Array<string | PreviewRouteTarget> };
}

/** A demo question (subset). */
export interface PreviewQuestion {
  id: string;
  type: string;
  prompt: string;
  options?: Array<{ id: string; text: string; correct?: boolean }>;
  pairs?: Array<{ id: string; left: string; right: string }>;
  order?: string[];
}

/** A demo content page instance (subset). */
export interface PreviewContentPage {
  id: string;
  type: string;
  route?: string;
  templateKey?: string;
  topicId?: string;
  values: Record<string, unknown>;
}

/** Demo dataset (spec-template-platform §5.5, subset the bridge consumes). */
export interface PreviewDemoDataset {
  schemaVersion?: string;
  locale?: string;
  params?: Record<string, unknown>;
  course: {
    title: string;
    description?: string;
    questionCount?: number;
    passPercent?: number | null;
    timeLimitMinutes?: number | null;
    maxAttempts?: number | null;
    topics?: Array<{ id: string; title: string; status?: string }>;
    contentPages?: PreviewContentPage[];
    questions?: PreviewQuestion[];
  };
  runtime?: {
    result?: Record<string, unknown>;
    sectionResult?: Record<string, unknown>;
    progress?: Record<string, unknown>;
  };
}

/** Render inputs + smoke expectations for a single preview screen. */
export interface ScreenSpec {
  route: string;
  label?: string;
  /** Layout key to look up in the layouts map (resolved with fallback, §5.3). */
  layoutKey: string;
  /** Slots the smoke-runner requires present and filled for this screen. */
  requiredSlots: string[];
  /** Render input minus `layout` (the runner attaches the layout HTML). */
  input: Omit<ScreenRenderInput, "layout">;
}

/** Escape text for safe injection into a controlled slot. */
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Normalize a `preview.routes[]` entry to a {@link PreviewRouteTarget}. */
function normalizeTarget(t: string | PreviewRouteTarget): PreviewRouteTarget {
  return typeof t === "string" ? { route: t } : t;
}

/**
 * Resolve a route to a layout key present in `manifest.layouts`, following the
 * spec §5.3 fallback (specific → general): `question.single → question`,
 * `content.intro → content`, `start → content`, `system.* → content`.
 */
function resolveLayoutKey(route: string, manifest: PreviewManifest): string {
  const layouts = manifest.layouts ?? {};
  if (layouts[route]) return route;
  if (route === "results.adaptive") return layouts["results.adaptive"] ? "results.adaptive" : "results";
  if (route === "results") return "results";
  if (route.startsWith("question")) return "question";
  if (route.startsWith("content")) return "content";
  if (route === "start") return layouts.start ? "start" : "content";
  if (route.startsWith("system.")) return layouts[route] ? route : "content";
  return route;
}

/** Build a minimal content-page skeleton (one `data-placeholder` host per field). */
function buildSkeleton(placeholders: PlaceholderDef[]): string {
  return placeholders.map((p) => `<div data-placeholder="${esc(p.key)}"></div>`).join("");
}

// Drag-handle glyphs mirror the web host (client/pages/learner/template-question-screen)
// so the preview interaction is visually identical to the runtime.
const RANK_GRIP =
  '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
  '<path d="M2.5 4.99524H17.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>' +
  '<path d="M14.1667 9.9952H2.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>' +
  '<path d="M2.5 14.9951H10.8333" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
const MATCH_GRIP =
  '<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">' +
  '<circle cx="7" cy="5" r="1.4"></circle><circle cx="13" cy="5" r="1.4"></circle>' +
  '<circle cx="7" cy="10" r="1.4"></circle><circle cx="13" cy="10" r="1.4"></circle>' +
  '<circle cx="7" cy="15" r="1.4"></circle><circle cx="13" cy="15" r="1.4"></circle></svg>';

/**
 * Build interaction HTML for the `question-interaction` slot. The markup/classes
 * mirror the runtime web host (`template-question-screen.tsx`: `.option` /
 * `.ranking-board`/`.rank-item` / `.matching-board`/`.match-*`) so the preview
 * renders the real, template-styled interaction rather than a bare list. Demo
 * state only: nothing is pre-selected, and matching chips are offset by one row so
 * the preview does not reveal the correct pairing.
 */
function buildInteraction(q: PreviewQuestion): string {
  const opts = q.options ?? [];
  switch (q.type) {
    case "single":
    case "multiple": {
      const input = q.type === "single" ? "radio" : "checkbox";
      return opts
        .map(
          (o) =>
            `<div class="option" role="button" tabindex="0">` +
            `<input type="${input}" tabindex="-1" aria-hidden="true"><span>${esc(o.text)}</span></div>`,
        )
        .join("");
    }
    case "ranking": {
      const items = opts
        .map(
          (o, pos) =>
            `<div class="rank-item rank-draggable" data-drag="${pos}" data-drop="${pos}">` +
            `<span class="rank-grip">${RANK_GRIP}</span>` +
            `<span class="rank-text">${esc(o.text)}</span></div>`,
        )
        .join("");
      return `<div class="ranking-board">${items}</div>`;
    }
    case "matching": {
      const pairs = q.pairs ?? [];
      const n = pairs.length;
      const rows = pairs
        .map((p, i) => {
          // Offset left chips by one row → an unsolved task, not the answer key.
          const left = n > 1 ? pairs[(i + 1) % n].left : p.left;
          return (
            `<div class="matching-line">` +
            `<div class="match-tile match-left-slot"><div class="match-chip">` +
            `<span class="match-grip" aria-hidden="true">${MATCH_GRIP}</span>` +
            `<span class="match-chip-text">${esc(left)}</span></div></div>` +
            `<div class="matching-gap"></div>` +
            `<div class="match-tile match-right-tile">${esc(p.right)}</div>` +
            `</div>`
          );
        })
        .join("");
      return `<div class="matching-board">${rows}</div>`;
    }
    default:
      return "";
  }
}

/** Find the demo content page that matches a route target. */
function findContentPage(dataset: PreviewDemoDataset, t: PreviewRouteTarget): PreviewContentPage | undefined {
  const pages = dataset.course.contentPages ?? [];
  if (t.pageId) return pages.find((p) => p.id === t.pageId);
  if (t.templateKey) return pages.find((p) => p.templateKey === t.templateKey);
  return pages.find((p) => p.route === t.route);
}

/** Find the demo question that matches a route target (by id, else by type). */
function findQuestion(dataset: PreviewDemoDataset, t: PreviewRouteTarget): PreviewQuestion | undefined {
  const qs = dataset.course.questions ?? [];
  if (t.questionId) return qs.find((q) => q.id === t.questionId);
  const type = t.route.split(".")[1];
  return qs.find((q) => q.type === type) ?? qs[0];
}

/** Find the manifest content template for a key. */
function findContentTemplate(manifest: PreviewManifest, key?: string): PreviewContentTemplate | undefined {
  if (!key) return undefined;
  return (manifest.contentTemplates ?? []).find((c) => c.key === key);
}

/** A `result`-namespace context built from the demo runtime result (for `resultField`). */
function resultContextFromRuntime(dataset: PreviewDemoDataset): Record<string, unknown> {
  const r = (dataset.runtime?.result ?? {}) as Record<string, unknown>;
  return {
    scorePercent: Number(r.scorePercent) || 0,
    status: r.status ?? "",
    passed: !!r.passed,
  };
}

/**
 * `result`-namespace for the per-section summary page (`content.summary`). Per
 * spec-template-platform §8.2, Core feeds `content.summary` the result of the
 * TOPIC/SECTION (not the whole test) — so the «Итог раздела» page reflects the
 * section result. Falls back to the test result when the demo has no sectionResult.
 */
function sectionResultContextFromRuntime(dataset: PreviewDemoDataset): Record<string, unknown> {
  const r = (dataset.runtime?.sectionResult ?? dataset.runtime?.result ?? {}) as Record<string, unknown>;
  return {
    scorePercent: Number(r.scorePercent) || 0,
    status: r.status ?? "",
    passed: r.passed != null ? !!r.passed : r.status === "passed",
  };
}

/** Adapt the demo runtime result into the normalized {@link ResultInput}. */
function resultInputFromRuntime(dataset: PreviewDemoDataset): ResultInput {
  const r = (dataset.runtime?.result ?? {}) as Record<string, unknown>;
  const topics = Array.isArray(r.topicResults) ? (r.topicResults as Array<Record<string, unknown>>) : [];
  return {
    passed: !!r.passed,
    percent: Number(r.scorePercent) || 0,
    totalQuestions: Number(r.totalQuestions) || 0,
    correct: Number(r.correct) || 0,
    earnedPoints: Number(r.earnedPoints) || 0,
    possiblePoints: Number(r.maxScore) || 0,
    topicResults: topics.map((t) => ({
      topicId: t.topicId as string | undefined,
      topicName: String(t.topicName ?? ""),
      correct: Number(t.correct) || 0,
      total: Number(t.total) || 0,
      percent: Number(t.percent) || 0,
      earnedPoints: 0,
      possiblePoints: 0,
      passed: t.passed == null ? null : !!t.passed,
    })),
  };
}

/** Build the {@link ScreenSpec} for one route target. */
function buildOne(target: PreviewRouteTarget, dataset: PreviewDemoDataset, manifest: PreviewManifest): ScreenSpec {
  const route = target.route;
  const layoutKey = resolveLayoutKey(route, manifest);
  const c = dataset.course;
  const base = { route, label: target.label, layoutKey };

  if (route === "start") {
    const { course, state } = buildStartState({
      info: {
        title: c.title,
        description: c.description,
        questionCount: c.questionCount,
        passPercent: c.passPercent,
        timeLimitMinutes: c.timeLimitMinutes,
        maxAttempts: c.maxAttempts,
      },
      maxAttempts: c.maxAttempts ?? null,
      completedAttempts: 0,
      hasCompletedResults: false,
      canStartNew: true,
    });
    return { ...base, requiredSlots: [], input: { context: { course, state } } };
  }

  if (route === "results" || route === "results.adaptive") {
    const context =
      route === "results.adaptive"
        ? buildAdaptiveResultContext(
            { passed: true, topicResults: (c.topics ?? []).map((t) => ({ topicName: t.title, achievedLevelIndex: 0, achievedLevelName: "Базовый" })) },
            c.title,
          )
        : buildResultContext(resultInputFromRuntime(dataset), c.title);
    return { ...base, requiredSlots: [], input: { context } };
  }

  if (route.startsWith("question")) {
    const q = findQuestion(dataset, target);
    const total = c.questionCount ?? c.questions?.length ?? 1;
    const context = {
      course: { title: c.title },
      state: { questionCounterLabel: "Вопрос 1 из " + total },
    };
    const slots = q
      ? { "question-text": esc(q.prompt), "question-media": "", "question-interaction": buildInteraction(q) }
      : { "question-text": "", "question-media": "", "question-interaction": "" };
    return { ...base, requiredSlots: ["question-text", "question-interaction"], input: { context, slots } };
  }

  if (route.startsWith("content")) {
    const page = findContentPage(dataset, target);
    const tpl = findContentTemplate(manifest, page?.templateKey ?? target.templateKey);
    const placeholders = tpl?.placeholders ?? [];
    const skeleton = buildSkeleton(placeholders);
    // The «Итог раздела» page (content.summary, after_topic) reflects the SECTION
    // result; other content pages keep the test-level result namespace (§8.2).
    const isSummary = route === "content.summary" || (tpl?.kind ?? page?.type) === "summary";
    const result = isSummary ? sectionResultContextFromRuntime(dataset) : resultContextFromRuntime(dataset);
    const context = { course: { title: c.title }, result };
    return {
      ...base,
      requiredSlots: ["page-content"],
      input: {
        context,
        slots: { "page-content": skeleton },
        content: { template: { placeholders }, values: page?.values ?? {} },
      },
    };
  }

  if (route === "system.transition") {
    const context = buildTransitionContext({
      isCorrect: true,
      levelTransition: { type: "up", message: "Уровень повышен" },
      showContinue: true,
    });
    return { ...base, requiredSlots: [], input: { context } };
  }

  // Other system.* screens (e.g. system.blocked): retake context.
  if (route.startsWith("system.")) {
    const context = { retake: { cooldownPeriodDays: 7, availableDateHuman: "через 7 дней" } };
    return { ...base, requiredSlots: [], input: { context } };
  }

  // Fallback: render with course title only.
  return { ...base, requiredSlots: [], input: { context: { course: { title: c.title } } } };
}

/**
 * Build a {@link ScreenSpec} for every `manifest.preview.routes[]` entry. The
 * smoke-runner attaches each layout's HTML and renders/checks the screens.
 */
export function buildScreenInputs(dataset: PreviewDemoDataset, manifest: PreviewManifest): ScreenSpec[] {
  const targets = (manifest.preview?.routes ?? []).map(normalizeTarget);
  return targets.map((t) => buildOne(t, dataset, manifest));
}
