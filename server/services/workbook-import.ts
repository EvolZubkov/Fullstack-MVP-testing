/**
 * @module server/services/workbook-import
 *
 * Multi-sheet workbook import for ONE test (PRD-14 FR-15). Role sheets are recognized by
 * name and a missing one is skipped — that is what every book exported before a sheet
 * existed has to keep meaning:
 *
 * - «Настройки» — the test's own parameters (PRD-48 §4.1);
 * - «Вопросы» — the questions themselves (GLOBAL: they belong to topics, not to the test);
 * - «Шкалы», «Показатели», «Вклады вопросов» — scales, result variables, contributions;
 * - «Оценка» — the per-test scoring overrides (PRD-15 block D);
 * - «Структура», «Квоты», «Пороги вариантов» — sections, per-tag draw quotas, per-variant
 *   pass thresholds;
 * - «Обратная связь» + «Рекомендации» — feedback of the test and of its sections, with the
 *   courses/materials/events that live inside it (PRD-48 FR-12/FR-13);
 * - «Страницы» + «Поля страниц» — the test's content pages and their field values
 *   (PRD-48 FR-14/FR-15);
 * - «Адаптивные уровни» — the levels of the adaptive topics, with their materials taken
 *   off «Рекомендации» (PRD-48 FR-16). They ride into the same save as the sections: the
 *   service takes them only as `adaptiveSettings` of that payload;
 * - «Оформление» — the test's design and the settings of its report (PRD-48 FR-17/FR-18).
 *
 * Everything except the questions is written into the target `testId`.
 *
 * Multi-pass order (FR-15.7): «Настройки», «Обратная связь» and «Рекомендации» are READ
 * first and applied later — they ride into the same save as the structure. Then questions
 * (фиксируем `ID`↔`Ключ строки`), scales (upsert by `key`), measurements (resolve question
 * by `ID`/alias and scale by `key`) and result variables (validate formula), then the
 * per-test scoring overrides (from the «Оценка» sheet, or, when it is absent, derived from
 * the legacy «Балл»/«Цена ответа» columns of the «Вопросы» sheet), then the structure +
 * quotas (FR-16), then «Оформление» — its report settings join the settings patch, while its
 * design goes by its OWN write, the one `PUT /api/tests/:id/design` performs. ONE save applies
 * the settings and the sections together. The content pages come LAST, and only there: the
 * system pages the book expects to find are materialised by that save out of the scenario and
 * the topic list, and the design template is by then the one whose manifest types their
 * fields.
 *
 * Writes are skipped under `dryRun`; everything else is not. The preview must report the plan
 * the WRITING run would carry out, so a pass whose result depends on what an earlier pass
 * would have changed reads that state as PROJECTED, never as found: the pages pass gets the
 * system rows the save materialises ({@link projectSystemPages}) and the template the design
 * sheet binds, and the settings service's refusal is computed instead of caught. `dryRun`
 * forbids changing the target, not looking at it (FR-13, §8.6).
 *
 * Upsert keys (FR-15 idempotency): scale = (test, key); result variable =
 * (test, name); measurements are replaced per question (the sheet is
 * authoritative for a question's contributions, matching the editor's PUT);
 * scoring overrides are replaced per test (the «Оценка» sheet is authoritative
 * for the test's override set); a system page is found by «вид + тема» and never created,
 * while author pages are replaced per ZONE — they have no key of their own.
 */

import type ExcelJS from "exceljs";
import { and, eq, inArray } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { sheetHeaders, sheetToObjects } from "../utils/excel";
import {
  templates,
  insertScaleSchema,
  insertResultVariableSchema,
  type Scale,
  type ResultVariable,
  type DrawStratum,
  type QuestionScoring,
  type InsertTestQuestionScoring,
  type FormSet,
  type Test,
  type ContentPage,
  type TemplateManifest,
} from "@shared/schema";
import { buildFormSet, parseVariantNumbers, type VariantMembership } from "@shared/draw/forms";
import { randomUUID } from "crypto";
import type { ValueType } from "@shared/formula";
import type { Role } from "@shared/access";
import { importQuestionRows, type ResolvedQuestion } from "./questions-import";
import { syncEntityUsages, syncScaleFeedbackUsages, syncVariableFeedbackUsages } from "./media/usage-index";
// PRD-48 Э3: the page-field rules live in ONE place, and the workbook calls exactly the
// functions the page editor calls — a second, «simpler» path here would turn the book into
// an entry point past the sanitiser.
import {
  resolveContentTemplates,
  findContentTemplate,
  normalizeValuesForTemplate,
  normalizeSettingsForTemplate,
  sanitizeAllStringValues,
  ContentPageFieldError,
  type ContentTemplateEntry,
} from "./content-page-fields";
// PRD-48 Э5: the design/report values are typed by the RECEIVING manifest in ONE place,
// and the import calls it instead of re-implementing the design route's checks loosely.
import { normalizeDesignParams, normalizeReportBranch } from "./design-fields";
import { supportsThemes } from "@shared/template/themes";
import { logger } from "../logger";
import {
  testSettingsService,
  type SectionPayload,
  type AdaptiveTopicPayload,
} from "./test-settings";
// PRD-48: the preview has to PREDICT the system pages the save of this same run
// materialises, so it runs the very planner the settings service executes — importing it
// from the pure module keeps one contract instead of two that drift.
import {
  planSystemPages,
  extractFlowMode,
  extractTemplateId,
  DEFAULT_TEMPLATE_ID,
  SYSTEM_KINDS,
  type SystemKind,
  type ExistingSystemPage,
} from "./content-pages-lifecycle";
import { FlowPolicyValidationError, validateFlowPolicy } from "./flow-policy-validator";
import { parseScoringCell } from "../utils/scoring-excel";
import { hasOptionList, isMeasurementOnly, distributesBudget } from "@shared/questions/question-type";

import {
  parseScaleRow,
  mergeScaleConfig,
  parseResultVariableRow,
  parseMeasurementRow,
  validateSourceKey,
  parseSettingsSheet,
  emptySettingsDraft,
  parseStructureRow,
  parseQuotaRow,
  parseVariantThresholdRow,
  parseScoringOverrideRow,
  variantsColumnOf,
  parseFeedbackSheets,
  FEEDBACK_SHEET_NAME,
  RECOMMENDATION_SHEET_NAME,
  parsePageSheets,
  formatPageAddress,
  formatPageZone,
  PAGE_SHEET_NAME,
  PAGE_FIELD_SHEET_NAME,
  parseAdaptiveLevelSheet,
  adaptiveLevelKey,
  ADAPTIVE_LEVEL_SHEET_NAME,
  parseDesignSheet,
  DESIGN_SHEET_NAME,
  type ReportMode,
  type ParsedQuota,
  type SettingsDraft,
  type FeedbackPayload,
  type ParsedFeedbackSheets,
  type ParsedPage,
  type ParsedAdaptiveSheet,
} from "../utils/workbook-sheets";

export interface WorkbookImportResult {
  questions: { created: number; updated: number; skipped: number };
  scales: { created: number; updated: number };
  resultVariables: { created: number; updated: number };
  measurements: { rows: number; questions: number };
  /** PRD-15 block D (FR-36): per-test overrides written from «Оценка». */
  scoring: { rows: number };
  /** PRD-14 FR-16: sections + quotas written from «Структура»/«Квоты». */
  structure: { sections: number; quotas: number };
  /**
   * PRD-48 FR-14/FR-15: pages touched by «Страницы»/«Поля страниц». System pages are only
   * ever `updated` — the book cannot create one; `created`/`deleted` count the author
   * pages of the zones the sheet named and therefore replaced.
   */
  pages: { updated: number; created: number; deleted: number };
  /**
   * PRD-48 §4.1: parameters of «Настройки» the import will apply. Counted from the parsed
   * draft, not from the rows of the sheet: a row the parser refused is reported in `errors`
   * and changes nothing, and the preview exists to say what WILL happen.
   */
  settings: { params: number };
  /**
   * PRD-48 FR-12/FR-13: owners («Обратная связь») whose feedback is applied, and the
   * recommendations («Рекомендации») attached to them. An owner the run did not claim —
   * a section absent from «Структура» — is an error, so it is counted by neither field.
   */
  feedback: { owners: number; recommendations: number };
  /**
   * PRD-48 FR-16: adaptive topics and their levels applied from «Адаптивные уровни». Only
   * topics a section of this run claimed are here, for the same reason as feedback.
   */
  adaptive: { topics: number; levels: number };
  /**
   * PRD-48 FR-17/FR-18: values of «Оформление» applied. `params` counts the design ones
   * (template, palette, flat parameters and per-palette overrides), `report` the report
   * ones (the switch, the chosen view and its fields). A value the receiving manifest does
   * not declare is dropped with a warning and is not counted.
   */
  design: { params: number; report: number };
  errors: string[];
  /**
   * Non-blocking notices: the book imports, but something in it is likely not
   * what the author meant (e.g. two competing sources of the same setting).
   */
  warnings: string[];
  dryRun: boolean;
}

/**
 * How many parameters the «Настройки» draft carries — what the preview reports as the
 * sheet's row count. Every branch of the draft is a group of keys destined for one column
 * of the test, plus the two scalars that are groups of one.
 */
function countSettingsParams(draft: SettingsDraft): number {
  const groups = [
    draft.test, draft.router, draft.overall, draft.retake, draft.attemptInterval,
    draft.plugin, draft.introResults, draft.introReport, draft.introRoot,
  ];
  return groups.reduce((n, g) => n + Object.keys(g).length, 0)
    + (draft.flowMode !== undefined ? 1 : 0)
    + (draft.folderPath !== undefined ? 1 : 0);
}

/** Recommendations inside one owner's feedback: courses, materials and events together. */
function countRecommendations(payload: FeedbackPayload | null | undefined): number {
  if (!payload) return 0;
  return (payload.links?.length ?? 0) + (payload.assets?.length ?? 0) + (payload.events?.length ?? 0);
}

/** Normalize a topic/section name for case/space-insensitive matching. */
function normalizeName(s: string): string {
  return s.replace(/[\s ​﻿]+/g, " ").trim().toLowerCase();
}

type QuestionType = "single" | "multiple" | "matching" | "ranking" | "scale";

/** Find a worksheet by role name (case-insensitive, trimmed). */
function findSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  const target = name.trim().toLowerCase();
  return wb.worksheets.find((w) => (w.name ?? "").trim().toLowerCase() === target);
}

/** Option/pair/item count of a stored question (for source-key validation). */
function unitCountOfQuestion(q: { type: string; dataJson: unknown }): number {
  const d = (q.dataJson ?? {}) as any;
  // A scale keeps its graduations in the same `options` list, so its source keys are
  // graduation indices validated against that count (PRD-26 FR-12).
  if (hasOptionList(q.type)) return d.options?.length ?? 0;
  if (q.type === "matching") return d.left?.length ?? 0;
  return d.items?.length ?? 0;
}

/**
 * `flow_policy_json` for the patch, or nothing at all.
 *
 * The flow is written ONLY when the book named it (PRD-48 FR-06). The import used to set
 * `router_by_topics` unconditionally (PRD-14 FR-16), so a linear test came back from an
 * export/import round trip as a router-page test.
 *
 * A linear scenario has no router page, so its settings are cleared instead of being left
 * behind as dead JSON. The reverse — moving TO the router — keeps the settings the book did
 * not mention, the same merge every other JSON column here does.
 *
 * The router branch alone (a book naming «Политика завершения маршрутизатора» without a
 * scenario) rides on the CURRENT mode. On a router test the named parameter is applied. On
 * a LINEAR one it is DROPPED — and that is the right outcome, not an oversight: a linear
 * test has no router page, so the policy has nothing to govern, and storing it would leave
 * dead JSON to be resurrected by a later scenario switch. Note what the drop still costs:
 * the branch returns `{ mode, router: null }`, so the save DOES run and clears whatever
 * router JSON the test carried. The scenario itself is never changed by this branch.
 */
