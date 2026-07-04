/**
 * @module server/storage/content-pages-repository
 * @description Data access for the content-page domain (PRD-1, `content_pages`):
 * intro/content/section-boundary nodes attached to a test (and optionally a
 * topic). Reads order by `(topicId, position, sortOrder)` so a test's pages come
 * back in delivery order; `reorderContentPages` renumbers a batch in one
 * transaction. Rows are removed by FK ON DELETE CASCADE when their test is
 * deleted (see `TestsRepository.deleteTest`), so no cascade lives here. Exposed
 * through the `IStorage` facade, never imported by routes.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { contentPages, type ContentPage, type InsertContentPage } from "@shared/schema";

/** Repository for the `content_pages` table (PRD-1 intro/content pages). */
export class ContentPagesRepository {
  async getContentPages(testId: string): Promise<ContentPage[]> {
    return db.select().from(contentPages)
      .where(eq(contentPages.testId, testId))
      .orderBy(contentPages.topicId, contentPages.position, contentPages.sortOrder);
  }

  async getContentPage(id: string): Promise<ContentPage | undefined> {
    const [page] = await db.select().from(contentPages).where(eq(contentPages.id, id));
    return page;
  }

  async createContentPage(page: InsertContentPage): Promise<ContentPage> {
    const [created] = await db.insert(contentPages).values(page).returning();
    return created;
  }

  async updateContentPage(id: string, updates: Partial<InsertContentPage>): Promise<ContentPage | undefined> {
    const [updated] = await db.update(contentPages)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(contentPages.id, id))
      .returning();
    return updated;
  }

  async deleteContentPage(id: string): Promise<boolean> {
    const result = await db.delete(contentPages).where(eq(contentPages.id, id)).returning();
    return result.length > 0;
  }

  async reorderContentPages(updates: { id: string; sortOrder: number }[]): Promise<void> {
    await db.transaction(async (tx) => {
      for (const { id, sortOrder } of updates) {
        await tx.update(contentPages)
          .set({ sortOrder, updatedAt: new Date() })
          .where(eq(contentPages.id, id));
      }
    });
  }
}
