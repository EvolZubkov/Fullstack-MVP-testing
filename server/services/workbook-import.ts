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
 * the per-test scoring overrides (PRD-15 block D FR-36 — from the «Оценка» sheet,
 * or, when it is absent, derived from the legacy «Балл»/«Цена ответа» columns of
 * the «Вопросы» sheet) and finally the structure + quotas (FR-16). Writes are
 * skipped under `dryRun`; counts are still computed (FR-13).
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
  type FormSet,
} from "@shared/schema";
import { buildFormSet, parseVariantNumbers, type VariantMembership } from "@shared/draw/forms";
import { randomUUID } from "crypto";
import type { ValueType } from "@shared/formula";
import type { Role } from "@shared/access";
import { importQuestionRows, type ResolvedQuestion } from "./questions-import";
import { testSettingsService, type SectionPayload } from "./test-settings";
import { parseScoringCell } from "../utils/scoring-excel";
import { hasOptionList, isMeasurementOnly, distributesBudget } from "@shared/questions/question-type";

import {
  parseScaleRow,
  parseResultVariableRow,
  parseMeasurementRow,
  validateSourceKey,
  parseSettingsRow,
  parseStructureRow,
  parseQuotaRow,
  parseVariantThresholdRow,
  parseScoringOverrideRow,
  variantsColumnOf,
  type ParsedQuota,
  type ParsedTestSettings,
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
  /**
   * Non-blocking notices: the book imports, but something in it is likely not
   * what the author meant (e.g. two competing sources of the same setting).
   */
  warnings: string[];
  dryRun: boolean;
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

export async function importWorkbook(
  testId: string,
  workbook: ExcelJS.Workbook,
  opts: { dryRun: boolean; actor?: { id: string; roles: readonly Role[] } },
): Promise<WorkbookImportResult> {
  const { dryRun, actor } = opts;
  const result: WorkbookImportResult = {
    questions: { created: 0, updated: 0, skipped: 0 },
    scales: { created: 0, updated: 0 },
    resultVariables: { created: 0, updated: 0 },
    measurements: { rows: 0, questions: 0 },
    scoring: { rows: 0 },
    structure: { sections: 0, quotas: 0 },
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
  // ── «Настройки» (PRD-30 FR-22): settings OF THE TEST, read before anything
  // else so the structure pass can save them together with the sections. A book
  // without the sheet changes nothing about the test — that is what a workbook
  // exported before the sheet existed has to keep meaning.
  const testSettings: ParsedTestSettings = {};
  const settingsSheet = findSheet(workbook, "Настройки");
  if (settingsSheet) {
    const rows = sheetToObjects(settingsSheet);
    for (let i = 0; i < rows.length; i++) {
      const parsed = parseSettingsRow(rows[i]);
      if (!parsed.ok) {
        result.errors.push(`Лист «Настройки», строка ${i + 2}: ${parsed.error}`);
        continue;
      }
      Object.assign(testSettings, parsed.value);
    }
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

      pending.push({
        order: sec.sortOrder,
        payload: {
          topicId,
          drawCount: sec.drawCount,
          topicPassRuleJson: sec.passRule,
          required: sec.required,
          // PRD-30 FR-02/FR-15: delivery order («Случайный порядок вопросов»).
          questionOrder: sec.questionOrder,
          drawBlueprintJson: strata.length ? { strata } : null,
          formSetJson,
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
          // PRD-30 FR-22: settings from «Настройки»; a key the sheet did not
          // carry stays absent, and the service leaves that column alone.
          ...testSettings,
        },
        sections,
      });
    }
  }

  // A book may carry «Настройки» WITHOUT «Структура» — settings of an existing
  // test, edited on their own. Saving them must not require re-sending sections
  // (the service rewrites sections only when the payload names them).
  if (!dryRun && !structureSheet && Object.keys(testSettings).length > 0) {
    const current = await storage.getTest(testId);
    await testSettingsService.save(testId, {
      test: {
        ...testSettings,
        status: (current?.status as "draft" | "published" | "archived") ?? "draft",
      },
    });
  }

  return result;
}
