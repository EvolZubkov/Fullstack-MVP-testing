/**
 * @module server/storage/topics-repository
 * @description Data access for the topic domain: topic CRUD, folder placement,
 * rich-feedback accessors (courses/events sourced from `topics.feedback_json`,
 * TD-02) and topic-rooted orchestration — the full-cascade delete (questions,
 * dangling test sections and topic-scoped content pages go with the topic,
 * PRD-15 FR-07), duplication (topic + its questions, atomic) and the formula
 * rename side-effect (`topicByName(...)` references in live result variables,
 * PRD-2 §4.2). These operations are rooted at the topic aggregate, so they live
 * here even though they touch neighbouring tables. Topic ownership/visibility
 * and access grants live in `AccessRepository`. Exposed through the `IStorage`
 * facade, never imported by routes.
 */
import { randomUUID } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  topics, questions, testSections, contentPages, resultVariables,
  type Topic, type InsertTopic, type Question, type TopicCourse, type TopicEvent,
} from "@shared/schema";
import { normalizeTopicName } from "@shared/topics/naming";
import { topicCoursesFromFeedback, topicEventsFromFeedback } from "@shared/topics/recommendations";
import { renameTopicByNameInFormula } from "@shared/formula";

/** Repository for the `topics` table and topic-rooted cascades. */
export class TopicsRepository {
  async getTopics(): Promise<Topic[]> {
    return db.select().from(topics);
  }

  async getTopic(id: string): Promise<Topic | undefined> {
    const [topic] = await db.select().from(topics).where(eq(topics.id, id));
    return topic || undefined;
  }

  /**
   * Build a topic row, computing the PRD-15 invariants (owner, private-by-default
   * visibility, normalized name) in ONE place so createTopic and the duplicate
   * path cannot diverge.
   */
  private topicInsertValues(topic: InsertTopic) {
    return {
      id: randomUUID(),
      name: topic.name,
      code: topic.code ?? null,
      description: topic.description || null,
      feedback: topic.feedback || null,
      feedbackJson: topic.feedbackJson ?? null,
      folderId: topic.folderId || null,
      createdBy: topic.createdBy || null,
      // PRD-15 block C: a new topic is owned by its creator and private by
      // default (F-10). Legacy rows keep owner NULL / visibility shared.
      ownerId: topic.ownerId ?? topic.createdBy ?? null,
      visibility: topic.visibility ?? "private",
      // PRD-15 FR-27: keep the normalized name in sync with `name`.
      nameNormalized: normalizeTopicName(topic.name),
    };
  }

  /**
   * A copy name unique among one owner's topics (owner-scoped uniqueness, PRD-15
   * FR-27). Returns `base` unchanged for an unowned copy — owner NULL is excluded
   * from the uniqueness index, so no collision is possible.
   */
  private async uniqueTopicName(ownerId: string | null, base: string): Promise<string> {
    if (!ownerId) return base;
    const owned = await db
      .select({ nameNormalized: topics.nameNormalized })
      .from(topics)
      .where(eq(topics.ownerId, ownerId));
    const taken = new Set(owned.map((t) => t.nameNormalized).filter(Boolean));
    let name = base;
    for (let n = 2; taken.has(normalizeTopicName(name)); n += 1) {
      name = `${base} ${n}`;
    }
    return name;
  }

  async createTopic(topic: InsertTopic): Promise<Topic> {
    const [newTopic] = await db.insert(topics).values(this.topicInsertValues(topic)).returning();
    return newTopic;
  }

  async updateTopic(id: string, updates: Partial<InsertTopic>): Promise<Topic | undefined> {
    // PRD-15 FR-27: a rename must refresh the normalized name too.
    // PRD-25 FR-20: any edit of the topic refreshes its recency stamp. Written
    // in the same statement as the patch, so a failed update cannot move it.
    const patch = {
      ...(typeof updates.name === "string"
        ? { ...updates, nameNormalized: normalizeTopicName(updates.name) }
        : updates),
      updatedAt: sql`now()`,
    };
    const [updated] = await db.update(topics).set(patch).where(eq(topics.id, id)).returning();
    return updated || undefined;
  }

  /**
   * Keep `topicByName("…")` formula references consistent after a topic rename
   * (PRD-2 §4.2). Scoped to LIVE result variables of tests that USE this topic —
   * a formula may only reference its own test's topics, so the rename resolves
   * unambiguously. Published snapshots are frozen and intentionally untouched.
   */
  async renameTopicInFormulas(topicId: string, oldName: string, newName: string): Promise<void> {
    if (oldName === newName) return;
    const sections = await db
      .select({ testId: testSections.testId })
      .from(testSections)
      .where(eq(testSections.topicId, topicId));
    const testIds = [...new Set(sections.map((s) => s.testId))];
    if (testIds.length === 0) return;
    const rvs = await db.select().from(resultVariables).where(inArray(resultVariables.testId, testIds));
    const changed = rvs
      .map((rv) => ({ id: rv.id, next: renameTopicByNameInFormula(rv.formula, oldName, newName), formula: rv.formula }))
      .filter((r) => r.next !== r.formula);
    if (changed.length === 0) return;
    // Rewrite all affected formulas atomically — a partial rename would leave
    // some references pointing at the old topic name.
    await db.transaction(async (tx) => {
      for (const { id, next } of changed) {
        await tx
          .update(resultVariables)
          .set({ formula: next, updatedAt: new Date() })
          .where(eq(resultVariables.id, id));
      }
    });
  }