function buildFlowPatch(draft: SettingsDraft, current: Test | undefined): Record<string, unknown> {
  const cur = (current?.flowPolicyJson ?? {}) as { mode?: unknown; router?: unknown };
  const hasRouterSettings = Object.keys(draft.router).length > 0;
  if (!draft.flowMode && !hasRouterSettings) return {};

  const mode = draft.flowMode ?? (typeof cur.mode === "string" ? cur.mode : "linear_flat");
  if (mode !== "router_by_topics") return { flowPolicyJson: { mode, router: null } };

  const curRouter = typeof cur.router === "object" && cur.router !== null ? cur.router : {};
  return { flowPolicyJson: { mode, router: { ...curRouter, ...draft.router } } };
}

/**
 * Patch for the `tests` row built from the «Настройки» draft.
 *
 * JSON columns are merged OVER the current value rather than rebuilt from scratch: a
 * «Период охлаждения» row without a «Разделять период» row would otherwise wipe the half
 * of the policy the book never mentioned (FR-20).
 *
 * The save goes through here once, whatever else the book carries, so a parameter is
 * applied on the same terms in a book of settings alone and in a book of the whole test.
 */
function buildTestPatch(draft: SettingsDraft, current: Test | undefined): Record<string, unknown> {
  const patch: Record<string, unknown> = { ...draft.test, ...buildFlowPatch(draft, current) };

  if (Object.keys(draft.overall).length > 0) {
    patch.overallPassRuleJson = { ...(current?.overallPassRuleJson as object ?? {}), ...draft.overall };
  }

  const hasRetake = [draft.retake, draft.attemptInterval, draft.plugin].some(
    (b) => Object.keys(b).length > 0,
  );
  if (hasRetake) {
    const cur = (current?.retakePolicyJson ?? {}) as Record<string, unknown>;
    const retake: Record<string, unknown> = { ...cur, ...draft.retake };
    if (Object.keys(draft.attemptInterval).length > 0) {
      retake.attemptInterval = { ...(cur.attemptInterval as object ?? {}), ...draft.attemptInterval };
    }
    if (Object.keys(draft.plugin).length > 0) {
      retake.eligibilityPlugin = { ...(cur.eligibilityPlugin as object ?? {}), ...draft.plugin };
    }
    patch.retakePolicyJson = retake;
  }

  const hasIntro = [draft.introResults, draft.introReport, draft.introRoot].some(
    (b) => Object.keys(b).length > 0,
  );
  if (hasIntro) {
    const cur = (current?.introJson ?? {}) as Record<string, unknown>;
    const intro: Record<string, unknown> = { ...cur, ...draft.introRoot };
    if (Object.keys(draft.introResults).length > 0) {
      intro.results = { format: "plain", text: "", ...(cur.results as object ?? {}), ...draft.introResults };
    }
    if (Object.keys(draft.introReport).length > 0) {
      intro.report = { format: "plain", text: "", ...(cur.report as object ?? {}), ...draft.introReport };
    }
    patch.introJson = intro;
  }

  return patch;
}

/**
 * Save, turning the service's refusals into per-row workbook errors.
 *
 * The service throws `FlowPolicyValidationError` on combinations the editor cannot even
 * assemble (adaptive mode in the flat flow, an adaptive section without levels). Before
 * PRD-48 that exception reached the route and became a 500 "Failed to import workbook" —
 * the author saw a refusal without a single word about the cause.
 */
async function saveOrCollect(
  testId: string,
  payload: Parameters<typeof testSettingsService.save>[1],
  errors: string[],
): Promise<void> {
  try {
    await testSettingsService.save(testId, payload);
  } catch (error) {
    if (error instanceof FlowPolicyValidationError) {
      for (const v of error.violations) errors.push(`Настройки теста: ${v.message}`);
      return;
    }
    throw error;
  }
}

/**
 * Carry the target's own feedback into every section the «Обратная связь» sheet did NOT
 * name, matching the current sections by topic.
 *
 * «Структура» rewrites the sections wholesale — `testSettingsService` deletes them and
 * inserts the payload — so a field the payload leaves out is not "left alone", it is
 * ERASED. Feedback is the one section field a book may legitimately say nothing about:
 * every book exported before the sheet existed carries «Структура» and no «Обратная
 * связь», and applying such a book must not blank out the target's per-section feedback.
 * A workbook does not change what it does not name (FR-20).
 *
 * A section the sheet DID name keeps whatever the sheet gave it, `null` included: a named
 * owner takes its feedback WHOLE from the book, which is how an author erases it.
 */
async function keepUnnamedSectionFeedback(
  testId: string,
  sections: SectionPayload[],
): Promise<void> {
  const unnamed = sections.filter((s) => !("feedbackJson" in s));
  if (unnamed.length === 0) return;

  const current = await storage.getTestSections(testId);
  const feedbackByTopic = new Map(current.map((s) => [s.topicId, s.feedbackJson]));
  for (const section of unnamed) {
    if (!feedbackByTopic.has(section.topicId)) continue;
    section.feedbackJson = feedbackByTopic.get(section.topicId);
  }
}

/**
 * Carry the target's own «Обратная связь при непройденном уровне» into every topic whose cell
 * on «Структура» was empty.
 *
 * Same hazard as {@link keepUnnamedSectionFeedback}, one table over: `adaptiveSettings` is a
 * WHOLESALE rewrite — `testSettingsService` deletes the test's `adaptive_topic_settings` and
 * inserts the payload — so a text the payload leaves at `null` is not «left alone», it is
 * ERASED. The column reads an empty cell as «leave as is» (that is what the sheet, the format
 * spec and the parser all promise), so the promise has to be kept HERE, where the target is
 * readable.
 *
 * A filled cell replaces the text; erasing it from the book is not possible and no eraser
 * value is invented for this one column (PRD-48 §4.4) — that is the whole workbook's rule for
 * text, and a single cell where a dash meant something else would be worse than a book that
 * consistently cannot erase.
 */
async function keepUnnamedFailureFeedback(
  testId: string,
  topics: AdaptiveTopicPayload[],
): Promise<void> {
  const unnamed = topics.filter((t) => t.failureFeedback === null);
  if (unnamed.length === 0) return;

  const current = await storage.getAdaptiveTopicSettingsByTest(testId);
  const byTopic = new Map(current.map((s) => [s.topicId, s.failureFeedback ?? null]));
  for (const topic of unnamed) topic.failureFeedback = byTopic.get(topic.topicId) ?? null;
}

/**
 * A «Папка / Подпапка» path → the id of the last folder, creating the missing ones.
 *
 * Creating rather than failing: the workbook already creates missing TOPICS by name, and a
 * folder is the same hierarchy of names. Demanding a pre-built tree would ask the author to
 * reproduce by hand the structure the book already describes.
 */
async function resolveFolderPath(path: string, actorId: string | null): Promise<string | null> {
  const names = path.split("/").map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) return null;

  const existing = await storage.getTestFolders();
  let parentId: string | null = null;
  for (const name of names) {
    const key = name.toLowerCase();
    const found = existing.find(
      (f) => f.name.trim().toLowerCase() === key && (f.parentId ?? null) === parentId,
    );
    if (found) {
      parentId = found.id;
      continue;
    }
    const created = await storage.createTestFolder({ name, parentId, createdBy: actorId });
    existing.push(created);
    parentId = created.id;
  }
  return parentId;
}

// ─── «Страницы» + «Поля страниц» (PRD-48 FR-14/FR-15) ────────────────────────

/** A `jsonb` column, or a branch of one, as a plain object — `null` and foreign shapes included. */
function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The two field columns of a page, present only when the book named something for them. */
interface PageFields {
  valuesJson?: { values: Record<string, unknown>; placeholderStyles: Record<string, unknown> };
  settingsJson?: Record<string, unknown>;
}

/** Re-index a page's media the way the page routes do — a failed index may not cost a write. */
async function syncPageUsages(pageId: string, page: ContentPage | null): Promise<void> {
  try {
    await syncEntityUsages("content_page", pageId, page);
  } catch (error) {
    logger.error(
      `Media usage sync failed for content page ${pageId}: ${(error as Error).message}`,
      "workbook-import",
    );
  }
}

/**
 * The values and settings of ONE page: the keys the book named, MERGED over what the page
 * already holds and put through the service the page editor calls.
 *
 * Three rules live here, and none of them is optional:
 *
 * - the merge is the IMPORTER's job. `updateContentPage` replaces `values_json` whole, so a
 *   key the book did not name survives only because it is read back and re-sent here;
 * - every value goes through {@link normalizeValuesForTemplate} /
 *   {@link normalizeSettingsForTemplate} — the very functions `PUT /content-pages/:pageId`
 *   calls. A second, «simpler» path would make the workbook an entry point past the sanitiser;
 * - a key the variant does NOT declare is dropped and REPORTED. `normalizeValuesForTemplate`
 *   lets an undeclared key through untouched, which is right for the editor (a page keeps the
 *   values of a variant it was switched away from) but means the value is never sanitised —
 *   so the book, which comes from another stand, may not be the one to introduce it. Silently
 *   losing content is worse than saying so, hence the warning.
 *
 * @param variant The page's variant, or `undefined` for a page in the «HTML» / «Стандартный»
 *   mode, whose fields no manifest declares at all.
 */
function buildPageFields(
  page: ParsedPage,
  existing: ContentPage | undefined,
  variant: ContentTemplateEntry | undefined,
): { fields: PageFields; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fields: PageFields = {};

  const namedValues = Object.entries(page.values);
  const namedSettings = Object.entries(page.settings);
  const existingValues = asObject(asObject(existing?.valuesJson).values);
  const existingStyles = asObject(asObject(existing?.valuesJson).placeholderStyles);
  const existingSettings = asObject(existing?.settingsJson);

  if (!variant) {
    // No manifest types these fields, so the values take the free-form author pass — the
    // same one the editor's PUT takes for such a page — and the settings, which are
    // declared by a variant or not at all, have nothing to be checked against.
    if (namedValues.length > 0) {
      const merged = { ...existingValues };
      for (const [key, value] of namedValues) merged[key] = value;
      fields.valuesJson = { values: sanitizeAllStringValues(merged), placeholderStyles: {} };
    }
    if (namedSettings.length > 0) {
      warnings.push(
        "настройки не применены: у страницы вне режима «Шаблон» нет варианта, который бы их объявлял",
      );
    }
    return { fields, errors, warnings };
  }

  const placeholders = variant.placeholders ?? [];
  const valueKeys = new Set(placeholders.map((p) => p.key));
  const settingKeys = new Set((variant.settings ?? []).map((s) => s.key));
  const undeclared = [
    ...namedValues.filter(([key]) => !valueKeys.has(key)).map(([key]) => key),
    ...namedSettings.filter(([key]) => !settingKeys.has(key)).map(([key]) => key),
  ];
  if (undeclared.length > 0) {
    warnings.push(
      `вариант «${variant.key}» не объявляет полей ${undeclared.map((k) => `"${k}"`).join(", ")} — они не применены`,
    );
  }

  const keptValues = namedValues.filter(([key]) => valueKeys.has(key));
  if (keptValues.length > 0) {
    const merged = { ...existingValues };
    for (const [key, value] of keptValues) merged[key] = value;
    try {
      const normalized = normalizeValuesForTemplate(
        { values: merged, placeholderStyles: existingStyles },
        placeholders,
      );
      fields.valuesJson = { values: normalized.values, placeholderStyles: normalized.placeholderStyles };
    } catch (error) {
      if (!(error instanceof ContentPageFieldError)) throw error;
      errors.push(`${error.field ?? "значение поля"}: ${error.message}`);
    }
  }

  const keptSettings = namedSettings.filter(([key]) => settingKeys.has(key));
  if (keptSettings.length > 0) {
    const merged = { ...existingSettings };
    for (const [key, value] of keptSettings) merged[key] = value;
    fields.settingsJson = normalizeSettingsForTemplate(merged, variant.settings, existingSettings);
  }

  return { fields, errors, warnings };
}

