/**
 * @module server/storage/scorm-repository
 * @description Data access for the SCORM telemetry domain: packages
 * (`scorm_packages`), attempts (`scorm_attempts`) and per-question answers
 * (`scorm_answers`). Attempts are keyed by (packageId, sessionId, attemptNumber);
 * `getNextAttemptNumber` computes the next sequence number. Packages carry a
 * nullable `testId` and survive test deletion by design, so this domain is
 * self-contained. Exposed through the `IStorage` facade, never imported by routes.
 */
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import {
  scormPackages, scormAttempts, scormAnswers, lmsImportBatches,
  type ScormPackage, type InsertScormPackage,
  type ScormAttempt, type InsertScormAttempt,
  type ScormAnswer, type InsertScormAnswer,
  type LmsImportBatch, type InsertLmsImportBatch,
} from "@shared/schema";

/**
 * Поля импортированного прохождения (PRD-54).
 *
 * `origin` зафиксирован литералом намеренно: телеметрия в этот метод не ходит, и тип должен это
 * говорить, а не полагаться на дисциплину вызывающего.
 */
export interface ImportedAttemptInput {
  testId: string;
  participantKey: string;
  /**
   * Различитель попыток участника за одну дату (PRD-54 раздел 8.1): `r:<метка регистрации>` или
   * `c:<отпечаток>:<n>`. Входит в ключ вместе с тестом, псевдонимом и датой.
   */
  attemptKey: string;
  origin: "import";
  batchId: string | null;
  groupId: string | null;
  userId: string | null;
  lmsUserName: string | null;
  lmsUserOrg: string | null;
  /** Подразделение и должность: входят в псевдоним, поэтому хранятся рядом с прохождением. */
  lmsUserUnit: string | null;
  lmsUserPosition: string | null;
  startedAt: Date;
  finishedAt: Date;
  lastActivityAt: Date;
  resultPassed: boolean | null;
  totalPoints: number | null;
  /** Процент из корневого балла выгрузки; `null` — балла нет (измерительный тест). */
  resultPercent: number | null;
  /** Шкала процента (100) рядом с ним; `null` вместе с процентом. */
  maxPoints: number | null;
  /** PRD-55 FR-08: выданный состав прохождения — из него пересчитывается экспозиция импорта. */
  deliveredQuestionIds: string[];
  totalQuestions: number | null;
  scalesJson: Record<string, number> | null;
  variablesJson: Record<string, string> | null;
  /**
   * PRD-56 FR-19a: версия публикации прохождения, разрешённая по номеру из выгрузки.
   * `null` — пакет версии не сообщал либо снимка с таким номером у теста нет.
   */
  snapshotId: string | null;
  /** PRD-56 FR-18: выданные варианты картой «тема -> вариант»; `null` — вариантов не было. */
  formsJson: Record<string, string> | null;
  /**
   * Достигнутые уровни тем `[{ topicId, topicName, levelName }]` — та же колонка и форма, что у
   * телеметрии; `levelName: null` — уровень не достигнут, `null` целиком — блоков уровней нет.
   */
  achievedLevelsJson: Array<{ topicId: string; topicName: string | null; levelName: string | null }> | null;
  /** Рекомендованные курсы `[{ title, url }]`, как у телеметрии; `null` — рекомендаций нет. */
  failedTopicCoursesJson: Array<{ title: string; url: string }> | null;
}

/** Уже загруженное прохождение теста — то, с чем импорт сопоставляет строки файла (BR-54-37). */
export interface ImportedAttemptKeyRow {
  id: string;
  participantKey: string;
  startedAt: Date;
  /** `null` — строка загружена до появления различителя (2026-10-06). */
  attemptKey: string | null;
}

/** Счётчики и протокол, которыми партия дополняется после прогона. */
export interface LmsImportCounts {
  rowsTotal: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsLinked: number;
  /** PRD-66 FR-11: взаимодействий, не нашедших своего задания в тесте. */
  rowsUnmatched: number;
  warnings: string[];
}