  async deleteTopic(id: string): Promise<boolean> {
    // Full cascade (PRD-15 FR-07, audit F-8/F-4): questions, dangling test
    // sections and topic-scoped content pages all go with the topic.
    // Recommended courses/events live in topics.feedback_json (deleted with the
    // row). Deletion while published tests depend on it is gated upstream by the
    // draw-feasibility check (FR-05), so reaching this point means the caller
    // accepted the consequences.
    return db.transaction(async (tx) => {
      await tx.delete(questions).where(eq(questions.topicId, id));
      await tx.delete(testSections).where(eq(testSections.topicId, id));
      await tx.delete(contentPages).where(eq(contentPages.topicId, id));
      const result = await tx.delete(topics).where(eq(topics.id, id)).returning();
      return result.length > 0;
    });
  }

  async deleteTopicsBulk(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    // Same full cascade as deleteTopic (PRD-15 FR-07) — as one unit.
    return db.transaction(async (tx) => {
      await tx.delete(questions).where(inArray(questions.topicId, ids));
      await tx.delete(testSections).where(inArray(testSections.topicId, ids));
      await tx.delete(contentPages).where(inArray(contentPages.topicId, ids));
      const result = await tx.delete(topics).where(inArray(topics.id, ids)).returning();
      return result.length;
    });
  }

  async moveTopicsToFolder(ids: string[], folderId: string | null): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await db.update(topics).set({ folderId }).where(inArray(topics.id, ids)).returning();
    return result.length;
  }

  // TD-02 r.3: recommended courses/events are now sourced from the topic's rich
  // feedback (topics.feedback_json: links → courses, events → events), NOT the
  // legacy topic_courses/topic_events tables (write paths removed in D1/D2). The
  // accessor names/shapes are kept so delivery callers (attempts, SCORM export,
  // snapshot capture, GET /api/topics) stay unchanged. The tables are write-dead
  // and read-dead and will be dropped by a later migration.
  async getTopicCourses(topicId: string): Promise<TopicCourse[]> {
    const topic = await this.getTopic(topicId);
    return topicCoursesFromFeedback(topic);
  }

  async getTopicEvents(topicId: string): Promise<TopicEvent[]> {
    const topic = await this.getTopic(topicId);
    return topicEventsFromFeedback(topic);
  }

  async duplicateTopicWithQuestions(
    id: string,
    createdBy?: string,
  ): Promise<{ topic: Topic; questions: Question[] } | undefined> {
    const originalTopic = await this.getTopic(id);
    if (!originalTopic) return undefined;
    const originalQuestions = await db.select().from(questions).where(eq(questions.topicId, id));

    // Topic invariants come from the shared builder (same as createTopic): the
    // copy is a fresh topic owned by the duplicator, private, and without the
    // author code (a per-test formula alias, not to be shared). Name made unique
    // within the owner. Topic + questions are copied atomically so a failed
    // question insert cannot leave a half-copied topic.
    const ownerId = createdBy ?? null;
    const name = await this.uniqueTopicName(ownerId, originalTopic.name + " (копия)");

    return db.transaction(async (tx) => {
      const [newTopic] = await tx
        .insert(topics)
        .values(this.topicInsertValues({
          name,
          description: originalTopic.description ?? undefined,
          feedback: originalTopic.feedback ?? undefined,
          // TD-02 r.3: rich feedback (courses/events) travels with the copy.
          feedbackJson: originalTopic.feedbackJson ?? undefined,
          folderId: originalTopic.folderId ?? undefined,
          createdBy,
        } as InsertTopic))
        .returning();

      const newQuestions: Question[] = [];
      for (const q of originalQuestions) {
        const [newQ] = await tx.insert(questions).values({
          id: randomUUID(),
          topicId: newTopic.id,
          type: q.type,
          prompt: q.prompt,
          dataJson: q.dataJson,
          correctJson: q.correctJson,
          difficulty: q.difficulty,
          mediaUrl: q.mediaUrl,
          mediaType: q.mediaType,
          shuffleAnswers: q.shuffleAnswers,
          feedback: q.feedback,
          feedbackMode: q.feedbackMode,
          feedbackCorrect: q.feedbackCorrect,
          feedbackIncorrect: q.feedbackIncorrect,
          contentHash: q.contentHash,
          tags: q.tags,
          createdBy: createdBy ?? null,
        }).returning();
        newQuestions.push(newQ);
      }

      return { topic: newTopic, questions: newQuestions };
    });
  }
}