/**
 * The state THIS run leaves the test in, as the pages pass has to see it.
 *
 * The pages pass runs last precisely because the save before it materialises the system
 * pages a book addresses — so under `dryRun`, where that save does not happen, the pass
 * would look at a receiver the run has not built yet and report «такой страницы в тесте
 * нет» for every page the very same run would have created. A preview that shows zero
 * where work will happen is worse than no counter at all (PRD-48 §8.6), so the plan is
 * carried here instead and the missing state is PROJECTED from it.
 */
interface PlannedTestState {
  /** Sections «Структура» described; empty when the book does not rewrite the structure. */
  sections: readonly SectionPayload[];
  /** Whether the run saves at all — an empty patch and no sections means no save, no reconcile. */
  saves: boolean;
  /** `flow_policy_json` of the patch, `undefined` when «Настройки» says nothing about the flow. */
  flowPolicyJson: unknown;
  /** `design_settings_json` this run writes, `undefined` when «Оформление» says nothing. */
  designSettingsJson: unknown;
}

/**
 * The content pages the pages pass must work against: what the receiver holds, plus what
 * the save of THIS run would materialise (and minus what it would drop).
 *
 * On the writing path there is nothing to project — the save has already run, and the rows
 * are in the table. Under `dryRun` the same rows are computed instead, through the same
 * pure planner the settings service executes ({@link planSystemPages}), against the same
 * triple it reconciles by (flowMode + topics + template). Reading the receiver and the
 * template manifests to do so is not a write: `dryRun` forbids changing the target, not
 * looking at it.
 *
 * Silent fallbacks mirror the service exactly: it no-ops when a manifest cannot be read,
 * and reconciles only when the sections, the flow or the design are part of the payload.
 */
async function projectSystemPages(
  testId: string,
  stored: ContentPage[],
  planned: PlannedTestState,
  test: Test,
  topicIds: string[],
): Promise<ContentPage[]> {
  const needsReconcile = planned.saves
    && (planned.sections.length > 0
      || planned.flowPolicyJson !== undefined
      || planned.designSettingsJson !== undefined);
  if (!needsReconcile) return stored;

  const templateId = extractTemplateId(planned.designSettingsJson ?? test.designSettingsJson);
  const wantedIds = templateId === DEFAULT_TEMPLATE_ID
    ? [DEFAULT_TEMPLATE_ID]
    : [templateId, DEFAULT_TEMPLATE_ID];
  const rows = await db
    .select({ id: templates.id, manifest: templates.manifest })
    .from(templates)
    .where(inArray(templates.id, wantedIds));
  const byId = new Map(rows.map((r) => [r.id, r.manifest as TemplateManifest]));
  const template = byId.get(templateId) ?? byId.get(DEFAULT_TEMPLATE_ID);
  const defaultTemplate = byId.get(DEFAULT_TEMPLATE_ID);
  if (!template || !defaultTemplate) return stored;

  const systemKindSet = new Set<string>(SYSTEM_KINDS);
  const existing: ExistingSystemPage[] = stored
    .filter((p) => systemKindSet.has(p.kind))
    .map((p) => ({
      id: p.id,
      kind: p.kind as SystemKind,
      topicId: p.topicId,
      templateKey: p.templateKey,
      valuesJson: asObject(p.valuesJson),
    }));

  const plan = planSystemPages(existing, {
    flowMode: extractFlowMode(planned.flowPolicyJson ?? test.flowPolicyJson),
    topicIds,
    template,
    defaultTemplate,
  });

  const doomed = new Set(plan.delete.map((d) => d.id));
  // Only the fields a system page is ADDRESSED and read by are filled: the id (synthetic —
  // nothing writes these rows), «вид + тема», the bound variant and the values the pass
  // merges the book over. A column the projection cannot know (`position`, `sort_order`)
  // is left absent rather than guessed: the pages pass never reads them for a system page,
  // and a made-up value would be a lie about a row that does not exist yet.
  const created = plan.create.map((ins, i) => ({
    id: `__newpage__:${ins.kind}:${ins.topicId ?? ""}:${i}`,
    testId,
    topicId: ins.topicId,
    kind: ins.kind,
    mode: "template",
    templateKey: ins.templateKey,
    valuesJson: ins.valuesJson,
    settingsJson: {},
    autoAdvance: false,
    autoAdvanceDelayMs: null,
  } as unknown as ContentPage));

  return [...stored.filter((p) => !doomed.has(p.id)), ...created];
}

/** An author page the book describes, ready to be created once its zone is cleared. */
interface PendingAuthorPage {
  page: ParsedPage;
  topicId: string | null;
  mode: "template" | "standard" | "html";
  templateKey: string | null;
  fields: PageFields;
}

/**
 * Apply «Страницы» and «Поля страниц» to the test's content pages.
 *
 * Runs LAST, after the settings and the structure have been saved, and that order is not a
 * preference: of the nine kinds of page exactly one — `info` — is authored, while the other
 * eight are materialised by `testSettingsService` from the SCENARIO and the topic list. Only
 * once the save has run does the target hold the rows the book expects to find.
 *
 * What follows from the same fact: the book can never CREATE a system page, only find one by
 * «вид + тема» and update it. «Не нашлось» is therefore reported instead of invented — a
 * missing row almost always means the book and the target disagree about the scenario or the
 * topic list, and inventing a page would hide that.
 *
 * Author pages have no key at all, so the unit of idempotency is the ZONE: a zone the sheet
 * names ends up looking exactly as the sheet says, and a zone the sheet never names is not
 * touched.
 *
 * Both runs of the same book must report the same plan, so everything this pass reads is the
 * state the run PRODUCES rather than the state it happened to find: the design template is the
 * one «Оформление» applies (the writing path re-reads it from the row it has just updated),
 * and the system pages are the ones the save materialises ({@link projectSystemPages}).
 *
 * @param planned What this run writes: the sections, the flow and the design. It decides WHICH
 *   sections a topic zone may address — with «Структура» the book's own list rules (under
 *   `dryRun` it is the only list there is), without it the target's, exactly the split
 *   `POST /content-pages` makes when it validates `topicId` — and it is what the receiver's
 *   projected page set is computed from.
 */
async function applyPageSheets(
  testId: string,
  workbook: ExcelJS.Workbook,
  dryRun: boolean,
  planned: PlannedTestState,
  result: WorkbookImportResult,
): Promise<void> {
  const bookSections = planned.sections;
  const pageSheet = findSheet(workbook, PAGE_SHEET_NAME);
  const fieldSheet = findSheet(workbook, PAGE_FIELD_SHEET_NAME);
  // A book without «Страницы» does not touch the pages at all — that is what every book
  // exported before these sheets existed has to keep meaning.
  if (!pageSheet) {
    if (fieldSheet) {
      result.errors.push(
        `Лист «${PAGE_FIELD_SHEET_NAME}» требует листа «${PAGE_SHEET_NAME}» `
        + "(значение поля хранится на странице)",
      );
    }
    return;
  }

  const parsed = parsePageSheets(
    sheetToObjects(pageSheet),
    fieldSheet ? sheetToObjects(fieldSheet) : [],
  );
  result.errors.push(...parsed.errors);
  if (parsed.pages.length === 0) return;

  const test = await storage.getTest(testId);
  if (!test) return;

  // The variant manifest is the ONLY thing that filters and sanitises a field value. With no
  // template to resolve, every protection fails at once, so nothing is written: this is a
  // different case from «the template has no such variant», and it must not read the same.
  //
  // The template of THIS RUN, not of the row as it stands: «Оформление» is applied before this
  // pass, so on the writing path the test already wears it, and under `dryRun` naming it here
  // is the only way the preview types the fields by the same manifest the import will.
  const contentTemplates = await resolveContentTemplates(
    test,
    planned.designSettingsJson !== undefined
      ? extractTemplateId(planned.designSettingsJson)
      : undefined,
  );
  if (contentTemplates === null) {
    result.errors.push(
      `Лист «${PAGE_SHEET_NAME}»: шаблон оформления теста не разрешается, `
      + "поэтому страницы и их поля не применены",
    );
    return;
  }

  const topics = await storage.getTopics();
  const topicIdByName = new Map(topics.map((t) => [normalizeName(t.name), t.id]));

  // The name is resolved against the WHOLE topic bank, so it may well land on a topic this
  // test never uses. Such a page renders nowhere and yet holds the topic for `content-guard`,
  // so the same rule the page editor enforces applies here: a page's topic must be a section
  // of THIS test (`POST /content-pages` answers 422).
  const topicIds = bookSections.length > 0
    ? bookSections.map((s) => s.topicId)
    : (await storage.getTestSections(testId)).map((s) => s.topicId);
  const sectionTopicIds = new Set(topicIds);

  const stored = await storage.getContentPages(testId);
  const current = dryRun
    ? await projectSystemPages(testId, stored, planned, test, topicIds)
    : stored;

  /** Zone of a page as both sides address it: the position plus the topic (empty for a test zone). */
  const zoneKeyOf = (position: string, topicId: string | null) => `${position}|${topicId ?? ""}`;

  /** System pages of the target by «вид + тема» — the only key the book has for them. */
  const systemPages = new Map<string, ContentPage>();
  for (const p of current) {
    if (p.kind !== "info") systemPages.set(`${p.kind}|${p.topicId ?? ""}`, p);
  }

  const namedZones = new Set<string>();
  /** Human label of every named zone, for a report the author can act on. */
  const zoneLabels = new Map<string, string>();
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const authorPages: PendingAuthorPage[] = [];

  for (const page of parsed.pages) {
    const where = `Лист «${PAGE_SHEET_NAME}», страница «${formatPageAddress(page)}»`;

    let topicId: string | null = null;
    if (page.topicKey) {
      topicId = topicIdByName.get(page.topicKey) ?? null;
      if (!topicId) {
        result.errors.push(`${where}: тема "${page.topicName}" не найдена`);
        continue;
      }
      if (!sectionTopicIds.has(topicId)) {
        result.errors.push(
          `${where}: тема "${page.topicName}" не входит в разделы теста — страница такой темы `
          + "нигде не показывается",
        );
        continue;
      }
    }
    const existing = page.kind === "info"
      ? undefined
      : systemPages.get(`${page.kind}|${topicId ?? ""}`);
    if (page.kind !== "info" && !existing) {
      result.errors.push(
        `${where}: такой страницы в тесте нет. Системные страницы создаёт сценарий `
        + "прохождения и состав тем — книга и приёмник разошлись одним из них",
      );
      continue;
    }

    // An empty cell means «leave as is», so the effective values fall back to the page's own.
    const mode = (page.mode ?? existing?.mode ?? "template") as "template" | "standard" | "html";
    const templateKey = page.templateKey ?? existing?.templateKey ?? null;
    let variant: ContentTemplateEntry | undefined;
    if (mode === "template") {
      variant = findContentTemplate(contentTemplates, templateKey);
      if (!variant) {
        // The variant is missing from the RECEIVING template: nothing here can be typed or
        // sanitised, and a page bound to a variant that does not exist does not render.
        result.errors.push(
          `${where}: вариант "${templateKey ?? ""}" не объявлен шаблоном оформления теста`,
        );
        continue;
      }
    }

    // Named only HERE, by a row that survived every check: naming a zone COSTS the target its
    // author pages there, and a row that was rejected has bought nothing. Registered earlier,
    // a book whose author rows all failed still emptied the zone — and the warning below then
    // said «зону называют только системные страницы», which was simply untrue.
    const zoneKey = zoneKeyOf(page.zone, topicId);
    namedZones.add(zoneKey);
    zoneLabels.set(zoneKey, formatPageZone(page.zone, page.topicName));

    const built = buildPageFields(page, existing, variant);
    for (const e of built.errors) result.errors.push(`${where}: ${e}`);
    for (const w of built.warnings) result.warnings.push(`${where}: ${w}`);

    if (existing) {
      const patch: Record<string, unknown> = {};
      if (page.templateKey !== undefined) patch.templateKey = page.templateKey;
      if (page.mode !== undefined) patch.mode = page.mode;
      if (page.autoAdvance !== undefined) patch.autoAdvance = page.autoAdvance;
      if (page.autoAdvanceDelayMs !== undefined) patch.autoAdvanceDelayMs = page.autoAdvanceDelayMs;
      if (built.fields.valuesJson) patch.valuesJson = built.fields.valuesJson;
      if (built.fields.settingsJson) patch.settingsJson = built.fields.settingsJson;
      if (Object.keys(patch).length > 0) updates.push({ id: existing.id, patch });
    } else {
      authorPages.push({ page, topicId, mode, templateKey, fields: built.fields });
    }
  }

  // A book carrying «Страницы» without «Поля страниц» says nothing about any field value.
  // For a page that already EXISTS that means «leave as is» — the patch simply carries no
  // `values_json`. An author page has no such luck: it is deleted with its zone and created
  // again from the book alone, so it comes back EMPTY. Same class as «Обратная связь»
  // without «Рекомендации», and answered the same way — a warning, never a refusal, because
  // deliberately emptying a page has to stay possible. Counted, not merely presence-checked:
  // the template ships both sheets, so a presence check would fire on every book built from
  // it and stop being read.
  if (!fieldSheet && authorPages.length > 0) {
    result.warnings.push(
      `Лист «${PAGE_FIELD_SHEET_NAME}» отсутствует: авторские страницы, названные на листе `
      + `«${PAGE_SHEET_NAME}» (${authorPages.length}), будут созданы с пустым содержимым`,
    );
  }

  // Author pages of a NAMED zone are replaced whole by the book's set for that zone — the
  // set may be empty, which is how a book clears a zone. A zone the sheet never mentions
  // keeps its pages, so a book that describes one zone says nothing about the others.
  const doomed = current.filter(
    (p) => p.kind === "info" && namedZones.has(zoneKeyOf(p.position, p.topicId)),
  );

  // A zone is «named» by ANY row carrying its address, a system one included. So a book
  // trimmed by hand — the «Итоги» row kept, the author pages of that zone deleted out of the
  // sheet — wipes the target's author pages there while looking like it only touched the
  // system page. The rule is right (clearing a zone from a book has to stay possible, so this
  // is a warning and not a refusal), but silence about it is not: the author who trimmed the
  // sheet to fix one heading would otherwise lose whole pages without a word.
  const bookAuthorZones = new Set(authorPages.map((item) => zoneKeyOf(item.page.zone, item.topicId)));
  const wipedByZone = new Map<string, number>();
  for (const p of doomed) {
    const zoneKey = zoneKeyOf(p.position, p.topicId);
    if (bookAuthorZones.has(zoneKey)) continue;
    wipedByZone.set(zoneKey, (wipedByZone.get(zoneKey) ?? 0) + 1);
  }
  for (const [zoneKey, count] of wipedByZone) {
    result.warnings.push(
      `Лист «${PAGE_SHEET_NAME}»: зону «${zoneLabels.get(zoneKey) ?? zoneKey}» называют только `
      + `системные страницы, поэтому авторские страницы приёмника в ней (${count}) будут удалены`,
    );
  }

  result.pages = { updated: updates.length, created: authorPages.length, deleted: doomed.length };
  if (dryRun) return;

  for (const { id, patch } of updates) {
    const updated = await storage.updateContentPage(
      id,
      patch as Parameters<typeof storage.updateContentPage>[1],
    );
    if (updated) await syncPageUsages(updated.id, updated);
  }
  for (const page of doomed) {
    await storage.deleteContentPage(page.id);
    await syncPageUsages(page.id, null);
  }
  for (const item of authorPages) {
    const created = await storage.createContentPage({
      testId,
      topicId: item.topicId,
      position: item.page.zone,
      mode: item.mode,
      // The legacy `type` column still exists next to `kind`: an author page is `info`,
      // and `html` there is the render mode the column used to double as (PRD-1 §4.3).
      type: item.mode === "html" ? "html" : "info",
      kind: "info",
      templateKey: item.templateKey,
      // The ordinal of the address is the page's place inside its zone, which is exactly
      // what `sort_order` means there.
      sortOrder: item.page.index,
      valuesJson: item.fields.valuesJson ?? { values: {}, placeholderStyles: {} },
      settingsJson: item.fields.settingsJson ?? {},
      autoAdvance: item.page.autoAdvance ?? false,
      autoAdvanceDelayMs: item.page.autoAdvanceDelayMs ?? null,
    });
    await syncPageUsages(created.id, created);
  }
}

