/**
 * @module shared/template/preview-context
 *
 * PRD-3 Phase 2 (preview + работоспособность). Bridges a template's
 * `PreviewDemoDataset` (spec-template-platform §5.5) into per-screen render inputs
 * for the unified renderer ({@link module:shared/template/render-screen}). It emits one
 * {@link ScreenSpec} per `manifest.preview.routes[]` system screen PLUS one per declared
 * `intro`/`info`/`summary` content variant in `manifest.contentTemplates` (so every
 * variant previews + smoke-checks, not only the routes the author listed). Each spec
 * carries: a unique `id`, the resolved layout key, the public render context (built via
 * the shared {@link module:shared/template/start-state}/{@link module:shared/template/result-context}/
 * {@link module:shared/template/transition-context} builders), the controlled slots
 * (question interaction, content skeleton) and the slots the engine fills
 * ({@link ScreenSpec.expectedSlots} — warnings, never blockers).
 *
 * Pure — no DOM, no Node — so it is unit-testable and safe to bundle for the browser.
 */

import { buildStartState } from "./start-state";
import {
  buildResultContext,
  buildAdaptiveResultContext,
  buildSectionResultContext,
  buildSectionIntroContext,
  type ResultInput,
} from "./result-context";
import { buildTransitionContext } from "./transition-context";
import { buildReviewContext } from "./review-context";
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
  label?: string;
  kind?: string;
  pageKind?: string;
  /**
   * Path to this variant's layout inside the package (spec §8.2) — the CANONICAL
   * way a variant-backed screen names its layout. Absent when the variant renders
   * through a generic layout (`content` / `question`), as `info`/`summary`/`router`/
   * `questions` do in the shipping `default`.
   */
  layoutFile?: string;
  isDefault?: boolean;
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
  /**
   * Stable, UNIQUE identity for this screen — keys the preview rail, the status
   * map and the smoke report. For most screens it equals `route`; when a content
   * kind has several render variants that share one semantic route (e.g. two
   * `content.intro` variants), the id is the variant's `contentTemplates[].key`
   * so the variants stay distinguishable.
   */
  id: string;
  route: string;
  label?: string;
  /** Layout key to look up in the layouts map (resolved with fallback, §5.3). */
  layoutKey: string;
  /**
   * Slots the engine fills on this screen. Their ABSENCE never blocks activation
   * (spec §17.1/§17.2, PRD-3 §4.2/§4.3): a screen whose layout omits a slot is
   * rendered from the standard template instead, so the smoke-runner reports a
   * warning, not an error. Declaring them is still the right thing — a template
   * that omits one hands its screen (and its styling) to the standard template.
   */
  expectedSlots: string[];
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
 * Resolve the layout reference for a screen — the key the host looks up in its
 * layouts map (which is keyed by BOTH `manifest.layouts` key and `layoutFile` path).
 *
 * The contract (spec §8.2, audit rule 6.3): a screen backed by a `contentTemplates[]`
 * variant takes its layout from that variant's `layoutFile`; `layouts[]` keys serve
 * only system screens WITHOUT a variant. A key named after a page kind — e.g.
 * `layouts["content.intro"]` — is NOT part of the contract and is deliberately never
 * consulted: the runtime does not read it either (`contentPage.js` renders content
 * pages through `layouts["content"]`), so honouring it here would make the check
 * exercise a layout the learner never sees.
 *
 * Without a `layoutFile` the variant renders through the generic layout of its route
 * family (`question.* → question`, `content.* → content`), mirroring the runtime.
 */
