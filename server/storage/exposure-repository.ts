/**
 * @module server/storage/exposure-repository
 * @description PRD-55: доступ к материализованному счётчику выдач `question_exposure`.
 *
 * Пишет ИНКРЕМЕНТОМ в корзину месяца (FR-07), читает сумму за окно (FR-04). Взвешивание берёт
 * сумму по всем тестам, поэтому чтение группирует только по заданию — разбивка по тесту в
 * таблице нужна отчёту автору, а не отбору (FR-06).
 *
 * Таблица — агрегат, а не журнал: она восстановима пересчётом из состава веб-попыток, строк
 * телеметрии и выданного состава импорта (FR-11), поэтому потеря строк теряет точность весов,
 * но не факты.
 *
 * Два источника пишут по-разному (FR-07, FR-08): живые выдачи — инкрементом в строки `live`,
 * импорт выгрузок — пересчётом своих строк `import` по тесту. Читатели суммируют корзины, и
 * источник для них прозрачен.
 *
 * Выставляется через фасад `IStorage`; маршруты этот модуль не импортируют.
 */
import { and, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { config } from "../config";
import { questionExposure, scormAnswers, scormAttempts } from "@shared/schema";

/**
 * Первое число месяца этой даты — ключ корзины.
 *
 * Дата собирается из ЛОКАЛЬНЫХ компонент: колонка объявлена `date` (без часового пояса), и
 * весь проект хранит наивные метки. Через UTC полночь первого числа уехала бы в предыдущий
 * месяц на любом восточном смещении.
 */
function bucketOf(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export class ExposureRepository {
  /**
   * Плюс одна выдача каждому заданию в корзине месяца (FR-03: одна попытка — одна единица,
   * сколько бы раз участник к заданию ни возвращался).
   */
  async recordDeliveries(questionIds: string[], testId: string, at: Date): Promise<void> {
    if (questionIds.length === 0) return;
    const bucketMonth = bucketOf(at);
    // Один вопрос может прийти в списке дважды (две темы, один банк) — для счётчика это
    // по-прежнему ОДНА выдача, и дедупликация обязана случиться ДО вставки: `onConflictDoUpdate`
    // внутри одной команды второй раз не срабатывает, и Postgres отверг бы такую пачку целиком.
    const unique = Array.from(new Set(questionIds));
    const rows = unique.map((questionId) => ({
      questionId,
      testId,
      bucketMonth,
      source: "live" as const,
      deliveredCount: 1,
    }));
    await db.insert(questionExposure).values(rows).onConflictDoUpdate({
      target: [questionExposure.questionId, questionExposure.testId, questionExposure.bucketMonth, questionExposure.source],
      set: { deliveredCount: sql`${questionExposure.deliveredCount} + 1` },
    });
  }

  /**
   * PRD-55 FR-08: пересчитать вклад импортированных выгрузок в счётчик ОДНОГО теста.
   *
   * Строки `import` теста удаляются и собираются заново из выданного состава импортированных
   * прохождений (`scorm_attempts.delivered_question_ids`) — одна выдача на пару «прохождение ×
   * задание» (FR-03). Пересчёт, а не инкремент: повторная загрузка файла обновляет те же
   * прохождения, и прибавка удвоила бы счётчик; откат партии удаляет её прохождения, и тот же
   * пересчёт вычитает их вклад. Строк `live` пересчёт не касается.
   *
   * Окно — то же, что у чтения (FR-05): корзины старше в расчёт не идут, и хранить их незачем.
   *
   * @param testId тест, срез импорта которого пересчитывается
   */
  async rebuildImportExposure(testId: string): Promise<void> {
    const since = new Date();
    since.setMonth(since.getMonth() - config.delivery.exposureWindowMonths);
    const from = bucketOf(since);
    await db.transaction(async (tx) => {
      await tx.delete(questionExposure).where(and(
        eq(questionExposure.testId, testId),
        eq(questionExposure.source, "import"),
      ));
      await tx.execute(sql`
        INSERT INTO question_exposure (question_id, test_id, bucket_month, source, delivered_count)
        SELECT q.question_id, a.test_id, date_trunc('month', a.started_at)::date, 'import',
               COUNT(DISTINCT a.id)::int
        FROM ${scormAttempts} a
        CROSS JOIN LATERAL jsonb_array_elements_text(a.delivered_question_ids) AS q(question_id)
        WHERE a.origin = 'import'
          AND a.test_id = ${testId}
          AND a.delivered_question_ids IS NOT NULL
          AND a.started_at >= ${from}::date
        GROUP BY q.question_id, a.test_id, date_trunc('month', a.started_at)::date
      `);
    });
  }

  /**
   * Сумма выдач по каждому заданию начиная с корзины `since` (включительно).
   *
   * Задание без выдач в карту НЕ попадает: «нет ключа» и «ноль» для веса значат одно и то же
   * (`computeWeights` трактует отсутствие как ноль), а пустой строки в результате запроса и не
   * появится.
   */
  async getDeliveryCounts(questionIds: string[], since: Date): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (questionIds.length === 0) return out;
    const rows = await db
      .select({
        questionId: questionExposure.questionId,
        total: sql<number>`sum(${questionExposure.deliveredCount})::int`,
      })
      .from(questionExposure)
      .where(and(
        inArray(questionExposure.questionId, questionIds),
        gte(questionExposure.bucketMonth, bucketOf(since)),
      ))
      .groupBy(questionExposure.questionId);
    for (const r of rows) out.set(r.questionId, Number(r.total));
    return out;
  }

  /**
   * Сумма выдач заданий В ОДНОМ тесте за окно (PRD-55 FR-31).
   *
   * Отдельный метод, а не фильтр поверх {@link getDeliveryCounts}: взвешивание выдачи берёт
   * ГЛОБАЛЬНОЕ число показов, а отчёт автору — долю по его тесту, и смешивать эти две величины
   * нельзя. Одна отвечает на «насколько задание засвечено вообще», другая — на «как часто его
   * видели участники этого теста».
   */
  async getDeliveryCountsForTest(
    questionIds: string[],
    testId: string,
    since: Date,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (questionIds.length === 0) return out;
    const rows = await db
      .select({
        questionId: questionExposure.questionId,
        total: sql<number>`sum(${questionExposure.deliveredCount})::int`,
      })
      .from(questionExposure)
      .where(and(
        inArray(questionExposure.questionId, questionIds),
        eq(questionExposure.testId, testId),
        gte(questionExposure.bucketMonth, bucketOf(since)),
      ))
      .groupBy(questionExposure.questionId);
    for (const r of rows) out.set(r.questionId, Number(r.total));
    return out;
  }

  /**
   * В скольких ДРУГИХ тестах задание выдавалось за окно (PRD-55 FR-32).
   *
   * Без этого числа задание, растиражированное соседним тестом, читается как редкое: доля по
   * своему тесту у него мала, а видели его втрое больше людей.
   */
  async getOtherTestsCount(
    questionIds: string[],
    testId: string,
    since: Date,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (questionIds.length === 0) return out;
    const rows = await db
      .select({
        questionId: questionExposure.questionId,
        tests: sql<number>`count(distinct ${questionExposure.testId})::int`,
      })
      .from(questionExposure)
      .where(and(
        inArray(questionExposure.questionId, questionIds),
        ne(questionExposure.testId, testId),
        gte(questionExposure.bucketMonth, bucketOf(since)),
      ))
      .groupBy(questionExposure.questionId);
    for (const r of rows) out.set(r.questionId, Number(r.tests));
    return out;
  }

  /**
   * Медиана времени на задание и объём выборки (PRD-55 FR-31a).
   *
   * МЕДИАНА, а не среднее: распределение тяжелохвостое — участник, открывший вопрос и ушедший,
   * даёт одно наблюдение в десятки минут, и среднее по выборке из тридцати ответов уезжает на
   * минуту, выставляя задание трудоёмким.
   *
   * Выборка СВОЯ и почти всегда меньше числа ответов: веб-прохождения времени не измеряют вовсе,
   * а пакеты, собранные до 2026-09-12, его не сообщают. Поэтому объём возвращается рядом с
   * величиной, а задание без единого измерения в карту не попадает — «нет данных» и «ноль
   * секунд» разные вещи.
   */
  async getLatencyStats(
    questionIds: string[],
    testId: string,
    since: Date,
  ): Promise<Map<string, { medianMs: number; sampleSize: number }>> {
    const out = new Map<string, { medianMs: number; sampleSize: number }>();
    if (questionIds.length === 0) return out;
    const rows = await db
      .select({
        questionId: scormAnswers.questionId,
        medianMs: sql<number>`percentile_cont(0.5) within group (order by ${scormAnswers.latencyMs})`,
        sampleSize: sql<number>`count(*)::int`,
      })
      .from(scormAnswers)
      .innerJoin(scormAttempts, eq(scormAttempts.id, scormAnswers.attemptId))
      .where(and(
        inArray(scormAnswers.questionId, questionIds),
        eq(scormAttempts.testId, testId),
        isNotNull(scormAnswers.latencyMs),
        gte(scormAttempts.startedAt, since),
      ))
      .groupBy(scormAnswers.questionId);
    for (const r of rows) {
      out.set(r.questionId, { medianMs: Math.round(Number(r.medianMs)), sampleSize: Number(r.sampleSize) });
    }
    return out;
  }
}
