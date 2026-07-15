/**
 * @module server/storage/questions-repository
 * @description Data access for the question domain: CRUD over the `questions`
 * table (4 types — single/multiple choice, matching, ranking), lookup by id/ids/
 * topic, single-question duplication and the topic-scoped content-hash set used
 * by the PRD-15 integrity checks. Scoring is NOT a property of the question
 * (PRD-15 block D): it resolves per-test elsewhere. Exposed through the
 * `IStorage` facade, never imported by routes.
 */
import { randomUUID } from "crypto";
import { eq, inArray, and, sql } from "drizzle-orm";
import { db } from "../db";
import { questions, type Question, type InsertQuestion } from "@shared/schema";

/** Repository for the `questions` table. */
export class QuestionsRepository {
  async getQuestions(): Promise<Question[]> {
    return db.select().from(questions);
  }

  async getQuestionsByTopic(topicId: string): Promise<Question[]> {
    return db.select().from(questions).where(eq(questions.topicId, topicId));
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
    const [newQuestion] = await db.insert(questions).values({
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
      createdBy: question.createdBy || null,
    }).returning();
    return newQuestion;
  }

  async duplicateQuestion(id: string): Promise<Question | undefined> {
    const original = await this.getQuestion(id);
    if (!original) return undefined;

    const newId = randomUUID();
    const [newQuestion] = await db.insert(questions).values({
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
    }).returning();
    return newQuestion;
  }

  async updateQuestion(id: string, updates: Partial<InsertQuestion>): Promise<Question | undefined> {
    const [updated] = await db.update(questions).set(updates).where(eq(questions.id, id)).returning();
    return updated || undefined;
  }

  async deleteQuestion(id: string): Promise<boolean> {
    const result = await db.delete(questions).where(eq(questions.id, id)).returning();
    return result.length > 0;
  }

  async deleteQuestionsBulk(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await db.delete(questions).where(inArray(questions.id, ids)).returning();
    return result.length;
  }
}
