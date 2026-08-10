/**
 * @module server/routes/tests-workbook
 * @description Multi-sheet Excel workbook import/export for ONE test (PRD-14
 * FR-15). Mounted under /api/tests:
 *
 * - POST /:id/workbook/import?dryRun=true  — import «Вопросы»/«Шкалы»/«Показатели»/
 *   «Вклады вопросов» into the test (questions are global); `dryRun` returns the plan
 *   without writing.
 *
 * Authorization: editing a test's scales/measurements/result variables requires
 * the author/edit scope (same as the per-domain routes).
 */
import { Router, Request, Response } from "express";
import ExcelJS from "exceljs";
import { logger } from "../logger";
import { addAoaSheet, addJsonSheet, readWorkbookFromBuffer, workbookToBuffer } from "../utils/excel";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";
import { requireTestScope } from "../middleware/test-scope";
import { memoryUpload } from "../middleware/upload";
import { importWorkbook } from "../services/workbook-import";
import { serializeQuestionRow, QUESTION_HEADERS, QUESTION_WIDTHS } from "../services/questions-export";
import {
  serializeScaleRow,
  serializeResultVariableRow,
  serializeMeasurementRow,
  serializeStructureRow,
  serializeQuotaRow,
  serializeVariantThresholdRow,
  serializeScoringOverrideRow,
  SCALE_HEADERS,
  SCALE_WIDTHS,
  RESULT_VAR_HEADERS,
  RESULT_VAR_WIDTHS,
  MEASUREMENT_HEADERS,
  MEASUREMENT_WIDTHS,
  SETTINGS_HEADERS,
  SETTINGS_WIDTHS,
  serializeSettingsRows,
  STRUCTURE_HEADERS,
  STRUCTURE_WIDTHS,
  QUOTA_HEADERS,
  QUOTA_WIDTHS,
  VARIANT_THRESHOLD_HEADERS,
  VARIANT_THRESHOLD_WIDTHS,
  SCORING_OVERRIDE_HEADERS,
  SCORING_OVERRIDE_WIDTHS,
  VARIANTS_COLUMN,
} from "../utils/workbook-sheets";
import type { DrawBlueprint, FormSet } from "@shared/schema";

const router = Router();

/** Add a sheet from object rows; for an empty set write the header row only. */
function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  rows: Record<string, unknown>[],
  headers: string[],
  widths: number[],
): void {
  if (rows.length > 0) addJsonSheet(wb, name, rows, widths);
  else addAoaSheet(wb, name, [headers], widths);
}

// ─── POST /api/tests/:id/workbook/import ─────────────────────────────────────
router.post(
  "/:id/workbook/import",
  requirePermission("tests.edit"),
  requireTestScope("edit"),
  memoryUpload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const testId = req.params.id;
      const test = await storage.getTest(testId);
      if (!test) return res.status(404).json({ error: "Test not found" });
      if (!req.file) return res.status(400).json({ error: "File required" });

      const dryRun = String(req.query.dryRun ?? "").toLowerCase() === "true";
      const workbook = await readWorkbookFromBuffer(req.file.buffer);
      const result = await importWorkbook(testId, workbook, {
        dryRun,
        // FR-28: questions/topics created during import are owned by the importer.
        actor: req.currentUser
          ? { id: req.currentUser.id, roles: req.effectiveRoles ?? [] }
          : undefined,
      });
      res.json(result);
    } catch (error) {
      logger.error("Workbook import error: " + (error as Error).message, "tests-workbook");
      res.status(500).json({ error: "Failed to import workbook" });
    }
  },
);