function resolveLayoutKey(route: string, manifest: PreviewManifest, variant?: PreviewContentTemplate): string {
  const layouts = manifest.layouts ?? {};
  // «Введение раздела» is looked up by the FIXED `section-intro` key, exactly as the
  // runtime does — not by the intro variant's layoutFile.
  if (isSectionIntroScreen(route, variant?.kind, manifest)) return "section-intro";
  if (variant?.layoutFile) return variant.layoutFile;
  // The runtime also resolves a variant's layout by its KEY (`contentPage.js →
  // renderGalleryPage` reads `layouts[contentTemplate.key]`), so honour that too —
  // otherwise a gallery declared that way previews through the generic layout.
  if (variant && layouts[variant.key]) return variant.key;
  if (route === "results.adaptive") return layouts["results.adaptive"] ? "results.adaptive" : "results";
  if (route === "results") return "results";
  if (route.startsWith("question")) return "question";
  if (route.startsWith("content")) return "content";
  if (route === "start") return layouts.start ? "start" : "content";
  // System screens without a variant (`system.*`, `review`, `section-results`).
  if (layouts[route]) return route;
  if (route.startsWith("system.")) return "content";
  return route;
}

/** Pick a variant list's default (`isDefault`, else first) — PRD-1 §4.3.2. */
function selectDefaultVariant(list: PreviewContentTemplate[]): PreviewContentTemplate | undefined {
  return list.find((c) => c.isDefault) ?? list[0];
}

/**
 * Find the `contentTemplates[]` variant backing a screen: the explicitly bound key
 * when the demo page/route names one, else the default variant declared for this
 * route's `pageKind` (or the `questions` kind for question routes).
 */
function findVariantForRoute(
  manifest: PreviewManifest,
  route: string,
  explicitKey?: string,
): PreviewContentTemplate | undefined {
  const cts = manifest.contentTemplates ?? [];
  if (explicitKey) {
    const bound = cts.find((c) => c.key === explicitKey);
    if (bound) return bound;
  }
  const byPageKind = cts.filter((c) => c.pageKind === route);
  if (byPageKind.length > 0) return selectDefaultVariant(byPageKind);
  if (route.startsWith("question")) return selectDefaultVariant(cts.filter((c) => c.kind === "questions"));
  return undefined;
}

/**
 * True when this screen renders through the section-intro pipeline: an `intro` screen
 * whose template declares the `section-intro` LAYOUT KEY.
 *
 * That key — not the variant's `layoutFile` — is what the runtime reads
 * (`contentPage.js → renderSectionIntro` calls `systemLayout("section-intro")`). When
 * it is absent the runtime bails out and the page falls through to the GENERIC content
 * render (placeholder skeleton in `page-content`), so the preview must do the same.
 * Keying this on `layoutFile` instead would feed a `sectionIntro` context to a plain
 * content layout — an author whose intro variant is an ordinary page (as in a
 * builder-exported template) would preview an empty screen.
 */
function isSectionIntroScreen(route: string, kind: string | undefined, manifest: PreviewManifest): boolean {
  const isIntro = route === "content.intro" || kind === "intro";
  return isIntro && !!(manifest.layouts ?? {})["section-intro"];
}

/** Build a minimal content-page skeleton (one `data-placeholder` host per field). */
function buildSkeleton(placeholders: PlaceholderDef[]): string {
  return placeholders.map((p) => `<div data-placeholder="${esc(p.key)}"></div>`).join("");
}

/** A demo topic for the router preview (subset of the dataset `topics`). */
interface RouterTopic {
  id: string;
  title?: string;
  status?: string;
  required?: boolean;
}

/**
 * Required-section progress counter («Разделы X / Y» + bar), prepended to the
 * router menu — the SAME markup `routerFlow.js → renderRouterPage` emits, so run +
 * preview match. Y counts ONLY required sections; empty string when none required.
 */
function buildRouterProgress(topics: RouterTopic[]): string {
  const required = topics.filter((t) => t.required !== false);
  const total = required.length;
  if (total === 0) return "";
  const done = required.filter((t) => String(t.status ?? "") === "completed").length;
  const pct = Math.round((done / total) * 100);
  return (
    '<div class="router-progress" role="group" aria-label="Прогресс по разделам">' +
    '<div class="router-progress__head">' +
    '<span class="router-progress__label">Разделы</span>' +
    `<span class="router-progress__count">${done} / ${total}</span>` +
    "</div>" +
    `<div class="router-progress__bar"><div class="router-progress__fill" style="width:${pct}%"></div></div>` +
    "</div>"
  );
}

