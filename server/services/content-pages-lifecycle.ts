/**
 * @module server/services/content-pages-lifecycle
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
 * System kinds covered here:
 *   - `intro`     — always exactly one row (`topicId: null`)
 *   - `summary`   — always exactly one row (`topicId: null`)
 *   - `router`    — exactly one row (`topicId: null`) iff flowMode = router_by_topics
 *   - `questions` — one row (`topicId: null`) in linear_flat, one per topic in
 *                   linear_by_topics / router_by_topics
 *
 * The user kind `info` is NOT planned here — `info` pages are author-created
 * and survive flowMode changes unchanged (FR-40).
 */
import type { VariantKind, TemplateManifest } from "@shared/schema";
import { bindSystemVariant } from "./variant-binding";

export type FlowMode = "linear_flat" | "linear_by_topics" | "router_by_topics";

/** System kinds the planner manages (excludes `info`). */
export const SYSTEM_KINDS = ["start", "intro", "summary", "results", "router", "questions"] as const;
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

/** Returns true when `flowMode` requires per-topic `kind: questions` rows. */
export function isPerTopicMode(flowMode: FlowMode): boolean {
  return flowMode === "linear_by_topics" || flowMode === "router_by_topics";
}

/** Returns true when `flowMode` requires a `kind: router` row. */
export function needsRouter(flowMode: FlowMode): boolean {
  return flowMode === "router_by_topics";
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Plans the single-row-per-test system kinds (start, results, router). */
function planSingletonKind(
  kind: "start" | "results" | "router",
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
 * Plans a PER-TOPIC-ONLY system kind (`intro` = «Введение раздела»,
 * `summary` = «Итоги раздела»). One row per topic in per-topic modes
 * (linear_by_topics / router_by_topics); ZERO rows in linear_flat — a flat test
 * has no section, so it has no section intro/summary (PRD-1 §4.3 structure model).
 *
 * Rows are preserved by topicId across topic-list changes; a flowMode transition
 * out of per-topic deletes them, and into per-topic creates fresh ones.
 */
function planPerTopicOnlyKind(
  kind: "intro" | "summary",
  existing: ExistingSystemPage[],
  desired: DesiredTestState,
): { keep: Array<{ id: string }>; create: ContentPageInsert[]; delete: Array<{ id: string }> } {
  const owned = existing.filter((e) => e.kind === kind);
  const binding = bindSystemVariant(desired.template, desired.defaultTemplate, kind);
  if (!binding) {
    return { keep: owned.map((e) => ({ id: e.id })), create: [], delete: [] };
  }
  const hints = {
    fallbackUsed: binding.fallbackUsed,
    hasMultipleChoices: binding.hasMultipleChoices,
  };

  // linear_flat: section intro/summary do not exist → remove any leftover rows.
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
      create.push({ kind, topicId, templateKey: binding.variantKey, valuesJson: {}, bindingHints: hints });
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
  // always present, like intro/summary (PRD-1 §4.3: template-backed start).
  const start = planSingletonKind("start", existing, desired, true);
  // intro/summary are per-SECTION («Введение раздела»/«Итоги раздела») — one per
  // topic in per-topic modes, none in linear_flat.
  const intro = planPerTopicOnlyKind("intro", existing, desired);
  const summary = planPerTopicOnlyKind("summary", existing, desired);
  // `results` is the test-level final-results screen («После теста»), a single
  // row, template-backed like start (PRD-1 §4.3: «Итоги теста»).
  const results = planSingletonKind("results", existing, desired, true);
  const router = planSingletonKind("router", existing, desired, needsRouter(desired.flowMode));
  const questions = planQuestionsKind(existing, desired);

  return {
    keep: [...start.keep, ...intro.keep, ...summary.keep, ...results.keep, ...router.keep, ...questions.keep],
    create: [...start.create, ...intro.create, ...summary.create, ...results.create, ...router.create, ...questions.create],
    delete: [...start.delete, ...intro.delete, ...summary.delete, ...results.delete, ...router.delete, ...questions.delete],
  };
}
