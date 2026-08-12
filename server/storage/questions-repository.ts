/**
 * @module server/storage/questions-repository
 * @description Data access for the question domain: CRUD over the `questions`
 * table (4 types — single/multiple choice, matching, ranking), lookup by id/ids/
 * topic, single-question duplication and the topic-scoped content-hash set used
 * by the PRD-15 integrity checks. Scoring is NOT a property of the question
 * (PRD-15 block D): it resolves per-test elsewhere. Exposed through the
 * `IStorage` facade, never imported by routes.
 *
 * PRD-25 FR-20: every write here also refreshes `topics.updated_at` of the
 * affected topic(s) via {@link touchTopics}. That is why the mutating methods
 * run in a transaction even though each of them issues a single content
 * statement — the stamp and the mutation must commit or roll back together, or
 * the home page would order topics by a change that never happened.
 */
import { randomUUID } from "crypto";
import { eq, inArray, and, sql } from "drizzle-orm";
import { db } from "../db";
import { questions, type Question, type InsertQuestion } from "@shared/schema";
import { touchTopics } from "./shared";

/** Repository for the `questions` table. */
export class QuestionsRepository {
  async getQuestions(): Promise<Question[]> {
    // PRD-30 FR-08: the whole-bank read feeds the author's «Темы и вопросы»
    // tree, which groups by topic — so it needs the SAME order as the per-topic
    // read below, otherwise the tree and the delivery disagree about the order.
    return db
      .select()
      .from(questions)
      .orderBy(questions.topicId, sql`${questions.orderIndex} ASC NULLS LAST`, questions.id);
  }

  async getQuestionsByTopic(topicId: string): Promise<Question[]> {
    // PRD-30 FR-08: the bank is read in the author's order — ascending
    // `order_index`, questions without one last, `id` breaking ties so the read
    // is deterministic. Before this the query had no ORDER BY at all, so both
    // the author's list and the input of the draw engines were arbitrary.
    return db
      .select()
      .from(questions)
      .where(eq(questions.topicId, topicId))
      .orderBy(sql`${questions.orderIndex} ASC NULLS LAST`, questions.id);
  }

  /**
   * The grading TRAITS of every question in the given topics — the two columns
   * {@link module:shared/questions/question-type isMeasurementOnly} reads, and
   * nothing else.
   *
   * Batched over topics on purpose: its caller is the learner's test LIST, which
   * asks the question «does this test grade at all» once per assigned test. Reading
   * whole rows per topic there would be a query per section and a payload of option
   * texts nobody looks at. The predicate itself stays in the shared module — the
   * measurement rule must not be re-expressed in SQL, or the answer key's meaning
   * would live in two places.
   */
  async getGradingTraitsByTopics(
    topicIds: string[],
  ): Promise<Array<{ topicId: string; type: string; correctJson: unknown }>> {
    if (topicIds.length === 0) return [];
    return db
      .select({
        topicId: questions.topicId,
        type: questions.type,
        correctJson: questions.correctJson,
      })
      .from(questions)
      .where(inArray(questions.topicId, topicIds));
  }

  async getContentHashesByTopic(topicId: string): Promise<Set<string>> {
    const rows = await db
      .select({ contentHash: questions.contentHash })
      .from(questions)
      .where(and(eq(questions.topicId, topicId), sql`${questions.contentHash} IS NOT NULL`));
    return new Set(rows.map((r) => r.contentHash!));
  }

  async getQuestion(id: string): Promise<Question | undefined> {
    const [question] = await db.select().from(questions).where(eq(questions.id, id));
    return question || undefined;
  }

  async getQuestionsByIds(ids: string[]): Promise<Question[]> {
    if (ids.length === 0) return [];
    return db.select().from(questions).where(inArray(questions.id, ids));
  }

  async createQuestion(question: InsertQuestion): Promise<Question> {
    const id = randomUUID();
    return db.transaction(async (tx) => {
      const [newQuestion] = await tx.insert(questions).values({
        id,
        topicId: question.topicId,
        type: question.type,
        prompt: question.prompt,
        dataJson: question.dataJson,
        correctJson: question.correctJson,
        difficulty: question.difficulty ?? 50,
        mediaUrl: question.mediaUrl || null,
        mediaType: question.mediaType || null,
        shuffleAnswers: question.shuffleAnswers ?? true,
        feedback: question.feedback || null,
        feedbackMode: question.feedbackMode || "general",
        feedbackCorrect: question.feedbackCorrect || null,
        feedbackIncorrect: question.feedbackIncorrect || null,
        contentHash: question.contentHash || null,
        tags: question.tags ?? [],
        // PRD-30 FR-01: `??` and not `||` — 0 is a legitimate index, only an
        // absent value means «not set».
        orderIndex: question.orderIndex ?? null,
        createdBy: question.createdBy || null,
      }).returning();
      // PRD-25 FR-20: the topic gained a question — that is a change to it.
      await touchTopics(tx, [newQuestion.topicId]);
      return newQuestion;
    });
  }

  async duplicateQuestion(id: string): Promise<Question | undefined> {
    const original = await this.getQuestion(id);
    if (!original) return undefined;

    const newId = randomUUID();
    return db.transaction(async (tx) => {
      const [newQuestion] = await tx.insert(questions).values({
        id: newId,
        topicId: original.topicId,
        type: original.type,
        prompt: original.prompt + " (копия)",
        dataJson: original.dataJson,
        correctJson: original.correctJson,
        difficulty: original.difficulty,
        feedback: original.feedback,
        feedbackMode: original.feedbackMode,
        feedbackCorrect: original.feedbackCorrect,
        feedbackIncorrect: original.feedbackIncorrect,
        mediaUrl: original.mediaUrl,
        mediaType: original.mediaType,
        shuffleAnswers: original.shuffleAnswers,
        tags: original.tags,
        // PRD-30: the copy keeps the original's index. It lands in the same
        // group of equals right next to its source, which is where the author
        // expects to find a duplicate before re-indexing it.
        orderIndex: original.orderIndex,
      }).returning();
      await touchTopics(tx, [newQuestion.topicId]);
      return newQuestion;
    });
  }

  async updateQuestion(id: string, updates: Partial<InsertQuestion>): Promise<Question | undefined> {
    return db.transaction(async (tx) => {
      // The question's topic has to be read BEFORE the patch: a question can be
      // moved between topics, and the topic it LEAVES changed too — without this
      // read it would never learn that it lost a question.
      const [before] = await tx
        .select({ topicId: questions.topicId })
        .from(questions)
        .where(eq(questions.id, id));
      if (!before) return undefined;

      const [updated] = await tx.update(questions).set(updates).where(eq(questions.id, id)).returning();
      if (!updated) return undefined;
      // Same id twice when the topic did not change — touchTopics dedupes.
      await touchTopics(tx, [before.topicId, updated.topicId]);
      return updated;
    });
  }

  async deleteQuestion(id: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      // RETURNING carries the topic id out of the row being deleted, so the
      // parent topic is still known after it is gone — no pre-read needed.
      const result = await tx.delete(questions).where(eq(questions.id, id)).returning();
      await touchTopics(tx, result.map((q) => q.topicId));
      return result.length > 0;
    });
  }

  async deleteQuestionsBulk(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return db.transaction(async (tx) => {
      // One statement may span several topics; RETURNING yields every parent.
      const result = await tx.delete(questions).where(inArray(questions.id, ids)).returning();
      await touchTopics(tx, result.map((q) => q.topicId));
      return result.length;
    });
  }
}