/**
 * Build the router topic-menu markup: the «Разделы X / Y» progress counter followed
 * by `.router-topic-cards` → `.router-topic-card`, byte-for-byte the same
 * structure/classes the SCORM runtime emits (`server/scorm/template/app/
 * routerFlow.js → renderRouterPage`), so the preview shows the real topic menu on
 * the template's demo topics. Demo `status` is mapped to the runtime's per-topic
 * states (notStarted / inProgress / completed, plus a `locked` modifier) with the
 * same status labels.
 */
function buildRouterCards(topics: RouterTopic[]): string {
  const cards = topics
    .map((t) => {
      const demo = String(t.status ?? "available");
      const locked = demo === "locked";
      const status = demo === "completed" ? "completed" : demo === "inProgress" ? "inProgress" : "notStarted";
      const lockedClass = locked ? " router-topic-card--locked" : "";
      const disabled = status === "completed" || locked;
      const statusText = locked
        ? "Недоступна"
        : status === "completed"
          ? "Пройдена"
          : status === "inProgress"
            ? "В процессе"
            : "Не начата";
      return (
        `<button type="button" class="router-topic-card router-topic-card--${status}${lockedClass}" role="listitem"` +
        ` data-topic-id="${esc(t.id)}" data-router-status="${status}"${locked ? ' data-router-locked="true"' : ""}` +
        `${disabled ? " disabled" : ""}>` +
        `<span class="router-topic-card__name">${esc(t.title ?? t.id)}` +
        (t.required === false ? ' <span class="router-topic-card__optional">(необязательная)</span>' : "") +
        "</span>" +
        `<span class="router-topic-card__status">${esc(statusText)}</span>` +
        "</button>"
      );
    })
    .join("");
  return (
    buildRouterProgress(topics) +
    `<div class="router-topic-cards" role="list" aria-label="Доступные темы">${cards}</div>`
  );
}

