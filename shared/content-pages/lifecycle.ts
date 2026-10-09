/**
 * @module shared/content-pages/lifecycle
 * @description Pure planning for system `content_pages` rows (PRD-1 §4.3.5,
 * PRD-7 §1.4). Given the desired state of a test (flowMode, topics, template)
 * and the existing system rows in DB, produces a diff plan: which rows to
 * keep, create, or delete, plus parameter transfers when `kind: questions`
 * collapses or expands across topics.
 *
 * The planner is pure: it does not touch the database, the file system, or
 * any external state. Callers (TestSettingsService) execute the plan inside
 * their own transactions.
 *
 * Живёт в `shared/`, потому что по нему работают ОБА хоста, и ответ обязан быть один:
 * сервер раскладывает строки в транзакции создания/сохранения теста, а редактор
 * ПРЕДСКАЗЫВАЕТ ту же раскладку для теста, которого ещё нет, — вкладка «Структура»
 * нового теста показывает те самые узлы, которые создаст INSERT. Вторая реализация
 * разошлась бы с первой на ближайшей правке, и автор увидел бы перед сохранением одно,
 * а получил другое. Для несохранённого теста вызывается с пустым `existing`: план
 * состоит из одних `create`, и это и есть будущая структура.
 *
 * System kinds covered here:
 *   - `start`           — always exactly one row (`topicId: null`)
 *   - `results`         — always exactly one row (`topicId: null`)
 *   - `router`          — exactly one row (`topicId: null`) iff flowMode = router_by_topics
 *   - `questions`       — one row (`topicId: null`) in linear_flat, one per topic in
 *                         linear_by_topics / router_by_topics
 *   - `intro`           — PRD-1 §4.3 «Введение раздела». One row PER TOPIC in
 *                         per-topic modes; none in linear_flat. Renders topic name /
 *                         description / question count / time limit + an author
 *                         instruction at section start.
 *   - `review`          — PRD-19 обзор (section-finish / test-finish). Exactly one
 *                         row (`topicId: null`): a test-level DESIGN binding for the
 *                         runtime obзор node. Always present (like start/results);
 *                         the editor/runtime gate its display by the «возврат к
 *                         неотвеченным» setting (FR-08a) and hide it for adaptive.
 *   - `section-results` — PRD-19 итоги раздела. Exactly one row (`topicId: null`)
 *                         in per-topic modes (linear_by_topics / router_by_topics):
 *                         a test-level design binding for the runtime section-results
 *                         node, gated for display by the `showSectionResults` setting.
 *
 * The user kind `info` is NOT planned here — `info` pages are author-created
 * and survive flowMode changes unchanged (FR-40).
 *
 * The legacy per-topic `summary` («Итог раздела») is NO LONGER planned — its role is
 * the computed `section-results` node. Existing `summary` rows are removed by migration.
 */
import type { TemplateManifest } from "@shared/schema";
import { resolveFlowPolicy } from "@shared/flow/flow-policy";
import { bindSystemVariant } from "./variant-binding";

export type FlowMode = "linear_flat" | "linear_by_topics" | "router_by_topics";

/** System kinds the planner manages (excludes `info` and the deprecated per-topic
 *  `summary` — its «Итог раздела» role is now the computed `section-results` node).
 *  `intro` («Введение раздела») is a per-topic system node (PRD-1 §4.3). */
export const SYSTEM_KINDS = ["start", "results", "router", "questions", "intro", "review", "section-results"] as const;
export type SystemKind = (typeof SYSTEM_KINDS)[number];

/** A system content_pages row currently in the database. */
export interface ExistingSystemPage {
  id: string;
  kind: SystemKind;
  topicId: string | null;
  templateKey: string | null;
  /** Free-form values for variant placeholders. Carried across rebuilds. */
  valuesJson: Record<string, unknown>;
}