/** Repository for the SCORM telemetry tables. */
export class ScormRepository {
  async createScormPackage(pkg: InsertScormPackage & { id: string }): Promise<ScormPackage> {
    const [created] = await db.insert(scormPackages).values(pkg).returning();
    return created;
  }

  async getScormPackage(id: string): Promise<ScormPackage | undefined> {
    const [pkg] = await db.select().from(scormPackages).where(eq(scormPackages.id, id));
    return pkg || undefined;
  }

  async getScormPackagesByTest(testId: string): Promise<ScormPackage[]> {
    return db.select().from(scormPackages).where(eq(scormPackages.testId, testId));
  }

  async getScormPackages(): Promise<ScormPackage[]> {
    return db.select().from(scormPackages);
  }

  async updateScormPackage(id: string, data: Partial<ScormPackage>): Promise<ScormPackage | undefined> {
    const [updated] = await db.update(scormPackages)
      .set(data)
      .where(eq(scormPackages.id, id))
      .returning();
    return updated || undefined;
  }

  async createScormAttempt(attempt: InsertScormAttempt & { id: string }): Promise<ScormAttempt> {
    const [created] = await db.insert(scormAttempts).values(attempt).returning();
    return created;
  }

  async getScormAttempt(id: string): Promise<ScormAttempt | undefined> {
    const [attempt] = await db.select().from(scormAttempts).where(eq(scormAttempts.id, id));
    return attempt || undefined;
  }

  /**
   * Достигнутые уровни и курсы проваленных тем для набора прохождений LMS — то, что пакет
   * сообщает телеметрией при завершении (`finish`). Слой наблюдений этих полей не несёт, а книге
   * выгрузки они нужны для листов «Статистика уровней» и «Рекомендации». Один запрос по id.
   *
   * @param ids идентификаторы прохождений (`scorm_attempts.id`)
   */
  async getScormAttemptOutcomes(ids: string[]): Promise<Array<{
    id: string;
    achievedLevelsJson: unknown;
    failedTopicCoursesJson: unknown;
  }>> {
    if (ids.length === 0) return [];
    return db
      .select({
        id: scormAttempts.id,
        achievedLevelsJson: scormAttempts.achievedLevelsJson,
        failedTopicCoursesJson: scormAttempts.failedTopicCoursesJson,
      })
      .from(scormAttempts)
      .where(inArray(scormAttempts.id, ids));
  }

  async getScormAttemptBySession(
    packageId: string,
    sessionId: string,
    attemptNumber?: number,
  ): Promise<ScormAttempt | undefined> {
    if (attemptNumber !== undefined) {
      // Look up a specific attempt by number
      const [attempt] = await db.select().from(scormAttempts)
        .where(and(
          eq(scormAttempts.packageId, packageId),
          eq(scormAttempts.sessionId, sessionId),
          eq(scormAttempts.attemptNumber, attemptNumber)
        ));
      return attempt || undefined;
    }

    // No attemptNumber given — return the latest attempt
    const [attempt] = await db.select().from(scormAttempts)
      .where(and(
        eq(scormAttempts.packageId, packageId),
        eq(scormAttempts.sessionId, sessionId)
      ))
      .orderBy(desc(scormAttempts.attemptNumber));
    return attempt || undefined;
  }

  async getNextAttemptNumber(packageId: string, sessionId: string): Promise<number> {
    const [result] = await db
      .select({ maxNum: sql<number>`COALESCE(MAX(${scormAttempts.attemptNumber}), 0)` })
      .from(scormAttempts)
      .where(and(
        eq(scormAttempts.packageId, packageId),
        eq(scormAttempts.sessionId, sessionId)
      ));
    return (result?.maxNum || 0) + 1;
  }

  async getScormAttemptsByPackage(packageId: string): Promise<ScormAttempt[]> {
    return db.select().from(scormAttempts).where(eq(scormAttempts.packageId, packageId));
  }

  async updateScormAttempt(id: string, data: Partial<ScormAttempt>): Promise<ScormAttempt | undefined> {
    const [updated] = await db.update(scormAttempts)
      .set(data)
      .where(eq(scormAttempts.id, id))
      .returning();
    return updated || undefined;
  }

