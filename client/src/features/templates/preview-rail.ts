/**
 * @module features/templates/preview-rail
 * @description Groups the flat {@link ScreenSpec}[] produced by
 * {@link module:shared/template/preview-context} into the three-level rail the
 * preview/check modal shows: Раздел → Вариант → демонстрации.
 *
 * The middle level is the VARIANT the author actually picks in «Структура» — a
 * `manifest.contentTemplates[]` entry, named from the manifest. Screens are its
 * demonstrations: a template may bind several demo pages to ONE variant (as
 * `certification` does for its gallery), and those are slides of one variant, not
 * separate variants. Screens no variant backs (start, question.*, results,
 * system.*) keep the route-derived grouping, where the middle level is the route
 * family: a question TYPE (single/multiple/matching/ranking) is not a template
 * variant, and several `preview.routes[]` entries under one `section.type` prefix
 * nest as its sibling demonstrations.
 *
 * The render-status dot lives on every level that can be selected: on a screen
 * leaf, and on the variant itself, where it is the WORST status of its screens.
 */
import type { ScreenSpec } from "@shared/template/preview-context";
import type { SmokeRouteResult } from "@shared/template/smoke-runner";

export interface RailScreen {
  /** Unique screen id (matches a SmokeReport row — drives selection + status dot). */
  id: string;
  /** Semantic route (drives grouping/layout); not unique across demonstrations. */
  route: string;
  /** Display name of this demonstration. */
  label: string;
  spec: ScreenSpec;
}
export interface RailVariant {
  key: string;
  label: string;
  /** True when the group is a declared manifest variant (its name comes from there). */
  fromManifest: boolean;
  screens: RailScreen[];
}
export interface RailSection {
  key: string;
  label: string;
  variants: RailVariant[];
}

// Sections follow the spec taxonomy: the content-page kinds of PRD-1 §4.3
// (intro / info / router / questions / summary) plus the system surfaces —
// the results layout (spec-template-platform §8.3) and system pages (§5.4).
// Each kind/category is its own section so summary (итоговая страница) and the
// results screen are clearly distinct, and intro/info are not lumped together.
const SECTION_LABELS: Record<string, string> = {
  start: "Старт",
  // intro / summary are the symmetric per-SECTION bookends (PRD-4: `before_topic`
  // shows content.intro before a section's questions; `after_topic` shows
  // content.summary after the section result). Labelled symmetrically.
  intro: "Введение раздела",
  info: "Учебные страницы",
  router: "Маршрутизатор",
  questions: "Вопросы",
  summary: "Итог раздела",
  results: "Результаты теста",
  system: "Системные экраны",
};
const SECTION_ORDER = ["start", "intro", "info", "router", "questions", "summary", "results", "system"];

const TYPE_LABELS: Record<string, string> = {
  start: "Старт",
  "content.intro": "Введение",
  "content.info": "Учебный материал",
  "content.summary": "Итог",
  "content.router": "Маршрутизатор",
  "content.gallery": "Галерея",
  content: "Контент",
  "question.single": "Один вариант",
  "question.multiple": "Несколько вариантов",
  "question.matching": "Сопоставление",
  "question.ranking": "Ранжирование",
  question: "Вопрос",
  results: "Результаты",
  "results.adaptive": "Адаптивные результаты",
  // PRD-19 section-boundary nodes. Without these the rail falls back to the raw
  // route key and shows the author `review` / `section-results` in English.
  review: "Обзор раздела",
  "section-results": "Итоги раздела",
  "system.blocked": "Доступ ограничен",
  "system.transition": "Переход",
};

/**
 * Map a route to its (section, type) grouping keys following the spec taxonomy:
 * the route's content-page `kind` (PRD-1 §4.3) drives the section, so `intro`,
 * `info`, `router`, `questions` and `summary` each land in their own section,
 * while `results` (§8.3) and `system.*` (§5.4) are the system surfaces.
 */
