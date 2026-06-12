/**
 * @module server/services/workbook-import
 *
 * Multi-sheet workbook import for ONE test (PRD-14 FR-15). Role sheets —
 * «Вопросы» / «Шкалы» / «Показатели» / «Вклады вопросов» / «Оценка» /
 * «Структура» / «Квоты» — are recognized by name; missing sheets are skipped.
 * Questions are global; everything else is written into the target `testId`.
 *
 * Multi-pass order (FR-15.7): questions first (фиксируем `ID`↔`Ключ строки`),
 * then scales (upsert by `key`), then measurements (resolve question by
 * `ID`/alias and scale by `key`) and result variables (validate formula), then
 * the per-test scoring overrides («Оценка», PRD-15 block D FR-36) and finally
 * the structure + quotas (FR-16). Writes are skipped under `dryRun`; counts are
 * still computed (FR-13).
 *
 * Upsert keys (FR-15 idempotency): scale = (test, key); result variable =
 * (test, name); measurements are replaced per question (the sheet is
 * authoritative for a question's contributions, matching the editor's PUT);
 * scoring overrides are replaced per test (the «Оценка» sheet is authoritative
 * for the test's override set).
 */

import type ExcelJS from "exceljs";
import { storage } from "../storage";
import { sheetHeaders, sheetToObjects } from "../utils/excel";
import {
  insertScaleSchema,
  insertResultVariableSchema,
  type Scale,
  type ResultVariable,
  type DrawStratum,
  type QuestionScoring,
  type InsertTestQuestionScoring,
} from "@shared/schema";
import type { ValueType } from "@shared/formula";
import { importQuestionRows, type ResolvedQuestion } from "./questions-import";
import { testSettingsService, type SectionPayload } from "./test-settings";
import { parseScoringCell } from "../utils/scoring-excel";
import {
  parseScaleRow,
  parseResultVariableRow,
  parseMeasurementRow,
  validateSourceKey,
  parseStructureRow,
  parseQuotaRow,
  parseScoringOverrideRow,
  type ParsedQuota,
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
  errors: string[];
  dryRun: boolean;
}

/** Normalize a topic/section name for case/space-insensitive matching. */
function normalizeName(s: string): string {
  return s.replace(/[\s ​﻿]+/g, " ").trim().toLowerCase();
}

type QuestionType = "single" | "multiple" | "matching" | "ranking";

/** Find a worksheet by role name (case-insensitive, trimmed). */
function findSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  const target = name.trim().toLowerCase();
  return wb.worksheets.find((w) => (w.name ?? "").trim().toLowerCase() === target);
}

/** Option/pair/item count of a stored question (for source-key validation). */
function unitCountOfQuestion(q: { type: string; dataJson: unknown }): number {
  const d = (q.dataJson ?? {}) as any;
  if (q.type === "single" || q.type === "multiple") return d.options?.length ?? 0;
  if (q.type === "matching") return d.left?.length ?? 0;
  return d.items?.length ?? 0;
}

