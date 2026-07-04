/**
 * @module server/storage/adaptive-repository
 * @description Data access for the adaptive-delivery domain: per-(test, topic)
 * settings (`adaptive_topic_settings`), difficulty levels
 * (`adaptive_levels`) and the level→level transition links
 * (`adaptive_level_links`). The by-test deletes drop a level's links via a single
 * subquery (no per-level loop) and run atomically. Exposed through the `IStorage`
 * facade, never imported by routes.
 */
import { randomUUID } from "crypto";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import {
  adaptiveTopicSettings, adaptiveLevels, adaptiveLevelLinks,
  type AdaptiveTopicSettings, type InsertAdaptiveTopicSettings,
  type AdaptiveLevel, type InsertAdaptiveLevel,
  type AdaptiveLevelLink, type InsertAdaptiveLevelLink,
} from "@shared/schema";

/** Repository for the adaptive-delivery tables. */
export class AdaptiveRepository {
  async getAdaptiveTopicSettings(testId: string, topicId: string): Promise<AdaptiveTopicSettings | undefined> {
    const [settings] = await db.select().from(adaptiveTopicSettings)
      .where(and(eq(adaptiveTopicSettings.testId, testId), eq(adaptiveTopicSettings.topicId, topicId)));
    return settings || undefined;
  }

  async getAdaptiveTopicSettingsByTest(testId: string): Promise<AdaptiveTopicSettings[]> {
    return db.select().from(adaptiveTopicSettings).where(eq(adaptiveTopicSettings.testId, testId));
  }

  async createAdaptiveTopicSettings(settings: InsertAdaptiveTopicSettings): Promise<AdaptiveTopicSettings> {
    const id = randomUUID();
    const [newSettings] = await db.insert(adaptiveTopicSettings).values({ id, ...settings }).returning();
    return newSettings;
  }

  async updateAdaptiveTopicSettings(id: string, settings: Partial<InsertAdaptiveTopicSettings>): Promise<AdaptiveTopicSettings | undefined> {
    const [updated] = await db.update(adaptiveTopicSettings).set(settings).where(eq(adaptiveTopicSettings.id, id)).returning();
    return updated || undefined;
  }

  async deleteAdaptiveTopicSettingsByTest(testId: string): Promise<void> {
    await db.delete(adaptiveTopicSettings).where(eq(adaptiveTopicSettings.testId, testId));
  }

  async getAdaptiveLevels(testId: string, topicId: string): Promise<AdaptiveLevel[]> {
    return db.select().from(adaptiveLevels)
      .where(and(eq(adaptiveLevels.testId, testId), eq(adaptiveLevels.topicId, topicId)))
      .orderBy(adaptiveLevels.levelIndex);
  }

  async getAdaptiveLevelsByTest(testId: string): Promise<AdaptiveLevel[]> {
    return db.select().from(adaptiveLevels)
      .where(eq(adaptiveLevels.testId, testId))
      .orderBy(adaptiveLevels.levelIndex);
  }

  async createAdaptiveLevel(level: InsertAdaptiveLevel): Promise<AdaptiveLevel> {
    const id = randomUUID();
    const [newLevel] = await db.insert(adaptiveLevels).values({ id, ...level }).returning();
    return newLevel;
  }

  async updateAdaptiveLevel(id: string, level: Partial<InsertAdaptiveLevel>): Promise<AdaptiveLevel | undefined> {
    const [updated] = await db.update(adaptiveLevels).set(level).where(eq(adaptiveLevels.id, id)).returning();
    return updated || undefined;
  }

  async deleteAdaptiveLevelsByTest(testId: string): Promise<void> {
    // Delete the levels' links (single subquery, no per-level loop) then the
    // levels themselves — atomically.
    await db.transaction(async (tx) => {
      await tx.delete(adaptiveLevelLinks).where(
        sql`${adaptiveLevelLinks.levelId} IN (SELECT ${adaptiveLevels.id} FROM ${adaptiveLevels} WHERE ${adaptiveLevels.testId} = ${testId})`,
      );
      await tx.delete(adaptiveLevels).where(eq(adaptiveLevels.testId, testId));
    });
  }

  async getAdaptiveLevelLinks(levelId: string): Promise<AdaptiveLevelLink[]> {
    return db.select().from(adaptiveLevelLinks).where(eq(adaptiveLevelLinks.levelId, levelId));
  }

  async createAdaptiveLevelLink(link: InsertAdaptiveLevelLink): Promise<AdaptiveLevelLink> {
    const id = randomUUID();
    const [newLink] = await db.insert(adaptiveLevelLinks).values({ id, ...link }).returning();
    return newLink;
  }

  async deleteAdaptiveLevelLinksByLevel(levelId: string): Promise<void> {
    await db.delete(adaptiveLevelLinks).where(eq(adaptiveLevelLinks.levelId, levelId));
  }

  async deleteAdaptiveLevelLinksByTest(testId: string): Promise<void> {
    // Single subquery delete over the test's levels — no per-level loop.
    await db.delete(adaptiveLevelLinks).where(
      sql`${adaptiveLevelLinks.levelId} IN (SELECT ${adaptiveLevels.id} FROM ${adaptiveLevels} WHERE ${adaptiveLevels.testId} = ${testId})`,
    );
  }
}