  async getAllScormAttempts(): Promise<ScormAttempt[]> {
    return db.select().from(scormAttempts);
  }

  async createScormAnswer(answer: InsertScormAnswer & { id: string }): Promise<ScormAnswer> {
    const [created] = await db.insert(scormAnswers).values(answer).returning();
    return created;
  }

  async getScormAnswersByAttempt(attemptId: string): Promise<ScormAnswer[]> {
    return db.select().from(scormAnswers).where(eq(scormAnswers.attemptId, attemptId));
  }

  // ─── PRD-54: импорт выгрузок отчётов LMS ────────────────────────────────────

  /**
   * Записать импортированное прохождение, обновив существующее с тем же ключом (PRD-54 раздел 8.1).
   *
   * Ключ — `(test_id, participant_key, started_at, attempt_key)`, он же частичный уникальный индекс
   * `scorm_attempts_import_row_idx`. Конфликт разрешает БАЗА, а не проверка «сначала выбрать,
   * потом вставить»: две параллельные загрузки одного файла иначе создали бы дубли.
   *
   * Обновляются не все поля подряд, а только те, что приносит новая загрузка. `participant_key`,
   * `test_id`, `started_at` и `attempt_key` в набор не входят — они и есть ключ.
   *
   * @param data поля прохождения
   * @returns идентификатор строки и признак `created`: создана (true) или обновлена (false)
   */
  async upsertImportedAttempt(data: ImportedAttemptInput): Promise<{ id: string; created: boolean }> {
    const id = randomUUID();
    const [row] = await db
      .insert(scormAttempts)
      .values({ id, ...data })
      .onConflictDoUpdate({
        target: [scormAttempts.testId, scormAttempts.participantKey, scormAttempts.startedAt, scormAttempts.attemptKey],
        targetWhere: sql`${scormAttempts.origin} = 'import'`,
        set: {
          batchId: data.batchId,
          groupId: data.groupId,
          userId: data.userId,
          lmsUserName: data.lmsUserName,
          lmsUserOrg: data.lmsUserOrg,
          finishedAt: data.finishedAt,
          lastActivityAt: data.lastActivityAt,
          resultPassed: data.resultPassed,
          totalPoints: data.totalPoints,
          resultPercent: data.resultPercent,
          maxPoints: data.maxPoints,
          deliveredQuestionIds: data.deliveredQuestionIds,
          totalQuestions: data.totalQuestions,
          scalesJson: data.scalesJson,
          variablesJson: data.variablesJson,
          // Повторная загрузка переписывает уровни тем и рекомендации целиком, как и шкалы.
          achievedLevelsJson: data.achievedLevelsJson,
          failedTopicCoursesJson: data.failedTopicCoursesJson,
          // PRD-56: повторная загрузка того же файла обязана обновлять и версию с вариантом —
          // иначе строка, загруженная пакетом прошлой сборки, навсегда осталась бы без версии.
          snapshotId: data.snapshotId,
          formsJson: data.formsJson,
        },
      })
      .returning({ id: scormAttempts.id });
    // Идентификатор генерируется ДО запроса, поэтому совпадение выданного и вернувшегося и есть
    // ответ «строку создали». Отдельный SELECT ради того же факта был бы вторым обращением к базе.
    return { id: row.id, created: row.id === id };
  }

  /**
   * Ключи всех импортированных прохождений теста (PRD-54 раздел 8.1, BR-54-37).
   *
   * Читается один раз на партию: по нему импорт решает, обновит строка файла свою запись, перенимет
   * чужую без различителя или создаст новую, — и сухой прогон считает то же самое без записи.
   *
   * @param testId тест загрузки
   * @returns идентификатор, псевдоним, дата и различитель каждой импортированной строки теста
   */
  async listImportedAttemptKeys(testId: string): Promise<ImportedAttemptKeyRow[]> {
    const rows = await db
      .select({
        id: scormAttempts.id,
        participantKey: scormAttempts.participantKey,
        startedAt: scormAttempts.startedAt,
        attemptKey: scormAttempts.attemptKey,
      })
      .from(scormAttempts)
      .where(and(eq(scormAttempts.testId, testId), eq(scormAttempts.origin, "import")));
    // У импорта псевдоним заполнен всегда; строка без него сопоставляться ни с чем не может.
    return rows.flatMap((r) => (r.participantKey ? [{ ...r, participantKey: r.participantKey }] : []));
  }

