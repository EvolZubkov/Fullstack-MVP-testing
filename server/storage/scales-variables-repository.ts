/**
 * @module server/storage/scales-variables-repository
 * @description Data access for the scoring-configuration domain: result
 * variables (PRD-2, `result_variables`), scales and per-question measurements
 * (PRD-5, `scales` + `question_measurements`) and per-(test, question) scoring
 * overrides (PRD-15 block D, `test_question_scoring`). Includes
 * `validateResultVariableFormula`, which builds a test's reference sets (topics
 * via its sections, prior variables, scale keys) and runs the shared DSL
 * validator — a query rooted at the result-variable being edited, so it reads the
 * neighbouring `test_sections`/`topics`/`scales` tables. Set-replacement
 * mutations run in a transaction. Exposed through the `IStorage` facade, never
 * imported by routes.
 */
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  resultVariables, scales, questionMeasurements, testQuestionScoring, testSections, topics,
  type ResultVariable, type InsertResultVariable,
  type Scale, type InsertScale,
  type QuestionMeasurement, type InsertQuestionMeasurement,
  type TestQuestionScoring, type InsertTestQuestionScoring,
} from "@shared/schema";
import { validate, type ValidationResult, type ValueType } from "@shared/formula";

/** Repository for result variables, scales, measurements and scoring overrides. */
export class ScalesVariablesRepository {
  // ─── Referential lookup used by the PRD-15 integrity checks ────────────────

  async getMeasurementsForQuestions(
    questionIds: string[],
  ): Promise<Array<{ testId: string; questionId: string }>> {
    if (questionIds.length === 0) return [];
    return db
      .select({ testId: questionMeasurements.testId, questionId: questionMeasurements.questionId })
      .from(questionMeasurements)
      .where(inArray(questionMeasurements.questionId, questionIds));
  }

  // ─── Result variables (PRD-2) ──────────────────────────────────────────────

  async getResultVariables(testId: string): Promise<ResultVariable[]> {
    return db.select().from(resultVariables)
      .where(eq(resultVariables.testId, testId))
      .orderBy(resultVariables.sortOrder);
  }

  async createResultVariable(rv: InsertResultVariable): Promise<ResultVariable> {
    const [created] = await db.insert(resultVariables).values(rv).returning();
    return created;
  }