/** True when a content route/kind is the router (topic menu). */
function isRouterScreen(route: string, kind?: string): boolean {
  return route === "content.router" || route === "router" || kind === "router";
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

/** Section-intro demo inputs (topic/section facts the computed context needs). */
interface SectionIntroFacts {
  sectionNumber: number;
  topicName: string;
  questionCount: number;
  description?: string;
  timeLimitMinutes?: number | null;
}

/** Render input + slot expectations for one screen (the `ScreenSpec` tail). */
type ScreenParts = Pick<ScreenSpec, "expectedSlots" | "input">;

/**
 * Build the «Введение раздела» screen the way the RUNTIME builds it
 * (`contentPage.js → renderSectionIntro`): a COMPUTED `sectionIntro` context plus the
 * author instruction injected as a slot — NOT the generic `page-content` skeleton.
 * Keeping the two pipelines identical is what makes the check exercise the screen the
 * learner actually sees; feeding this screen a page-content skeleton (as the preview
 * used to) fails templates whose intro layout is correct.
 *
 * The layout renders the instruction slot only under `{{#if sectionIntro.hasInstruction}}`,
 * so the slot is expected only when the demo supplies an instruction.
 */
function buildSectionIntroParts(values: Record<string, unknown>, facts: SectionIntroFacts): ScreenParts {
  const instruction = typeof values.instruction === "string" ? values.instruction : "";
  const illoRaw = values.illustration;
  const illustration =
    illoRaw && typeof illoRaw === "object"
      ? String((illoRaw as { url?: unknown }).url ?? "")
      : String(illoRaw ?? "");
  const built = buildSectionIntroContext({
    sectionNumber: facts.sectionNumber,
    topicName: facts.topicName,
    description: facts.description,
    questionCount: facts.questionCount,
    timeLimitMinutes: facts.timeLimitMinutes ?? undefined,
    instruction,
    illustration,
  });
  return {
    expectedSlots: built.sectionIntro.hasInstruction ? ["instruction"] : [],
    input: {
      context: { course: built.course, sectionIntro: built.sectionIntro },
      slots: { instruction },
    },
  };
}

/**
 * True when this screen renders through the gallery pipeline: a gallery slide whose
 * variant has a DEDICATED layout (by `layoutFile` or by the variant KEY, both of which
 * the runtime honours). Without one, `renderGalleryPage` bails out and the page falls
 * through to the generic content render — so the preview must do the same.
 */
function isGalleryScreen(
  route: string,
  kind: string | undefined,
  variant: PreviewContentTemplate | undefined,
  manifest: PreviewManifest,
): boolean {
  const isGallery = route === "content.gallery" || route.startsWith("content.gallery.") || kind === "gallery";
  if (!isGallery || !variant) return false;
  return !!variant.layoutFile || !!(manifest.layouts ?? {})[variant.key];
}

/** Unwrap a media value stored either as a bare URL or as a `{ url, … }` envelope. */
function mediaUrl(v: unknown): string {
  if (v && typeof v === "object") return String((v as { url?: unknown }).url ?? "");
  return String(v ?? "");
}

/**
 * Build a gallery slide the way the RUNTIME builds it (`contentPage.js →
 * renderGalleryPage`): a `gallery` context (header/subheader/image/pills/nav) plus the
 * author card text as a slot — NOT the generic `page-content` skeleton. Without this
 * the slide renders as an empty card: its layout declares `data-slot="cardText"` and
 * binds `gallery.*`, so a page-content skeleton fills nothing.
 */
function buildGalleryParts(values: Record<string, unknown>, courseTitle: string): ScreenParts {
  const total = Math.max(1, parseInt(String(values.pillsTotal ?? ""), 10) || 1);
  const current = parseInt(String(values.pillCurrent ?? ""), 10) || 1;
  const pills = Array.from({ length: total }, (_, i) => ({
    statusClass: i + 1 === current ? "is-current" : "",
  }));
  const cardText = values.cardText != null ? String(values.cardText) : "";
  return {
    expectedSlots: cardText.trim() ? ["cardText"] : [],
    input: {
      context: {
        course: { title: courseTitle },
        gallery: {
          header: values.header != null ? String(values.header) : "",
          subheader: values.subheader != null ? String(values.subheader) : "",
          imageUrl: mediaUrl(values.image),
          pills,
          showBack: values.showBack === true || values.showBack === "true",
          nextLabel: values.nextLabel != null && values.nextLabel !== "" ? String(values.nextLabel) : "Далее",
        },
      },
      slots: { cardText },
    },
  };
}

/** Build the {@link ScreenSpec} for one route target. */
function buildOne(target: PreviewRouteTarget, dataset: PreviewDemoDataset, manifest: PreviewManifest): ScreenSpec {
  const route = target.route;
  const c = dataset.course;
  const boundPage = route.startsWith("content") ? findContentPage(dataset, target) : undefined;
  const variant = findVariantForRoute(manifest, route, boundPage?.templateKey ?? target.templateKey);
  const layoutKey = resolveLayoutKey(route, manifest, variant);
  const base = { id: route, route, label: target.label, layoutKey };

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
    return { ...base, expectedSlots: [], input: { context: { course, state } } };
  }

  if (route === "results" || route === "results.adaptive") {
    const context =
      route === "results.adaptive"
        ? buildAdaptiveResultContext(
            { passed: true, topicResults: (c.topics ?? []).map((t) => ({ topicName: t.title, achievedLevelIndex: 0, achievedLevelName: "Базовый" })) },
            c.title,
          )
        : buildResultContext(resultInputFromRuntime(dataset), c.title);
    return { ...base, expectedSlots: [], input: { context } };
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
    return { ...base, expectedSlots: ["question-text", "question-interaction"], input: { context, slots } };
  }

  if (route.startsWith("content")) {
    const page = boundPage;
    const variantKey = page?.templateKey ?? target.templateKey;
    const tpl = variant;

    // Identity must be UNIQUE — it keys the preview rail and the smoke status map.
    // The bound demo page is the finest-grained identity: a template may list SEVERAL
    // screens that share ONE variant (`certification` previews two gallery cards, both
    // bound to `gallery.card`), and keying on the variant alone collides. The variant
    // key still serves when a route binds no page — it keeps two render variants of the
    // same kind (both route `content.intro`) distinguishable.
    const screenId = target.pageId ?? variantKey ?? route;

    // Gallery slides render through their own pipeline (see buildGalleryParts).
    if (isGalleryScreen(route, tpl?.kind ?? page?.type, tpl, manifest)) {
      return { ...base, id: screenId, ...buildGalleryParts(page?.values ?? {}, c.title) };
    }

    // «Введение раздела» renders through the section-intro pipeline, not the
    // generic content one (see buildSectionIntroParts).
    if (isSectionIntroScreen(route, tpl?.kind ?? page?.type, manifest)) {
      const topic = c.topics?.[0];
      return {
        ...base,
        id: screenId,
        ...buildSectionIntroParts(page?.values ?? {}, {
          sectionNumber: 1,
          topicName: topic?.title ?? "Раздел",
          questionCount: c.questionCount ?? c.questions?.length ?? 0,
          description: c.description,
          timeLimitMinutes: c.timeLimitMinutes,
        }),
      };
    }

    const placeholders = tpl?.placeholders ?? [];
    const skeleton = buildSkeleton(placeholders);
    // The «Итог раздела» page (content.summary, after_topic) reflects the SECTION
    // result; other content pages keep the test-level result namespace (§8.2).
    const isSummary = route === "content.summary" || (tpl?.kind ?? page?.type) === "summary";
    const result = isSummary ? sectionResultContextFromRuntime(dataset) : resultContextFromRuntime(dataset);
    const context = { course: { title: c.title }, result };
    // Router screens append the runtime topic-menu (`.router-topic-cards`) built
    // from the demo topics, so the preview shows the real menu, not a bare skeleton.
    const pageContent = isRouterScreen(route, tpl?.kind ?? page?.type)
      ? skeleton + buildRouterCards(c.topics ?? [])
      : skeleton;
    return {
      ...base,
      id: screenId,
      expectedSlots: ["page-content"],
      input: {
        context,
        slots: { "page-content": pageContent },
        content: { template: { placeholders }, values: page?.values ?? {} },
      },
    };
  }

  // PRD-19: «Обзор раздела/теста» (review / section-finish). Demo: one question
  // answered, the rest unanswered, so the pills + explicit unanswered list show.
  if (route === "review") {
    const qs = c.questions ?? [];
    const statuses: Record<string, "answered" | "skipped" | "unanswered"> = {};
    if (qs[0]) statuses[qs[0].id] = "answered";
    const built = buildReviewContext({
      questions: qs.map((q) => ({ id: q.id, topicId: c.topics?.[0]?.id ?? null, prompt: q.prompt })),
      statuses,
      commitScope: "test",
      isTest: true,
      scopeLabel: "Обзор теста",
      finishLabel: "Завершить тест",
    });
    const context = {
      course: { title: c.title },
      state: { questionsProgress: built.questionsProgress },
      review: built.review,
    };
    return { ...base, expectedSlots: [], input: { context } };
  }

  // PRD-19 FR-05a: «Итоги раздела» (computed section-results). Demo score from the
  // runtime sectionResult/result, scoped to the first demo topic.
  if (route === "section-results") {
    const sr = (dataset.runtime?.sectionResult ?? dataset.runtime?.result ?? {}) as Record<string, unknown>;
    const total = Number(sr.total) || Number(c.questionCount) || c.questions?.length || 10;
    const percent = Number(sr.scorePercent) || 0;
    const correct = sr.correct != null ? Number(sr.correct) : Math.round((percent / 100) * total);
    const passed = sr.passed != null ? !!sr.passed : sr.status === "passed";
    const built = buildSectionResultContext({
      topicName: c.topics?.[0]?.title ?? "Раздел",
      correct,
      total,
      percent,
      passed,
      continueLabel: "Продолжить",
    });
    return { ...base, expectedSlots: [], input: { context: { course: built.course, sectionResult: built.sectionResult } } };
  }

  if (route === "system.transition") {
    const context = buildTransitionContext({
      isCorrect: true,
      levelTransition: { type: "up", message: "Уровень повышен" },
      showContinue: true,
    });
    return { ...base, expectedSlots: [], input: { context } };
  }

  // Other system.* screens (e.g. system.blocked): retake context.
  if (route.startsWith("system.")) {
    const context = { retake: { cooldownPeriodDays: 7, availableDateHuman: "через 7 дней" } };
    return { ...base, expectedSlots: [], input: { context } };
  }

  // Fallback: render with course title only.
  return { ...base, expectedSlots: [], input: { context: { course: { title: c.title } } } };
}