/** The desired test state the planner reconciles against. */
export interface DesiredTestState {
  flowMode: FlowMode;
  /** Topic ids in author-defined order (test_sections.sortOrder is irrelevant
   *  for this planner — caller passes the resolved order). */
  topicIds: string[];
  /** Manifest of the test's currently bound template. */
  template: TemplateManifest;
  /** Manifest of the built-in `default` template — used as fallback per
   *  PRD-1 §4.3.2 when the test's own template lacks a system kind. */
  defaultTemplate: TemplateManifest;
}

/** A row to be inserted by the caller. `id` is allocated by the DB. */
export interface ContentPageInsert {
  kind: SystemKind;
  topicId: string | null;
  templateKey: string;
  /** Either freshly defaulted ({}) or transferred from a removed row. */
  valuesJson: Record<string, unknown>;
  /** PRD-1 §4.3.2: hints for the UI when the planner falls back or finds
   *  multiple variants of this kind in the template. */
  bindingHints: {
    fallbackUsed: boolean;
    hasMultipleChoices: boolean;
  };
}

/** The diff plan: rows to keep, create, delete. Mutations applied in this
 *  order (delete → create) inside a single transaction by the caller. */
export interface ContentPagesPlan {
  keep: Array<{ id: string }>;
  create: ContentPageInsert[];
  delete: Array<{ id: string }>;
}

/** Id of the built-in template every test falls back to (NFR-01). */
export const DEFAULT_TEMPLATE_ID = "default";

/**
 * Extracts `flowMode` from `tests.flow_policy_json`, defaulting per FR-40.
 *
 * Lives HERE, next to the planner it feeds, because two callers must read the column
 * the same way: the settings service, which reconciles the rows, and the workbook
 * import, which has to PREDICT that reconciliation for its dry-run preview. A second
 * copy of the default is how the preview would start promising a different plan.
 */
export function extractFlowMode(flowPolicyJson: unknown): FlowMode {
  // Delegated to the SHARED normaliser both runtimes read the column with: the
  // authoring side must plan the structure for the mode the run will actually take,
  // and a third copy of «what an unreadable mode means» is a third chance to disagree.
  return resolveFlowPolicy(flowPolicyJson).mode;
}