// ─── GET /api/tests/:id/workbook/export ──────────────────────────────────────
router.get(
  "/:id/workbook/export",
  requirePermission("tests.read"),
  requireTestScope("read"),
  async (req: Request, res: Response) => {
    try {
      const testId = req.params.id;
      const test = await storage.getTest(testId);
      if (!test) return res.status(404).json({ error: "Test not found" });

      const sections = await storage.getTestSections(testId);
      const topicIds = new Set(sections.map((s) => s.topicId));
      const topics = await storage.getTopics();
      const topicName = new Map(topics.map((t) => [t.id, t.name]));
      // PRD-48 FR-10: the topic's short code rides along so the formulas that address
      // it as `topicById("<code>")` keep their addressee on another stand.
      const topicCode = new Map(topics.map((t) => [t.id, t.code]));

      const scales = await storage.getScales(testId);
      const resultVars = await storage.getResultVariables(testId);
      const measurements = await storage.getQuestionMeasurements(testId);

      // «Вопросы» = вопросы тем теста ∪ вопросы, измеряемые в тесте (round-trip).
      const measuredIds = new Set(measurements.map((m) => m.questionId));
      const allQuestions = await storage.getQuestions();
      const questions = allQuestions
        .filter((q) => topicIds.has(q.topicId) || measuredIds.has(q.id))
        .sort((a, b) => (topicName.get(a.topicId) || "").localeCompare(topicName.get(b.topicId) || "", "ru"));

      // PRD-17 (FR-13): variant NUMBERS per question (form position, ascending) —
      // the «Варианты» column round-trips section variants through «Вопросы».
      const variantNumbersByQuestion = new Map<string, number[]>();
      for (const s of sections) {
        const fs = s.formSetJson as FormSet | null;
        if (!fs) continue;
        fs.forms.forEach((form, idx) => {
          for (const qid of form.questionIds) {
            const list = variantNumbersByQuestion.get(qid) ?? [];
            list.push(idx + 1);
            variantNumbersByQuestion.set(qid, list);
          }
        });
      }

      // Локальный «Ключ строки» (FR-15.9): q1, q2, … — на него ссылаются «Вклады вопросов».
      const aliasByQuestionId = new Map<string, string>();
      const questionRows = questions.map((q, i) => {
        const alias = `q${i + 1}`;
        aliasByQuestionId.set(q.id, alias);
        return {
          "Ключ строки": alias,
          ...serializeQuestionRow(q, topicName.get(q.topicId) || ""),
          [VARIANTS_COLUMN]: (variantNumbersByQuestion.get(q.id) ?? []).join("; "),
        };
      });

      const scaleRows = scales.map((s) => serializeScaleRow(s));
      const scaleKeyById = new Map(scales.map((s) => [s.id, s.key]));
      const rvRows = resultVars.map((v) => serializeResultVariableRow(v));
      const measRows = measurements
        .filter((m) => aliasByQuestionId.has(m.questionId) && scaleKeyById.has(m.scaleId))
        .map((m) => serializeMeasurementRow(m, aliasByQuestionId.get(m.questionId)!, scaleKeyById.get(m.scaleId)!));

      // «Структура» + «Квоты» (FR-16): sections ordered by sortOrder; each
      // section's blueprint strata flatten into «Квоты» rows (round-trip).
      const orderedSections = sections.slice().sort((a, b) => a.sortOrder - b.sortOrder);
      // PRD-48 FR-11: the router's unlock rules are keyed by TOPIC id — the workbook
      // spells both the rule's owner and its dependencies as topic names.
      const routerRules =
        (test.flowPolicyJson as {
          router?: { sectionUnlockRules?: Record<string, { mode?: string; sectionIds?: string[] }> };
        } | null)?.router?.sectionUnlockRules ?? {};
      const structureRows = orderedSections.map((s) =>
        serializeStructureRow({
          topicName: topicName.get(s.topicId) || "",
          topicCode: topicCode.get(s.topicId) ?? null,
          sortOrder: s.sortOrder,
          drawCount: s.drawCount,
          topicPassRuleJson: s.topicPassRuleJson,
          required: s.required,
          // PRD-30 FR-15: delivery order of the topic's questions.
          questionOrder: s.questionOrder,
          // PRD-48 FR-09: whole-topic delivery, time limit and the price default.
          drawAll: s.drawAll,
          timeLimitMinutes: s.timeLimitMinutes,
          defaultPoints: s.defaultPoints,
          unlockMode: routerRules[s.topicId]?.mode ?? null,
          unlockDependsOn: (routerRules[s.topicId]?.sectionIds ?? []).map(
            (id) => topicName.get(id) ?? id,
          ),
        }),
      );
      const quotaRows: Record<string, unknown>[] = [];
      for (const s of orderedSections) {
        const bp = s.drawBlueprintJson as DrawBlueprint | null;
        if (bp?.strata?.length) {
          const name = topicName.get(s.topicId) || "";
          for (const st of bp.strata) quotaRows.push(serializeQuotaRow(name, st));
        }
      }

      // «Пороги вариантов» (PRD-24, FR-14): one row per variant of a section whose
      // rule is `by_variant`. The workbook keys variants by POSITION (they are
      // auto-numbered, PRD-17 D-10), so the stable formId is translated to the
      // 1-based number — the same numbering the «Варианты» column of «Вопросы» uses.
      const variantThresholdRows: Record<string, unknown>[] = [];
      for (const s of orderedSections) {
        const rule = s.topicPassRuleJson as
          | { source?: string; byForm?: Record<string, { type: "percent" | "absolute"; value: number }> }
          | null;
        const fs = s.formSetJson as FormSet | null;
        if (rule?.source !== "by_variant" || !fs) continue;
        const name = topicName.get(s.topicId) || "";
        fs.forms.forEach((form, i) => {
          const entry = rule.byForm?.[form.id];
          if (!entry) return;
          variantThresholdRows.push(
            serializeVariantThresholdRow({
              topicName: name,
              variantNumber: i + 1,
              type: entry.type,
              value: entry.value,
            }),
          );
        });
      }

      // «Оценка» (PRD-15 block D, FR-36): the test's per-question scoring
      // overrides, referenced by the same local alias as «Вклады вопросов».
      const overrides = await storage.getTestQuestionScoring(testId);
      const scoringRows = overrides
        .filter((o) => aliasByQuestionId.has(o.questionId))
        .map((o) => serializeScoringOverrideRow(o, aliasByQuestionId.get(o.questionId)!));

      // «Папка» of the settings sheet — the path from the root, walked up the parents.
      const folders = await storage.getTestFolders();
      const folderById = new Map(folders.map((f) => [f.id, f]));
      const folderPath = (() => {
        const parts: string[] = [];
        let cur = test.folderId ? folderById.get(test.folderId) : undefined;
        const guard = new Set<string>();
        while (cur && !guard.has(cur.id)) {
          guard.add(cur.id);
          parts.unshift(cur.name);
          cur = cur.parentId ? folderById.get(cur.parentId) : undefined;
        }
        return parts.join(" / ");
      })();

      const wb = new ExcelJS.Workbook();
      // PRD-30 FR-22: настройки САМОГО теста идут первым листом: они
      // описывают всю книгу, а остальные листы — её содержимое.
      addSheet(wb, "Настройки", serializeSettingsRows({ ...test, folderPath }), SETTINGS_HEADERS, SETTINGS_WIDTHS);
      addSheet(wb, "Вопросы", questionRows, ["Ключ строки", ...QUESTION_HEADERS, VARIANTS_COLUMN], [12, ...QUESTION_WIDTHS, 25]);
      addSheet(wb, "Структура", structureRows, STRUCTURE_HEADERS, STRUCTURE_WIDTHS);
      addSheet(wb, "Квоты", quotaRows, QUOTA_HEADERS, QUOTA_WIDTHS);
      addSheet(wb, "Пороги вариантов", variantThresholdRows, VARIANT_THRESHOLD_HEADERS, VARIANT_THRESHOLD_WIDTHS);
      addSheet(wb, "Оценка", scoringRows, SCORING_OVERRIDE_HEADERS, SCORING_OVERRIDE_WIDTHS);
      addSheet(wb, "Шкалы", scaleRows, SCALE_HEADERS, SCALE_WIDTHS);
      addSheet(wb, "Показатели", rvRows, RESULT_VAR_HEADERS, RESULT_VAR_WIDTHS);
      addSheet(wb, "Вклады вопросов", measRows, MEASUREMENT_HEADERS, MEASUREMENT_WIDTHS);

      const buffer = await workbookToBuffer(wb);
      const safeName = test.title.replace(/[^a-zA-Zа-яА-Я0-9]/g, "_").slice(0, 30);
      const filename = `workbook_${safeName}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      res.send(buffer);
    } catch (error) {
      logger.error("Workbook export error: " + (error as Error).message, "tests-workbook");
      res.status(500).json({ error: "Failed to export workbook" });
    }
  },
);

export default router;