// ─── «Оформление» (PRD-48 FR-17/FR-18) ───────────────────────────────────────

/** The receiving template row, as much of it as applying a design needs. */
interface DesignTemplate {
  id: string;
  version: string;
  templateApiVersion: string;
  manifest: unknown;
}

/**
 * The ACTIVE template of that id — the same row `PUT /api/tests/:id/design` demands.
 *
 * Read straight from the table rather than through the storage facade, exactly as
 * {@link import("./content-page-fields").resolveContentTemplates} does: the design template
 * is not part of the `IStorage` contract, and adding a second reader of the same row through
 * a different path is how the two would start disagreeing about what «installed» means.
 */
async function loadActiveTemplate(id: string): Promise<DesignTemplate | undefined> {
  const [row] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, id), eq(templates.isActive, true)));
  return row as DesignTemplate | undefined;
}

/**
 * Apply the «Оформление» sheet: the test's design and the settings of its report.
 *
 * The design is written on its OWN path, and that is a consequence of the model rather
 * than a choice: `design_settings_json` is saved by `PUT /api/tests/:id/design` and by
 * nothing else, and the import cannot go to itself over HTTP. So the route's checks are
 * repeated here — the template must exist and be ACTIVE, `params` must be declared by its
 * manifest, per-palette overrides are for a themed template's colours only — through the
 * one module that owns them ({@link normalizeDesignParams}), because a second, looser copy
 * would make the workbook a way past the route.
 *
 * Four refusals differ on purpose:
 *
 * - the TEMPLATE is missing or inactive → the sheet is refused WHOLE, report included.
 *   Half an applied design is worse than none: the test would wear foreign colours over a
 *   foreign layout, and the workbook cannot install a template (they arrive as a ZIP
 *   through the admin registry);
 * - a design row the sheet could not read, or a value the manifest refused → the DESIGN half
 *   is refused whole, the report half still applies. `params` replaces the receiver's set
 *   entirely, so a row missing from it is not a parameter left untransferred but a parameter
 *   DELETED on the receiver: a book whose parameter rows all carry a typo in «Что» or «Ключ»
 *   would strip the receiving test of its design while honestly reporting an error on every
 *   row. The «Страницы» pass states the same rule for a zone — a row that was rejected has
 *   bought nothing, and it must not have cost anything either;
 * - a key the receiving manifest does not declare → dropped with a WARNING. The route
 *   answers such a key with a 422 for the whole request, so it cannot be stored; and
 *   silence would let the author read «оформление перенесено» with half of it missing;
 * - a report VARIANT the manifest does not declare → an error of that branch. This is the
 *   one place the workbook is stricter than the product, deliberately: `resolveReportVariant`
 *   answers an unknown key with the default variant and no diagnostic, so the substitution
 *   could only be found by eye in a finished PDF.
 *
 * @returns What this run applies. `reportSettings` is the `report_settings_json` to write,
 *   already merged over the target's own, or `undefined` when the book says nothing about the
 *   report; it travels in the test patch rather than being written here, because the report is
 *   an ordinary column of the `tests` row and one save per import is the rule the settings
 *   sheet already follows. `designSettings` is the `design_settings_json` this run writes (or
 *   would write under `dryRun`) — the pages pass needs it, since the manifest that types a
 *   page field is the one of the template the design NAMES, not of the one the row still holds.
 */
interface AppliedDesign {
  reportSettings?: Record<string, unknown>;
  designSettings?: Record<string, unknown>;
}

async function applyDesignSheet(
  testId: string,
  workbook: ExcelJS.Workbook,
  dryRun: boolean,
  result: WorkbookImportResult,
): Promise<AppliedDesign> {
  const sheet = findSheet(workbook, DESIGN_SHEET_NAME);
  // A book without the sheet changes neither the design nor the report — that is what
  // every book exported before Э5 has to keep meaning.
  if (!sheet) return {};

  const at = `Лист «${DESIGN_SHEET_NAME}»`;
  const parsed = parseDesignSheet(sheetToObjects(sheet));
  result.errors.push(...parsed.errors);

  const hasParams =
    parsed.theme !== undefined
    || Object.keys(parsed.params).length > 0
    || Object.keys(parsed.paramsByTheme).length > 0;
  const hasReport = parsed.reportEnabled !== undefined || Object.keys(parsed.report).length > 0;
  if (parsed.templateId === undefined && !hasParams && !hasReport) return {};

  const test = await storage.getTest(testId);
  const stored = asObject(test?.designSettingsJson);
  const storedId = typeof stored.templateId === "string" ? stored.templateId : "";
  // The sheet's template is the one to APPLY; without it the test keeps its own, and the
  // manifest of that one still types the report values. An EMPTY column falls back to
  // «default», the way the whole product reads it (`GET /:id/design` answers an empty column
  // with `{templateId: "default"}`, `attempts` and the SCORM builder read
  // `templateId || "default"`): `design_settings_json` stays empty until the author TOUCHES a
  // design parameter, while the report card saves through the common `PUT /:id`, so «пустое
  // оформление + настроенный отчёт» is the state of every test on the standard template. A
  // refusal here cost such a book its report settings, «Выдавать отчёт» among them — and the
  // absence of that switch reads as «выдавать», so a test that deliberately withheld the
  // report started handing it out after the transfer.
  const templateId = parsed.templateId || storedId || "default";

  const template = await loadActiveTemplate(templateId);
  if (!template) {
    result.errors.push(
      `${at}: шаблон «${templateId}» не установлен на этом стенде или отключён; `
      + "поставьте его и повторите импорт",
    );
    return {};
  }
  const manifest = template.manifest;
  /** What the run applies, filled in as each half of the sheet survives its checks. */
  const applied: AppliedDesign = {};

  // Parameters without a «Шаблон» row: nothing says WHICH manifest they came from, and
  // painting them over whatever template the target happens to wear is the partial design
  // the whole-sheet refusal above exists to prevent.
  if (parsed.templateId === undefined && hasParams) {
    result.errors.push(`${at}: параметры оформления есть, а строки «Шаблон» нет — применять их не к чему`);
  } else if (parsed.templateId !== undefined) {
    const design = normalizeDesignParams(
      { theme: parsed.theme, params: parsed.params, paramsByTheme: parsed.paramsByTheme },
      manifest,
    );
    result.errors.push(...design.errors.map((e) => `${at}: ${e}`));
    if (design.dropped.length > 0) {
      result.warnings.push(
        `${at}: шаблон «${templateId}» не объявляет параметров `
        + `${design.dropped.map((k) => `"${k}"`).join(", ")} — они не применены`,
      );
    }

    // The design is applied WHOLE or not at all — see the fourth refusal above. Both halves
    // of «not whole» count: a row the sheet could not read at all, and a value the manifest
    // refused (that key is missing from `design.params` just the same). A key the manifest
    // does not DECLARE is not among them: it is a warning by design, because otherwise no
    // book could ever travel between two stands whose templates differ.
    if (design.errors.length > 0 || parsed.designRowsDropped > 0) {
      result.errors.push(
        `${at}: параметры оформления не применены целиком — исправьте строки выше и повторите `
        + "импорт; применить их наполовину значило бы стереть у теста то, чего книга не назвала",
      );
    } else {
      // Shaped exactly as the design route shapes it, versions included: BOTH are stamped
      // from the receiving template's own row. The book carries neither — a version from the
      // source stand raises the «Шаблон обновлён» banner here, whose one button drops every
      // parameter the local manifest no longer declares.
      const designSettings: Record<string, unknown> = {
        templateId,
        templateVersion: template.version,
        templateApiVersion: template.templateApiVersion,
        params: design.params,
      };
      if (supportsThemes(manifest)) {
        designSettings.theme = design.theme ?? "auto";
        if (Object.keys(design.paramsByTheme).length > 0) {
          designSettings.paramsByTheme = design.paramsByTheme;
        }
      }
      // Handed back on BOTH paths: the caller needs the template this run binds, and under
      // `dryRun` there is no row to read it off afterwards.
      applied.designSettings = designSettings;

      // The design values that survived the manifest: the template row itself, the palette
      // row when the template has palettes, and every parameter left after the drop above.
      result.design.params = 1
        + (supportsThemes(manifest) && parsed.theme !== undefined ? 1 : 0)
        + Object.keys(design.params).length
        + Object.values(design.paramsByTheme).reduce((n, v) => n + Object.keys(v).length, 0);

      if (!dryRun) {
        await storage.updateTest(testId, { designSettingsJson: designSettings });
        // Медиатека: сбой индексации не должен стоить автору переноса — как и на маршруте
        // оформления, недостающая строка индекса чинится пересборкой, потерянная запись нет.
        try {
          await syncEntityUsages("test_design", testId, designSettings);
        } catch (error) {
          logger.error(
            `Media usage sync failed for test design ${testId}: ${(error as Error).message}`,
            "workbook-import",
          );
        }
      }
    }
  }

  if (!hasReport) return applied;

  // Merged over the target's own settings, branch by branch: a branch the sheet did not
  // name is not touched, and an empty «Выдавать отчёт» leaves the switch as it was — the
  // ABSENCE of that setting means «выдавать», so reading a blank cell as «выключено»
  // would take the report away from every test whose author never touched it.
  const merged: Record<string, unknown> = { ...asObject(test?.reportSettingsJson) };
  let touched = parsed.reportEnabled !== undefined;
  if (parsed.reportEnabled !== undefined) {
    merged.enabled = parsed.reportEnabled;
    result.design.report++;
  }
  for (const mode of Object.keys(parsed.report) as ReportMode[]) {
    const branch = normalizeReportBranch(parsed.report[mode], manifest, mode);
    result.errors.push(...branch.errors.map((e) => `${at}: ${e}`));
    if (branch.dropped.length > 0) {
      result.warnings.push(
        `${at}: выбранный вид отчёта не объявляет полей `
        + `${branch.dropped.map((k) => `"${k}"`).join(", ")} — они не применены`,
      );
    }
    if (branch.branch) {
      merged[mode] = branch.branch;
      touched = true;
      result.design.report += (branch.branch.variantKey !== undefined ? 1 : 0)
        + Object.keys(branch.branch.values).length;
    }
  }
  // Nothing applied — nothing written. A refused branch may not become a rewrite of the
  // column with the value it already held: the import writes what the book said, and here
  // the book said nothing the receiver could take.
  if (touched) applied.reportSettings = merged;
  return applied;
}