/** Extracts `templateId` from `tests.design_settings_json`, defaulting per NFR-01. */
export function extractTemplateId(designSettingsJson: unknown): string {
  if (typeof designSettingsJson === "object" && designSettingsJson !== null) {
    const id = (designSettingsJson as { templateId?: unknown }).templateId;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return DEFAULT_TEMPLATE_ID;
}

/** Returns true when `flowMode` requires per-topic `kind: questions` rows. */
export function isPerTopicMode(flowMode: FlowMode): boolean {
  return flowMode === "linear_by_topics" || flowMode === "router_by_topics";
}

/** Returns true when `flowMode` requires a `kind: router` row. */
export function needsRouter(flowMode: FlowMode): boolean {
  return flowMode === "router_by_topics";
}

// ─── Материализация запланированной строки ───────────────────────────────────
//
// Раскладка `position`/`type` — часть плана, а не деталь вставки: редактор строит по
// ней ПРЕДСКАЗАННЫЕ строки для теста, которого ещё нет, и они обязаны совпасть с тем,
// что вставит транзакция. Раньше обе функции жили в сервисе сохранения, и второй
// копии для клиента взяться было неоткуда.

/** Legacy `type` value for a freshly-created system row. `questions`/`router`
 *  have no native legacy mapping — we pick `info` since the column will be
 *  dropped in a future release (PRD-7 §1.12). */
export function legacyTypeForKind(kind: SystemKind): "intro" | "info" | "summary" | "html" {
  switch (kind) {
    case "intro":   return "intro"; // section «Введение раздела»
    case "section-results": // section «Итоги раздела» — results-shaped legacy type
    case "results": return "summary";
    case "start":   // start/router/questions/review have no native legacy type
    case "router":  // (column is deprecated, PRD-7 §1.12) — "info" is the neutral
    case "questions": // placeholder.
    case "review":
    default:        return "info";
  }
}

/** Position value for a system row. The position column was designed for
 *  content-page placement before/after a topic; system kinds reuse it on a
 *  best-fit basis (start/router → "before", results → "after",
 *  summary → "after_topic", intro/questions → "before_topic").
 *
 *  `router` is test-scope (topicId = null): it is the «До теста» navigation hub
 *  shown before the topics, so it MUST be "before" — the router runtime seeds the
 *  initial pageSequence from the test-scope "before" pages (PRD-4 v1.1 §4.7;
 *  contentFlow.rebuildPageSequence). Placing it at "before_topic" orphans the hub
 *  (no per-topic loop matches a null topicId), so the flow skips straight to the
 *  questions and the router page never renders. */
export function positionForKind(kind: SystemKind): "before" | "after" | "before_topic" | "after_topic" {
  switch (kind) {
    case "start":   return "before"; // test landing — «До теста», before everything
    case "router":  return "before"; // router hub — test-scope «До теста», before the topics
    case "results": return "after";  // test final results — «После теста»
    // PRD-19 runtime nodes (обзор / итоги раздела): test-level singletons rendered
    // by their own runtime phase and EXCLUDED from the content-page flow by kind
    // (contentFlow.contentPagesFor), so the position is cosmetic — "after" keeps
    // them out of the per-topic before/after zones.
    case "review":
    case "section-results": return "after";
    case "intro":   // section «Введение раздела» — before the topic's questions
    case "questions":
    default:        return "before_topic";
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Plans the single-row-per-test system kinds (start, results, router, review,
 *  section-results). */
function planSingletonKind(
  kind: "start" | "results" | "router" | "review" | "section-results",
  existing: ExistingSystemPage[],
  desired: DesiredTestState,
  required: boolean,
): { keep: Array<{ id: string }>; create: ContentPageInsert[]; delete: Array<{ id: string }> } {
  const owned = existing.filter((e) => e.kind === kind);

  if (!required) {
    return { keep: [], create: [], delete: owned.map((e) => ({ id: e.id })) };
  }

  const binding = bindSystemVariant(desired.template, desired.defaultTemplate, kind);
  if (!binding) {
    // No variant of this kind in template nor default. Hard error — we cannot
    // create the row. Caller must surface this. We keep existing rows so data
    // is not lost, but emit no inserts.
    return { keep: owned.map((e) => ({ id: e.id })), create: [], delete: [] };
  }

  if (owned.length === 0) {
    return {
      keep: [],
      create: [{
        kind,
        topicId: null,
        templateKey: binding.variantKey,
        valuesJson: {},
        bindingHints: {
          fallbackUsed: binding.fallbackUsed,
          hasMultipleChoices: binding.hasMultipleChoices,
        },
      }],
      delete: [],
    };
  }

  // One or more exist — keep the first (oldest by insertion order assumed),
  // delete duplicates. Caller does not rebind the kept row here; rebinding on
  // template change is the job of a separate flow (block 1D).
  const [first, ...rest] = owned;
  return {
    keep: [{ id: first.id }],
    create: [],
    delete: rest.map((e) => ({ id: e.id })),
  };
}

/**
 * Plans `kind: questions` rows. Per flowMode:
 *   - linear_flat: 1 row with topicId=null
 *   - linear_by_topics / router_by_topics: 1 row per topic
 *
 * Parameter transfer:
 *   - When collapsing N → 1 (any-per-topic mode → linear_flat): values from
 *     the FIRST existing per-topic row are carried to the new flat row.
 *   - When expanding 1 → N (linear_flat → per-topic): values from the flat
 *     row are copied to EACH new per-topic row.
 *   - When topic list changes (within per-topic mode): values for existing
 *     topics are preserved by topicId match; new topics get {}.
 */
function planQuestionsKind(
  existing: ExistingSystemPage[],
  desired: DesiredTestState,
): { keep: Array<{ id: string }>; create: ContentPageInsert[]; delete: Array<{ id: string }> } {
  const owned = existing.filter((e) => e.kind === "questions");
  const binding = bindSystemVariant(desired.template, desired.defaultTemplate, "questions");

  if (!binding) {
    // No questions variant anywhere — would mean the system contract is
    // violated (default schema enforces this). Keep existing rows; emit none.
    return { keep: owned.map((e) => ({ id: e.id })), create: [], delete: [] };
  }

  const hints = {
    fallbackUsed: binding.fallbackUsed,
    hasMultipleChoices: binding.hasMultipleChoices,
  };

  if (desired.flowMode === "linear_flat") {
    // Want exactly one row with topicId = null.
    const flat = owned.find((e) => e.topicId === null);

    if (flat) {
      // Keep the existing flat row, delete any per-topic rows.
      return {
        keep: [{ id: flat.id }],
        create: [],
        delete: owned.filter((e) => e.id !== flat.id).map((e) => ({ id: e.id })),
      };
    }

    // No flat row — collapse: take values from first per-topic row.
    const inheritedValues = owned[0]?.valuesJson ?? {};
    return {
      keep: [],
      create: [{
        kind: "questions",
        topicId: null,
        templateKey: binding.variantKey,
        valuesJson: { ...inheritedValues },
        bindingHints: hints,
      }],
      delete: owned.map((e) => ({ id: e.id })),
    };
  }

  // Per-topic modes: want one row per topic in `topicIds`.
  const wanted = new Set(desired.topicIds);
  const byTopic = new Map<string, ExistingSystemPage>();
  for (const e of owned) {
    if (e.topicId !== null && !byTopic.has(e.topicId)) byTopic.set(e.topicId, e);
  }
  const flatRow = owned.find((e) => e.topicId === null);
  const inheritedFromFlat = flatRow?.valuesJson ?? null;

  const keep: Array<{ id: string }> = [];
  const create: ContentPageInsert[] = [];
  const toDelete = new Set<string>();

  for (const topicId of desired.topicIds) {
    const existingForTopic = byTopic.get(topicId);
    if (existingForTopic) {
      keep.push({ id: existingForTopic.id });
    } else {
      create.push({
        kind: "questions",
        topicId,
        templateKey: binding.variantKey,
        // Expanding from a flat row: each new per-topic row inherits the flat
        // values. Otherwise (new topic added to existing per-topic mode):
        // fresh empty values.
        valuesJson: inheritedFromFlat ? { ...inheritedFromFlat } : {},
        bindingHints: hints,
      });
    }
  }

  // Drop rows whose topicId is no longer in the desired set, plus the flat row
  // (it has been collapsed into the per-topic rows).
  for (const e of owned) {
    if (e.topicId === null) {
      toDelete.add(e.id);
    } else if (!wanted.has(e.topicId)) {
      toDelete.add(e.id);
    }
  }

  return {
    keep,
    create,
    delete: Array.from(toDelete).map((id) => ({ id })),
  };
}

/**
 * Plans the per-topic `intro` («Введение раздела») system rows (PRD-1 §4.3): one
 * row per topic in per-topic modes (linear_by_topics / router_by_topics); ZERO rows
 * in linear_flat (no sections). Rows are preserved by topicId across topic-list
 * changes; a flowMode transition out of per-topic deletes them, and into per-topic
 * creates fresh ones. Mirrors planQuestionsKind's per-topic preservation.
 */
function planPerTopicIntro(
  existing: ExistingSystemPage[],
  desired: DesiredTestState,
): { keep: Array<{ id: string }>; create: ContentPageInsert[]; delete: Array<{ id: string }> } {
  const owned = existing.filter((e) => e.kind === "intro");
  const binding = bindSystemVariant(desired.template, desired.defaultTemplate, "intro");
  if (!binding) {
    // No intro variant anywhere — keep existing rows, create none (caller surfaces).
    return { keep: owned.map((e) => ({ id: e.id })), create: [], delete: [] };
  }
  const hints = { fallbackUsed: binding.fallbackUsed, hasMultipleChoices: binding.hasMultipleChoices };

  // linear_flat: no sections → remove any leftover intro rows.
  if (!isPerTopicMode(desired.flowMode)) {
    return { keep: [], create: [], delete: owned.map((e) => ({ id: e.id })) };
  }

  // Per-topic modes: exactly one row per topic, preserved by topicId.
  const byTopic = new Map<string, ExistingSystemPage>();
  for (const e of owned) {
    if (e.topicId !== null && !byTopic.has(e.topicId)) byTopic.set(e.topicId, e);
  }
  const keep: Array<{ id: string }> = [];
  const create: ContentPageInsert[] = [];
  const keptIds = new Set<string>();
  for (const topicId of desired.topicIds) {
    const ex = byTopic.get(topicId);
    if (ex) {
      keep.push({ id: ex.id });
      keptIds.add(ex.id);
    } else {
      create.push({ kind: "intro", topicId, templateKey: binding.variantKey, valuesJson: {}, bindingHints: hints });
    }
  }
  // Delete everything not kept: null-topic rows, stale-topic rows AND duplicates.
  const toDelete = owned.filter((e) => !keptIds.has(e.id)).map((e) => ({ id: e.id }));
  return { keep, create, delete: toDelete };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Reconciles existing system content_pages rows with the desired test state
 * (flowMode + topics + template), producing a diff plan. Pure function — no
 * side effects. Caller persists the plan inside a transaction.
 */
export function planSystemPages(
  existing: ExistingSystemPage[],
  desired: DesiredTestState,
): ContentPagesPlan {
  // `start` is the test landing screen — a single test-level row (До теста),
  // always present, template-backed (PRD-1 §4.3: template-backed start).
  const start = planSingletonKind("start", existing, desired, true);
  // `results` is the test-level final-results screen («После теста»), a single
  // row, template-backed like start (PRD-1 §4.3: «Итоги теста»).
  const results = planSingletonKind("results", existing, desired, true);
  const router = planSingletonKind("router", existing, desired, needsRouter(desired.flowMode));
  const questions = planQuestionsKind(existing, desired);
  // PRD-1 §4.3: `intro` («Введение раздела») is a per-topic system node — one row per
  // topic in per-topic modes, none in linear_flat.
  const intro = planPerTopicIntro(existing, desired);
  // PRD-19 §3.2: `review` (обзор — section-finish / test-finish) is a test-level
  // DESIGN binding for the runtime обзор node — always present, like start/results.
  // Its actual display is gated by the «возврат к неотвеченным» setting (FR-08a)
  // and hidden for adaptive tests; that gating lives in the editor/runtime, not here.
  const review = planSingletonKind("review", existing, desired, true);
  // PRD-19 FR-05a: `section-results` (итоги раздела) is a test-level design binding
  // for the runtime section-results node — only meaningful when the test HAS sections
  // (per-topic modes). Its display is gated by the `showSectionResults` setting.
  const sectionResults = planSingletonKind(
    "section-results",
    existing,
    desired,
    isPerTopicMode(desired.flowMode),
  );

  return {
    keep: [...start.keep, ...results.keep, ...router.keep, ...questions.keep, ...intro.keep, ...review.keep, ...sectionResults.keep],
    create: [...start.create, ...results.create, ...router.create, ...questions.create, ...intro.create, ...review.create, ...sectionResults.create],
    delete: [...start.delete, ...results.delete, ...router.delete, ...questions.delete, ...intro.delete, ...review.delete, ...sectionResults.delete],
  };
}