function classify(route: string): { section: string; typeKey: string } {
  if (route === "start") return { section: "start", typeKey: "start" };
  if (route === "content.intro") return { section: "intro", typeKey: "content.intro" };
  if (route === "content.summary") return { section: "summary", typeKey: "content.summary" };
  if (route === "content.router" || route === "router") return { section: "router", typeKey: "content.router" };
  if (route === "content" || route.startsWith("content.")) {
    // Remaining content kinds (info and any future ones) → "Учебные страницы".
    const sub = route.includes(".") ? route.split(".")[1] : "";
    return { section: "info", typeKey: sub ? `content.${sub}` : "content" };
  }
  if (route === "question" || route.startsWith("question.")) {
    const sub = route.includes(".") ? route.split(".")[1] : "";
    return { section: "questions", typeKey: sub ? `question.${sub}` : "question" };
  }
  if (route === "results" || route.startsWith("results")) {
    return { section: "results", typeKey: route === "results.adaptive" ? "results.adaptive" : "results" };
  }
  // PRD-19 «Обзор» / «Итоги раздела»: Core-generated section-boundary screens with
  // no author content — grouped with the other system surfaces.
  if (route === "review" || route === "section-results") {
    return { section: "system", typeKey: route };
  }
  if (route.startsWith("system.")) {
    return { section: "system", typeKey: route };
  }
  return { section: "system", typeKey: route };
}

function typeLabel(typeKey: string): string {
  return TYPE_LABELS[typeKey] ?? typeKey;
}

/** A readable screen label, preferring the route's manifest label. */
function screenLabel(spec: ScreenSpec): string {
  return spec.label?.trim() || spec.route;
}

/**
 * The rail group a screen belongs to. A screen backed by a `contentTemplates[]`
 * variant groups under THAT variant, named from the manifest — this is what makes
 * the author-facing variant name visible and keeps its demo pages together. Every
 * other screen groups by its route family, as before.
 *
 * Manifest keys are namespaced (`v:`) so a variant whose key happens to equal a
 * route-derived type key cannot silently merge with it.
 */
function groupOf(spec: ScreenSpec, typeKey: string): { key: string; label: string; fromManifest: boolean } {
  if (spec.variantKey) {
    return {
      key: "v:" + spec.variantKey,
      label: spec.variantLabel?.trim() || spec.variantKey,
      fromManifest: true,
    };
  }
  return { key: typeKey, label: typeLabel(typeKey), fromManifest: false };
}

/**
 * Build the grouped rail from preview screen specs, preserving declaration order
 * within each level and the canonical section order.
 */
export function buildRail(specs: ScreenSpec[]): RailSection[] {
  const sections = new Map<string, RailSection>();

  for (const spec of specs) {
    const { section: sectionKey, typeKey } = classify(spec.route);
    let section = sections.get(sectionKey);
    if (!section) {
      section = { key: sectionKey, label: SECTION_LABELS[sectionKey] ?? sectionKey, variants: [] };
      sections.set(sectionKey, section);
    }
    const group = groupOf(spec, typeKey);
    let variant = section.variants.find((v) => v.key === group.key);
    if (!variant) {
      variant = { key: group.key, label: group.label, fromManifest: group.fromManifest, screens: [] };
      section.variants.push(variant);
    }
    variant.screens.push({ id: spec.id, route: spec.route, label: screenLabel(spec), spec });
  }

  return [...sections.values()].sort(
    (a, b) => SECTION_ORDER.indexOf(a.key) - SECTION_ORDER.indexOf(b.key),
  );
}

/** Status severity — a variant reports the worst status among its screens. */
const STATUS_RANK: Record<string, number> = { pass: 0, warn: 1, fail: 2 };

/**
 * Roll a variant's screen statuses up to the group dot: the worst one present.
 * Returns `undefined` while any screen has no result yet, so a partially checked
 * group stays neutral instead of claiming a verdict it does not have.
 * @param variant  Rail variant to summarize
 * @param statusById  Smoke results keyed by screen id
 * @returns worst status of the variant's screens, or `undefined` if unknown
 */
export function variantStatus(
  variant: RailVariant,
  statusById: Map<string, SmokeRouteResult>,
): SmokeRouteResult["status"] | undefined {
  let worst: SmokeRouteResult["status"] | undefined;
  for (const screen of variant.screens) {
    const status = statusById.get(screen.id)?.status;
    if (!status) return undefined;
    if (!worst || STATUS_RANK[status] > STATUS_RANK[worst]) worst = status;
  }
  return worst;
}