  /**
   * Передать уже лежащей записи ключ строки файла (BR-54-37): запись без различителя или с
   * отпечатком той же строки отчёта перестаёт быть отдельным прохождением и обновляется следующим
   * upsert-ом, а не остаётся рядом дублем.
   *
   * @param id запись, которая перенимает ключ
   * @param attemptKey новый различитель
   */
  async setImportedAttemptKey(id: string, attemptKey: string): Promise<void> {
    await db
      .update(scormAttempts)
      .set({ attemptKey })
      .where(and(eq(scormAttempts.id, id), eq(scormAttempts.origin, "import")));
  }

  /** Переписать ответы попытки: повторный импорт заменяет их целиком, а не доливает. */
  async replaceImportedAnswers(attemptId: string, answers: (InsertScormAnswer & { id: string })[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(scormAnswers).where(eq(scormAnswers.attemptId, attemptId));
      if (answers.length > 0) await tx.insert(scormAnswers).values(answers);
    });
  }

  /** Завести партию импорта. Счётчики проставляются позже, когда строки записаны. */
  async createLmsImportBatch(batch: InsertLmsImportBatch & { id: string }): Promise<{ id: string }> {
    const [row] = await db.insert(lmsImportBatches).values(batch).returning({ id: lmsImportBatches.id });
    return row;
  }

  /** Проставить счётчики и протокол после прогона. */
  async updateLmsImportBatch(id: string, counts: LmsImportCounts): Promise<void> {
    await db.update(lmsImportBatches).set({
      rowsTotal: counts.rowsTotal,
      rowsCreated: counts.rowsCreated,
      rowsUpdated: counts.rowsUpdated,
      rowsSkipped: counts.rowsSkipped,
      rowsLinked: counts.rowsLinked,
      rowsUnmatched: counts.rowsUnmatched,
      warningsJson: counts.warnings,
    }).where(eq(lmsImportBatches.id, id));
  }

  /**
   * Одна партия по идентификатору — нужна откату, чтобы узнать ТЕСТ партии: область доступа
   * проверяется по тесту, а в маршруте отката стоит идентификатор партии.
   */
  async getLmsImportBatchById(id: string): Promise<LmsImportBatch | undefined> {
    const [row] = await db.select().from(lmsImportBatches).where(eq(lmsImportBatches.id, id));
    return row || undefined;
  }

  /** Партии теста, новые первыми. */
  async getLmsImportBatches(testId: string): Promise<LmsImportBatch[]> {
    return db.select().from(lmsImportBatches)
      .where(eq(lmsImportBatches.testId, testId))
      .orderBy(desc(lmsImportBatches.importedAt));
  }

  /**
   * Откатить партию целиком (PRD-54 раздел 8.6).
   *
   * Одной транзакцией: половина отката хуже, чем его отсутствие — прохождения без партии осели бы
   * в аналитике навсегда и уже ничем бы не удалялись. Телеметрию не задевает: удаляются только
   * строки с этим `batch_id`, а у телеметрии он пуст.
   */
  async deleteLmsImportBatch(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      const attempts = await tx.select({ id: scormAttempts.id }).from(scormAttempts)
        .where(eq(scormAttempts.batchId, id));
      const ids = attempts.map((a) => a.id);
      if (ids.length > 0) await tx.delete(scormAnswers).where(inArray(scormAnswers.attemptId, ids));
      await tx.delete(scormAttempts).where(eq(scormAttempts.batchId, id));
      await tx.delete(lmsImportBatches).where(eq(lmsImportBatches.id, id));
    });
  }
}
