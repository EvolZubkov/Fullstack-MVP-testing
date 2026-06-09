/**
 * @module features/templates/preview-rail
 * @description Groups the flat {@link ScreenSpec}[] produced by
 * {@link module:shared/template/preview-context} into the three-level rail the
 * approved wireframe uses in the preview/check modal: Раздел → Тип → Вариант
 * отрисовки. The render-status dot lives on the variant (leaf); section and type
 * are grouping only.
 *
 * A question TYPE (single/multiple/matching/ranking) is not a template variant —
 * each type may itself carry several render variants (e.g. «Один вариант» →
 * «Радио-список»/«Карточки»). When `manifest.preview.routes[]` lists several
 * entries under the same `section.type` prefix they nest as sibling variants;
 * the shipping `default` declares one variant per type, so each type shows a
 * single leaf.
 */
import type { ScreenSpec } from "@shared/template/preview-context";

export interface RailVariant {
  /** Unique screen id (matches a SmokeReport row — drives selection + status dot). */
  id: string;
  /** Semantic route (drives grouping/layout); not unique across render variants. */
  route: string;
  /** Display name of this render variant. */
  label: string;
  spec: ScreenSpec;
}
export interface RailType {
  key: string;
  label: string;
  variants: RailVariant[];
}
export interface RailSection {
  key: string;
  label: string;
  types: RailType[];
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
  content: "Контент",
  "question.single": "Один вариант",
  "question.multiple": "Несколько вариантов",
  "question.matching": "Сопоставление",
  "question.ranking": "Ранжирование",
  question: "Вопрос",
  results: "Результаты",
  "results.adaptive": "Адаптивные результаты",
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
  if (route.startsWith("system.")) {
    return { section: "system", typeKey: route };
  }
  return { section: "system", typeKey: route };
}

function typeLabel(typeKey: string): string {
  return TYPE_LABELS[typeKey] ?? typeKey;
}

/** A readable variant label, preferring the route's manifest label. */
function variantLabel(spec: ScreenSpec): string {
  return spec.label?.trim() || spec.route;
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
      section = { key: sectionKey, label: SECTION_LABELS[sectionKey] ?? sectionKey, types: [] };
      sections.set(sectionKey, section);
    }
    let type = section.types.find((t) => t.key === typeKey);
    if (!type) {
      type = { key: typeKey, label: typeLabel(typeKey), variants: [] };
      section.types.push(type);
    }
    type.variants.push({ id: spec.id, route: spec.route, label: variantLabel(spec), spec });
  }

  return [...sections.values()].sort(
    (a, b) => SECTION_ORDER.indexOf(a.key) - SECTION_ORDER.indexOf(b.key),
  );
}
