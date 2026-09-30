/**
 * @module scripts/db/rebuild-exposure
 * @description PRD-55 (FR-11): пересобирает `question_exposure` из ФАКТОВ — состава веб-попыток
 * (`attempts.variant_json`), строк телеметрии (`scorm_answers`) и выданного состава импорта
 * (`scorm_attempts.delivered_question_ids`), — и убирает корзины старше окна наблюдения (FR-05).
 *
 * Нужен дважды. Первый раз — разовой засыпкой при внедрении: счётчик начинает копиться только с
 * момента правки кода, а выдачи, сделанные до неё, уже лежат в попытках, и без засыпки веса
 * первые месяцы считались бы по пустому банку. Второй — лечением расхождений: таблица является
 * АГРЕГАТОМ, а не журналом, поэтому любое её состояние восстановимо, и сомнительный счётчик
 * чинится пересчётом, а не разбирательством.
 *
 * ЧТО СЧИТАЕТСЯ ВЫДАЧЕЙ. Начатая попытка со всем её составом (FR-01/FR-02): брошенная попытка
 * показала содержание так же, как доведённая до конца. Для веба состав берётся из `variant_json`
 * — там лежит ровно выданная форма; для телеметрии — из строк ответов прохождения, потому что
 * поле состава появилось в пакете только 2026-09-12, и у прохождений старше него другого следа
 * выдачи нет. Разница честная: по старой телеметрии восстанавливается «показано и отвечено», а
 * не «показано», и заниженный счётчик лучше выдуманного.
 *
 * ИМПОРТИРОВАННЫЕ ПРОХОЖДЕНИЯ (`origin = 'import'`) считаются по их ВЫДАННОМУ составу
 * (`delivered_question_ids`, FR-08/FR-09): разбор выгрузки отличает невыданное задание (все
 * четыре подколонки пусты) от выданного без ответа (PRD-66 FR-10a). Их строки идут в источник
 * `import` — тот, что пересчитывает загрузка партии. Прохождения, загруженные до появления поля,
 * состава не несут и не считаются; повторная загрузка того же файла его заполнит.
 *
 * Скрипт ЗАМЕЩАЕТ содержимое таблицы целиком и идемпотентен: повторный запуск даёт тот же
 * результат.
 *
 * Required environment variables:
 *   - DATABASE_URL   база, которую пересобираем
 *
 * Usage:
 *   npm run exposure:rebuild
 */

import pg from "pg";
import { loadEnv, loadConfiguration } from "../../server/config-loader.mjs";

const { Pool } = pg;

/** Сколько последних месяцев остаётся в таблице после уборки. */
const DEFAULT_WINDOW_MONTHS = 12;

/**
 * Пересобирает счётчик одним запросом на источник.
 *
 * Оба запроса считают ОДНУ выдачу на пару «попытка × задание» (`DISTINCT`): вопрос, к которому
 * участник возвращался, и вопрос, встреченный в двух разделах одной формы, — это по-прежнему
 * один показ (FR-03).
 * @param pool - Пул подключений к базе.
 * @param windowMonths - Окно наблюдения в месяцах; корзины старше не сохраняются.
 * @returns Сколько строк собрано и сколько корзин отброшено как устаревшие.
 */