/** Content-page kinds the preview enumerates per variant (вводные/учебные/итог/маршрутизатор). */
const CONTENT_VARIANT_KINDS = new Set(["intro", "info", "summary", "router"]);

/** Derive a variant kind from a `pageKind` like `content.info` → `info`. */
function kindFromPageKind(pageKind?: string): string | undefined {
  if (!pageKind) return undefined;
  const m = /^content\.([a-z]+)$/i.exec(pageKind);
  return m ? m[1] : undefined;
}

/**
 * Build a {@link ScreenSpec} for ONE declared content variant
 * (`manifest.contentTemplates[]`), independent of whether the author listed it in
 * `preview.routes`. Demo values come from the demo content page bound to this
 * variant key (else the matching route, else empty). Mirrors {@link buildOne}'s
 * content branch so the variant renders identically to the runtime.
 */
function buildContentVariant(
  ct: PreviewContentTemplate,
  kind: string,
  dataset: PreviewDemoDataset,
  manifest: PreviewManifest,
): ScreenSpec {
  const route = ct.pageKind ?? `content.${kind}`;
  const layoutKey = resolveLayoutKey(route, manifest, ct);
  const placeholders = ct.placeholders ?? [];
  const skeleton = buildSkeleton(placeholders);
  const pages = dataset.course.contentPages ?? [];
  const page = pages.find((p) => p.templateKey === ct.key) ?? pages.find((p) => p.route === route);

  // «Введение раздела» renders through the section-intro pipeline (see buildOne).
  if (isSectionIntroScreen(route, kind, manifest)) {
    const c = dataset.course;
    const topic = c.topics?.[0];
    return {
      id: ct.key,
      route,
      label: ct.label,
      layoutKey,
      ...buildSectionIntroParts(page?.values ?? {}, {
        sectionNumber: 1,
        topicName: topic?.title ?? "Раздел",
        questionCount: c.questionCount ?? c.questions?.length ?? 0,
        description: c.description,
        timeLimitMinutes: c.timeLimitMinutes,
      }),
    };
  }

  const isSummary = route === "content.summary" || kind === "summary";
  const result = isSummary ? sectionResultContextFromRuntime(dataset) : resultContextFromRuntime(dataset);
  // Router variants append the runtime topic-menu on the demo topics (see buildOne).
  const pageContent = isRouterScreen(route, kind)
    ? skeleton + buildRouterCards(dataset.course.topics ?? [])
    : skeleton;
  return {
    id: ct.key,
    route,
    label: ct.label,
    layoutKey,
    expectedSlots: ["page-content"],
    input: {
      context: { course: { title: dataset.course.title }, result },
      slots: { "page-content": pageContent },
      content: { template: { placeholders }, values: page?.values ?? {} },
    },
  };
}