  async updateResultVariable(id: string, updates: Partial<InsertResultVariable>): Promise<ResultVariable | undefined> {
    const [updated] = await db.update(resultVariables)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(resultVariables.id, id))
      .returning();
    return updated;
  }

  async deleteResultVariable(id: string): Promise<boolean> {
    const result = await db.delete(resultVariables).where(eq(resultVariables.id, id)).returning();
    return result.length > 0;
  }

  async reorderResultVariables(updates: { id: string; sortOrder: number }[]): Promise<void> {
    await db.transaction(async (tx) => {
      for (const { id, sortOrder } of updates) {
        await tx.update(resultVariables)
          .set({ sortOrder, updatedAt: new Date() })
          .where(eq(resultVariables.id, id));
      }
    });
  }

  /**
   * Validate a result-variable formula against a test's reference sets using the
   * shared DSL. `topicById` resolves to the test's topics; `var()` may reference
   * only variables with a smaller `sort_order` (DAG, scoring-model §10.9).
   * `scaleById`/`countScales` resolve against the test's scales (PRD-5, B2).
   */
  async validateResultVariableFormula(
    testId: string,
    formula: string,
    type: ValueType,
    opts: { sortOrder?: number; excludeId?: string; extraScaleKeys?: string[]; extraVarNames?: string[] } = {},
  ): Promise<ValidationResult> {
    const sections = await db.select().from(testSections).where(eq(testSections.testId, testId));
    const sectionTopicIds = sections.map((s) => s.topicId);
    // Valid `topicById` args = topic UUIDs plus their custom codes; `topicByName`
    // args = topic names.
    const topicRows = sectionTopicIds.length
      ? await db
          .select({ id: topics.id, name: topics.name, code: topics.code })
          .from(topics)
          .where(inArray(topics.id, sectionTopicIds))
      : [];
    const topicIds = new Set<string>(sectionTopicIds);
    const topicNames = new Set<string>();
    for (const t of topicRows) {
      if (t.code) topicIds.add(t.code);
      if (t.name) topicNames.add(t.name);
    }
    const existing = await this.getResultVariables(testId);
    const prior = existing.filter(
      (rv) => rv.id !== opts.excludeId && (opts.sortOrder === undefined || rv.sortOrder < opts.sortOrder),
    );
    // `extraScaleKeys`/`extraVarNames`: scales/variables defined in the SAME
    // workbook but not yet persisted (PRD-14 FR-15 dry-run, and a brand-new
    // target test). Without them, a formula referencing a fresh scale/variable
    // would falsely fail validation while the plan is computed without writes.
    const priorVarNames = new Set([...prior.map((rv) => rv.name), ...(opts.extraVarNames ?? [])]);
    const scaleRows = await db.select().from(scales).where(eq(scales.testId, testId));
    const scaleKeys = new Set([...scaleRows.map((s) => s.key), ...(opts.extraScaleKeys ?? [])]);
    return validate(formula, type, { topicIds, topicNames, priorVarNames, scaleKeys });
  }

  // ─── Scales (PRD-5) ─────────────────────────────────────────────────────────

  async getScales(testId: string): Promise<Scale[]> {
    return db.select().from(scales)
      .where(eq(scales.testId, testId))
      .orderBy(scales.sortOrder);
  }

  async createScale(scale: InsertScale): Promise<Scale> {
    const [created] = await db.insert(scales).values(scale).returning();
    return created;
  }

  async updateScale(id: string, updates: Partial<InsertScale>): Promise<Scale | undefined> {
    const [updated] = await db.update(scales)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(scales.id, id))
      .returning();
    return updated;
  }

  async deleteScale(id: string): Promise<boolean> {
    const result = await db.delete(scales).where(eq(scales.id, id)).returning();
    return result.length > 0;
  }

  async reorderScales(updates: { id: string; sortOrder: number }[]): Promise<void> {
    await db.transaction(async (tx) => {
      for (const { id, sortOrder } of updates) {
        await tx.update(scales)
          .set({ sortOrder, updatedAt: new Date() })
          .where(eq(scales.id, id));
      }
    });
  }

  // ─── Per-question measurements (PRD-5) ────────────────────────────────────────

  async getQuestionMeasurements(testId: string): Promise<QuestionMeasurement[]> {
    return db.select().from(questionMeasurements)
      .where(eq(questionMeasurements.testId, testId))
      .orderBy(questionMeasurements.sortOrder);
  }

  async getQuestionMeasurementsByQuestion(
    testId: string,
    questionId: string,
  ): Promise<QuestionMeasurement[]> {
    return db.select().from(questionMeasurements)
      .where(and(
        eq(questionMeasurements.testId, testId),
        eq(questionMeasurements.questionId, questionId),
      ))
      .orderBy(questionMeasurements.sortOrder);
  }

  /**
   * Replace all measurements of one question in one test with `rows`
   * (delete-then-insert in a transaction). Returns the persisted rows. An empty
   * `rows` clears the question's contributions.
   */
  async upsertQuestionMeasurements(
    testId: string,
    questionId: string,
    rows: InsertQuestionMeasurement[],
  ): Promise<QuestionMeasurement[]> {
    return db.transaction(async (tx) => {
      await tx.delete(questionMeasurements).where(and(
        eq(questionMeasurements.testId, testId),
        eq(questionMeasurements.questionId, questionId),
      ));
      if (rows.length === 0) return [];
      return tx.insert(questionMeasurements)
        .values(rows.map((r) => ({ ...r, testId, questionId })))
        .returning();
    });
  }

  // ─── Per-(test, question) scoring overrides (PRD-15 block D, FR-30) ──────────

  async getTestQuestionScoring(testId: string): Promise<TestQuestionScoring[]> {
    return db.select().from(testQuestionScoring)
      .where(eq(testQuestionScoring.testId, testId));
  }

  /**
   * Insert or update the single override row of one question in one test.
   * All value columns are replaced as a unit — a null/undefined value clears
   * that link of the chain.
   */
  async upsertTestQuestionScoring(
    testId: string,
    questionId: string,
    values: Omit<InsertTestQuestionScoring, "testId" | "questionId">,
  ): Promise<TestQuestionScoring> {
    const patch = {
      points: values.points ?? null,
      scoringJson: values.scoringJson ?? null,
      difficulty: values.difficulty ?? null,
      pinnedContentHash: values.pinnedContentHash ?? null,
    };
    const [row] = await db.insert(testQuestionScoring)
      .values({ testId, questionId, ...patch })
      .onConflictDoUpdate({
        target: [testQuestionScoring.testId, testQuestionScoring.questionId],
        set: { ...patch, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async deleteTestQuestionScoring(testId: string, questionId: string): Promise<boolean> {
    const result = await db.delete(testQuestionScoring)
      .where(and(
        eq(testQuestionScoring.testId, testId),
        eq(testQuestionScoring.questionId, questionId),
      ))
      .returning();
    return result.length > 0;
  }

  /**
   * Replace ALL scoring overrides of a test with `rows` (delete-then-insert in
   * a transaction) — the workbook «Оценка» sheet is authoritative for the
   * test's override set (PRD-14/PRD-15 FR-36 round-trip). An empty `rows`
   * clears every override.
   */
  async replaceTestQuestionScoring(
    testId: string,
    rows: Omit<InsertTestQuestionScoring, "testId">[],
  ): Promise<TestQuestionScoring[]> {
    return db.transaction(async (tx) => {
      await tx.delete(testQuestionScoring).where(eq(testQuestionScoring.testId, testId));
      if (rows.length === 0) return [];
      return tx.insert(testQuestionScoring)
        .values(rows.map((r) => ({ ...r, testId })))
        .returning();
    });
  }
}