/** Options of one import run. */
export interface WorkbookImportOptions {
  dryRun: boolean;
  actor?: { id: string; roles: readonly Role[] };
  /**
   * Keep the target test's current title, ignoring the «Название» parameter of the
   * «Настройки» sheet (PRD-48 §4.1).
   *
   * Set by `/api/workbook/import-new`, where the author has just typed the title into the
   * form: the book may not overrule a name entered by hand a second ago. An explicit flag
   * rather than a guess from the data — "the target has no title yet" is not a thing the
   * importer can tell, and a wrong guess renames someone's test.
   */
  keepTitle?: boolean;
}

export async function importWorkbook(
  testId: string,
  workbook: ExcelJS.Workbook,
  opts: WorkbookImportOptions,
): Promise<WorkbookImportResult> {
  const { dryRun, actor, keepTitle = false } = opts;
  const result: WorkbookImportResult = {
    questions: { created: 0, updated: 0, skipped: 0 },
    scales: { created: 0, updated: 0 },
    resultVariables: { created: 0, updated: 0 },
    measurements: { rows: 0, questions: 0 },
    scoring: { rows: 0 },
    structure: { sections: 0, quotas: 0 },
    pages: { updated: 0, created: 0, deleted: 0 },
    settings: { params: 0 },
    feedback: { owners: 0, recommendations: 0 },
    adaptive: { topics: 0, levels: 0 },
    design: { params: 0, report: 0 },
    errors: [],
    warnings: [],
    dryRun,
  };

  // ── Pass 1: «Вопросы» (global). Records alias → resolved question. ──
  const aliasToQuestion = new Map<string, ResolvedQuestion>();
  // Topic names seen on «Вопросы» — used to resolve «Структура» sections under
  // dryRun (topics are not persisted then, so storage can't be consulted).
  const questionTopicNames = new Set<string>();
  // PRD-17 (FR-13): per-topic variant memberships from the «Варианты» column —
  // each topic's distinct labels become its section's variants (built in Pass 6).
  const membershipByTopic = new Map<string, VariantMembership[]>();
  // ── «Настройки» (PRD-48 §4.1): settings OF THE TEST, read before anything else so
  // the structure pass can save them together with the sections. A book without the
  // sheet changes nothing — that is what a book exported before a parameter existed
  // has to keep meaning.
  let settingsDraft: SettingsDraft = emptySettingsDraft();
  const settingsSheet = findSheet(workbook, "Настройки");
  if (settingsSheet) {
    const parsed = parseSettingsSheet(sheetToObjects(settingsSheet));
    settingsDraft = parsed.draft;
    result.errors.push(...parsed.errors);
    // PRD-48 §4.1: «Название из книги в этом случае игнорируется без ошибки» — no error
    // and no warning, so the author who typed the title sees nothing to act upon.
    if (keepTitle) delete settingsDraft.test.title;
    // Counted HERE and not at the save: later passes borrow the draft as their carrier —
    // the feedback of the test, the report settings, the unlock rules of «Структура» all
    // ride in it — and those parameters belong to their own sheets, not to this one.
    result.settings.params = countSettingsParams(settingsDraft);
  }

  // ── «Адаптивные уровни» (PRD-48 FR-16) ──────────────────────────────────────
  // Read BEFORE «Рекомендации»: a level's materials are addressed by «Раздел» + «Номер
  // уровня», and that address only exists if THIS sheet described the level. Applied later
  // still — levels ride into the same save as the sections (there is no separate write for
  // them), so the payload can only be assembled where the sections are.
  //
  // A book WITHOUT the sheet does not touch the adaptive settings at all: that is what every
  // book exported before Э4 has to keep meaning.
  const adaptiveSheet = findSheet(workbook, ADAPTIVE_LEVEL_SHEET_NAME);
  let adaptive: ParsedAdaptiveSheet | undefined;
  if (adaptiveSheet) {
    adaptive = parseAdaptiveLevelSheet(sheetToObjects(adaptiveSheet));
    result.errors.push(...adaptive.errors);
  }

  // ── «Обратная связь» + «Рекомендации» (PRD-48 FR-12/FR-13) ──────────────────
  // Read HERE, next to «Настройки», and applied later: the test's feedback rides into
  // the same patch as every other column of the `tests` row, and a section's is a field
  // of its {@link SectionPayload} — it can only be filled where the sections are built.
  //
  // «Рекомендации» without «Обратная связь» is refused whole: a recommendation lives
  // INSIDE its owner's feedback, so with no owner named there is nothing to attach it
  // to, and reporting it once beats repeating the same line for every row.
  const feedbackSheet = findSheet(workbook, FEEDBACK_SHEET_NAME);
  const recommendationSheet = findSheet(workbook, RECOMMENDATION_SHEET_NAME);
  let feedback: ParsedFeedbackSheets | undefined;
  if (feedbackSheet) {
    feedback = parseFeedbackSheets(
      sheetToObjects(feedbackSheet),
      recommendationSheet ? sheetToObjects(recommendationSheet) : [],
      // A level row of «Рекомендации» may only name a level the book itself described;
      // with no adaptive sheet the set is empty and such rows are reported as orphans.
      adaptive?.levelKeys,
    );
    result.errors.push(...feedback.errors);
    // `undefined` = the test level was not named, so its feedback is not touched;
    // `null` = named and empty, which the patch must carry as an explicit erasure.
    if (feedback.test !== undefined) settingsDraft.test.feedbackJson = feedback.test;

    // A named owner takes its feedback WHOLE, so a book carrying «Обратная связь»
    // without «Рекомендации» strips every course, material and event those owners had.
    // That is the rule working as designed, and precisely why it is worth saying out
    // loud: an author who kept only the feedback sheet to fix a typo would otherwise
    // lose every attachment without a word.
    if (!recommendationSheet) {
      const named = (feedback.test !== undefined ? 1 : 0) + feedback.byTopic.size;
      if (named > 0) {
        result.warnings.push(
          `Лист «${RECOMMENDATION_SHEET_NAME}» отсутствует: у владельцев, названных на листе `
          + `«${FEEDBACK_SHEET_NAME}» (${named}), курсы, материалы и мероприятия будут очищены`,
        );
      }
    }
  } else if (recommendationSheet) {
    result.errors.push(
      `Лист «${RECOMMENDATION_SHEET_NAME}» требует листа «${FEEDBACK_SHEET_NAME}» `
      + "(рекомендации хранятся внутри обратной связи владельца)",
    );
  }

  const questionsSheet = findSheet(workbook, "Вопросы");
  // Hoisted so the «Оценка» pass can fall back to the «Вопросы» sheet's legacy
  // «Балл»/«Цена ответа» columns when no «Оценка» sheet is present (see Pass 5).
  let questionRows: Record<string, unknown>[] = [];
  if (questionsSheet) {
    const qrows = sheetToObjects(questionsSheet);
    questionRows = qrows;
    for (const r of qrows) {
      const name = normalizeName(String(r["Тема"] ?? ""));
      if (name) questionTopicNames.add(name);
    }
    // FR-28: thread the importer through so topics/questions created in the
    // «Вопросы» pass are owned by them (createTopic derives ownerId from
    // createdBy) and topic-name matching respects their visible scope.
    const qres = await importQuestionRows(qrows, sheetHeaders(questionsSheet), { dryRun, actor });
    result.questions = { created: qres.created, updated: qres.updated, skipped: qres.skipped };
    for (const e of qres.errors) result.errors.push(`Лист «Вопросы», ${e}`);
    for (const w of qres.warnings) result.warnings.push(`Лист «Вопросы», ${w}`);
    for (const [alias, q] of qres.aliasToQuestion) aliasToQuestion.set(alias, q);

    // Variant memberships: resolve each row's question (row key alias, else ID)
    // and group its labels under the question's topic. The column is «Варианты
    // теста»; the old bare «Варианты» is still honoured on legacy books.
    const variantsCol = variantsColumnOf(sheetHeaders(questionsSheet));
    for (const r of qrows) {
      const numbers = variantsCol ? parseVariantNumbers(r[variantsCol]) : [];
      if (numbers.length === 0) continue;
      const topicKey = normalizeName(String(r["Тема"] ?? ""));
      if (!topicKey) continue;
      const aliasRef = String(r["Ключ строки"] ?? "").trim();
      const questionId = aliasToQuestion.get(aliasRef)?.id || String(r["ID"] ?? "").trim();
      if (!questionId) continue;
      const list = membershipByTopic.get(topicKey) ?? [];
      list.push({ questionId, numbers });
      membershipByTopic.set(topicKey, list);
    }
  }

  // ── Pass 2: «Шкалы» (upsert by key). Build key → scaleId for measurements. ──
  const existingScales = await storage.getScales(testId);
  const scaleIdByKey = new Map<string, string>(existingScales.map((s) => [s.key, s.id]));
  const scaleByKey = new Map<string, Scale>(existingScales.map((s) => [s.key, s]));

  const scalesSheet = findSheet(workbook, "Шкалы");
  if (scalesSheet) {
    const rows = sheetToObjects(scalesSheet);
    // The HEADER row, not the row objects: `sheetToObjects` drops empty cells, so only
    // the headers can tell «the book has no such column» from «the author cleared it».
    const scaleColumns = sheetHeaders(scalesSheet);
    for (let i = 0; i < rows.length; i++) {
      const where = `Лист «Шкалы», строка ${i + 2}`;
      const parsed = parseScaleRow(rows[i], scaleColumns);
      if (!parsed.ok) {
        result.errors.push(`${where}: ${parsed.error}`);
        continue;
      }
      const existing = scaleByKey.get(String(parsed.value.key));
      const sortOrder = existing?.sortOrder ?? scaleIdByKey.size;
      // Merged HERE and not in `parseScaleRow`: the parser sees one row and knows
      // nothing of what is stored, while `existing` is already in hand. Without this
      // the update wrote `{ bands }` wholesale and one round trip through the book
      // erased the domain, the valence, `displayMax` and every level's feedback.
      const configJson = existing
        ? mergeScaleConfig(existing.configJson, parsed.value.configJson as Record<string, unknown>)
        : parsed.value.configJson;
      const check = insertScaleSchema.safeParse({ ...parsed.value, configJson, testId, sortOrder });
      if (!check.success) {
        const first = check.error.issues[0];
        result.errors.push(`${where}: ${first.message} (${first.path.join(".")})`);
        continue;
      }
      const data = check.data;
      if (existing) {
        if (!dryRun) await storage.updateScale(existing.id, data);
        result.scales.updated++;
      } else {
        let newId = `__newscale__:${data.key}`;
        if (!dryRun) {
          const created = await storage.createScale(data);
          newId = created.id;
        }
        scaleIdByKey.set(data.key, newId);
        scaleByKey.set(data.key, { ...(data as any), id: newId } as Scale);
        result.scales.created++;
      }
    }
    // The import writes scales straight through the storage, so nothing else re-indexes
    // their attachments. It matters when the book DROPS a level: the level's feedback
    // goes with it, and its `media_usages` rows would otherwise stay and keep granting
    // a file the test no longer uses. The set-wide rewrite is self-healing.
    if (!dryRun) await syncScaleFeedbackUsages(testId);
  }

  // ── Pass 3: «Показатели» (upsert by name; validate formula; controlsStatus guard). ──
  const existingVars = await storage.getResultVariables(testId);
  const varByName = new Map<string, ResultVariable>(existingVars.map((v) => [v.name, v]));
  // Track which controller is taken (by another variable) to guard ≤1 each.
  const controllerOwner = new Map<string, string>(); // status → name
  for (const v of existingVars) {
    if (v.controlsStatus === "success" || v.controlsStatus === "completion") {
      controllerOwner.set(v.controlsStatus, v.name);
    }
  }

  const varsSheet = findSheet(workbook, "Показатели");
  if (varsSheet) {
    const rows = sheetToObjects(varsSheet);
    for (let i = 0; i < rows.length; i++) {
      const where = `Лист «Показатели», строка ${i + 2}`;
      const parsed = parseResultVariableRow(rows[i]);
      if (!parsed.ok) {
        result.errors.push(`${where}: ${parsed.error}`);
        continue;
      }
      const existing = varByName.get(String(parsed.value.name));
      const sortOrder = existing?.sortOrder ?? varByName.size;
      const check = insertResultVariableSchema.safeParse({ ...parsed.value, testId, sortOrder });
      if (!check.success) {
        const first = check.error.issues[0];
        result.errors.push(`${where}: ${first.message} (${first.path.join(".")})`);
        continue;
      }
      const data = check.data;

      // controlsStatus guard (≤1 success, ≤1 completion per test).
      if (data.controlsStatus === "success" || data.controlsStatus === "completion") {
        const owner = controllerOwner.get(data.controlsStatus);
        if (owner && owner !== data.name) {
          result.errors.push(`${where}: статусом «${data.controlsStatus}» уже управляет «${owner}»`);
          continue;
        }
      }

      const validation = await storage.validateResultVariableFormula(testId, data.formula, data.type as ValueType, {
        sortOrder: data.sortOrder,
        excludeId: existing?.id,
        // Scales/variables defined in this workbook are not persisted yet under
        // dryRun (and never, for a brand-new target test) — feed them in so the
        // formula validator sees the full picture (FR-15 dry-run accuracy).
        extraScaleKeys: [...scaleIdByKey.keys()],
        extraVarNames: [...varByName.keys()],
      });
      if (!validation.valid) {
        result.errors.push(`${where}: невалидная формула`);
        continue;
      }

      if (existing) {
        if (!dryRun) await storage.updateResultVariable(existing.id, data);
        result.resultVariables.updated++;
      } else {
        if (!dryRun) await storage.createResultVariable(data);
        varByName.set(data.name, { ...(data as any) } as ResultVariable);
        result.resultVariables.created++;
      }
      if (data.controlsStatus === "success" || data.controlsStatus === "completion") {
        controllerOwner.set(data.controlsStatus, data.name);
      }
    }
    // Same rule as the scales pass: whoever writes the entity re-indexes it. The book
    // does not carry indicator feedback today, but it does CREATE indicators, and the
    // rule must not depend on which fields a sheet happens to have a column for.
    if (!dryRun) await syncVariableFeedbackUsages(testId);
  }

  // Resolve a «Вопрос» cell → ResolvedQuestion: alias first, then ID. Shared by
  // «Вклады вопросов» and «Оценка» (both reference questions the same way).
  const questionCache = new Map<string, ResolvedQuestion | null>();
  const resolveQuestion = async (ref: string): Promise<ResolvedQuestion | null> => {
    if (aliasToQuestion.has(ref)) return aliasToQuestion.get(ref)!;
    if (questionCache.has(ref)) return questionCache.get(ref)!;
    const q = await storage.getQuestion(ref);
    const resolved: ResolvedQuestion | null = q
      ? {
          id: q.id,
          type: q.type as QuestionType,
          unitCount: unitCountOfQuestion(q),
          contentHash: q.contentHash ?? null,
          measurementOnly: isMeasurementOnly(q),
        }
      : null;
    questionCache.set(ref, resolved);
    return resolved;
  };

  // ── Pass 4: «Вклады вопросов» (resolve question + scale; per-question replace). ──
  const measSheet = findSheet(workbook, "Вклады вопросов");
  if (measSheet) {
    const rows = sheetToObjects(measSheet);

    // Group resolved rows by questionId (per-question replace).
    const byQuestion = new Map<string, any[]>();
    for (let i = 0; i < rows.length; i++) {
      const where = `Лист «Вклады вопросов», строка ${i + 2}`;
      const parsed = parseMeasurementRow(rows[i]);
      if (!parsed.ok) {
        result.errors.push(`${where}: ${parsed.error}`);
        continue;
      }
      const m = parsed.value;

      const q = await resolveQuestion(m.questionRef);
      if (!q) {
        result.errors.push(`${where}: вопрос "${m.questionRef}" не найден (ни ID, ни «Ключ строки»)`);
        continue;
      }
      const scaleId = scaleIdByKey.get(m.scaleKey);
      if (!scaleId) {
        result.errors.push(`${where}: шкала "${m.scaleKey}" не найдена`);
        continue;
      }
      const keyErr = validateSourceKey(m.sourceType, m.sourceKey, q.unitCount);
      if (keyErr) {
        result.errors.push(`${where}: ${keyErr}`);
        continue;
      }

      const list = byQuestion.get(q.id) ?? [];
      list.push({
        testId,
        questionId: q.id,
        scaleId,
        sourceType: m.sourceType,
        sourceKey: m.sourceType === "question" ? null : m.sourceKey,
        valueJson: m.value,
        weight: m.weight,
        sortOrder: list.length,
      });
      byQuestion.set(q.id, list);
      result.measurements.rows++;
    }

    result.measurements.questions = byQuestion.size;
    if (!dryRun) {
      for (const [questionId, rowsForQ] of byQuestion) {
        await storage.upsertQuestionMeasurements(testId, questionId, rowsForQ);
      }
    }
  }

  // ── Pass 5: per-test scoring overrides (PRD-15 block D, FR-36). ──
  // Source priority:
  //   1. «Оценка» sheet — the canonical, AUTHORITATIVE source when present. One
  //      row per overridden question: «Балл» / «Цена ответа» / «Сложность» are
  //      independent links of the effective chain (an empty cell = no override);
  //      an empty/header-only sheet clears the test's overrides.
  //   2. Legacy/compat fallback — when there is NO «Оценка» sheet but the
  //      «Вопросы» sheet carries «Балл»/«Цена ответа» columns (the layout the
  //      import guide documents and pre-T-40 exports used), derive overrides from
  //      those columns. «Сложность» is NOT taken as an override here — it stays on
  //      the question itself (written in Pass 1).
  // Whichever source is used REPLACES the test's whole override set. Overrides are
  // pinned to the question's current contentHash (FR-30 staleness).
  const scoringSheet = findSheet(workbook, "Оценка");
  const questionsHaveScoringCols =
    questionsSheet != null &&
    (() => {
      const h = sheetHeaders(questionsSheet);
      return h.has("Балл") || h.has("Цена ответа");
    })();

  /** Normalized scoring input from either source. */
  type ScoringInput = {
    where: string;
    ref: string;
    points: number | null;
    scoringRaw: string;
    difficulty: number | null;
  };

  if (scoringSheet || questionsHaveScoringCols) {
    const inputs: ScoringInput[] = [];

    if (scoringSheet) {
      const rows = sheetToObjects(scoringSheet);

      // Both sources carry DATA: «Оценка» wins and the «Вопросы» columns are not
      // read at all. Say so — silently ignoring half the book is a surprise, and
      // an untouched (header-only) «Оценка» sheet from the template additionally
      // CLEARS the test's overrides, dropping scoring the author did fill in.
      //
      // Keyed on values, not on column presence: the template ships both the
      // «Оценка» sheet and the «Вопросы» scoring columns, so a presence check
      // would fire on every book built from it and stop being read.
      const questionsCarryScoringValues = questionRows.some(
        (r) =>
          String(r["Балл"] ?? "").trim() !== "" || String(r["Цена ответа"] ?? "").trim() !== "",
      );
      if (questionsCarryScoringValues) {
        result.warnings.push(
          `Оценка взята с листа «Оценка» (строк: ${rows.length}); колонки «Балл»/«Цена ответа» ` +
            `листа «Вопросы» не читались. Чтобы оценка бралась с листа «Вопросы», удалите лист «Оценка».`,
        );
      }

      for (let i = 0; i < rows.length; i++) {
        const where = `Лист «Оценка», строка ${i + 2}`;
        const parsed = parseScoringOverrideRow(rows[i]);
        if (!parsed.ok) {
          result.errors.push(`${where}: ${parsed.error}`);
          continue;
        }
        const o = parsed.value;
        inputs.push({ where, ref: o.questionRef, points: o.points, scoringRaw: o.scoringRaw, difficulty: o.difficulty });
      }
    } else {
      // Fallback: read «Балл»/«Цена ответа» off the «Вопросы» rows. A row with
      // neither cell carries no override (not an error — most rows are like that).
      for (let i = 0; i < questionRows.length; i++) {
        const row = questionRows[i];
        const ref = String(row["Ключ строки"] ?? "").trim() || String(row["ID"] ?? "").trim();
        const pointsRaw = String(row["Балл"] ?? "").trim();
        const scoringRaw = String(row["Цена ответа"] ?? "").trim();
        if (pointsRaw === "" && scoringRaw === "") continue;

        const where = `Лист «Вопросы», строка ${i + 2}`;
        if (!ref) {
          result.errors.push(`${where}: задана цена ответа/балл, но нет «Ключ строки» или «ID» вопроса`);
          continue;
        }
        let points: number | null = null;
        if (pointsRaw !== "") {
          const n = Number(pointsRaw);
          if (!Number.isInteger(n) || n < 0) {
            result.errors.push(`${where}: «Балл» должен быть целым ≥ 0 ("${row["Балл"]}")`);
            continue;
          }
          points = n;
        }
        inputs.push({ where, ref, points, scoringRaw, difficulty: null });
      }
    }

    const overrideRows: Array<Omit<InsertTestQuestionScoring, "testId">> = [];
    const seenQuestionIds = new Set<string>();
    for (const input of inputs) {
      const q = await resolveQuestion(input.ref);
      if (!q) {
        result.errors.push(`${input.where}: вопрос "${input.ref}" не найден (ни ID, ни «Ключ строки»)`);
        continue;
      }
      if (seenQuestionIds.has(q.id)) {
        result.errors.push(`${input.where}: повторная строка для вопроса "${input.ref}"`);
        continue;
      }

      // PRD-26 FR-25: a measurement-only scale is never graded, so a price on it will
      // not reach the result. The values are still WRITTEN (they become live the moment
      // the author sets a correct graduation), but the author is told the row has no
      // effect right now — silently storing dead numbers is how «почему не считается»
      // tickets are born.
      if (q.measurementOnly && (input.points != null || input.scoringRaw !== "")) {
        // Причина у двух измерительных типов разная, и называть её надо точно: у шкалы
        // это ОТСУТСТВИЕ правильной градации (появится — цена оживёт), у распределения
        // сам тип (PRD-44 FR-10) — оживать нечему.
        result.warnings.push(
          distributesBudget(q.type)
            ? `${input.where}: вопрос "${input.ref}" — распределение баллов, оно не проверяется ` +
              `и не приносит баллов, поэтому «Балл»/«Цена ответа» на результат не влияют (значения сохранены)`
            : `${input.where}: вопрос "${input.ref}" — измерительная шкала без правильной ` +
              `градации, поэтому «Балл»/«Цена ответа» на результат не влияют (значения сохранены)`,
        );
      }

      // «Цена ответа» needs the question type/option count; "точное" becomes an
      // EXPLICIT exact override (parseScoringCell returns null for it).
      //
      // A cell that fails to parse is reported and DROPPED ON ITS OWN: the three
      // columns are independent links of the effective chain, so voiding the whole
      // row would silently take a valid «Балл»/«Сложность» down with it and let the
      // question fall through to the system default (1 point, exact).
      let scoringJson: QuestionScoring | null = null;
      if (input.scoringRaw !== "") {
        const sp = parseScoringCell(input.scoringRaw, q.type, q.unitCount);
        if (sp.ok) scoringJson = sp.value ?? { kind: "exact" };
        else result.errors.push(`${input.where}: ${sp.error}`);
      }

      // Nothing left to override once the bad cell is dropped — no row to write.
      if (input.points == null && scoringJson == null && input.difficulty == null) continue;

      seenQuestionIds.add(q.id);
      overrideRows.push({
        questionId: q.id,
        points: input.points,
        scoringJson,
        difficulty: input.difficulty,
        pinnedContentHash: q.contentHash,
      });
      result.scoring.rows++;
    }

    if (!dryRun) {
      await storage.replaceTestQuestionScoring(testId, overrideRows);
    }
  }

  // The folder resolves HERE, not in the registry: the registry is pure cell parsing,
  // while a path needs storage and may create rows.
  if (!dryRun && settingsDraft.folderPath !== undefined) {
    const folderId = await resolveFolderPath(settingsDraft.folderPath, actor?.id ?? null);
    settingsDraft.test.folderId = folderId;
  }

  // ── Pass 6: «Структура» + «Квоты» (FR-16: sections + PRD-11 quotas, router). ──
  // The whole test's structure: one section per «Структура» row (topic + draw
  // count + per-topic pass rule), with «Квоты» rows supplying each section's
  // per-tag draw blueprint. Applied via testSettingsService (it materializes the
  // router page and runs flow validation). The flow itself comes from «Настройки»
  // (PRD-48 FR-06) — structure alone no longer implies a router page.
  const structureSheet = findSheet(workbook, "Структура");
  const quotasSheet = findSheet(workbook, "Квоты");

  /** Sections the book describes; empty when it describes none (see the save below). */
  let sections: SectionPayload[] = [];
  /**
   * Adaptive topics the book describes, empty when it describes none.
   *
   * Assembled together with the sections and handed to the SAME `save`: the service takes
   * levels only as `adaptiveSettings` of the section payload — there is no separate write for
   * them — so a second call would rewrite the structure a second time.
   */
  const adaptiveTopics: AdaptiveTopicPayload[] = [];
  /**
   * Topic keys «Структура» actually claimed. Declared out here because the orphan
   * checks of «Квоты» and «Обратная связь» both consult it, and the second one has to
   * run even when there is NO «Структура» sheet at all — a book naming a section's
   * feedback without describing the sections has nowhere to put it.
   */
  const usedTopicKeys = new Set<string>();

  if (quotasSheet && !structureSheet) {
    result.errors.push('Лист «Квоты» требует листа «Структура» (квоты привязаны к разделам)');
  }

  if (structureSheet) {
    // Group quota rows by section (topic name) → strata.
    const quotasByTopic = new Map<string, DrawStratum[]>();
    if (quotasSheet) {
      const qrows = sheetToObjects(quotasSheet);
      for (let i = 0; i < qrows.length; i++) {
        const parsed = parseQuotaRow(qrows[i]);
        if (!parsed.ok) {
          result.errors.push(`Лист «Квоты», строка ${i + 2}: ${parsed.error}`);
          continue;
        }
        const q: ParsedQuota = parsed.value;
        const key = normalizeName(q.topicName);
        const list = quotasByTopic.get(key) ?? [];
        list.push({ tag: q.tag, count: q.count, mode: q.mode });
        quotasByTopic.set(key, list);
      }
    }

    // Resolve topic names → ids. After pass 1 (non-dryRun) the topics are
    // persisted; under dryRun they aren't, so a name present on «Вопросы» gets a
    // synthetic id (never written — the save is skipped under dryRun).
    const topics = await storage.getTopics();
    const topicIdByName = new Map(topics.map((t) => [normalizeName(t.name), t.id]));

    const structRows = sheetToObjects(structureSheet);
    const pending: Array<{ order: number; payload: SectionPayload }> = [];
    // PRD-48 FR-11: unlock rules by topic NAME for now — the ids the rules are keyed by
    // are known only once every row has resolved its topic.
    const unlockByTopicKey = new Map<string, { mode: string; dependsOn: string[] }>();
    /** Topics whose «failed a level» text has no levels sheet to ride with (warned about). */
    const failureWithoutLevels: string[] = [];
    /** Topics whose «failed a level» text has no LEVEL ROWS to ride with (warned about). */
    const failureWithoutRows: string[] = [];
    /** Topic id per section of THIS book — what a dependency name may point at. */
    const sectionTopicIdByKey = new Map<string, string>();
    for (let i = 0; i < structRows.length; i++) {
      const where = `Лист «Структура», строка ${i + 2}`;
      const parsed = parseStructureRow(structRows[i], i);
      if (!parsed.ok) {
        result.errors.push(`${where}: ${parsed.error}`);
        continue;
      }
      const sec = parsed.value;
      const key = normalizeName(sec.topicName);

      let topicId = topicIdByName.get(key);
      if (!topicId) {
        if (questionTopicNames.has(key)) {
          topicId = `__newtopic__:${key}`; // dryRun only
        } else {
          result.errors.push(`${where}: тема "${sec.topicName}" не найдена (нет ни в БД, ни на листе «Вопросы»)`);
          continue;
        }
      }
      usedTopicKeys.add(key);

      // The code is set on a topic that has NONE and never overwrites an existing one:
      // a topic is shared between tests, and one test's book may not rename the address
      // another test's formulas call it by (PRD-48 FR-10).
      if (!dryRun && sec.topicCode && !topicId.startsWith("__newtopic__:")) {
        const topic = topics.find((t) => t.id === topicId);
        if (topic && !topic.code) await storage.updateTopic(topicId, { code: sec.topicCode });
      }

      const strata = quotasByTopic.get(key) ?? [];
      const quotaSum = strata.reduce((s, q) => s + q.count, 0);
      if (quotaSum > sec.drawCount) {
        result.errors.push(`${where}: сумма квот (${quotaSum}) превышает «Вопросов в выборке» (${sec.drawCount})`);
        continue;
      }

      // PRD-17 (FR-13): variants from the «Варианты» column of this topic's
      // questions. A topic with variant labels needs >= 2 distinct ones; a single
      // label is an authoring error (the section is created without variants).
      let formSetJson: FormSet | null = buildFormSet(
        membershipByTopic.get(key) ?? [],
        () => randomUUID(),
      );
      if (formSetJson && formSetJson.forms.length < 2) {
        result.errors.push(`${where}: у вопросов темы задан только один вариант — нужно ≥2`);
        formSetJson = null;
      }

      // Registered only for a section that survived the row's checks: a discarded row
      // must not leave a rule behind, and must not satisfy anyone's dependency.
      sectionTopicIdByKey.set(key, topicId);
      if (sec.unlockMode !== null || sec.unlockDependsOn.length > 0) {
        unlockByTopicKey.set(key, {
          mode: sec.unlockMode ?? "always_available",
          dependsOn: sec.unlockDependsOn,
        });
      }

      pending.push({
        order: sec.sortOrder,
        payload: {
          topicId,
          drawCount: sec.drawCount,
          topicPassRuleJson: sec.passRule,
          required: sec.required,
          // PRD-30 FR-02/FR-15: delivery order («Случайный порядок вопросов»).
          questionOrder: sec.questionOrder,
          // PRD-48 FR-09: the section fields the book carries since «Структура» grew.
          drawAll: sec.drawAll,
          timeLimitMinutes: sec.timeLimitMinutes,
          defaultPoints: sec.defaultPoints,
          drawBlueprintJson: strata.length ? { strata } : null,
          formSetJson,
          // PRD-48 FR-12: the key is set ONLY for a section the «Обратная связь» sheet
          // names. A section it does not name keeps the field absent, so a book without
          // the sheet says nothing about feedback at all.
          ...(feedback?.byTopic.has(key) ? { feedbackJson: feedback.byTopic.get(key) } : {}),
        },
      });
      result.structure.quotas += strata.length;

      // PRD-48 FR-16: the topic's levels, with the materials «Рекомендации» attached to each
      // of them by the SAME address the levels sheet spells.
      //
      // An entry is made ONLY for a topic the book gave LEVEL ROWS to. `adaptiveSettings` is a
      // wholesale rewrite, so an entry with `levels: []` does not mean «this topic has only a
      // text», it means «this topic has no levels» — and the topic's ladder is deleted. That
      // is reachable without a single word in `errors`: the «adaptive section without levels»
      // gate reads the mode from the payload, so a book with no «Настройки» sheet never turns
      // it on, and a book whose level rows ALL failed their row checks passes it too.
      //
      // `failureFeedback` is still the parser's «оставить как есть» `null` here — the target
      // is only consulted on the saving path, by {@link keepUnnamedFailureFeedback}.
      const levels = adaptive?.byTopic.get(key) ?? [];
      if (sec.failureFeedback !== null && levels.length === 0) {
        (adaptive ? failureWithoutRows : failureWithoutLevels).push(sec.topicName);
      }
      if (levels.length > 0) {
        adaptiveTopics.push({
          topicId,
          failureFeedback: sec.failureFeedback,
          levels: levels.map((level) => ({
            ...level,
            links: feedback?.byLevel.get(adaptiveLevelKey(key, level.levelIndex + 1))?.links ?? [],
          })),
        });
      }
    }

    // The column and the sheet arrived together (Э4), so this is a hand-edited book. Silence
    // would lose a text the author wrote: the failure feedback is a field of
    // `adaptive_topic_settings`, and that row is only written as part of the levels payload.
    if (failureWithoutLevels.length > 0) {
      result.warnings.push(
        `Лист «${ADAPTIVE_LEVEL_SHEET_NAME}» отсутствует: «Обратная связь при непройденном `
        + `уровне» разделов ${failureWithoutLevels.map((n) => `"${n}"`).join(", ")} не применена `
        + "— адаптивные настройки такая книга не трогает",
      );
    }
    // The sheet IS there, but not for these topics: their text has no levels payload to ride
    // in, and writing one would delete the ladder the book never described.
    if (failureWithoutRows.length > 0) {
      result.warnings.push(
        `Лист «${ADAPTIVE_LEVEL_SHEET_NAME}»: у разделов `
        + `${failureWithoutRows.map((n) => `"${n}"`).join(", ")} нет строк уровней — `
        + "«Обратная связь при непройденном уровне» не применена: текст хранится вместе с уровнями",
      );
    }

    // Quota rows pointing at a section absent from «Структура» are orphans.
    for (const key of quotasByTopic.keys()) {
      if (!usedTopicKeys.has(key)) {
        result.errors.push(`Лист «Квоты»: раздел "${key}" не найден на листе «Структура»`);
      }
    }

    // ── «Пороги вариантов» (PRD-24, FR-14) ──────────────────────────────────
    // Read AFTER the variant sets exist: the sheet keys variants by 1-based NUMBER
    // (they are positional in the workbook), and only now can a number be mapped to
    // the freshly minted, stable formId the rule is keyed by.
    const thresholdsSheet = findSheet(workbook, "Пороги вариантов");
    if (thresholdsSheet) {
      const payloadByTopicKey = new Map<string, SectionPayload>();
      for (const p of pending) {
        const name = [...topicIdByName.entries()].find(([, id]) => id === p.payload.topicId)?.[0];
        // dryRun synthetic ids carry the key inline («__newtopic__:<key>»)
        const key = name ?? p.payload.topicId.replace(/^__newtopic__:/, "");
        payloadByTopicKey.set(key, p.payload);
      }

      const trows = sheetToObjects(thresholdsSheet);
      for (let i = 0; i < trows.length; i++) {
        const where = `Лист «Пороги вариантов», строка ${i + 2}`;
        const parsed = parseVariantThresholdRow(trows[i]);
        if (!parsed.ok) {
          result.errors.push(`${where}: ${parsed.error}`);
          continue;
        }
        const key = normalizeName(parsed.value.topicName);
        const payload = payloadByTopicKey.get(key);
        if (!payload) {
          result.errors.push(`${where}: раздел "${parsed.value.topicName}" не найден на листе «Структура»`);
          continue;
        }
        const forms = (payload.formSetJson as FormSet | null)?.forms;
        if (!forms?.length) {
          result.errors.push(`${where}: раздел "${parsed.value.topicName}" не в режиме вариантов`);
          continue;
        }
        const form = forms[parsed.value.variantNumber - 1];
        if (!form) {
          result.errors.push(
            `${where}: вариант ${parsed.value.variantNumber} не объявлен у темы "${parsed.value.topicName}"`,
          );
          continue;
        }
        const rule = payload.topicPassRuleJson as {
          source?: string;
          byForm?: Record<string, { type: "percent" | "absolute"; value: number }>;
        };
        if (rule?.source !== "by_variant") {
          result.errors.push(
            `${where}: у раздела "${parsed.value.topicName}" тип порога не «По вариантам»`,
          );
          continue;
        }
        rule.byForm = rule.byForm ?? {};
        rule.byForm[form.id] = { type: parsed.value.type, value: parsed.value.value };
      }
    }

    // A `by_variant` section must end up with a threshold for EVERY variant —
    // otherwise the uncovered one would silently fall back to the overall rule
    // at delivery time (the editor blocks this too, FR-13).
    for (const p of pending) {
      const rule = p.payload.topicPassRuleJson as { source?: string; byForm?: Record<string, unknown> };
      if (rule?.source !== "by_variant") continue;
      const forms = (p.payload.formSetJson as FormSet | null)?.forms ?? [];
      const covered = Object.keys(rule.byForm ?? {}).length;
      if (!forms.length) {
        result.errors.push(
          `Тип порога «По вариантам» задан разделу без вариантов (тема "${p.payload.topicId}")`,
        );
      } else if (covered < forms.length) {
        result.errors.push(
          `Раздел с типом порога «По вариантам»: задано ${covered} из ${forms.length} порогов — нужен порог на каждый вариант`,
        );
      }
    }

    // ── Unlock rules (PRD-48 FR-11) ─────────────────────────────────────────
    // Dependency NAMES → topic ids, once every section of the book has resolved its
    // topic. A name absent from the book's sections is an author's typo, and a silently
    // dropped dependency would OPEN a section that is meant to stay locked.
    const unlockRules: Record<string, unknown> = {};
    for (const [key, rule] of unlockByTopicKey) {
      const topicId = sectionTopicIdByKey.get(key);
      if (!topicId) continue;
      const sectionIds: string[] = [];
      for (const dep of rule.dependsOn) {
        const depId = sectionTopicIdByKey.get(normalizeName(dep));
        if (!depId) {
          result.errors.push(`Лист «Структура»: раздел "${dep}" из «Зависит от разделов» не найден`);
          continue;
        }
        sectionIds.push(depId);
      }
      unlockRules[topicId] = rule.mode === "always_available"
        ? { mode: "always_available" }
        : { mode: rule.mode, sectionIds };
    }
    if (Object.keys(unlockRules).length > 0) {
      settingsDraft.router.sectionUnlockRules = unlockRules;
    }

    // The array order becomes each section's sortOrder in the service.
    pending.sort((a, b) => a.order - b.order);
    sections = pending.map((p) => p.payload);
    result.structure.sections = sections.length;
  }

  // ── Sections named by «Обратная связь» that no section of this run claimed ───
  // Silently dropping such a row would send the feedback into the void — the author
  // wrote it for a section the target test will not have. The two cases are told apart
  // because the fix differs: with «Структура» present the name is wrong, without it the
  // book cannot rewrite sections at all (the test's own feedback still applies).
  if (feedback) {
    for (const [key, name] of feedback.topicNames) {
      if (usedTopicKeys.has(key)) continue;
      result.errors.push(
        structureSheet
          ? `Лист «${FEEDBACK_SHEET_NAME}»: раздел "${name}" не найден на листе «Структура»`
          : `Лист «${FEEDBACK_SHEET_NAME}»: раздел "${name}" — обратную связь раздела `
            + "можно применить только вместе с листом «Структура»",
      );
    }

    // Counted after the sections are known, because that is when «applied» becomes
    // knowable: the test's own feedback always is, a section's only if this run claimed
    // the section, and a level's only if the level rode into `adaptiveTopics`.
    result.feedback.owners = (feedback.test !== undefined ? 1 : 0)
      + [...feedback.byTopic.keys()].filter((key) => usedTopicKeys.has(key)).length;
    result.feedback.recommendations = countRecommendations(feedback.test ?? undefined);
    for (const [key, payload] of feedback.byTopic) {
      if (usedTopicKeys.has(key)) result.feedback.recommendations += countRecommendations(payload);
    }
    for (const topic of adaptiveTopics) {
      for (const level of topic.levels ?? []) {
        result.feedback.recommendations += level.links?.length ?? 0;
      }
    }
  }

  // The levels that will actually be written: `adaptiveTopics` holds one entry per topic a
  // section of this run claimed AND the sheet gave rows to, which is exactly the payload of
  // the save below.
  result.adaptive = {
    topics: adaptiveTopics.length,
    levels: adaptiveTopics.reduce((n, t) => n + (t.levels?.length ?? 0), 0),
  };

  // ── Topics named by «Адаптивные уровни» that no section of this run claimed ──
  // Levels belong to a topic but act only for a topic the TEST contains, so a level of a
  // foreign topic would be written where nothing ever reads it. Same split as «Обратная
  // связь»: with «Структура» present the name is wrong, without it the book cannot describe
  // the test's topics at all.
  if (adaptive) {
    for (const [key, name] of adaptive.topicNames) {
      if (usedTopicKeys.has(key)) continue;
      result.errors.push(
        structureSheet
          ? `Лист «${ADAPTIVE_LEVEL_SHEET_NAME}»: раздел "${name}" не найден на листе «Структура»`
          : `Лист «${ADAPTIVE_LEVEL_SHEET_NAME}»: раздел "${name}" — уровни можно применить `
            + "только вместе с листом «Структура»",
      );
    }
  }

  // ── «Оформление» (PRD-48 FR-17/FR-18) ───────────────────────────────────────
  // BEFORE the save, and that order carries meaning twice over: the report settings ride
  // into the same patch as every other column of the `tests` row, and the design — which
  // is written on its own path — has to be in place before the pages pass, because the
  // template it names is the one whose manifest types the page fields.
  const design = await applyDesignSheet(testId, workbook, dryRun, result);
  if (design.reportSettings) settingsDraft.test.reportSettingsJson = design.reportSettings;

  // ── ONE save for the settings and the structure ─────────────────────────────
  // The two travel together when the book carries both, and stand alone otherwise:
  //
  // - sections are re-sent ONLY when the book described any. «Структура» replaces the
  //   test's structure wholesale, so an empty list would wipe it — and the export writes
  //   the sheet ALWAYS, header-only for a test without sections, as does the downloadable
  //   template. Under the old shape («Структура» present, no data rows) neither branch
  //   fired and every «Настройки» parameter was lost without a word in `errors`;
  // - the settings patch is applied whenever it is non-empty, no matter how many rows
  //   «Структура» happened to have.
  //
  // Nothing to say = no call at all: `save` is a rewrite, and calling it with an empty
  // patch would re-stamp the test for a book that asked for nothing.
  //
  // The patch is built on BOTH paths, and only the writing is skipped: the pages pass below
  // has to know what the save would change (the flow decides which system pages exist at
  // all), so under `dryRun` the plan is assembled and then simply not sent. Reading the test
  // row for it is not a write.
  const currentTest = await storage.getTest(testId);
  // PRD-48 §4.1: settings from «Настройки»; a key the sheet did not carry stays
  // absent, and the service leaves that column alone.
  const patch = buildTestPatch(settingsDraft, currentTest);
  const saves = sections.length > 0 || Object.keys(patch).length > 0;
  const payload = {
    test: {
      status: (currentTest?.status as "draft" | "published" | "archived") ?? "draft",
      ...patch,
    },
    // The service rewrites sections only when the payload names them.
    ...(sections.length > 0 ? { sections } : {}),
    // Same rule for the levels, and for the same reason: `adaptiveSettings` is a
    // wholesale rewrite, so an empty list would DELETE the target's levels — and the
    // export writes the sheet always, header-only for a test that has none.
    ...(adaptiveTopics.length > 0 ? { adaptiveSettings: adaptiveTopics } : {}),
  };
  if (saves) {
    if (dryRun) {
      // The refusal the SAVE would answer with, told in the preview instead. The service
      // guards combinations the editor cannot even assemble, and on the writing path
      // {@link saveOrCollect} turns that exception into these very lines — so without this
      // the preview reported a clean plan for a book the import goes on to refuse whole.
      // The gate repeats the service's own: a patch that touches neither the sections, nor
      // the levels, nor the mode, nor the flow cannot violate the strict gating.
      if (sections.length > 0 || adaptiveTopics.length > 0 || patch.mode || patch.flowPolicyJson) {
        for (const v of validateFlowPolicy(payload.test, payload.sections, payload.adaptiveSettings)) {
          result.errors.push(`Настройки теста: ${v.message}`);
        }
      }
    } else {
      // Read HERE and nowhere earlier: the query answers "what would the rewrite destroy",
      // and under `dryRun` there is no rewrite — the plan the preview reports does not
      // depend on it.
      if (sections.length > 0) await keepUnnamedSectionFeedback(testId, sections);
      if (adaptiveTopics.length > 0) await keepUnnamedFailureFeedback(testId, adaptiveTopics);
      await saveOrCollect(testId, payload, result.errors);
    }
  }

  // ── Pass 7: «Страницы» + «Поля страниц» (PRD-48 FR-14/FR-15) ──
  // LAST, and only here: the system pages the book expects to find are materialised by the
  // save above, out of the scenario («Настройки») and the topic list («Структура»). Under
  // `dryRun` that save did not run, so the pass is handed the plan and projects it.
  await applyPageSheets(testId, workbook, dryRun, {
    sections,
    saves,
    flowPolicyJson: patch.flowPolicyJson,
    designSettingsJson: design.designSettings,
  }, result);

  return result;
}
