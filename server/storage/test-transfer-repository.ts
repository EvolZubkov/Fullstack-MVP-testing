/**
 * @module server/storage/test-transfer-repository
 *
 * Writes an imported test graph in ONE transaction.
 *
 * Rows are inserted WHOLE, not field by field. Every other writer in the codebase spells
 * out the columns it sets, and that is precisely the habit that loses a newly added column
 * — the workbook lost half a test that way. Here the plan already holds rows shaped like
 * the table, so they go in as they are; a column added tomorrow travels because nobody has
 * to remember it. Only what belongs to the INSTALLATION is stripped: the timestamps, which
 * the database owns.
 *
 * A column present in the package but absent from this database raises — loudly, and with
 * the whole transaction rolled back. That is the intended answer to importing a package
 * written by a NEWER application: refuse, rather than store a test with a piece missing.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { normalizeTopicName } from "@shared/topics/naming";
import {
  tests,
  topics,
  questions,
  testSections,
  scales,
  resultVariables,
  questionMeasurements,
  contentPages,
  testQuestionScoring,
  adaptiveTopicSettings,
  adaptiveLevels,
  adaptiveLevelLinks,
} from "@shared/schema";
import type { TestSnapshotContent } from "../services/test-snapshot";

/** What one import did, beyond the fact that it succeeded. */
export interface ImportWriteResult {
  testId: string;
  /** Topics renamed to avoid a collision, as `было -> стало`. */
  renamedTopics: string[];
  counts: Record<string, number>;
}

/** The database owns these; a carried-over value would be a lie about this installation. */
const STRIPPED = ["createdAt", "updatedAt"] as const;

/** Row ready to insert: a copy without the columns the database fills in. */
function insertable<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const key of STRIPPED) delete out[key];
  return out;
}

/**
 * Frees a topic name that the importer already uses.
 *
 * `(owner_id, name_normalized)` is unique, so an importer who owns «Лидерство» cannot
 * receive a second one. Renaming keeps the import whole and is reported; joining the
 * existing topic silently would attach the incoming questions to content the author did not
 * choose, which is the more expensive mistake to discover later.
 */
function freeName(name: string, taken: Set<string>): string {
  if (!taken.has(normalizeTopicName(name))) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (импорт ${n})`;
    if (!taken.has(normalizeTopicName(candidate))) return candidate;
  }
}

export class TestTransferRepository {
  /**
   * Stores a planned graph. All ids in `content` are already the ones to be written
   * (see `services/test-transfer/plan`), so this method renumbers nothing.
   */
  async writeImportedTest(content: TestSnapshotContent): Promise<ImportWriteResult> {
    const ownerId = (content.test as unknown as { ownerId: string | null }).ownerId;

    return db.transaction(async (tx) => {
      const renamedTopics: string[] = [];

      // Names already taken by this owner, read INSIDE the transaction.
      const existing = ownerId
        ? await tx.select({ name: topics.name }).from(topics).where(eq(topics.ownerId, ownerId))
        : [];
      const taken = new Set(existing.map((t) => normalizeTopicName(t.name)));

      const topicRows = (content.topics ?? []).map((topic) => {
        const row = insertable(topic as unknown as Record<string, unknown>);
        const original = String(row.name ?? "");
        const free = freeName(original, taken);
        if (free !== original) renamedTopics.push(`${original} -> ${free}`);
        taken.add(normalizeTopicName(free));
        row.name = free;
        row.nameNormalized = normalizeTopicName(free);
        return row;
      });

      if (topicRows.length) await tx.insert(topics).values(topicRows as never);
      await tx.insert(tests).values(insertable(content.test as unknown as Record<string, unknown>) as never);

      const questionRows = Object.values(content.questionsByTopic ?? {})
        .flat()
        .map((q) => insertable(q as unknown as Record<string, unknown>));
      if (questionRows.length) await tx.insert(questions).values(questionRows as never);

      const sectionRows = (content.sections ?? []).map((s) => insertable(s as unknown as Record<string, unknown>));
      if (sectionRows.length) await tx.insert(testSections).values(sectionRows as never);

      const scaleRows = (content.scales ?? []).map((s) => insertable(s as unknown as Record<string, unknown>));
      if (scaleRows.length) await tx.insert(scales).values(scaleRows as never);

      const measurementRows = (content.measurements ?? []).map((m) =>
        insertable(m as unknown as Record<string, unknown>),
      );
      if (measurementRows.length) await tx.insert(questionMeasurements).values(measurementRows as never);

      const variableRows = (content.resultVariables ?? []).map((v) =>
        insertable(v as unknown as Record<string, unknown>),
      );
      if (variableRows.length) await tx.insert(resultVariables).values(variableRows as never);

      const pageRows = (content.contentPages ?? []).map((p) => insertable(p as unknown as Record<string, unknown>));
      if (pageRows.length) await tx.insert(contentPages).values(pageRows as never);

      const scoringRows = (content.questionScoring ?? []).map((s) =>
        insertable(s as unknown as Record<string, unknown>),
      );
      if (scoringRows.length) await tx.insert(testQuestionScoring).values(scoringRows as never);

      const settingRows = (content.adaptiveSettings ?? []).map((s) =>
        insertable(s as unknown as Record<string, unknown>),
      );
      if (settingRows.length) await tx.insert(adaptiveTopicSettings).values(settingRows as never);

      const levelRows = (content.adaptiveLevels ?? []).map((l) => insertable(l as unknown as Record<string, unknown>));
      if (levelRows.length) await tx.insert(adaptiveLevels).values(levelRows as never);

      const linkRows = Object.values(content.adaptiveLevelLinksByLevel ?? {})
        .flat()
        .map((l) => insertable(l as unknown as Record<string, unknown>));
      if (linkRows.length) await tx.insert(adaptiveLevelLinks).values(linkRows as never);

      return {
        testId: String((content.test as unknown as { id: string }).id),
        renamedTopics,
        counts: {
          topics: topicRows.length,
          questions: questionRows.length,
          sections: sectionRows.length,
          scales: scaleRows.length,
          measurements: measurementRows.length,
          resultVariables: variableRows.length,
          contentPages: pageRows.length,
          questionScoring: scoringRows.length,
          adaptiveLevels: levelRows.length,
        },
      };
    });
  }
}

export const testTransferRepository = new TestTransferRepository();