export async function importWorkbook(
  testId: string,
  workbook: ExcelJS.Workbook,
  opts: { dryRun: boolean },
): Promise<WorkbookImportResult> {
  const { dryRun } = opts;
  const result: WorkbookImportResult = {
    questions: { created: 0, updated: 0, skipped: 0 },
    scales: { created: 0, updated: 0 },
    resultVariables: { created: 0, updated: 0 },
    measurements: { rows: 0, questions: 0 },
    scoring: { rows: 0 },
    structure: { sections: 0, quotas: 0 },
    errors: [],
    dryRun,
  };

  // ── Pass 1: «Вопросы» (global). Records alias → resolved question. ──
  const aliasToQuestion = new Map<string, ResolvedQuestion>();
  // Topic names seen on «Вопросы» — used to resolve «Структура» sections under
  // dryRun (topics are not persisted then, so storage can't be consulted).
  const questionTopicNames = new Set<string>();
  const questionsSheet = findSheet(workbook, "Вопросы");
  if (questionsSheet) {
    const qrows = sheetToObjects(questionsSheet);
    for (const r of qrows) {
      const name = normalizeName(String(r["Тема"] ?? ""));
      if (name) questionTopicNames.add(name);
    }
    const qres = await importQuestionRows(qrows, sheetHeaders(questionsSheet), { dryRun });
    result.questions = { created: qres.created, updated: qres.updated, skipped: qres.skipped };
    for (const e of qres.errors) result.errors.push(`Лист «Вопросы», ${e}`);
    for (const [alias, q] of qres.aliasToQuestion) aliasToQuestion.set(alias, q);
  }

  // ── Pass 2: «Шкалы» (upsert by key). Build key → scaleId for measurements. ──
  const existingScales = await storage.getScales(testId);
  const scaleIdByKey = new Map<string, string>(existingScales.map((s) => [s.key, s.id]));
  const scaleByKey = new Map<string, Scale>(existingScales.map((s) => [s.key, s]));

  const scalesSheet = findSheet(workbook, "Шкалы");
  if (scalesSheet) {
    const rows = sheetToObjects(scalesSheet);
    for (let i = 0; i < rows.length; i++) {
      const where = `Лист «Шкалы», строка ${i + 2}`;
      const parsed = parseScaleRow(rows[i]);
      if (!parsed.ok) {
        result.errors.push(`${where}: ${parsed.error}`);
        continue;
      }
      const existing = scaleByKey.get(String(parsed.value.key));
      const sortOrder = existing?.sortOrder ?? scaleIdByKey.size;
      const check = insertScaleSchema.safeParse({ ...parsed.value, testId, sortOrder });
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

  // ── Pass 5: «Оценка» (PRD-15 block D, FR-36: per-test scoring overrides). ──
  // One row per overridden question: «Балл» / «Цена ответа» / «Сложность» are
  // independent links of the effective chain (an empty cell = no override).
  // The sheet is AUTHORITATIVE for the target test's override set: a successful
  // import replaces all of the test's overrides with the sheet rows (an
  // empty/header-only sheet clears them). Overrides are pinned to the
  // question's current contentHash (FR-30 staleness).
  const scoringSheet = findSheet(workbook, "Оценка");
  if (scoringSheet) {
    const rows = sheetToObjects(scoringSheet);
    const overrideRows: Array<Omit<InsertTestQuestionScoring, "testId">> = [];
    const seenQuestionIds = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const where = `Лист «Оценка», строка ${i + 2}`;
      const parsed = parseScoringOverrideRow(rows[i]);
      if (!parsed.ok) {
        result.errors.push(`${where}: ${parsed.error}`);
        continue;
      }
      const o = parsed.value;

      const q = await resolveQuestion(o.questionRef);
      if (!q) {
        result.errors.push(`${where}: вопрос "${o.questionRef}" не найден (ни ID, ни «Ключ строки»)`);
        continue;
      }
      if (seenQuestionIds.has(q.id)) {
        result.errors.push(`${where}: повторная строка для вопроса "${o.questionRef}"`);
        continue;
      }

      // «Цена ответа» needs the question type/option count; "точное" becomes an
      // EXPLICIT exact override (parseScoringCell returns null for it).
      let scoringJson: QuestionScoring | null = null;
      if (o.scoringRaw !== "") {
        const sp = parseScoringCell(o.scoringRaw, q.type, q.unitCount);
        if (!sp.ok) {
          result.errors.push(`${where}: ${sp.error}`);
          continue;
        }
        scoringJson = sp.value ?? { kind: "exact" };
      }

      seenQuestionIds.add(q.id);
      overrideRows.push({
        questionId: q.id,
        points: o.points,
        scoringJson,
        difficulty: o.difficulty,
        pinnedContentHash: q.contentHash,
      });
      result.scoring.rows++;
    }

    if (!dryRun) {
      await storage.replaceTestQuestionScoring(testId, overrideRows);
    }
  }

  // ── Pass 6: «Структура» + «Квоты» (FR-16: sections + PRD-11 quotas, router). ──
  // The whole test's structure: one section per «Структура» row (topic + draw
  // count + per-topic pass rule), with «Квоты» rows supplying each section's
  // per-tag draw blueprint. Applied via testSettingsService (it materializes the
  // router page and runs flow validation). The flow is fixed to router_by_topics.
  const structureSheet = findSheet(workbook, "Структура");
  const quotasSheet = findSheet(workbook, "Квоты");

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
    const usedTopicKeys = new Set<string>();
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

      const strata = quotasByTopic.get(key) ?? [];
      const quotaSum = strata.reduce((s, q) => s + q.count, 0);
      if (quotaSum > sec.drawCount) {
        result.errors.push(`${where}: сумма квот (${quotaSum}) превышает «Вопросов в выборке» (${sec.drawCount})`);
        continue;
      }

      pending.push({
        order: sec.sortOrder,
        payload: {
          topicId,
          drawCount: sec.drawCount,
          topicPassRuleJson: sec.passRule,
          required: sec.required,
          drawBlueprintJson: strata.length ? { strata } : null,
        },
      });
      result.structure.quotas += strata.length;
    }

    // Quota rows pointing at a section absent from «Структура» are orphans.
    for (const key of quotasByTopic.keys()) {
      if (!usedTopicKeys.has(key)) {
        result.errors.push(`Лист «Квоты»: раздел "${key}" не найден на листе «Структура»`);
      }
    }

    // The array order becomes each section's sortOrder in the service.
    pending.sort((a, b) => a.order - b.order);
    const sections = pending.map((p) => p.payload);
    result.structure.sections = sections.length;

    if (!dryRun && sections.length > 0) {
      const current = await storage.getTest(testId);
      await testSettingsService.save(testId, {
        test: {
          flowPolicyJson: { mode: "router_by_topics" },
          status: (current?.status as "draft" | "published" | "archived") ?? "draft",
        },
        sections,
      });
    }
  }

  return result;
}