/**
 * Build a {@link ScreenSpec} per preview screen. Non-content screens (start,
 * question.*, results, system.*) come from `manifest.preview.routes[]`. Content
 * screens cover EVERY declared content variant (PRD-3 §3.4: вводные / учебные /
 * итог), not only those the author happened to list in `preview.routes` — the
 * routes provide demo bindings/labels, and any intro/info/summary variant from
 * `contentTemplates` that no route references is appended so it still
 * renders + smoke-checks. The smoke-runner attaches each layout's HTML.
 */
export function buildScreenInputs(dataset: PreviewDemoDataset, manifest: PreviewManifest): ScreenSpec[] {
  const targets = (manifest.preview?.routes ?? []).map(normalizeTarget);
  const specs: ScreenSpec[] = [];
  // Variant keys already shown via a preview.routes entry — so we don't list
  // a declared content variant twice when it is also hand-authored as a route.
  const coveredVariantKeys = new Set<string>();

  for (const t of targets) {
    const spec = buildOne(t, dataset, manifest);
    specs.push(spec);
    if (t.route.startsWith("content")) {
      const page = findContentPage(dataset, t);
      const key = page?.templateKey ?? t.templateKey;
      if (key) coveredVariantKeys.add(key);
    }
  }

  for (const ct of manifest.contentTemplates ?? []) {
    const kind = ct.kind ?? kindFromPageKind(ct.pageKind);
    if (!kind || !CONTENT_VARIANT_KINDS.has(kind)) continue;
    if (coveredVariantKeys.has(ct.key)) continue;
    coveredVariantKeys.add(ct.key);
    specs.push(buildContentVariant(ct, kind, dataset, manifest));
  }

  return specs;
}

