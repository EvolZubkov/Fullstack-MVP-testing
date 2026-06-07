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
  /** Route key (matches a SmokeReport route — drives the status dot). */
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

const SECTION_LABELS: Record<string, string> = {
  pages: "Страницы",
  questions: "Вопросы",
  outcome: "Итоги и система",
};
const SECTION_ORDER = ["pages", "questions", "outcome"];

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
  "system.blocked": "Доступ ограничен",
  "system.transition": "Переход",
};

/** Map a route to its (section, type) grouping keys. */
function classify(route: string): { section: string; typeKey: string } {
  if (route === "start") return { section: "pages", typeKey: "start" };
  if (route === "content" || route.startsWith("content.")) {
    const sub = route.includes(".") ? route.split(".")[1] : "";
    return { section: "pages", typeKey: sub ? `content.${sub}` : "content" };
  }
  if (route === "question" || route.startsWith("question.")) {
    const sub = route.includes(".") ? route.split(".")[1] : "";
    return { section: "questions", typeKey: sub ? `question.${sub}` : "question" };
  }
  if (route === "results" || route.startsWith("results")) {
    return { section: "outcome", typeKey: "results" };
  }
  if (route.startsWith("system.")) {
    return { section: "outcome", typeKey: route };
  }
  return { section: "outcome", typeKey: route };
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
    type.variants.push({ route: spec.route, label: variantLabel(spec), spec });
  }

  return [...sections.values()].sort(
    (a, b) => SECTION_ORDER.indexOf(a.key) - SECTION_ORDER.indexOf(b.key),
  );
}