async function rebuild(pool: pg.Pool, windowMonths: number): Promise<{ rows: number; dropped: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM question_exposure");

    // Веб: `variant_json.sections[].questionIds` — это и есть выданная форма.
    const web = await client.query(`
      INSERT INTO question_exposure (question_id, test_id, bucket_month, delivered_count)
      SELECT question_id, test_id, bucket_month, COUNT(*)::int
      FROM (
        SELECT DISTINCT
          a.id AS attempt_id,
          a.test_id,
          date_trunc('month', a.started_at)::date AS bucket_month,
          q.value #>> '{}' AS question_id
        FROM attempts a
        CROSS JOIN LATERAL jsonb_array_elements(a.variant_json -> 'sections') AS s(section)
        CROSS JOIN LATERAL jsonb_array_elements(s.section -> 'questionIds') AS q(value)
        WHERE a.started_at >= date_trunc('month', now()) - make_interval(months => $1)
      ) AS delivered
      GROUP BY question_id, test_id, bucket_month
      ON CONFLICT (question_id, test_id, bucket_month, source)
      DO UPDATE SET delivered_count = question_exposure.delivered_count + EXCLUDED.delivered_count
    `, [windowMonths]);

    // Телеметрия: состав берётся из ответов прохождения — см. шапку модуля.
    const telemetry = await client.query(`
      INSERT INTO question_exposure (question_id, test_id, bucket_month, delivered_count)
      SELECT question_id, test_id, bucket_month, COUNT(*)::int
      FROM (
        SELECT DISTINCT
          sa.attempt_id,
          at.test_id,
          date_trunc('month', at.started_at)::date AS bucket_month,
          sa.question_id
        FROM scorm_answers sa
        JOIN scorm_attempts at ON at.id = sa.attempt_id
        WHERE at.origin = 'telemetry'
          AND at.test_id IS NOT NULL
          AND at.started_at >= date_trunc('month', now()) - make_interval(months => $1)
      ) AS delivered
      GROUP BY question_id, test_id, bucket_month
      ON CONFLICT (question_id, test_id, bucket_month, source)
      DO UPDATE SET delivered_count = question_exposure.delivered_count + EXCLUDED.delivered_count
    `, [windowMonths]);

    // Импорт: выданный состав прохождения — см. шапку модуля. Источник свой, `import`.
    await client.query(`
      INSERT INTO question_exposure (question_id, test_id, bucket_month, source, delivered_count)
      SELECT q.question_id, a.test_id, date_trunc('month', a.started_at)::date, 'import',
             COUNT(DISTINCT a.id)::int
      FROM scorm_attempts a
      CROSS JOIN LATERAL jsonb_array_elements_text(a.delivered_question_ids) AS q(question_id)
      WHERE a.origin = 'import'
        AND a.test_id IS NOT NULL
        AND a.delivered_question_ids IS NOT NULL
        AND a.started_at >= date_trunc('month', now()) - make_interval(months => $1)
      GROUP BY q.question_id, a.test_id, date_trunc('month', a.started_at)::date
    `, [windowMonths]);

    // Уборка: выдачи вне окна в расчёт всё равно не идут, и хранить их незачем.
    const dropped = await client.query(
      `DELETE FROM question_exposure
       WHERE bucket_month < date_trunc('month', now())::date - make_interval(months => $1)`,
      [windowMonths],
    );

    const { rows } = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM question_exposure",
    );
    await client.query("COMMIT");

    void web;
    void telemetry;
    return { rows: Number(rows[0].count), dropped: dropped.rowCount ?? 0 };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  loadEnv();
  const cfg = await loadConfiguration();
  const databaseUrl = (cfg.database as { url?: string } | undefined)?.url ?? "";
  if (!databaseUrl) {
    console.error("[exposure-rebuild] DATABASE_URL must be set");
    process.exit(1);
  }
  const windowMonths =
    (cfg.delivery as { exposureWindowMonths?: number } | undefined)?.exposureWindowMonths
    ?? DEFAULT_WINDOW_MONTHS;

  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  try {
    const { rows, dropped } = await rebuild(pool, windowMonths);
    console.log(`[exposure-rebuild] окно: ${windowMonths} мес.`);
    console.log(`[exposure-rebuild] собрано строк счётчика: ${rows}`);
    console.log(`[exposure-rebuild] отброшено устаревших корзин: ${dropped}`);
  } catch (err) {
    console.error("[exposure-rebuild] database error:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(`[exposure-rebuild] ${(err as Error).message}`);
    process.exit(1);
  },
);