/** Inputs for {@link buildContentPageScreen}: a single REAL content page. */
export interface ContentPageScreenInput {
  manifest: PreviewManifest;
  /** Page route/kind, e.g. `content.intro` | `content.info` | `content.summary`. */
  route: string;
  /** The content template key bound to the page (`manifest.contentTemplates[].key`). */
  templateKey?: string;
  /** Saved placeholder values for the page. */
  values: Record<string, unknown>;
  /** Course/test title for the `course` namespace. */
  courseTitle: string;
  /** `result` namespace (for `summary`/`resultField` placeholders); zeroed when absent. */
  result?: Record<string, unknown>;
  /**
   * PRD-8/PRD-4 router: REAL test topics for the router topic-menu. When the page
   * is the `router` (kind/route), the preview appends the real `.router-topic-cards`
   * built from these topics — so «Предпросмотр» of the маршрутизатор shows the
   * actual topic menu instead of an empty placeholder. Ignored for other kinds.
   */
  routerTopics?: RouterTopic[];
}

/**
 * Build a {@link ScreenSpec} for ONE real content page (single-page preview, FR-44):
 * resolves its layout key + content template, builds the placeholder skeleton, and
 * feeds the page's saved values into the renderer's `content` channel. Reuses the
 * same primitives as {@link buildScreenInputs}, so the page renders identically to
 * the runtime — no second renderer.
 *
 * NOT for the «Введение раздела» (`intro`) screen: that one renders through the
 * section-intro pipeline off REAL section facts (topic name, question count) the
 * caller owns, so the caller builds it — see `page-preview-modal`.
 */
export function buildContentPageScreen(inp: ContentPageScreenInput): ScreenSpec {
  const variant = findVariantForRoute(inp.manifest, inp.route, inp.templateKey);
  const layoutKey = resolveLayoutKey(inp.route, inp.manifest, variant);
  const tpl = findContentTemplate(inp.manifest, inp.templateKey);
  const placeholders = tpl?.placeholders ?? [];
  const skeleton = buildSkeleton(placeholders);
  // Router pages append the runtime topic-menu (`.router-topic-cards`) built from
  // the REAL test topics (same markup as buildOne / the SCORM runtime), so the
  // маршрутизатор preview shows the actual menu rather than an empty placeholder.
  const pageContent = isRouterScreen(inp.route, tpl?.kind)
    ? skeleton + buildRouterCards(inp.routerTopics ?? [])
    : skeleton;
  const result = inp.result ?? { scorePercent: 0, status: "", passed: false };
  return {
    id: inp.templateKey ?? inp.route,
    route: inp.route,
    layoutKey,
    expectedSlots: ["page-content"],
    input: {
      context: { course: { title: inp.courseTitle }, result },
      slots: { "page-content": pageContent },
      content: { template: { placeholders }, values: inp.values },
    },
  };
}
